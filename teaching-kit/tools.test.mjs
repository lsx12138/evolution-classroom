import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,dirname,resolve,basename} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {createTeachingKit,teachingTools,TOOL_ROOT} from './tools.mjs';
import {startPanel} from './server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {CLASSROOM_TOOLS} from '../classroom-mcp.mjs';
import {createGateway} from '../mobile-gateway.mjs';

const state=await mkdtemp(join(tmpdir(),'teaching-kit-test-')),kit=createTeachingKit({state});
const activity={action:'create',id:'verification-complete-question',subject:'math',lesson:'verification-only',skill:'工具验证',prompt:'这是工具验证题，不是学生学习任务。',difficulty:2,purpose:'verification'};

test('mathematics preserves original exclusions and compares full domains',async()=>{
  const domain=await kit.call('math_verify',{operation:'domain',expression:'log((x-4)/(x+1))+1/sqrt(7-x)'});
  assert.equal(domain.ok,true);assert.match(domain.result.text,/Union/);assert.match(domain.result.text,/-1/);
  const equal=await kit.call('math_verify',{operation:'equivalent',expression:'x/x',other:'1'});
  assert.equal(equal.algebraically_equal,true);assert.equal(equal.same_domain,false);assert.equal(equal.equivalent_on_full_domain,false);
});
test('unsafe syntax and oversized powers are rejected without executing',async()=>{
  for(const expression of ["__import__('os').getcwd()",'x.__class__','2**1000000','open(x)','[x]']){
    const result=await kit.call('math_verify',{operation:'domain',expression});
    assert.equal(result.ok,false,expression);
  }
  await assert.rejects(()=>kit.call('math_verify',{operation:'domain',expression:'x',file:'_保管件/answer'}),/不允许/);
});
test('derivative equivalent forms and plot gaps work',async()=>{
  const result=await kit.call('math_verify',{operation:'equivalent',expression:'6*x*(x*x+1)**2',other:'6*x**5+12*x**3+6*x'});
  assert.equal(result.equivalent_on_full_domain,true);
  const plot=await kit.call('math_verify',{operation:'plot',expression:'1/x',x_min:-1,x_max:1,samples:31});
  assert.equal(plot.points[15][1],null);
});
test('activity feedback requires original submission; retries do not duplicate create',async()=>{
  const created=await kit.call('classroom_activity',activity);
  const duplicate=await kit.call('classroom_activity',activity);assert.equal(duplicate.duplicate,true);
  await assert.rejects(()=>kit.call('classroom_activity',{action:'feedback',id:activity.id,expected_revision:created.revision,result:'correct',hint_level:'none',feedback:'测试'}),/尚无学生提交/);
  const submitted=await kit.call('classroom_activity',{action:'submit',id:activity.id,expected_revision:created.revision,student_answer:'独立原答（验证数据）',student_evidence:'测试固定文本',feeling:'too_easy'});
  assert.equal(submitted.attempts[0].answer,'独立原答（验证数据）');
  await assert.rejects(()=>kit.call('classroom_activity',{action:'submit',id:activity.id,expected_revision:created.revision,student_answer:'旧版本',student_evidence:'验证'}),/STALE_REVISION/);
  const assessed=await kit.call('classroom_activity',{action:'feedback',id:activity.id,expected_revision:submitted.revision,result:'correct',hint_level:'none',feedback:'验证反馈'});
  assert.equal(assessed.recommendation.action,'advance_or_next_topic');assert.equal(assessed.recommendation.suggested_difficulty,3);
  await assert.rejects(()=>kit.call('classroom_activity',{...activity,prompt:'同id不同题'}),/不同内容/);
});
test('too-easy with local error does not lock learner into basic drill',async()=>{
  const a=await kit.call('classroom_activity',{...activity,id:'verification-gap'});
  const b=await kit.call('classroom_activity',{action:'submit',id:a.id,expected_revision:a.revision,student_answer:'部分原答',student_evidence:'验证',feeling:'too_easy'});
  const c=await kit.call('classroom_activity',{action:'feedback',id:a.id,expected_revision:b.revision,result:'partial',hint_level:'rule',feedback:'仅一个条件待核'});
  assert.equal(c.recommendation.action,'target_gap_in_new_context');
});
test('graph configuration validates math, ranges, and parameter names',async()=>{
  const graph=await kit.call('teaching_graph',{action:'create',id:'verification-parabola',title:'验证函数图',expressions:['a*x**2+b'],parameters:[{name:'a',min:-3,max:3,value:1,step:.5},{name:'b',min:-3,max:3,value:0,step:.5}]});
  assert.equal(graph.parameters.length,2);
  await assert.rejects(()=>kit.call('teaching_graph',{action:'create',id:'bad-graph',expressions:['x'],x_min:2,x_max:1}),/范围错误/);
  await assert.rejects(()=>kit.call('teaching_graph',{action:'create',id:'bad-expression',expressions:['evil(x)']}),/数学函数|未知/);
});
test('review export requires learned source and safely preserves UTF-8 content',async()=>{
  await assert.rejects(()=>kit.call('review_cards',{action:'upsert',deck_id:'verification',subject:'english',cards:[{id:'c1',front:'Q',back:'A',evidence:'',source_status:'planned'}]}));
  await kit.call('review_cards',{action:'upsert',deck_id:'verification',subject:'english',cards:[{id:'c1',front:'词义 <test>',back:'回答\n第二行',evidence:'已讲解的验证材料',source_status:'taught'}]});
  const exported=await kit.call('review_cards',{action:'export',deck_id:'verification'}),text=await readFile(exported.path,'utf8');
  assert.ok(text.startsWith('#separator:Tab\n#html:true\n'));assert.match(text,/&lt;test&gt;/);assert.match(text,/回答<br>第二行/);assert.equal(exported.cards,1);
  await assert.rejects(()=>kit.call('review_cards',{action:'list',deck_id:'../_保管件'}));
});
test('student HTTP surface protects token, origin and file paths; no teacher solver route',async()=>{
  const panel=await startPanel({state:join(state,'panel-fixture')});
  try{
    const base=panel.config.origin+'/learning-tools/'+panel.config.token+'/';
    assert.equal((await fetch(panel.config.origin+'/learning-tools/wrong/')).status,401);
    assert.equal((await fetch(base,{headers:{Origin:'https://not-our-classroom.invalid'}})).status,403);
    assert.equal((await fetch(base)).status,200);
    assert.equal((await fetch(base+'mathlive/mathlive.min.js')).status,200);
    assert.equal((await fetch(base+'api/math_verify',{method:'POST',body:'{}'})).status,405);
    assert.equal((await fetch(base+'mathlive/%2e%2e%2f%2e%2e%2fpackage.json')).status,400);
    const plot=await fetch(base+'api/plot',{method:'POST',body:JSON.stringify({expression:'a*x',parameters:{a:2},x_min:-1,x_max:1,samples:31})});
    assert.equal((await plot.json()).points.length,31);
  }finally{await new Promise(r=>panel.server.close(r));}
});
test('new HTTP gateway exposes toolkit beside existing study and board tools',async()=>{
  const gatewayState=join(state,'gateway');await mkdir(gatewayState);
  await writeFile(join(gatewayState,'token'),'test-token-private');
  const gateway=createGateway({workspace:resolveWorkspace(),state:gatewayState,port:47430,publicOrigin:'https://classroom-test.invalid'});
  try{
    assert.ok(gateway.schemas.some(t=>t.name==='canvas_read'));assert.ok(gateway.schemas.some(t=>t.name==='study_context'));
    assert.equal(gateway.schemas.length,21);
    const result=await gateway.run('math_verify',{operation:'differentiate',expression:'x**3'});
    assert.equal(result.structuredContent.result.text,'3*x**2');
  }finally{gateway.classroom.close();await gateway.classroom.ready;}
});
function resolveWorkspace(){return state;}
test('real MCP stdio discovers 25 tools and calls new mathematics tool',async t=>{
  const localState=await mkdtemp(join(tmpdir(),'teaching-stdio-test-'));
  t.after(async()=>{assert.equal(dirname(resolve(localState)),resolve(tmpdir()));assert.ok(basename(localState).startsWith('teaching-stdio-test-'));await rm(localState,{recursive:true,force:true});});
  const env={...process.env,STUDY_CLASSROOM_STATE:localState};
  await promisify(execFile)(process.execPath,[join(TOOL_ROOT,'scripts/init.mjs'),'--workspace',join(localState,'workspace')],{cwd:TOOL_ROOT,env,windowsHide:true});
  const client=new Client({name:'teaching-kit-verification',version:'1.0'},{capabilities:{}});
  const transport=new StdioClientTransport({command:process.execPath,args:[join(TOOL_ROOT,'classroom-mcp.mjs')],cwd:TOOL_ROOT,env,stderr:'pipe'});
  try{
    await client.connect(transport);const tools=(await client.listTools()).tools;
    assert.equal(tools.length,25);assert.equal(new Set(tools.map(t=>t.name)).size,25);assert.equal(CLASSROOM_TOOLS.length,25);
    assert.ok(teachingTools.every(t=>tools.some(x=>x.name===t.name)));
    const result=await client.callTool({name:'math_verify',arguments:{operation:'differentiate',expression:'x**3'}});
    assert.equal(result.isError,undefined);assert.equal(result.structuredContent.result.text,'3*x**2');
    const context=await client.callTool({name:'study_context',arguments:{subject:'math'}});
    assert.match(context.structuredContent.teaching_context.profile.content,/Learner profile/);
    assert.match(context.structuredContent.teaching_context.mode.content,/complete questions/);
  }finally{await client.close();await transport.close();}
});
