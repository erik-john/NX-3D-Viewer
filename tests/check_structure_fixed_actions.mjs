// MS42 UI regression: structure row actions remain visible during horizontal filename scrolling.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const css = readFileSync(resolve(import.meta.dirname, '../frontend/css/style.css'), 'utf8');
const js = readFileSync(resolve(import.meta.dirname, '../frontend/js/item_tree.js'), 'utf8');
const rules = css.match(/\.tree-inline-actions\s*\{([^}]*)\}/);
assert.ok(rules, 'missing inline action container');
assert.match(rules[1], /position:\s*sticky/);
assert.match(rules[1], /right:\s*0/);
assert.match(js, /actions\.className\s*=\s*'tree-inline-actions'/);
for (const fragment of ['actions.append(check)', 'actions.append(positionToggle)', 'actions.append(moveToggle)']) {
  assert.ok(js.includes(fragment), `missing fixed action: ${fragment}`);
}
assert.ok(js.includes('if (actions.childElementCount) row.append(actions)'));
console.log('MS42 Structure sticky action controls verified');
