"""Validate the real browser interface with in-memory NX responses."""
from pathlib import Path
import base64
import json
import os
import re
import struct
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / 'frontend'


def small_stl():
    return (b'NX example' + b'\0' * (80 - len(b'NX example')) + struct.pack('<I', 1) +
            struct.pack('<12fH', 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0))


def script_code():
    paths = ['geometry.js', 'stl.js', 'viewer.js', 'item_tree.js', 'inspector.js', 'app.js']
    pieces = []
    for name in paths:
        code = (FRONTEND / 'js' / name).read_text(encoding='utf-8')
        code = re.sub(r'^import .*?;\s*$', '', code, flags=re.MULTILINE)
        code = re.sub(r'\bexport\s+(?=(?:function|class|const|let)\s)', '', code)
        pieces.append(code)
    return '\n'.join(pieces)


def html_source():
    markup = (FRONTEND / 'index.html').read_text(encoding='utf-8')
    markup = markup.replace('<link rel="stylesheet" href="/css/style.css">',
                            '<style>' + (FRONTEND / 'css/style.css').read_text(encoding='utf-8') + '</style>')
    logo = base64.b64encode((FRONTEND / 'assets/nx-cube-logo.png').read_bytes()).decode('ascii')
    markup = markup.replace('/assets/nx-cube-logo.png', 'data:image/png;base64,' + logo)
    root = {
        'id': 'root', 'name': 'fasteners.prt', 'type': 'part', 'children': [
            {'id': 'c1', 'name': 'Fastener A', 'type': 'component', 'children': [
                {'id': 'b1', 'name': 'Bolt body', 'type': 'body', 'meshId': 'b1', 'children': []}]},
            {'id': 'c2', 'name': 'Fastener B', 'type': 'component', 'children': [
                {'id': 'b2', 'name': 'Bolt body', 'type': 'body', 'meshId': 'b2', 'children': []}]},
        ],
    }
    payload = {
        'ok': True, 'name': 'fasteners.prt', 'modelUrl': '/api/models/combined.stl',
        'geometryMode': 'separate', 'tree': root,
        'file': {'path': 'C:/models/fasteners.prt', 'size': 16384, 'modified': '2026-11-19 08:00'},
        'nx': {'units': 'mm', 'attributes': [{'name': 'Material', 'value': 'Steel'}]},
        'meshes': [{'id': 'b1', 'url': '/api/models/b1.stl'},
                   {'id': 'b2', 'url': '/api/models/b2.stl'}],
    }
    mock = '''
const mockGl = new Proxy({}, {
  get: (_, key) => {
    if (key === 'createShader' || key === 'createProgram' || key === 'createBuffer') return () => ({});
    if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
    if (key === 'getAttribLocation' || key === 'getUniformLocation') return () => 0;
    if (String(key) === String(key).toUpperCase()) return 1;
    return () => undefined;
  }
});
HTMLCanvasElement.prototype.getContext = () => mockGl;
window.__nxOpenMode = 'model';
const nxPayload = %s;
const stlBytes = Uint8Array.from(atob('%s'), x => x.charCodeAt(0));
window.fetch = async (url) => {
  if (url === '/api/health') return {ok:true,json:async()=>({status:'ok',nxAvailable:true})};
  if (url === '/api/open') {
    await new Promise(r => setTimeout(r, 300));
    if (window.__nxOpenMode === 'cancel') return {ok:true,json:async()=>({cancelled:true})};
    return {ok:true,json:async()=>nxPayload};
  }
  if (url.startsWith('/api/models/')) return {ok:true,arrayBuffer:async()=>stlBytes.slice().buffer};
  throw new Error('Unknown URL ' + url);
};
''' % (json.dumps(payload), base64.b64encode(small_stl()).decode('ascii'))
    code = mock + script_code()
    markup = markup.replace('<script type="module" src="/js/app.js"></script>', '')
    markup = markup.replace('</body>', '<script>' + code + '</script></body>')
    return markup


