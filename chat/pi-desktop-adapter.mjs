import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const fail=(message,status=503)=>Object.assign(new Error(message),{status});
export class PiDesktopAdapter {
  capabilities={sameConversation:true,receivesWhileBusy:false};
  constructor({call,config=join(homedir(),'.pi-desktop/mcp-control.json')}={}){this.config=config;this.callOverride=call;}
  async call(name,args){
    if(this.callOverride)return this.callOverride(name,args);
    const cfg=JSON.parse(await readFile(this.config,'utf8')),url=new URL(cfg.url);
    if(!cfg.active||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!cfg.token)throw fail('PI-Desktop 本机控制接口未开启。');
    const c=new Client({name:'study-classroom',version:'1.1.0'});
    try{
      await c.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+cfg.token}}}),{timeout:8000});
      const r=await c.callTool({name,arguments:args},undefined,{timeout:15000});
      if(r.isError)throw fail('PI-Desktop 拒绝操作：'+(r.content?.find(x=>x.type==='text')?.text||'接口错误').slice(0,300));
      return r.structuredContent||JSON.parse(r.content.find(x=>x.type==='text').text);
    }finally{await c.close().catch(()=>{});}
  }
  async snapshot(id){
    const [{session:s},{status:t}]=await Promise.all([this.call('pi_session_get',{id,messageLimit:200,contentLimit:30000}),this.call('pi_agent_status',{sessionId:id})]);
    if(s?.id!==id)throw fail('PI-Desktop 原会话不存在。',409);
    return{id:s.id,title:s.title,cwd:s.projectPath,busy:!!t?.isRunning,pendingApproval:!!t?.pendingToolConfirmations||t?.planningState==='awaiting_approval',
      messages:(s.messages||[]).filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.trim()).map(m=>({id:m.id,role:m.role,text:m.content,createdAtMs:Date.parse(m.createdAt)||undefined}))};
  }
  async send(id,text,requestId){
    const before=await this.snapshot(id);
    if(before.pendingApproval)throw fail('原对话正在等待确认，请在 PI-Desktop 处理。',409);
    // Do not guess whether a host queues or interrupts while working.
    if(before.busy)throw fail('PI-Desktop 老师正在回复，请等本轮结束后再发送。',409);
    const receipt=await this.call('pi_agent_prompt',{sessionId:id,content:text});
    if(receipt?.error||receipt?.ok===false)throw fail('PI-Desktop 未接受消息。',409);
    return{mode:'desktop-original-session',requestId};
  }
}
