import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const { hitTriangle, rayForViewport, hitMeshGroup, planarPatch,
  evaluatePlanes, projectPoint }=await import(`file://${root}/frontend/js/plane_measure.js`);
const eq=(a,b,tol=1e-6)=> assert.ok(Math.abs(a-b)<tol,`${a} is not ${b}`);

// One square, two connected triangles. Reverse winding tests normals at 180°.
function face(meshId, a,b,c,d,offset=[0,0,0], reversed=false) {
  const vertices=reversed?[a,c,b,a,d,c]:[a,b,c,a,c,d];
  const positions=new Float32Array(vertices.flat());
  return {meshId,sourcePositions:positions,sourceIndices:new Uint16Array([0,1,2,3,4,5]),
    bounds:{size:[100,100,100]},visible:true,offset};
}
const square=(id,z,offset=[0,0,0],reversed=false)=>face(id,
  [-5,-5,z],[5,-5,z],[5,5,z],[-5,5,z],offset,reversed);
const lower=square('bottom',0),upper=square('upper',50);
const ray={origin:[0,0,200],direction:[0,0,-1]};
const h1=hitMeshGroup([lower,upper],'bottom',ray);
const h2=hitMeshGroup([lower,upper],'upper',ray);
assert.ok(h1&&h2);
const p1=planarPatch(h1),p2=planarPatch(h2);
assert.equal(p1.faceCount,2);assert.equal(p2.faceCount,2);
let result=evaluatePlanes(p1,p2);
assert.equal(result.kind,'distance');eq(result.value,50);
assert.equal(result.relation,'parallel');eq(result.angle,0);
assert.ok(result.to[2]-result.from[2]===50);

const flipped=square('flipped',50,[0,0,0],true);
result=evaluatePlanes(p1,planarPatch(hitMeshGroup([flipped],'flipped',ray)));
assert.equal(result.kind,'distance');eq(result.value,50);
assert.equal(result.relation,'parallel');eq(result.angle,180);
result=evaluatePlanes(p1,p1);
assert.equal(result.kind,'distance');eq(result.value,0);

const wall=face('wall',[0,-5,-5],[0,5,-5],[0,5,5],[0,-5,5]);
const hitWall={part:wall,triangleIndex:0,point:[0,0,0]};
const w=planarPatch(hitWall);
result=evaluatePlanes(p1,w);
assert.equal(result.kind,'angle');eq(result.value,90);
assert.equal(result.relation,'perpendicular');
const slope=face('slope',[-5,-5,-5],[5,-5,5],[5,5,5],[-5,5,-5]);
const tilted=planarPatch({part:slope,triangleIndex:1,point:[0,0,0]});
result=evaluatePlanes(p1,tilted);
assert.equal(result.kind,'angle');eq(result.value,45);
assert.equal(result.relation,'oblique');

// A single triangular cylindrical facet is not a recognized planar region.
const curved={meshId:'cylinder',sourcePositions:new Float32Array([
  0,0,0,1,0,0,0,1,0, 1,0,0,1,1,1,0,1,0]),
  sourceIndices:new Uint16Array([0,1,2,3,4,5]),
  bounds:{size:[1,1,1]},visible:true,offset:[0,0,0]};
assert.equal(planarPatch({part:curved,triangleIndex:0,point:[0.1,0.1,0]}),null);

const shifted=square('moved',10,[0,0,15]);
const moved=hitMeshGroup([shifted],'moved',ray);
eq(moved.point[2],25);
const movedPatch=planarPatch(moved);
assert.equal(evaluatePlanes(p1,movedPatch).kind,'distance');
eq(evaluatePlanes(p1,movedPatch).value,25);
shifted.visible=false;
assert.equal(hitMeshGroup([shifted],'moved',ray),null);

const horizontal=rayForViewport([0,0,30],[0,0,0],50,50,100,100);
assert.ok(horizontal);
eq(horizontal.direction[0],0);eq(horizontal.direction[1],0);eq(horizontal.direction[2],-1);
assert.equal(hitTriangle([0,0,2],[0,0,-1],[-1,-1,0],[1,-1,0],[0,1,0]),2);
const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
assert.deepEqual(projectPoint(identity,[0,0,0],200,100),[100,50]);

console.log('MS36 plane-patch detection, parallel 0°/180°, plane distance, acute angles, curved rejection, Move offsets and ray calculations passed.');
