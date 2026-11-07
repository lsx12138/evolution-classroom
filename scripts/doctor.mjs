import {runtimeConfig} from '../lib/runtime.mjs';
const config=runtimeConfig();let health;
try{const r=await fetch(`http://127.0.0.1:${config.port}/health`,{signal:AbortSignal.timeout(3000)});health=await r.json();}catch{health={ok:false,error:'Service not running. Run npm start.'};}
console.log(JSON.stringify({node:process.version,platform:process.platform,workspace:config.workspace,health,desktopAdapters:'Windows versions documented in docs/COMPATIBILITY.md. MCP availability is separate from original-chat delivery.'},null,2));
if(!health.ok)process.exitCode=1;
