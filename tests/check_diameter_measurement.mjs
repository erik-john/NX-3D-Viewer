import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(import.meta.dirname,'..');
const {measurementSurface,planarPatch,cylindricalPatch,hitMeshGroup,evaluatePlanes}=await import(pathToFileURL(`${root}/frontend/js/plane_measure.js`));
const eq=(a,b,tol=0.05)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
function build(id,triangles) {
  const positions=new Float32Array(triangles.flat(2));
  const indices=new Uint16Array(positions.length/3);
  for(let i=0;i<indices.length;i++)indices[i]=i;
  const mins=[0,1,2].map(axis=>Math.min(...triangles.flat(1).map(p=>p[axis])));
  const maxs=[0,1,2].map(axis=>Math.max(...triangles.flat(1).map(p=>p[axis])));
  return {meshId:id,sourcePositions:positions,sourceIndices:indices,visible:true,offset:[0,0,0],
    bounds:{size:maxs.map((v,i)=>v-mins[i])}};
}
function disk(id,radius=10,segments=32,z=0) {
  const faces=[];
  for(let i=0;i<segments;i++) {
    const t=i*2*Math.PI/segments, t2=(i+1)*2*Math.PI/segments;
    faces.push([[0,0,z],[radius*Math.cos(t),radius*Math.sin(t),z],
      [radius*Math.cos(t2),radius*Math.sin(t2),z]]);
  }
  return build(id,faces);
}
function cylinder(id,radius=10,segments=32, top=20) {
  const faces=[];
  for(let i=0;i<segments;i++) {
    const t=i*2*Math.PI/segments,t2=(i+1)*2*Math.PI/segments;
    const a=[radius*Math.cos(t),radius*Math.sin(t),0];
    const b=[radius*Math.cos(t2),radius*Math.sin(t2),0];
    const c=[radius*Math.cos(t2),radius*Math.sin(t2),top];
    const d=[radius*Math.cos(t),radius*Math.sin(t),top];
    faces.push([a,b,c],[a,c,d]);
  }
  return build(id,faces);
}
function square(id) {return build(id,[[[-10,-10,0],[10,-10,0],[10,10,0]],
  [[-10,-10,0],[10,10,0],[-10,10,0]]]);}
const diskPart=disk('disk');
const diskHit={part:diskPart,triangleIndex:0,point:[5,0,0]};
const diskFace=measurementSurface(diskHit);
assert.equal(diskFace?.kind,'circle',`disk was ${diskFace?.kind}`);
eq(diskFace.radius,10);
const rectFace=measurementSurface({part:square('square'),triangleIndex:0,point:[0,0,0]});
assert.equal(rectFace?.kind,'plane');
assert.equal(rectFace?.radius,undefined);
const cyl=cylinder('cylinder');
const sample={part:cyl,triangleIndex:15,point:[-1,10,10]};
const cylinderFace=measurementSurface(sample);
assert.equal(cylinderFace?.kind,'cylinder',`cylinder was ${cylinderFace?.kind}`);
eq(cylinderFace.radius,10);
assert.ok(cylinderFace.faceCount>=32,`only ${cylinderFace.faceCount} cylinder facets`);
assert.equal(evaluatePlanes(cylinderFace,diskFace),null);
const extra=disk('another',10,32,40);
const secondDisk=measurementSurface({part:extra,triangleIndex:0,point:[5,0,40]});
const measured=evaluatePlanes(diskFace,secondDisk);
assert.equal(measured.kind,'distance');eq(measured.value,40);
// Low-quality or incomplete arcs may not masquerade as a measurable diameter.
const arc=cylinder('quarter',10,32,20);
const onlyTwoSides=build('arc',[...Array.from({length:4},(_,i)=>{
  const start=i*9;return Array.from({length:3},(_,j)=>[...arc.sourcePositions.subarray(start+j*3,start+j*3+3)]);
})]);
assert.notEqual(measurementSurface({part:onlyTwoSides,triangleIndex:0,point:[10,0,10]})?.kind,'cylinder');
console.log('MS37 diameter tests: 32-sided disk and cylinder Ø20, square rejection, two circular planar faces distance 40, incomplete cylinder rejection.');
