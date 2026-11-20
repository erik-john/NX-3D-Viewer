"""Exercise the actual light-theme JT upload and deletion step dialogs without NX."""
from pathlib import Path
import os
import tempfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'frontend/index.html').read_text(encoding='utf-8')
CSS = (ROOT / 'frontend/css/style.css').read_text(encoding='utf-8')
JS = (ROOT / 'frontend/js/workspace.js').read_text(encoding='utf-8')
HTML = HTML.replace('<link rel="stylesheet" href="/css/style.css">', f'<style>{CSS}</style>')
HTML = HTML.replace('<script type="module" src="/js/app.js"></script>', '')
MOCK = r'''
window.__files=[]; window.__uploads={}; window.__deletes=[];
window.fetch=async (url,opts={})=>{
 const path=String(url); let status=200, result={ok:true};
 if(path==='/api/workspace'){
   result={ok:true,files:window.__files,fileCount:window.__files.filter(f=>f.type==='file').length,totalBytes:100};
 }else if(path==='/api/workspace/folder'){
   const name=JSON.parse(opts.body).path;
   if(window.__files.some(x=>x.path===name)){status=409;result={ok:false,error:'Folder already exists'};}
   else {window.__files.push({path:name,name:name.split('/').at(-1),type:'folder'});result={ok:true,path:name};status=201;}
 }else if(path.startsWith('/api/workspace/upload?')){
   const name=decodeURIComponent(path.split('?path=')[1].split('&')[0]);
   window.__uploads[name] = await opts.body.arrayBuffer();
   window.__files.push({path:name,name:name.split('/').at(-1),type:'file',canOpen:name.endsWith('.jt'),size:opts.body.size});
   result={ok:true,path:name};status=201;
 }else if(path.startsWith('/api/workspace/delete-plan?')){
   const name=decodeURIComponent(path.split('?path=')[1]);
   const item=window.__files.find(x=>x.path===name);
   const other=item.type==='folder' ? name+'.jt' : name.endsWith('.jt') ? name.slice(0,-3) : '';
   const linked=window.__files.find(x=>x.path.toLowerCase()===other.toLowerCase());
   result={ok:true,path:name,package:!!linked,
      items:[{path:name,type:item.type}, ...(linked?[{path:linked.path,type:linked.type}]:[])]};
 }else if(path==='/api/workspace/delete-package'){
   const data=JSON.parse(opts.body);
   window.__deletes.push(data);
   window.__files=window.__files.filter(x=>!data.expectedPaths.some(p=>x.path===p||x.path.startsWith(p+'/')));
   result={ok:true,deleted:data.expectedPaths};
 }else{throw Error('Unmocked '+path);}
 return {ok:status<400,status,json:async()=>result};
};
'''

with tempfile.TemporaryDirectory() as d:
    folder=Path(d)/'Bolt_M12x55';folder.mkdir()
    (folder/'Bolt_M12x55_303.jt').write_bytes(b'JT component test bytes')
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
                                           headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1260,'height':850})
        errors=[]
        dialogs=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('dialog',lambda dialog:(dialogs.append(dialog.message),dialog.dismiss()))
        page.set_content(HTML,wait_until='load')
        page.add_script_tag(content=MOCK+'\n'+JS.replace('export class FileWorkspace','class FileWorkspace')+
                            '\nwindow.workspace=new FileWorkspace(()=>{});')
        page.locator('#workspace-button').click()
        page.locator('#workspace-upload').click()
        page.locator('#workspace-file-input').set_input_files({'name':'Bolt_M12x55.jt',
                     'mimeType':'application/octet-stream','buffer':b'JT parent test bytes'})
        page.locator('#workspace-jt-wizard').wait_for(state='visible')
        assert not page.evaluate('Object.keys(window.__uploads).length')
        assert 'Upload JT package' in page.locator('#jt-wizard-title').inner_text()
        page.locator('#jt-wizard-next').click()
        assert page.locator('#jt-wizard-folder-controls').is_visible()
        page.locator('#jt-wizard-folder-input').set_input_files(str(folder))
        page.wait_for_function('window.workspace.wizardState.missing.length===0')
        page.locator('#jt-wizard-next').click()
        assert 'Bolt_M12x55_303.jt' in page.locator('#jt-wizard-items').inner_text()
        page.locator('#jt-wizard-next').click()
        page.wait_for_function('Object.keys(window.__uploads).length===2')
        assert 'Bolt_M12x55/Bolt_M12x55_303.jt' in page.evaluate('Object.keys(window.__uploads)')
        assert not page.locator('#workspace-jt-wizard').is_visible()
        # Delete the folder: parent and folder must be reviewed and deleted together.
        page.locator('.workspace-entry',has_text='Bolt_M12x55').filter(has=page.locator('.workspace-entry-meta',has_text='Folder')).click()
        page.locator('#workspace-delete').click()
        page.locator('#workspace-jt-wizard').wait_for(state='visible')
        page.locator('#jt-wizard-next').click()
        assert 'Bolt_M12x55.jt' in page.locator('#jt-wizard-items').inner_text()
        page.locator('#jt-wizard-next').click()
        page.locator('#jt-wizard-next').click()
        page.wait_for_function('window.__deletes.length===1')
        assert page.evaluate('window.__deletes[0].expectedPaths') == ['Bolt_M12x55','Bolt_M12x55.jt']
        assert not page.evaluate('window.__files.length')
        assert not dialogs,dialogs
        assert not errors,errors
        if os.environ.get('NX_PREVIEW_PATH'):
            page.screenshot(path=os.environ['NX_PREVIEW_PATH'])
        browser.close()
print('Chromium JT upload folder picker, three-step modals, and linked deletion passed.')
