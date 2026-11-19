import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '..');
const viewerSource = readFileSync(resolve(root, 'frontend/js/viewer.js'), 'utf8');
const css = readFileSync(resolve(root, 'frontend/css/style.css'), 'utf8');
const html = readFileSync(resolve(root, 'frontend/index.html'), 'utf8');
const stl = readFileSync(resolve(root, 'frontend/js/stl.js'), 'utf8');
assert.match(stl, /color: '#dee1e3'/);
assert.match(viewerSource, /uniform vec3 uEye/);
assert.match(viewerSource, /float broad = pow/);
assert.match(css, /color-scheme: light/);
assert.match(css, /\.tree-panel\s*\{[^}]*background: #ffffff/s);
assert.match(css, /\.inspector-panel\s*\{[^}]*background: #ffffff/s);
assert.match(css, /\.app-header\.toolbar\s*\{[^}]*background: linear-gradient\(110deg, #ffffff/s);
assert.match(html, /meta name="color-scheme" content="light"/);
for (const id of ['compass-axis-x', 'compass-axis-y', 'compass-axis-z', 'compass-label-x', 'compass-label-y', 'compass-label-z']) {
  assert.ok(html.includes(`id="${id}"`), id);
}
const source = viewerSource.replace(/^import .+\r?\n/gm, '').replace('export class Viewer', 'class Viewer') +
  '\nthis.Viewer=Viewer; this.makeDatum=makeDatum;';
const ctx = { Math, Float32Array, Uint16Array, Set };
vm.runInNewContext(source, ctx);
const datum = ctx.makeDatum({size:[20,10,15],min:[0,0,0],max:[20,10,15],center:[10,5,7.5]});
assert.equal(datum.planeCount, 3);
assert.equal(datum.planePositions.length, 54);
const compassAxes = Array.from({length:3}, () => ({style:{}}));
const compassLabels = Array.from({length:3}, () => ({style:{}}));
const viewer = Object.create(ctx.Viewer.prototype);
viewer.yaw = Math.PI/4; viewer.pitch = 0.46;
viewer.compassAxes = compassAxes; viewer.compassLabels = compassLabels;
viewer.renderCompass();
const before = compassLabels.map(n=>n.style.left);
viewer.yaw = -Math.PI/4;
viewer.renderCompass();
assert.notDeepEqual(compassLabels.map(n=>n.style.left),before,'compass follows camera');
console.log('Steel theme, 3 NX planes, axis compass, white header and panels verified.');
