// MS30 — NX prototype-based assembly color mode.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const colorsSource = read('frontend/js/component_colors.js')
  .replace('export function buildComponentColors', 'function buildComponentColors');
const ctx = { Map, Set, Math, String };
vm.runInNewContext(colorsSource + '\nthis.buildComponentColors=buildComponentColors;', ctx);
const makeBody = (id, meshId = id) => ({ id, meshId, name: 'Body', type: 'body', children: [] });
const component = (id, name, partKey, ...bodies) => ({
  id, name, partKey, type: 'component', children: bodies.map(id => makeBody(id)),
});
const tree = { id:'root', type:'part', name:'Gearbox', children: [
  component('c1', 'Bolt Instance 1', 'C:\\PARTS\\BOLT_M6x20.PRT', 'a', 'a2'),
  component('c2', 'Bolt Instance 2', 'c:/parts/bolt_m6x20.prt', 'b'),
  component('c3', 'Bolt Instance 3', 'c:/parts/bolt_m6x30.prt', 'c'),
  component('c4', 'Bearing Outer', 'c:/parts/Bearing_6000.prt', 'd'),
  component('c5', 'Bearing Inner', 'c:/parts/Bearing_6000.prt', 'e'),
]};
const meshes = ['a','a2','b','c','d','e'].map(meshId => ({ meshId }));
const result = ctx.buildComponentColors(tree, meshes);
const col = result.colors;
assert.equal(result.available, true);
assert.equal(result.typeCount, 3, 'type count follows exact NX prototype identity');
assert.equal(col.size, 6);
assert.equal(col.get('a'), col.get('a2'), 'all bodies of a component share the same color');
assert.equal(col.get('a'), col.get('b'), 'repeated same-size bolt instances share the same color');
assert.notEqual(col.get('a'), col.get('c'), 'different-size bolt prototypes get distinct colors');
assert.equal(col.get('d'), col.get('e'), 'reused bearing prototype shares its color');
assert.notEqual(col.get('d'), col.get('a'));
for (const hex of col.values()) assert.match(hex,/^#[a-f\d]{6}$/i);

const reverse = { ...tree, children: [...tree.children].reverse() };
const second = ctx.buildComponentColors(reverse, meshes);
for (const id of col.keys()) assert.equal(col.get(id), second.colors.get(id),
  'sorting prototype keys makes the colors independent of occurrence order');

const old = { id:'root', type:'part', children: [
  component('b1','Bolt M6x20 (1)',undefined,'b1_body'),
  component('b2','Bolt M6x20 (2)',undefined,'b2_body'),
  component('b3','Bolt M6x30 (1)',undefined,'b3_body'),
]};
const oldColors = ctx.buildComponentColors(old, ['b1_body','b2_body','b3_body'].map(meshId => ({meshId})));
assert.equal(oldColors.colors.get('b1_body'), oldColors.colors.get('b2_body'),
  'older NX manifest falls back to normalized occurrence names');
assert.notEqual(oldColors.colors.get('b1_body'), oldColors.colors.get('b3_body'));
assert.equal(ctx.buildComponentColors({id:'root',type:'part',children:[makeBody('one')]},[{meshId:'one'}]).available,false,
  'standalone parts are not mistakenly categorized as assemblies');
assert.equal(ctx.buildComponentColors(tree,[{meshId:'root'}]).available,false,
  'combined STL fallback must disable component coloring');
const manyTree = {id:'root',type:'part',children:Array.from({length:24},(_,i)=>
  component('c'+i,'Part '+i,'p'+String(i).padStart(2,'0'),'m'+i))};
const many = ctx.buildComponentColors(manyTree,Array.from({length:24},(_,i)=>({meshId:'m'+i})));
assert.equal(new Set(many.colors.values()).size,24, '24 distinct types have 24 distinct colors');

const viewerSource = read('frontend/js/viewer.js')
  .replace(/^import .*?;\s*$/gm, '')
  .replace('export class Viewer','class Viewer');
vm.runInNewContext(viewerSource+'\nthis.Viewer=Viewer;',ctx);
const viewer = Object.create(ctx.Viewer.prototype);
viewer.geometry = [
  {meshId:'a',color:[.8,.8,.8]},
  {meshId:'b',color:[.8,.8,.8]},
  {meshId:'c',color:[.8,.8,.8]},
];
viewer.requestRender=()=>{};
viewer.setComponentColors(col);
assert.deepEqual(Array.from(viewer.geometry[0].componentColor),Array.from(viewer.geometry[1].componentColor));
assert.notDeepEqual(Array.from(viewer.geometry[0].componentColor),Array.from(viewer.geometry[2].componentColor));
viewer.setComponentColorMode(true);
assert.equal(viewer.componentColorsEnabled,true);
viewer.setComponentColorMode(false);
assert.equal(viewer.componentColorsEnabled,false);
assert.deepEqual(Array.from(viewer.geometry[0].color),[.8,.8,.8],
  'original steel color is never overwritten');
assert.ok(viewerSource.includes('this.componentColorsEnabled && part.componentColor ? part.componentColor : part.color'),
  'renderer selects the active per-type color only when enabled');
const html=read('frontend/index.html');
const app=read('frontend/js/app.js');
assert.ok(html.includes('id="component-color-toggle"'));
assert.ok(app.includes('viewer.setComponentColors(componentColors.colors)'));
assert.ok(app.includes('viewer.setComponentColorMode(active)'));
assert.ok(!html.includes('id="assembly-tools"'), 'old explode panel stays removed');
console.log('MS30 color type identity, repeated parts, fallback, 24 colors and viewer toggle passed');
