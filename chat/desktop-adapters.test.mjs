import test from 'node:test';
import assert from 'node:assert/strict';
import {PiDesktopAdapter} from './pi-desktop-adapter.mjs';
import {projectAntigravity,AntigravityAdapter} from './antigravity-adapter.mjs';
import {projectMinimax,MinimaxDesktopAdapter} from './minimax-desktop-adapter.mjs';
import {callerSession} from '../classroom-mcp.mjs';
test('Host identity is adapter-specific; Codex transport session is not a chat',()=>{
 const id='11111111-1111-4111-8111-111111111111',mm='mvs_'+'a'.repeat(32);
 assert.equal(callerSession({adapter:'minimax-desktop',session_id:mm},{},true),mm);
 assert.throws(()=>callerSession({session_id:mm},{},true));
 assert.equal(callerSession({}, {sessionId:'22222222-2222-4222-8222-222222222222',threadId:id},true),id);
 assert.throws(()=>callerSession({adapter:'pi-desktop',session_id:id},{sessionId:'22222222-2222-4222-8222-222222222222'},true),/不一致/);
});
test('Antigravity and MiniMax never expose thinking, tools, or raw payloads',()=>{
 const a=projectAntigravity({status:'CASCADE_RUN_STATUS_IDLE',trajectory:{cascadeId:'self',trajectoryId:'t',steps:[{type:'CORTEX_STEP_TYPE_PLANNER_RESPONSE',plannerResponse:{response:'公开',thinking:'private',toolCalls:[{secret:'private'}]}}]}});
 assert.equal(a.messages.length,1);assert.equal(a.messages[0].text,'公开');assert.doesNotMatch(JSON.stringify(a),/private/);
 const b=projectMinimax({session:{session_id:'self',status:{status_type:0}}},{messages:[{msg_id:'1',role:'assistant',msg_type:1,msg_content:'公开',raw_json:'private'},{role:'tool',msg_type:1,msg_content:'private'},{role:'assistant',msg_type:2,msg_content:'private'}]});
 assert.equal(b.messages.length,1);assert.doesNotMatch(JSON.stringify(b),/private/);
});
test('MiniMax queues to the same session with native retry ID and no model override',async()=>{
 const id='mvs_'+'a'.repeat(32),calls=[];
 const a=new MinimaxDesktopAdapter({request:async(path,body)=>{calls.push({path,body});return path.endsWith('/queue')?{accepted:true}:path.includes('/message')?{messages:[]}:{session:{session_id:id,status:{status_type:0}}};}});
 await a.send(id,'问','idempotent-id');assert.deepEqual(calls.at(-1),{path:'session/'+id+'/queue',body:{content:'问',client_request_id:'idempotent-id'}});
});
test('Antigravity carries the complete existing user configuration into the next turn',async()=>{
 const config={plannerConfig:{planModel:'existing-model',toolConfig:{runCommand:{autoCommandConfig:{autoExecutionPolicy:'existing-policy'}}}},executorConfig:{useCoreDirect:true}};
 const calls=[],a=new AntigravityAdapter({call:async(name,args)=>{calls.push({name,args});if(name==='GetAllCascadeTrajectories')return{trajectorySummaries:{self:{}}};if(name==='GetCascadeTrajectory')return{status:'CASCADE_RUN_STATUS_IDLE',trajectory:{cascadeId:'self',steps:[{type:'CORTEX_STEP_TYPE_USER_INPUT',userInput:{items:[{text:'before'}],userConfig:config}}]}};return{};}});
 await a.send('self','next','request');assert.deepEqual(calls.at(-1),{name:'SendUserCascadeMessage',args:{cascadeId:'self',items:[{text:'next'}],cascadeConfig:config}});
});
test('PI only projects public text; preserves original session and settings',async()=>{
 const calls=[];const adapter=new PiDesktopAdapter({call:async(name,args)=>{calls.push({name,args});if(name==='pi_session_get')return{session:{id:'self',projectPath:'example-workspace',messages:[{id:'1',role:'assistant',content:'公开回复',thinking:'private'},{id:'2',role:'tool',content:'private'}]}};if(name==='pi_agent_status')return{status:{isRunning:false}};return{accepted:true};}});
 assert.deepEqual((await adapter.snapshot('self')).messages.map(m=>m.text),['公开回复']);
 await adapter.send('self','原对话提问','request');assert.deepEqual(calls.at(-1),{name:'pi_agent_prompt',args:{sessionId:'self',content:'原对话提问'}});
});
test('PI pending permission and busy turn never get interrupted',async()=>{
 for(const status of [{pendingToolConfirmations:1},{isRunning:true}]){
  const adapter=new PiDesktopAdapter({call:async n=>n==='pi_session_get'?{session:{id:'self',messages:[]}}:n==='pi_agent_status'?{status}:assert.fail('must not submit')});
  await assert.rejects(adapter.send('self','test','request'),e=>e.status===409);
 }
});
