"""Browser integration check for mock-GPU 3D selection / tree / inspector."""
from pathlib import Path
import base64
import os
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / 'frontend'

source_names = ['geometry.js','stl.js','picking.js','viewer.js','item_tree.js','inspector.js']
source = []
for name in source_names:
    s = (FRONT / 'js' / name).read_text(encoding='utf-8')
    s = re.sub(r'^import .*?;\s*$', '', s, flags=re.MULTILINE)
    s = re.sub(r'\bexport\s+(?=(?:function|class|const|let)\s)', '', s)
    source.append(s)

html = (FRONT / 'index.html').read_text(encoding='utf-8')
html = html.replace('<script type="module" src="/js/app.js"></script>','')
html = html.replace('<link rel="stylesheet" href="/css/style.css">',
  '<style>' + (FRONT / 'css/style.css').read_text(encoding='utf-8') + '</style>')
logo = base64.b64encode((FRONT / 'assets/nx-cube-logo.png').read_bytes()).decode('ascii')
html = html.replace('/assets/nx-cube-logo.png', 'data:image/png;base64,' + logo)
fixture = r'''
window.__mockPixel=[2,0,0,255];
const mockGl = new Proxy({}, {
 get: (_, key) => {
   if (key === 'createShader' || key === 'createProgram' || key === 'createBuffer' || key === 'createTexture' ||
       key === 'createRenderbuffer' || key === 'createFramebuffer') return () => ({});
   if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
   if (key === 'getAttribLocation' || key === 'getUniformLocation') return () => 0;
   if (key === 'isEnabled') return ()=>false;
   if (key === 'readPixels') return (x,y,w,h,format,type,pixels) => pixels.set(window.__mockPixel);
   if (key === 'checkFramebufferStatus') return () => 1;
   if (String(key) === String(key).toUpperCase()) return 1;
   return () => undefined;
 }
});
HTMLCanvasElement.prototype.getContext = () => mockGl;
window.viewer = new Viewer(document.querySelector('#viewer-canvas'));
window.inspector = new PartInspector({panel:document.querySelector('#inspector-panel'),
  toggle:document.querySelector('#inspector-toggle'), content:document.querySelector('#inspector-content')});
window.tree = new ItemTree({panel:document.querySelector('#tree-panel'),
  toggle:document.querySelector('#tree-toggle'),resizer:document.querySelector('#tree-resizer'),
  container:document.querySelector('#model-tree'),summary:document.querySelector('#tree-summary'),note:document.querySelector('#tree-note'),
  onVisibility:(id,visible)=>viewer.setMeshVisible(id,visible),
  onSelect:(node)=> {viewer.setSelectedMeshIds(node ? tree.descendants(node) : []); inspector.select(node);
    document.querySelector('#status-message').textContent=node?'Selected: '+node.name:'Selection cleared';}});
viewer.onHoverMesh = id => {const node = tree.nodeForMesh(id); viewer.setHoveredMeshIds(node ? tree.descendants(node):[]);};
viewer.onSelectMesh = id => {if(!id) tree.selectNode(null); else if(!tree.selectMesh(id)) tree.selectNode(null);};
const root = {id:'root',name:'Assembly',type:'part',children:[
  {id:'c1',name:'Component A',type:'component',children:[{id:'b1',name:'Body A',type:'body',meshId:'a',children:[]}]},
  {id:'c2',name:'Component B',type:'component',children:[{id:'b2',name:'Body B',type:'body',meshId:'b',children:[]}]}
]};
const makeMesh = (id,x) => ({meshId:id,color:'#dee1e3',
 positions:new Float32Array([x,0,0, x+1,0,0, x,1,0]),
 normals:new Float32Array([0,0,1,0,0,1,0,0,1]),
 indices:new Uint16Array([0,1,2]),creasePositions:new Float32Array([])});
const meshes=[makeMesh('a',0),makeMesh('b',2)];
viewer.setScene(meshes);
tree.show(root,{visibilityEnabled:true});
inspector.show({name:'Assembly',tree,nx:{units:'mm'},file:{}},meshes,{perBody:true,gridSize:30});
document.querySelector('#empty-state').hidden=true;
window.__ready = true;
'''
html = html.replace('</body>', '<script>'+'\n'.join(source)+fixture+'</script></body>')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
         args=['--no-sandbox','--enable-webgl','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
    page=browser.new_page(viewport={'width':1400,'height':780})
    errors=[]
    page.on('pageerror',lambda exc: errors.append(str(exc)))
    page.set_content(html,wait_until='load')
    page.wait_for_function('window.__ready === true',timeout=10000)
    canvas=page.locator('#viewer-canvas')
    box=canvas.bounding_box()
    x,y=box['x']+box['width']*.5,box['y']+box['height']*.5
    page.mouse.click(x,y)
    assert page.locator('.tree-row.is-selected .tree-label').inner_text() == 'Component B'
    assert 'Component B' in page.locator('#inspector-content').inner_text()
    assert page.evaluate("viewer.selectedMeshIds.has('b')")
    page.mouse.move(x+100,y+100)
    page.mouse.down();page.mouse.move(x+140,y+115,steps=3);page.mouse.up()
    assert page.locator('.tree-row.is-selected .tree-label').inner_text()=='Component B', 'drag must not change selection'
    page.evaluate("window.__mockPixel=[0,0,0,0]")
    page.mouse.click(x,y)
    assert page.locator('.tree-row.is-selected').count()==0, 'empty click clears selection'
    page.evaluate("window.__mockPixel=[1,0,0,255]")
    page.get_by_role('checkbox',name='Show Component A').uncheck()
    page.mouse.click(x,y)
    assert page.locator('.tree-row.is-selected').count()==0, 'hidden mesh must not be selected'
    page.get_by_role('checkbox',name='Show Component A').check()
    page.mouse.click(x,y)
    assert page.locator('.tree-row.is-selected .tree-label').inner_text()=='Component A'
    assert not errors,errors
    browser.close()
print('Browser selection: click, tree/inspector sync, drag, empty space and hidden bodies passed.')
