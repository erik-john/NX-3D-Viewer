"""MS30 browser interaction test with simulated NX export and WebGL rendering."""
from pathlib import Path
import base64
import os
import re
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
front = root / 'frontend'
html = (front / 'index.html').read_text(encoding='utf-8')
html = html.replace('<script type="module" src="/js/app.js"></script>', '')
html = html.replace('<link rel="stylesheet" href="/css/style.css">',
    '<style>'+(front/'css/style.css').read_text(encoding='utf-8')+'</style>')
logo = base64.b64encode((front/'assets/nx-cube-logo.png').read_bytes()).decode('ascii')
html = html.replace('/assets/nx-cube-logo.png', 'data:image/png;base64,'+logo)
modules = []
for name in ['geometry.js','picking.js','viewer.js','item_tree.js','inspector.js',
             'assembly_explode.js','component_colors.js']:
    code = (front/'js'/name).read_text(encoding='utf-8')
    code = re.sub(r'^import .*?;\s*$', '', code, flags=re.M)
    code = re.sub(r'\bexport\s+(?=(?:class|function|const|let)\s)', '', code)
    modules.append(code)
app = (front/'js/app.js').read_text(encoding='utf-8')
app = re.sub(r'^import .*?;\s*$', '', app, flags=re.M)
app = app.replace('  const inspector = new PartInspector({',
    '  window.__testViewer=viewer;\n  const inspector = new PartInspector({', 1)
app = app.replace('  viewer.onHoverMesh = meshId => {',
    '  window.__testTree=tree;\n  viewer.onHoverMesh = meshId => {', 1)
fixture = r'''
const mockGl = new Proxy({}, {get:(_, key) => {
  if (['createShader','createProgram','createBuffer','createTexture',
       'createRenderbuffer','createFramebuffer'].includes(key)) return ()=>({});
  if (['getShaderParameter','getProgramParameter'].includes(key)) return ()=>true;
  if (['getAttribLocation','getUniformLocation'].includes(key)) return ()=>0;
  if (key==='checkFramebufferStatus') return ()=>1;
  if (key==='isEnabled') return ()=>false;
  if (key==='readPixels') return (_x,_y,_w,_h,_fmt,_type,p)=>p.set([1,0,0,255]);
  if (String(key)===String(key).toUpperCase()) return 1;
  return ()=>{};
}});
HTMLCanvasElement.prototype.getContext=()=>mockGl;
class FileWorkspace {constructor(fn){window.__workspaceOpen=fn;}}
function parseSTL(buffer) {
  const v=new Uint8Array(buffer)[0]; const x=v*5;
  return [{positions:new Float32Array([x,0,0,x+2,0,0,x,2,0]),
    normals:new Float32Array([0,0,1,0,0,1,0,0,1]),
    indices:new Uint16Array([0,1,2]),color:'#dee1e3',
    creasePositions:new Float32Array([])}];
}
const root = {id:'root',name:'Fastener Assembly',type:'part',children:[
 {id:'c1',name:'Bolt M6x20 instance 1',type:'component',partKey:'C:\\NX\\bolt_M6x20.prt',children:[
   {id:'b1',name:'Body',type:'body',meshId:'a',children:[]}]},
 {id:'c2',name:'Bolt M6x20 instance 2',type:'component',partKey:'c:/nx/bolt_m6x20.prt',children:[
   {id:'b2',name:'Body',type:'body',meshId:'b',children:[]}]},
 {id:'c3',name:'Bolt M6x30',type:'component',partKey:'c:/nx/bolt_m6x30.prt',children:[
   {id:'b3',name:'Body',type:'body',meshId:'c',children:[]}]}
]};
window.__openCount=0;
window.fetch = async url => {
 if(url==='/api/open') {
   window.__openCount++;
   return {ok:true, json:async()=>window.__openCount===1 ?
     {ok:true,name:'Assy.prt',geometryMode:'separate',tree:root,
       meshes:[{id:'a',url:'/api/models/a.stl'},{id:'b',url:'/api/models/b.stl'},
               {id:'c',url:'/api/models/c.stl'}]} :
     {ok:true,name:'fallback.prt',geometryMode:'combined',tree:root,
       modelUrl:'/api/models/combined.stl'}};
 }
 if(url.startsWith('/api/models/')) return {ok:true,arrayBuffer:async()=>new Uint8Array([
    url.includes('/a.')?1:url.includes('/b.')?2:3]).buffer};
 throw Error('Unexpected request '+url);
};
'''
html = html.replace('</body>', '<script>'+'\n'.join(modules)+fixture+'\n'+app+'</script></body>')
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True,
      executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
      args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width':1440,'height':850})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(html,wait_until='load')
    page.wait_for_function('window.__nxViewerReady===true')
    toggle=page.locator('#component-color-toggle')
    assert toggle.is_disabled(), 'no model: coloring unavailable'
    assert toggle.get_attribute('aria-pressed')=='false'
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#status-message').textContent.includes('Assy.prt loaded')")
    assert toggle.is_enabled(), 'separate assembly: color mode available'
    part_info=page.evaluate('''(() => window.__testViewer.geometry.map(p=>({
        meshId:p.meshId,color:p.color,componentColor:p.componentColor,offset:p.offset})))()''')
    one,two,three=part_info
    assert one['componentColor']==two['componentColor'], 'same NX prototype must share color'
    assert one['componentColor']!=three['componentColor'], 'different bolt sizes need distinct colors'
    assert one['color']==two['color']==three['color'], 'steel base remains unchanged'
    assert not page.evaluate('window.__testViewer.componentColorsEnabled')
    toggle.click()
    assert page.evaluate('window.__testViewer.componentColorsEnabled')
    assert toggle.get_attribute('aria-pressed')=='true'
    assert 'active' in (toggle.get_attribute('class') or '')
    # Selected and hovered states must remain independent of appearance mode.
    page.evaluate("window.__testViewer.onHoverMesh('a')")
    assert page.evaluate("window.__testViewer.hoveredMeshIds.has('a')")
    page.evaluate("window.__testViewer.onSelectMesh('a')")
    assert page.evaluate('window.__testTree.selectedId')=='c1'
    page.get_by_role('button',name='Explode component Bolt M6x20 instance 1').click()
    assert page.evaluate("window.__testViewer.geometry.find(p=>p.meshId==='a').offset.some(x=>x!==0)")
    assert page.evaluate('window.__testViewer.componentColorsEnabled')
    toggle.click()
    assert toggle.get_attribute('aria-pressed')=='false'
    assert not page.evaluate('window.__testViewer.componentColorsEnabled')
    assert page.evaluate("window.__testViewer.geometry.every(p=>p.color.every(v=>Number.isFinite(v)))")
    # Preference persists if coloring was enabled for the next assembly; combined
    # STL fallback still disables the control and uses normal steel appearance.
    toggle.click()
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#status-message').textContent.includes('fallback.prt loaded')")
    assert toggle.is_disabled()
    assert toggle.get_attribute('aria-pressed')=='false'
    assert not page.evaluate('window.__testViewer.componentColorsEnabled')
    assert page.evaluate('window.__testViewer.geometry.length')==1
    assert page.evaluate('window.__testViewer.geometry[0].componentColor') is None
    assert not errors, errors
    browser.close()
print('MS30 Chromium: type colors, toggle, selection, explosion, fallback and steel restore passed')