with sync_playwright() as p:
    options = {'headless': True, 'args': ['--enable-webgl', '--enable-unsafe-swiftshader',
                                         '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox']}
    if os.environ.get('NX_BROWSER_EXECUTABLE'):
        options['executable_path'] = os.environ['NX_BROWSER_EXECUTABLE']
    browser = p.chromium.launch(**options)
    page = browser.new_page(viewport={'width': 1380, 'height': 800}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(html_source(), wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true', timeout=15000)
    toolbar = page.get_by_role('toolbar', name='Viewer controls')
    assert toolbar.count() == 1
    assert toolbar.get_by_role('button', name='OPEN NX FILES').count() == 1
    assert toolbar.locator('[data-view]').count() == 0
    assert page.locator('.viewport-view-tools [data-view]').count() == 4
    for view in ('Isometric view', 'Front view', 'Top view', 'Right view'):
        assert page.get_by_role('button', name=view, exact=True).count() == 1
    assert page.locator('.viewport-view-tools #fit-button').count() == 1
    assert page.locator('#grid-button,#axes-button,#wire-button').count() == 0
    assert page.locator('header').count() == 1
    assert page.locator('header').bounding_box()['height'] == 70
    assert page.locator('.app-brand').count() == 1
    assert page.locator('.brand-title').inner_text() == 'NX 3D Viewer'
    assert page.locator('.brand-subtitle').inner_text() == '3D Visualization Workspace'
    assert page.locator('.brand-logo').evaluate('(el) => el.complete && el.naturalWidth >= 256')
    assert page.locator('.header-meta, #connection-label').count() == 0
    assert page.locator('.app-brand').bounding_box()['width'] > 275
    assert page.locator('main .toolbar').count() == 0
    assert page.locator('.workspace').bounding_box()['y'] == 70
    if os.environ.get('NX_PREVIEW_PATH'):
        page.screenshot(path=os.environ['NX_PREVIEW_PATH'])
    assert page.locator('#tree-summary').inner_text() == 'No NX file loaded'
    assert page.locator('#inspector-content').inner_text().startswith('Open an NX file')
    assert page.locator('.scene-panel').count() == 0
    assert page.locator('#viewer-error').is_hidden()
    assert page.locator('.viewport-view-tools').is_visible()
    page.wait_for_function("document.querySelector('#axis-label-x').hidden === false")
    assert page.locator('#axis-label-y').is_visible()
    assert page.locator('#axis-label-z').is_visible()
    assert 'linear-gradient' in page.locator('#viewer-viewport').evaluate('(el) => getComputedStyle(el).backgroundImage')
    assert page.locator('#empty-state').is_visible()
    assert page.locator('#loading-overlay').is_hidden()
    assert page.get_by_role('button', name='OPEN NX FILES').count() == 1
    page.locator('#tree-toggle').click()
    assert 'is-collapsed' in page.locator('#tree-panel').get_attribute('class')
    page.locator('#tree-toggle').click()
    assert 'is-collapsed' not in page.locator('#tree-panel').get_attribute('class')
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#viewer-workspace').getAttribute('aria-busy') === 'true'")
    assert page.locator('#loading-overlay').is_visible()
    page.wait_for_function("document.querySelector('#tree-summary').textContent.includes('2 components')", timeout=20000)
    assert page.locator('#tree-summary').inner_text() == '2 components · 2 bodies'
    assert page.locator('#loading-overlay').is_hidden()
    assert page.locator('#empty-state').is_hidden()
    assert page.locator('.tree-row[data-kind="component"]').count() == 2
    assert page.locator('.tree-row[data-kind="body"]').count() == 2
    assert 'Geometry Information' in page.locator('#inspector-content').inner_text()
    assert 'Material' in page.locator('#inspector-content').inner_text()
    assert 'mm' in page.locator('#inspector-content').inner_text()
    if os.environ.get('SAVE_PREVIEW'):
        page.screenshot(path=os.environ['SAVE_PREVIEW'], full_page=True)
    page.get_by_role('button', name='Toggle Fastener A').click()
    assert page.get_by_role('button', name='Bolt body').first.is_visible()
    page.get_by_role('button', name='Fastener A', exact=True).click()
    assert 'Selected: Fastener A' in page.locator('#status-message').inner_text()
    assert 'Selected Item' in page.locator('#inspector-content').inner_text()
    assert 'Fastener A' in page.locator('#inspector-content').inner_text()
    checkbox = page.get_by_role('checkbox', name='Show Fastener A')
    assert checkbox.is_checked()
    checkbox.uncheck()
    assert not page.get_by_role('checkbox', name='Show Bolt body').first.is_checked()
    checkbox.check()
    assert page.get_by_role('checkbox', name='Show Bolt body').first.is_checked()
    page.locator('#tree-resizer').focus()
    old_width = page.locator('#tree-panel').evaluate('(el) => el.getBoundingClientRect().width')
    page.keyboard.press('ArrowRight')
    assert page.locator('#tree-panel').evaluate('(el) => el.getBoundingClientRect().width') > old_width
    page.evaluate("window.__nxOpenMode = 'cancel'")
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#viewer-workspace').getAttribute('aria-busy') === 'true'")
    assert page.locator('#tree-summary').inner_text() == 'No NX file loaded'
    assert page.locator('#inspector-content').inner_text().startswith('Open an NX file')
    assert page.locator('.tree-row').count() == 0
    page.wait_for_function("document.querySelector('#loading-overlay').hidden === true")
    assert page.locator('#empty-state').is_visible()
    page.get_by_role('button', name='Top view', exact=True).click()
    assert page.get_by_role('button', name='Top view', exact=True).get_attribute('aria-pressed') == 'true'
    page.get_by_role('button', name='Fit model to view').click()
    page.keyboard.press('1')
    assert page.get_by_role('button', name='Isometric view', exact=True).get_attribute('aria-pressed') == 'true'
    page.locator('#inspector-toggle').click()
    assert 'is-collapsed' in page.locator('#inspector-panel').get_attribute('class')
    page.locator('#inspector-toggle').click()
    assert 'is-collapsed' not in page.locator('#inspector-panel').get_attribute('class')
    page.set_viewport_size({'width': 420, 'height': 750})
    assert page.locator('header.toolbar').bounding_box()['height'] == 62
    assert page.locator('#open-nx-button').is_visible()
    assert page.get_by_role('button', name='Isometric view', exact=True).is_visible()
    assert page.locator('.workspace').bounding_box()['y'] == 62
    assert page.locator('.brand-title').is_visible()
    assert page.locator('.brand-subtitle').is_visible()
    assert not errors, f'Browser JavaScript errors: {errors}' 
    browser.close()
print('Browser smoke checks passed: branding, toolbar, hierarchy, visibility, resize, and loading.')
