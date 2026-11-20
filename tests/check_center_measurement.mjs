import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const {evaluateCircularCenters,evaluatePlanes}=await import(`file://${resolve(import.meta.dirname,'..')}/frontend/js/plane_measure.js`);
const eq=(a,b,tol=1e-5)=>assert.ok(Math.abs(a-b)<=tol,`expected ${b}, got ${a}`);
const circle=(center,axis=[0,0,1])=>({kind:'circle',center,axis,radius:5});
const cylinder=(center,axis=[0,0,1])=>({kind:'cylinder',center,axis,radius:5});
let res=evaluateCircularCenters(circle([0,0,0]),circle([30,40,0]));
assert.equal(res.kind,'center_distance');assert.equal(res.method,'circle_centers');eq(res.value,50);
assert.deepEqual(res.from,[0,0,0]);assert.deepEqual(res.to,[30,40,0]);
// A circular face has a unique center even if placed at another Z.
res=evaluateCircularCenters(circle([0,0,0]),circle([30,40,120]));eq(res.value,130);
// Cylinders have center axes, not single axial points. Compare radial spacing only.
res=evaluateCircularCenters(cylinder([0,0,-100]),cylinder([30,40,100]));
assert.equal(res.method,'axis_spacing');eq(res.value,50);assert.deepEqual(res.to,[30,40,-100]);
res=evaluateCircularCenters(circle([0,0,0]),cylinder([30,40,90]));eq(res.value,50);
res=evaluateCircularCenters(cylinder([0,0,20]),cylinder([0,0,90],[0,0,-1]));eq(res.value,0);
res=evaluateCircularCenters(cylinder([0,0,0],[0,0,1]),cylinder([30,40,90],[0,1,0]));assert.equal(res,null);
// Axes close enough to parallel for STL tessellation noise.
const tilted=[Math.sin(0.2*Math.PI/180),0,Math.cos(0.2*Math.PI/180)];
assert.ok(evaluateCircularCenters(cylinder([0,0,0]),cylinder([30,40,0],tilted)));
const beyond=[Math.sin(1*Math.PI/180),0,Math.cos(1*Math.PI/180)];
assert.equal(evaluateCircularCenters(cylinder([0,0,0]),cylinder([30,40,0],beyond)),null);
assert.equal(evaluateCircularCenters(circle([0,0,0]),{kind:'plane'}),null);
// Plane orientation display preserves both 0 and 180, and identifies 90.
const plane=(point,normal)=>({kind:'plane',point,normal});
res=evaluatePlanes(plane([0,0,0],[0,0,1]),plane([0,0,50],[0,0,1]));
assert.equal(res.relation,'parallel');eq(res.angle,0);eq(res.value,50);
res=evaluatePlanes(plane([0,0,0],[0,0,1]),plane([0,0,50],[0,0,-1]));
assert.equal(res.relation,'parallel');eq(res.angle,180);eq(res.value,50);
res=evaluatePlanes(plane([0,0,0],[0,0,1]),plane([0,0,0],[1,0,0]));
assert.equal(res.relation,'perpendicular');eq(res.value,90);
console.log('MS38 center spacing and orientation: 3D circle centers, parallel cylinder axes, mixed round features, opposite axes, nonparallel rejection, Move-compatible positions, 0/180 parallel & 90 perpendicular passed.');
