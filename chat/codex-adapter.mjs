import {CodexDesktopIpc,codexNativeId} from './codex-ipc.mjs';

function displayUserText(text){
  const match=/^\s*<send_user_message_question_reply>([\s\S]*)<\/send_user_message_question_reply>\s*$/.exec(text);
  if(match)try{const answers=JSON.parse(match[1]);if(Array.isArray(answers))return answers.map(item=>'反馈：'+String(item.answer??'')).join('\n');}catch{}
  return text;
}

export function nativeTurns(state) {
  if(state.turnHistory?.kind!=='canonical')return state.turns||[];
  const history=state.turnHistory.history;
  if(!Array.isArray(history?.islands)||!history.entitiesByKey)throw new Error('原会话历史格式已改变。');
  const seen=new Set(),result=[];
  for(const island of history.islands)for(const item of island.entries||[]){
    const key=item.value||item.key;if(seen.has(key))continue;seen.add(key);
    const turn=history.entitiesByKey[key];if(!turn)throw new Error('原会话历史存在缺失。');result.push(turn);
  }
  return result;
}

export function projectSnapshot(snapshot) {
  const state=snapshot.state,turns=nativeTurns(state),latest=turns.at(-1);
  const items=turns.flatMap(turn=>turn.items||[]);
  const canonicalIds=new Set(items.filter(item=>item.type==='userMessage').flatMap(item=>[item.id,item.clientUserMessageId].filter(Boolean)));
  const messages=[];
  for(const turn of turns)for(const item of turn.items||[]){
    if(!['userMessage','agentMessage','steeringUserMessage'].includes(item.type))continue;
    const steering=item.type==='steeringUserMessage';
    if(steering&&(canonicalIds.has(item.serverUserMessageId)||canonicalIds.has(item.clientUserMessageId)))continue;
    const text=item.type==='agentMessage'?item.text:(steering?item.input||[]:item.content||[]).filter(p=>['text','input_text'].includes(p.type)).map(p=>p.text||'').join('\n');
    if(typeof text!=='string'||!text.trim()||!item.id)continue;
    // Public message items only. Reasoning and tool input/output never go to the
    // classroom transcript; they remain in the desktop's original conversation.
    messages.push({id:steering?(item.serverUserMessageId||item.clientUserMessageId||item.id):item.id,role:item.type==='agentMessage'?'assistant':'user',text:item.type==='agentMessage'?text:displayUserText(text),turnId:turn.turnId||turn.id,...(steering?{createdAtMs:item.restoreMessage?.createdAt}:{} )});
  }
  return{id:state.id,title:state.title||'Codex 当前对话',cwd:state.cwd,busy:state.threadRuntimeStatus?.type==='active'||latest?.status==='inProgress',
    messages,revision:snapshot.revision,ownerClientId:snapshot.ownerClientId,model:state.latestModel,
    activeTurnId:latest?.turnId||latest?.id,pendingApproval:(state.requests||[]).length>0,
    error:latest?.status==='failed'?latest.error?.message||'原会话执行失败':null};
}

export class CodexAdapter {
  constructor({ipc=new CodexDesktopIpc()}={}){this.ipc=ipc;}
  async snapshot(id){codexNativeId(id);return projectSnapshot(await this.ipc.snapshot(id,{complete:false}));}
  async send(id,text,requestId){
    const current=await this.snapshot(id);
    if(current.pendingApproval)throw Object.assign(new Error('原对话正在等待确认，请先在电脑处理确认。'),{status:409});
    const input=[{type:'text',text,text_elements:[]}];
    // Match the desktop's own sendFollowUpMessage restore descriptor. A steer
    // requires this descriptor even for plain text; omitting it fails before
    // the original owner submits input to its active turn.
    const restoreMessage={id:requestId,text,cwd:current.cwd,createdAt:Date.now(),context:{prompt:text,addedFiles:[],fileAttachments:[],ideContext:null,imageAttachments:[],workspaceRoots:[current.cwd]}};
    const result=current.busy
      ?await this.ipc.requestOwner(id,'thread-follower-steer-turn',{input,clientUserMessageId:requestId,restoreMessage,attachments:[]},{timeoutMs:60000})
      :await this.ipc.requestOwner(id,'thread-follower-start-turn',{turnStart:{request:{threadId:id,input,clientUserMessageId:requestId},context:{inheritThreadSettings:true,restoreMessage}}},{timeoutMs:60000});
    return{mode:current.busy?'steer':'start',ownerClientId:current.ownerClientId,result};
  }
  close(){this.ipc.close();}
}
