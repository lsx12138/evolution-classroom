import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const APP_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const STATE_DIR=resolve(process.env.STUDY_CLASSROOM_STATE||join(APP_ROOT,'state'));
export function runtimeConfig(){
 let config;
 try{config=JSON.parse(readFileSync(join(STATE_DIR,'mobile-gateway.json'),'utf8'));}
 catch{throw new Error('Classroom is not initialized. Run npm run init, or ask your agent to follow AGENT_SETUP_PROMPT.md.');}
 for(const key of ['port','whiteboardPort'])if(!Number.isInteger(config[key])||config[key]<1024||config[key]>65535)throw new Error('Invalid '+key);
 return{...config,workspace:resolve(APP_ROOT,config.workspace),state:STATE_DIR};
}
