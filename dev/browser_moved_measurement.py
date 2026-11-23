"""MS42 regression: measuring translated cylinders keeps guides on their displayed geometry."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
smoke=ROOT/'dev'/'browser_smoke.py'
namespace={'__file__':str(smoke),'__name__':'_measure_fixture_'}
exec(compile(smoke.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],str(smoke),'exec'),namespace)
markup=namespace['html_source']().replace('window.__nxViewerReady = true;',
 'window.__moveViewer=viewer; window.__moveMeasurement=measurement; window.__nxViewerReady = true;')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,
      executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
      args=['--no-sandbox','--disable-gpu'])
    page=browser.new_page(viewport={'width':1400,'height':850})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(markup,wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#tree-summary').textContent.includes('2 components')")
    points=page.evaluate('''() => {
      const v=window.__moveViewer;
      function cylinder(id,cx) {
        const triangles=[],r=10;
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
        for(let i=0;i<indices.length;i++)indices[i]=i;
        return {meshId:id,color:'#ccd7df',positions,indices,
          normals:new Float32Array(positions.length),creasePositions:new Float32Array(0)};
      }
      v.setScene([cylinder('b1',-30),cylinder('b2',30)]);
      // Translation applied BEFORE measurement, unlike the older regression.
      v.setExplodeOffsets(new Map([['b2',[5,0,0]]]));
      v.setManualOffsets(new Map([['b2',[7,0,0]]]));
      v.setView('front');
      const r=v.canvas.getBoundingClientRect(),matrix=v.cameraMatrix(r.width,r.height).matrix;
      const project=pt=>{const p=projectPoint(matrix,pt,r.width,r.height);
        return {x:r.left+p[0],y:r.top+p[1]};};
      const a=project([-28,0,9.5]),b=project([44,0,9.5]);
      const middle=(a.x+b.x)/2;
      v.pickMesh=x=>x<middle?'b1':'b2';
      return {a,b};
    }''')
    page.locator('#measure-planes-toggle').click()
    page.mouse.click(points['a']['x'],points['a']['y'])
    assert '20.000 mm' in page.locator('#measurement-summary').inner_text()
    page.mouse.click(points['b']['x'],points['b']['y'])
    assert '72.000 mm' in page.locator('#measurement-summary').inner_text(),page.locator('#measurement-summary').inner_text()
    geometry=page.evaluate('''() => {
      const m=window.__moveMeasurement,v=window.__moveViewer;
      const r=v.canvas.getBoundingClientRect(),matrix=v.cameraMatrix(r.width,r.height).matrix;
      const faces=m.faces;
      const current=faces.map(f=>f.localCenter.map((x,i)=>x+f.part.offset[i]));
      const pixels=current.map(p=>projectPoint(matrix,p,r.width,r.height));
      const dotA=document.querySelector('#measurement-point-a');
      const dotB=document.querySelector('#measurement-point-b');
      const toPixel=dot=>[Number(dot.getAttribute('cx')),Number(dot.getAttribute('cy'))];
      return {current,pixels,dots:[toPixel(dotA),toPixel(dotB)]};
    }''')
    assert abs(geometry['current'][1][0]-42)<0.05,geometry
    for point,dot in zip(geometry['pixels'],geometry['dots']):
        assert abs(point[0]-dot[0])<2 and abs(point[1]-dot[1])<2,geometry
    page.evaluate("() => window.__moveViewer.setManualOffsets(new Map([['b2',[19,0,0]]]))")
    page.wait_for_function("document.querySelector('#measurement-summary').textContent.includes('84.000 mm')")
    updated=page.evaluate('''() => ({
      endpoint:Number(document.querySelector('#measurement-point-b').getAttribute('cx')),
      center:window.__moveMeasurement.faces[1].localCenter.map((x,i)=>
        x+window.__moveMeasurement.faces[1].part.offset[i])
    })''')
    assert abs(updated['center'][0]-54)<0.05,updated
    assert not errors,errors
    browser.close()
print('MS42 Chromium: measure moved cylinder, exact 2D guide attachment, further Move and distance recomputation passed.')
