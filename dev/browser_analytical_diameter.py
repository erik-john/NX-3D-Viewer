"""MS43-precheck: NX half-cylinder metadata drives measured diameter and overlay."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'dev'/'browser_smoke.py'
namespace={'__file__':str(source),'__name__':'_cad_fixture_'}
exec(compile(source.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],str(source),'exec'),namespace)
markup=namespace['html_source']().replace('window.__nxViewerReady = true;',
    'window.__cadViewer=viewer; window.__cadMeasure=measurement; window.__nxViewerReady = true;')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,
        executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
        args=['--no-sandbox','--disable-gpu'])
    page=browser.new_page(viewport={'width':1400,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(markup,wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#tree-summary').textContent.includes('2 components')")
    position=page.evaluate('''() => {
      const v=window.__cadViewer;
      const tris=[],radius=10;
      for(let i=0;i<6;i++) {
        const a=Math.PI*i/6,b=Math.PI*(i+1)/6;
        const p=[radius*Math.cos(a),radius*Math.sin(a)],q=[radius*Math.cos(b),radius*Math.sin(b)];
        const points=[[[p[0],0,-p[1]],[q[0],0,-q[1]],[q[0],30,-q[1]]],
                      [[p[0],0,-p[1]],[q[0],30,-q[1]],[p[0],30,-p[1]]]];
        tris.push(...points);
      }
      const positions=new Float32Array(tris.flat(2));
      const indices=new Uint16Array(positions.length/3);
      for(let i=0;i<indices.length;i++) indices[i]=i;
      v.setScene([{meshId:'b1',positions,indices,color:'#dee1e3',
        normals:new Float32Array(positions.length),creasePositions:new Float32Array(0),
        analyticalFaces:[{type:'cylinder',point:[0,0,0],axis:[0,0,1],
          bounds:[-10,0,0,10,10,30],radius}]}]);
      v.setView('front');
      v.pickMesh=()=> 'b1';
      const rect=v.canvas.getBoundingClientRect();
      const px=projectPoint(v.cameraMatrix(rect.width,rect.height).matrix,[0,15,-9.5],rect.width,rect.height);
      return {x:rect.left+px[0],y:rect.top+px[1]};
    }''')
    page.locator('#measure-planes-toggle').click()
    page.mouse.click(position['x'],position['y'])
    assert '20.000 mm' in page.locator('#measurement-summary').inner_text(),page.locator('#measurement-detail').inner_text()
    assert 'NX analytical cylindrical face' in page.locator('#measurement-detail').inner_text()
    assert page.locator('#measurement-overlay').is_visible()
    before=page.evaluate("Number(document.querySelector('#measurement-point-a').getAttribute('cx'))")
    page.evaluate("window.__cadViewer.setManualOffsets(new Map([['b1',[12,0,0]]]))")
    page.wait_for_function("window.__cadMeasure.faces.length === 1 && document.querySelector('#measurement-overlay').hasAttribute('viewBox')")
    page.evaluate('window.__cadMeasure.update()')
    after=page.evaluate("Number(document.querySelector('#measurement-point-a').getAttribute('cx'))")
    assert after>before+5,(before,after)
    page.evaluate("window.__cadViewer.setExplodeOffsets(new Map([['b1',[8,0,0]]]))")
    page.evaluate('window.__cadMeasure.update()')
    final=page.evaluate("Number(document.querySelector('#measurement-point-a').getAttribute('cx'))")
    assert final>after+3,(after,final)
    assert '20.000 mm' in page.locator('#measurement-summary').inner_text()
    assert not errors,errors
    browser.close()
print('Chromium: selected NX half-cylinder by clicking viewer, measured CAD diameter, followed Move+Explode guides.')
