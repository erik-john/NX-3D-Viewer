import assert from 'node:assert/strict';
import {parameterLabel, characteristicParameters, pmiParameters, pmiDependencyLabels} from '../frontend/js/inspector.js';
import {nxToViewer, AnnotationDisplay, dimensionGuide} from '../frontend/js/annotations_ui.js';

const source={id:'root',name:'Bolt M12x55.prt',type:'part',children:[]};
const data={pmi:[{id:'pmi_1',name:'Linear Dimension',type:'PmiLinearDimension',
  text:'55',position:[10,20,30],details:{Text:'55'}}],
  characteristics:[{id:'chr_1',name:'PC1',position:[10,20,30],details:{BaseId:'1',Designator:'PC1'}}]};
assert.equal(source.children.length, 0, 'geometry hierarchy contains no PMI or Characteristic nodes');
assert.deepEqual(nxToViewer([10,20,30]),[10,30,-20]);
assert.equal(nxToViewer([Number.NaN,0,0]),null);

const elements=[];
const canvas={getBoundingClientRect:()=>({width:800,height:600})};
const viewer={canvas,geometry:[],cameraMatrix:()=>({matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]})};
const layer={replaceChildren(){elements.length=0;},append(el){elements.push(el);}};
const originalDocument=globalThis.document;
globalThis.document={createElement:()=>({style:{},hidden:false,addEventListener(){},setAttribute(){},dataset:{},classList:{toggle(){}}})};
try{
  const display=new AnnotationDisplay(viewer,layer,()=>{});
  display.setData(data);
  assert.equal(elements.length,2);
  assert.equal(display.visibility.pmi,false);
  assert.equal(display.visibility.characteristics,false);
  display.setMode('pmi');
  assert.equal(display.visibility.pmi,true);
  assert.equal(display.visibility.characteristics,false);
  assert.equal(elements[0].textContent,'55');
  assert.equal(elements[1].textContent,'PC1');
  display.setMode('characteristics');
  assert.equal(display.visibility.pmi,false);
  assert.equal(display.visibility.characteristics,true);
  display.setSelected('chr_1');
  display.setVisible('pmi',false);
  assert.equal(elements[0].hidden,true);
  display.clear();
  assert.equal(elements.length,0);
}finally{
  globalThis.document=originalDocument;
}
const guide=dimensionGuide({dimension:{start:[0,0,0],end:[55,0,0],origin:[0,15,0]}});
assert.deepEqual(guide.start,[0,0,0]);
assert.deepEqual(guide.first,[0,0,-15]);
assert.deepEqual(guide.second,[55,0,-15]);
assert.deepEqual(dimensionGuide({dimension:{start:[0,0,0],end:[0,0,0],origin:[0,15,0]}}),null);
const moved=dimensionGuide({dimension:{start:[0,0,0],end:[55,0,0],origin:[0,15,0]}},[11,4,8]);
assert.deepEqual(moved.start,[11,4,8]);
assert.deepEqual(moved.second,[66,4,-7]);
assert.equal(parameterLabel('NominalPrecision'),'Nominal Precision');
assert.equal(parameterLabel('BaseID'),'Base ID');
assert.deepEqual(characteristicParameters({UUID:'id123',NominalValue:'55.0',BaseId:'1'})[0],['Base ID','1']);
console.log('PMI/Characteristic hierarchy, coordinate conversion, overlays and visibility passed.');

const noOrigin = dimensionGuide({dimension:{start:[0,0,0],end:[55,0,0],origin:null}});
assert.deepEqual(noOrigin.first, [0,0,0]);
assert.deepEqual(noOrigin.second, [55,0,0]);

assert.deepEqual(pmiParameters({'Text':'55','Tolerance Type':'No Tolerance','Size':55,'URL':''}).slice(0,3),
  [['Size','55'], ['Tolerance Type','No Tolerance'], ['URL','']]);
assert.deepEqual(pmiDependencyLabels({associatedObjects:[{type:'Face',name:'Face of Base rotate 1'}],
  modelViews:[{name:'Trimetric',work:true,displayed:true}]}),
  {faces:['Face "Face of Base rotate 1"'],views:['Trimetric (Work, Displayed)']});

assert.equal(pmiParameters({Text:'12'}).find(([key])=>key==='Size')[1], 'Not reported by NX');
