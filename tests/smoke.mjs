import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const exec=promisify(execFile),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temporary=await mkdtemp(join(tmpdir(),'evolution-classroom-smoke-'));
const state=join(temporary,'state'),workspace=join(temporary,'workspace');
const env={...process.env,STUDY_CLASSROOM_STATE:state};
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const gatewayPort=await port();let whiteboardPort=await port();while(whiteboardPort===gatewayPort)whiteboardPort=await port();
let child,ws,local,remote,stderr='';
try{
 await exec(process.execPath,['scripts/init.mjs','--workspace',workspace,'--port',String(gatewayPort),'--whiteboard-port',String(whiteboardPort)],{cwd:root,env,windowsHide:true});
 const token=(await readFile(join(state,'token'),'utf8')).trim();assert.match(token,/^[a-f0-9]{64}$/);
 const config=JSON.parse(await readFile(join(state,'mobile-gateway.json'),'utf8'));
 assert.equal(config.workspace,workspace);
 await exec(process.execPath,['scripts/init.mjs'],{cwd:root,env,windowsHide:true});assert.equal((await readFile(join(state,'token'),'utf8')).trim(),token,'Re-initialization must preserve local credentials');
 child=spawn(process.execPath,['mobile-gateway.mjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',()=>{});child.stderr.on('data',d=>stderr+=d.toString());
 const origin=`http://127.0.0.1:${gatewayPort}`,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 let healthy=false;const deadline=Date.now()+25000;
 while(Date.now()<deadline){try{const r=await fetch(origin+'/health');if(r.ok&&(await r.json()).upstreamReady){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
 assert.ok(healthy,stderr);
 assert.equal((await fetch(origin+'/agent/tools')).status,401);
 assert.equal((await fetch(origin+'/agent/tools',{headers:{...headers,Origin:'https://untrusted.invalid'}})).status,403);
 const tools=await(await fetch(origin+'/agent/tools',{headers})).json();assert.equal(tools.tools.length,21);
 async function call(name,args={}){const r=await fetch(origin+'/agent/call',{method:'POST',headers,body:JSON.stringify({name,arguments:args,lesson:'smoke'})});assert.equal(r.status,200);const d=await r.json();assert.ok(!d.isError,JSON.stringify(d));return d;}
 const context=await call('study_context',{subject:'math'});assert.match(context.structuredContent.subjects.math.current.content,/Awaiting/);
 const evidence={subject:'math',request_id:'synthetic-smoke-0001',student_evidence:'Synthetic test fixture',summary:'Not a real learning record',source:'desktop'};
 const replies=await Promise.all([call('study_append_record',evidence),call('study_append_record',evidence)]);assert.equal(replies.filter(r=>r.structuredContent.duplicate).length,1);
 const hidden=await(await fetch(origin+'/agent/call',{method:'POST',headers,body:JSON.stringify({name:'study_read_file',arguments:{path:'../README.md'}})})).json();assert.equal(hidden.isError,true);
 const opened=await call('canvas_open',{title:'Synthetic smoke board'});const id=opened.content[0].text.match(/\[([a-z0-9][a-z0-9-]+)\]/)?.[1];assert.ok(id);
 const page=`${origin}/classroom/${id}/${token}/`;
 assert.match(await(await fetch(page)).text(),/fullscreen-chat/);
 assert.equal((await fetch(`${origin}/classroom/${id}/invalid/`)).status,401);
 const scenePath=`/c/${id}/${token}/`;assert.match(await(await fetch(origin+scenePath)).text(),/whiteboard-canvas/);
 ws=new WebSocket(origin.replace('http:','ws:')+scenePath+'ws',{origin});const incoming=[];ws.on('message',d=>incoming.push(JSON.parse(d)));await once(ws,'open');
 await call('canvas_draw',{elements:[{id:'smoke-marker',type:'text',x:0,y:0,text:'Portable classroom smoke fixture',fontFamily:'normal'}]});
 const until=Date.now()+4000;while(!JSON.stringify(incoming).includes('Portable classroom smoke fixture')&&Date.now()<until)await new Promise(r=>setTimeout(r,25));
 assert.match(JSON.stringify(incoming),/Portable classroom smoke fixture/);
 await call('canvas_save',{name:'Synthetic snapshot'});
 local=new Client({name:'isolated-smoke',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'classroom-mcp.mjs')],cwd:root,env,stderr:'pipe'});transport.stderr?.on('data',()=>{});
 await local.connect(transport);assert.equal((await local.listTools()).tools.length,25);
 assert.ok(!(await local.callTool({name:'classroom_status',arguments:{}})).isError);
 assert.match(JSON.stringify(await local.callTool({name:'canvas_read',arguments:{lesson:'smoke'}})),/Portable classroom smoke fixture/);
 remote=new Client({name:'isolated-remote-smoke',version:'1'});
 await remote.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers}}));assert.equal((await remote.listTools()).tools.length,21);
 assert.ok(!(await remote.callTool({name:'study_context',arguments:{subject:'math'}})).isError);
 const math=await remote.callTool({name:'math_verify',arguments:{operation:'equivalent',expression:'x/x',other:'1'}});assert.equal(math.structuredContent.same_domain,false);
 const panel=await remote.callTool({name:'teaching_panel',arguments:{}});assert.ok(!panel.isError);assert.equal((await fetch(panel.structuredContent.url)).status,200);
 assert.equal((await fetch(origin+'/learning-tools/wrong/')).status,401);
 const html=await(await fetch(origin+scenePath)).text();const entry=html.match(/src="([^"]+index-[^"]+\.js)"/);assert.ok(entry);
 const source=await(await fetch(new URL(entry[1],origin+scenePath))).text();assert.match(source,/__StudyMouseTools/);
 const mouseUrl=new URL('./study-mouse-tools.js',new URL(entry[1],origin+scenePath));assert.equal((await fetch(mouseUrl)).status,200);
 console.log(JSON.stringify({ok:true,freshInitialization:true,uniqueCredentials:true,credentialPreserved:true,localMcpTools:25,remoteMcpTools:21,authenticatedGateway:true,sharedStudyFiles:true,appendRetryDedup:true,pathIsolation:true,liveWhiteboard:true,websocketRoundTrip:true,snapshot:true,realDesktopMessageSent:false}));
}finally{
 await local?.close().catch(()=>{});await remote?.close().catch(()=>{});ws?.terminate();
 if(child){child.kill();await Promise.race([once(child,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);}
 try{await exec(process.execPath,['whiteboard.mjs','stop'],{cwd:root,env,windowsHide:true,timeout:8000});}catch{}
 const absolute=await realpath(temporary);assert.equal(dirname(absolute),await realpath(tmpdir()));assert.ok(basename(absolute).startsWith('evolution-classroom-smoke-'));
 await rm(absolute,{recursive:true,force:true});
}
