"""Verify that a valid CHR enables the tab even when NX returns no records."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'dev' / 'browser_smoke.py'
namespace = {'__file__': str(source), '__name__': '_chr_tab_fixture_'}
exec(compile(source.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0], str(source), 'exec'), namespace)
payload = {
    'pmi': [{'id': 'pmi_1', 'name': 'Linear Dimension', 'text': '55',
             'position': [1, 2, 3], 'details': {'Text': '55'}}],
    'characteristics': [],
    'characteristicsFile': {
        'name': 'Bolt M12x55_chr.chr', 'status': 'unavailable',
        'observedDesignators': [
            {'designator': 'PC1', 'uuid': 'b6892285-1c7d-4436-9175-ea3d367983d0'},
            {'designator': 'PC2', 'uuid': '8e0b3489-c244-4a9e-8f97-6e9c33bf0f1e'}]},
    'warnings': ['NX did not expose its Inspector records through the available read-only accessors.']}
markup = namespace['html_source']().replace('const nxPayload = {',
    'const nxPayload = {"annotations": ' + json.dumps(payload) + ', ', 1)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('NX_BROWSER_EXECUTABLE', '/usr/bin/chromium'),
        args=['--no-sandbox', '--enable-webgl', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1100, 'height': 760})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(markup, wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    page.locator('#open-nx-button').click()
    page.wait_for_function('document.querySelector("#inspector-tab-characteristics").disabled === false')
    assert page.locator('#inspector-tab-characteristics').is_enabled()
    page.locator('#inspector-tab-characteristics').click()
    content = page.locator('#inspector-content').inner_text()
    assert 'Bolt M12x55_chr.chr' in content
    assert 'PC1' in content and 'PC2' in content
    assert 'Identifiers detected in CHR (unverified)' in content
    assert 'Characteristic extraction unavailable' in content
    assert 'Characteristic Instances' not in content
    if os.environ.get('NX_CHR_DIAGNOSTIC_PREVIEW'):
        page.screenshot(path=os.environ['NX_CHR_DIAGNOSTIC_PREVIEW'])
    assert not errors, errors
    browser.close()
print('Chromium: valid companion CHR enables diagnostic tab, with no fabricated parameters.')
