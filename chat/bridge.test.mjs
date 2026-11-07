import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import {ClassroomBridge,createClassroomRoutes} from './bridge.mjs';
import {CodexAdapter,projectSnapshot} from './codex-adapter.mjs';

const sessionId='11111111-1111-4111-8111-111111111111',boardId='canvas-fixture';
async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'classroom-bridge-')),workspace=join(directory,'workspace');await mkdir(workspace);
  const state={id:sessionId,title:'测试老师',cwd:workspace,busy:false,messages:[{id:'prior-message',role:'assistant',text:'接课前原对话，不复制到课堂'}],revision:1};
  const sends=[];let sendError;
  const adapter={snapshot:async()=>structuredClone(state),send:async(id,text,requestId)=>{sends.push({id,text,requestId});if(sendError)throw sendError;state.messages.push({id:requestId,role:'user',text},{id:requestId+'-reply',role:'assistant',text:'同一会话的回复'});state.revision++;return{mode:'start'};},close(){}};
  const bridge=new ClassroomBridge({state:join(directory,'state'),workspace,boardLookup:async id=>id===boardId?{id,title:'测试白板'}:null,adapters:{codex:adapter}});
  t.after(async()=>{bridge.close();if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith('classroom-bridge-'))throw new Error('Refusing unsafe test cleanup');await rm(directory,{recursive:true,force:true});});
  return{bridge,state,sends,directory,workspace,setError:error=>sendError=error,join:input=>bridge.join({adapter:'codex',sessionId,boardId,lesson:'fixture-lesson',...input})};
}
test('主动加入绑定现有会话，隐藏接课前历史，不建立替代会话',async t=>{
  const f=await fixture(t);const joined=await f.join();assert.equal(joined.sessionId,sessionId);assert.equal(joined.active,true);assert.equal(f.sends.length,0);
  assert.deepEqual((await f.bridge.view(boardId)).messages,[]);
  f.state.messages.push({id:'after-join',role:'assistant',text:'接课后回复'});
  assert.equal((await f.bridge.view(boardId)).messages[0].text,'接课后回复');
  await f.join();assert.equal((await f.bridge.view(boardId)).messages.length,1,'重复加入不抹去课堂记录');
});
test('拒绝其他工作区、未知客户端与不存在的白板',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.join({adapter:'unknown'}),e=>e.status===422);
  await assert.rejects(f.join({boardId:'canvas-missing'}),e=>e.status===404);
  f.state.cwd=f.directory;await assert.rejects(f.join(),e=>e.status===403);assert.equal(f.sends.length,0);
});
test('重试去重，手机消息只提交给已绑定的原会话一次',async t=>{
  const f=await fixture(t);const a=await f.join(),requestId=randomUUID(),input={agentId:a.agentId,requestId,text:'解释第二步'};
  const first=await f.bridge.message(boardId,input);assert.equal(first.ok,true);
  assert.equal((await f.bridge.message(boardId,input)).ok,true);assert.equal(f.sends.length,1);assert.equal(f.sends[0].id,sessionId);
  await assert.rejects(f.bridge.message(boardId,{...input,text:'另一条消息'}),e=>e.status===409);
  const view=await f.bridge.view(boardId);assert.equal(view.messages.length,2);assert.equal(view.messages[1].text,'同一会话的回复');
});

test('老师主动接手后手机跟随新原对话；之后仍能手选其他老师',async t=>{
  const f=await fixture(t),first=await f.join();
  const secondId='22222222-2222-4222-8222-222222222222',other={...f.state,id:secondId,title:'第二位老师'};
  f.bridge.adapters.codex.snapshot=async id=>structuredClone(id===sessionId?f.state:other);
  const second=await f.join({sessionId:secondId,name:'第二位老师',activate:true});
  assert.ok(second.routingRevision>first.routingRevision);
  const switched=await f.bridge.view(boardId,first.agentId,first.routingRevision);
  assert.equal(switched.agent.id,second.agentId);
  assert.equal((await f.bridge.view(boardId,first.agentId,second.routingRevision)).agent.id,first.agentId);
  const beforeRevision=second.routingRevision;
  const retake=await f.join({sessionId:secondId,activate:true});
  assert.ok(retake.routingRevision>beforeRevision,'已是默认老师也能接回手机手选的对话');
  assert.equal(f.sends.length,0,'交接不发送模型消息');
});

