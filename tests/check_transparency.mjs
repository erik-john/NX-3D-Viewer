// MS35: one selection-following 0-100 glass slider, reset-all icon, per-mesh alpha.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root,'frontend/index.html'),'utf8');
const app = readFileSync(resolve(root,'frontend/js/app.js'),'utf8');
for (const id of ['tree-opacity-actions',
 'reset-transparency-all','component-opacity-slider','component-opacity-value'])
  assert.ok(html.includes(`id="${id}"`),id);
const groupStart = html.indexOf('<header');
const groupEnd = html.indexOf('</header>');
assert.ok(html.indexOf('id="transparency-menu-toggle"')>groupStart &&
  html.indexOf('id="transparency-menu-toggle"')<groupEnd, 'transparency belongs in header');
assert.ok(html.includes('id="transparency-menu"'), 'slider moves into dropdown');
assert.ok(!html.includes('tree-transparency-toggle'),'no more component row icons');
assert.ok(!html.includes('id="transparency-selected"'),'no redundant Transparent/Solid button');
assert.match(html, /id="component-opacity-slider" min="0" max="100" step="1" value="0"/);
assert.match(html, /id="reset-transparency-all" class="header-menu-item"/);
assert.ok(app.includes('alphaToTransparency'), 'selection converts saved alpha back to slider percentage');
assert.ok(app.includes('transparencyToAlpha'), 'slider converts transparency to material alpha');
assert.ok(app.includes('if (amount === 0) componentOpacities.delete(id)'), 'zero restores original appearance');
assert.ok(app.includes('componentOpacities'), 'per-mesh opacity map is retained');
const code = readFileSync(resolve(root,'frontend/js/viewer.js'),'utf8')
  .replace(/^import .*?;\s*$/gm,'').replace('export class Viewer','class Viewer');
const context={Math,Map,Set,Float32Array,Uint16Array,Uint8Array,window:{devicePixelRatio:1}};
vm.runInNewContext(code+'\nthis.Viewer=Viewer;',context);
const viewer=Object.create(context.Viewer.prototype);
let renders=0;
viewer.requestRender=()=>renders++;
viewer.geometry=[
  {meshId:'A-1',visible:true,offset:[0,0,0],bounds:{center:[0,0,0]}},
  {meshId:'A-2',visible:true,offset:[0,0,0],bounds:{center:[4,0,0]}},
  {meshId:'B',visible:true,offset:[0,0,0],bounds:{center:[8,0,0]}}
];
viewer.setMeshOpacities(new Map([['A-1',0.35],['A-2',0.75]]));
assert.deepEqual(Array.from(viewer.geometry.map(p=>p.opacity)),[0.35,0.75,1]);
viewer.setMeshOpacities(new Map([['A-1',3],['A-2',-2],['B',NaN]]));
assert.deepEqual(Array.from(viewer.geometry.map(p=>p.opacity)),[1,0.045,1], 'bound opacity safely');
viewer.setMeshOpacities(new Map());
assert.ok(viewer.geometry.every(p=>p.opacity===1));
assert.ok(renders>=3);
assert.match(code,/gl\.enable\(gl\.BLEND\)/);
assert.match(code,/gl\.depthMask\(false\)/);
assert.match(code,/gl\.depthMask\(true\)/);
assert.match(code,/gl_FragColor = vec4\(surface, surfaceAlpha\)/);
assert.match(code,/vec3 glassTint/);
assert.match(code,/glassMix/);
assert.match(code,/float rim/);
assert.match(code,/float backFaceWeight/,'reduce stacked backface glass density');
assert.match(code,/0\.24 \* rim/,'tinted Fresnel rim is visible');
assert.match(code,/0\.045/,'clear glass alpha bound is low');
assert.match(code,/glassCreaseColor/,'use cool visible edges on glass');
assert.match(app,/Math\.pow\(1 - Math\.min\(100/,'perceptual transparency curve');
assert.match(code,/this\.geometry\.filter\(part => part\.visible\)/);
assert.ok(!app.includes('setMeshVisible(id, false)'), 'transparency does not hide geometry');
// Exercise the real render method against a recording WebGL interface. Opaque
// meshes must write depth before back-to-front translucent meshes blend.
const calls=[];
let currentPart=null, currentAlpha=1, blending=false, depthWrites=true;
const gl=new Proxy({}, {get:(_target,name)=>{
  if (typeof name!=='string') return undefined;
  if (name==='createBuffer') return ()=>({});
  if (name==='bindBuffer') return (_kind,buffer)=>{if (buffer?.part) currentPart=buffer.part;};
  if (name==='uniform1f') return (location,value)=>{if(location==='opacity') currentAlpha=value;};
  if (name==='enable') return flag=>{if(flag==='BLEND') blending=true;};
  if (name==='disable') return flag=>{if(flag==='BLEND') blending=false;};
  if (name==='depthMask') return state=>{depthWrites=state;};
  if (name==='drawElements') return ()=>calls.push({part:currentPart,alpha:currentAlpha,blending,depthWrites});
  if (name==='getBoundingClientRect') return ()=>({width:100,height:100});
  if (name===name.toUpperCase()) return name;
  return ()=>{};
}});
const renderer=Object.create(context.Viewer.prototype);
renderer.gl=gl;renderer.canvas={width:100,height:100,getBoundingClientRect:()=>({width:100,height:100})};
renderer.solid={};renderer.solidLoc={matrix:'matrix',wire:'wire',eye:'eye',color:'color',
  position:'position',normal:'normal',offset:'offset',opacity:'opacity',highlight:'highlight'};
renderer.showGrid=false;renderer.showAxes=false;renderer.wireframe=false;
renderer.componentColorsEnabled=false;renderer.selectedMeshIds=new Set();renderer.hoveredMeshIds=new Set();
renderer.renderAxisLabels=()=>{};renderer.renderCompass=()=>{};
renderer.cameraMatrix=()=>({eye:[10,0,0],matrix:new Float32Array(16)});
const part=(id,x,opacity)=>({meshId:id,visible:true,opacity,position:{part:id},normal:{part:id},
  triangles:{part:id},edges:{part:id},triangleCount:3,edgeCount:6,color:[1,1,1],
  offset:[0,0,0],bounds:{center:[x,0,0]},creaseCount:0});
renderer.geometry=[part('near-transparent',0,0.6),part('far-transparent',-5,0.35),part('opaque',5,1)];
renderer.render();
assert.deepEqual(calls.map(c=>c.part),['opaque','far-transparent','near-transparent']);
assert.deepEqual(calls.map(c=>c.alpha),[1,0.35,0.6]);
assert.deepEqual(calls.map(c=>c.depthWrites),[true,false,false]);
assert.deepEqual(calls.map(c=>c.blending),[false,true,true]);
assert.equal(depthWrites,true,'render must restore depth writes');
assert.equal(blending,false,'render must restore blending');
console.log('MS35: single glass slider, selection value, reset-all icon, transparent shader and WebGL alpha pass checks passed');
