import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import path from 'node:path';

// Original desktop owner/follower protocol adapter. Windows package and source
// hashes are pinned to the inspected version; unknown versions fail closed.

const exec=promisify(execFile),pipe='\\\\.\\pipe\\codex-ipc',maxFrame=64*1024*1024;
const fail=(message,status=503)=>Object.assign(new Error(message),{status});
const abortError=()=>Object.assign(new Error('Codex 原生连接已取消。'),{name:'AbortError'});
const versions={'thread-owner-discovery':1,'thread-follower-load-complete-history':1,'thread-follower-read-model-settings':1,'thread-follower-start-turn':2,'thread-follower-steer-turn':1,'thread-follower-interrupt-turn':4};

async function verifyProtocolArtifact(executable) {
  const file=await open(path.join(path.dirname(executable),'resources','app.asar'),'r');
  try {
    const head=Buffer.alloc(16); await file.read(head,0,16,0);
    const headerSize=head.readUInt32LE(4),jsonSize=head.readUInt32LE(12);
    if(jsonSize>16*1024*1024||headerSize<jsonSize+8)throw fail('Codex ASAR 索引格式不符合已核对版本。');
    const bytes=Buffer.alloc(jsonSize);await file.read(bytes,0,jsonSize,16);
    let member=JSON.parse(bytes.toString('utf8'));
    for(const part of ['.vite','build','early-bootstrap.js'])member=member.files?.[part];
    if(!member||member.unpacked||member.size!==595259)throw fail('Codex IPC 文件与已核对版本不一致。');
    const source=Buffer.alloc(member.size);await file.read(source,0,source.length,8+headerSize+Number(member.offset));
    if(createHash('sha256').update(source).digest('hex')!=='130d12cbaa4335cd6f21c8d281b9706c6c25f5c8be455cef1c85f57cdd5613b4')throw fail('Codex IPC 文件已更新，需要重新核对适配器。');
  } finally {await file.close();}
}
export function codexNativeId(id){if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw fail('无效的 Codex 原生对话 ID。',400);return id;}

