import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const picking = readFileSync(resolve(root, 'frontend/js/picking.js'), 'utf8')
  .replace(/\bexport\s+(?=(?:function|const|class)\s)/g, '');
const context = { Float32Array, Uint8Array, Set, Map, Math };
vm.runInNewContext(picking + '\nthis.pickAPI = {encodePickId, decodePickColor, pickMatrix};', context);
const { encodePickId, decodePickColor, pickMatrix } = context.pickAPI;
for (const id of [1, 2, 255, 256, 257, 65535, 16777215]) {
  const rgb = Array.from(encodePickId(id), n => Math.round(n * 255));
  assert.equal(decodePickColor(Uint8Array.from([...rgb, 255])), id);
}
assert.equal(decodePickColor(Uint8Array.from([12, 3, 0, 0])), 0, 'empty pixel means no hit');
assert.throws(() => encodePickId(0), /Invalid picking ID/);
assert.throws(() => encodePickId(16777216), /Invalid picking ID/);
const vp = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
const cropped = pickMatrix(vp, .25, -.5, 200, 100);
assert.ok(Math.abs(cropped[0] * .25 + cropped[12]) < 0.001);
assert.ok(Math.abs(cropped[5] * -.5 + cropped[13]) < 0.001);
assert.equal(cropped[10],1,'depth projection remains unchanged');
assert.equal(cropped[15],1);

const treeCode = readFileSync(resolve(root, 'frontend/js/item_tree.js'), 'utf8')
  .replace('export class ItemTree', 'class ItemTree');
class FakeElement {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attrs = {}; this.events = {}; this.dataset = {};
    this.hidden = false; this.style = {setProperty(){}}; this.className=''; this.textContent='';
    const items = new Set();
    this.classList = { add: x=>items.add(x), remove:x=>items.delete(x),
      contains:x=>items.has(x), toggle:(x,v)=>{ if (v===undefined? !items.has(x):v) items.add(x); else items.delete(x); } };
  }
  setAttribute(name,value) { this.attrs[name]=value; }
  getAttribute(name) { return this.attrs[name]; }
  append(...elements) { for (const el of elements) { el.parentElement=this; this.children.push(el); } }
  replaceChildren(...els) { this.children=[]; this.append(...els); }
  addEventListener(name,cb) { this.events[name]=cb; }
  scrollIntoView() { this.scrolled=true; }
}
context.document = {createElement: tag=>new FakeElement(tag),
  createElementNS: (_ns,tag)=>new FakeElement(tag)};
context.window = {addEventListener(){},removeEventListener(){}};
vm.runInNewContext(treeCode + '\nthis.Tree = ItemTree;', context);
const tEls = Array.from({length:6},()=>new FakeElement('div'));
tEls[0].getBoundingClientRect=()=>({width:270});
let selection = undefined;
const tree = new context.Tree({panel:tEls[0], toggle:tEls[1], resizer:tEls[2],
  container:tEls[3], summary:tEls[4], note:tEls[5],
  onVisibility:()=>{}, onSelect:n=>selection=n});
const data = {id:'assembly', name:'Assembly', type:'part', children:[
  {id:'left', name:'Left component', type:'component', children:[
    {id:'nested', name:'Nested part', type:'component', children:[
      {id:'body-left', name:'Left body', meshId:'mesh-left', type:'body', children:[]},
    ]},
  ]},
  {id:'right', name:'Right component', type:'component', children:[
    {id:'body-right', name:'Right body', meshId:'mesh-right', type:'body', children:[]},
  ]},
]};
tree.show(data, {visibilityEnabled:true});
assert.equal(tree.explodeActions.size,4,'root and each component have actions, bodies do not');
assert.equal(tree.explodeActions.get('assembly').disabled,true,'not enabled before mesh plan');
tree.setExplodeState([
  {id:'left',meshIds:['mesh-left']},
  {id:'right',meshIds:['mesh-right']},
],0,new Map());
assert.equal(tree.explodeActions.get('assembly').disabled,false);
assert.equal(tree.explodeActions.get('nested').disabled,false);
assert.equal(tree.explodeActions.get('assembly').getAttribute('aria-pressed'), 'false');
tree.setExplodeState([
  {id:'left',meshIds:['mesh-left']},
  {id:'right',meshIds:['mesh-right']},
],60,new Map());
assert.equal(tree.explodeActions.get('assembly').getAttribute('aria-pressed'), 'true');
assert.equal(tree.explodeActions.get('right').getAttribute('aria-pressed'), 'true');
tree.setExplodeState([
  {id:'left',meshIds:['mesh-left']},{id:'right',meshIds:['mesh-right']},
],0,new Map([['right',75]]));
assert.equal(tree.explodeActions.get('assembly').getAttribute('aria-pressed'), 'true', 'partial explosion activates root');
assert.equal(tree.explodeActions.get('nested').getAttribute('aria-pressed'), 'false');
assert.equal(tree.explodeActions.get('right').getAttribute('aria-pressed'), 'true');
assert.equal(tree.nodeForMesh('mesh-left').id, 'nested', 'choose nearest occurrence');
assert.equal(tree.nodeForMesh('mesh-right').id,'right');
assert.equal(tree.nodeForMesh('missing'),null);
tree.selectMesh('mesh-left');
assert.equal(selection.id,'nested');
assert.equal(tree.selectedId,'nested');
assert.equal(tree.nestedLists.get('left').hidden,false,'reveals nested node');
assert.equal(tree.nestedLists.get('assembly').hidden,false);
assert.ok(tree.rows.get('nested').scrolled);
tree.selectNode(null);
assert.equal(tree.selectedId,null);
assert.equal(selection,null);
tree.show(data,{visibilityEnabled:false});
assert.equal(tree.nodeForMesh('root').id,'assembly','combined STL selects entire part');
tree.setExplodeState([],0,new Map());
assert.equal(tree.explodeActions.get('assembly').disabled,true,'combined STL disables row actions');
tree.show({id:'solo',name:'Single part',type:'part',children:[
  {id:'solid',name:'Solid body',type:'body',meshId:'single'}
]}, {visibilityEnabled:true});
assert.equal(tree.explodeActions.size,0,'single parts must not show assembly-only actions');

