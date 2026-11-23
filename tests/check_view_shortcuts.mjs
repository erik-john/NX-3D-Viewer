// Viewer menu glyphs and keyboard badges should match the actual view controls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'frontend/index.html'), 'utf8');
const css = readFileSync(resolve(root, 'frontend/css/style.css'), 'utf8');
const menu = html.slice(html.indexOf('id="viewer-menu"'), html.indexOf('</div>\n    </div>\n\n\n    <main'));
const viewport = html.slice(html.indexOf('class="viewport-view-tools"'), html.indexOf('id="move-gizmo"'));
for (const [view, shortcut] of Object.entries({iso: '1', front: '2', top: '3', right: '4'})) {
  assert.match(menu, new RegExp(`data-view="${view}"[^>]*>\\s*<span class="header-menu-label"><svg[\\s\\S]*?<\\/svg><span>[^<]+<\\/span><\\/span><span class="header-menu-shortcut" aria-hidden="true">${shortcut}<\\/span><\\/button>`));
  assert.match(viewport, new RegExp(`data-view="${view}"[\\s\\S]*?<span class="viewport-view-shortcut" aria-hidden="true">${shortcut}<\\/span>\\s*<\\/button>`));
}
for (const [id, label] of [['fit-menu-button','Fit model'],['component-color-menu-button','Color components']]) {
  assert.match(menu,new RegExp(`id="${id}"[^>]*><span class="header-menu-label"><svg[\\s\\S]*?<\\/svg><span>${label}<\\/span><\\/span>`));
}
assert.match(menu, /id="fit-menu-button"[\s\S]*?<span class="header-menu-shortcut" aria-hidden="true">F<\/span>/);
assert.match(viewport, /id="fit-button"[\s\S]*?<span class="viewport-view-shortcut" aria-hidden="true">F<\/span>/);
assert.doesNotMatch(viewport, /id="component-color-toggle"[\s\S]*?<span class="viewport-view-shortcut"/);
assert.match(css, /\.header-menu-label > svg/);
assert.match(css, /\.viewport-view-shortcut \{ position: absolute/);
console.log('Viewer icons and in-view shortcut hints verified.');