// A Windows pipe is not identified by its name alone. Query its actual server
// PID and require this exact inspected desktop package, without starting it.
export async function attestCodexDesktopPipe(){
  if(process.platform!=='win32')throw fail('当前 Codex 桌面适配仅核对过 Windows 安装。');
  const script=`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class RelayCodexPipeOwner { [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetNamedPipeServerProcessId(SafePipeHandle h, out uint pid); }
'@
$relayPipe=[System.IO.Pipes.NamedPipeClientStream]::new('.','codex-ipc',[System.IO.Pipes.PipeDirection]::InOut)
try {$relayPipe.Connect(2000); [uint32]$relayOwnerPid=0; if(-not [RelayCodexPipeOwner]::GetNamedPipeServerProcessId($relayPipe.SafePipeHandle,[ref]$relayOwnerPid)){throw 'Pipe owner unavailable'}; $relayOwner=Get-CimInstance Win32_Process -Filter "ProcessId=$relayOwnerPid"; $signature=Get-AuthenticodeSignature -LiteralPath $relayOwner.ExecutablePath; [pscustomobject]@{pid=$relayOwnerPid;name=$relayOwner.Name;path=$relayOwner.ExecutablePath;signature=[string]$signature.Status;signer=$signature.SignerCertificate.Subject} | ConvertTo-Json -Compress}finally{$relayPipe.Dispose()}`;
  const {stdout}=await exec(process.env.STUDY_PWSH||'pwsh.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000,maxBuffer:1024*1024});
  const owner=JSON.parse(stdout.trim());
  if(owner.name!=='ChatGPT.exe'||!/[\\/]OpenAI\.Codex_26\.1103\.4239\.0_x64__2p2nqsd0c76g0[\\/]app[\\/]ChatGPT\.exe$/i.test(owner.path)||owner.signature!=='Valid'||!owner.signer?.includes('OpenAI OpCo'))throw fail('Codex 命名管道不属于已核对且签名有效的桌面版本。');
  await verifyProtocolArtifact(owner.path);
  return{pid:owner.pid,version:'26.1103.32239',packageVersion:'26.1103.4239.0',transport:'Codex desktop owner/follower IPC'};
}

export function encodeCodexIpcFrame(value){const data=Buffer.from(JSON.stringify(value));if(data.length>maxFrame)throw fail('Codex 原生帧过大。');const result=Buffer.alloc(data.length+4);result.writeUInt32LE(data.length);data.copy(result,4);return result;}
export class CodexIpcDecoder{
  constructor(onMessage){this.onMessage=onMessage;this.buffer=Buffer.alloc(0);}
  push(chunk){this.buffer=Buffer.concat([this.buffer,chunk]);while(this.buffer.length>=4){const length=this.buffer.readUInt32LE(0);if(length===0||length>maxFrame)throw fail('Codex 原生帧长度无效。');if(this.buffer.length<length+4)return;const value=JSON.parse(this.buffer.subarray(4,length+4).toString('utf8'));this.buffer=this.buffer.subarray(length+4);this.onMessage(value);}}
}

// Desktop publishes Immer JSON patches with array paths. Reject unsupported
// paths and revisions instead of combining a stale cached transcript with them.
export function applyCodexDesktopPatches(state,patches){
  if(!Array.isArray(patches))throw fail('Codex 原生状态补丁格式无效。');let next=structuredClone(state);
  for(const patch of patches){
    if(!['add','replace','remove'].includes(patch?.op)||!Array.isArray(patch.path)||patch.path.some(p=>!['string','number'].includes(typeof p)||['__proto__','prototype','constructor'].includes(p)))throw fail('Codex 原生状态补丁路径无效。');
    if(patch.path.length===0){if(patch.op!=='replace')throw fail('Codex 原生根补丁无效。');next=structuredClone(patch.value);continue;}
    let target=next;for(const key of patch.path.slice(0,-1)){if(!target||typeof target!=='object'||!Object.hasOwn(target,key))throw fail('Codex 原生补丁缺少基准。');target=target[key];}
    const key=patch.path.at(-1);if(!target||typeof target!=='object')throw fail('Codex 原生补丁目标无效。');
    if(Array.isArray(target)){if(patch.op==='add'&&key==='-'){target.push(structuredClone(patch.value));continue;}const index=typeof key==='number'?key:/^\d+$/.test(key)?Number(key):NaN;if(!Number.isSafeInteger(index)||index<0||index>(patch.op==='add'?target.length:target.length-1))throw fail('Codex 原生数组补丁越界。');if(patch.op==='add')target.splice(index,0,structuredClone(patch.value));else if(patch.op==='remove')target.splice(index,1);else target[index]=structuredClone(patch.value);}
    else if(patch.op==='remove')delete target[key];else target[key]=structuredClone(patch.value);
  }return next;
}

export class CodexDesktopIpc{
  constructor({attest=attestCodexDesktopPipe,connect=()=>net.createConnection(pipe)}={}){this.attest=attest;this.createSocket=connect;this.pending=new Map();this.entries=new Map();this.closed=false;this.clientId=null;this.sweeper=setInterval(()=>{for(const entry of [...this.entries.values()])if(!entry.listeners.size&&!entry.loading&&Date.now()-entry.touchedAt>180000)this.invalidate(entry,fail('Codex 原生观察缓存已释放。'));},60000).unref();}
  async connect(){
    if(this.closed)throw fail('Codex 原生 IPC 已关闭。');if(this.clientId&&this.socket&&!this.socket.destroyed)return;if(this.connecting)return this.connecting;
    this.connecting=(async()=>{this.identity=await this.attest();if(this.closed)throw fail('Codex 原生 IPC 已关闭。');const socket=this.createSocket();this.socket=socket;
      const decoder=new CodexIpcDecoder(message=>this.handle(message));socket.on('data',chunk=>{if(this.socket!==socket)return;try{decoder.push(chunk);}catch(e){this.disconnect(e);socket.destroy();}});socket.on('error',e=>{if(this.socket===socket)this.disconnect(e);});socket.on('close',()=>{if(this.socket===socket)this.disconnect(fail('Codex 桌面 IPC 已断开。'));});
      await new Promise((resolve,reject)=>{const t=setTimeout(()=>{socket.destroy();reject(fail('等待 Codex 桌面 IPC 超时。'));},3000);socket.once('connect',()=>{clearTimeout(t);resolve();});socket.once('error',e=>{clearTimeout(t);reject(e);});});
      const initialized=await this.send('initialize',{clientType:'relay'},{});this.clientId=initialized.result.clientId;
    })().catch(error=>{this.socket?.destroy();throw error;}).finally(()=>{this.connecting=null;});return this.connecting;
  }
  write(value){if(!this.socket||this.socket.destroyed)throw fail('Codex 桌面 IPC 未连接。');this.socket.write(encodeCodexIpcFrame(value));}
  send(method,params,{targetClientId,timeoutMs=15000,signal}={}){
    if(signal?.aborted)return Promise.reject(abortError());if(method!=='initialize'&&!Object.hasOwn(versions,method))return Promise.reject(fail('未开放的 Codex 桌面 IPC 请求。',400));
    return new Promise((resolve,reject)=>{const requestId=randomUUID(),abort=()=>finish(abortError());let timer;
      const finish=(error,value)=>{clearTimeout(timer);this.pending.delete(requestId);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
      this.pending.set(requestId,{finish});timer=setTimeout(()=>finish(fail('等待 Codex 桌面原 owner 响应超时。',504)),timeoutMs);signal?.addEventListener('abort',abort,{once:true});
      try{this.write({type:'request',requestId,sourceClientId:this.clientId||'initializing-client',method,params,version:method==='initialize'?0:versions[method],targetClientId,timeoutMs});}catch(error){finish(error);}
    });
  }
  handle(message){
    if(message.type==='response'){const p=this.pending.get(message.requestId);if(!p)return;if(message.resultType!=='success')p.finish(fail(message.error==='no-client-found'?'这个 Codex 对话尚未由桌面原 owner 加载。':`Codex 桌面原 owner：${typeof message.error==='string'?message.error:JSON.stringify(message.error)}`,message.error==='no-client-found'?409:503));else p.finish(null,message);return;}
    if(message.type==='client-discovery-request'){this.write({type:'client-discovery-response',requestId:message.requestId,response:{canHandle:false}});return;}
    if(message.type!=='broadcast')return;
    if(message.method==='client-status-changed'&&message.params?.status==='disconnected'){for(const entry of this.entries.values())if(entry.owner===message.params.clientId)this.invalidate(entry,fail('Codex 对话的桌面原 owner 已断开。'));return;}
    const p=message.params;if(p?.hostId!=='local')return;const entry=this.entries.get(p.conversationId);if(!entry||message.sourceClientId!==entry.owner)return;
    if(message.method==='thread-archived'){this.invalidate(entry,fail('Codex 原生对话已归档。',410));return;}
    if(message.method!=='thread-stream-state-changed')return;
    if(message.version!==11){this.invalidate(entry,fail('Codex 桌面状态协议版本已变化。'));return;}
    try{
      const change=p.change;if(!change||!Number.isSafeInteger(change.revision))throw fail('Codex 原生状态版本无效。');
      if(change.type==='snapshot'){if(change.conversationState?.id!==entry.id)throw fail('Codex 原生快照 ID 不匹配。');entry.state=change.conversationState;entry.revision=change.revision;}
      else if(change.type==='patches'){if(!entry.state||change.baseRevision!==entry.revision){entry.state=null;entry.revision=null;this.following(entry,true);return;}entry.state=applyCodexDesktopPatches(entry.state,change.patches);entry.revision=change.revision;}
      else throw fail('未知的 Codex 原生状态更新。');
      if(entry.state.id!==entry.id)throw fail('Codex 原生补丁改变了对话 ID。');entry.checkedAt=Date.now();for(const listener of entry.listeners)listener.onChange?.(message);for(const waiter of [...entry.waiters])waiter.check();
    }catch(error){entry.state=null;entry.revision=null;for(const listener of entry.listeners)listener.onError?.(error);this.following(entry,true);}
  }
  following(entry,following){this.write({type:'broadcast',method:'thread-stream-following-changed',version:1,sourceClientId:this.clientId,targetClientIds:[entry.owner],params:{hostId:'local',conversationId:entry.id,following}});}
  async findOwner(id,{signal}={}){codexNativeId(id);await this.connect();const response=await this.send('thread-owner-discovery',{hostId:'local',conversationId:id},{signal});if(!response.handledByClientId)throw fail('Codex 原生 owner 未返回身份。');return response.handledByClientId;}
  waitSnapshot(entry,{revision=0,signal,timeoutMs=15000}={}){
    if(signal?.aborted)return Promise.reject(abortError());if(entry.state&&entry.revision>=revision)return Promise.resolve(entry.state);
    return new Promise((resolve,reject)=>{let timer;const abort=()=>finish(abortError()),finish=(error)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);entry.waiters.delete(waiter);error?reject(error):resolve(entry.state);},waiter={check:()=>{if(entry.state&&entry.revision>=revision)finish();},reject:finish};entry.waiters.add(waiter);timer=setTimeout(()=>finish(fail('等待 Codex 桌面权威快照超时。',504)),timeoutMs);signal?.addEventListener('abort',abort,{once:true});});
  }
  async follow(id,{signal,complete=true}={}){
    codexNativeId(id);await this.connect();let entry=this.entries.get(id);if(entry?.loading)return entry.loading;
    if(entry?.state){entry.touchedAt=Date.now();return entry;}
    if(entry?.owner){await this.waitSnapshot(entry,{signal});entry.touchedAt=Date.now();return entry;}
    if(this.entries.size>=8){const evict=[...this.entries.values()].filter(e=>!e.listeners.size&&!e.loading).sort((a,b)=>a.touchedAt-b.touchedAt)[0];if(evict)this.invalidate(evict,fail('Codex 原生观察缓存已释放。'));}
    entry={id,state:null,revision:null,owner:null,listeners:new Set(),waiters:new Set(),touchedAt:Date.now()};this.entries.set(id,entry);
    entry.loading=(async()=>{try{entry.owner=await this.findOwner(id,{signal});this.following(entry,true);await this.waitSnapshot(entry,{signal});if(complete){const response=await this.send('thread-follower-load-complete-history',{conversationId:id},{targetClientId:entry.owner,timeoutMs:30000,signal});await this.waitSnapshot(entry,{revision:response.result?.revision??entry.revision,signal,timeoutMs:30000});}return entry;}catch(error){this.invalidate(entry,error);throw error;}finally{entry.loading=null;}})();
    return entry.loading;
  }
  async snapshot(id,options={}){const entry=await this.follow(id,options);return{state:entry.state,ownerClientId:entry.owner,revision:entry.revision,transportIdentity:this.identity};}
  async requestOwner(id,method,params,{signal,timeoutMs}={}){const entry=await this.follow(id,{signal});const current=await this.findOwner(id,{signal});if(current!==entry.owner)throw fail('Codex 桌面 owner 已变化，请刷新后再试。',409);const response=await this.send(method,{conversationId:id,...params},{targetClientId:entry.owner,signal,timeoutMs});if(response.handledByClientId!==entry.owner)throw fail('Codex 请求未由绑定的原 owner 处理。');return response.result;}
  async watch(id,{signal,onChange,onReady}={}){const entry=await this.follow(id,{signal});if(signal?.aborted)return;await new Promise((resolve,reject)=>{const abort=()=>finish(),finish=error=>{entry.listeners.delete(listener);signal?.removeEventListener('abort',abort);error?reject(error):resolve();},listener={onChange,onError:finish};entry.listeners.add(listener);signal?.addEventListener('abort',abort,{once:true});onReady?.();if(signal?.aborted)finish();});}
  invalidate(entry,error){this.entries.delete(entry.id);for(const waiter of [...entry.waiters])waiter.reject(error);for(const listener of [...entry.listeners])listener.onError?.(error);if(entry.owner&&this.clientId&&this.socket&&!this.socket.destroyed)try{this.following(entry,false);}catch{}}
  disconnect(error){this.clientId=null;for(const p of [...this.pending.values()])p.finish(error);for(const entry of [...this.entries.values()])this.invalidate(entry,error);}
  close(){this.closed=true;clearInterval(this.sweeper);for(const entry of this.entries.values())if(entry.owner&&this.clientId)try{this.following(entry,false);}catch{}this.disconnect(fail('Codex 原生观察器已关闭。'));this.socket?.destroy();}
}
