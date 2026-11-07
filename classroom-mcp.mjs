import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {TOOLS} from './node_modules/@ansuman-shukla/whiteboard-mcp/dist/mcp/tools.js';
import {validate} from './node_modules/@ansuman-shukla/whiteboard-mcp/dist/mcp/schema.js';
import {studyTools} from './workspace-store.mjs';
import {STATE_DIR} from './lib/runtime.mjs';
import {ADAPTER_NAMES,validSessionId} from './chat/session-identity.mjs';
import {readFile,appendFile,mkdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const ROOT=dirname(fileURLToPath(import.meta.url)),exec=promisify(execFile);
const json=value=>({content:[{type:'text',text:JSON.stringify(value,null,2)}],structuredContent:value});
const failure=error=>({isError:true,content:[{type:'text',text:error.message}]});
const sessionProperty={type:'string',description:'调用者自己的原对话 ID。宿主 metadata 已提供时可省略；否则由 Agent 从自己的会话上下文填写；Codex 可读取 CODEX_THREAD_ID，不让学生查找，不选择最近或他人的会话。'};
const adapterProperty={type:'string',enum:ADAPTER_NAMES,description:'原会话适配器：codex、pi-desktop、minimax-desktop、antigravity。按当前桌面客户端填写；Claude Desktop 待适配。'};
const customTools=[
  {name:'classroom_start',description:'按用户授课需要启动或检查这台电脑的课堂服务、白板与现有 Tailscale 入口。不设置开机自启，不启动新 Agent 对话。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
  {name:'classroom_join',description:'主动把自己的桌面原对话接入课堂；用户让你授课、继续讲解或接手手机提问时调用，接手传 activate:true。沿用同一 lesson 和白板。手机消息进入此原对话、公开回答自动回手机。原理和跨对话切换见 docs/AGENT_INTEGRATION.md。',inputSchema:{type:'object',properties:{lesson:{type:'string',minLength:1,maxLength:256,description:'本节课程标识，与白板工具 lesson 和本地 --session 一致。'},name:{type:'string',minLength:1,maxLength:80,description:'学生看到的老师名称，建议注明科目和客户端。'},session_id:sessionProperty,adapter:adapterProperty,activate:{type:'boolean',description:'设 true 接手课堂：手机后续消息切到自己的这条原对话。用户开始/继续跟你学或要求切到你时主动使用；仅登记备用传 false。'}},required:['lesson'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
  {name:'classroom_status',description:'检查常驻课堂服务、已支持的原会话适配器和当前 Agent 加入的白板。未提供会话身份时列本学习工作区的注册信息，不会替调用者猜测会话。',inputSchema:{type:'object',properties:{session_id:sessionProperty,adapter:adapterProperty},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}},
  {name:'classroom_leave',description:'只解除调用者自己在指定白板上的消息接课绑定；保留板书、原聊天和共用服务。',inputSchema:{type:'object',properties:{board_id:{type:'string',pattern:'^[a-z0-9][a-z0-9-]{0,63}$'},session_id:sessionProperty,adapter:adapterProperty},required:['board_id'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
];
export const CLASSROOM_TOOLS=[...customTools,...TOOLS.map(({name,description,inputSchema})=>({name,description:description+' 正式授课传 lesson，沿用同一课程白板。',inputSchema:{...inputSchema,properties:{...inputSchema.properties,lesson:{type:'string',description:'与课堂接课和本地 --session 一致的课程标识。'}}}})),...studyTools];

export function callerSession(args,meta,required=false){
  const adapter=args.adapter||'codex';
  const keys=['threadId','thread_id','thread-id','conversationId','conversation_id','chatId',...(adapter==='codex'?[]:['sessionId','session_id'])];
  let fromHost;
  if(meta&&typeof meta==='object')for(const key of keys){const entry=Object.entries(meta).find(([name,value])=>name.split('/').at(-1)===key&&validSessionId(value,adapter));if(entry){fromHost=entry[1];break;}}
  if(fromHost&&args.session_id&&fromHost!==args.session_id)throw new Error('提供的会话 ID 与 MCP 宿主当前对话不一致；不能替另一个对话接课。');
  const id=fromHost||args.session_id;
  if(id&&!validSessionId(id,adapter))throw new Error('原对话 ID 格式不正确。');
  if(required&&!id)throw new Error('宿主未提供当前对话 ID。请 Agent 使用自身会话 ID 和对应 adapter 重试（Codex 可读取 CODEX_THREAD_ID）；不要让学生填写，也不要猜最近的聊天。');
  // Never fall back to this MCP process's CODEX_THREAD_ID: a host may reuse
  // one MCP process for several conversations, or inherit another agent's env.
  return id;
}

export function createClassroomMcp({root=ROOT,audit=true}={}){
  const state=STATE_DIR;
  async function settings(){const config=JSON.parse(await readFile(join(state,'mobile-gateway.json'),'utf8'));const token=(await readFile(join(state,'token'),'utf8')).trim();return{origin:`http://127.0.0.1:${config.port}`,token};}
  async function request(path,{payload,timeout=15000}={}){
    const {origin,token}=await settings();let response;
    try{response=await fetch(origin+path,{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(timeout)});}catch{throw new Error('课堂接口暂不可达。请先调用 classroom_start，再重试当前操作。');}
    const data=await response.json();if(!response.ok)throw new Error(data.error||'课堂接口请求失败');return data;
  }
  const server=new Server({name:'study-classroom',version:'1.1.0'},{capabilities:{tools:{}},instructions:'本机共享课堂。用户让你开始/继续授课或接手手机提问时，主动看 classroom_status、study_context，再用 classroom_join(lesson,adapter,session_id,activate:true) 接到自己的当前原对话；仅备用登记用 false，避免后台循环抢接。同一客户端的不同聊天有不同 session_id；身份必须来自当前宿主上下文，禁止猜最近或让学生代填。接手保持同一 lesson/boardId。原理：课堂桥按当前接课绑定将手机消息提交给桌面原对话，再读公开回复回手机，无需额外调用转发工具；不会迁移原聊天历史。详见 docs/AGENT_INTEGRATION.md。先读板再局部改，保护草稿；真实学习证据才记档案。Original installation tested phone messaging with Codex, PI-Desktop, MiniMax Code and Antigravity; verify this machine independently.后三款等本轮结束后再发送。Claude Desktop 另行适配，CLI 客户端不改。'});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:CLASSROOM_TOOLS}));
  server.setRequestHandler(CallToolRequestSchema,async({params})=>{
    try{
      const definition=CLASSROOM_TOOLS.find(t=>t.name===params.name);if(!definition)throw new Error('未知课堂工具。');
      const args=params.arguments||{},invalid=validate(definition.inputSchema,args);if(invalid)throw new Error('参数错误：'+invalid);
      if(audit){await mkdir(state,{recursive:true});await appendFile(join(state,'classroom-mcp-calls.jsonl'),JSON.stringify({time:new Date().toISOString(),pid:process.pid,tool:params.name,metaKeys:Object.keys(params._meta||{})})+'\n',{mode:0o600});}
      if(params.name==='classroom_start'){
        try{const health=await request('/health',{timeout:2000});const owned=await request('/agent/tools',{timeout:2000});if(health.ok&&health.classroomChat&&owned.tools?.length===15)return json({ok:true,alreadyRunning:true,health});}catch{}
        try{await exec(process.execPath,[join(root,'scripts/start-local.mjs')],{windowsHide:true,timeout:45000,maxBuffer:1024*1024});}catch(error){throw new Error('课堂启动未完成：'+String(error.stderr||error.message).replace(/[a-f0-9]{64}/gi,'[private]').slice(-600));}
        return json({ok:true,health:await request('/health')});
      }
      const sessionId=callerSession(args,params._meta,['classroom_join','classroom_leave'].includes(params.name));
      if(params.name==='classroom_status'){
        try{const health=await request('/health',{timeout:2500});const registration=await request('/classroom-agent/status'+(sessionId?'?sessionId='+encodeURIComponent(sessionId):''));return json({ok:true,health,callerSessionId:sessionId||null,identitySource:sessionId?'host metadata or explicit self ID':'not provided; no conversation inferred',...registration});}catch(error){return json({ok:false,availableAdapters:ADAPTER_NAMES,error:error.message});}
      }
      if(params.name==='classroom_join'){
        const argv=[join(root,'classroom.mjs'),'join','--lesson',args.lesson,'--thread',sessionId,'--adapter',args.adapter||'codex'];
        if(args.name)argv.push('--name',args.name);if(args.activate)argv.push('--activate');
        const {stdout}=await exec(process.execPath,argv,{cwd:root,windowsHide:true,timeout:30000,maxBuffer:1024*1024});return json(JSON.parse(stdout));
      }
      if(params.name==='classroom_leave')return json(await request('/classroom-agent/leave',{payload:{sessionId,boardId:args.board_id}}));
      const forwarded={...args};delete forwarded.session_id;
      if(params.name.startsWith('canvas_')&&!['canvas_guide','canvas_search'].includes(params.name)&&!forwarded.lesson){
        if(sessionId){const registered=await request('/classroom-agent/status?sessionId='+encodeURIComponent(sessionId));if(registered.rooms?.length===1)forwarded.lesson=registered.rooms[0].lesson;}
        if(!forwarded.lesson)throw new Error('请为白板工具提供 lesson，或先在这个会话明确加入唯一一堂课。');
      }
      return await request('/agent/call',{payload:{name:params.name,arguments:forwarded},timeout:45000});
    }catch(error){return failure(error);}
  });
  return server;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const server=createClassroomMcp();await server.connect(new StdioServerTransport());
}
