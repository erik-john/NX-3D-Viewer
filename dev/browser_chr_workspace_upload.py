"""Exercise the CHR pairing review and upload sequence without Siemens NX."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'frontend/index.html').read_text(encoding='utf-8')
CSS = (ROOT / 'frontend/css/style.css').read_text(encoding='utf-8')
JS = (ROOT / 'frontend/js/workspace.js').read_text(encoding='utf-8')
HTML = HTML.replace('<link rel="stylesheet" href="/css/style.css">',f'<style>{CSS}</style>')
HTML = HTML.replace('<script type="module" src="/js/app.js"></script>','')
MOCK = r'''
window.__files = [];window.__uploads=[];window.__failPrt = false;
window.fetch=async (url,opts={})=>{
  const path=String(url);let status=200,result={ok:true};
  if (path==='/api/workspace') result={ok:true,files:window.__files,fileCount:window.__files.length,totalBytes:300};
  else if (path==='/api/workspace/folder') {
    const name=JSON.parse(opts.body).path;
    window.__files.push({path:name,name:name.split('/').at(-1),type:'folder'});
    status=201;result={ok:true,path:name};
  } else if (path.startsWith('/api/workspace/upload?')) {
    const name=decodeURIComponent(path.split('?path=')[1].split('&')[0]);
    if (window.__failPrt && /\.prt$/i.test(name)) {
      status=400;result={ok:false,error:'Simulated PRT failure'};
    } else {
      window.__uploads.push(name);
      window.__files.push({path:name,name:name.split('/').at(-1),type:'file',canOpen:/\.(prt|jt)$/i.test(name),size:opts.body.size});
      status=201;result={ok:true,path:name};
    }
  } else throw Error('Unhandled fetch '+path);
  return {ok:status<400,status,json:async()=>result};
};
'''

def boot(page):
    page.set_content(HTML,wait_until='load')
    page.add_script_tag(content=MOCK+'\n'+JS.replace('export class FileWorkspace','class FileWorkspace')+
                        '\nwindow.workspace=new FileWorkspace(()=>{});')
    page.locator('#workspace-button').click()
    page.locator('#workspace-upload').click()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('NX_BROWSER_EXECUTABLE','/usr/bin/chromium'),
                              headless=True,args=['--no-sandbox'])
    def new():
        page=browser.new_page(viewport={'width':1200,'height':850})
        errors=[];dialogs=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('dialog',lambda d:(dialogs.append(d.message),d.dismiss()))
        boot(page)
        return page, errors, dialogs
    sample=b'SPLMSSTR' + b'\0'*128 + b'CHRPARTS'
    # One-step batch file picker: both files are reviewed and PRT is sent before CHR.
    page,errors,dialogs=new()
    page.locator('#workspace-file-input').set_input_files([
        {'name':'Bolt M12x55_chr.chr','mimeType':'application/octet-stream','buffer':sample},
        {'name':'Bolt M12x55.prt','mimeType':'application/octet-stream','buffer':b'CAD'}])
    page.locator('#workspace-chr-wizard').wait_for(state='visible')
    assert not page.evaluate('window.__uploads')
    assert 'Bolt M12x55.prt' in page.locator('#chr-wizard-items').inner_text()
    page.locator('#chr-wizard-next').click()
    assert page.locator('#chr-wizard-part-controls').is_hidden()
    page.locator('#chr-wizard-next').click()
    page.locator('#chr-wizard-next').click()
    page.wait_for_function('window.__uploads.length===2')
    assert page.evaluate('window.__uploads')==['Bolt M12x55.prt','Bolt M12x55_chr.chr']
    assert not page.locator('#workspace-chr-wizard').is_visible()
    assert not errors,errors
    assert not dialogs,dialogs
    page.close()
    # Upload CHR alone: picker for PRT is required; unrelated PRT is rejected.
    page,errors,dialogs=new()
    page.locator('#workspace-file-input').set_input_files({'name':'Bolt M12x55_chr.chr',
           'mimeType':'application/octet-stream','buffer':sample})
    page.locator('#chr-wizard-next').click()
    assert page.locator('#chr-wizard-part-controls').is_visible()
    page.locator('#chr-wizard-next').click()
    assert 'matching PRT' in page.locator('#chr-wizard-notice').inner_text()
    page.locator('#chr-wizard-part-input').set_input_files({'name':'Other.prt',
           'mimeType':'application/octet-stream','buffer':b'Other CAD'})
    assert 'No unique matching' in page.locator('#chr-wizard-notice').inner_text()
    page.locator('#chr-wizard-part-input').set_input_files({'name':'Bolt M12x55.prt',
           'mimeType':'application/octet-stream','buffer':b'CAD'})
    assert page.locator('#chr-wizard-part-controls').is_hidden()
    page.locator('#chr-wizard-next').click();page.locator('#chr-wizard-next').click()
    page.wait_for_function('window.__uploads.length===2')
    assert page.evaluate('window.__uploads')==['Bolt M12x55.prt','Bolt M12x55_chr.chr']
    assert not dialogs and not errors,(errors,dialogs)
    page.close()
    # Existing PRT needs no second upload.
    page,errors,dialogs=new()
    page.evaluate('window.__files.push({path:"Bolt M12x55.prt",name:"Bolt M12x55.prt",type:"file",canOpen:true})')
    page.locator('#workspace-file-input').set_input_files({'name':'Bolt M12x55_chr.chr',
           'mimeType':'application/octet-stream','buffer':sample})
    page.locator('#chr-wizard-next').click();page.locator('#chr-wizard-next').click();page.locator('#chr-wizard-next').click()
    page.wait_for_function('window.__uploads.length===1')
    assert page.evaluate('window.__uploads') == ['Bolt M12x55_chr.chr']
    page.close()
    # If uploading PRT fails, its CHR cannot be orphaned.
    page,errors,dialogs=new()
    page.evaluate('window.__failPrt=true')
    page.locator('#workspace-file-input').set_input_files([
        {'name':'Bolt M12x55_chr.chr','mimeType':'application/octet-stream','buffer':sample},
        {'name':'Bolt M12x55.prt','mimeType':'application/octet-stream','buffer':b'CAD'}])
    page.locator('#chr-wizard-next').click();page.locator('#chr-wizard-next').click();page.locator('#chr-wizard-next').click()
    page.wait_for_function('window.workspace.busy===false')
    assert not page.evaluate('window.__uploads')
    assert 'related PRT failed' in page.locator('#workspace-upload-progress').inner_text()
    assert not errors,errors
    page.close()
    # PRT-only: the wizard offers its missing Characteristics companion.
    page,errors,dialogs=new()
    page.locator('#workspace-file-input').set_input_files({
        'name':'Bolt M12x55.prt','mimeType':'application/octet-stream','buffer':b'CAD'})
    page.locator('#workspace-chr-wizard').wait_for(state='visible')
    assert 'Bolt M12x55_chr.chr' in page.locator('#chr-wizard-items').inner_text()
    assert not page.evaluate('window.__uploads')
    page.locator('#chr-wizard-next').click()
    assert page.locator('#chr-wizard-chr-controls').is_visible()
    page.locator('#chr-wizard-next').click()
    assert 'Choose the matching CHR' in page.locator('#chr-wizard-notice').inner_text()
    page.locator('#chr-wizard-chr-input').set_input_files({
        'name':'Wrong_chr.chr','mimeType':'application/octet-stream','buffer':sample})
    assert 'No unique matching PRT' in page.locator('#chr-wizard-notice').inner_text()
    page.locator('#chr-wizard-chr-input').set_input_files({
        'name':'Bolt M12x55_chr.chr','mimeType':'application/octet-stream','buffer':sample})
    assert page.locator('#chr-wizard-chr-controls').is_hidden()
    page.locator('#chr-wizard-next').click()
    assert 'Bolt M12x55_chr.chr' in page.locator('#chr-wizard-items').inner_text()
    page.locator('#chr-wizard-next').click()
    page.wait_for_function('window.__uploads.length===2')
    assert page.evaluate('window.__uploads') == ['Bolt M12x55.prt','Bolt M12x55_chr.chr']
    assert not errors and not dialogs,(errors,dialogs)
    page.close()
    # Explicit opt-out: a PRT without Characteristics is still allowed.
    page,errors,dialogs=new()
    page.locator('#workspace-file-input').set_input_files({
        'name':'Simple.prt','mimeType':'application/octet-stream','buffer':b'CAD'})
    page.locator('#chr-wizard-next').click()
    page.locator('#chr-wizard-without-chr').check()
    page.locator('#chr-wizard-next').click()
    assert 'PRT-only confirmed' in page.locator('#chr-wizard-items').inner_text()
    page.locator('#chr-wizard-next').click()
    page.wait_for_function('window.__uploads.length===1')
    assert page.evaluate('window.__uploads') == ['Simple.prt']
    assert not errors and not dialogs,(errors,dialogs)
    page.close()
    # If CHR is already uploaded in the same Workspace folder, no wizard is needed for PRT.
    page,errors,dialogs=new()
    page.evaluate('window.__files.push({path:"Bolt M12x55_chr.chr",name:"Bolt M12x55_chr.chr",type:"file"})')
    page.locator('#workspace-file-input').set_input_files({
        'name':'Bolt M12x55.prt','mimeType':'application/octet-stream','buffer':b'CAD'})
    page.wait_for_function('window.__uploads.length===1')
    assert page.evaluate('window.__uploads') == ['Bolt M12x55.prt']
    assert page.locator('#workspace-chr-wizard').is_hidden()
    assert not errors and not dialogs,(errors,dialogs)
    page.close()
    # A selected folder/batch including both companions must not ask for an extra CHR.
    page,errors,dialogs=new()
    page.evaluate('void window.workspace.uploadItems([{file:new File(["CAD"],"Bolt M12x55.prt"),relative:"Parts/Bolt M12x55.prt"},{file:new File(["SPLMSSTRCHRPARTS"],"Bolt M12x55_chr.chr"),relative:"Parts/Bolt M12x55_chr.chr"}], ["Parts"])')
    page.locator('#workspace-chr-wizard').wait_for(state='visible')
    page.locator('#chr-wizard-next').click()
    assert page.locator('#chr-wizard-part-controls').is_hidden()
    assert page.locator('#chr-wizard-chr-controls').is_hidden()
    page.locator('#chr-wizard-next').click();page.locator('#chr-wizard-next').click()
    page.wait_for_function('window.__uploads.length===2')
    assert page.evaluate('window.__uploads') == ['Parts/Bolt M12x55.prt','Parts/Bolt M12x55_chr.chr']
    assert not errors and not dialogs,(errors,dialogs)
    page.close()
    browser.close()
print('CHR multi-file pairing, choose matching PRT, existing PRT, and failure safeguards passed.')
