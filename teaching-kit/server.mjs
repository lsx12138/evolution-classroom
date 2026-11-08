import http from 'node:http';
import {readFile,writeFile,mkdir,realpath,open,unlink} from 'node:fs/promises';
import {join,resolve,sep,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {createTeachingKit,TOOL_ROOT,KIT_ROOT} from './tools.mjs';

const mime={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.wasm':'application/wasm','.txt':'text/plain','.properties':'text/plain'};
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
async function body(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw new Error('请求过大。');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
const same=(a,b)=>typeof a==='string'&&timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};

export function createTeachingRoutes(kit,{matches}){
  return async(req,res,url)=>{
    const match=/^\/learning-tools\/([^/]+)\/(.*)$/.exec(url.pathname);
    if(!match)return false;
    if(!matches(match[1])){json(res,401,{error:'教学工具访问凭据无效。'});return true;}
    try{
      const rest=decodeURIComponent(match[2]);
      if(rest==='api/state'&&req.method==='GET'){
        const activityId=url.searchParams.get('activity'),graphId=url.searchParams.get('graph');
        json(res,200,{activities:await kit.list('activities'),graphs:await kit.list('graphs'),activity:activityId?await kit.activity({action:'get',id:activityId}):null,graph:graphId?await kit.graph({action:'get',id:graphId}):null});return true;
      }
      if(rest==='api/submit'&&req.method==='POST'){
        const data=await body(req);
        json(res,200,await kit.call('classroom_activity',{...data,action:'submit',source:'student_panel'}));return true;
      }
      if(rest==='api/plot'&&req.method==='POST'){
        const data=await body(req);
        json(res,200,await kit.math({...data,operation:'plot'}));return true;
      }
      if(req.method!=='GET'){json(res,405,{error:'不支持该操作。'});return true;}
      let asset,base;
      if(rest.startsWith('mathlive/')){base=join(TOOL_ROOT,'node_modules','mathlive');asset=rest.slice(9);}
      else if(rest.startsWith('geogebra/')){base=join(KIT_ROOT,'vendor','geogebra','GeoGebra');asset=rest.slice(9);}
      else if(['','app.js','style.css'].includes(rest)){base=join(KIT_ROOT,'ui');asset=rest||'index.html';}
      else{json(res,404,{error:'工具页面不存在。'});return true;}
      const actualBase=await realpath(base),path=await realpath(resolve(base,asset));
      if(!path.startsWith(actualBase+sep)||asset.includes(':')||asset.includes('\\'))throw new Error('无效资源路径。');
      const extension=path.slice(path.lastIndexOf('.')).toLowerCase();
      const data=await readFile(path);
      res.writeHead(200,{...headers,'Content-Type':(mime[extension]||'application/octet-stream')+(extension==='.html'?'; charset=utf-8':''),'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"});
      res.end(data);
    }catch(error){json(res,error.code==='ENOENT'?404:400,{error:error.message.slice(0,350)});}
    return true;
  };
}

export async function startPanel({state,port=0}){
  await mkdir(state,{recursive:true});
  const lock=join(state,'panel-start.lock');
  let handle;try{handle=await open(lock,'wx');}catch(e){if(e.code==='EEXIST')return null;throw e;}
  try{
    try{
      const old=JSON.parse(await readFile(join(state,'panel.json'),'utf8'));
      const reply=await fetch(old.origin+'/health',{signal:AbortSignal.timeout(600)});
      if((await reply.json()).instance===old.instance)return null;
    }catch{}
    const token=randomBytes(32).toString('hex'),instance=randomUUID(),kit=createTeachingKit({state});
    const routes=createTeachingRoutes(kit,{matches:value=>same(value,token)});
    const server=http.createServer(async(req,res)=>{
      const origin='http://127.0.0.1:'+server.address().port;
      if(![new URL(origin).host,'localhost:'+server.address().port].includes(req.headers.host)||req.headers.origin&&![origin,'http://localhost:'+server.address().port].includes(req.headers.origin)){json(res,403,{error:'来源不允许。'});return;}
      const url=new URL(req.url,origin);
      if(url.pathname==='/health'){json(res,200,{ok:true,app:'study-teaching-kit',version:'1.0.0',instance});return;}
      if(!await routes(req,res,url))json(res,404,{error:'使用完整教学工具链接。'});
    });
    await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
    const config={origin:'http://127.0.0.1:'+server.address().port,token,instance,pid:process.pid};
    await writeFile(join(state,'panel.json'),JSON.stringify(config),{mode:0o600});
    return {server,config,kit};
  }finally{await handle.close();await unlink(lock).catch(()=>{});}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const idx=process.argv.indexOf('--state');
  await startPanel({state:idx<0?join(resolve(process.env.STUDY_CLASSROOM_STATE||join(TOOL_ROOT,'state')),'teaching-kit'):resolve(process.argv[idx+1])});
}
