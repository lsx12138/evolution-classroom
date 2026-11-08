import {readFile,writeFile,mkdir,open,rename,unlink,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';

export const KIT_ROOT=dirname(fileURLToPath(import.meta.url));
export const TOOL_ROOT=dirname(KIT_ROOT);
const exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
const str={type:'string',minLength:1,maxLength:12000};
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'};
const subject={type:'string',pattern:'^[a-z][a-z0-9_-]{0,63}$'};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const array=(items,maxItems=100)=>({type:'array',items,maxItems});
const numeric={type:'number'};
const parameter=object({name:{type:'string',enum:['a','b','c','m','n','k']},min:numeric,max:numeric,value:numeric,step:numeric},['name','min','max','value','step']);
const mathProperties={
  operation:{type:'string',enum:['domain','differentiate','integrate','simplify','equivalent','inequality','plot']},
  expression:{type:'string',minLength:1,maxLength:600},other:{type:'string',minLength:1,maxLength:600},
  variable:{type:'string',enum:['x','y','z','t']},relation:{type:'string',enum:['>','>=','<','<=']},
  parameters:object(Object.fromEntries(['a','b','c','m','n','k'].map(k=>[k,numeric]))),
  x_min:numeric,x_max:numeric,samples:{type:'integer',minimum:30,maximum:1000},
};
export const teachingTools=[
  {name:'teaching_tools_status',description:'检查教学工具箱：本机SymPy、离线GeoGebra、MathLive、答题卡与Anki导出；不接课、不写学生进度。',inputSchema:object({})},
  {name:'teaching_panel',description:'打开独立教学工具箱面板（公式输入、答题卡、动态函数图）；启动本机配套服务，不改课堂收件绑定，不停止共享白板。返回私有访问链接。',inputSchema:object({activity_id:id,graph_id:id})},
  {name:'math_verify',description:'教师数学校验：实数定义域、不等式、求导、积分、化简和表达式等价；原始定义域单独保留。仅核教师自编示范或学生已交回题，不读取保管答案；不等于自动判定学生理解。表达式用显式乘号。',inputSchema:object(mathProperties,['operation','expression'])},
  {name:'classroom_activity',description:'完整题答题卡：创建题目、读取真实提交、教师反馈、给出可解释的难度推进建议。无标准答案字段；提交不会自动写入学习记录。反馈需已有学生作答与revision。难度为教师暂定，不冒充官方试题难度。',inputSchema:object({
    action:{type:'string',enum:['create','get','submit','feedback','list']},id,subject,lesson:str,skill:str,prompt:str,math_latex:str,
    difficulty:{type:'integer',minimum:1,maximum:4},purpose:{type:'string',enum:['teaching','verification']},
    expected_revision:str,student_answer:str,student_latex:str,student_evidence:str,
    source:{type:'string',enum:['teacher_transcribed_student','student_panel']},
    feeling:{type:'string',enum:['too_easy','suitable','too_hard','unspecified']},
    result:{type:'string',enum:['correct','partial','incorrect','ungraded']},
    hint_level:{type:'string',enum:['none','rule','step','solution']},feedback:str,
  },['action'])},
  {name:'teaching_graph',description:'创建可复用动态函数图，离线GeoGebra+本机采样图双视图，支持参数滑块。图为教学表示，采样不能证明端点/连续性；不写掌握记录。',inputSchema:object({
    action:{type:'string',enum:['create','get','list']},id,title:str,
    expressions:array({type:'string',minLength:1,maxLength:600},6),parameters:array(parameter,6),
    x_min:numeric,x_max:numeric,y_min:numeric,y_max:numeric,
  },['action'])},
  {name:'review_cards',description:'从已讲或已提交的真实内容准备复习卡，并导出Anki可导入的UTF-8文本；不会安装Anki、上传同步或生成虚构复习成果。只允许taught/submitted来源。',inputSchema:object({
    action:{type:'string',enum:['upsert','list','export']},deck_id:id,subject,
    cards:array(object({id,front:str,back:str,evidence:str,source_status:{type:'string',enum:['taught','submitted']}},['id','front','back','evidence','source_status']),200),
  },['action','deck_id'])},
].map(t=>({...t,annotations:{readOnlyHint:['math_verify','teaching_tools_status'].includes(t.name),destructiveHint:false}}));

export function strictValidate(schema,value,path='arguments'){
  const type=Array.isArray(value)?'array':value===null?'null':typeof value;
  if(schema.type==='integer'?!Number.isInteger(value):type!==schema.type)throw new Error(path+' 类型应为 '+schema.type);
  if(schema.enum&&!schema.enum.includes(value))throw new Error(path+' 超出允许值');
  if(type==='string'&&(value.length<(schema.minLength||0)||value.length>(schema.maxLength||20000)||schema.pattern&&!new RegExp(schema.pattern).test(value)))throw new Error(path+' 字符串长度或格式错误');
  if(type==='number'&&(!Number.isFinite(value)||(schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))throw new Error(path+' 数值超出范围');
  if(type==='array'){if(value.length>(schema.maxItems||200))throw new Error(path+' 项目过多');value.forEach((v,i)=>strictValidate(schema.items,v,path+'['+i+']'));}
  if(type==='object'){
    for(const name of schema.required||[])if(value[name]===undefined)throw new Error(path+'.'+name+' 缺失');
    for(const [name,v] of Object.entries(value)){const sub=schema.properties[name];if(!sub)throw new Error(path+'.'+name+' 不允许');strictValidate(sub,v,path+'.'+name);}
  }
}
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function recommendation(item){
  const last=item.attempts.at(-1);
  if(!last)return {action:'await_submission',reason:'先独立完成整题，尚无作答证据。'};
  if(!last.assessment)return {action:'await_teacher_feedback',reason:'已收到原答；老师先判断具体步骤，不凭自评判掌握。'};
  const a=last.assessment;
  if(a.result==='correct'&&a.hint_level==='none')return {action:last.feeling==='too_easy'?'advance_or_next_topic':'increase_one_dimension',reason:'本题无具体提示完成；减少同类重复，尝试更有区分度的变式或下一知识点。',suggested_difficulty:Math.min(4,item.difficulty+1)};
  if(last.feeling==='too_easy')return {action:'target_gap_in_new_context',reason:'学生反馈太易；保留具体错误，在新情境自然复查，不自动锁回基础题。'};
  if(a.hint_level==='solution')return {action:'reduce_help_later',reason:'已见示范，不能记独立掌握；后续用不同题减少帮助再观察。'};
  if(last.feeling==='too_hard')return {action:'local_prerequisite_patch',reason:'只回补阻碍当前方法的前置，随后返回完整题；不全科清零。'};
  return {action:'specific_feedback_then_retry',reason:'针对首个失效步骤反馈；教师根据新作答决定推进，不凑固定题数。'};
}

export function createTeachingKit({root=TOOL_ROOT,state=join(resolve(process.env.STUDY_CLASSROOM_STATE||join(root,'state')),'teaching-kit')}={}){
  const file=(kind,key)=>join(state,kind,key+'.json');
  const checkId=key=>{strictValidate(id,key,'id');return key;};
  async function atomic(path,data){
    await mkdir(dirname(path),{recursive:true});
    const temp=path+'.'+randomUUID()+'.tmp';
    await writeFile(temp,JSON.stringify(data,null,2),{mode:0o600});
    try{await rename(temp,path);}catch(error){await unlink(temp).catch(()=>{});throw error;}
  }
  async function locked(path,fn){
    await mkdir(dirname(path),{recursive:true});
    let handle;const end=Date.now()+4500;
    while(!handle){try{handle=await open(path+'.lock','wx');}catch(e){if(e.code!=='EEXIST'||Date.now()>end)throw new Error('资料正在更新，请稍后重试。');await pause(40);}}
    try{return await fn();}finally{await handle.close();await unlink(path+'.lock').catch(()=>{});}
  }
  const load=async(kind,key)=>JSON.parse(await readFile(file(kind,checkId(key)),'utf8'));
  const list=async kind=>{try{return(await readdir(join(state,kind))).filter(x=>x.endsWith('.json')).map(x=>x.slice(0,-5));}catch(e){if(e.code==='ENOENT')return[];throw e;}};
  const view=item=>({...item,revision:fingerprint(item),recommendation:recommendation(item)});
  async function math(args){
    strictValidate(teachingTools.find(t=>t.name==='math_verify').inputSchema,args);
    if(args.operation==='equivalent'&&!args.other)throw new Error('等价检查需要other表达式。');
    try{
      const child=spawn(process.env.STUDY_PYTHON||'python',[join(root,'teaching-kit','math-worker.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      return await new Promise((ok,fail)=>{
        let stdout='',stderr='',done=false;
        const timer=setTimeout(()=>{if(!done){child.kill();fail(new Error('数学校验超过8秒，已停止；请拆题或由教师独立核对。'));}},8000);
        child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>400000){child.kill();}});
        child.stderr.on('data',chunk=>{stderr+=chunk;});
        child.on('error',error=>{done=true;clearTimeout(timer);fail(new Error('Python未就绪：'+error.message));});
        child.on('close',code=>{if(done)return;done=true;clearTimeout(timer);try{if(code!==0)throw new Error(stderr.slice(0,250)||'计算进程退出');ok(JSON.parse(stdout));}catch(e){fail(new Error('数学校验未完成：'+e.message));}});
        child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(args));
      });
    }catch(error){throw new Error(error.message);}
  }
  async function activity(args){
    if(args.action==='list')return {ids:await list('activities')};
    const key=checkId(args.id),path=file('activities',key);
    if(args.action==='get')return view(await load('activities',key));
    return locked(path,async()=>{
      if(args.action==='create'){
        for(const name of ['subject','lesson','skill','prompt','difficulty'])if(args[name]===undefined)throw new Error('创建答题卡需要'+name);
        const item={id:key,subject:args.subject,lesson:args.lesson,skill:args.skill,prompt:args.prompt,math_latex:args.math_latex||'',difficulty:args.difficulty,purpose:args.purpose||'teaching',attempts:[],created_at:new Date().toISOString()};
        try{const old=await load('activities',key);if(fingerprint({...old,attempts:[],created_at:''})!==fingerprint({...item,created_at:''}))throw new Error('同一题号已有不同内容，请另用id。');return {...view(old),duplicate:true};}catch(e){if(e.code!=='ENOENT')throw e;}
        await atomic(path,item);return view(item);
      }
      const item=await load('activities',key);
      if(!args.expected_revision||args.expected_revision!==fingerprint(item))throw new Error('STALE_REVISION：题目已更新，请先get后合并。');
      if(args.action==='submit'){
        if(!args.student_answer?.trim())throw new Error('请提交学生自己的答案。');
        if(args.source!=='student_panel'&&!args.student_evidence?.trim())throw new Error('教师转录需要学生原话或草稿证据。');
        item.attempts.push({id:randomUUID(),answer:args.student_answer,latex:args.student_latex||'',evidence:args.student_evidence||args.student_answer,source:args.source||'teacher_transcribed_student',feeling:args.feeling||'unspecified',submitted_at:new Date().toISOString()});
      }else if(args.action==='feedback'){
        const last=item.attempts.at(-1);
        if(!last)throw new Error('尚无学生提交，不能预填评价。');
        if(!args.result||!args.hint_level||!args.feedback)throw new Error('反馈需要result、hint_level和具体说明。');
        last.assessment={result:args.result,hint_level:args.hint_level,feedback:args.feedback,assessed_at:new Date().toISOString()};
      }else throw new Error('未知答题卡操作。');
      await atomic(path,item);return view(item);
    });
  }
  async function graph(args){
    if(args.action==='list')return {ids:await list('graphs')};
    const key=checkId(args.id);
    if(args.action==='get')return load('graphs',key);
    if(!args.expressions?.length)throw new Error('图形至少需要一个表达式。');
    const parameters=args.parameters||[];
    if(new Set(parameters.map(p=>p.name)).size!==parameters.length)throw new Error('参数名不能重复。');
    for(const p of parameters)if(!(p.min<p.max&&p.value>=p.min&&p.value<=p.max&&p.step>0))throw new Error('滑块范围、步长或初值错误。');
    const item={id:key,title:args.title||'函数探索',expressions:args.expressions,parameters,x_min:args.x_min??-10,x_max:args.x_max??10,y_min:args.y_min??-10,y_max:args.y_max??10};
    if(!(item.x_min<item.x_max&&item.y_min<item.y_max))throw new Error('坐标范围错误。');
    for(const expression of args.expressions){const probe=await math({operation:'plot',expression,parameters:Object.fromEntries(parameters.map(p=>[p.name,p.value])),x_min:item.x_min,x_max:item.x_max,samples:31});if(!probe.ok)throw new Error(probe.error);}
    await locked(file('graphs',key),()=>atomic(file('graphs',key),item));
    return item;
  }
  async function cards(args){
    const key=checkId(args.deck_id),path=file('decks',key);
    if(args.action==='upsert'){
      if(!args.subject||!args.cards?.length)throw new Error('需提供科目和有真实来源的复习卡。');
      return locked(path,async()=>{
        let deck;try{deck=await load('decks',key);}catch(e){if(e.code!=='ENOENT')throw e;deck={id:key,subject:args.subject,cards:[]};}
        if(deck.subject!==args.subject)throw new Error('不能把同一牌组跨科覆盖。');
        const byId=new Map(deck.cards.map(c=>[c.id,c]));args.cards.forEach(c=>byId.set(c.id,c));deck.cards=[...byId.values()];
        await atomic(path,deck);return {ok:true,deck_id:key,cards:deck.cards.length,note:'卡片准备不计入学习或复习成果。'};
      });
    }
    const deck=await load('decks',key);
    if(args.action==='list')return deck;
    const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\r?\n|\t/g,'<br>');
    const text='#separator:Tab\n#html:true\n'+deck.cards.map(c=>escape(c.front)+'\t'+escape(c.back)+'<br>来源：'+escape(c.evidence)).join('\n')+'\n';
    const output=join(state,'exports',key+'.txt');await mkdir(dirname(output),{recursive:true});await writeFile(output,text,'utf8');
    return {ok:true,path:output,format:'Anki UTF-8 tab-separated text',cards:deck.cards.length,note:'导入Anki后由本人作答和评分；未建立同步或虚构复习记录。'};
  }
  async function status(){
    const present=async path=>{try{await readFile(path);return true;}catch{return false;}};
    let sympy;try{const {stdout}=await exec(process.env.STUDY_PYTHON||'python',['-c','import sympy; print(sympy.__version__)'],{windowsHide:true,timeout:5000});sympy=stdout.trim();}catch{sympy=null;}
    return {ok:true,version:'1.0.0',sympy,mathlive:await present(join(root,'node_modules','mathlive','mathlive.min.js')),geogebra_offline:await present(join(root,'teaching-kit','vendor','geogebra','GeoGebra','deployggb.js')),activity_count:(await list('activities')).length,features:teachingTools.map(t=>t.name),rules:'按用户所在地区与当届考试范围；教师暂定难度；不读取保管答案；工具演示和卡片准备不算学生成果。'};
  }
  async function ensurePanel(args={}){
    await mkdir(state,{recursive:true});
    const configPath=join(state,'panel.json');
    const read=async()=>{try{const cfg=JSON.parse(await readFile(configPath,'utf8'));const res=await fetch(cfg.origin+'/health',{signal:AbortSignal.timeout(800)});const health=await res.json();if(health.app==='study-teaching-kit'&&health.instance===cfg.instance)return cfg;}catch{}return null;};
    let cfg=await read();
    if(!cfg){
      const child=spawn(process.execPath,[join(root,'teaching-kit','server.mjs'),'--state',state],{cwd:root,windowsHide:true,detached:true,stdio:'ignore'});child.unref();
      for(let i=0;i<60&&!cfg;i++){await pause(150);cfg=await read();}
    }
    if(!cfg)throw new Error('教学面板尚未启动，请检查Python、依赖和本机端口。');
    const url=new URL('/learning-tools/'+cfg.token+'/',cfg.origin);
    if(args.activity_id)url.searchParams.set('activity',args.activity_id);
    if(args.graph_id)url.searchParams.set('graph',args.graph_id);
    return {ok:true,url:url.href,note:'私有本机面板；未切换课堂老师。学生提交后由老师读取答题卡，提交本身不自动唤醒原对话。'};
  }
  return {
    state,math,activity,graph,cards,load,list,status,ensurePanel,
    handles:name=>teachingTools.some(t=>t.name===name),
    async call(name,args={}){
      const definition=teachingTools.find(t=>t.name===name);if(!definition)throw new Error('未知教学工具。');strictValidate(definition.inputSchema,args);
      if(name==='teaching_tools_status')return status();
      if(name==='math_verify')return math(args);
      if(name==='classroom_activity')return activity(args);
      if(name==='teaching_graph')return graph(args);
      if(name==='review_cards')return cards(args);
      return ensurePanel(args);
    },
  };
}
