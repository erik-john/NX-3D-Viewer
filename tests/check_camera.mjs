// Check camera framing from the delivered viewer math without GPU dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(resolve(import.meta.dirname, '../frontend/js/viewer.js'), 'utf8')
  .replace(/^import .+\r?\n/gm, '')
  .replace('export class Viewer', 'class Viewer') +
  '\nthis.Viewer = Viewer; this.makeGrid = makeGrid; this.EMPTY_VIEW_DISTANCE = EMPTY_VIEW_DISTANCE;';
const context = { Math, Float32Array, Uint16Array, Set };
vm.runInNewContext(source, context, { filename: 'viewer.js' });
const { Viewer, makeGrid, EMPTY_VIEW_DISTANCE } = context;

function fit(bounds, width, height, yaw, pitch) {
  const viewer = Object.create(Viewer.prototype);
  viewer.canvas = { getBoundingClientRect: () => ({ width, height }) };
  viewer.geometry = [{}];
  viewer.bounds = bounds;
  viewer.yaw = yaw;
  viewer.pitch = pitch;
  viewer.requestRender = () => {};
  viewer.fit();
  return viewer;
}
const dot = (a, b) => a.reduce((acc, value, i) => acc + value * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const normalize = (a) => a.map(n => n / Math.hypot(...a));
function checkAllCorners(bounds, width, height, yaw, pitch) {
  const viewer = fit(bounds, width, height, yaw, pitch);
  const outward = normalize([Math.cos(pitch)*Math.sin(yaw), Math.sin(pitch), Math.cos(pitch)*Math.cos(yaw)]);
  const right = normalize(cross([0,1,0], outward));
  const up = cross(outward, right);
  const tanV = Math.tan(Math.PI / 8), tanH = tanV * Math.max(0.3, width/height);
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const offset = [x,y,z].map((v,i) => v - viewer.target[i]);
        const depth = viewer.distance - dot(offset, outward);
        assert.ok(depth > 0, 'model must be in front of the camera');
        const nx = Math.abs(dot(offset, right)) / (depth * tanH);
        const ny = Math.abs(dot(offset, up)) / (depth * tanV);
        assert.ok(nx <= 0.801 && ny <= 0.801, `corner clipped: normalized (${nx}, ${ny})`);
      }
    }
  }
}
function bounds(min, max) {
  return { min, max, center:min.map((v,i) => (v+max[i])/2), size:min.map((v,i) => max[i]-v) };
}
const cases = [
  bounds([-1,-1,-1],[1,1,1]),
  bounds([-2000,-12,-15],[2200,13,10]),
  bounds([-3,-1000,-2],[4,1200,4]),
  bounds([1298,3400,90000],[1300,3402,90003]),
  bounds([-500,-150,-250],[500,150,250]),
];
for (const shape of cases) {
  for (const [width,height] of [[1440,800],[450,900],[900,450],[260,900]]) {
    for (const [yaw,pitch] of [[Math.PI/4,0.46],[0,0],[0,Math.PI/2-0.0001],[Math.PI/2,0],[-Math.PI/3,-0.3]]) {
      checkAllCorners(shape,width,height,yaw,pitch);
    }
  }
}

const viewer = Object.create(Viewer.prototype);
viewer.canvas = { getBoundingClientRect: () => ({ width: 1300, height: 740 }) };
viewer.geometry = [];
viewer.bounds = bounds([0,0,0],[0,0,0]);
viewer.requestRender = () => {};
viewer.fit();
assert.ok(viewer.distance >= 10, 'empty workspace must start zoomed out');
assert.equal(viewer.distance, EMPTY_VIEW_DISTANCE);
assert.deepEqual(Array.from(viewer.target), [0,0,0]);
const empty = makeGrid(viewer.bounds, true);
assert.ok(Math.max(...empty.positions) > 10, 'empty grid must extend beyond the original +/-5');
viewer.geometry = [{}];
viewer.bounds = cases[0];
viewer.yaw = Math.PI/4;
viewer.pitch = 0.46;
viewer.fit();
assert.ok(viewer.distance < EMPTY_VIEW_DISTANCE, 'small loaded item should be framed appropriately');
console.log('Camera tests passed: zoomed-out empty grid and full model fit at 100 camera/viewport combinations.');
