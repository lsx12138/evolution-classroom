import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import vm from 'node:vm';
import {KIT_ROOT} from './tools.mjs';

test('panel initializes, preserves complete submission, and drives local GeoGebra configuration',async()=>{
  const nodes=new Map(),requests=[],commands=[],storage=new Map(),listeners={};
  function element(){
    return {value:'',textContent:'',hidden:false,disabled:false,children:[],classList:{toggle(){}},
      setAttribute(){},addEventListener(event,fn){this[event]=fn;},replaceChildren(...items){this.children=items;},
      append(...items){this.children.push(...items);},clientWidth:800,getBoundingClientRect(){return {width:800,height:450};},
      getContext(){return new Proxy({},{get:(_,key)=>key==='measureText'?()=>({width:10}):()=>{}});}};
  }
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element};
  const activity={id:'ui-verification',subject:'math',skill:'验证',prompt:'完整作答',purpose:'verification',revision:'r1',math_latex:'x^2',attempts:[]};
  const graph={id:'ui-graph',title:'验证图形',expressions:['a*x**2'],parameters:[{name:'a',min:-3,max:3,value:1,step:.5}],x_min:-5,x_max:5,y_min:-5,y_max:10};
  let codebase;
  const context=vm.createContext({
    document,location:{pathname:'/learning-tools/private-test/',search:'?activity=ui-verification&graph=ui-graph'},URLSearchParams,
    MathfieldElement:class {},devicePixelRatio:1,Option:class{constructor(text,value){this.text=text;this.value=value;}},
    window:{addEventListener(event,fn){listeners[event]=fn;}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    setTimeout,clearTimeout,console,
    fetch:async(url,options={})=>{
      requests.push({url,options});
      const data=url.includes('api/state')?{activities:[activity.id],graphs:[graph.id],activity,graph}:
        url.includes('api/plot')?{ok:true,points:[[-1,1],[0,0],[1,1]]}:
        {...activity,revision:'r2',attempts:[{answer:'测试完整原答',latex:'x+1',feeling:'too_easy'}]};
      return {ok:true,json:async()=>data};
    },
    GGBApplet:class{
      constructor(config){this.config=config;}
      setHTML5Codebase(value){codebase=value;}
      inject(){this.config.appletOnLoad({evalCommand:value=>commands.push(value),setCoordSystem(){},setValue(){}});}
    },
  });
  vm.runInContext(await readFile(join(KIT_ROOT,'ui','app.js'),'utf8'),context);
  await new Promise(r=>setTimeout(r,30));
  assert.equal(nodes.get('prompt').textContent,'完整作答');assert.equal(nodes.get('question-formula').value,'x^2');
  const plotsBefore=requests.filter(r=>r.url.endsWith('api/plot')).length;
  nodes.get('tab-graph').onclick();await new Promise(r=>setTimeout(r,0));
  assert.equal(nodes.get('graph-panel').hidden,false);
  assert.ok(requests.filter(r=>r.url.endsWith('api/plot')).length>plotsBefore,'opening the graph tab redraws it at its visible size');
  const installedApplet=context.GGBApplet;context.GGBApplet=undefined;
  document.head={append(script){script.onerror();}};
  await nodes.get('show-geogebra').onclick();
  assert.match(nodes.get('status').textContent,/组件尚未安装/);
  assert.equal(nodes.get('plot').hidden,false,'missing optional GeoGebra keeps the built-in graph visible');
  context.GGBApplet=installedApplet;
  nodes.get('answer').value='测试完整原答';nodes.get('math-answer').value='x+1';nodes.get('feeling').value='too_easy';
  await nodes.get('answer-form').onsubmit({preventDefault(){}});
  const submitted=JSON.parse(requests.find(r=>r.url.endsWith('api/submit')).options.body);
  assert.equal(submitted.student_answer,'测试完整原答');assert.equal(submitted.expected_revision,'r1');assert.equal(submitted.feeling,'too_easy');
  assert.match(nodes.get('status').textContent,/原答已保存/);
  await nodes.get('show-geogebra').onclick();
  assert.equal(codebase,'/learning-tools/private-test/geogebra/HTML5/5.0/web3d/');
  assert.ok(commands.includes('f_1(x)=a*x^2'));
  assert.match(nodes.get('status').textContent,/GeoGebra已就绪/);
});
