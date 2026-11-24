"""Exercise file-workspace UI with an in-memory local API."""

from pathlib import Path
import base64
import os
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / 'frontend'


def read(relative):
    return (FRONTEND / relative).read_text(encoding='utf-8')


markup = read('index.html')
markup = markup.replace('<link rel="stylesheet" href="/css/style.css">', '<style>' + read('css/style.css') + '</style>')
logo = base64.b64encode((FRONTEND/'assets/nx-cube-logo.png').read_bytes()).decode()
markup = markup.replace('/assets/nx-cube-logo.png', 'data:image/png;base64,'+logo)
markup = markup.replace('<script type="module" src="/js/app.js"></script>', '')

mock = r'''
const mockGl = new Proxy({}, {
  get: (_, key) => {
    if (['createShader','createProgram','createBuffer'].includes(key)) return () => ({});
    if (['getShaderParameter','getProgramParameter'].includes(key)) return () => true;
    if (['getAttribLocation','getUniformLocation'].includes(key)) return () => 0;
    if (String(key) === String(key).toUpperCase()) return 1;
    return () => undefined;
  }
});
HTMLCanvasElement.prototype.getContext = () => mockGl;
window.__files = [];
window.__uploads = {};
window.fetch = async (url, options={}) => {
  const path = String(url);
  let result = {ok:true}; let status = 200;
  if (path === '/api/workspace' && !options.method) {
    result = {ok:true,files:window.__files, fileCount:window.__files.filter(f=>f.type==='file').length,totalBytes:10};
  } else if (path === '/api/workspace/folder') {
    const name = JSON.parse(options.body).path;
    window.__files.push({path:name,name:name.split('/').pop(),type:'folder'});
    result = {ok:true,path:name}; status=201;
  } else if (path.startsWith('/api/workspace/upload?')) {
    const name = decodeURIComponent(path.split('?path=')[1].split('&')[0]);
    window.__uploads[name] = await options.body.arrayBuffer();
    window.__files.push({path:name,name:name.split('/').pop(),type:'file',canOpen:name.endsWith('.prt'),size:options.body.size});
    result={ok:true,path:name};status=201;
  } else if (path.startsWith('/api/workspace/delete-plan?')) {
    const name = decodeURIComponent(path.split('?path=')[1]);
    const item = window.__files.find(entry=>entry.path===name);
    const companion = item.type==='folder' ? name+'.jt' :
       name.toLowerCase().endsWith('.jt') ? name.slice(0,-3) : '';
    const related = window.__files.find(entry=>entry.path.toLowerCase()===companion.toLowerCase());
    result = {ok:true,path:name,package:!!related,
      items:[{path:name,type:item.type},...(related?[{path:related.path,type:related.type}]:[])]};
  } else if (path==='/api/workspace/delete-package' && options.method === 'POST') {
    const reviewed = JSON.parse(options.body);
    window.__files = window.__files.filter(item=>!reviewed.expectedPaths.some(name=>
       item.path===name || item.path.startsWith(name+'/')));
    result = {ok:true,deleted:reviewed.expectedPaths};
  } else if (path === '/api/workspace/open') {
    result={ok:false,error:'Simulated NX unavailable'};status=500;
  } else if (path === '/api/health') {
    result={status:'ok',nxAvailable:true};
  } else { throw Error('Unknown mock endpoint: '+path); }
  return {ok:status < 400,status,json: async()=>result};
};
'''

workspace = re.sub(r'\bexport\s+class\s+FileWorkspace', 'class FileWorkspace', read('js/workspace.js'))
workspace = '(function(){\n' + workspace + '\nwindow.FileWorkspace = FileWorkspace;\n})();'
parts = []
for name in ('geometry.js','stl.js','viewer.js','item_tree.js','inspector.js','component_move.js','app.js'):
    piece = read('js/'+name)
    piece = re.sub(r'^import .*?;\s*$', '', piece, flags=re.MULTILINE)
    piece = re.sub(r'\bexport\s+(?=(?:function|class|const|let)\s)', '', piece)
    parts.append(piece)
markup = markup.replace('</body>', '<script>'+mock+'</script><script>'+workspace+'</script><script>'+ '\n'.join(parts) + '</script></body>')

