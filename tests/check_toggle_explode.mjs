import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root,path),'utf8');
const html = read('frontend/index.html');
const css = read('frontend/css/style.css');
const app = read('frontend/js/app.js');
const tree = read('frontend/js/item_tree.js');
assert.ok(!html.includes('id="assembly-tools"'));
for (const id of ['explode-all','collapse-all','explode-selected','reset-selected','explode-distance']) {
  assert.ok(!html.includes(`id="${id}"`), id);
  assert.ok(!app.includes(`$('${id}')`), id);
}
assert.ok(!css.includes('.assembly-tools {'));
assert.ok(css.includes('.tree-explode-toggle.is-active'));
assert.ok(tree.includes("button.setAttribute('aria-pressed', String(moved))"));
assert.ok(tree.includes('this.onToggleExplode(node, exploded)'));
assert.ok(tree.includes('this.onToggleAll(exploded)'));
console.log('MS28 inline explosion toggle and removed viewport panel checks passed');
