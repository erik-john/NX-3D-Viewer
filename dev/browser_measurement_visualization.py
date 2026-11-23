"""MS43 precheck: selected surface, center/diameter and pair guides stay on geometry through all view changes."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'dev'/'browser_smoke.py'
namespace={'__file__':str(source),'__name__':'_geometry_fixture_'}
exec(compile(source.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],str(source),'exec'),namespace)
markup=namespace['html_source']().replace('window.__nxViewerReady = true;',
  'window.__guideViewer=viewer; window.__guideMeasurement=measurement; window.__nxViewerReady = true;')

def verify(page,kind,visible=True):
    state=page.evaluate('''() => {
      const v=window.__guideViewer,m=window.__guideMeasurement;
      const rect=v.canvas.getBoundingClientRect(),matrix=v.cameraMatrix(rect.width,rect.height).matrix;
      const proj=p=>projectPoint(matrix,p,rect.width,rect.height);
      const attr=(id,k)=>Number(document.getElementById(id).getAttribute(k));
      const dot=id=>[attr(id,'cx'),attr(id,'cy')];
      const positions=m.faces.map(f=>f.localCenter.map((x,i)=>x+f.part.offset[i]));
      return {positions,expected:positions.map(proj),dots:[dot('measurement-point-a'),dot('measurement-point-b')],
        center:dot('measurement-center'),
        from:[attr('measurement-line','x1'),attr('measurement-line','y1')],
        to:[attr('measurement-line','x2'),attr('measurement-line','y2')],
        kind:document.getElementById('measurement-overlay').dataset.kind,
        hidden:document.getElementById('measurement-overlay').hasAttribute('hidden'),
        centerHidden:document.getElementById('measurement-center').hasAttribute('hidden'),
        firstHidden:document.getElementById('measurement-point-a').hasAttribute('hidden'),
        secondHidden:document.getElementById('measurement-point-b').hasAttribute('hidden'),
        arcHidden:document.getElementById('measurement-arc').hasAttribute('hidden'),
        guideDirection:m.faces[0]?.diameterDirection,
        selectedBuffers:v.measureBuffers.length,
        attached:v.measureBuffers.every((item,i)=>item.part===m.faces[i].part&&item.edgeCount>0),
        visible:v.measureFaces.map(f=>f.part.visible),
        viewport:[rect.width,rect.height]};
    }''')
    assert state['kind']==kind,(kind,state)
    # A world-space point may go behind the camera during Right/Top view;
    # hiding the guide is correct, but leaving stale screen coordinates is not.
    occluded=any(p is None for p in state['expected'])
    assert state['hidden'] == ((not visible) or occluded),state
    if not visible or occluded:return state
    assert state['selectedBuffers'] == len(state['positions']) and state['attached'],state
    assert state['arcHidden'],state
    assert all(state['visible']),state
    if kind=='diameter':
        assert not state['centerHidden'],state
        assert state['firstHidden'] and state['secondHidden'],state
        for a,b in zip(state['center'],state['expected'][0]):
            assert abs(a-b)<1.2,state
        a,b,c=state['from'],state['to'],state['center']
        dx=b[0]-a[0];dy=b[1]-a[1]
        segment=max(1e-8,dx*dx+dy*dy)
        cross=abs(dx*(c[1]-a[1])-dy*(c[0]-a[0]))
        distance_to_line=cross/(segment**0.5)
        t=((c[0]-a[0])*dx+(c[1]-a[1])*dy)/segment
        assert distance_to_line<1.2 and -0.01<=t<=1.01,state
    else:
        assert state['centerHidden'] and not state['firstHidden'] and not state['secondHidden'],state
        for actual,expected in zip(state['dots'],state['expected']):
            for a,b in zip(actual,expected):assert abs(a-b)<1.5,state
        for actual,expected in zip([state['from'],state['to']],state['expected']):
            for a,b in zip(actual,expected):assert abs(a-b)<1.5,state
    return state

with sync_playwright() as p:
    options={'headless':True,'args':['--enable-webgl','--enable-unsafe-swiftshader',
      '--use-gl=angle','--use-angle=swiftshader','--no-sandbox']}
    if os.environ.get('NX_BROWSER_EXECUTABLE'):
        options['executable_path']=os.environ['NX_BROWSER_EXECUTABLE']
    browser=p.chromium.launch(**options)
    page=browser.new_page(viewport={'width':1340,'height':850})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(markup,wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#tree-summary').textContent.includes('2 components')")
    page.evaluate('''() => {
      const v=window.__guideViewer;
      function disk(id,cx) {
        const triangles=[],r=10;
        for(let i=0;i<32;i++) {
          const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
          triangles.push([[cx,0,0],[cx+r*Math.cos(a),r*Math.sin(a),0],
            [cx+r*Math.cos(b),r*Math.sin(b),0]]);
        }
        const positions=new Float32Array(triangles.flat(2)),indices=new Uint16Array(positions.length/3);
        for(let i=0;i<indices.length;i++)indices[i]=i;
        return {meshId:id,color:'#dddfe3',positions,indices,normals:new Float32Array(positions.length),
          creasePositions:new Float32Array(0)};
      }
      v.setScene([disk('b1',-30),disk('b2',30)]);
      v.setView('front');
      v.pickMesh=x=>x<(v.canvas.getBoundingClientRect().left+v.canvas.getBoundingClientRect().width/2)?'b1':'b2';
    }''')
    page.locator('#measure-planes-toggle').click()
    points=page.evaluate('''() => {
      const v=window.__guideViewer,r=v.canvas.getBoundingClientRect(),mat=v.cameraMatrix(r.width,r.height).matrix;
      const px=p=>projectPoint(mat,p,r.width,r.height);
      return [[-30,0,0],[30,0,0]].map(p=>{
        const q=px(p);return [r.left+q[0],r.top+q[1]];});
    }''')
    page.mouse.click(*points[0]);page.wait_for_function("document.querySelector('#measurement-overlay').dataset.kind==='diameter'")
    first=verify(page,'diameter');assert first['guideDirection']
    assert '20.000' in page.locator('#measurement-summary').inner_text()
    # Rotate and zoom one diameter in place: direction stays tied to the local face.
    for operation in [
       'v.yaw+=0.2;v.pitch=0.3;v.requestRender()',
       'v.distance*=1.2;v.requestRender()',
       'v.target[0]+=3;v.target[1]+=4;v.requestRender()',
       "v.setView('top')",
       "v.setView('front')",
       'v.fitMeasureFaces(m.faces)']:
        page.evaluate('''operation => {
          const v=window.__guideViewer,m=window.__guideMeasurement;
          const run=new Function('v','m',operation); run(v,m);
        }''',operation)
        page.wait_for_timeout(90)
        state=verify(page,'diameter')
        assert state['guideDirection']==first['guideDirection'],(state,first)
    page.mouse.click(*points[1])
    # When the camera was changed, the old screen point may be off the disk.
    if page.locator('#measurement-overlay').get_attribute('data-kind')!='center_distance':
        page.evaluate('''() => {
          const v=window.__guideViewer,m=window.__guideMeasurement;
          const f=measurementSurface({part:v.geometry.find(g=>g.meshId==='b2'),triangleIndex:0,point:[35,0,0]});
          m.select(f);
        }''')
    page.wait_for_timeout(100)
    verify(page,'center_distance')
    assert '60.000' in page.locator('#measurement-summary').inner_text()
    for operation in [
       "v.setManualOffsets(new Map([['b2',[15,3,0]]]))",
       "v.setExplodeOffsets(new Map([['b2',[5,0,0]]]))",
       'v.yaw=0.7;v.pitch=0.25;v.requestRender()',
       'v.distance*=0.85;v.requestRender()',
       'v.target[0]+=3;v.requestRender()',
       "v.setView('iso')",
       "v.setView('right')",
       "v.setView('front')",
       'm.fitSelected()']:
        page.evaluate('''operation => {
          const v=window.__guideViewer,m=window.__guideMeasurement;
          new Function('v','m',operation)(v,m);
        }''',operation)
        page.wait_for_timeout(90)
        verify(page,'center_distance')
    page.set_viewport_size({'width':1000,'height':700})
    page.wait_for_timeout(150)
    verify(page,'center_distance')
    page.evaluate("window.__guideViewer.setMeshVisible('b2',false)")
    page.wait_for_timeout(100)
    verify(page,'center_distance',False)
    page.evaluate("window.__guideViewer.setMeshVisible('b2',true)")
    page.wait_for_timeout(100)
    verify(page,'center_distance')
    assert not errors,errors
    browser.close()
print('MS43 precheck Chromium: shape outline, center/diameter, 2-circle center distance, Rotate/Zoom/Pan/Fit/Move/Explode/Resize/Visibility guides passed.')
