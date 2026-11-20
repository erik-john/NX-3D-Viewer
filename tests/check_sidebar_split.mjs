// MS32: left sidebar separates controls from structure without visual titles.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const html=readFileSync(resolve(root,'frontend/index.html'),'utf8');
const css=readFileSync(resolve(root,'frontend/css/style.css'),'utf8');
const js=readFileSync(resolve(root,'frontend/js/item_tree.js'),'utf8');
assert.ok(html.includes('id="sidebar-controls"') && html.includes('id="sidebar-structure"'));
assert.ok(html.includes('id="sidebar-splitter"') && html.includes('aria-orientation="horizontal"'));
assert.ok(html.includes('aria-controls="sidebar-controls sidebar-structure"'));
const controlStart=html.indexOf('id="sidebar-controls"');
const divider=html.indexOf('id="sidebar-splitter"');
const structureStart=html.indexOf('id="sidebar-structure"');
const endAside=html.indexOf('</aside>',controlStart);
assert.ok(controlStart < divider && divider < structureStart && structureStart < endAside);
for (const id of ['tree-selection-actions','tree-move-actions']) {
  const index=html.indexOf(`id="${id}"`);
  assert.ok(index>controlStart && index<divider,`${id} belongs above the divider`);
}
for (const id of ['tree-summary','model-tree','tree-note']) {
  const index=html.indexOf(`id="${id}"`);
  assert.ok(index>structureStart && index<endAside,`${id} belongs below the divider`);
}
assert.ok(!html.includes('class="tree-heading-copy"'), 'no redundant panel titles');
for (const name of ['.sidebar-controls','.sidebar-splitter','.sidebar-structure', '.tree-resizer']) {
  assert.ok(css.includes(name), `CSS missing ${name}`);
}
for (const command of ['pointerdown','pointermove','ArrowUp','ArrowDown','dblclick']) {
  assert.ok(js.includes(command),`missing resize command ${command}`);
}
console.log('MS32 layout: untitled controls, hierarchy, vertical splitter and existing outer resizer present');
