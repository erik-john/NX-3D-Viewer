import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(import.meta.dirname,'..');
const {measurementSurface}=await import(pathToFileURL(`${root}/frontend/js/plane_measure.js`));
const {MeasurementUI}=await import(pathToFileURL(`${root}/frontend/js/measurement_ui.js`));
const near=(a,b,tol=1e-3)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);

// Half a cylindrical NX face, triangulated as a few narrow rectangles.
// STL-only fitting rejects partial arcs; NX's analytic radius should survive.
function halfCylinder(arcSegments=6,radius=10,zLength=30) {
  const triangles=[];
  for(let i=0;i<arcSegments;i++) {
    const a=Math.PI*i/arcSegments,b=Math.PI*(i+1)/arcSegments;
    const p=[radius*Math.cos(a),radius*Math.sin(a)];
    const q=[radius*Math.cos(b),radius*Math.sin(b)];
    triangles.push([[p[0],p[1],0],[q[0],q[1],0],[q[0],q[1],zLength]]);
    triangles.push([[p[0],p[1],0],[q[0],q[1],zLength],[p[0],p[1],zLength]]);
  }
  const positions=new Float32Array(triangles.flat(2));
  const indices=new Uint16Array(positions.length/3);
  for(let i=0;i<indices.length;i++) indices[i]=i;
  return {meshId:'root_b1',sourcePositions:positions,sourceIndices:indices,
    bounds:{size:[20,10,zLength]},visible:true,offset:[0,0,0],
    analyticalFaces:[{type:'cylinder',point:[0,0,0],axis:[0,0,1],
      bounds:[-radius,0,0,radius,radius,zLength],radius}]};
}
const nxToViewer=(v)=>[v[0],v[2],-v[1]];
const local=halfCylinder();
// Convert the test STL mesh into the same X,Z,-Y space used in the browser.
for(let i=0;i<local.sourcePositions.length;i+=3) {
  const p=nxToViewer(Array.from(local.sourcePositions.slice(i,i+3)));
  local.sourcePositions.set(p,i);
}
local.bounds.size=[20,30,10];
const hit={part:local,triangleIndex:3,point:nxToViewer([0,0,0])};
const noAnalytic=local.analyticalFaces;
local.analyticalFaces=[];
assert.notEqual(measurementSurface(hit)?.method,'nx_cad');
local.analyticalFaces=noAnalytic;
// Center of the clicked facet (rather than the exact cylinder outer radius).
const clicked=Array.from([0,1,2].map(k=>{
  const at=local.sourceIndices[9+k]*3;
  return Array.from(local.sourcePositions.slice(at,at+3));
})).reduce((s,p)=>s.map((v,i)=>v+p[i]/3),[0,0,0]);
hit.point=clicked;
const face=measurementSurface(hit);
assert.equal(face?.kind,'cylinder');
assert.equal(face.method,'nx_cad');
near(face.radius,10);assert.ok(face.faceCount>=8);
assert.equal(face.triangleIds.has(hit.triangleIndex),true);
const testMissingMetadata=halfCylinder();
assert.equal(testMissingMetadata.analyticalFaces[0].radius,10);
// Exclude a neighboring flat face with the same mesh but no radius agreement.
const wrong={...local,analyticalFaces:[{...noAnalytic[0],radius:4}]};
assert.notEqual(measurementSurface({...hit,part:wrong})?.method,'nx_cad');

function element(){
  const attrs=new Map();
  return {hidden:false,disabled:false,dataset:{},textContent:'',
    addEventListener(){},setAttribute(k,v){attrs.set(k,String(v));},
    removeAttribute(k){attrs.delete(k);},getAttribute(k){return attrs.get(k)||null;}};
}
const el=Object.fromEntries(['panel','summary','detail','overlay','line','pointA','pointB','arc','clear','fit']
  .map(name=>[name,element()]));
const viewer={canvas:{getBoundingClientRect:()=>({width:800,height:600})},
  cameraMatrix:()=>({matrix:[0.005,0,0,0,0,0.005,0,0,0,0,0.005,0,0,0,0,1]}),
  setMeasureFaces(){},fitMeasureFaces:()=>true};
const measurement=new MeasurementUI(viewer,el);
measurement.setActive(true);
measurement.select(face);
assert.match(el.summary.textContent,/20\.000/);
assert.match(el.detail.textContent,/NX analytical cylindrical face/);
assert.equal(el.overlay.dataset.kind,'diameter');
const start=Number(el.pointA.getAttribute('cx'))+Number(el.pointB.getAttribute('cx'));
local.offset=[40,12,-23];
measurement.update();
const end=Number(el.pointA.getAttribute('cx'))+Number(el.pointB.getAttribute('cx'));
near((end-start)/2,40*0.005*800/2); // project X shift into pixels
assert.match(el.summary.textContent,/20\.000/);
// Two possible overlapping CAD faces would be ambiguous: do not guess.
const duplicates={...local,analyticalFaces:[noAnalytic[0],{...noAnalytic[0]}]};
assert.notEqual(measurementSurface({...hit,part:duplicates})?.method,'nx_cad');
console.log('NX analytic half-cylinder: exact CAD radius, facet grouping, bounds checking, moves and ambiguous-face guard passed.');
