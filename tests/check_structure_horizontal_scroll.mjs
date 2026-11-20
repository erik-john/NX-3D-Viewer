// MS42 UI follow-up: long NX/JT assembly node names must be horizontally scrollable.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const css = readFileSync(resolve(import.meta.dirname, '../frontend/css/style.css'), 'utf8');
const html = readFileSync(resolve(import.meta.dirname, '../frontend/index.html'), 'utf8');
const js = readFileSync(resolve(import.meta.dirname, '../frontend/js/item_tree.js'), 'utf8');
const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:^|\\n)\\s*' + escaped + '\\s*\\{([^}]+)\\}', 'm');
  const match = css.match(re);
  assert.ok(match, `missing ${selector}`);
  return match[1];
};
assert.match(rule('.tree-entries'), /overflow-x:\s*auto/);
assert.match(rule('.tree-entries'), /overflow-y:\s*auto/);
assert.match(rule('.tree-entries ul'), /width:\s*max-content/);
assert.match(rule('.tree-row'), /width:\s*max-content/);
assert.match(rule('.tree-label'), /white-space:\s*nowrap/);
assert.doesNotMatch(rule('.tree-label'), /text-overflow:\s*ellipsis/);
assert.ok(html.includes('class="tree-entries" id="model-tree"'));
assert.ok(js.includes("row?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })"));
console.log('MS42 Structure horizontal/vertical scrolling CSS and tree selection verified');
