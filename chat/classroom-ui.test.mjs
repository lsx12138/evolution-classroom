import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

// Runs the shipped UI script with a minimal DOM. This checks interaction state,
// persistence and request routing; it is not a screenshot or layout acceptance.
async function ui(){
 const elements=new Map(),storage=new Map(),events={},requests=[];
 function element(){const classes=new Set();return{value:'',dataset:{},style:{properties:{},setProperty(k,v){this.properties[k]=v;}},firstChild:{textContent:''},events:{},children:[],attributes:{},classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle(x,on){const yes=on??!classes.has(x);yes?classes.add(x):classes.delete(x);return yes;}},addEventListener(n,f){this.events[n]=f;},setAttribute(n,v){this.attributes[n]=v;},append(x){this.children.push(x);},replaceChildren(){this.children=[];},querySelectorAll(){return[];},querySelector(){return null;}};}
 const document={body:element(),documentElement:element(),getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,addEventListener(n,f){events[n]=f;}};
 const empty={title:'课堂',agents:[],agent:null,messages:[],deliveries:[],status:'waiting',routingRevision:0};
 const context={document,location:{pathname:'/classroom/canvas-test/private/'},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID},matchMedia:()=>({matches:true}),setInterval(){},fetch:async(url,opts)=>{requests.push({url,opts});return{ok:true,json:async()=>empty};},innerHeight:800,visualViewport:{height:740,addEventListener(n,f){events['viewport:'+n]=f;}},addEventListener(){},markdownit:()=>({disable(){return this;},renderer:{rules:{}},render:s=>s})};
 context.window=context;vm.createContext(context);vm.runInContext(await readFile(new URL('./ui/classroom.js',import.meta.url),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));
 return{context,elements,storage,events,requests,run:code=>vm.runInContext(code,context),empty};
}
test('手机全屏聊天能展开和返回，保留草稿与键盘视口适配',async()=>{
 const f=await ui(),input=f.elements.get('question');input.value='尚未发送的草稿';
 f.elements.get('fullscreen-chat').events.click();
 assert.equal(f.context.document.body.classList.contains('chat-fullscreen'),true);
 assert.equal(f.elements.get('fullscreen-chat').textContent,'返回白板');
 assert.equal(input.value,'尚未发送的草稿');
 assert.equal(f.storage.get('classroom:canvas-test:fullscreen'),'true');
 assert.equal(f.context.document.documentElement.style.properties['--classroom-height'],'740px');
 f.context.visualViewport.height=420;f.events['viewport:resize']();
 assert.equal(f.context.document.documentElement.style.properties['--classroom-height'],'420px');
 f.events.keydown({key:'Escape'});
 assert.equal(f.context.document.body.classList.contains('chat-fullscreen'),false);
 assert.equal(input.value,'尚未发送的草稿');
});
test('收到新交接修订后更新接收者，保留草稿，不自动提交',async()=>{
 const f=await ui();f.elements.get('question').value='还没问完';
 const data={...f.empty,routingRevision:2,agents:[{id:'teacher-new',name:'新老师'}],agent:{id:'teacher-new',name:'新老师'},status:'ready'};
 f.context.fixture=data;f.run('showState(fixture)');
 assert.equal(f.elements.get('teacher').value,'teacher-new');
 assert.equal(f.elements.get('question').value,'还没问完');
 assert.match(f.elements.get('notice').textContent,/新老师/);
 assert.equal(f.requests.filter(x=>x.opts?.method==='POST').length,0);
});
test('切到新老师时不把未确认的上一条消息转发给新老师',async()=>{
 const f=await ui();f.elements.get('question').value='保留';f.run('pendingSave({requestId:"pending",agentId:"teacher-old",text:"保留"})');
 f.context.fixture={...f.empty,routingRevision:3,agents:[{id:'teacher-new',name:'新老师'}],agent:{id:'teacher-new',name:'新老师'},status:'ready'};f.run('showState(fixture)');
 assert.equal(f.elements.get('send').disabled,true);
 assert.match(f.elements.get('notice').textContent,/不会转发/);
 assert.equal(f.elements.get('question').value,'保留');
});
