import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const js = readFileSync(resolve(root, 'frontend/js/workspace.js'), 'utf8');
const html = readFileSync(resolve(root, 'frontend/index.html'), 'utf8');
const css = readFileSync(resolve(root, 'frontend/css/style.css'), 'utf8');

assert.match(js, /new Intl\.Collator\([^\n]*numeric: true/);
assert.match(js, /a\.type !== b\.type.*a\.type === 'folder'/);
assert.match(js, /this\.expandedFolders = new Set\(\)/);
assert.match(js, /this\.expandedFolders\.clear\(\)/);
assert.doesNotMatch(js, /this\.expandedFolders\.add\(folder\)/);
assert.match(js, /toggleFolder\(path\)/);
assert.match(html, /id="workspace-upload"/);
assert.doesNotMatch(html, /id="workspace-upload-files"|id="workspace-upload-folder"/);
assert.match(html, /id="workspace-upload-dialog"/);
assert.match(html, /id="workspace-drop-zone"/);
assert.match(html, /id="workspace-choose-files"/);
assert.match(html, /id="workspace-choose-folder"/);
assert.match(css, /\.workspace-upload-dialog/);
const context = { Intl };
vm.runInNewContext(js.replace('export class FileWorkspace', 'class FileWorkspace') + '\nthis.compareEntries = compareEntries;', context);
const sorted = [
  { name: 'Bolt10.prt', type: 'file' },
  { name: 'zeta', type: 'folder' },
  { name: 'Bolt2.prt', type: 'file' },
  { name: 'assembly', type: 'folder' },
].sort(context.compareEntries).map(item => item.name);
assert.deepEqual(sorted, ['assembly', 'zeta', 'Bolt2.prt', 'Bolt10.prt']);
console.log('Workspace Explorer sorting, folder collapse and unified upload controls verified.');
