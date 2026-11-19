"""Verify Workspace dialog keeps its geometry when the tree folds."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
source = (HERE / 'check_workspace_browser.py').read_text(encoding='utf8')
context = {'__file__': str(HERE / 'check_workspace_browser.py'), '__name__': '_workspace_fixture'}
exec(source.split('with sync_playwright() as playwright:')[0], context)
markup = context['markup']

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get('NX_BROWSER_EXECUTABLE', '/usr/bin/chromium'),
        headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1380, 'height': 820})
    errors = []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.set_content(markup, wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true', timeout=15000)
    assert page.locator('#workspace-button').inner_text() == 'WORKSPACE'
    page.locator('#workspace-button').click()
    dialog = page.locator('#file-workspace')
    assert page.locator('#workspace-title').inner_text() == 'Workspace'
    assert 'LOCAL CAD FILES' not in dialog.inner_text()
    assert 'Manage source files in the project' not in dialog.inner_text()
    assert page.locator('#workspace-message').inner_text() == ''
    full_box = dialog.bounding_box()
    assert full_box and full_box['height'] > 650, full_box
    for folder in ['Assembly', 'Components']:
        page.once('dialog', lambda prompt, value=folder: prompt.accept(value))
        page.locator('#workspace-new-folder').click()
        page.wait_for_function('(name) => window.__files.some(f=>f.name===name)', arg=folder)
    for selector in ["button[aria-label='Collapse uploads']", "button[aria-label='Expand uploads']",
                     "button[aria-label='Collapse Assembly']", "button[aria-label='Expand Assembly']"]:
        page.locator(selector).click()
        box = dialog.bounding_box()
        assert abs(box['height'] - full_box['height']) <= 1, (selector, full_box, box)
        assert abs(box['y'] - full_box['y']) <= 1, (selector, full_box, box)
    # A constrained viewport should keep the dialog within the window without hiding controls.
    page.set_viewport_size({'width': 690, 'height': 500})
    box = dialog.bounding_box()
    assert box['height'] <= 500 and box['y'] >= 0 and box['y'] + box['height'] <= 501, box
    assert page.locator('#workspace-open').is_visible()
    assert page.locator('#workspace-file-list').is_visible()
    assert not errors, errors
    browser.close()
print('Workspace fixed-height browser layout passed for collapse, expand, and narrow viewport.')
