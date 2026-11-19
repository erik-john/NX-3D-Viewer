"""Exercise the actual browser UI with simulated NX responses (no NX installation required)."""
from pathlib import Path
import json
import os
import struct
import subprocess
import sys
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def small_stl():
    return (b'NX example' + b'\0' * (80 - len(b'NX example')) + struct.pack('<I', 1) +
            struct.pack('<12fH', 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0))


proc = subprocess.Popen([sys.executable, str(ROOT / 'backend/server.py')],
                        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
try:
    for _ in range(45):
        try:
            with urlopen('http://127.0.0.1:8888/api/health', timeout=1) as resp:
                if resp.status == 200:
                    break
        except OSError:
            time.sleep(.15)
    else:
        raise RuntimeError('Viewer server did not start; is port 8888 in use?')

    with sync_playwright() as p:
        options = {'headless': True, 'args': ['--enable-webgl', '--enable-unsafe-swiftshader',
                                             '--use-gl=angle', '--use-angle=swiftshader']}
        if os.environ.get('NX_BROWSER_EXECUTABLE'):
            options['executable_path'] = os.environ['NX_BROWSER_EXECUTABLE']
        browser = p.chromium.launch(**options)
        page = browser.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        page.goto('http://127.0.0.1:8888/', wait_until='networkidle')
        page.wait_for_function('window.__nxViewerReady === true', timeout=15000)
        assert page.locator('#scene-objects').inner_text() == '0'
        assert page.locator('#scene-title').inner_text() == 'No model loaded'
        assert page.locator('#empty-state').is_visible()
        assert page.locator('#loading-overlay').is_hidden()
        assert page.locator('#viewer-error').is_hidden()
        assert page.locator('#sample-select').count() == 0
        assert page.get_by_role('button', name='OPEN NX FILES').count() == 1

        # Delay mocked conversion so the visible loading overlay can be verified.
        def nx_open(route):
            time.sleep(.7)
            route.fulfill(status=200, content_type='application/json', body=json.dumps({
                'ok': True, 'name': 'mount.prt', 'modelUrl': '/api/models/mount.stl'}))

        def nx_mesh(route):
            time.sleep(.3)
            route.fulfill(status=200, body=small_stl(), headers={'Content-Type': 'model/stl'})

        page.route('**/api/open', nx_open)
        page.route('**/api/models/mount.stl', nx_mesh)
        page.locator('#open-nx-button').click()
        page.wait_for_function("document.querySelector('#viewer-workspace').getAttribute('aria-busy') === 'true'")
        assert page.locator('#loading-overlay').is_visible()
        assert page.locator('#scene-objects').inner_text() == '0'
        assert page.locator('#open-nx-button').is_disabled()
        assert page.locator('#empty-state').is_hidden()
        page.wait_for_function("document.querySelector('#scene-title').textContent === 'mount.prt'", timeout=20000)
        assert page.locator('#scene-objects').inner_text() == '1'
        assert page.locator('#scene-triangles').inner_text() == '1'
        assert page.locator('#loading-overlay').is_hidden()
        assert page.locator('#open-nx-button').is_enabled()
        assert page.locator('#empty-state').is_hidden()

        # A second open clears the previous model immediately, even before NX responds.
        def cancelled(route):
            time.sleep(.5)
            route.fulfill(status=200, content_type='application/json',
                          body=json.dumps({'ok': False, 'cancelled': True}))

        page.unroute('**/api/open', nx_open)
        page.route('**/api/open', cancelled)
        page.locator('#open-nx-button').click()
        page.wait_for_function("document.querySelector('#viewer-workspace').getAttribute('aria-busy') === 'true'")
        assert page.locator('#scene-title').inner_text() == 'No model loaded'
        assert page.locator('#scene-objects').inner_text() == '0'
        page.wait_for_function("document.querySelector('#loading-overlay').hidden === true", timeout=10000)
        assert page.locator('#empty-state').is_visible()
        assert page.locator('#open-nx-button').is_enabled()

        page.get_by_role('button', name='TOP').click()
        assert page.get_by_role('button', name='TOP').get_attribute('aria-pressed') == 'true'
        page.locator('#grid-button').click()
        assert page.locator('#grid-button').get_attribute('aria-pressed') == 'false'
        page.locator('#wire-button').click()
        assert page.locator('#scene-render-mode').inner_text() == 'Wireframe'
        assert not errors, f'Browser JavaScript errors: {errors}'
        browser.close()
    print('Browser smoke checks passed.')
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
