import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),fail=(message,status=503)=>Object.assign(new Error(message),{status});
export function projectAntigravity(data,summary={}){
 const t=data.trajectory;if(!t?.cascadeId)throw fail('Antigravity 原会话不存在。',409);
 const uri=t.metadata?.workspaces?.[0]?.workspaceFolderAbsoluteUri||summary.workspaces?.[0]?.workspaceFolderAbsoluteUri;
 const messages=[];
 for(const [i,s]of (t.steps||[]).entries()){
  let text,role;
  if(s.type==='CORTEX_STEP_TYPE_USER_INPUT'){role='user';text=(s.userInput?.items||[]).map(x=>x.text||'').join('\n')||s.userInput?.userResponse;}
  if(s.type==='CORTEX_STEP_TYPE_PLANNER_RESPONSE'){role='assistant';text=s.plannerResponse?.modifiedResponse||s.plannerResponse?.response;}
  if(typeof text==='string'&&text.trim())messages.push({id:t.trajectoryId+':'+i,role,text,createdAtMs:Date.parse(s.metadata?.createdAt)||undefined});
 }
 return{id:t.cascadeId,cwd:uri?fileURLToPath(uri):undefined,title:summary.summary||'Antigravity',busy:data.status!=='CASCADE_RUN_STATUS_IDLE',pendingApproval:(t.steps||[]).slice(-5).some(s=>/WAITING.*(USER|CONFIRM|APPROV)/.test(s.status||'')),messages};
}
export class AntigravityAdapter{
 capabilities={sameConversation:true,receivesWhileBusy:false};
 constructor({call,directory=join(homedir(),'.gemini/antigravity/daemon')}={}){this.callOverride=call;this.directory=directory;this.configs=new Map();}
 async endpoint(){
  if(this.cached&&Date.now()-this.cached.at<5000)return this.cached;
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process -Filter \"Name='language_server.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"],{windowsHide:true,timeout:6000});
  const reported=stdout.trim()?JSON.parse(stdout):[];
  const processes=reported?[reported].flat():[];
  for(const file of await readdir(this.directory))if(/^hub_\d+\.json$/.test(file)){
   let c;try{c=JSON.parse(await readFile(join(this.directory,file),'utf8'));}catch{continue;}
   if(!processes.some(p=>p.ProcessId===c.pid&&/\\Programs\\antigravity\\resources\\bin\\language_server\.exe$/i.test(p.ExecutablePath||'')))continue;
   if(c.lsVersion!=='2.29.0')throw fail('Antigravity 已更新，需要核对桌面接口版本后再连接。',409);
   if(Number.isInteger(c.httpPort)&&c.csrfToken)return this.cached={...c,at:Date.now()};
  }
  throw fail('Antigravity 桌面未连接。');
 }
 async call(method,body){
  if(this.callOverride)return this.callOverride(method,body);
  const c=await this.endpoint();const res=await fetch(`http://127.0.0.1:${c.httpPort}/exa.language_server_pb.LanguageServerService/${method}`,{method:'POST',headers:{'Content-Type':'application/json','x-codeium-csrf-token':c.csrfToken},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  if(!res.ok)throw fail('Antigravity 接口未接受请求（'+res.status+'）。',res.status===400?409:503);
  return res.json();
 }
 async snapshot(id){
  const summaries=await this.call('GetAllCascadeTrajectories',{});const s=summaries.trajectorySummaries?.[id];if(!s)throw fail('Antigravity 原会话未找到。',409);
  const data=await this.call('GetCascadeTrajectory',{cascadeId:id});const snapshot=projectAntigravity(data,s);if(snapshot.id!==id)throw fail('Antigravity 原会话身份不匹配。',409);
  const config=[...(data.trajectory.steps||[])].reverse().find(s=>s.type==='CORTEX_STEP_TYPE_USER_INPUT')?.userInput?.userConfig;
  if(config)this.configs.set(id,config);else this.configs.delete(id);
  return snapshot;
 }
 async send(id,text,requestId){
  const s=await this.snapshot(id);if(s.pendingApproval||s.busy)throw fail('Antigravity 正在处理或等待确认，请等本轮结束。',409);
  const cascadeConfig=this.configs.get(id);if(!cascadeConfig)throw fail('无法确认原会话配置，请先在 Antigravity 桌面发送一次消息。',409);
  await this.call('SendUserCascadeMessage',{cascadeId:id,items:[{text}],cascadeConfig});return{mode:'desktop-original-session',requestId};
 }
}
