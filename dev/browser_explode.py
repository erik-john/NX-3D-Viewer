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
for name in ['geometry.js','picking.js','viewer.js','item_tree.js','inspector.js','assembly_explode.js','component_colors.js','component_move.js']:
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
    assert page.locator('#assembly-tools').count()==0, 'floating panel fully removed'
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#status-message').textContent.includes('assembly.prt loaded')")
    assert page.locator('.tree-explode-toggle').count()==3, 'one toggle per assembly/component row'
    assert page.get_by_role('button',name='Explode all components').is_enabled()
    assert page.get_by_role('button',name='Explode component First').is_enabled()
    assert page.locator('.tree-row.is-selected').count()==0
    assert page.locator('.tree-visibility:checked').count()==5
    # Selecting or hiding is independent from clicking an explosion toggle.
    page.get_by_role('button',name='Explode component First').click()
    pairs=page.evaluate('window.__testViewer.geometry.map(p=>[p.meshId,p.offset])')
    assert any(v!=0 for _,off in pairs if _=='a' for v in off)
    assert all(v==0 for _,off in pairs if _=='b' for v in off)
    assert page.get_by_role('button',name='Reset component First').get_attribute('aria-pressed')=='true'
    assert page.get_by_role('button',name='Explode component Second').get_attribute('aria-pressed')=='false'
    assert page.get_by_role('button',name='Reset all components').get_attribute('aria-pressed')=='true'
    assert page.locator('.tree-row.is-selected').count()==0
    assert page.locator('.tree-visibility:checked').count()==5
    page.get_by_role('button',name='Reset component First').click()
    assert page.evaluate('window.__testViewer.geometry.every(p=>p.offset.every(v=>v===0))')
    page.get_by_role('button',name='Explode all components').click()
    offsets=page.evaluate('window.__testViewer.geometry.map(p=>p.offset)')
    assert all(any(abs(x)>0 for x in o) for o in offsets), offsets
    assert offsets[0]!=offsets[1]
    assert page.get_by_role('button',name='Reset all components').get_attribute('aria-pressed')=='true'
    # A component can be reset independently during a global explode.
    page.get_by_role('button',name='Reset component First').click()
    pairs=page.evaluate('window.__testViewer.geometry.map(p=>[p.meshId,p.offset])')
    assert all(v==0 for _,off in pairs if _=='a' for v in off)
    assert any(v!=0 for _,off in pairs if _=='b' for v in off)
    assert page.get_by_role('button',name='Reset all components').is_enabled()
    page.get_by_role('button',name='Reset all components').click()
    assert page.evaluate('window.__testViewer.geometry.every(p=>p.offset.every(v=>v===0))')
    # Selecting a tree row does not toggle its explosion state.
    page.locator('.tree-label').filter(has_text='First').click()
    assert page.locator('.tree-row.is-selected .tree-label').inner_text()=='First'
    assert page.get_by_role('button',name='Explode component First').get_attribute('aria-pressed')=='false'
    page.get_by_role('button',name='Explode component First').click()
    # Real 3D picking still selects a moved mesh.
    page.evaluate("window.__pickColor=[2,0,0,255]")
    page.locator('#viewer-canvas').click(position={'x':250,'y':220})
    assert page.locator('.tree-row.is-selected .tree-label').inner_text()=='Second'
    # Combined STL fallback never offers false per-component control.
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#status-message').textContent.includes('fallback.prt loaded')")
    assert page.locator('#assembly-tools').count()==0
    assert page.locator('.tree-explode-toggle').count()==3
    assert page.get_by_role('button',name='Explode all components').is_disabled()
    assert page.get_by_role('button',name='Explode component First').is_disabled()
    assert page.evaluate('window.__testViewer.geometry.every(p=>p.offset.every(v=>v===0))')
    assert not errors,errors
    browser.close()
print('MS28 Chromium: single tree toggles, partial explosion, selection and fallback verified')
