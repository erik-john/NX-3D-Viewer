"""Run a real browser smoke check against an isolated local HTTP server."""
from pathlib import Path
import os
import subprocess
import tempfile
import sys
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
proc = subprocess.Popen([sys.executable, str(ROOT / 'backend/server.py')],
                        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
try:
    for _ in range(35):
        try:
            with urlopen('http://127.0.0.1:8888/api/health', timeout=1) as resp:
                if resp.status == 200: break
        except OSError:
            time.sleep(.15)
    else:
        raise RuntimeError('Viewer server did not start; is port 8888 in use?')

    with sync_playwright() as p:
        browser_options = {'headless': True, 'args': ['--enable-webgl', '--enable-unsafe-swiftshader']}
        if os.environ.get('NX_BROWSER_EXECUTABLE'):
            browser_options['executable_path'] = os.environ['NX_BROWSER_EXECUTABLE']
        browser = p.chromium.launch(**browser_options)
        page = browser.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        page.goto('http://127.0.0.1:8888/', wait_until='networkidle')
        page.wait_for_function('window.__nxViewerReady === true', timeout=15000)
        assert page.locator('#scene-objects').inner_text() == '9'
        assert page.locator('#scene-title').inner_text() == 'Mechanical Assembly'
        assert page.locator('#viewer-error').is_hidden()
        assert page.locator('#viewer-canvas').evaluate('(c) => c.width > 0 && c.height > 0')
        page.locator('#sample-select').select_option('sphere')
        assert page.locator('#scene-title').inner_text() == 'Sphere'
        page.get_by_role('button', name='TOP').click()
        assert page.get_by_role('button', name='TOP').get_attribute('aria-pressed') == 'true'
        page.locator('#grid-button').click()
        assert page.locator('#grid-button').get_attribute('aria-pressed') == 'false'
        page.locator('#wire-button').click()
        assert page.locator('#scene-render-mode').inner_text() == 'Wireframe'
        with tempfile.TemporaryDirectory() as tmp:
            page.screenshot(path=str(Path(tmp) / 'viewer_screenshot.png'))
        assert not errors, f'Browser JavaScript errors: {errors}'
        browser.close()
    print('Browser smoke checks passed.')
finally:
    proc.terminate()
    try: proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
