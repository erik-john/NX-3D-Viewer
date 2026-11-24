"""Ensure absent PMI/Characteristic records produce disabled tabs and useful diagnostics."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'dev' / 'browser_smoke.py'
namespace = {'__file__': str(source), '__name__': '_tab_fixture_'}
exec(compile(source.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0], str(source), 'exec'), namespace)

payload = {'pmi': [{'id':'pmi_1','name':'Linear Dimension','text':'55',
           'position':[1,2,3], 'details':{'Text':'55'}, 'dimension':None}],
           'characteristics': [],
           'warnings': ['NX Inspector characteristic records were not accessible through the available NX Open collections; this does not mean the part has no Characteristics.',
                        'PMI "Linear Dimension" has no readable NX dimension definition points; graphical reference lines are unavailable.']}
import json
markup = namespace['html_source']().replace('const nxPayload = {',
    'const nxPayload = {"annotations": ' + json.dumps(payload) + ', ', 1)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('NX_BROWSER_EXECUTABLE', '/usr/bin/chromium'),
                                args=['--no-sandbox','--enable-webgl','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width':1080,'height':720})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(markup, wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    assert page.locator('#inspector-tab-pmi').is_disabled()
    assert page.locator('#inspector-tab-characteristics').is_disabled()
    page.locator('#open-nx-button').click()
    page.wait_for_function('document.querySelector("#inspector-tab-pmi").disabled === false')
    assert page.locator('#inspector-tab-pmi').is_enabled()
    assert page.locator('#inspector-tab-characteristics').is_disabled()
    assert 'not confirmed' in page.locator('#inspector-tab-characteristics').get_attribute('title')
    assert 'not accessible' in page.locator('#inspector-content').inner_text()
    page.locator('#inspector-tab-pmi').click()
    content = page.locator('#inspector-content').inner_text()
    assert 'Dimension Graphics' in content
    assert 'no readable' not in content or 'reference points' in content
    assert 'cannot draw accurate guide lines' in content
    assert page.locator('.annotation-dimension').count() == 0
    assert page.locator('#show-pmi-toggle, #show-characteristics-toggle').count() == 0
    page.locator('#inspector-toggle').click()
    assert not page.locator('#inspector-tabs').is_visible()
    page.locator('#inspector-toggle').click()
    assert page.locator('#inspector-tabs').is_visible()
    if os.environ.get('NX_INSPECTOR_DISABLED_PREVIEW'):
        page.screenshot(path=os.environ['NX_INSPECTOR_DISABLED_PREVIEW'])
    assert not errors, errors
    browser.close()
print('Chromium: three inspector tabs, enabled/disabled states, and missing-data explanation passed')
