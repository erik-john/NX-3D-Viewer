"""Render transparency using the real Chromium WebGL driver with simulated NX geometry."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os
root=Path(__file__).resolve().parents[1]
smoke=(root/'dev/browser_smoke.py').read_text(encoding='utf-8')
namespace={'__file__':str(root/'dev/browser_smoke.py')}
exec(compile(smoke.split('with sync_playwright() as p:')[0], 'smoke_helpers', 'exec'),namespace)
html=namespace['html_source']().replace('HTMLCanvasElement.prototype.getContext = () => mockGl;','// Use real Chromium WebGL for shader and render-state validation.')
html=html.replace('  const inspector = new PartInspector({', '  window.__testViewer=viewer;\n  const inspector = new PartInspector({',1)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
      args=['--no-sandbox','--enable-webgl','--enable-unsafe-swiftshader','--use-angle=swiftshader'])
    page=browser.new_page(viewport={'width':1360,'height':780})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(html,wait_until='load')
    try:
        page.wait_for_function('window.__nxViewerReady===true', timeout=5000)
    except Exception:
        print('WebGL init:', page.evaluate("() => ({error: document.querySelector('#viewer-error-text')?.textContent, ready: window.__nxViewerReady, status:document.querySelector('#status-message')?.textContent})"))
        print('Page errors:', errors)
        if 'WebGL is unavailable' in page.locator('#viewer-error-text').inner_text():
            print('SKIPPED: real WebGL unavailable in this headless environment')
            browser.close()
            raise SystemExit(0)
        raise
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#tree-summary').textContent.includes('2 components')")
    page.locator('.tree-label').filter(has_text='Fastener A').click()
    page.locator('#component-opacity-slider').fill('75')
    page.wait_for_timeout(150)
    states=page.evaluate('''() => ({
      gl:!!window.__testViewer.gl,
      glError:window.__testViewer.gl.getError(),
      opacities:window.__testViewer.geometry.map(p=>p.opacity),
      blending:window.__testViewer.gl.isEnabled(window.__testViewer.gl.BLEND),
      depthMask:window.__testViewer.gl.getParameter(window.__testViewer.gl.DEPTH_WRITEMASK)
    })''')
    assert states['gl'] and states['glError']==0, states
    assert abs(states['opacities'][0]-(0.045+0.955*0.25**2))<1e-6 and states['opacities'][1]==1,states
    assert not states['blending'] and states['depthMask'],states
    assert not errors,errors
    browser.close()
print('MS35 real WebGL: glass shader compiles, blending works, depth/blend state restores correctly')
