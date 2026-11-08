import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createTeachingKit,TOOL_ROOT,teachingTools} from './tools.mjs';
const args=process.argv.slice(2),name=args[0],index=args.indexOf('--file'),verification=args.includes('--verification');
try{
  if(!name||name==='tools'){console.log(JSON.stringify(teachingTools,null,2));}
  else{
    const input=index>=0?JSON.parse((await readFile(args[index+1],'utf8')).replace(/^\uFEFF/,'')):{};
    if(verification&&name==='classroom_activity'&&input.action==='create')input.purpose='verification';
    const kit=createTeachingKit(verification?{state:join(resolve(process.env.STUDY_CLASSROOM_STATE||join(TOOL_ROOT,'state')),'teaching-kit-verification')}:{});
    console.log(JSON.stringify(await kit.call(name,input),null,2));
  }
}catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
