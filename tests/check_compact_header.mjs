// Header follow-up: compact view actions, coupled explode toggle and restored viewport controls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const html=readFileSync(resolve(root,'frontend/index.html'),'utf8');
const js=readFileSync(resolve(root,'frontend/js/app.js'),'utf8');
const css=readFileSync(resolve(root,'frontend/css/style.css'),'utf8');
const header=html.slice(html.indexOf('<header'),html.indexOf('</header>'));
const viewport=html.slice(html.indexOf('<div class="viewport"'),html.indexOf('<aside class="inspector-panel"'));
const menus=html.slice(html.indexOf('id="header-menu-layer"'),html.indexOf('<main'));
assert.ok(!html.includes('id="header-select"'));
assert.ok(!html.includes('id="header-unexplode"'));
assert.ok(header.includes('id="header-explode"') && header.includes('aria-pressed="false"'));
assert.match(js,/button\.textContent = exploded \? 'Collapse' : 'Explode'/);
assert.ok(header.includes('id="viewer-menu-toggle"'));
assert.ok(header.includes('id="measure-planes-toggle"'));
assert.ok(viewport.includes('class="viewport-view-tools"'));
assert.ok(viewport.includes('id="component-color-toggle"'));
for (const name of ['iso','front','top','right']) {
  assert.ok(menus.includes(`data-view="${name}"`));
  assert.ok(viewport.includes(`data-view="${name}"`));
}
for (const name of ['component-menu','transparency-menu','viewer-menu','fit-menu-button',
                    'component-color-menu-button','isolate-selected','move-selected','component-opacity-slider',
                    'reset-transparency-all']) {
  assert.ok(menus.includes(`id="${name}"`),name);
}
assert.ok(header.includes('id="component-opacity-value"'));
assert.ok(!header.includes('id="reset-transparency-all"'));
assert.ok(!header.includes('id="component-opacity-slider"'));
assert.match(css,/\.header-menu-layer \{ position: fixed/);
assert.match(css,/\.toolbar-scroll \{ overflow-x: hidden/);
console.log('Compact header: all controls and view toolbar present.');
