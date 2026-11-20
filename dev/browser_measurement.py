"""MS36 browser integration with actual controller and synthetic planar NX STL meshes.

A mocked WebGL driver is used for application interaction; this does not prove
physical GPU rendering or exact NX CAD-face identification.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os

ROOT=Path(__file__).resolve().parents[1]
smoke_path=ROOT/'dev'/'browser_smoke.py'
source=smoke_path.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0]
namespace={'__file__':str(smoke_path),'__name__':'_ms36_browser_fixture_'}
exec(compile(source,str(smoke_path),'exec'), namespace)
markup=namespace['html_source']().replace('window.__nxViewerReady = true;',
  'window.__ms36Viewer = viewer; window.__nxViewerReady = true;')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
                              args=['--no-sandbox','--disable-gpu'])
    page=browser.new_page(viewport={'width':1400,'height':850})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(markup,wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    assert page.locator('#measure-planes-toggle').is_disabled()
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#tree-summary').textContent.includes('2 components')")
    assert page.locator('#measure-planes-toggle').is_enabled()
    points=page.evaluate('''() => {
      const v=window.__ms36Viewer;
      function square(id,x,z) {
        const a=[x-8,-8,z],b=[x+8,-8,z],c=[x+8,8,z],d=[x-8,8,z];
        const positions=new Float32Array([...a,...b,...c,...a,...c,...d]);
        const normals=new Float32Array(18);for(let i=2;i<18;i+=3)normals[i]=1;
        return {meshId:id,color:'#ced5d8',positions,normals,
          indices:new Uint16Array([0,1,2,3,4,5]),creasePositions:new Float32Array(0)};
      }
      v.setScene([square('b1',-20,0),square('b2',20,50)]);
      v.setView('front');
      v.pickMesh=(x)=>{
        const mid=v.canvas.getBoundingClientRect().left+v.canvas.getBoundingClientRect().width/2;
        return x<mid?'b1':'b2';
      };
      function point(x,z){
        const r=v.canvas.getBoundingClientRect();
        const project=projectPoint(v.cameraMatrix(r.width,r.height).matrix,[x,0,z],r.width,r.height);
        return {x:r.left+project[0],y:r.top+project[1]};
      }
      return {a:point(-20,0),b:point(20,50)};
    }''')
    page.locator('#measure-planes-toggle').click()
    assert page.locator('#measurement-panel').is_visible()
    assert page.locator('#measurement-fit').is_disabled()
    assert page.locator('#measurement-summary').inner_text()=='Distance, Angle & Diameter'
    page.mouse.click(points['a']['x'],points['a']['y'])
    assert page.locator('#measurement-summary').inner_text()=='Plane 1 selected'
    assert page.locator('#measurement-fit').is_enabled()
    page.mouse.click(points['b']['x'],points['b']['y'])
    assert '50.000 mm' in page.locator('#measurement-summary').inner_text(), page.locator('#measurement-summary').inner_text()
    assert '∥' in page.locator('#measurement-summary').inner_text()
    assert '0.00°' in page.locator('#measurement-summary').inner_text()
    assert page.locator('#measurement-overlay').is_visible()
    before_fit=page.evaluate('''() => ({target:window.__ms36Viewer.target.slice(), yaw:window.__ms36Viewer.yaw, pitch:window.__ms36Viewer.pitch})''')
    page.locator('#measurement-fit').click()
    after_fit=page.evaluate('''() => ({target:window.__ms36Viewer.target.slice(), yaw:window.__ms36Viewer.yaw, pitch:window.__ms36Viewer.pitch})''')
    assert before_fit['yaw']==after_fit['yaw'] and before_fit['pitch']==after_fit['pitch']
    assert all(abs(x-y)<1e-6 for x,y in zip(after_fit['target'], [0,0,25])), after_fit
    assert len(page.locator('#measurement-summary').inner_text())>0
    # Move and Explode use the same final offset; result must follow the mesh.
    page.evaluate('''() => window.__ms36Viewer.setManualOffsets(new Map([['b2',[0,0,20]]]))''')
    page.wait_for_function("document.querySelector('#measurement-summary').textContent.includes('70.000 mm')")
    # Clear, then select an angled plane: automatic angle replaces distance.
    page.locator('#measurement-clear').click()
    assert page.locator('#measurement-summary').inner_text()=='Distance, Angle & Diameter'
    angled_points=page.evaluate('''() => {
      const v=window.__ms36Viewer;
      const plane=(id,vertices) => {
        const p=new Float32Array([...vertices[0],...vertices[1],...vertices[2],
          ...vertices[0],...vertices[2],...vertices[3]]);
        return {meshId:id,color:'#cbd2d5',positions:p,normals:new Float32Array(18),
          indices:new Uint16Array([0,1,2,3,4,5]),creasePositions:new Float32Array(0)};
      };
      v.setScene([
        plane('b1',[[-28,-8,0],[-12,-8,0],[-12,8,0],[-28,8,0]]),
        plane('b2',[[12,-8,42],[28,-8,58],[28,8,58],[12,8,42]]),
      ]);
      v.setView('front');
      const r=v.canvas.getBoundingClientRect(), matrix=v.cameraMatrix(r.width,r.height).matrix;
      const p1=projectPoint(matrix,[-20,0,0],r.width,r.height);
      const p2=projectPoint(matrix,[20,0,50],r.width,r.height);
      return {a:{x:r.left+p1[0],y:r.top+p1[1]}, b:{x:r.left+p2[0],y:r.top+p2[1]}};
    }''')
    page.mouse.click(angled_points['a']['x'],angled_points['a']['y'])
    assert page.locator('#measurement-summary').inner_text()=='Plane 1 selected'
    page.mouse.click(angled_points['b']['x'],angled_points['b']['y'])
    assert '45.00°' in page.locator('#measurement-summary').inner_text()
    assert 'mm' in page.locator('#measurement-summary').inner_text()
    assert 'nearest selected-face clearance' in page.locator('#measurement-detail').inner_text()
    assert page.locator('#measurement-fit').is_enabled()
    old_target=page.evaluate('''() => ({target:window.__ms36Viewer.target.slice(),distance:window.__ms36Viewer.distance})''')
    page.locator('#measurement-fit').click()
    new_target=page.evaluate('''() => ({target:window.__ms36Viewer.target.slice(),distance:window.__ms36Viewer.distance})''')
    assert old_target != new_target, (old_target,new_target)
    assert page.locator('#measurement-overlay').is_visible()
    assert page.locator('#measurement-overlay').get_attribute('data-kind') == 'angle'
    # No stale result from replacing the test geometry.
    page.locator('#measure-planes-toggle').click()
    assert page.locator('#measurement-panel').is_hidden()
    assert not errors,errors
    browser.close()
print('MS36 browser: View measurement toggle, two planar clicks, 50mm result, Move offset to 70mm, 45deg angle, clear/exit and existing model loading passed.')
