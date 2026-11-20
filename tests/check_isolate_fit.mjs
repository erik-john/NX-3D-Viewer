// MS29: selected-only camera framing, exploded offsets and disabled/hidden geometry.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'frontend/js/viewer.js'), 'utf8')
  .replace(/^import .*?;\s*$/gm, '').replace('export class Viewer', 'class Viewer');
const context = { Math, Float32Array, Uint16Array, Uint8Array, Set, Map };
vm.runInNewContext(source + '\nthis.Viewer = Viewer;', context);
const viewer = Object.create(context.Viewer.prototype);
const bounds = (min, max) => ({min, max, center:min.map((x,i)=>(x+max[i])/2),
  size:min.map((x,i)=>max[i]-x)});
viewer.canvas = { getBoundingClientRect:()=>({width:1000,height:650}) };
viewer.bounds = bounds([0,0,0],[42,2,4]);
viewer.geometry = [
  { meshId:'a', bounds:bounds([0,0,0],[2,2,2]), offset:[0,0,0], visible:true },
  { meshId:'b', bounds:bounds([40,0,0],[42,2,2]), offset:[12,0,4], visible:true },
];
viewer.yaw=Math.PI/3; viewer.pitch=.4; viewer.target=[0,0,0];
viewer.distance=1000; viewer.requestRender=()=>{};
const angle=[viewer.yaw,viewer.pitch];
assert.equal(viewer.fitMeshIds(['a']),true);
assert.deepEqual(Array.from(viewer.target),[1,1,1], 'camera aims at selected mesh only');
assert.ok(viewer.distance<1000);
assert.deepEqual([viewer.yaw,viewer.pitch],angle,'fit preserves current camera orientation');
assert.equal(viewer.fitMeshIds(['b']),true);
assert.deepEqual(Array.from(viewer.target),[53,1,5], 'fit accounts for current explosion offset');
const previous = [...viewer.target];
assert.equal(viewer.fitMeshIds(['not-a-mesh']),false,'unmatched selection cannot change camera');
assert.deepEqual(Array.from(viewer.target), previous);
viewer.setMeshVisible('b',false);
assert.equal(viewer.fitMeshIds(['b']),false,'hidden items cannot be fitted');
assert.deepEqual(Array.from(viewer.target), previous);
assert.equal(viewer.fitMeshIds(['a','b']),true, 'visible subset still fits');
assert.deepEqual(Array.from(viewer.target),[1,1,1]);
assert.equal(viewer.geometry[0].visible,true,'camera framing does not change visibility');
assert.deepEqual(Array.from(viewer.geometry[1].offset),[12,0,4], 'camera framing does not change exploded geometry');
viewer.setMeshVisible('b',true);
assert.equal(viewer.fitMeshIds(['a','b']),true);
assert.ok(viewer.target[0]>1 && viewer.target[0]<53,'group frame includes both component locations');

const html=readFileSync(resolve(root,'frontend/index.html'),'utf8');
const app=readFileSync(resolve(root,'frontend/js/app.js'),'utf8');
const css=readFileSync(resolve(root,'frontend/css/style.css'),'utf8');
for (const id of ['tree-selection-actions','isolate-selected','fit-selected']) {
  assert.ok(html.includes(`id="${id}"`),`missing tree control ${id}`);
}
assert.ok(!html.includes('id="assembly-tools"'), 'MS28 removed floating panel stays removed');
assert.ok(app.includes('isolated?.previous || new Map'), 'isolation retains the original visibility snapshot');
assert.ok(app.includes('tree.setVisibilityFromMeshes(map)'), 'the checkboxes track visibility changes');
assert.ok(css.includes('.tree-selection-actions[hidden]'), 'controls are hidden until a model loads');
console.log('MS29 selected camera fit, explode offsets, visibility restoration UI checks passed');
