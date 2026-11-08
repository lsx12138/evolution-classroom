import {spawn} from 'node:child_process';
import {mkdirSync,openSync,closeSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {runtimeConfig,APP_ROOT,STATE_DIR} from '../lib/runtime.mjs';
const config=runtimeConfig(),origin=`http://127.0.0.1:${config.port}`,token=readFileSync(join(STATE_DIR,'token'),'utf8').trim();
async function ready(){try{const r=await fetch(origin+'/agent/tools',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(1500)});return r.ok&&(await r.json()).tools?.length===21;}catch{return false;}}
if(await ready()){console.log('Classroom already running');process.exit(0);}
try{const r=await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)});if(r)throw Error('Port is already in use by another service or classroom. Choose new ports with npm run init.');}catch(e){if(!/fetch failed|abort|timeout/i.test(e.message))throw e;}
mkdirSync(join(APP_ROOT,'logs'),{recursive:true});const out=openSync(join(APP_ROOT,'logs/gateway.log'),'a');
try{const child=spawn(process.execPath,[join(APP_ROOT,'mobile-gateway.mjs')],{cwd:APP_ROOT,detached:true,windowsHide:true,stdio:['ignore',out,out]});child.on('error',e=>console.error(e.message));child.unref();}finally{closeSync(out);}
const deadline=Date.now()+25000;while(Date.now()<deadline){if(await ready()){console.log('Classroom started');process.exit(0);}await new Promise(resolve=>setTimeout(resolve,200));}
throw Error('Classroom did not start; inspect logs/gateway.log');
