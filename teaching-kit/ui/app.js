'use strict';
const $=id=>document.getElementById(id),base=location.pathname.replace(/\/?$/,'/'),params=new URLSearchParams(location.search);
let currentActivity=null,currentGraph=null,graphMode='local',api=null,applet=null,drawVersion=0,timer;
const status=message=>{$('status').textContent=message;};
async function request(path,data){
  const res=await fetch(base+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
  const json=await res.json();if(!res.ok||json.ok===false)throw new Error(json.error||'操作未完成');return json;
}
MathfieldElement.fontsDirectory=base+'mathlive/fonts';MathfieldElement.soundsDirectory=null;
$('math-answer').mathVirtualKeyboardPolicy='auto';
function tab(name){for(const n of ['answer','graph']){$('tab-'+n).classList.toggle('active',n===name);$('tab-'+n).setAttribute('aria-selected',String(n===name));$(n+'-panel').hidden=n!==name;}if(name==='graph'&&currentGraph)redraw().catch(e=>status(e.message));}
$('tab-answer').onclick=()=>tab('answer');$('tab-graph').onclick=()=>tab('graph');
function options(select,ids,selected){select.replaceChildren(new Option('选择老师准备的内容',''),...ids.map(id=>new Option(id,id)));select.value=selected||'';}
async function refresh(){
  const a=$('activity-select').value||params.get('activity')||'',g=$('graph-select').value||params.get('graph')||'';
  const data=await request('api/state?activity='+encodeURIComponent(a)+'&graph='+encodeURIComponent(g));
  options($('activity-select'),data.activities,a);options($('graph-select'),data.graphs,g);
  currentActivity=data.activity;currentGraph=data.graph;renderActivity();if(currentGraph)await renderGraph();status('已读取最新内容。');
}
function renderActivity(){
  $('activity').hidden=!currentActivity;$('answer-empty').hidden=!!currentActivity;
  if(!currentActivity)return;
  $('purpose').textContent=currentActivity.purpose==='verification'?'工具验证题 · 不计入学习进度':'课堂练习 · 难度为老师暂定';
  $('skill').textContent=currentActivity.skill;$('prompt').textContent=currentActivity.prompt;
  $('question-formula').value=currentActivity.math_latex||'';$('question-formula').hidden=!currentActivity.math_latex;
  const last=currentActivity.attempts.at(-1),key='study-tool-draft:'+currentActivity.id;
  let draft;try{draft=JSON.parse(localStorage.getItem(key));}catch{}
  $('answer').value=draft?.answer??last?.answer??'';$('math-answer').value=draft?.latex??last?.latex??'';$('feeling').value=draft?.feeling??last?.feeling??'unspecified';
  $('feedback').hidden=!last?.assessment;$('feedback-text').textContent=last?.assessment?.feedback||'';
}
function saveDraft(){if(currentActivity)try{localStorage.setItem('study-tool-draft:'+currentActivity.id,JSON.stringify({answer:$('answer').value,latex:$('math-answer').value,feeling:$('feeling').value}));}catch{}}
$('answer').oninput=saveDraft;$('math-answer').addEventListener('input',saveDraft);$('feeling').onchange=saveDraft;
$('answer-form').onsubmit=async event=>{
  event.preventDefault();if(!currentActivity)return;$('submit-answer').disabled=true;
  try{
    const answer=$('answer').value.trim()||$('math-answer').value.trim();
    if(!answer)throw new Error('请先输入文字答案或数学公式。');
    currentActivity=await request('api/submit',{id:currentActivity.id,expected_revision:currentActivity.revision,student_answer:answer,student_latex:$('math-answer').value,feeling:$('feeling').value});
    localStorage.removeItem('study-tool-draft:'+currentActivity.id);renderActivity();status('原答已保存。请在原课堂告诉老师“我已提交”，等待老师查看。');
  }catch(error){status(error.message+' 草稿仍保留。');}finally{$('submit-answer').disabled=false;}
};
$('activity-select').onchange=()=>{params.set('activity',$('activity-select').value);refresh().catch(e=>status(e.message));};
$('graph-select').onchange=()=>{params.set('graph',$('graph-select').value);api=null;applet=null;$('ggb-element').replaceChildren();refresh().catch(e=>status(e.message));};
$('refresh').onclick=()=>refresh().catch(e=>status(e.message));
async function renderGraph(){
  $('graph-content').hidden=false;$('graph-title').textContent=currentGraph.title;$('expressions').textContent=currentGraph.expressions.map((x,i)=>'f'+(i+1)+'(x) = '+x).join('\n');
  $('sliders').replaceChildren();
  for(const p of currentGraph.parameters){
    const label=document.createElement('label');label.className='slider-row';
    const text=document.createElement('span'),input=document.createElement('input');input.type='range';input.min=p.min;input.max=p.max;input.step=p.step;input.value=p.value;input.setAttribute('aria-label',p.name);
    const update=()=>{p.value=Number(input.value);text.textContent=p.name+' = '+p.value;clearTimeout(timer);timer=setTimeout(()=>redraw().catch(e=>status(e.message)),120);};input.oninput=update;text.textContent=p.name+' = '+p.value;label.append(text,input);$('sliders').append(label);
  }
  await redraw();
}
async function redraw(){
  if(!currentGraph)return;
  if(graphMode==='geogebra'){if(api)for(const p of currentGraph.parameters)api.setValue(p.name,p.value);return;}
  const version=++drawVersion;
  const results=await Promise.all(currentGraph.expressions.map(expression=>request('api/plot',{expression,parameters:Object.fromEntries(currentGraph.parameters.map(p=>[p.name,p.value])),x_min:currentGraph.x_min,x_max:currentGraph.x_max,samples:501})));
  if(version!==drawVersion)return;
  const canvas=$('plot'),dpr=devicePixelRatio||1,rect=canvas.getBoundingClientRect();canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const w=rect.width,h=rect.height,left=48,right=w-18,top=20,bottom=h-35;
  const g=currentGraph,X=x=>left+(x-g.x_min)/(g.x_max-g.x_min)*(right-left),Y=y=>bottom-(y-g.y_min)/(g.y_max-g.y_min)*(bottom-top);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.font='12px system-ui';ctx.textAlign='center';
  for(let i=0;i<=10;i++){const x=g.x_min+(g.x_max-g.x_min)*i/10,y=g.y_min+(g.y_max-g.y_min)*i/10;ctx.strokeStyle='#e6ebf1';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(X(x),top);ctx.lineTo(X(x),bottom);ctx.moveTo(left,Y(y));ctx.lineTo(right,Y(y));ctx.stroke();ctx.fillStyle='#4b596b';ctx.fillText(Number(x.toPrecision(3)),X(x),bottom+20);ctx.textAlign='right';ctx.fillText(Number(y.toPrecision(3)),left-7,Y(y)+4);ctx.textAlign='center';}
  ctx.strokeStyle='#63738a';ctx.lineWidth=1.4;ctx.beginPath();if(g.x_min<=0&&g.x_max>=0){ctx.moveTo(X(0),top);ctx.lineTo(X(0),bottom);}if(g.y_min<=0&&g.y_max>=0){ctx.moveTo(left,Y(0));ctx.lineTo(right,Y(0));}ctx.stroke();
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  const colors=['#2256aa','#a04438','#2c7453','#7e4d9a','#876721','#3d6f7f'];
  results.forEach((result,index)=>{ctx.strokeStyle=colors[index];ctx.lineWidth=2;ctx.beginPath();let previous=null;for(const [x,y] of result.points){if(y===null||y<g.y_min-2*(g.y_max-g.y_min)||y>g.y_max+2*(g.y_max-g.y_min)){previous=null;continue;}const point=[X(x),Y(y)];if(!previous||Math.abs(point[1]-previous[1])>(bottom-top)*.65)ctx.moveTo(...point);else ctx.lineTo(...point);previous=point;}ctx.stroke();});ctx.restore();
  ctx.fillStyle='#172033';ctx.fillText('x',right,bottom+20);ctx.fillText('y',left-12,top-5);status('函数图已更新。曲线为采样表示，不能据此判定精确端点。');
}
$('show-local').onclick=()=>{graphMode='local';$('plot').hidden=false;$('ggb-element').hidden=true;redraw().catch(e=>status(e.message));};
$('show-geogebra').onclick=async()=>{
  if(typeof GGBApplet==='undefined'){
    try{await new Promise((ok,fail)=>{const script=document.createElement('script');script.src=base+'geogebra/deployggb.js';script.onload=ok;script.onerror=fail;document.head.append(script);});}
    catch{status('GeoGebra组件尚未安装，可以继续使用本机函数图。');return;}
  }
  graphMode='geogebra';$('plot').hidden=true;$('ggb-element').hidden=false;
  if(api)return;
  status('正在加载本机GeoGebra…');
  applet=new GGBApplet({appName:'graphing',width:Math.max(300,Math.min(900,$('graph-content').clientWidth)),height:450,showToolBar:false,showAlgebraInput:false,showMenuBar:false,enableCAS:false,enableRightClick:false,language:'zh',appletOnLoad:ggb=>{
    api=ggb;
    for(const p of currentGraph.parameters)ggb.evalCommand(p.name+'='+p.value);
    currentGraph.expressions.forEach((expr,i)=>ggb.evalCommand('f_'+(i+1)+'(x)='+expr.replace(/\*\*/g,'^').replace(/\bln\b/g,'ln')));
    ggb.setCoordSystem(currentGraph.x_min,currentGraph.x_max,currentGraph.y_min,currentGraph.y_max);status('GeoGebra已就绪，拖动上方参数观察变化。');
  }},true);
  applet.setHTML5Codebase(base+'geogebra/HTML5/5.0/web3d/');
  applet.inject('ggb-element');
};
window.addEventListener('resize',()=>{if(graphMode==='local'){clearTimeout(timer);timer=setTimeout(()=>redraw().catch(e=>status(e.message)),180);}});
refresh().then(()=>{if(params.get('graph')&&!params.get('activity'))tab('graph');}).catch(e=>status(e.message));