const renderer = readFileSync(resolve(root,'frontend/js/viewer.js'),'utf8');
assert.match(renderer, /gl\.readPixels\(0, 0, 1, 1, gl\.RGBA, gl\.UNSIGNED_BYTE, pixel\)/);
assert.match(renderer, /if \(!part\.visible\) continue;/);
assert.match(renderer, /if \(click\) this\.onSelectMesh/);
assert.match(renderer, /this\.selectedMeshIds\.has\(part\.meshId\)/);
// Test click-versus-drag using the actual renderer's event handlers, without a GPU.
const rendererEval = renderer.replace(/^import .*?;\s*$/gm, '')
  .replace('export class Viewer', 'class Viewer');
const fakeCanvas = { events:{}, style:{}, addEventListener(type, listener) {this.events[type]=listener;},
  setPointerCapture(){}, clientHeight:800 };
const glCtx = { Math, Float32Array, Uint16Array, Uint8Array, Set, Map,
  encodePickId, decodePickColor, pickMatrix,
  requestAnimationFrame: cb=>cb(), window:{devicePixelRatio:1} };
vm.runInNewContext(rendererEval + '\nthis.Viewer = Viewer;', glCtx);
const viewer = Object.create(glCtx.Viewer.prototype);
viewer.canvas = fakeCanvas; viewer.target=[0,0,0]; viewer.distance=12;
viewer.pitch=.46; viewer.yaw=.7; viewer.requestRender=()=>{};
viewer.pickMesh=()=> 'mesh-right';
const clicks=[], hovers=[];
viewer.onSelectMesh=id=>clicks.push(id);
viewer.onHoverMesh=id=>hovers.push(id);
viewer.attachControls();
const event = (x,y,button=0)=>({button,clientX:x,clientY:y,pointerId:1,
  pointerType:'mouse',shiftKey:false,preventDefault(){}});
fakeCanvas.events.pointerdown(event(60,60));
fakeCanvas.events.pointerup(event(60,60));
assert.deepEqual(clicks,['mesh-right'],'simple click selects geometry');
fakeCanvas.events.pointerdown(event(60,60));
fakeCanvas.events.pointermove(event(100,110));
fakeCanvas.events.pointerup(event(100,110));
assert.deepEqual(clicks,['mesh-right'],'orbit drag never selects');
fakeCanvas.events.pointerdown(event(60,60,2));
fakeCanvas.events.pointerup(event(60,60,2));
assert.deepEqual(clicks,['mesh-right'],'right drag never selects');
fakeCanvas.events.pointermove(event(60,60));
assert.ok(hovers.includes('mesh-right'),'hover previews geometry');
fakeCanvas.events.pointerleave();
assert.equal(hovers.at(-1),null,'leave clears hover');

const app = readFileSync(resolve(root,'frontend/js/app.js'),'utf8');
assert.match(app, /viewer\.onSelectMesh = \(meshId, x, y\)/);
assert.match(app, /tree\.selectMesh\(meshId\)/);
assert.match(app, /viewer\.setSelectedMeshIds\(node \? tree\.descendants\(node\)/);
console.log('MS25 mesh picking IDs, cropped projection, tree sync, and selection safeguards passed.');
