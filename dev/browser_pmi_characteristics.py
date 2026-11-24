"""Browser UI check with synthetic NX PMI and characteristic response."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'dev' / 'browser_smoke.py'
namespace = {'__file__': str(source), '__name__': '_annotation_fixture_'}
exec(compile(source.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0], str(source), 'exec'), namespace)
payload = {'pmi': [{'id': 'pmi_1', 'name': 'Linear Dimension', 'text': '55',
                    'type': 'PmiLinearDimension', 'position': [0.5, 0.25, 0],
                    'dimension': {'start': [0, 0, 0], 'end': [1, 0, 0],
                                  'origin': [0.5, 0.25, 0], 'source': 'NX dimension associativity'},
                    'details': {'Size':55.0, 'Tolerance Type':'No Tolerance', 'URL':'', 'Text':'55', 'Type':'PmiLinearDimension'},
                    'dependencies':{'associatedObjects':[{'type':'Face','name':'Face of Base rotate 1'},
                        {'type':'Face','name':'Face of Base rotate 1'}],
                        'modelViews':[{'name':'Trimetric','work':True,'displayed':True}]}}],
           'characteristics': [{'id': 'chr_1', 'name': 'PC1', 'position': [0.5, 0.25, 0],
                                'pmiId': 'pmi_1', 'details': {'Base ID': '1',
                                    'Designator': 'PC1', 'Nominal Precision': '1',
                                    'Inspection': 'No', 'Nominal Value': '55', 'UUID': 'b6892285-1c7d-443',
                                    'Reference': 'No', 'Status': 'Retained',
                                    'Unit': 'Millimeter', 'Extension ID': '',
                                    'Basic': 'No', 'Type': 'Linear Dimension', 'Index': '0'}}],
           'warnings': []}
markup = namespace['html_source']().replace('const nxPayload = {',
                                          'const nxPayload = {"annotations": ' + json.dumps(payload) + ', ', 1)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('NX_BROWSER_EXECUTABLE', '/usr/bin/chromium'),
                                args=['--no-sandbox', '--enable-webgl', '--enable-unsafe-swiftshader',
                                      '--use-gl=angle', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(markup, wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true')
    page.locator('#open-nx-button').click()
    page.wait_for_function('document.querySelector("#inspector-tab-pmi").disabled === false')
    assert page.locator('.tree-row[data-kind="pmi"]').count() == 0
    assert page.locator('.tree-row[data-kind="characteristic"]').count() == 0
    assert page.locator('#inspector-tab-pmi').is_enabled()
    assert page.locator('.annotation-dimension-pmi').get_attribute('visibility') == 'hidden'
    assert page.locator('#inspector-tab-characteristics').is_enabled()
    assert page.locator('.annotation-marker-pmi').count() == 1
    assert page.locator('.annotation-dimension-pmi line').count() == 3
    assert page.locator('.annotation-dimension-pmi polygon').count() == 2
    assert page.locator('.annotation-marker-characteristics').count() == 1
    page.locator('#inspector-tab-characteristics').click()
    assert page.locator('.annotation-dimension-characteristics').get_attribute('visibility') == 'visible'
    assert page.locator('.annotation-marker-characteristics').first.is_visible()
    assert page.locator('.annotation-marker-pmi').first.is_hidden()
    assert page.locator('.annotation-records-section .inspector-annotation-item').count() == 1
    page.locator('.inspector-annotation-item').first.click()
    right = page.locator('#inspector-content').inner_text()
    assert page.locator('#inspector-tab-characteristics').get_attribute('aria-selected') == 'true'
    assert 'Characteristic Instance Details' in right, right
    assert 'PC1' in right and 'Nominal Value' in right and '55' in right, right
    for field in ('Base ID', 'Reference', 'Status', 'Unit', 'UUID', 'Extension ID'):
        assert field in right, right
    assert page.locator('.characteristic-parameter-table tbody tr').count() >= 12
    if os.environ.get('NX_ANNOTATION_PREVIEW'):
        page.screenshot(path=os.environ['NX_ANNOTATION_PREVIEW'])
    page.locator('#inspector-tab-pmi').click()
    assert page.locator('.annotation-dimension-pmi').get_attribute('visibility') == 'visible'
    assert page.locator('.annotation-marker-characteristics').first.is_hidden()
    page.locator('.inspector-annotation-item').first.click()
    right = page.locator('#inspector-content').inner_text()
    assert page.locator('#inspector-tab-pmi').get_attribute('aria-selected') == 'true'
    assert 'Details' in right and '55' in right, right
    assert 'Dependencies' in right and 'Associated Objects' in right and 'Model Views' in right, right
    assert 'Face of Base rotate 1' in right and 'Trimetric (Work, Displayed)' in right, right
    assert 'Size' in right and 'Tolerance Type' in right and 'No Tolerance' in right, right
    assert page.locator('.pmi-dependency-list li').count() == 3, right
    assert page.locator('.characteristic-parameter-table tbody tr').count() >= 5, right
    assert page.locator('.annotation-dimension-pmi.is-selected').count() == 1
    if os.environ.get('NX_PMI_PREVIEW'):
        page.screenshot(path=os.environ['NX_PMI_PREVIEW'])
    page.locator('#inspector-tab-information').click()
    assert page.locator('#inspector-tab-information').get_attribute('aria-selected') == 'true'
    assert page.locator('.annotation-dimension-pmi').get_attribute('visibility') == 'hidden'
    assert page.locator('#show-pmi-toggle').count() == 0
    assert page.locator('#show-characteristics-toggle').count() == 0
    assert not errors, errors
    browser.close()
print('Chromium: left geometry tree only, inspector PMI/Characteristic navigators, 3D highlight and tab visibility passed.')
