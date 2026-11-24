"""Browser regression for compact actions, dropdown menus and restored view toolbar."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright
namespace={'__file__':str(Path(__file__).with_name('browser_smoke.py'))}
smoke=Path(__file__).with_name('browser_smoke.py').read_text(encoding='utf-8')
exec(compile(smoke.split('with sync_playwright() as p:')[0], 'browser_smoke_helpers', 'exec'),namespace)
html_source=namespace['html_source']

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
      args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'])
    page=browser.new_page(viewport={'width':1366,'height':850})
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content(html_source(),wait_until='load')
    page.wait_for_function('window.__nxViewerReady===true')
    assert page.locator('.app-brand .brand-logo').is_visible()
    assert page.locator('.brand-title').inner_text() == 'NX 3D Viewer'
    assert page.locator('#header-select,#header-unexplode').count() == 0
    assert page.locator('#viewer-viewport .viewport-view-tools [data-view]').count() == 4
    assert page.locator('.app-header .viewport-view-tools').count() == 0
    assert page.locator('#viewer-viewport #fit-button').count() == 1
    # Orientation, fit and color use matching icons in both navigation surfaces.
    for view, key in (('iso','1'),('front','2'),('top','3'),('right','4')):
        assert page.locator(f'#viewer-menu [data-view="{view}"] svg').count() == 1
        assert page.locator(f'#viewer-menu [data-view="{view}"] .header-menu-shortcut').inner_text() == key
        assert page.locator(f'#viewer-viewport [data-view="{view}"] .viewport-view-shortcut').inner_text() == key
    assert page.locator('#viewer-menu #fit-menu-button svg').count() == 1
    assert page.locator('#viewer-menu #fit-menu-button .header-menu-shortcut').inner_text() == 'F'
    assert page.locator('#viewer-viewport #fit-button .viewport-view-shortcut').inner_text() == 'F'
    assert page.locator('#viewer-menu #component-color-menu-button svg').count() == 1
    assert page.locator('#viewer-viewport #component-color-toggle .viewport-view-shortcut').count() == 0
    assert page.locator('#viewer-viewport #component-color-toggle').count() == 1
    assert page.locator('#measure-planes-toggle').count() == 1
    # Icon and text are both visible in each main header action.
    for item, label in (
        ('open-nx-button', 'OPEN NX FILES'), ('workspace-button', 'WORKSPACE'),
        ('component-menu-toggle', 'Component'), ('header-explode', 'Explode'),
        ('transparency-menu-toggle', 'Transparency'), ('viewer-menu-toggle', 'Viewer'),
        ('measure-planes-toggle', 'Measurement'),
    ):
      control = page.locator('#' + item)
      assert control.locator('svg').count() == (2 if item in ('component-menu-toggle','transparency-menu-toggle','viewer-menu-toggle') else 1), item
      assert control.locator('.header-button-text').inner_text() == label, item
      menu_caret = control.locator('.header-menu-caret')
      assert menu_caret.count() == (1 if item in ('component-menu-toggle', 'transparency-menu-toggle', 'viewer-menu-toggle') else 0), item
    assert page.locator('#header-explode').is_disabled()
    page.locator('#viewer-menu-toggle').click()
    assert page.locator('#viewer-menu').is_visible()
    assert page.locator('#viewer-menu .header-menu-heading').all_inner_texts() == ['Orientation','Fit','Appearance']
    page.locator('#viewer-menu [data-view="front"]').click()
    assert page.locator('#viewer-menu').is_hidden()
    assert page.locator('#viewer-viewport [data-view="front"]').get_attribute('aria-pressed') == 'true'
    page.locator('#viewer-viewport [data-view="iso"]').click()
    assert page.locator('#viewer-menu [data-view="iso"]').get_attribute('aria-pressed') == 'true'
    page.locator('#viewer-menu-toggle').click()
    page.keyboard.press('Escape')
    assert page.locator('#viewer-menu').is_hidden()
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#tree-summary').textContent.includes('2 components')")
    assert page.locator('#header-explode').is_enabled()
    assert page.locator('#header-explode').inner_text() == 'Explode'
    assert page.locator('#header-explode').get_attribute('aria-pressed') == 'false'
    page.locator('#header-explode').click()
    assert page.locator('#header-explode').inner_text() == 'Collapse'
    assert page.locator('#header-explode').get_attribute('aria-pressed') == 'true'
    page.locator('#header-explode').click()
    assert page.locator('#header-explode').inner_text() == 'Explode'
    assert page.locator('#header-explode').get_attribute('aria-pressed') == 'false'
    page.locator('.tree-label').filter(has_text='Fastener A').click()
    assert 'Selected Item' in page.locator('#inspector-content').inner_text()
    page.locator('#component-menu-toggle').click()
    assert page.locator('#component-menu').is_visible()
    assert page.locator('#isolate-selected').is_enabled()
    assert page.locator('#fit-selected').is_enabled()
    assert page.locator('#move-selected').is_enabled()
    page.locator('#isolate-selected').click()
    assert page.locator('#component-menu').is_hidden()
    page.locator('#component-menu-toggle').click()
    assert page.locator('#isolate-selected-label').inner_text() == 'Restore'
    page.locator('#isolate-selected').click()
    page.locator('#component-menu-toggle').click()
    page.locator('#move-selected').click()
    assert page.locator('#move-selected').get_attribute('aria-pressed') == 'true'
    page.locator('#component-menu-toggle').click()
    page.locator('#move-selected').click()
    assert page.locator('#move-selected').get_attribute('aria-pressed') == 'false'
    page.locator('#transparency-menu-toggle').click()
    assert page.locator('#transparency-menu').is_visible()
    page.locator('#component-opacity-slider').fill('35')
    assert page.locator('#component-opacity-value').inner_text() == '35%'
    page.locator('#reset-transparency-all').click()
    assert page.locator('#component-opacity-value').inner_text() == '0%'
    assert page.locator('#transparency-menu').is_hidden()
    page.locator('#viewer-menu-toggle').click()
    assert page.locator('#component-color-menu-button').is_enabled()
    page.locator('#component-color-menu-button').click()
    assert page.locator('#component-color-toggle').get_attribute('aria-pressed') == 'true'
    page.locator('#component-color-toggle').click()
    assert page.locator('#component-color-menu-button').get_attribute('aria-pressed') == 'false'
    page.locator('#measure-planes-toggle').click()
    assert page.locator('#measure-planes-toggle').get_attribute('aria-pressed') == 'true'
    page.locator('#measure-planes-toggle').click()
    assert page.locator('#measure-planes-toggle').get_attribute('aria-pressed') == 'false'
    page.locator('#viewer-menu-toggle').click()
    page.locator('#fit-menu-button').click()
    assert page.locator('#viewer-menu').is_hidden()
    # Header must not horizontally overflow on regular laptop widths with an active selection.
    for width in (1440,1366,1280,1180,1100,1024,900):
      page.set_viewport_size({'width':width,'height':800})
      extent=page.locator('.toolbar-scroll').evaluate('(el) => ({scroll:el.scrollWidth, visible:el.clientWidth})')
      assert extent['scroll']<=extent['visible']+1, (width,extent)
      assert page.locator('#viewer-menu-toggle').is_visible(), width
      assert page.locator('#header-explode').is_visible(), width
      assert page.locator('#measure-planes-toggle').is_visible(), width
      assert page.locator('#viewer-viewport .viewport-view-tools').is_visible(), width
      for trigger in ('component-menu-toggle', 'transparency-menu-toggle', 'viewer-menu-toggle'):
        b = page.locator('#'+trigger).bounding_box()
        c = page.locator('#'+trigger+' .header-menu-caret').bounding_box()
        assert b and c and abs((c['y']+c['height']/2)-(b['y']+b['height']/2)) <= 1.0, (width,trigger,b,c)
        assert c['x']+c['width'] < b['x']+b['width'] and c['x'] > b['x'], (width,trigger,b,c)
      # Switching the label must not resize the control or displace neighboring header actions.
      ids = ('header-explode', 'transparency-menu-toggle', 'viewer-menu-toggle', 'measure-planes-toggle')
      positions_before = {item: page.locator('#' + item).bounding_box() for item in ids}
      page.locator('#header-explode').click()
      assert page.locator('#header-explode').inner_text() == 'Collapse'
      positions_after = {item: page.locator('#' + item).bounding_box() for item in ids}
      for item in ids:
        assert abs(positions_before[item]['x'] - positions_after[item]['x']) < 0.1, (width, item, positions_before, positions_after)
        assert abs(positions_before[item]['width'] - positions_after[item]['width']) < 0.1, (width, item, positions_before, positions_after)
      page.locator('#header-explode').click()
      assert page.locator('#header-explode').inner_text() == 'Explode'
      if width==1366 and os.environ.get('SAVE_PREVIEW'):
        page.screenshot(path=os.environ['SAVE_PREVIEW'])
    assert not errors,errors
    browser.close()
print('Compact header browser: dropdowns, explode toggle, selection, isolate, move, transparency, views, color, measurement and responsive widths passed')
