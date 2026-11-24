"""Verify CHR PC1/PC2 share their matching NX PMI guides and transform correctly."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'dev' / 'browser_smoke.py'
namespace = {'__file__': str(source), '__name__': '_chr_pmi_fixture_'}
exec(compile(source.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0], str(source), 'exec'), namespace)

def example(identifier, value, x):
    return {'id': identifier, 'name': 'Dimension', 'text': value, 'position': [x + 0.4, 0.5, 0],
      'meshId': 'b1', 'details': {'Size': float(value)},
      'presentation': {'source': 'NX annotation display components',
        'lines': [{'start':[x,0,0], 'end':[x,0.45,0]},
                  {'start':[x + .8,0,0], 'end':[x + .8,0.45,0]},
                  {'start':[x,0.4,0], 'end':[x + .8,0.4,0]}],
        'arrows': [{'point':[x,0.4,0]}, {'point':[x+.8,0.4,0]}],
        'texts': [{'position':[x + .4, .5, 0], 'text': value}]}}

payload = {'pmi': [example('pmi_1', '55', 0.0), example('pmi_2', '12', 0.7)],
  'characteristics': [
    {'id':'chr_1', 'name':'PC1', 'pmiId':'pmi_1', 'details':{'Designator':'PC1', 'Nominal Value':'55.0'}},
    {'id':'chr_2', 'name':'PC2', 'pmiId':'pmi_2', 'details':{'Designator':'PC2', 'Nominal Value':'12.0'}}],
  'characteristicsFile': {'name':'Bolt M12x55_chr.chr', 'status':'loaded'}, 'warnings': []}
markup = namespace['html_source']().replace('const nxPayload = {',
  'const nxPayload = {"annotations": ' + json.dumps(payload) + ', ', 1)
markup = markup.replace('window.__nxViewerReady = true;',
  'window.__chrViewer = viewer; window.__chrAnnotations = annotations; window.__nxViewerReady = true;')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('NX_BROWSER_EXECUTABLE', '/usr/bin/chromium'),
       args=['--no-sandbox','--enable-webgl','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width':1280,'height':820})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(markup, wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#inspector-tab-characteristics').disabled === false")
    page.locator('#inspector-tab-characteristics').click()
    for identifier in ('chr_1', 'chr_2'):
        marker = page.locator(f'.annotation-marker-characteristics[data-annotation-id="{identifier}"]')
        guide = page.locator(f'.annotation-dimension-characteristics[data-annotation-id="{identifier}"]')
        assert marker.is_visible(), identifier
        assert guide.get_attribute('visibility') == 'visible', identifier
        assert guide.locator('line').count() == 3
        assert guide.get_attribute('data-geometry-source') == 'nx-components'
    assert page.locator('.annotation-dimension-pmi:visible').count() == 0
    page.locator('.annotation-marker-characteristics[data-annotation-id="chr_1"]').click()
    assert page.locator('.annotation-dimension-characteristics[data-annotation-id="chr_1"]').get_attribute('class').find('is-selected') >= 0
    assert page.locator('.annotation-dimension-characteristics[data-annotation-id="chr_2"]').get_attribute('class').find('is-selected') < 0
    assert 'PC1' in page.locator('#inspector-content').inner_text()
    line = page.locator('.annotation-dimension-characteristics[data-annotation-id="chr_1"] line').last
    coords = lambda: line.evaluate('(el) => [Number(el.getAttribute("x1")), Number(el.getAttribute("y1")), Number(el.getAttribute("x2")), Number(el.getAttribute("y2"))]')
    initial = coords()
    page.evaluate('''() => { const v=window.__chrViewer;v.yaw+=0.3;v.pitch+=0.1;v.requestRender(); }''')
    page.wait_for_timeout(100)
    rotated = coords()
    assert any(abs(a-b)>1 for a,b in zip(initial, rotated)), (initial, rotated)
    page.evaluate('''() => { const v=window.__chrViewer;v.distance*=0.7;v.requestRender(); }''')
    page.wait_for_timeout(100)
    zoomed = coords()
    assert any(abs(a-b)>1 for a,b in zip(rotated, zoomed)), (rotated, zoomed)
    page.evaluate('''() => { const v=window.__chrViewer;v.setManualOffsets(new Map([['b1',[1,0,0]]]));v.requestRender(); }''')
    page.wait_for_timeout(100)
    moved = coords()
    assert any(abs(a-b)>1 for a,b in zip(zoomed, moved)), (zoomed, moved)
    page.evaluate('''() => { const v=window.__chrViewer;v.setExplodeOffsets(new Map([['b1',[0.5,0,0]]]));v.requestRender(); }''')
    page.wait_for_timeout(100)
    exploded = coords()
    assert any(abs(a-b)>1 for a,b in zip(moved, exploded)), (moved, exploded)
    page.locator('#inspector-tab-pmi').click()
    assert page.locator('.annotation-dimension-characteristics[data-annotation-id="chr_1"]').get_attribute('visibility') == 'hidden'
    assert page.locator('.annotation-dimension-pmi[data-annotation-id="pmi_1"]').get_attribute('visibility') == 'visible'
    assert not errors, errors
    browser.close()
print('Chromium: PC1/PC2 labels and native guide highlights, selection, Rotate, Zoom, Move, Explode, and tab switching passed.')
