import {readFile} from 'node:fs/promises';
import {runtimeConfig,STATE_DIR} from './lib/runtime.mjs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),command=args.shift()||'help',options={};
for(let i=0;i<args.length;i++){if(!args[i].startsWith('--'))throw new Error('参数请使用 --名称 值。');const key=args[i].slice(2);options[key]=key==='activate'?true:args[++i];}
if(command==='help'||command==='--help'){
  console.log('课堂消息桥：沿用当前桌面原对话。\njoin --lesson <课程标识> [--name <老师名>] [--adapter <客户端>] [--thread <自身会话ID>] [--activate]\nstatus\nleave --board <白板ID>\n默认从 CODEX_THREAD_ID 识别当前 Codex 会话；其他客户端需安装对应原会话适配器。');
}else{
  const config=runtimeConfig();
  const token=(await readFile(join(STATE_DIR,'token'),'utf8')).trim();
  const origin=`http://127.0.0.1:${config.port}`;
  const sessionId=options.thread||process.env.CODEX_THREAD_ID;
  const adapter=options.adapter||(process.env.CODEX_THREAD_ID?'codex':null);
  if(!sessionId)throw new Error('无法识别原对话 ID。请在需要接课的 Agent 对话中执行；不要另建替代会话。');
  let endpoint,payload;
  if(command==='join'){
    if(!options.lesson)throw new Error('请用 --lesson 指定要接续的课程。');
    if(!adapter)throw new Error('该客户端需要明确的原会话适配器，目前可用：codex、pi-desktop、minimax-desktop、antigravity。');
    const result=spawnSync(process.execPath,[join(root,'whiteboard.mjs'),'--session',options.lesson,'url'],{encoding:'utf8',windowsHide:true});
    if(result.status!==0)throw new Error('无法获取本课程白板：'+result.stderr);
    const boardUrl=new URL(result.stdout.trim().split(/\r?\n/).at(-1)),boardId=boardUrl.pathname.split('/')[2];
    endpoint='/classroom-agent/join';payload={adapter,sessionId,boardId,lesson:options.lesson,name:options.name,activate:options.activate===true};
  }else if(command==='leave'){endpoint='/classroom-agent/leave';payload={sessionId,boardId:options.board};if(!payload.boardId)throw new Error('请指定 --board。');}
  else if(command==='status')endpoint='/classroom-agent/status?sessionId='+encodeURIComponent(sessionId);
  else throw new Error('未知命令，请运行 help。');
  const response=await fetch(origin+endpoint,{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(30000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'课堂连接失败');
  if(command==='join'){data.desktopUrl=`${origin}/classroom/${data.boardId}/${token}/`;data.phoneEntry='手机 App 0.2.0 及以上打开同一块板，即可在“问老师”里发消息。';}
  console.log(JSON.stringify(data,null,2));
}
