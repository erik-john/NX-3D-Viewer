// MS42: repeated linked-JT occurrences must stay independent for mesh controls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
const folder = resolve(import.meta.dirname, '..');
const read = name => readFileSync(resolve(folder, name), 'utf8');
const geometry = read('frontend/js/geometry.js').replace(/export function /g, 'function ');
const explode = read('frontend/js/assembly_explode.js').replace(/^import .*?;\s*$/gm,'').replace(/export function /g,'function ');
const colors = read('frontend/js/component_colors.js').replace(/export function /g,'function ');
const ctx = { Map, Set, Math, String, Float32Array };
vm.runInNewContext(`${geometry}\n${explode}\n${colors}\nthis.api={createExplodePlan,calculateExplodeOffsets,selectionGroupIds,buildComponentColors,boundsFor};`,ctx);
const tree={id:'root',name:'Fastener JT',type:'part',children:[
  {id:'root_c1',name:'Bolt first',type:'component',partKey:'bolt.jt',children:[
    {id:'root_c1_b1',type:'body',meshId:'root_c1_b1',children:[]}]},
  {id:'root_c2',name:'Bolt second',type:'component',partKey:'bolt.jt',children:[
    {id:'root_c2_b1',type:'body',meshId:'root_c2_b1',children:[]}]},
  {id:'root_c3',name:'Nut',type:'component',partKey:'nut.jt',children:[
    {id:'root_c3_b1',type:'body',meshId:'root_c3_b1',children:[]}]}
]};
const mesh=id=>({meshId:id,positions:new Float32Array([0,0,0,1,0,0,0,1,0])});
const meshes=['root_c1_b1','root_c2_b1','root_c3_b1'].map(mesh);
const group=ctx.api.createExplodePlan(tree,meshes);
assert.equal(group.length,3);
const affected=ctx.api.selectionGroupIds(group,tree.children[1],node=>node.children.map(child=>child.meshId));
assert.deepEqual(Array.from(affected),['root_c2']);
const bounds=ctx.api.boundsFor(meshes);
const displaced=ctx.api.calculateExplodeOffsets(group,bounds,75);
assert.notDeepEqual(Array.from(displaced.get('root_c1_b1')), Array.from(displaced.get('root_c2_b1')));
const assigned=ctx.api.buildComponentColors(tree,meshes);
assert.equal(assigned.available,true);
assert.equal(assigned.colors.get('root_c1_b1'),assigned.colors.get('root_c2_b1'));
assert.notEqual(assigned.colors.get('root_c2_b1'),assigned.colors.get('root_c3_b1'));
const app=read('frontend/js/app.js');
const viewer=read('frontend/js/viewer.js');
const required=[
  ['selection',app,/tree\.selectMesh\(meshId\)/],
  ['explode',app,/createExplodePlan\(info\.tree, meshes\)/],
  ['move',app,/new MoveGizmo\(/],
  ['color',app,/buildComponentColors\(structure, meshes\)/],
  ['transparency',app,/viewer\.setMeshOpacities\(componentOpacities\)/],
  ['measurement',app,/viewer\.pickSurface\(x, y, meshId\)/],
  ['render offset',viewer,/part\.offset/],
];
for (const [name,source,pattern] of required) assert.match(source,pattern,name);
console.log('MS42 JT occurrence identity, explode, color, and six feature paths passed.');
