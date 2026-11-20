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
    assert page.locator('#move-selected').is_disabled()
    assert page.locator('#move-gizmo').is_hidden()
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#status-message').textContent.includes('assembly.prt loaded')")
    assert page.locator('.tree-move-toggle').count()==2
    assert page.locator('#tree-move-actions').is_visible()
    assert page.locator('#move-selected').is_disabled()
    assert page.get_by_role('button',name='Move component First').is_enabled()
    assert page.locator('#reset-move-all').is_disabled()
    page.get_by_role('button',name='Move component First').click()
    assert page.evaluate('window.__testTree.selectedId')=='comp1'
    assert page.locator('#move-selected').get_attribute('aria-pressed')=='true'
    page.locator('#fit-selected').click()
    page.wait_for_function("!document.querySelector('#move-gizmo').hasAttribute('hidden')")
    orientation=page.evaluate('[window.__testViewer.yaw,window.__testViewer.pitch]')
    # Real SVG pointer interaction, not a synthetic call to the drag callback.
    coords=page.evaluate('''() => {
      const svg=document.querySelector('#move-gizmo'); const hit=svg.querySelector('.move-axis-x .move-axis-hit');
      const rect=svg.getBoundingClientRect();
      const x1=+hit.getAttribute('x1'),x2=+hit.getAttribute('x2');
      const y1=+hit.getAttribute('y1'),y2=+hit.getAttribute('y2');
      const length=Math.hypot(x2-x1,y2-y1);
      return {x:rect.left+(x1+x2)/2,y:rect.top+(y1+y2)/2,
        ux:(x2-x1)/length,uy:(y2-y1)/length};
    }''')
    page.mouse.move(coords['x'],coords['y'])
    page.mouse.down()
    page.mouse.move(coords['x']+coords['ux']*55,coords['y']+coords['uy']*55,steps=8)
    page.mouse.up()
    manual=page.evaluate('''() => ({a:window.__testViewer.manualOffsets.get('a'),
      b:window.__testViewer.manualOffsets.get('b'), offsets:window.__testViewer.geometry.map(p=>p.offset)})''')
    assert manual['a'] is not None and manual['a'][0]>0.01,manual
    assert manual['b'] is not None and manual['b']==[0,0,0],manual
    assert page.evaluate('[window.__testViewer.yaw,window.__testViewer.pitch]')==orientation,'drag must not orbit camera'
    assert page.evaluate('window.__testViewer.selectedMeshIds.has("a")'), 'selection remains highlighted'
    assert page.locator('#reset-move-selected').is_enabled()
    assert page.locator('#reset-move-all').is_enabled()
    page.get_by_role('button',name='Explode component First').click()
    exploded=page.evaluate("window.__testViewer.explodeOffsets.get('a')")
    assert any(abs(x)>0 for x in exploded)
    page.locator('#reset-move-selected').click()
    assert page.evaluate('window.__testViewer.geometry[0].offset')==exploded
    assert page.locator('#reset-move-all').is_disabled()
    page.get_by_role('button',name='Reset component First').click()
    assert page.evaluate('window.__testViewer.geometry[0].offset')==[0,0,0]
    # Focused arrows accept keyboard nudges, even for touch/keyboard users.
    page.locator('#move-gizmo .move-axis-y .move-axis-hit').focus()
    page.keyboard.press('ArrowUp')
    value=page.evaluate("window.__testViewer.manualOffsets.get('a')")
    assert value[2]<0,value
    assert page.evaluate('window.__testViewer.geometry[1].offset')==[0,0,0]
    page.get_by_role('button',name='Move component Second').click()
    assert page.evaluate('window.__testTree.selectedId')=='comp2'
    assert page.locator('#move-gizmo').is_visible()
    page.locator('#reset-move-all').click()
    assert page.evaluate('window.__testViewer.geometry.every(x=>x.offset.every(v=>v===0))')
    page.get_by_role('button',name='Move component First').click()
    page.locator('#move-gizmo .move-axis-x .move-axis-hit').focus()
    page.keyboard.press('ArrowUp')
    assert page.evaluate('window.__testViewer.geometry[0].offset[0]>0')
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#status-message').textContent.includes('fallback.prt loaded')")
    assert page.locator('#tree-move-actions').is_hidden()
    assert page.locator('#move-gizmo').is_hidden()
    assert page.get_by_role('button',name='Move component First').is_disabled()
    assert page.evaluate('window.__testViewer.manualOffsets.size===0')
    assert not errors,errors
    browser.close()
print('MS31 Chromium: mouse axis drag, NX nudge, per-part reset, explode, selection and fallback passed')
