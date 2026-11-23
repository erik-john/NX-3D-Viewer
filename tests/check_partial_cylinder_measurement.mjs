import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');
const {measurementSurface}=await import(pathToFileURL(`${root}/frontend/js/plane_measure.js`));
const {MeasurementUI}=await import(pathToFileURL(`${root}/frontend/js/measurement_ui.js`));

const near=(value,target,epsilon=1e-3)=>
  assert.ok(Math.abs(value-target)<=epsilon,`${value} differs from ${target}`);

function polygonalCylinder(segments,arc=Math.PI,radius=10,height=25) {
  const tris=[];
  for(let i=0;i<segments;i++) {
    const a=arc*i/segments,b=arc*(i+1)/segments;
    const p=[radius*Math.cos(a),radius*Math.sin(a)];
    const q=[radius*Math.cos(b),radius*Math.sin(b)];
    tris.push([[...p,0],[...q,0],[...q,height]],
      [[...p,0],[...q,height],[...p,height]]);
  }
  const coords=new Float32Array(tris.flat(2));
  return {meshId:'round-end',sourcePositions:coords,
    sourceIndices:Uint16Array.from({length:coords.length/3},(_,i)=>i),
    bounds:{size:[radius*2,radius*2,height]},offset:[0,0,0],visible:true,
    analyticalFaces:[]};
}
function clicked(part,segment) {
  const triangleIndex=segment*2;
  const points=Array.from({length:3},(_,k)=>
    Array.from(part.sourcePositions.slice(triangleIndex*9+k*3,triangleIndex*9+k*3+3)));
  const local=Array.from({length:3},(_,k)=>points.reduce((sum,p)=>sum+p[k],0)/3);
  return {part,triangleIndex,point:local.map((v,i)=>v+part.offset[i])};
}
for(const segments of [3,4,6,8,16]) {
  const part=polygonalCylinder(segments);
  const first=measurementSurface(clicked(part,1));
  assert.equal(first?.kind,'cylinder',`half-cylinder with ${segments} facets recognized`);
  assert.equal(first.method,'mesh_fit');
  near(first.radius,10);
  assert.equal(first.faceCount,segments*2);
  for(const segment of [0,segments-1]) {
    const other=measurementSurface(clicked(part,segment));
    assert.equal(other?.kind,'cylinder');
    near(other.radius,10);
    assert.ok(first.triangleIds.has(other.triangleIndex), 'full curved patch selected');
  }
}
// Two strips cannot uniquely establish a reliable curved surface.
const short=polygonalCylinder(2);
assert.notEqual(measurementSurface(clicked(short,0))?.kind,'cylinder');
// A shallow band could be a chamfer. Do not report an inferred diameter.
const chamfer=polygonalCylinder(8,Math.PI/6);
assert.notEqual(measurementSurface(clicked(chamfer,3))?.kind,'cylinder');

function element() {
  const attrs=new Map();
  return {hidden:false,disabled:false,dataset:{},textContent:'',
    addEventListener(){},setAttribute(key,value){attrs.set(key,String(value));},
    removeAttribute(key){attrs.delete(key);},getAttribute(key){return attrs.get(key)||null;}};
}
const elements=Object.fromEntries(['panel','summary','detail','overlay','line','pointA','pointB','center','arc','fit','clear']
  .map(key=>[key,element()]));
const viewer={canvas:{getBoundingClientRect:()=>({width:800,height:600})},
  cameraMatrix:()=>({matrix:[.01,0,0,0,0,.01,0,0,0,0,.01,0,0,0,0,1]}),
  setMeasureFaces(faces){this.selected=faces;},fitMeasureFaces(){return true;}};
const part=polygonalCylinder(6);
const ui=new MeasurementUI(viewer,elements);
ui.setActive(true);
ui.select(measurementSurface(clicked(part,2)));
assert.match(elements.summary.textContent,/20\.000/);
assert.match(elements.detail.textContent,/approximate/);
assert.equal(elements.overlay.dataset.kind,'diameter');
assert.equal(ui.faces.length,1);
ui.select(measurementSurface(clicked(part,4)));
assert.equal(ui.faces.length,1,'re-clicking different facet on same cylinder does not start a plane-angle measurement');
const old=Number(elements.center.getAttribute('cx'));
part.offset=[30,0,0];ui.update();
near(Number(elements.center.getAttribute('cx'))-old,30*800*.01/2);
console.log('Partial cylinder: 3-16 tessellation strips, single-click diameter, same-face selection, Move alignment and chamfer rejection passed.');
