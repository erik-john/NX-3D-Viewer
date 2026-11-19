import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'..');
const file=p=>readFileSync(resolve(root,p),'utf8');
const geometry=file('frontend/js/geometry.js').replace('export function boundsFor','function boundsFor');
const explosion=file('frontend/js/assembly_explode.js').replace(/^import .*?;\s*$/gm,'')
  .replace(/export function /g,'function ');
const src=geometry+'\n'+explosion+'\nthis.api={boundsFor,createExplodePlan,calculateExplodeOffsets,selectionGroupIds};';
const ctx={Map,Set,Math,Float32Array};
vm.runInNewContext(src,ctx);
const {boundsFor,createExplodePlan,calculateExplodeOffsets,selectionGroupIds}=ctx.api;
const mesh=(id,x,y,z)=>({meshId:id,positions:new Float32Array([x,y,z,x+1,y,z,x,y+1,z]),
  normals:new Float32Array(9),indices:new Uint16Array([0,1,2])});
const rootNode={id:'r',type:'part',children:[
  {id:'occ-1',type:'component',children:[{id:'body-1',type:'body',meshId:'m1'}]},
  {id:'occ-2',type:'component',children:[{id:'body-2',type:'body',meshId:'m2'}]},
  {id:'occ-3',type:'component',children:[{id:'body-3',type:'body',meshId:'m3'}]},
]};
// Two occurrences of exactly the same source geometry must move independently.
const meshes=[mesh('m1',0,0,0),mesh('m2',0,0,0),mesh('m3',12,0,0)];
const plan=createExplodePlan(rootNode,meshes);
assert.deepEqual(Array.from(plan,group=>group.id),['occ-1','occ-2','occ-3']);
const bounds=boundsFor(meshes);
const assembled=calculateExplodeOffsets(plan,bounds,0);
for(const offset of assembled.values()) assert.ok(offset.every(v=>v===0));
const half=calculateExplodeOffsets(plan,bounds,50);
const full=calculateExplodeOffsets(plan,bounds,100);
assert.equal(half.size,3);
assert.ok(half.get('m1').some(v=>Math.abs(v)>0));
assert.notDeepEqual(Array.from(half.get('m1')),Array.from(half.get('m2')),
  'coincident component occurrences have distinct explode directions');
for(const id of ['m1','m2','m3']) {
  assert.ok(Math.abs(Math.hypot(...full.get(id)) - 2*Math.hypot(...half.get(id))) < 1e-4);
}
const selected=selectionGroupIds(plan,rootNode.children[1],node=>node.children.map(c=>c.meshId));
assert.deepEqual(Array.from(selected),['occ-2']);
assert.equal(selectionGroupIds(plan,rootNode,()=>['m1','m2','m3']).length,0,
  'whole assembly is not a selected component');
const overridden=calculateExplodeOffsets(plan,bounds,60,new Map([['occ-2',0]]));
assert.ok(overridden.get('m2').every(v=>v===0),'reset selected must return exact original position');
assert.ok(overridden.get('m1').some(v=>v!==0),'other components remain exploded');
assert.equal(createExplodePlan(rootNode,[mesh('root',0,0,0)]).length,0,
  'combined STL cannot invent independent components');

const viewerSource=file('frontend/js/viewer.js');
for(const text of ['gl.uniform3fv(this.solidLoc.offset, part.offset)',
  'gl.uniform3fv(this.pickLoc.offset, part.offset)',
  'part.creaseCount, matrix, gl.LINES, part.offset']) assert.ok(viewerSource.includes(text),text);
const fakeViewer=viewerSource.replace(/^import .*?;\s*$/gm,'')
  .replace('export class Viewer','class Viewer');
vm.runInNewContext(fakeViewer+'\nthis.Viewer=Viewer;',ctx);
const viewer=Object.create(ctx.Viewer.prototype);
viewer.bounds=bounds;
viewer.geometry=meshes.map(item=>({meshId:item.meshId,bounds:boundsFor([item]),offset:[0,0,0],visible:true}));
viewer.requestRender=()=>{};
viewer.setExplodeOffsets(full);
assert.deepEqual(Array.from(viewer.geometry[0].offset),Array.from(full.get('m1')));
let dynamic=viewer.getVisibleBounds();
assert.ok(dynamic.size[0]>bounds.size[0] || dynamic.size[1]>bounds.size[1] || dynamic.size[2]>bounds.size[2],
  'displaced geometry extends beyond original fit bounds');
viewer.canvas={getBoundingClientRect:()=>({width:800,height:600})};
viewer.yaw=.7;viewer.pitch=.3;viewer.fit();
assert.ok(Number.isFinite(viewer.distance) && viewer.distance>0);
viewer.setExplodeOffsets(new Map());
assert.deepEqual(Array.from(viewer.geometry[0].offset),[0,0,0]);
assert.deepEqual(Array.from(viewer.getVisibleBounds().min),Array.from(bounds.min));
assert.deepEqual(Array.from(viewer.getVisibleBounds().max),Array.from(bounds.max));
viewer.setExplodeOffsets(full);
viewer.geometry[2].visible=false;
dynamic=viewer.getVisibleBounds();
assert.ok(dynamic.min.every(Number.isFinite));
// The depth-aware GPU picking pass must use the same per-mesh offset as rendering.
const recorded=[];
const mockGL=new Proxy({}, {get:(_,name)=>{
  if (name==='isEnabled') return()=>false;
  if (name==='uniform3fv') return (loc,value)=>recorded.push([loc,Array.from(value)]);
  if (name==='readPixels') return (_x,_y,_w,_h,_fmt,_type,pixels)=>pixels.set([1,0,0,255]);
  if (name==='createFramebuffer') return ()=>({});
  if (typeof name==='string' && name===name.toUpperCase()) return 1;
  return ()=>{};
}});
viewer.gl=mockGL;viewer.geometry=[{
  meshId:'m1',position:{},triangles:{},triangleCount:3,visible:true,
  offset:[9,10,11],pickColor:[1/255,0,0],
}];
viewer.pickLoc={position:2,matrix:3,color:4,offset:5};
viewer.pickBuffer={framebuffer:{}};
viewer.pickProgram={};
viewer.canvas={width:800,height:600,getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})};
viewer.cameraMatrix=()=>({matrix:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])});
ctx.window={devicePixelRatio:1};
ctx.pickMatrix=matrix=>matrix;
ctx.decodePickColor=(pixel)=>pixel[0];
assert.equal(viewer.pickMesh(400,300),'m1');
assert.ok(recorded.some(([loc,val])=>loc===5 && val.join(',')==='9,10,11'),
  'picking applies the correct mesh translation');
console.log('MS26 assembly grouping, coincident occurrences, collapse, selection, fit, GPU picking passed');
