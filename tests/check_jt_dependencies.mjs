import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';

const source = readFileSync(resolve(import.meta.dirname, '../frontend/js/workspace.js'), 'utf8');
const html = readFileSync(resolve(import.meta.dirname, '../frontend/index.html'), 'utf8');
const css = readFileSync(resolve(import.meta.dirname, '../frontend/css/style.css'), 'utf8');
for (const id of ['workspace-jt-wizard','jt-wizard-next','jt-wizard-back',
   'jt-wizard-folder-input','jt-wizard-standalone']) assert.ok(html.includes(`id="${id}"`));
assert.match(css, /\.workspace-jt-wizard\s*\{/);
const requests = [];
const json = async (url, options={}) => {
 requests.push({url,options});
 if (url.startsWith('/api/workspace/delete-plan')) return {
   ok:true, status:200, json:async()=>({ok:true,path:'Bolt_M12x55',package:true,
     items:[{path:'Bolt_M12x55',type:'folder'},{path:'Bolt_M12x55.jt',type:'file'}]})};
 if (url === '/api/workspace/delete-package') return {ok:true,status:200,
    json:async()=>({ok:true,deleted:['Bolt_M12x55','Bolt_M12x55.jt']})};
 throw new Error('Unexpected call ' + url);
};
const context = {Intl,fetch:json,document:{},window:{confirm(){throw Error('Native confirmation must not appear');}}};
vm.runInNewContext(source.replace('export class FileWorkspace','class FileWorkspace') +
 '\nthis.Workspace = FileWorkspace;',context);
const instance = Object.create(context.Workspace.prototype);
instance.files = [];
instance.selected='Bolt_M12x55';
instance.item=()=>({path:'Bolt_M12x55',type:'folder'});
instance.refresh=async()=>{};
instance.status=(s)=>{instance.message=s;};
instance.setBusy=(value)=>{instance.busy=value;};
instance.startJtWizard=async state=> {instance.preview=state.plan;return true;};
await instance.deleteSelected();
assert.equal(requests.length,2);
assert.equal(requests[0].url,'/api/workspace/delete-plan?path=Bolt_M12x55');
assert.equal(requests[1].url,'/api/workspace/delete-package');
assert.deepEqual(JSON.parse(requests[1].options.body).expectedPaths,['Bolt_M12x55','Bolt_M12x55.jt']);
assert.equal(instance.busy,false);
assert.match(instance.message,/Bolt_M12x55.jt/);
requests.length=0;
instance.selected='Bolt_M12x55';
instance.startJtWizard=async()=>null;
await instance.deleteSelected();
assert.equal(requests.length,1);

const f = (name,relative=name)=>({file:{name},relative});
assert.equal(instance.missingJtFolders([f('Bolt_M12x55.jt')],'').length,1);
assert.equal(instance.missingJtFolders([f('Bolt_M12x55_303.jt')],'').length,0);
assert.equal(instance.missingJtFolders([f('Bolt_M12x55.jt'),f('Bolt_M12x55_303.jt','Bolt_M12x55/Bolt_M12x55_303.jt')],'').length,0);
instance.files=[{path:'Bolt_M12x55/Bolt_M12x55_303.jt',type:'file'}];
assert.equal(instance.missingJtFolders([f('Bolt_M12x55.jt')],'').length,0);
instance.files=[];
let wizardCalls=0;
instance.startJtWizard=async state=>{wizardCalls++;state.files.push(f('Bolt_M12x55_303.jt','Bolt_M12x55/Bolt_M12x55_303.jt'));state.folders.push('Bolt_M12x55');return true;};
const selected=await instance.reviewJtUpload([f('Bolt_M12x55.jt')],[],'');
assert.equal(selected.files.length,2);
assert.equal(wizardCalls,1);
instance.startJtWizard=async()=>null;
const cancelled=await instance.reviewJtUpload([f('Bolt_M12x55.jt')],[],'');
assert.equal(cancelled,null);
console.log('JT package wizard: required folder detection, same-package deletion, no native alerts and cancel verified.');
