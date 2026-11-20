// MS31: NX-axis screen projection, click-drag distances and independent offsets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'..');
const source=readFileSync(resolve(root,'frontend/js/component_move.js'),'utf8')
  .replace(/^export /gm,'');
const ctx={ Math, Object, Map, Number };
vm.runInNewContext(source+'\nthis.api={MOVE_AXES,projectWorld,projectedAxis,dragAxisDistance};',ctx);
const {MOVE_AXES,projectWorld,projectedAxis,dragAxisDistance}=ctx.api;
assert.deepEqual(Array.from(MOVE_AXES.X),[1,0,0]);
assert.deepEqual(Array.from(MOVE_AXES.Y),[0,0,-1], 'NX Y maps to WebGL -Z');
assert.deepEqual(Array.from(MOVE_AXES.Z),[0,1,0], 'NX Z maps to WebGL +Y');
const matrix=new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
assert.equal(projectWorld([0,0,0],matrix,800,600).x,400);
assert.equal(projectWorld([0,0,0],matrix,800,600).y,300);
assert.ok(projectedAxis([0,0,0],MOVE_AXES.X,matrix,800,600));
assert.ok(projectedAxis([0,0,0],MOVE_AXES.Z,matrix,800,600));
assert.equal(projectedAxis([0,0,0],MOVE_AXES.Y,matrix,800,600),null,
  'end-on axis must be hidden instead of creating an unstable drag');
const x=projectedAxis([0,0,0],MOVE_AXES.X,matrix,800,600);
assert.ok(Math.abs(dragAxisDistance(0,0,30,0,x)-x.calibration*30/x.pixels)<1e-5);
assert.ok(Math.abs(dragAxisDistance(0,0,0,30,x))<1e-5);
assert.equal(projectWorld([0,0,0],new Float32Array(16),800,600),null);

const viewerSource=readFileSync(resolve(root,'frontend/js/viewer.js'),'utf8')
  .replace(/^import .*?;\s*$/gm,'').replace('export class Viewer','class Viewer');
const context={Math,Map,Set,Float32Array,Uint16Array,Uint8Array};
vm.runInNewContext(viewerSource+'\nthis.Viewer=Viewer;',context);
const viewer=Object.create(context.Viewer.prototype);
viewer.geometry=[
  {meshId:'A',offset:[0,0,0],visible:true,bounds:{min:[0,0,0],max:[2,2,2]}},
  {meshId:'B',offset:[0,0,0],visible:true,bounds:{min:[10,0,0],max:[12,2,2]}},
];
viewer.requestRender=()=>{};
viewer.setExplodeOffsets(new Map([['A',[3,2,1]]]));
assert.deepEqual(Array.from(viewer.geometry[0].offset),[3,2,1]);
viewer.setManualOffsets(new Map([['A',[2,0,-1]],['B',[0,5,0]]]));
assert.deepEqual(Array.from(viewer.geometry[0].offset),[5,2,0]);
assert.deepEqual(Array.from(viewer.geometry[1].offset),[0,5,0]);
viewer.setManualOffsets(new Map());
assert.deepEqual(Array.from(viewer.geometry[0].offset),[3,2,1],
 'reset manual movement preserves explosion');
viewer.setExplodeOffsets(new Map());
assert.deepEqual(Array.from(viewer.geometry[0].offset),[0,0,0]);
viewer.setManualOffsets(new Map([['A',[0,5,0]]]));
viewer.setExplodeOffsets(new Map([['A',[-2,0,0]]]));
assert.deepEqual(Array.from(viewer.geometry[0].offset),[-2,5,0],
 'exploding after manual movement preserves manual offset');
const bounds=viewer.boundsForParts(viewer.geometry);
assert.ok(bounds.max[1]>=7,'camera fit includes manual plus exploded position');
assert.deepEqual(Array.from(viewer.geometry[1].offset),[0,0,0],
 'repeated component occurrences translate independently');
const html=readFileSync(resolve(root,'frontend/index.html'),'utf8');
const app=readFileSync(resolve(root,'frontend/js/app.js'),'utf8');
for(const id of ['tree-move-actions','move-selected','reset-move-selected','reset-move-all','move-gizmo'])
  assert.ok(html.includes(`id="${id}"`),id);
assert.ok(!html.includes('id="assembly-tools"'),'old floating explode panel stays removed');
assert.ok(app.includes('manualGroupOffsets'), 'manual offsets stored by component occurrence');
assert.ok(app.includes('viewer.setManualOffsets(offsets)'),'manual displacement fed to renderer');
console.log('MS31: NX axes, screen projection, drag, independent motion and explode state passed');
