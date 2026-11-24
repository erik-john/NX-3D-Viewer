import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..', 'frontend', 'js');
const geometryCode = readFileSync(resolve(root, 'geometry.js'), 'utf8').replace(/export /g, '');
const inspectorCode = readFileSync(resolve(root, 'inspector.js'), 'utf8')
  .replace(/^import .*?;\s*$/gm, '').replace(/export /g, '');
const context = { Intl, Map, Set, Number, Math, console };
vm.runInNewContext(geometryCode + '\n' + inspectorCode + '\nthis.inspect = { summarizeGeometry, PartInspector }', context);
const { summarizeGeometry, PartInspector } = context.inspect;
const meshA = {
  meshId: 'a', positions: new Float32Array([0,0,0, 10,0,0, 0,20,0]),
  indices: new Uint16Array([0,1,2]),
};
const meshB = {
  meshId: 'b', positions: new Float32Array([2,0,1, 12,0,5, 3,30,1]),
  indices: new Uint16Array([0,1,2]),
};
const data = summarizeGeometry([meshA, meshB]);
assert.equal(data.vertices, 6);
assert.equal(data.triangles, 2);
assert.deepEqual(Array.from(data.overall.size), [12,30,5]);
assert.equal(data.byMesh.get('a').triangles, 1);

class Element {
  constructor(tagName = '') { this.tagName = tagName; this.children = []; this.textContent = ''; this.listeners = {}; this.attrs = {}; this.classes = new Set(); this.classList = {contains: n=>this.classes.has(n), toggle:(n, val)=>{ if(val)this.classes.add(n);else this.classes.delete(n); }}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
}
context.document = { createElement: (tagName) => new Element(tagName) };
function visibleText(element) { return [element.textContent, ...element.children.map(visibleText)].join(' '); }
const panel = new Element(), toggle = new Element(), content = new Element();
const inspector = new PartInspector({ panel, toggle, content });
assert.match(visibleText(content), /Open an NX file/);
const tree = {id:'root',type:'part',name:'fixture.prt',children:[
  {id:'a',type:'body',meshId:'a',name:'Body A',children:[]},
  {id:'b',type:'body',meshId:'b',name:'Body B',children:[]},
]};
const info = {name:'fixture.prt',file:{size:2048,path:'C:/models/fixture.prt'},nx:{units:'mm',attributes:[{name:'Material',value:'Steel'}]},tree};
inspector.show(info,[meshA,meshB],{perBody:true,gridSize:60});
let text = visibleText(content);
for(const expected of ['Dimensions','Geometry Information','File Information','NX Attributes','Steel','30','fixture.prt','Triangulated STL mesh']) assert.ok(text.includes(expected),expected);
inspector.select(tree.children[0]);
text = visibleText(content);
assert.ok(text.includes('Selected Item'));
assert.ok(text.includes('Body A'));
assert.ok(text.includes('20'));
inspector.clear();
assert.match(visibleText(content), /Open an NX file/);
assert.doesNotMatch(visibleText(content), /Steel/);
inspector.show({...info,nx:{}},[meshA,meshB],{perBody:false});
inspector.select(tree.children[0]);
assert.match(visibleText(content), /Individual mesh measurements are unavailable/);
toggle.listeners.click();
assert.equal(panel.classList.contains('is-collapsed'),true);
toggle.listeners.click();
assert.equal(panel.classList.contains('is-collapsed'),false);
console.log('Inspector: geometry, file metadata, selection, fallback and collapse checks passed.');

// Keep the source file information after the engineering records in the Characteristics tab.
const characteristic = {id:'chr_1',type:'characteristic',name:'PC1',details:{Designator:'PC1',NominalValue:'55.0'}};
const otherCharacteristic = {id:'chr_2',type:'characteristic',name:'PC2',details:{Designator:'PC2',NominalValue:'12.0'}};
const chrInfo = {...info,annotations:{characteristics:[characteristic,otherCharacteristic],
  characteristicsFile:{name:'Bolt M12x55_chr.chr',status:'loaded'}}};
inspector.show(chrInfo,[meshA,meshB]);
inspector.select(characteristic);
function inspectorHeadings() {
  return content.children.map(child => child.children.find(element => element.tagName === 'h3')?.textContent).filter(Boolean);
}
assert.deepEqual(inspectorHeadings(), [
  'Characteristic Navigator (2)', 'Characteristic Instances', 'Characteristic',
  'Characteristic Instance Details', 'Characteristics Source',
]);
inspector.selected = null;
inspector.render();
assert.equal(inspectorHeadings().at(-1), 'Characteristics Source');
inspector.show({...info,annotations:{characteristics:[],characteristicsFile:{name:'Bolt M12x55_chr.chr',
  status:'unavailable',observedDesignators:[{designator:'PC1',uuid:'sample'}]}}},[meshA,meshB]);
inspector.activeTab = 'characteristics';
inspector.render();
assert.equal(inspectorHeadings().at(-1), 'Characteristics Source');
