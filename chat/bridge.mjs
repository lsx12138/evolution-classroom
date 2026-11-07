import {readFile,writeFile,rename,mkdir,realpath} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {CodexAdapter} from './codex-adapter.mjs';
import {PiDesktopAdapter} from './pi-desktop-adapter.mjs';
import {AntigravityAdapter} from './antigravity-adapter.mjs';
import {MinimaxDesktopAdapter} from './minimax-desktop-adapter.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const boardPattern=/^[a-z0-9][a-z0-9-]{0,63}$/;
const idPattern=/^[a-f0-9-]{36}$/i;
const sha=text=>createHash('sha256').update(text).digest('hex');
const publicDelivery=({fingerprint,diagnostic,...value})=>value;
const privateHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};

export class ClassroomBridge {
  constructor({state,workspace,boardLookup,adapters={codex:new CodexAdapter(),'pi-desktop':new PiDesktopAdapter(),antigravity:new AntigravityAdapter(),'minimax-desktop':new MinimaxDesktopAdapter()}}){
    this.file=join(state,'classroom-bridge.json');this.workspace=resolve(workspace);this.boardLookup=boardLookup;this.adapters=adapters;
    this.data={version:1,rooms:{},deliveries:{}};this.writes=Promise.resolve();this.sends=new Map();this.live=new Map();
    this.ready=(async()=>{await mkdir(state,{recursive:true});try{const data=JSON.parse(await readFile(this.file,'utf8'));if(data.version!==1)throw new Error('Unknown classroom registry version');this.data=data;}catch(error){if(error.code!=='ENOENT')throw error;}})();
  }
  async save(){
    const task=this.writes.catch(()=>{}).then(async()=>{const tmp=this.file+'.tmp';await writeFile(tmp,JSON.stringify(this.data,null,2),{mode:0o600});await rename(tmp,this.file);});
    this.writes=task;await task;
  }
  async checkWorkspace(cwd){
    if(typeof cwd!=='string')throw fail('无法确认 Agent 所在工作区。',403);
    const root=(await realpath(this.workspace)).toLowerCase(),candidate=(await realpath(cwd)).toLowerCase();
    if(candidate!==root&&!candidate.startsWith(root+'\\')&&!candidate.startsWith(root+'/'))throw fail('该 Agent 不在这个学习工作区，不能接入课堂。',403);
  }
  async join(input){
    await this.ready;
    const {adapter='codex',sessionId,boardId,lesson}=input;
    if(!this.adapters[adapter])throw fail('这个客户端尚未安装原会话适配器；没有新建替代会话。',422);
    const validId=this.adapters[adapter].validSessionId?.(sessionId)??idPattern.test(sessionId||'');
    if(!validId||!boardPattern.test(boardId||'')||typeof lesson!=='string'||!lesson.trim()||lesson.length>256)throw fail('加入课堂需要真实会话、白板 ID 和课程标识。');
    const snapshot=await this.adapters[adapter].snapshot(sessionId);
    if(snapshot.id!==sessionId)throw fail('原会话身份不匹配。',409);
    await this.checkWorkspace(snapshot.cwd);
    const board=await this.boardLookup(boardId);if(!board)throw fail('这块白板不存在。',404);
    const room=this.data.rooms[boardId]??={boardId,lesson,title:board.title||'共享白板',agents:{},activeAgentId:null};
    const id='teacher-'+sha(adapter+'\0'+sessionId).slice(0,20),previous=room.agents[id];
    const name=(typeof input.name==='string'?input.name:snapshot.title).trim().slice(0,80)||'课堂老师';
    room.agents[id]={id,adapter,sessionId,name,joinedAt:previous?.joinedAt||new Date().toISOString(),baselineIds:previous?.baselineIds||snapshot.messages.map(m=>m.id)};
    if(!room.activeAgentId||input.activate===true){room.activeAgentId=id;room.routingRevision=(room.routingRevision||0)+1;}
    this.live.set(id,{online:true,busy:snapshot.busy});await this.save();
    return{ok:true,agentId:id,name,adapter,sessionId,boardId,lesson:room.lesson,active:room.activeAgentId===id,routingRevision:room.routingRevision||0,capabilities:this.adapters[adapter].capabilities||{sameConversation:true,receivesWhileBusy:true},note:input.activate?'已接手课堂。手机刷新状态后切到这条原对话，输入草稿保留。':'已绑定原对话。需要接手手机收件时，以相同参数加 activate:true 再调用。'};
  }
  async leave({boardId,sessionId}){
    await this.ready;const room=this.data.rooms[boardId];if(!room)return{ok:true};
    for(const [id,agent]of Object.entries(room.agents))if(agent.sessionId===sessionId){delete room.agents[id];this.live.delete(id);if(room.activeAgentId===id){room.activeAgentId=Object.keys(room.agents)[0]||null;room.routingRevision=(room.routingRevision||0)+1;}}
    await this.save();return{ok:true};
  }
  async localStatus(sessionId){
    await this.ready;return{adapters:Object.keys(this.adapters),rooms:Object.values(this.data.rooms).filter(r=>!sessionId||Object.values(r.agents).some(a=>a.sessionId===sessionId)).map(r=>({boardId:r.boardId,lesson:r.lesson,title:r.title,activeAgentId:r.activeAgentId,routingRevision:r.routingRevision||0,agents:Object.values(r.agents).map(({baselineIds,...a})=>a)}))};
  }
  async view(boardId,selected,expectedRoutingRevision){
    await this.ready;const room=this.data.rooms[boardId];
    if(!room)return{boardId,title:'共享白板',agents:[],agent:null,messages:[],deliveries:[],status:'waiting',notice:'还没有老师加入这块白板。让电脑上的 Agent 执行“加入课堂”即可。'};
    const routingRevision=room.routingRevision||0;
    const changed=expectedRoutingRevision!==undefined&&expectedRoutingRevision!==null&&Number(expectedRoutingRevision)!==routingRevision;
    const agent=room.agents[changed?room.activeAgentId:(selected||room.activeAgentId)];
    let snapshot,error;
    if(agent)try{snapshot=await this.adapters[agent.adapter].snapshot(agent.sessionId);await this.checkWorkspace(snapshot.cwd);this.live.set(agent.id,{online:true,busy:snapshot.busy});}catch(e){this.live.set(agent.id,{online:false,busy:false});error=e.status===409?'原对话尚未在电脑打开，请让该 Agent 重新加入课堂。':'老师暂未连接，请在电脑检查原对话或课堂服务。';}
    const baseline=new Set(agent?.baselineIds||[]);
    const messages=(snapshot?.messages||[]).filter(m=>!baseline.has(m.id)&&(!m.createdAtMs||m.createdAtMs>=Date.parse(agent.joinedAt))).slice(-80).map(m=>({...m,text:m.text.slice(0,30000)}));
    return{boardId,title:room.title,lesson:room.lesson,activeAgentId:room.activeAgentId,routingRevision,agents:Object.values(room.agents).map(a=>({id:a.id,name:a.name,adapter:a.adapter,...this.live.get(a.id)})),
      agent:agent?{id:agent.id,name:agent.name,adapter:agent.adapter,capabilities:this.adapters[agent.adapter]?.capabilities||{receivesWhileBusy:true}}:null,messages,
      deliveries:Object.values(this.data.deliveries).filter(d=>d.boardId===boardId).slice(-60).map(publicDelivery),
      status:!agent?'waiting':error?'offline':snapshot.pendingApproval?'approval':snapshot.busy?'working':'ready',
      notice:error||(!agent?'还没有老师加入。':snapshot.pendingApproval?'原对话正在等待确认，请在电脑处理后继续。':snapshot.error||'')};
  }
  async message(boardId,input){
    await this.ready;
    const room=this.data.rooms[boardId],agent=room?.agents[input.agentId||room.activeAgentId];
    if(!agent)throw fail('还没有老师加入这块白板。',409);
    const {requestId,text}=input;
    if(!idPattern.test(requestId||'')||typeof text!=='string'||!text.trim()||text.length>12000)throw fail('请输入 1–12000 字的消息。');
    const fingerprint=sha(JSON.stringify([boardId,agent.id,text]));
    const existing=this.data.deliveries[requestId];
    if(existing){if(existing.fingerprint!==fingerprint)throw fail('同一消息编号不能用来发送不同内容。',409);return{ok:existing.status==='delivered',delivery:publicDelivery(existing)};}
    if(input.routingRevision!==undefined&&input.routingRevision!==(room.routingRevision||0))throw Object.assign(fail('老师已切换，草稿已保留。请核对当前老师后重新发送。',409),{code:'CLASSROOM_ROUTING_CHANGED'});
    const delivery={requestId,boardId,agentId:agent.id,fingerprint,status:'sending',createdAt:new Date().toISOString()};
    this.data.deliveries[requestId]=delivery;await this.save();
    const key=agent.adapter+':'+agent.sessionId;
    const task=(this.sends.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
      try{
        const snapshot=await this.adapters[agent.adapter].snapshot(agent.sessionId);await this.checkWorkspace(snapshot.cwd);
        if(input.routingRevision!==undefined&&input.routingRevision!==(room.routingRevision||0))throw fail('老师已切换，本条未提交；请核对当前老师后重新发送。',409);
        const receipt=await this.adapters[agent.adapter].send(agent.sessionId,text,requestId);
        delivery.status='delivered';delivery.mode=receipt.mode;delivery.deliveredAt=new Date().toISOString();
      }catch(error){delivery.status=error.status===409||error.status===403?'rejected':'uncertain';delivery.diagnostic=String(error.message).slice(0,2000);delivery.error=delivery.status==='uncertain'?'未能确认原对话是否收到，请查看聊天记录后再决定是否重发。':'原对话尚未就绪或正在等待确认，请先在电脑处理。';}
      // Keep uncertain deliveries: a timeout must not silently repeat a model turn.
      await this.save();return{ok:delivery.status==='delivered',delivery:publicDelivery(delivery)};
    });
    this.sends.set(key,task);try{return await task;}finally{if(this.sends.get(key)===task)this.sends.delete(key);}
  }
  close(){for(const adapter of Object.values(this.adapters))adapter.close?.();}
}

