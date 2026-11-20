"""Chromium smoke test of real MS26 UI code with mocked GPU and NX responses."""
from pathlib import Path
import os, re, base64
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
front=root/'frontend'
html=(front/'index.html').read_text(encoding='utf-8')
html=html.replace('<script type="module" src="/js/app.js"></script>','')
html=html.replace('<link rel="stylesheet" href="/css/style.css">',
  '<style>'+(front/'css/style.css').read_text(encoding='utf-8')+'</style>')
logo=base64.b64encode((front/'assets/nx-cube-logo.png').read_bytes()).decode('ascii')
html=html.replace('/assets/nx-cube-logo.png','data:image/png;base64,'+logo)
modules=[]
for name in ['geometry.js','picking.js','plane_measure.js','measurement_ui.js','viewer.js','item_tree.js','inspector.js','assembly_explode.js','component_colors.js','component_move.js']:
    src=(front/'js'/name).read_text(encoding='utf-8')
    src=re.sub(r'^import .*?;\s*$', '',src,flags=re.M)
    src=re.sub(r'\bexport\s+(?=(?:class|function|const|let)\s)', '',src)
    modules.append(src)
app=(front/'js/app.js').read_text(encoding='utf-8')
app=re.sub(r'^import .*?;\s*$', '', app,flags=re.M)
app=app.replace('  const inspector = new PartInspector({','  window.__testViewer=viewer;\n  const inspector = new PartInspector({',1)
app=app.replace('  viewer.onHoverMesh = meshId => {','  window.__testTree=tree;\n  viewer.onHoverMesh = meshId => {',1)
fixture=r'''
window.__pickColor=[1,0,0,255];
let uniforms=[];
const mockGl = new Proxy({}, {get:(_, key) => {
  if (['createShader','createProgram','createBuffer','createTexture','createRenderbuffer','createFramebuffer'].includes(key)) return()=>({});
  if (['getShaderParameter','getProgramParameter'].includes(key)) return()=>true;
  if (['getAttribLocation','getUniformLocation'].includes(key)) return()=>0;
  if (key==='checkFramebufferStatus') return()=>1;
  if (key==='isEnabled') return()=>false;
  if (key==='readPixels') return (_x,_y,_w,_h,_fmt,_type,pixels)=>pixels.set(window.__pickColor);
  if (key==='uniform3fv') return (loc,value)=>uniforms.push(Array.from(value));
  if (String(key)===String(key).toUpperCase()) return 1;
  return ()=>{};
}});
HTMLCanvasElement.prototype.getContext=()=>mockGl;
class FileWorkspace {constructor(fn) { window.__openWorkspaceFile=fn; }}
function parseSTL(buffer) {
 const x=new Uint8Array(buffer)[0];
 const p=x===1 ? 0:20;
 return [{positions:new Float32Array([p,0,0,p+2,0,0,p,2,0]),
   normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint16Array([0,1,2]),
   color:'#dee1e3',creasePositions:new Float32Array([])}];
}
window.__requests=0;
const dataTree={id:'root',name:'Assembly',type:'part',children:[
  {id:'comp1',name:'First',type:'component',children:[{id:'body1',name:'Body 1',type:'body',meshId:'a',children:[]}]},
  {id:'comp2',name:'Second',type:'component',children:[{id:'body2',name:'Body 2',type:'body',meshId:'b',children:[]}]},
]};
window.fetch=async url=> {
 if (url==='/api/open') {
   window.__requests++;
   return {ok:true,json:async()=>window.__requests===1 ?
     ({ok:true,name:'assembly.prt',tree:dataTree,geometryMode:'separate',meshes:[{id:'a',url:'/api/models/a.stl'},{id:'b',url:'/api/models/b.stl'}]}) :
     ({ok:true,name:'fallback.prt',tree:dataTree,geometryMode:'combined',modelUrl:'/api/models/combined.stl'})};
 }
 if (url==='/api/models/a.stl') return {ok:true,arrayBuffer:async()=>new Uint8Array([1]).buffer};
 if (url==='/api/models/b.stl') return {ok:true,arrayBuffer:async()=>new Uint8Array([2]).buffer};
 if (url==='/api/models/combined.stl') return {ok:true,arrayBuffer:async()=>new Uint8Array([1]).buffer};
 throw Error(`Unexpected fetch ${url}`);
};
'''
html=html.replace('</body>','<script>'+ '\n'.join(modules)+fixture+'\n'+app+'</script></body>')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
      args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'])
    page=browser.new_page(viewport={'width':1440,'height':850})
    errors=[]
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.set_content(html,wait_until='load')
    page.wait_for_function('window.__nxViewerReady===true')
    # Selection action bar is not visible with no model loaded.
    assert page.locator('#tree-selection-actions').is_hidden()
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#status-message').textContent.includes('assembly.prt loaded')")
    assert page.locator('#tree-selection-actions').is_visible()
    assert page.locator('#isolate-selected').is_disabled()
    assert page.locator('#fit-selected').is_disabled()

    # A selection can be made in the tree and fit without rotating the view.
    page.locator('.tree-label').filter(has_text='Second').click()
    assert page.locator('#isolate-selected').is_enabled()
    assert page.locator('#fit-selected').is_enabled()
    orientation = page.evaluate('[window.__testViewer.yaw, window.__testViewer.pitch]')
    page.locator('#fit-selected').click()
    assert abs(page.evaluate('window.__testViewer.target[0]')-21)<1e-6
    assert page.evaluate('[window.__testViewer.yaw, window.__testViewer.pitch]') == orientation
    # Fit handles the displaced geometry too.
    page.get_by_role('button',name='Explode component Second').click()
    page.locator('#fit-selected').click()
    position=page.evaluate("""(() => {const p=window.__testViewer.geometry.find(p=>p.meshId==='b');
      return {focus:window.__testViewer.target, center:p.bounds.center.map((v,i)=>v+p.offset[i])}})()""")
    assert all(abs(a-b)<1e-6 for a,b in zip(position['focus'],position['center'])),position
    # Keep explosion untouched by isolation.
    page.get_by_role('button',name='Reset component Second').click()

    # When a component was already hidden, Restore must keep it hidden.
    page.get_by_role('checkbox',name='Show Second').uncheck()
    page.locator('.tree-label').filter(has_text='First').click()
    page.get_by_role('button',name='Isolate').click()
    assert page.locator('#isolate-selected').get_attribute('aria-pressed')=='true'
    assert page.locator('#isolate-selected-label').inner_text()=='Restore'
    assert page.evaluate('window.__testViewer.geometry.map(p=>p.visible)')==[True,False]
    page.get_by_role('button',name='Restore').click()
    assert page.evaluate('window.__testViewer.geometry.map(p=>p.visible)')==[True,False]
    assert page.get_by_role('checkbox',name='Show First').is_checked()
    assert not page.get_by_role('checkbox',name='Show Second').is_checked()
    # Restore original visibility before testing isolation switching.
    page.get_by_role('checkbox',name='Show Second').check()

    page.locator('.tree-label').filter(has_text='Second').click()
    page.get_by_role('button',name='Isolate').click()
    assert page.evaluate('window.__testViewer.geometry.map(p=>p.visible)')==[False,True]
    assert page.get_by_role('checkbox',name='Show First').is_checked()==False
    assert page.get_by_role('checkbox',name='Show Second').is_checked()
    # Clicking a new tree item and Isolate swaps the isolated item in one action.
    page.locator('.tree-label').filter(has_text='First').click()
    page.get_by_role('button',name='Isolate').click()
    assert page.evaluate('window.__testViewer.geometry.map(p=>p.visible)')==[True,False]
    page.get_by_role('button',name='Restore').click()
    assert page.evaluate('window.__testViewer.geometry.map(p=>p.visible)')==[True,True]

    # Manual checkbox changes cancel the isolation snapshot, not clobber user actions.
    page.locator('.tree-label').filter(has_text='Second').click()
    page.get_by_role('button',name='Isolate').click()
    page.get_by_role('checkbox',name='Show First').check()
    assert page.locator('#isolate-selected').get_attribute('aria-pressed')=='false'
    assert page.locator('#isolate-selected-label').inner_text()=='Isolate'
    assert page.evaluate('window.__testViewer.geometry.map(p=>p.visible)')==[True,True]
    # Hidden selected geometry cannot be fit, but can still be isolated.
    page.get_by_role('checkbox',name='Show Second').uncheck()
    page.locator('.tree-label').filter(has_text='Second').click()
    assert page.locator('#fit-selected').is_disabled()
    assert page.locator('#isolate-selected').is_enabled()
    page.get_by_role('button',name='Isolate').click()
    assert page.evaluate('window.__testViewer.geometry.map(p=>p.visible)')==[False,True]
    page.get_by_role('button',name='Restore').click()
    assert page.evaluate('window.__testViewer.geometry.map(p=>p.visible)')==[True,False]

    # Restore is still accessible after clearing selection, not stranded on a hidden item.
    page.locator('.tree-label').filter(has_text='First').click()
    page.get_by_role('button',name='Isolate').click()
    page.evaluate('window.__testTree.selectNode(null)')
    assert page.get_by_role('button',name='Restore').is_enabled()
    page.get_by_role('button',name='Restore').click()
    assert page.evaluate('window.__testViewer.geometry.map(p=>p.visible)')==[True,False]
    # Root can fit entire visible model, but is not a valid isolate target.
    page.locator('.tree-label').filter(has_text='Assembly').click()
    assert page.locator('#isolate-selected').is_disabled()
    assert page.locator('#fit-selected').is_enabled()
    # If selection changes to root during isolation, Restore remains available.
    page.locator('.tree-label').filter(has_text='First').click()
    page.get_by_role('button',name='Isolate').click()
    page.locator('.tree-label').filter(has_text='Assembly').click()
    assert page.get_by_role('button',name='Restore').is_enabled()
    page.get_by_role('button',name='Restore').click()

    # Loading a new file clears active selection and isolation state.
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#status-message').textContent.includes('fallback.prt loaded')")
    assert page.locator('#isolate-selected').is_disabled()
    page.locator('.tree-label').filter(has_text='First').click()
    assert page.locator('#isolate-selected').is_disabled(), 'combined STL cannot isolate components'
    assert page.locator('#fit-selected').is_disabled(), 'combined STL cannot fit an invented component'
    page.locator('.tree-label').filter(has_text='Assembly').click()
    assert page.locator('#fit-selected').is_enabled(), 'combined STL supports whole model fit'
    page.locator('#fit-selected').click()
    assert not errors,errors
    browser.close()
print('MS29 Chromium: isolate, restore, fit selected, exploded displacement and fallback passed')
