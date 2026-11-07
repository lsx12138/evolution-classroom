'use strict';
const $=id=>document.getElementById(id),parts=location.pathname.split('/'),boardId=parts[2],token=parts[3];
const root=location.pathname.endsWith('/')?location.pathname:location.pathname+'/';
const storageKey='classroom:'+boardId;
const md=window.markdownit({html:false,linkify:false,breaks:true}).disable('image');
const defaultLink=md.renderer.rules.link_open||((tokens,idx,options,env,self)=>self.renderToken(tokens,idx,options));
md.renderer.rules.link_open=(tokens,idx,options,env,self)=>{tokens[idx].attrSet('rel','noreferrer noopener');tokens[idx].attrSet('target','_blank');return defaultLink(tokens,idx,options,env,self);};
let selected='',routingRevision=0,lastState=null,polling=false,sending=false,lastFingerprint='',lastMessages=[],pending=null,handoffNotice='';
try{selected=localStorage.getItem(storageKey+':teacher')||'';routingRevision=Number(localStorage.getItem(storageKey+':routingRevision'))||0;$('question').value=localStorage.getItem(storageKey+':draft')||'';pending=JSON.parse(localStorage.getItem(storageKey+':pending')||'null');}catch{}
$('whiteboard').src='/c/'+encodeURIComponent(boardId)+'/'+encodeURIComponent(token)+'/';
$('whiteboard').addEventListener('load',()=>{try{const doc=$('whiteboard').contentDocument;const style=doc.createElement('style');style.textContent='button[title="Note to agent"],button[title="给老师留言（发送后请在聊天中提醒查看）"],form.xl-note{display:none!important}';doc.head.append(style);}catch{}});
function remember(key,value){try{localStorage.setItem(storageKey+':'+key,value);}catch{}}
function pendingSave(value){pending=value;try{value?localStorage.setItem(storageKey+':pending',JSON.stringify(value)):localStorage.removeItem(storageKey+':pending');}catch{}}
function setNotice(text){$('notice').textContent=text||'';$('notice').hidden=!text;}
function renderMessages(messages,teacherName){
  const fingerprint=JSON.stringify(messages.map(m=>[m.id,m.text]));if(fingerprint===lastFingerprint)return;
  const log=$('messages'),nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<100;
  const previous=new Map([...log.querySelectorAll('.message')].map(el=>[el.dataset.id,el]));
  if(messages.length){log.querySelector('.welcome')?.remove();let cursor=log.firstElementChild;for(const message of messages){
    let el=previous.get(message.id);if(!el){el=document.createElement('article');el.className='message '+message.role;el.dataset.id=message.id;const label=document.createElement('div');label.className='message-label';const body=document.createElement('div');body.className='message-body';el.append(label,body);log.append(el);}
    el.querySelector('.message-label').textContent=message.role==='user'?'你':teacherName;
    if(el.dataset.text!==message.text){const content=el.querySelector('.message-body');if(message.role==='user')content.textContent=message.text;else content.innerHTML=md.render(message.text);el.dataset.text=message.text;}
    if(el!==cursor)log.insertBefore(el,cursor);cursor=el.nextElementSibling;
    previous.delete(message.id);
  }for(const obsolete of previous.values())obsolete.remove();}
  else if(previous.size){for(const el of previous.values())el.remove();const empty=document.createElement('p');empty.className='welcome';empty.textContent='老师已接入。你在这里发送的问题，会进入老师正在使用的原对话。';log.append(empty);}
  if(nearBottom)log.scrollTop=log.scrollHeight;
  if(messages.some(m=>m.role==='assistant'&&!lastMessages.some(old=>old.id===m.id&&old.text===m.text))&&!document.body.classList.contains('chat-open')&&matchMedia('(max-width:820px)').matches)$('unread').hidden=false;
  lastMessages=messages;lastFingerprint=fingerprint;
}
function showState(data){
  if(data.routingRevision!==undefined&&data.routingRevision!==routingRevision){
    routingRevision=data.routingRevision;remember('routingRevision',String(routingRevision));
    handoffNotice=data.agent?'课堂已接到 '+data.agent.name+' 的原对话。'+($('question').value?'输入草稿已保留，请核对后发送。':'后续消息发给这位老师。'):'';
    lastFingerprint='';lastMessages=[];
  }
  lastState=data;$('room-title').textContent=data.title;
  const select=$('teacher'),signature=JSON.stringify(data.agents.map(a=>[a.id,a.name]));
  if(select.dataset.signature!==signature){select.replaceChildren();for(const agent of data.agents){const option=document.createElement('option');option.value=agent.id;option.textContent=agent.name;select.append(option);}if(!data.agents.length){const option=document.createElement('option');option.value='';option.textContent='等待老师加入';select.append(option);}select.dataset.signature=signature;}
  selected=data.agent?.id||'';select.value=selected;remember('teacher',selected);
  const labels={ready:'老师在线 · 消息进入原对话',working:'老师正在处理 · 可以继续提问',offline:'老师暂未连接',waiting:'等待老师加入',approval:'需要在电脑确认'};
  $('connection').dataset.state=data.status;$('connection').textContent=labels[data.status]||'连接中';
  $('send').disabled=sending||!selected||!['ready','working'].includes(data.status);setNotice(data.notice||handoffNotice);
  if(data.status==='working'&&data.agent?.capabilities?.receivesWhileBusy===false){$('connection').textContent='老师正在回复 · 本轮结束后可发送';$('send').disabled=true;}
  renderMessages(data.messages,data.agent?.name||'老师');
  if(pending){const delivery=data.deliveries.find(d=>d.requestId===pending.requestId);if(delivery?.status==='delivered')finishSend();else if(delivery&&delivery.status!=='sending'){$('delivery-status').textContent=delivery.error||'发送未确认';if(delivery.status==='rejected')pendingSave(null);}}
  else if(!sending)$('delivery-status').textContent='消息进入老师当前的原对话';
  if(pending&&pending.agentId!==selected){$('send').disabled=true;setNotice('上一条消息仍在核对原接收者的送达状态，草稿不会转发给新老师。');}
}
async function refresh(){
  if(polling)return;polling=true;
  try{const response=await fetch(root+'state?routingRevision='+routingRevision+(selected?'&agent='+encodeURIComponent(selected):''),{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'连接失败');if(!data.agent&&data.agents.length&&selected){selected='';return;}showState(data);}catch{$('connection').dataset.state='offline';$('connection').textContent='正在重连电脑…';$('send').disabled=true;setNotice('连接暂时中断，输入内容已保留。请确认 Tailscale 和电脑课堂入口在线。');}finally{polling=false;}
}
function finishSend(){const sent=pending;if(sent&&$('question').value===sent.text){$('question').value='';remember('draft','');}pendingSave(null);$('delivery-status').textContent='已送达老师的原对话';}
$('question').addEventListener('input',()=>remember('draft',$('question').value));
$('question').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('composer').requestSubmit();}});
$('teacher').addEventListener('change',()=>{selected=$('teacher').value;remember('teacher',selected);handoffNotice='';lastFingerprint='';lastMessages=[];$('send').disabled=true;void refresh();});
function setChatFullscreen(fullscreen){
  document.body.classList.toggle('chat-fullscreen',fullscreen);
  if(fullscreen){document.body.classList.add('chat-open');document.body.classList.remove('chat-hidden');$('toggle-chat').setAttribute('aria-expanded','true');$('toggle-chat').firstChild.textContent='收起对话 ';$('unread').hidden=true;}
  $('fullscreen-chat').textContent=fullscreen?'返回白板':'全屏';$('fullscreen-chat').setAttribute('aria-label',fullscreen?'返回白板与聊天分屏':'全屏聊天');$('fullscreen-chat').setAttribute('aria-pressed',String(fullscreen));remember('fullscreen',String(fullscreen));
}
$('fullscreen-chat').addEventListener('click',()=>setChatFullscreen(!document.body.classList.contains('chat-fullscreen')));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('chat-fullscreen'))setChatFullscreen(false);});
$('toggle-chat').addEventListener('click',()=>{setChatFullscreen(false);if(matchMedia('(max-width:820px)').matches){const open=document.body.classList.toggle('chat-open');$('toggle-chat').setAttribute('aria-expanded',String(open));$('toggle-chat').firstChild.textContent=open?'收起对话 ':'问老师 ';if(open)$('unread').hidden=true;}else{const hidden=document.body.classList.toggle('chat-hidden');$('toggle-chat').setAttribute('aria-expanded',String(!hidden));$('toggle-chat').firstChild.textContent=hidden?'问老师 ':'收起对话 ';}});
$('composer').addEventListener('submit',async event=>{
  event.preventDefault();const text=$('question').value;if(sending||!selected||!text.trim())return;
  if(pending&&(pending.text!==text||pending.agentId!==selected)){setNotice('上一条消息的送达状态尚未确认。请先核对聊天记录，避免重复发送。');return;}
  const payload=pending||{requestId:crypto.randomUUID(),text,agentId:selected,routingRevision};pendingSave(payload);sending=true;handoffNotice='';$('send').disabled=true;$('delivery-status').textContent='正在交给老师…';
  try{const response=await fetch(root+'message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok){if(data.code==='CLASSROOM_ROUTING_CHANGED')pendingSave(null);throw new Error(data.error||'发送失败');}if(data.ok)finishSend();else{setNotice(data.delivery.error||'消息尚未确认送达。');$('delivery-status').textContent='未确认送达';if(data.delivery.status==='rejected')pendingSave(null);}}
  catch(error){setNotice(error.message||'网络中断；再次点击发送时沿用原消息编号，不重复提交。');$('delivery-status').textContent='正在核对是否送达，草稿已保留';}
  finally{sending=false;void refresh();}
});
if(!matchMedia('(max-width:820px)').matches){$('toggle-chat').firstChild.textContent='收起对话 ';$('toggle-chat').setAttribute('aria-expanded','true');}
try{if(localStorage.getItem(storageKey+':fullscreen')==='true')setChatFullscreen(true);}catch{}
function fitViewport(){document.documentElement.style.setProperty('--classroom-height',(window.visualViewport?.height||window.innerHeight)+'px');}
fitViewport();window.visualViewport?.addEventListener('resize',fitViewport);window.addEventListener('resize',fitViewport);
void refresh();setInterval(()=>{if(!document.hidden)void refresh();},1400);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});window.addEventListener('online',()=>void refresh());
