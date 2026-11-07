import {readFile} from 'node:fs/promises';
import {STATE_DIR} from '../lib/runtime.mjs';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),fail=(message,status=503)=>Object.assign(new Error(message),{status});
export function projectMinimax({session:s},data){
 if(!s?.session_id)throw fail('MiniMax 桌面原会话不存在。',409);
 return{id:s.session_id,cwd:s.workspace_dir,title:s.title,busy:s.status?.status_type!==0,pendingApproval:false,messages:(data.messages||[])
  .filter(m=>['user','assistant'].includes(m.role)&&m.msg_type===1&&typeof m.msg_content==='string'&&m.msg_content.trim())
  .map(m=>({id:m.msg_id,role:m.role,text:m.msg_content,createdAtMs:m.timestamp}))};
}
export class MinimaxDesktopAdapter{
 capabilities={sameConversation:true,receivesWhileBusy:false};
 validSessionId(id){return /^mvs_[a-f0-9]{32}$/.test(id||'');}
 constructor({request,manifest=join(STATE_DIR,'minimax-desktop-endpoint.json')}={}){this.requestOverride=request;this.manifest=manifest;}
 async endpoint(){
  const c=JSON.parse(await readFile(this.manifest,'utf8'));
  if(c.owner!=='electron'||c.host!=='127.0.0.1'||!Number.isInteger(c.port)||!Number.isInteger(c.pid))throw fail('MiniMax 桌面接口标识无效。');
  if(this.checked!==c.pid){
   const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process -Filter 'ProcessId=${c.pid}' | Select-Object ExecutablePath | ConvertTo-Json -Compress`],{windowsHide:true,timeout:5000});
   if(!/\\Programs\\MiniMax Code\\MiniMax Code\.exe$/i.test(JSON.parse(stdout)?.ExecutablePath||''))throw fail('MiniMax 桌面进程已退出。');this.checked=c.pid;
  }
  return 'http://127.0.0.1:'+c.port;
 }
 async request(path,body){
  if(this.requestOverride)return this.requestOverride(path,body);
  const r=await fetch(await this.endpoint()+'/minimax-desktop/api/v1/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
  const d=await r.json();if(!r.ok||d.error||d.base_resp?.status_code)throw fail('MiniMax 桌面未接受请求（'+r.status+'）。',r.status>=400&&r.status<500?409:503);return d;
 }
 async snapshot(id){if(!this.validSessionId(id))throw fail('MiniMax 会话 ID 无效。',409);const [s,m]=await Promise.all([this.request('session/'+id),this.request('session/'+id+'/message?limit=200')]);if(s.session?.session_id!==id)throw fail('MiniMax 会话身份不一致。',409);return projectMinimax(s,m);}
 async send(id,text,requestId){
  const s=await this.snapshot(id);if(s.busy)throw fail('MiniMax 正在处理或等待确认，请等本轮结束。',409);
  const r=await this.request('session/'+id+'/queue',{content:text,client_request_id:requestId});
  return{mode:'desktop-queue',requestId,receipt:r};
 }
}
