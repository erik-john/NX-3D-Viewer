import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const {planarPatch, evaluatePlanes, nearestPlanarPatchGap}=await import(`file://${resolve(import.meta.dirname,'..')}/frontend/js/plane_measure.js`);
const eq=(a,b,tol=1e-5)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
function plane(id,corners,offset=[0,0,0]) {
  const p=new Float32Array([...corners[0],...corners[1],...corners[2],...corners[0],...corners[2],...corners[3]]);
  const part={meshId:id,sourcePositions:p,sourceIndices:new Uint16Array([0,1,2,3,4,5]),
    offset,visible:true,bounds:{size:[100,100,100]}};
  const center=corners[0].map((_,i)=>corners.reduce((s,v)=>s+v[i],0)/4);
  return planarPatch({part,triangleIndex:0,point:center.map((v,i)=>v+offset[i])});
}
const bottom=plane('bottom',[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]]);
const wall=plane('wall',[[10,-1,0],[10,1,0],[10,1,2],[10,-1,2]]);
let gap=nearestPlanarPatchGap(bottom,wall);
assert.equal(gap.method,'finite_patch');eq(gap.value,9);eq(gap.from[0],1);eq(gap.to[0],10);
let result=evaluatePlanes(bottom,wall);
assert.equal(result.kind,'angle');eq(result.value,90);eq(result.gap,9);
assert.equal(result.gapMethod,'finite_patch');
wall.part.offset=[2,0,0];
result=evaluatePlanes(bottom,wall);eq(result.gap,11);
wall.part.offset=[-10,0,0];
result=evaluatePlanes(bottom,wall);eq(result.gap,0);
const slope=plane('slope',[[10,-1,0],[12,-1,2],[12,1,2],[10,1,0]]);
result=evaluatePlanes(bottom,slope);
assert.equal(result.kind,'angle');eq(result.angle,45);
assert.ok(result.gap>0);assert.equal(result.gapMethod,'finite_patch');
const aligned=plane('top',[[-1,-1,5],[1,-1,5],[1,1,5],[-1,1,5]]);
result=evaluatePlanes(bottom,aligned);
assert.equal(result.kind,'distance');eq(result.value,5);eq(result.angle,0);
const withoutMesh=evaluatePlanes({kind:'plane',normal:[0,0,1],point:[0,0,0]},
  {kind:'plane',normal:[1,0,0],point:[3,4,0]});
assert.equal(withoutMesh.gapMethod,'picked_points');eq(withoutMesh.gap,5);
console.log('MS39: finite plane-patch gaps, intersection, moved components, 45/90 angles, parallel distance and non-mesh fallback passed.');
