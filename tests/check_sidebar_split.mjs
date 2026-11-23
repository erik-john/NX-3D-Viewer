// Updated UI: the Structure panel contains the hierarchy only; all actions live in the header.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const html=readFileSync(resolve(root,'frontend/index.html'),'utf8');
const css=readFileSync(resolve(root,'frontend/css/style.css'),'utf8');
const js=readFileSync(resolve(root,'frontend/js/item_tree.js'),'utf8');
const menuLayer=html.slice(html.indexOf('id="header-menu-layer"'),html.indexOf('<main'));
const left=html.slice(html.indexOf('<aside class="tree-panel"'),html.indexOf('</aside>'));
assert.ok(left.includes('id="sidebar-structure"'));
assert.ok(left.includes('id="model-tree"'));
assert.ok(left.includes('id="tree-toggle"'));
assert.ok(!left.includes('id="sidebar-controls"'));
assert.ok(!left.includes('id="sidebar-splitter"'));
for (const id of ['tree-selection-actions','tree-move-actions','tree-opacity-actions'])
  assert.ok(menuLayer.includes(`id="${id}"`), `${id} must be in header dropdowns`);
assert.ok(css.includes('.tree-resizer'));
assert.ok(js.includes('pointerdown') && js.includes('ArrowRight'));
console.log('MS43 layout: header controls, left structure only, outer resize preserved.');
