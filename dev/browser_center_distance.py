"""MS38 browser: real pointer selection for two cylindrical axis centers; plane symbols."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
smoke=ROOT/'dev'/'browser_smoke.py'
namespace={'__file__':str(smoke),'__name__':'_ms38_fixture_'}
exec(compile(smoke.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],str(smoke),'exec'),namespace)
markup=namespace['html_source']().replace('window.__nxViewerReady = true;',
 'window.__ms38Viewer = viewer; window.__ms38Measurement=measurement; window.__nxViewerReady = true;')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,
      executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
      args=['--no-sandbox','--disable-gpu'])
    page=browser.new_page(viewport={'width':1400,'height':850})
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content(markup,wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#tree-summary').textContent.includes('2 components')")
    points=page.evaluate('''() => {
      const v=window.__ms38Viewer;
      function cyl(id,cx) {
        const triangles=[];let r=10;
        for(let i=0;i<32;i++) {
          const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
          const q=[cx+r*Math.cos(a),-10,r*Math.sin(a)];
          const w=[cx+r*Math.cos(b),-10,r*Math.sin(b)];
          const t=[cx+r*Math.cos(b),10,r*Math.sin(b)];
          const u=[cx+r*Math.cos(a),10,r*Math.sin(a)];
          triangles.push([q,w,t],[q,t,u]);
        }
        const positions=new Float32Array(triangles.flat(2));
        const indices=new Uint16Array(positions.length/3);
        for(let i=0;i<indices.length;i++) indices[i]=i;
        return {meshId:id,color:'#ccd7df',positions,indices,
          normals:new Float32Array(positions.length),creasePositions:new Float32Array(0)};
      }
      v.setScene([cyl('b1',-30),cyl('b2',30)]);
      v.setView('front');
      const r=v.canvas.getBoundingClientRect(),matrix=v.cameraMatrix(r.width,r.height).matrix;
      const project=pt=>{const p=projectPoint(matrix,pt,r.width,r.height);
        return {x:r.left+p[0],y:r.top+p[1]};};
      const a=project([-28,0,9.5]),b=project([32,0,9.5]);
      const middle=(a.x+b.x)/2;
      v.pickMesh=x=>x<middle?'b1':'b2';
      return {a,b};
    }''')
    page.locator('#measure-planes-toggle').click()
    page.mouse.click(points['a']['x'],points['a']['y'])
    assert '20.000 mm' in page.locator('#measurement-summary').inner_text(),page.locator('#measurement-detail').inner_text()
    assert 'cylindrical' in page.locator('#measurement-detail').inner_text()
    page.mouse.click(points['b']['x'],points['b']['y'])
    assert '60.000 mm' in page.locator('#measurement-summary').inner_text(),page.locator('#measurement-summary').inner_text()+' '+page.locator('#measurement-detail').inner_text()
    assert 'centerline spacing' in page.locator('#measurement-detail').inner_text()
    assert page.locator('#measurement-overlay').get_attribute('data-kind')=='center_distance'
    # Selection result must recompute from offsets in the existing viewer frame.
    page.evaluate("() => window.__ms38Viewer.setManualOffsets(new Map([['b2',[12,0,0]]]))")
    page.wait_for_function("document.querySelector('#measurement-summary').textContent.includes('72.000 mm')")
    # The plane status symbols are displayed in the actual result UI.
    page.evaluate('''() => {
      const m=window.__ms38Measurement, v=window.__ms38Viewer;
      m.clear();
      const mk=(point,normal,id)=>({kind:'plane',meshId:id,part:v.geometry[id==='b1'?0:1],
        point,normal,triangleIndex:0,triangleIds:new Set([0]),positions:new Float32Array(0)});
      m.select(mk([0,0,0],[0,0,1],'b1'));
      m.select(mk([0,0,50],[0,0,-1],'b2'));
    }''')
    assert '∥' in page.locator('#measurement-summary').inner_text()
    assert '180.00°' in page.locator('#measurement-summary').inner_text()
    assert '50.000 mm' in page.locator('#measurement-summary').inner_text()
    page.evaluate('''() => {
      const m=window.__ms38Measurement, v=window.__ms38Viewer;
      m.clear();
      const mk=(normal,id)=>({kind:'plane',meshId:id,part:v.geometry[id==='b1'?0:1],
        point:[0,0,0],normal,triangleIndex:0,triangleIds:new Set([0]),positions:new Float32Array(0)});
      m.select(mk([0,0,1],'b1'));
      m.select(mk([1,0,0],'b2'));
    }''')
    assert '⊥' in page.locator('#measurement-summary').inner_text()
    assert '90.00°' in page.locator('#measurement-summary').inner_text()
    assert not errors,errors
    browser.close()
print('MS38 Chromium: two cylindrical faces -> Ø20 then 60mm centerline spacing, move -> 72mm, overlays, ∥ 180° + distance, and ⊥ 90° passed.')