with sync_playwright() as playwright:
    options = {'headless':True, 'args':['--no-sandbox','--enable-unsafe-swiftshader']}
    if os.environ.get('NX_BROWSER_EXECUTABLE'):
        options['executable_path'] = os.environ['NX_BROWSER_EXECUTABLE']
    browser = playwright.chromium.launch(**options)
    page = browser.new_page(viewport={'width':1380,'height':820})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(markup, wait_until='load')
    page.wait_for_function('window.__nxViewerReady === true', timeout=15000)
    page.locator('#workspace-button').click()
    assert page.locator('#file-workspace').is_visible()
    assert 'No uploaded files' in page.locator('#workspace-file-list').inner_text()
    for folder in ['Parts', 'Zeta', 'Assembly']:
        page.once('dialog', lambda dialog, value=folder: dialog.accept(value))
        page.locator('#workspace-new-folder').click()
        page.wait_for_function('(name) => window.__files.some(f=>f.name===name)', arg=folder)
        page.get_by_role('button',name='▣ uploads/').click()
    # Newly discovered folders begin collapsed, while the uploads root stays visible.
    for folder in ['Parts', 'Zeta', 'Assembly']:
        assert page.get_by_role('button', name=f'Expand {folder}').count() == 1
    # Single Upload command opens one in-app dialog with both native picker choices.
    assert page.locator('#workspace-upload-files').count() == 0
    assert page.locator('#workspace-upload-folder').count() == 0
    page.locator('#workspace-upload').click()
    assert page.locator('#workspace-upload-dialog').is_visible()
    assert page.locator('#workspace-choose-files').is_visible()
    assert page.locator('#workspace-choose-folder').is_visible()
    page.locator('#workspace-file-input').set_input_files([
        {'name':'Bolt10.prt','mimeType':'application/octet-stream','buffer':b'TEN'},
        {'name':'Bolt2.prt','mimeType':'application/octet-stream','buffer':b'TWO'},
    ])
    page.wait_for_function('Object.keys(window.__uploads).length === 2')
    page.wait_for_function('!document.querySelector("#workspace-upload-dialog").open')
    labels = page.locator('.workspace-tree-row .workspace-entry-name').all_inner_texts()
    assert labels[:6] == ['uploads/', 'Assembly', 'Parts', 'Zeta', 'Bolt2.prt', 'Bolt10.prt'], labels
    # Existing folder selection opens the same upload dialog and routes files inside it.
    page.get_by_role('button',name='▣ Parts Folder').click()
    page.locator('#workspace-upload').click()
    assert 'uploads/Parts' in page.locator('#workspace-upload-destination').inner_text()
    page.locator('#workspace-file-input').set_input_files({'name':'fastener.prt','mimeType':'application/octet-stream','buffer':b'CAD TEST'})
    page.wait_for_function('Object.keys(window.__uploads).length === 3')
    assert 'Parts/fastener.prt' in page.evaluate('Object.keys(window.__uploads)')
    # Double-click works like Explorer: a collapsed folder expands, then folds.
    assert page.locator('.workspace-entry-name', has_text='fastener.prt').count() == 0
    page.get_by_role('button', name='▣ Parts Folder').dblclick()
    assert page.locator('.workspace-entry-name', has_text='fastener.prt').count() == 1
    page.get_by_role('button', name='▣ Parts Folder').dblclick()
    assert page.locator('.workspace-entry-name', has_text='fastener.prt').count() == 0
    page.get_by_role('button', name='Expand Parts').click()
    # Folder collapse hides children, and a refresh must preserve that state.
    page.get_by_role('button',name='Collapse Parts').click()
    assert page.locator('.workspace-entry-name',has_text='fastener.prt').count() == 0
    page.locator('#workspace-refresh').click()
    assert page.locator('.workspace-entry-name',has_text='fastener.prt').count() == 0
    page.get_by_role('button',name='Expand Parts').click()
    assert page.locator('.workspace-entry-name',has_text='fastener.prt').count() == 1
    page.get_by_role('button',name='⬡ fastener.prt').click()
    assert page.locator('#workspace-open').is_enabled()
    page.locator('#workspace-open').click()
    page.wait_for_function('document.querySelector("#file-workspace").open === false')
    assert page.locator('#import-message').is_visible()
    page.locator('#workspace-button').click()
    assert page.get_by_role('button', name='Expand Parts').count() == 1
    assert page.locator('.workspace-entry-name', has_text='fastener.prt').count() == 0
    page.get_by_role('button', name='Expand Parts').click()
    page.get_by_role('button',name='⬡ fastener.prt').click()
    page.locator('#workspace-delete').click()
    assert page.locator('#workspace-jt-wizard').is_visible()
    page.locator('#jt-wizard-next').click()
    page.locator('#jt-wizard-next').click()
    page.locator('#jt-wizard-next').click()
    page.wait_for_function('window.__files.length === 5')
    assert 'fastener.prt' not in page.locator('#workspace-file-list').inner_text()
    # Simulate browser folder drop with nested geometry and an empty directory.
    page.locator('#workspace-upload').click()
    page.locator('#workspace-drop-zone').evaluate("(zone) => {\n  const fileEntry = (name, bytes) => ({\n    name, isFile:true, isDirectory:false,\n    file: resolve => resolve(new File([bytes], name, {type:'application/octet-stream'})),\n  });\n  const dirEntry = (name, children) => ({\n    name, isFile:false, isDirectory:true,\n    createReader: () => ({\n      readEntries: (() => { let count=0; return resolve => resolve(count++ ? [] : children); })(),\n    }),\n  });\n  const directory = dirEntry('AssemblyDrop', [\n    fileEntry('Main.prt','NX MAIN'),\n    dirEntry('Components', [fileEntry('Bolt.prt','NX CHILD')]),\n    dirEntry('Empty', []),\n  ]);\n  const event = new Event('drop', { bubbles:true, cancelable:true });\n  Object.defineProperty(event, 'dataTransfer', { value: {\n    items: [{kind:'file', webkitGetAsEntry:()=>directory}], files:[],\n  }});\n  zone.dispatchEvent(event);\n}")
    page.wait_for_function('Object.keys(window.__uploads).length === 5')
    assert 'AssemblyDrop/Main.prt' in page.evaluate('Object.keys(window.__uploads)')
    assert 'AssemblyDrop/Components/Bolt.prt' in page.evaluate('Object.keys(window.__uploads)')
    assert 'AssemblyDrop/Empty' in page.evaluate('window.__files.map(f=>f.path)')
    assert page.locator('.workspace-entry-name',has_text='AssemblyDrop').count() == 1
    assert page.get_by_role('button',name='Expand AssemblyDrop').count() == 1
    assert page.locator('.workspace-entry-name',has_text='Empty').count() == 0
    page.get_by_role('button',name='Expand AssemblyDrop').click()
    assert page.locator('.workspace-entry-name',has_text='Empty').count() == 1
    assert page.get_by_role('button',name='Expand Components').count() == 1
    assert not errors, errors
    if os.environ.get('NX_PREVIEW_PATH'):
        page.screenshot(path=os.environ['NX_PREVIEW_PATH'], full_page=True)
    browser.close()
print('Browser File Workspace: Explorer sorting, collapse, unified upload, nested folder drop, open and delete passed.')
