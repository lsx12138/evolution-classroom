import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {APP_ROOT,STATE_DIR} from '../lib/runtime.mjs';
const options={};for(let i=2;i<process.argv.length;i+=2){if(!['--workspace','--port','--whiteboard-port','--public-origin'].includes(process.argv[i])||!process.argv[i+1])throw Error('Unknown or incomplete option: '+process.argv[i]);options[process.argv[i].slice(2)]=process.argv[i+1];}
await mkdir(STATE_DIR,{recursive:true,mode:0o700});
const file=join(STATE_DIR,'mobile-gateway.json');let previous;try{previous=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const workspace=resolve(options.workspace||previous?.workspace||join(APP_ROOT,'workspace'));
const port=Number(options.port||previous?.port||47429),whiteboardPort=Number(options['whiteboard-port']||previous?.whiteboardPort||47428);
for(const p of [port,whiteboardPort])if(!Number.isInteger(p)||p<1024||p>65535)throw Error('Ports must be integers from 1024 to 65535');
if(port===whiteboardPort)throw Error('Gateway and whiteboard ports must differ');
const publicOrigin=new URL(options['public-origin']||previous?.publicOrigin||`http://127.0.0.1:${port}`).origin;
const parsed=new URL(publicOrigin);if(parsed.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))throw Error('Remote access requires HTTPS. Use your own Tailscale HTTPS origin.');
const study={profileFile:'PROFILE.md',teachingModeFile:'TEACHING.md',...(previous?.study||{subjects:{math:'subjects/math',english:'subjects/english',politics:'subjects/politics',it:'subjects/it'},overviewFile:'CURRENT.md',recordFile:'records.md'})};
function safeWorkspacePath(value){
 if(typeof value!=='string'||!value||isAbsolute(value)||value.includes('\\')||value.split('/').some(p=>p==='..'||p.startsWith('_')))throw Error('Study profile paths must stay inside the learning workspace');
 const rel=relative(workspace,resolve(workspace,value));if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Study profile path escapes the learning workspace');
}
if(!study.subjects||!Object.keys(study.subjects).length)throw Error('Configure at least one subject');
for(const [key,folder]of Object.entries(study.subjects)){if(!/^[a-z][a-z0-9_-]{0,63}$/.test(key))throw Error('Invalid subject key');safeWorkspacePath(folder);}
safeWorkspacePath(study.overviewFile);if(!/^[^/\\]+\.md$/.test(study.recordFile))throw Error('Invalid study record filename');
for(const path of [study.profileFile,study.teachingModeFile]){safeWorkspacePath(path);if(!path.endsWith('.md'))throw Error('Teaching context files must be Markdown');}
async function createOnly(path,content){await mkdir(resolve(path,'..'),{recursive:true});try{await writeFile(path,content,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}}
await createOnly(join(workspace,'README.md'),'# Learning workspace\n\nYour classroom boards and study files share one local source of truth.\n');
await createOnly(join(workspace,'AGENTS.md'),'# Classroom learning rules\n\nRead CURRENT.md and the current subject before teaching. Read the board before editing. Protect student drafts. Record only real student evidence; connection tests are not learning progress. Never reveal hidden answer directories.\n');
await createOnly(join(workspace,study.overviewFile),'# Current learning task\n\nChoose a topic with the student. No progress has been assumed.\n');
await createOnly(join(workspace,study.profileFile),'# Learner profile and goals\n\nConfirm the learner\'s region, examination year, goals and constraints from their own reports. Unknown skills remain unconfirmed; do not infer zero ability.\n');
await createOnly(join(workspace,study.teachingModeFile),'# Teaching agreement\n\nThe teacher proposes a clear objective, sequence, difficulty and feedback; the learner chooses study time and workload. Use complete questions and real answers to adjust teaching. Distinguish independent work, hints, demonstrations and delayed checks. Fix specific gaps without restarting the whole subject. Tool demonstrations and prepared cards are not learning evidence.\n');
for(const folder of Object.values(study.subjects)){
 await createOnly(join(workspace,folder,'CURRENT.md'),'# Current task\n\nAwaiting a learning goal.\n');
 await createOnly(join(workspace,folder,study.recordFile),'# Learning records\n\nAppend real student evidence here.\n');
}
try{await writeFile(join(STATE_DIR,'token'),randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
const config={...previous,port,whiteboardPort,workspace,publicOrigin,defaultLesson:previous?.defaultLesson||'classroom-demo',study};
await writeFile(file,JSON.stringify(config,null,2),{mode:0o600});
await writeFile(join(STATE_DIR,'client-mcp.json'),JSON.stringify({mcpServers:{study_classroom:{command:process.execPath,args:[join(APP_ROOT,'classroom-mcp.mjs')],cwd:APP_ROOT}}},null,2),{mode:0o600});
console.log(JSON.stringify({initialized:true,workspace,gatewayPort:port,whiteboardPort,mcpConfig:join(STATE_DIR,'client-mcp.json'),next:'npm start'},null,2));
