"""MS32 browser regression: resizable control and structure regions with live assembly actions."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os

root=Path(__file__).resolve().parents[1]
smoke=(root/'dev/browser_smoke.py').read_text(encoding='utf-8')
namespace={'__file__':str(root/'dev/browser_smoke.py')}
exec(compile(smoke.split('with sync_playwright() as p:')[0], 'browser_smoke_helpers', 'exec'),namespace)
html=namespace['html_source']()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
      args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'])
    page=browser.new_page(viewport={'width':1420,'height':850})
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(html, wait_until='load')
    page.wait_for_function('window.__nxViewerReady===true')
    control=page.locator('#sidebar-controls')
    structure=page.locator('#sidebar-structure')
    split=page.locator('#sidebar-splitter')
    assert page.locator('.tree-heading-copy, .tree-eyebrow, .tree-heading h2').count()==0, 'no titles'
    assert page.locator('#tree-selection-actions').evaluate('(el) => el.parentElement.id')=='sidebar-controls'
    assert page.locator('#tree-move-actions').evaluate('(el) => el.parentElement.id')=='sidebar-controls'
    assert page.locator('#model-tree').evaluate('(el) => el.parentElement.id')=='sidebar-structure'
    assert split.is_visible() and control.is_visible() and structure.is_visible()
    get=lambda: page.evaluate('''() => ({controls:document.querySelector('#sidebar-controls').getBoundingClientRect(),
      structure:document.querySelector('#sidebar-structure').getBoundingClientRect(),
      side:document.querySelector('#tree-panel').getBoundingClientRect()})''')
    initial=get()
    assert initial['structure']['y'] > initial['controls']['y']+initial['controls']['height']
    assert initial['structure']['height']>150,initial
    split.focus()
    page.keyboard.press('ArrowDown')
    updated=get()
    assert updated['controls']['height']>=initial['controls']['height']+15, (updated,initial)
    assert updated['structure']['height']<initial['structure']['height']
    page.keyboard.press('ArrowUp')
    assert abs(get()['controls']['height']-initial['controls']['height'])<2
    # Real mouse drag moves only the interior splitter, preserving outer sidebar width.
    b=split.bounding_box(); start=(b['x']+b['width']/2,b['y']+b['height']/2)
    page.mouse.move(*start); page.mouse.down(); page.mouse.move(start[0], start[1]+70,steps=6); page.mouse.up()
    after=get()
    assert after['controls']['height']>initial['controls']['height']+60,(after,initial)
    assert abs(after['side']['width']-initial['side']['width'])<1
    # Controls remain usable after split, structure is individually scrollable.
    page.locator('#open-nx-button').click()
    page.wait_for_function("document.querySelector('#tree-summary').textContent.includes('2 components')")
    page.locator('.tree-label').filter(has_text='Fastener A').click()
    assert page.locator('#isolate-selected').is_enabled()
    page.locator('#isolate-selected').click()
    assert page.locator('#isolate-selected-label').inner_text()=='Restore'
    page.locator('#isolate-selected').click()
    assert page.locator('#isolate-selected-label').inner_text()=='Isolate'
    page.locator('#fit-selected').click()
    assert page.locator('#tree-resizer').is_visible()
    # Structure should be the only element showing a tree scrollbar on a narrow height.
    page.set_viewport_size({'width':1120,'height':485})
    split.focus();page.keyboard.press('End')
    assert get()['structure']['height']>=91,get()
    assert get()['controls']['height']>=54,get()
    # The structure tree still fits and scrolls within its own region.
    assert structure.evaluate('(el) => getComputedStyle(el).overflow')=='hidden'
    assert page.locator('#model-tree').evaluate('(el) => getComputedStyle(el).overflowY')=='auto'
    split.dblclick()
    assert get()['structure']['height']>90
    # Existing horizontal resize remains functional after vertical dragging.
    page.locator('#tree-resizer').focus()
    width=get()['side']['width'];page.keyboard.press('ArrowRight')
    assert get()['side']['width']>=width+19
    page.locator('#tree-toggle').click()
    assert page.locator('#sidebar-splitter').is_hidden()
    page.locator('#tree-toggle').click()
    assert page.locator('#sidebar-splitter').is_visible()
    assert get()['structure']['height']>90
    assert not errors,errors
    # Save a convenient source-accurate UI preview for internal visual review.
    if os.environ.get('SAVE_PREVIEW'):
        page.set_viewport_size({'width':1420,'height':850})
        page.screenshot(path=os.environ['SAVE_PREVIEW'])
    browser.close()
print('MS32 browser: split height drag/keyboard/reset, independent scrolling, Isolate/Fit, horizontal resizing and collapse passed')
