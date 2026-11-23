"""MS37 integration: one circular/curved selection -> diameter, two planes -> distance.
Uses the actual frontend controller and synthetic STL meshes with mock WebGL.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os
ROOT=Path(__file__).resolve().parents[1]
smoke=ROOT/'dev'/'browser_smoke.py'
source=smoke.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0]
namespace={'__file__':str(smoke),'__name__':'_ms37_fixture_'}
exec(compile(source,str(smoke),'exec'),namespace)
markup=namespace['html_source']().replace('window.__nxViewerReady = true;',
  'window.__ms37Viewer = viewer; window.__nxViewerReady = true;')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,
      executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
      args=['--no-sandbox','--disable-gpu'])
    page=browser.new_page(viewport={'width':1400,'height':850})
    errors=[]
    page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(markup,wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#tree-summary').textContent.includes('2 components')")
    points=page.evaluate('''() => {
      const v=window.__ms37Viewer;
      function makeMesh(id,triangles) {
        const arr=new Float32Array(triangles.flat(2));
        const indices=new Uint16Array(arr.length/3);
        for(let i=0;i<indices.length;i++)indices[i]=i;
        return {meshId:id,color:'#cdd8de',positions:arr,indices,
          normals:new Float32Array(arr.length),creasePositions:new Float32Array(0)};
      }
      function disk(id,x,z,r=10) {
        const triangles=[];
        for(let i=0;i<32;i++) {
          const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
          triangles.push([[x,0,z],[x+r*Math.cos(a),r*Math.sin(a),z],
            [x+r*Math.cos(b),r*Math.sin(b),z]]);
        }
        return makeMesh(id,triangles);
      }
      v.setScene([disk('b1',-20,0),disk('b2',20,50)]);
      v.setView('front');
      const rect=v.canvas.getBoundingClientRect(),matrix=v.cameraMatrix(rect.width,rect.height).matrix;
      const proj=p=>{const r=projectPoint(matrix,p,rect.width,rect.height);
        return {x:rect.left+r[0],y:rect.top+r[1]};};
      const a=proj([-20,0,0]),b=proj([20,0,50]);
      const midpoint=(a.x+b.x)/2;
      v.pickMesh=x=>x<midpoint?'b1':'b2';
      return {a,b};
    }''')
    page.locator('#measure-planes-toggle').click()
    assert page.locator('#measurement-summary').inner_text()=='Distance, Angle & Diameter'
    page.mouse.click(points['a']['x'],points['a']['y'])
    assert '20.000 mm' in page.locator('#measurement-summary').inner_text(), page.locator('#measurement-summary').inner_text()
    assert page.locator('#measurement-panel').get_attribute('data-kind')=='diameter'
    assert '1 circular planar face' in page.locator('#measurement-detail').inner_text()
    assert page.locator('#measurement-overlay').get_attribute('data-kind')=='diameter'
    assert not page.locator('#measurement-arc').is_visible()
    assert page.locator('#measurement-center').is_visible()
    assert not page.locator('#measurement-point-a').is_visible()
    assert not page.locator('#measurement-point-b').is_visible()
    # Same patch cannot silently count twice.
    page.mouse.click(points['a']['x'],points['a']['y'])
    assert '20.000 mm' in page.locator('#measurement-summary').inner_text()
    page.mouse.click(points['b']['x'],points['b']['y'])
    assert '64.031 mm' in page.locator('#measurement-summary').inner_text()
    assert 'center-to-center' in page.locator('#measurement-detail').inner_text()
    page.locator('#measurement-clear').click()
    assert page.locator('#measurement-summary').inner_text()=='Distance, Angle & Diameter'
    # The same UI must recognize a cylindrical wall, not just a flat disk.
    p2=page.evaluate('''() => {
      const v=window.__ms37Viewer;
      const triangles=[],r=10;
      for(let i=0;i<32;i++) {
        const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
        const q=[r*Math.cos(a),r*Math.sin(a),0],w=[r*Math.cos(b),r*Math.sin(b),0],
          t=[r*Math.cos(b),r*Math.sin(b),20],u=[r*Math.cos(a),r*Math.sin(a),20];
        triangles.push([q,w,t],[q,t,u]);
      }
      const positions=new Float32Array(triangles.flat(2));
      const indices=new Uint16Array(positions.length/3);
      for(let i=0;i<indices.length;i++)indices[i]=i;
      v.setScene([{meshId:'b1',color:'#ccd7df',positions,indices,
        normals:new Float32Array(positions.length),creasePositions:new Float32Array(0)}]);
      v.setView('right');v.pickMesh=()=> 'b1';
      const rect=v.canvas.getBoundingClientRect();
      const pp=projectPoint(v.cameraMatrix(rect.width,rect.height).matrix,[10,0,10],rect.width,rect.height);
      return {x:rect.left+pp[0],y:rect.top+pp[1]};
    }''')
    page.mouse.click(p2['x'],p2['y'])
    assert '20.000 mm' in page.locator('#measurement-summary').inner_text(),page.locator('#measurement-summary').inner_text()
    assert '1 cylindrical surface' in page.locator('#measurement-detail').inner_text()
    assert page.locator('#measurement-overlay').is_visible()
    assert not errors,errors
    browser.close()
print('MS37 Chromium: single circular face Ø20, same-surface deduplication, two circles -> 64.031mm 3D center distance, single curved cylinder Ø20, overlay and Clear passed.')