export function createClassroomRoutes(bridge,{matches,auth,body,send,observed}){
  const loopback=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&!req.headers['x-forwarded-for']&&!req.headers.origin;
  return async(req,res,url)=>{
    if(url.pathname.startsWith('/classroom-agent/')){
      if(!auth(req))return send(res,401,{error:'需要本机 Agent 凭据。'}),true;
      if(!loopback(req))return send(res,403,{error:'接课注册只允许电脑本机 Agent 主动执行。'}),true;
      try{
        if(url.pathname==='/classroom-agent/join'&&req.method==='POST')send(res,200,await bridge.join(await body(req)));
        else if(url.pathname==='/classroom-agent/leave'&&req.method==='POST')send(res,200,await bridge.leave(await body(req)));
        else if(url.pathname==='/classroom-agent/status'&&req.method==='GET')send(res,200,await bridge.localStatus(url.searchParams.get('sessionId')));
        else send(res,404,{error:'未知接课操作。'});
      }catch(error){send(res,error.status||503,{error:error.message.split('\n')[0].slice(0,300)});}return true;
    }
    const route=/^\/classroom\/([a-z0-9][a-z0-9-]{0,63})\/([^/]+)\/(.*)$/.exec(url.pathname);
    if(!route)return false;
    const [,boardId,token,rest]=route;
    if(!matches(token))return send(res,401,{error:'无效课堂凭据。'}),true;
    try{
      if(rest==='state'&&req.method==='GET')send(res,200,await bridge.view(boardId,url.searchParams.get('agent'),url.searchParams.get('routingRevision')));
      else if(rest==='message'&&req.method==='POST'){observed(req,'classroom-message');send(res,200,await bridge.message(boardId,await body(req)));}
      else if(req.method==='GET'&&['','classroom.js','classroom.css','markdown-it.min.js'].includes(rest)){
        const filename=rest||'classroom.html';const data=await readFile(join(ROOT,'ui',filename));
        if(!rest)observed(req,'classroom-page');
        res.writeHead(200,{...privateHeaders,'Content-Type':filename.endsWith('.js')?'application/javascript; charset=utf-8':filename.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"});res.end(data);
      }else send(res,404,{error:'未找到课堂页面。'});
    }catch(error){send(res,error.status||503,{error:error.message.split('\n')[0].slice(0,300),...(error.code==='CLASSROOM_ROUTING_CHANGED'?{code:error.code}:{})});}return true;
  };
}
