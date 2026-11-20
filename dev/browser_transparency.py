"""MS33 Chromium interaction smoke checks, using an in-memory NX assembly fixture."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os

root = Path(__file__).resolve().parents[1]
smoke = (root/'dev/browser_smoke.py').read_text(encoding='utf-8')
namespace = {'__file__': str(root/'dev/browser_smoke.py')}
exec(compile(smoke.split('with sync_playwright() as p:')[0], 'smoke_helpers', 'exec'), namespace)
html = namespace['html_source']()
# Expose actual controllers to assert per-mesh changes without relying on colors/pixels.
html = html.replace('  const inspector = new PartInspector({',
    '  window.__testViewer = viewer;\n  const inspector = new PartInspector({', 1)
html = html.replace('  viewer.onHoverMesh = meshId => {',
    '  window.__testTree = tree;\n  viewer.onHoverMesh = meshId => {', 1)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True,
      executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
      args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width':1400,'height':850})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(html, wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    slider = page.locator('#component-opacity-slider')
    solid_all = page.locator('#reset-transparency-all')
    assert slider.is_disabled(), 'slider needs a selected component'
    assert page.locator('#tree-opacity-actions').is_hidden()
    assert page.locator('#transparency-selected').count() == 0
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#tree-summary').textContent.includes('2 components')")
    assert page.locator('#tree-opacity-actions').is_visible()
    assert slider.is_disabled() and solid_all.is_disabled()
    page.locator('.tree-label').filter(has_text='Fastener A').click()
    assert slider.is_enabled() and slider.input_value() == '0'
    slider.fill('100')
    assert page.locator('#component-opacity-value').inner_text() == '100%'
    assert abs(page.evaluate("window.__testViewer.geometry.find(x => x.meshId==='b1').opacity")-0.045)<1e-6
    assert page.evaluate("window.__testViewer.geometry.find(x => x.meshId==='b2').opacity") == 1
    slider.fill('65')
    expected = 0.045+0.955*(1-0.65)**2
    assert slider.input_value() == '65'
    assert abs(page.evaluate("window.__testViewer.geometry.find(x => x.meshId==='b1').opacity")-expected)<1e-6
    assert solid_all.is_enabled()
    # Explode and selection remain independent from the appearance setting.
    assert page.evaluate("window.__testTree.selectedId") == 'c1'
    page.get_by_role('button',name='Explode component Fastener A').click()
    assert page.evaluate("window.__testViewer.geometry.find(x=>x.meshId==='b1').offset.some(v=>v!==0)")
    assert abs(page.evaluate("window.__testViewer.geometry.find(x=>x.meshId==='b1').opacity")-expected)<1e-6
    page.locator('.tree-label').filter(has_text='Fastener B').click()
    assert slider.input_value() == '0', 'a new selection shows its own saved value'
    slider.fill('35')
    assert slider.input_value() == '35'
    assert page.evaluate("window.__testViewer.geometry.find(x=>x.meshId==='b2').opacity") < 1
    page.locator('.tree-label').filter(has_text='Fastener A').click()
    assert slider.input_value() == '65', 'reselecting restores its current value in the slider'
    slider.fill('0')
    assert page.evaluate("window.__testViewer.geometry.find(x=>x.meshId==='b1').opacity") == 1
    assert slider.input_value() == '0'
    assert solid_all.is_enabled(), 'Fastener B is still translucent'
    solid_all.click()
    assert page.evaluate('window.__testViewer.geometry.every(p=>p.opacity===1)')
    assert solid_all.is_disabled()
    assert slider.is_enabled() and slider.input_value() == '0', 'the selected component can still be edited'
    # Loading a new model clears previous glass states.
    slider.fill('48')
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#status-message').textContent.includes('fasteners.prt loaded')")
    assert page.evaluate('window.__testViewer.geometry.every(p=>p.opacity===1)')
    assert slider.is_disabled(), 'model replacement resets selection'
    # Combined STL contains only one mesh, not selectable components.
    page.evaluate("nxPayload.geometryMode='combined'; nxPayload.modelUrl='/api/models/combined.stl'")
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#status-message').textContent.includes('fasteners.prt loaded')")
    assert page.locator('#tree-opacity-actions').is_hidden()
    assert slider.is_disabled()
    assert not errors, errors
    browser.close()
print('MS35 Chromium: 0-100 transparency follows selection; glass appearance, Solid All, Explode and new model passed')
