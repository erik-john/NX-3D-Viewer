// Exercise the real frontend controller with a mock DOM and simulated NX responses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const code = readFileSync(resolve(root, 'frontend/js/app.js'), 'utf8')
  .replace(/^import [^\n]+\n/gm, '');

function makeElement() {
  const attrs = new Map();
  const listeners = new Map();
  const classes = new Set();
  return {
    hidden: false, disabled: false, textContent: '', className: '',
    dataset: {}, tagName: 'DIV',
    addEventListener: (name, fn) => listeners.set(name, fn),
    trigger: (name) => { assert.ok(listeners.has(name), `missing ${name}`); return listeners.get(name)(); },
    classList: { toggle: (name, value) => value ? classes.add(name) : classes.delete(name) },
    setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: (key) => attrs.delete(key),
    getAttribute: (key) => attrs.get(key),
  };
}

const ids = [
  'viewer-canvas', 'viewer-error',
  'viewer-error-text', 'status-message', 'tree-panel', 'tree-toggle',
  'tree-resizer', 'model-tree', 'tree-summary', 'tree-note',
  'empty-state', 'loading-overlay', 'loading-title', 'loading-detail',
  'viewer-workspace', 'open-nx-button', 'import-message', 'fit-button',
  'inspector-panel', 'inspector-toggle', 'inspector-content',
];
const elems = Object.fromEntries(ids.map(id => [id, makeElement()]));
elems['loading-overlay'].hidden = true;
elems['import-message'].hidden = true;
const viewButtons = ['iso', 'front', 'top', 'right'].map(v => {
  const el = makeElement(); el.dataset.view = v; return el;
});
class FakeViewer {
  constructor() { this.meshes = []; this.showGrid = true; this.showAxes = true; this.wireframe = false; }
  setScene(meshes) { this.meshes = meshes; }
  setView(view) { this.view = view; }
  fit() {}
  requestRender() {}
  setMeshVisible(id, visible) { this.lastVisible = [id, visible]; }
}
let viewer;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const openResponses = [];
const meshResponses = [];
const fetch = (url) => {
  if (url === '/api/open') { assert.ok(openResponses.length, 'no API response set'); return openResponses.shift().promise; }
  if (url === '/api/models/example.stl') { assert.ok(meshResponses.length, 'no mesh response set'); return meshResponses.shift().promise; }
  throw new Error(`Unexpected URL: ${url}`);
};
const fakeMesh = { indices: new Uint16Array([0, 1, 2]), positions: new Float32Array(9), normals: new Float32Array(9), color: '#8ab1ca' };
class FakeInspector {
  constructor() { this.info = null; this.metrics = null; this.clears = 0; FakeInspector.instance = this; }
  clear() { this.info = null; this.clears++; }
  show(info, meshes, options) { this.info = info; this.meshes = meshes; this.options = options; }
  select(node) { this.selected = node; }
}
class FakeTree {
  constructor() { this.root = null; this.clears = 0; FakeTree.instance = this; }
  clear() { this.root = null; this.clears += 1; }
  show(root, options) { this.root = root; this.options = options; }
}
const context = {
  ItemTree: FakeTree,
  PartInspector: FakeInspector,
  Viewer: class extends FakeViewer { constructor(...args) { super(...args); viewer = this; } },
  parseSTL: () => [fakeMesh],
  fetch,
  document: {
    getElementById: (id) => { assert.ok(elems[id], `missing DOM element ${id}`); return elems[id]; },
    querySelectorAll: (selector) => selector === '[data-view]' ? viewButtons : [],
    activeElement: { tagName: 'BODY' },
  },
  window: { addEventListener() {} },
  console,
};
vm.runInNewContext(code, context, { filename: 'app.js' });
const ui = id => elems[id];
const response = (payload, ok = true) => ({ ok, json: async () => payload });
const flush = () => new Promise(resolve => setImmediate(resolve));

assert.equal(viewer.meshes.length, 0, 'starts empty');
assert.equal(FakeTree.instance.root, null);
assert.equal(ui('empty-state').hidden, false);
assert.equal(ui('loading-overlay').hidden, true);

// First opening: clear scene before server replies, keep splash through mesh download.
const first = deferred(); openResponses.push(first);
const mesh = deferred(); meshResponses.push(mesh);
const work = ui('open-nx-button').trigger('click');
assert.equal(viewer.meshes.length, 0);
assert.equal(ui('loading-overlay').hidden, false);
assert.equal(ui('open-nx-button').disabled, true);
assert.equal(ui('viewer-workspace').getAttribute('aria-busy'), 'true');
first.resolve(response({ ok: true, name: 'example.prt', modelUrl: '/api/models/example.stl', tree: { id: 'root', name: 'example.prt', type: 'part', children: [] } }));
await flush();
assert.equal(ui('loading-overlay').hidden, false);
assert.equal(ui('loading-title').textContent, 'Loading NX geometry');
mesh.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(84) });
await work;
assert.equal(viewer.meshes.length, 1);
assert.equal(FakeTree.instance.root.name, 'example.prt');
assert.equal(FakeInspector.instance.info.name, 'example.prt');
assert.equal(ui('empty-state').hidden, true);
assert.equal(ui('loading-overlay').hidden, true);
assert.equal(ui('open-nx-button').disabled, false);
assert.equal(ui('viewer-workspace').getAttribute('aria-busy'), undefined);

// Opening again: the old mesh disappears immediately; cancellation leaves an empty view.
const cancel = deferred(); openResponses.push(cancel);
const cancelWork = ui('open-nx-button').trigger('click');
assert.equal(viewer.meshes.length, 0, 'previous model must be released before new NX request');
assert.equal(FakeTree.instance.root, null);
assert.equal(FakeInspector.instance.info, null);
assert.equal(ui('loading-overlay').hidden, false);
cancel.resolve(response({ cancelled: true, ok: false }));
await cancelWork;
assert.equal(ui('loading-overlay').hidden, true);
assert.equal(ui('empty-state').hidden, false);

// An error also hides the splash and leaves the 3D scene empty.
const error = deferred(); openResponses.push(error);
const errorWork = ui('open-nx-button').trigger('click');
error.resolve(response({ ok: false, error: 'Failed to open NX file.' }, false));
await errorWork;
assert.equal(ui('loading-overlay').hidden, true);
assert.equal(viewer.meshes.length, 0);
assert.equal(ui('import-message').hidden, false);
assert.equal(ui('import-message').textContent, 'Failed to open NX file.');
assert.equal(ui('open-nx-button').disabled, false);
console.log('NX open UI: empty startup, splash, load, replacement, cancel, and error checks passed.');
