import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const base = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(base, 'frontend/js/viewer.js'), 'utf8')
  .replace(/^import .+\r?\n/m, '')
  .replace('export class Viewer', 'class Viewer') +
  '\nthis.Viewer = Viewer; this.makeDatum = makeDatum; this.makeGrid = makeGrid;';
const ctx = { Math, Float32Array, Uint16Array, Set, window: {devicePixelRatio:1} };
vm.runInNewContext(source, ctx, { filename: 'viewer.js' });
const { makeDatum, makeGrid, Viewer } = ctx;
const bounds = { min: [-10,-5,-7], max: [10,5,7], center: [0,0,0], size: [20,10,14] };
const datum = makeDatum(bounds);
assert.equal(datum.axesPositions.length, 18, 'three distinct X/Y/Z axes');
assert.equal(datum.planePositions.length, 54, 'three rectangular reference planes, six vertices each');
assert.equal(datum.outlinePositions.length, 72, 'three plane outlines (four edges each)');
assert.equal(datum.labels.length, 3);
assert.equal(datum.planeCount, 3, 'exactly three NX reference planes');
assert.deepEqual(Array.from(datum.labels[0]), [datum.labels[0][0],0,0], 'NX X points along +web X');
assert.ok(datum.labels[0][0] > 0, 'NX +X');
assert.ok(datum.labels[1][2] < 0, 'NX +Y points along viewer -Z');
assert.ok(datum.labels[2][1] > 0, 'NX +Z points along viewer +Y');

assert.equal(datum.planeColors.length, 72, 'per-vertex RGBA colors');
for (const alpha of Array.from(datum.planeColors).filter((_,index)=>index%4===3)) {
  assert.ok(alpha > 0 && alpha < 0.3, 'datum planes should be subtle and translucent');
}
for (const planeIndex of [0, 1, 2]) {
  const coords = datum.planePositions.slice(planeIndex*18,planeIndex*18+18);
  const constAxis = [1,0,2][planeIndex];
  for (let i=constAxis;i<coords.length;i+=3) assert.equal(coords[i],0, 'datum plane passes through origin');
}
const grid = makeGrid(bounds);
assert.ok(grid.positions.length > 0, 'GRID remains available by toggle');
assert.equal(grid.axesPositions, undefined, 'the grid no longer owns the axes');
assert.ok(source.includes('this.showGrid = false;'), 'grid defaults off');
assert.ok(source.includes('this.showAxes = true;'), 'axes and planes default on');
const html = readFileSync(resolve(base,'frontend/index.html'),'utf8');
assert.doesNotMatch(html, /id="grid-button"/);
assert.doesNotMatch(html, /id="axes-button"/);
assert.doesNotMatch(html, /id="wire-button"/);
for (const letter of 'xyz') assert.ok(html.includes(`id="axis-label-${letter}"`));
const css = readFileSync(resolve(base,'frontend/css/style.css'),'utf8');
assert.match(css, /#viewer-viewport\s*\{\s*background:\s*linear-gradient/);

const labels = Array.from({length:3}, () => ({hidden:true,style:{}}));
const viewer = Object.create(Viewer.prototype);
viewer.showAxes = true;
viewer.datumLabels = datum.labels;
viewer.axisLabels = labels;
const matrix = new Float32Array([0.1,0,0,0, 0,0.1,0,0, 0,0,0.1,0, 0,0,0,1]);
viewer.renderAxisLabels(matrix, {width:1000,height:700});
assert.equal(labels[0].hidden,false);
assert.ok(labels[0].style.left.endsWith('px'));
viewer.showAxes = false;
viewer.renderAxisLabels(matrix, {width:1000,height:700});
assert.equal(labels.every(label=>label.hidden), true, 'AXES hides all labels');
const drawn = [];
const gl = new Proxy({ TRIANGLES: 4, LINES: 1, COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100 }, {
  get: (target, key) => target[key] ?? (() => {}),
});
const renderer = Object.create(Viewer.prototype);
renderer.gl = gl;
renderer.canvas = { width:0, height:0, getBoundingClientRect:() => ({width:800,height:500}) };
renderer.geometry = [];
renderer.gridBuffers = { position:'grid', color:'grid-color', count:3, planePosition:'plane', planeColor:'plane-color', planeCount:18,
  outlinePosition:'outline', outlineColor:'outline-color', outlineCount:24,
  axesPosition:'axes', axesColor:'axes-color', axesCount:6 };
renderer.solid = {};
renderer.solidLoc = { matrix:{}, wire:{} };
renderer.yaw = Math.PI/4;
renderer.pitch = 0.46;
renderer.distance = 11.5;
renderer.target = [0,0,0];
renderer.showGrid = false;
renderer.showAxes = true;
renderer.wireframe = false;
renderer.renderLines = (pos, _, count, __, primitive) => drawn.push({pos, count, primitive});
renderer.renderAxisLabels = () => {};
renderer.render();
assert.equal(drawn.some(call=>call.pos==='grid'), false, 'grid does not render by default');
assert.equal(drawn.some(call=>call.pos==='plane' && call.primitive===gl.TRIANGLES), true, 'datum-plane fill renders');
assert.equal(drawn.some(call=>call.pos==='axes'), true, 'coordinate axes render');
drawn.length = 0;
renderer.showGrid = true;
renderer.showAxes = false;
renderer.render();
assert.equal(drawn.some(call=>call.pos==='grid'), true, 'grid remains available');
assert.equal(drawn.some(call=>call.pos==='plane'), false, 'AXES off also hides planes');
assert.equal(drawn.some(call=>call.pos==='axes'), false, 'AXES off hides axes');
console.log('Reference plane checks passed: X/Y/Z geometry, opacity, origin, defaults, labels and grid independence.');
