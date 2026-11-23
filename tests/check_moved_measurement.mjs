import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');
const {measurementSurface}=await import(pathToFileURL(`${root}/frontend/js/plane_measure.js`));
const {MeasurementUI}=await import(pathToFileURL(`${root}/frontend/js/measurement_ui.js`));
const near=(actual,expected,tolerance=0.05)=>assert.ok(Math.abs(actual-expected)<=tolerance,
  `expected ${expected}, got ${actual}`);
function partForDisk(meshId,cx=0,offset=[0,0,0]) {
  const triangles=[];const segments=32,radius=10;
  for(let i=0;i<segments;i++){
    const t=i*2*Math.PI/segments,t2=(i+1)*2*Math.PI/segments;
    triangles.push([[cx,0,0],[cx+radius*Math.cos(t),radius*Math.sin(t),0],
      [cx+radius*Math.cos(t2),radius*Math.sin(t2),0]]);
  }
  const points=triangles.flat(2),sourcePositions=new Float32Array(points);
  const sourceIndices=new Uint16Array(points.length/3);
  for(let i=0;i<sourceIndices.length;i++)sourceIndices[i]=i;
  return {meshId,sourcePositions,sourceIndices,visible:true,offset,
    bounds:{size:[20,20,0]}};
}
function partForCylinder(meshId,offset) {
  const triangles=[],radius=10;
  for(let i=0;i<32;i++){
    const t=i*2*Math.PI/32,t2=(i+1)*2*Math.PI/32;
    const a=[radius*Math.cos(t),radius*Math.sin(t),0];
    const b=[radius*Math.cos(t2),radius*Math.sin(t2),0];
    const c=[radius*Math.cos(t2),radius*Math.sin(t2),20];
    const d=[radius*Math.cos(t),radius*Math.sin(t),20];
    triangles.push([a,b,c],[a,c,d]);
  }
  const pts=triangles.flat(2),sourcePositions=new Float32Array(pts);
  const sourceIndices=new Uint16Array(pts.length/3);
  for(let i=0;i<sourceIndices.length;i++)sourceIndices[i]=i;
  return {meshId,sourcePositions,sourceIndices,visible:true,offset,bounds:{size:[20,20,20]}};
}
function faceOnDisk(part,localPoint) {
  const point=localPoint.map((v,i)=>v+part.offset[i]);
  const face=measurementSurface({part,triangleIndex:0,point});
  assert.equal(face?.kind,'circle');
  return face;
}
function element() {
  const attributes=new Map();
  return {hidden:false,disabled:false,dataset:{},textContent:'',
    addEventListener(){},setAttribute(key,value){attributes.set(key,String(value));},
    getAttribute(key){return attributes.get(key)??null;},
    removeAttribute(key){attributes.delete(key);}};
}
function createMeasurement() {
  const el=Object.fromEntries(['panel','summary','detail','overlay','line',
    'pointA','pointB','arc','clear','fit'].map(name=>[name,element()]));
  const viewer={canvas:{getBoundingClientRect:()=>({width:800,height:600})},
    cameraMatrix:()=>({matrix:[.005,0,0,0,0,.005,0,0,0,0,.005,0,0,0,0,1]}),
    setMeasureFaces(){},fitMeasureFaces:()=>true};
  return {measurement:new MeasurementUI(viewer,el),el};
}
const first=partForDisk('a',0,[0,0,0]);
const second=partForDisk('b',50,[40,30,0]);
const movedFace=faceOnDisk(second,[55,0,0]);
near(movedFace.center[0],90);near(movedFace.center[1],30);
near(movedFace.center[2],0);
const {measurement,el}=createMeasurement();
measurement.setActive(true);
measurement.select(faceOnDisk(first,[5,0,0]));
measurement.select(movedFace);
assert.equal(el.overlay.dataset.kind,'center_distance');
assert.match(el.summary.textContent,/94\.868/);
near(Number(el.pointA.getAttribute('cx')),400);
near(Number(el.pointA.getAttribute('cy')),300);
near(Number(el.pointB.getAttribute('cx')),580);
near(Number(el.pointB.getAttribute('cy')),255);
// Move again *after* measurement selection: the guide follows without re-picking.
second.offset=[70,40,0];
measurement.update();
assert.match(el.summary.textContent,/126\.491/);
near(Number(el.pointB.getAttribute('cx')),640);
near(Number(el.pointB.getAttribute('cy')),240);
// Also check circular diameter highlight after moving a disk.
measurement.clear();
measurement.select(faceOnDisk(second,[55,0,0]));
assert.equal(el.overlay.dataset.kind,'diameter');
assert.match(el.summary.textContent,/20\.000/);
near(Number(el.pointA.getAttribute('cx'))+Number(el.pointB.getAttribute('cx')),2*(400+120*.005*400));
// A moved cylinder must report a full world-space center (including lateral offsets).
const cylinder=partForCylinder('c',[80,-45,15]);
const cylindrical=measurementSurface({part:cylinder,triangleIndex:15,point:[79, -35, 25]});
assert.equal(cylindrical?.kind,'cylinder');
near(cylindrical.center[0],80);near(cylindrical.center[1],-45);
near(cylindrical.center[2],25);
console.log('Moved/Exploded measurement: circle and cylinder centers, guide endpoints, live offset tracking, and diameter overlay passed.');
