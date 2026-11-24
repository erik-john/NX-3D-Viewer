// Dropdown icons are consistent SVG chevrons, independent of font metrics.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'frontend/index.html'), 'utf8');
const css = readFileSync(resolve(root, 'frontend/css/style.css'), 'utf8');
const ids = ['component-menu-toggle','transparency-menu-toggle','viewer-menu-toggle'];
const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
const triggers = [...header.matchAll(/<button[^>]+class="header-action header-menu-trigger"[^>]*>(.*?)<\/button>/gs)];
assert.equal(triggers.length, 3);
for (const id of ids) {
 const button = triggers.find(m => m[0].includes(`id="${id}"`));
 assert.ok(button, `Missing ${id}`);
 assert.match(button[1], /<svg class="header-menu-caret"[^>]+><path d="m6 9 6 6 6-6"\/><\/svg>/);
 assert.ok(!button[1].includes('>⌄<'), `Old text glyph remains in ${id}`);
}
assert.match(css, /\.app-header \.header-menu-caret \{ display: block; width: 13px; height: 13px;/);
console.log('Header dropdowns: three identical centered SVG chevrons.');