test('交接时拦住尚未提交的旧收件消息；已送达消息重试仍返回原回执',async t=>{
  const f=await fixture(t),first=await f.join();
  const delivered={agentId:first.agentId,requestId:randomUUID(),text:'已发送',routingRevision:first.routingRevision};
  await f.bridge.message(boardId,delivered);
  const retake=await f.join({activate:true});
  await assert.rejects(f.bridge.message(boardId,{agentId:first.agentId,requestId:randomUUID(),text:'旧草稿',routingRevision:first.routingRevision}),e=>e.code==='CLASSROOM_ROUTING_CHANGED');
  assert.equal((await f.bridge.message(boardId,delivered)).delivery.status,'delivered');
  assert.equal(f.sends.length,1);
  assert.equal(retake.routingRevision,(await f.bridge.localStatus(sessionId)).rooms[0].routingRevision);
});
test('无法确认送达时不自动重放，重启后继续去重',async t=>{
  const f=await fixture(t),a=await f.join(),input={agentId:a.agentId,requestId:randomUUID(),text:'网络中断时的提问'};
  f.setError(new Error('connection reset after submission'));
  assert.equal((await f.bridge.message(boardId,input)).delivery.status,'uncertain');
  const reopened=new ClassroomBridge({state:join(f.directory,'state'),workspace:f.workspace,boardLookup:async()=>({}),adapters:f.bridge.adapters});
  assert.equal((await reopened.message(boardId,input)).delivery.status,'uncertain');assert.equal(f.sends.length,1);reopened.close();
});
test('退出课堂只解绑，不清空板书或停止原 Agent',async t=>{
  const f=await fixture(t),a=await f.join();await f.bridge.leave({boardId,sessionId});
  assert.equal((await f.bridge.view(boardId)).status,'waiting');assert.equal(f.sends.length,0);assert.equal(f.state.messages.length,1);
  await assert.rejects(f.bridge.message(boardId,{agentId:a.agentId,requestId:randomUUID(),text:'已退出'}),e=>e.status===409);
});
test('接课注册只允许本机，课堂页面需要凭据',async t=>{
  const f=await fixture(t),token='a'.repeat(64);
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  const route=createClassroomRoutes(f.bridge,{matches:v=>v===token,auth:req=>req.headers.authorization==='Bearer '+token,body:async req=>{let s='';for await(const chunk of req)s+=chunk;return JSON.parse(s||'{}');},send,observed(){}});
  const server=http.createServer(async(req,res)=>{if(!await route(req,res,new URL(req.url,'http://localhost')))send(res,404,{});});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const origin='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'},body=JSON.stringify({adapter:'codex',sessionId,boardId,lesson:'fixture'});
  assert.equal((await fetch(origin+'/classroom-agent/join',{method:'POST',headers:{...headers,'X-Forwarded-For':'192.0.2.1'},body})).status,403);
  assert.equal((await fetch(origin+'/classroom-agent/join',{method:'POST',headers:{...headers,Origin:origin},body})).status,403);
  assert.equal((await fetch(origin+'/classroom-agent/join',{method:'POST',headers,body})).status,200);
  assert.equal((await fetch(origin+`/classroom/${boardId}/wrong/`)).status,401);
  const page=await fetch(origin+`/classroom/${boardId}/${token}/`);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
  assert.equal((await fetch(origin+`/classroom/${boardId}/${token}/markdown-it.min.js`)).status,200);
  assert.equal((await fetch(origin+`/classroom/${boardId}/${token}/../codex-ipc.mjs`)).status,404);
});
test('原生适配器沿用会话设置，执行中用 steer，空闲时用 start',async()=>{
  let busy=false;const calls=[];
  const ipc={snapshot:async()=>({state:{id:sessionId,cwd:'fixture',turns:[{turnId:'turn-1',status:busy?'inProgress':'completed',items:[]}]},ownerClientId:'original-owner',revision:1}),requestOwner:async(...args)=>{calls.push(args);return{};},close(){}};
  const adapter=new CodexAdapter({ipc}),requestId=randomUUID();
  assert.equal((await adapter.send(sessionId,'hello',requestId)).mode,'start');
  assert.equal(calls[0][2].turnStart.context.inheritThreadSettings,true);assert.equal(calls[0][2].turnStart.request.threadId,sessionId);
  busy=true;assert.equal((await adapter.send(sessionId,'第二个问题',requestId)).mode,'steer');assert.equal(calls[1][1],'thread-follower-steer-turn');assert.equal(calls[1][2].clientUserMessageId,requestId);
  assert.equal(calls[1][2].restoreMessage.cwd,'fixture');assert.deepEqual(calls[1][2].restoreMessage.context.workspaceRoots,['fixture']);
  assert.deepEqual(calls[1][2].input[0].text_elements,[]);
});
test('手机只显示公开消息，不投影推理和工具敏感内容',()=>{
  const snapshot=projectSnapshot({state:{id:sessionId,turns:[{status:'completed',items:[{id:'hidden',type:'reasoning',text:'hidden'},{id:'tool',type:'commandExecution',aggregatedOutput:'secret'},{id:'answer',type:'agentMessage',text:'公开回答'}]}]},revision:1});
  assert.deepEqual(snapshot.messages.map(m=>m.text),['公开回答']);
});
test('执行中收到的真实手机消息显示为用户消息，转入正式记录后不重复',()=>{
  const steer={id:'optimistic',type:'steeringUserMessage',clientUserMessageId:'client-message',serverUserMessageId:'server-message',status:'accepted',input:[{type:'text',text:'你好老师',text_elements:[]}],restoreMessage:{createdAt:12345}};
  const state={id:sessionId,turns:[{status:'inProgress',items:[steer,{id:'reply',type:'agentMessage',text:'你好'}]}]};
  const before=projectSnapshot({state,revision:1});assert.equal(before.messages[0].role,'user');assert.equal(before.messages[0].text,'你好老师');
  state.turns[0].items.push({id:'server-message',type:'userMessage',content:steer.input});
  const after=projectSnapshot({state,revision:2});assert.equal(after.messages.filter(m=>m.role==='user').length,1);
});
