"""Verify actual NX annotation line components render and stay attached to geometry."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'dev' / 'browser_smoke.py'
namespace = {'__file__': str(source), '__name__': '_native_pmi_fixture_'}
exec(compile(source.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0], str(source), 'exec'), namespace)
payload = {'pmi': [{'id': 'pmi_1', 'name': 'Linear Dimension', 'text': '55',
  'meshId': 'b1', 'type': 'PmiLinearDimension', 'position': [0.5, 0.34, 0],
  'presentation': {'source': 'NX annotation display components',
    'lines': [
      {'start':[0,0,0], 'end':[0,0.3,0], 'type':'Extension'},
      {'start':[1,0,0], 'end':[1,0.3,0], 'type':'Extension'},
      {'start':[0,0.3,0], 'end':[1,0.3,0], 'type':'Dimension'}],
    'arrows':[{'point':[0,0.3,0], 'type':'Filled'}, {'point':[1,0.3,0], 'type':'Filled'}],
    'texts':[{'position':[0.5,0.34,0], 'text':'55'}]},
  'details': {'Text': '55', 'Type': 'PmiLinearDimension'}}],
  'characteristics': [], 'warnings': []}
markup = namespace['html_source']().replace('const nxPayload = {',
  'const nxPayload = {"annotations": ' + json.dumps(payload) + ', ', 1)
markup = markup.replace('window.__nxViewerReady = true;',
   'window.__nativePmiViewer = viewer; window.__nativePmiController = annotations; window.__nxViewerReady = true;')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('NX_BROWSER_EXECUTABLE', '/usr/bin/chromium'),
        args=['--no-sandbox', '--enable-webgl', '--enable-unsafe-swiftshader',
              '--use-gl=angle', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(markup, wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#inspector-tab-pmi').disabled === false")
    page.locator('#inspector-tab-pmi').click()
    assert page.locator('.annotation-dimension').get_attribute('data-geometry-source') == 'nx-components'
    assert page.locator('.annotation-dimension line').count() == 3
    assert page.locator('.annotation-dimension polygon').count() == 2
    page.locator('.inspector-annotation-item').first.click()
    assert 'NX Annotation Graphics' in page.locator('#inspector-content').inner_text()
    assert page.locator('.annotation-dimension.is-selected').count() == 1
    snapshot = lambda: page.locator('.annotation-dimension line').last.evaluate(
        '(el) => [Number(el.getAttribute("x1")), Number(el.getAttribute("y1")), Number(el.getAttribute("x2")), Number(el.getAttribute("y2"))]')
    before = snapshot()
    # The line coordinates must change when the viewer's camera moves.
    page.evaluate('''() => { const v=window.__nativePmiViewer;
      v.yaw+=0.25;v.pitch+=0.15;v.requestRender(); }''')
    page.wait_for_timeout(120)
    rotated = snapshot()
    assert any(abs(a-b)>1 for a,b in zip(before,rotated)), (before,rotated)
    page.evaluate('''() => { const v=window.__nativePmiViewer;
      v.distance*=0.7;v.requestRender(); }''')
    page.wait_for_timeout(120)
    zoomed = snapshot()
    assert any(abs(a-b)>1 for a,b in zip(rotated,zoomed)), (rotated,zoomed)
    page.evaluate('''() => { const v=window.__nativePmiViewer;
      v.setManualOffsets(new Map([['b1',[1,0,0]]]));v.requestRender(); }''')
    page.wait_for_timeout(120)
    moved = snapshot()
    assert any(abs(a-b)>1 for a,b in zip(zoomed,moved)), (zoomed,moved)
    page.evaluate('''() => { const v=window.__nativePmiViewer;
      v.setExplodeOffsets(new Map([['b1',[0.5,0,0]]]));v.requestRender(); }''')
    page.wait_for_timeout(120)
    exploded = snapshot()
    assert any(abs(a-b)>1 for a,b in zip(moved,exploded)), (moved,exploded)
    page.evaluate('window.__nativePmiViewer.setView("front")')
    page.wait_for_timeout(130)
    assert page.locator('.annotation-dimension').get_attribute('visibility') == 'visible'
    page.locator('#fit-button').click()
    page.wait_for_timeout(130)
    assert page.locator('.annotation-dimension').get_attribute('visibility') == 'visible'
    page.locator('#inspector-tab-information').click()
    assert page.locator('.annotation-dimension').get_attribute('visibility') == 'hidden'
    assert not errors, errors
    browser.close()
print('Chromium: NX component lines and text, selected PMI, Rotate, Zoom, Move, Explode, Front and Fit passed.')
