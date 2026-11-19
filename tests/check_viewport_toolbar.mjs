import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
const read = p => readFileSync(resolve(root,p),'utf8');
const html=read('frontend/index.html');
const css=read('frontend/css/style.css');
const app=read('frontend/js/app.js');
const stl=read('frontend/js/stl.js');
const viewer=read('frontend/js/viewer.js');
const header=html.match(/<header[\s\S]*?<\/header>/)?.[0];
const viewport=html.match(/<div class="viewport"[\s\S]*?<aside class="inspector-panel"/)?.[0];
assert.ok(header && viewport, 'header and workspace must exist');
assert.ok(header.includes('id="open-nx-button"'));
assert.ok(!header.includes('data-view='));
assert.ok(!header.includes('DISPLAY'));
for(const view of ['iso','front','top','right']) {
  assert.ok(viewport.includes(`data-view="${view}"`), view);
}
assert.ok(viewport.includes('id="fit-button"'));
assert.match(viewport, /class="viewport-view-tools" role="group" aria-label="Camera views"/);
assert.equal((viewport.match(/class=\"viewport-view-button/g)||[]).length,5);
assert.ok(!viewport.includes('viewport-mouse-'));
for(const label of ['Isometric view','Front view','Top view','Right view','Fit model to view']){
  assert.ok(viewport.includes(`aria-label="${label}"`),label);
}
for (const name of ['grid-button','axes-button','wire-button']) {
  assert.ok(!html.includes(`id="${name}"`), name);
  assert.ok(!app.includes(`$('${name}')`), name);
}
assert.ok(app.includes("const views = { '1': 'iso', '2': 'front', '3': 'top', '4': 'right' }"));
assert.ok(app.includes("event.key.toLowerCase() === 'f'"));
assert.match(stl, /color: '#dee1e3'/);
assert.match(viewer, /float diffuse = 0\.50 \+ 0\.34 \* key/);
assert.match(viewer, /this\.showGrid = false/);
assert.match(viewer, /this\.showAxes = true/);
assert.match(css, /\.inspector-row dt[^}]*color: #3e5260/);
assert.match(css, /\.inspector-row\s*\{[^}]*font-size: 13px/s);
assert.match(css, /\.viewport-view-button\.active/);
assert.match(css, /\.viewport-view-tools \{[^}]*position: absolute/s);
assert.ok(!css.includes('viewport-mouse-'));
console.log('MS18 view toolbar intact; mouse help dock absent.');
