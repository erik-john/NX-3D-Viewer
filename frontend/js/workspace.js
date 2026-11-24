const $ = id => document.getElementById(id);
const prettySize = value => value == null ? '' : value < 1024 ? `${value} B` :
  value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
const parentPath = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const joinPath = (parent, name) => parent ? `${parent}/${name}` : name;
const chrDesignPath = relative => {
  const path = relative.replaceAll('\\', '/');
  if (!/\.chr$/i.test(path)) return null;
  let name = path.slice(parentPath(path).length ? parentPath(path).length + 1 : 0, -4);
  if (/_chr$/i.test(name)) name = name.slice(0, -4);
  return name ? joinPath(parentPath(path), `${name}.prt`) : null;
};
const explorerNames = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const compareEntries = (a, b) => a.type !== b.type ? (a.type === 'folder' ? -1 : 1) :
  explorerNames.compare(a.name, b.name) || a.name.localeCompare(b.name);

async function api(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let data;
  try { data = await response.json(); } catch { throw new Error(`Workspace request failed (${response.status}).`); }
  if (!response.ok || !data.ok) {
    const error = new Error(data.error || `Workspace request failed (${response.status}).`);
    error.code = data.code || '';
    throw error;
  }
  return data;
}
const jsonPost = (url, body) => api(url, {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
});

// Chromium-based browsers expose dropped folders through the entry API.
// A directory reader returns entries in batches; continue until it returns an empty batch.
async function readDirectoryEntries(directory) {
  const reader = directory.createReader();
  const entries = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    entries.push(...batch);
  }
  return entries;
}

export class FileWorkspace {
  constructor(onOpen) {
    this.dialog = $('file-workspace');
    this.uploadDialog = $('workspace-upload-dialog');
    this.jtWizard = $('workspace-jt-wizard');
    this.chrWizard = $('workspace-chr-wizard');
    this.chrWizardState = null;
    this.wizardState = null;
    this.files = [];
    this.selected = '';
    this.expandedFolders = new Set();
    this.rootExpanded = true;
    this.busy = false;
    this.uploadBase = '';
    this.onOpen = onOpen;
    this.panel = $('workspace-file-list');
    $('workspace-button').addEventListener('click', () => this.show());
    $('workspace-close').addEventListener('click', () => { if (!this.busy) this.dialog.close(); });
    this.dialog.addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    $('workspace-refresh').addEventListener('click', () => this.refresh());
    $('workspace-upload').addEventListener('click', () => this.showUpload());
    $('workspace-upload-close').addEventListener('click', () => {
      if (!this.busy) this.uploadDialog.close();
    });
    this.uploadDialog.addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    $('workspace-choose-files').addEventListener('click', () => $('workspace-file-input').click());
    $('workspace-choose-folder').addEventListener('click', () => $('workspace-folder-input').click());
    $('workspace-file-input').addEventListener('change', event => this.uploadSelected(event.target.files, false));
    $('workspace-folder-input').addEventListener('change', event => this.uploadSelected(event.target.files, true));
    const dropZone = $('workspace-drop-zone');
    dropZone.addEventListener('dragover', event => {
      event.preventDefault();
      if (!this.busy) dropZone.classList.add('drag-over');
      if (event.dataTransfer) event.dataTransfer.dropEffect = this.busy ? 'none' : 'copy';
    });
    dropZone.addEventListener('dragleave', event => {
      if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', async event => {
      event.preventDefault();
      dropZone.classList.remove('drag-over');
      if (this.busy) return;
      try {
        // Capture DataTransfer entries while still handling the original drop event.
        const transfer = event.dataTransfer;
        const entries = Array.from(transfer?.items || []).filter(item => item.kind === 'file')
          .map(item => typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null);
        const fallback = Array.from(transfer?.files || []);
        await this.uploadDropped(entries, fallback);
      } catch (error) { this.uploadStatus(error.message, true); }
    });
    $('workspace-new-folder').addEventListener('click', () => this.newFolder());
    $('workspace-extract').addEventListener('click', () => this.extract());
    $('workspace-delete').addEventListener('click', () => this.deleteSelected());
    $('workspace-open').addEventListener('click', () => this.openSelected());
    $('jt-wizard-close').addEventListener('click', () => this.finishJtWizard(null));
    $('jt-wizard-cancel').addEventListener('click', () => this.finishJtWizard(null));
    $('jt-wizard-back').addEventListener('click', () => this.changeJtStep(-1));
    $('jt-wizard-next').addEventListener('click', () => this.changeJtStep(1));
    $('jt-wizard-choose-folder').addEventListener('click', () => $('jt-wizard-folder-input').click());
    $('jt-wizard-folder-input').addEventListener('change', event => this.pickJtFolder(event.target));
    $('jt-wizard-standalone').addEventListener('change', event => {
      if (this.wizardState?.type === 'upload') {
        this.wizardState.standalone = event.target.checked;
        this.renderJtWizard();
      }
    });
    this.jtWizard.addEventListener('cancel', event => {
      event.preventDefault(); this.finishJtWizard(null);
    });
    $('chr-wizard-close').addEventListener('click', () => this.finishChrWizard(false));
    $('chr-wizard-cancel').addEventListener('click', () => this.finishChrWizard(false));
    $('chr-wizard-back').addEventListener('click', () => this.changeChrStep(-1));
    $('chr-wizard-next').addEventListener('click', () => this.changeChrStep(1));
    $('chr-wizard-choose-part').addEventListener('click', () => $('chr-wizard-part-input').click());
    $('chr-wizard-part-input').addEventListener('change', event => this.pickChrParts(event.target));
    $('chr-wizard-choose-chr').addEventListener('click', () => $('chr-wizard-chr-input').click());
    $('chr-wizard-chr-input').addEventListener('change', event => this.pickChrCompanions(event.target));
    $('chr-wizard-without-chr').addEventListener('change', event => {
      if (this.chrWizardState) {
        this.chrWizardState.withoutChr = event.target.checked;
        this.renderChrWizard();
      }
    });
    this.chrWizard.addEventListener('cancel', event => {
      event.preventDefault(); this.finishChrWizard(false);
    });
    this.panel.addEventListener('keydown', event => {
      if (event.key === 'Enter' && this.selected && this.item()?.canOpen) this.openSelected();
    });
    this.syncButtons();
  }

  // A JT parent can refer to compressed external data. Same-stem folders are
  // a naming convention, not a verified binary dependency. A standalone JT is
  // allowed only after an explicit declaration in the wizard.
  missingJtFolders(files, base) {
    const incoming = files.map(({relative}) => joinPath(base, relative.replaceAll('\\', '/')));
    const available = [...incoming, ...this.files.filter(item => item.type === 'file').map(item => item.path)];
    return incoming.filter(path => /\.jt$/i.test(path) && !/_\d+\.jt$/i.test(path)).map(path => {
      const folder = path.slice(0, -3);
      const hasCompanion = available.some(candidate => candidate !== path &&
        candidate.toLowerCase().startsWith(`${folder.toLowerCase()}/`) && /\.jt$/i.test(candidate));
      return hasCompanion ? null : {path, folder};
    }).filter(Boolean);
  }

  async reviewJtUpload(files, folders, base) {
    const missing = this.missingJtFolders(files, base);
    if (!missing.length) return {files, folders};
    const wizard = {type:'upload', step:0, files:[...files], folders:[...folders],
      base, missing, standalone:false, problem:''};
    const approved = await this.startJtWizard(wizard);
    return approved ? {files:wizard.files, folders:wizard.folders,
      standalone:wizard.standalone} : null;
  }

  startJtWizard(state) {
    if (this.wizardState) return Promise.resolve(null);
    this.wizardState = state;
    this.renderJtWizard();
    this.jtWizard.showModal();
    return new Promise(resolve => { state.resolve = resolve; });
  }

  finishJtWizard(result) {
    const state = this.wizardState;
    if (!state) return;
    this.wizardState = null;
    if (this.jtWizard.open) this.jtWizard.close();
    state.resolve?.(result);
  }

  pickJtFolder(input) {
    const state = this.wizardState;
    if (!state || state.type !== 'upload') return;
    const picked = Array.from(input.files || []).map(file => ({
      file, relative: file.webkitRelativePath || file.name,
    }));
    input.value = '';
    if (!picked.length) return;
    const roots = new Set(picked.map(item => item.relative.replaceAll('\\', '/').split('/')[0].toLowerCase()));
    const expectedRoots = new Set(state.missing.map(item => item.folder.split('/').at(-1).toLowerCase()));
    if (roots.size !== 1 || !expectedRoots.has([...roots][0]) ||
        !picked.some(item => /\.jt$/i.test(item.relative))) {
      state.problem = 'Choose the matching companion folder containing its JT component files.';
      this.renderJtWizard(); return;
    }
    const root = [...roots][0];
    const already = new Set(state.files.map(item => item.relative.toLowerCase()));
    for (const entry of picked) {
      if (!already.has(entry.relative.toLowerCase())) {
        state.files.push(entry); already.add(entry.relative.toLowerCase());
      }
    }
    state.folders.push(picked[0].relative.replaceAll('\\', '/').split('/')[0]);
    state.missing = this.missingJtFolders(state.files, state.base);
    state.problem = '';
    if (!state.missing.length) state.standalone = false;
    this.renderJtWizard();
  }

  changeJtStep(delta) {
    const state = this.wizardState;
    if (!state) return;
    if (delta < 0) {state.step = Math.max(0, state.step - 1); this.renderJtWizard(); return;}
    if (state.type === 'upload' && state.step === 1 &&
        state.missing.length && !state.standalone) {
      state.problem = 'Choose the companion folder, or explicitly confirm the JT is standalone.';
      this.renderJtWizard(); return;
    }
    if (state.step === 2) {
      this.finishJtWizard(true); return;
    }
    state.problem = '';
    state.step += 1;
    this.renderJtWizard();
  }

  renderJtWizard() {
    const state = this.wizardState;
    if (!state) return;
    const upload = state.type === 'upload';
    const step = state.step;
    $('jt-wizard-title').textContent = upload ? 'Upload JT package' : state.plan.package ? 'Delete JT package' : 'Delete selected item';
    $('jt-step-two-title').textContent = upload ? 'Companion folder' : 'Related files';
    for (const el of this.jtWizard.querySelectorAll('[data-wizard-step]')) {
      const i = Number(el.dataset.wizardStep);
      el.classList.toggle('is-current', i === step);
      el.classList.toggle('is-complete', i < step);
      if (i === step) el.setAttribute('aria-current','step');
      else el.removeAttribute('aria-current');
    }
    const heading = $('jt-wizard-heading');
    const description = $('jt-wizard-description');
    const items = $('jt-wizard-items');
    items.replaceChildren();
    const addItem = (name, type, note = '') => {
      const row = document.createElement('div'); row.className='jt-wizard-item';
      const icon=document.createElement('span'); icon.textContent = type === 'folder' ? '▣' : '⬡';
      const title=document.createElement('strong'); title.textContent = name;
      row.append(icon,title);
      if (note) {const small=document.createElement('em'); small.textContent=note; row.append(small);}
      items.append(row);
    };
    const folderControls = $('jt-wizard-folder-controls');
    folderControls.hidden = !(upload && step === 1 && state.missing.length);
    $('jt-wizard-standalone').checked = !!state.standalone;
    $('jt-wizard-back').disabled = step === 0;
    const next = $('jt-wizard-next');
    next.textContent = step < 2 ? 'Next ›' : upload ? 'Upload package' : 'Delete package';
    next.classList.toggle('workspace-danger', !upload && step === 2);
    next.classList.toggle('workspace-primary', upload || step < 2);
    if (upload) {
      if (step === 0) {
        heading.textContent = 'Review JT upload';
        description.textContent = 'Some JT files may reference geometry in a same-named folder. Review the files before uploading.';
        for (const item of state.files) addItem(item.relative, 'file');
      } else if (step === 1) {
        heading.textContent = state.missing.length ? 'Add the related JT folder' : 'Companion folder ready';
        description.textContent = state.missing.length ?
          'Choose the matching folder from your computer. The parent JT will not be uploaded as a package until its component files are included.' :
          'The related JT component files are included in this upload.';
        if (state.missing.length) for (const missing of state.missing) addItem(missing.folder + '/', 'folder', 'Required or mark standalone');
        else for (const item of state.files.filter(f => f.relative.includes('/'))) addItem(item.relative, 'file', 'Included');
      } else {
        heading.textContent = 'Confirm JT upload';
        description.textContent = state.standalone ?
          'You declared the remaining JT files standalone. Any missing external references may still prevent them from opening.' :
          'The parent and companion files will be uploaded together. Components are uploaded before parent JT files.';
        for (const item of state.files) addItem(item.relative, 'file');
      }
    } else {
      const list = state.plan.items;
      if (step === 0) {
        heading.textContent = 'Review selected item';
        description.textContent = 'Review the Workspace item and check whether it has related JT files.';
        addItem(state.plan.path, list[0].type);
      } else if (step === 1) {
        heading.textContent = state.plan.package ? 'Delete related files together' : 'Review deletion';
        description.textContent = state.plan.package ?
          'These items form one JT package by filename convention. Both will be removed to avoid an orphaned reference.' :
          'Only the selected Workspace item will be removed.';
        for (const item of list) addItem(item.path, item.type);
      } else {
        heading.textContent = 'Confirm permanent deletion';
        description.textContent = 'This action cannot be undone. All items below will be deleted together.';
        for (const item of list) addItem(item.path, item.type);
      }
    }
    $('jt-wizard-notice').textContent = state.problem || (
      upload && state.missing.length && step === 1 ?
      'JT reference detection is not exact. Use “standalone” only for files with no external components.' : '');
  }

  missingChrParts(files, base) {
    const available = new Set([
      ...this.files.filter(item => item.type === 'file').map(item => item.path.toLowerCase()),
      ...files.map(item => joinPath(base, item.relative.replaceAll('\\', '/')).toLowerCase()),
    ]);
    return files.filter(item => /\.chr$/i.test(item.relative)).map(item => {
      const relative = item.relative.replaceAll('\\', '/');
      const chr = joinPath(base, relative);
      const part = chrDesignPath(chr);
      return !part || !available.has(part.toLowerCase()) ? {chr, part, relative} : null;
    }).filter(Boolean);
  }

  missingChrCompanions(files, base) {
    const allChr = [
      ...this.files.filter(item => item.type === 'file' && /\.chr$/i.test(item.path))
        .map(item => item.path),
      ...files.filter(item => /\.chr$/i.test(item.relative))
        .map(item => joinPath(base, item.relative.replaceAll('\\', '/'))),
    ];
    const withChr = new Set(allChr.map(chrDesignPath).filter(Boolean).map(path => path.toLowerCase()));
    return files.filter(item => /\.prt$/i.test(item.relative)).map(item => {
      const part = joinPath(base, item.relative.replaceAll('\\', '/'));
      return withChr.has(part.toLowerCase()) ? null :
        {part, expected: part.replace(/\.prt$/i, '_chr.chr')};
    }).filter(Boolean);
  }

  async reviewChrUpload(files, folders, base) {
    if (!files.some(item => /\.(chr|prt)$/i.test(item.relative))) return {files, folders};
    const missingParts = this.missingChrParts(files,base);
    const missingChrs = this.missingChrCompanions(files,base);
    if (!missingParts.length && !missingChrs.length && !files.some(item => /\.chr$/i.test(item.relative)))
      return {files, folders};
    const state = {files:[...files], folders:[...folders], base, step:0, problem:'',
      missingParts, missingChrs, withoutChr:false};
    if (this.chrWizardState) return null;
    this.chrWizardState = state;
    const result = new Promise(resolve => {state.resolve = resolve;});
    this.renderChrWizard();
    this.chrWizard.showModal();
    return await result ? {files:state.files, folders:state.folders} : null;
  }

  finishChrWizard(approved) {
    const state = this.chrWizardState;
    if (!state) return;
    this.chrWizardState = null;
    if (this.chrWizard.open) this.chrWizard.close();
    state.resolve?.(approved);
  }

  refreshChrPairing(state) {
    state.missingParts = this.missingChrParts(state.files, state.base);
    state.missingChrs = this.missingChrCompanions(state.files, state.base);
  }

  pickChrParts(input) {
    const state = this.chrWizardState;
    if (!state) return;
    const picked = Array.from(input.files || []);
    input.value = '';
    if (!picked.length) return;
    const pending = state.missingParts;
    const incoming = [];
    for (const file of picked) {
      // Resolve the destination from the matching CHR, not the local file path.
      const matching = pending.filter(item => item.part &&
        item.part.split('/').at(-1).toLowerCase() === file.name.toLowerCase());
      if (matching.length !== 1) {
        state.problem = `No unique matching CHR upload for ${file.name}. Choose the PRT named in the review.`;
        this.renderChrWizard(); return;
      }
      const target = matching[0].part;
      if (incoming.some(item => item.target.toLowerCase() === target.toLowerCase())) {
        state.problem = `The PRT file ${file.name} was selected more than once.`;
        this.renderChrWizard(); return;
      }
      incoming.push({file, target});
    }
    const already = new Set(state.files.map(item => joinPath(state.base,
      item.relative.replaceAll('\\', '/')).toLowerCase()));
    for (const item of incoming) if (!already.has(item.target.toLowerCase())) {
      state.files.push({file:item.file, relative:item.target.slice(state.base ? state.base.length + 1 : 0)});
      already.add(item.target.toLowerCase());
    }
    this.refreshChrPairing(state);
    state.problem = '';
    this.renderChrWizard();
  }

  pickChrCompanions(input) {
    const state = this.chrWizardState;
    if (!state) return;
    const picked = Array.from(input.files || []);
    input.value = '';
    if (!picked.length) return;
    const incoming = [];
    for (const file of picked) {
      // A browser file picker exposes only the selected file, not its directory.
      // Place it beside the one unambiguously matching PRT in the upload batch.
      const matching = state.missingChrs.filter(item => {
        const target = joinPath(parentPath(item.part), file.name);
        return chrDesignPath(target)?.toLowerCase() === item.part.toLowerCase();
      });
      if (matching.length !== 1) {
        state.problem = `No unique matching PRT for ${file.name}. Choose the CHR file named in the review.`;
        this.renderChrWizard(); return;
      }
      const target = joinPath(parentPath(matching[0].part), file.name);
      if (incoming.some(item => chrDesignPath(item.target)?.toLowerCase() === matching[0].part.toLowerCase())) {
        state.problem = `More than one CHR was selected for ${matching[0].part}.`;
        this.renderChrWizard(); return;
      }
      incoming.push({file, target});
    }
    const already = new Set(state.files.map(item => joinPath(state.base,
      item.relative.replaceAll('\\', '/')).toLowerCase()));
    for (const item of incoming) if (!already.has(item.target.toLowerCase())) {
      state.files.push({file:item.file, relative:item.target.slice(state.base ? state.base.length + 1 : 0)});
      already.add(item.target.toLowerCase());
    }
    this.refreshChrPairing(state);
    state.problem = '';
    this.renderChrWizard();
  }

  changeChrStep(delta) {
    const state = this.chrWizardState;
    if (!state) return;
    if (delta < 0) {state.step = Math.max(0,state.step-1);this.renderChrWizard();return;}
    if (state.step === 1 && state.missingParts.length) {
      state.problem = 'Choose the matching PRT file(s) before uploading Characteristics.';
      this.renderChrWizard(); return;
    }
    if (state.step === 1 && state.missingChrs.length && !state.withoutChr) {
      state.problem = 'Choose the matching CHR file(s), or confirm that the PRT will be uploaded without Characteristics.';
      this.renderChrWizard(); return;
    }
    if (state.step === 2) {this.finishChrWizard(true);return;}
    state.problem = '';
    state.step += 1;
    this.renderChrWizard();
  }

  renderChrWizard() {
    const state = this.chrWizardState;
    if (!state) return;
    const step = state.step;
    for (const el of this.chrWizard.querySelectorAll('[data-chr-step]')) {
      const i = Number(el.dataset.chrStep);
      el.classList.toggle('is-current',i === step);
      el.classList.toggle('is-complete',i < step);
      if (i === step) el.setAttribute('aria-current','step');
      else el.removeAttribute('aria-current');
    }
    const heading = $('chr-wizard-heading');
    const description = $('chr-wizard-description');
    const items = $('chr-wizard-items');
    items.replaceChildren();
    const add = (name,note) => {
      const row = document.createElement('div'); row.className = 'jt-wizard-item';
      const icon = document.createElement('span'); icon.textContent = '⬡';
      const title = document.createElement('strong'); title.textContent = name;
      const details = document.createElement('em'); details.textContent = note;
      row.append(icon,title,details);items.append(row);
    };
    $('chr-wizard-back').disabled = step === 0;
    $('chr-wizard-next').textContent = step === 2 ? 'Upload files' : 'Next ›';
    $('chr-wizard-part-controls').hidden = step !== 1 || !state.missingParts.length;
    $('chr-wizard-chr-controls').hidden = step !== 1 || !state.missingChrs.length;
    $('chr-wizard-without-chr-controls').hidden = step !== 1 || !state.missingChrs.length;
    $('chr-wizard-without-chr').checked = state.withoutChr;
    if (step === 0) {
      heading.textContent = 'Review related NX files';
      description.textContent = 'PRT files may have matching CHR Characteristics files. Both files can be selected together, or a missing companion can be chosen in the next step.';
      for (const file of state.files.filter(item => /\.(chr|prt)$/i.test(item.relative))) {
        const target = joinPath(state.base,file.relative.replaceAll('\\','/'));
        const match = /\.chr$/i.test(target) ? `Matching PRT: ${chrDesignPath(target) || 'unknown'}` :
          `Expected CHR: ${target.replace(/\.prt$/i, '_chr.chr')}`;
        add(target,match);
      }
    } else if (step === 1) {
      heading.textContent = state.missingParts.length || state.missingChrs.length ?
        'Choose companion files' : 'Related NX files ready';
      description.textContent = 'CHR files require their matching PRT. PRT files can be uploaded without CHR after explicit confirmation.';
      if (state.missingParts.length) for (const item of state.missingParts)
        add(item.part || item.chr, 'Matching PRT required');
      if (state.missingChrs.length) for (const item of state.missingChrs)
        add(item.expected, state.withoutChr ? 'PRT-only upload confirmed' : 'Optional matching CHR');
      if (!state.missingParts.length && !state.missingChrs.length)
        for (const file of state.files.filter(item => /\.chr$/i.test(item.relative)))
          add(joinPath(state.base,file.relative.replaceAll('\\', '/')), 'Matching PRT available');
    } else {
      heading.textContent = 'Confirm NX file upload';
      description.textContent = 'PRT files will be uploaded before their CHR companions. Matching Characteristics are kept in the same Workspace folder.';
      for (const file of state.files) add(joinPath(state.base,file.relative.replaceAll('\\','/')),
        /\.chr$/i.test(file.relative) ? 'Characteristics' : 'Included');
      if (state.missingChrs.length) for (const item of state.missingChrs)
        add(item.expected, 'Not uploaded — PRT-only confirmed');
    }
    $('chr-wizard-notice').textContent = state.problem;
  }

  item() { return this.files.find(item => item.path === this.selected); }
  destination() { const item = this.item(); return item?.type === 'folder' ? item.path : parentPath(this.selected); }
  status(message, isError = false) {
    const target = $('workspace-message');
    target.textContent = message;
    target.classList.toggle('error', isError);
  }
  uploadStatus(message, isError = false) {
    const target = $('workspace-upload-progress');
    target.textContent = message;
    target.classList.toggle('error', isError);
  }
  syncButtons() {
    const item = this.item();
    for (const id of ['workspace-upload', 'workspace-file-input', 'workspace-folder-input',
      'workspace-new-folder', 'workspace-refresh', 'workspace-close', 'workspace-choose-files',
      'workspace-choose-folder', 'workspace-upload-close']) {
      $(id).disabled = this.busy;
    }
    $('workspace-delete').disabled = this.busy || !item;
    $('workspace-open').disabled = this.busy || !item?.canOpen;
    $('workspace-extract').disabled = this.busy || !item || !item.path.toLowerCase().endsWith('.zip') || item.type !== 'file';
    $('workspace-selected').textContent = this.selected ? `Selected: uploads/${this.selected}` : 'Selected: uploads/';
  }
  setBusy(active) { this.busy = active; this.syncButtons(); }
  async show() {
    if (!this.dialog.open) this.dialog.showModal();
    await this.refresh();
  }
  showUpload() {
    if (this.busy) return;
    this.uploadBase = this.destination();
    $('workspace-upload-destination').textContent = `Destination: uploads/${this.uploadBase}`;
    this.uploadStatus('');
    if (!this.uploadDialog.open) this.uploadDialog.showModal();
  }
  async refresh() {
    try {
      const data = await api('/api/workspace');
      this.files = data.files;
      const folders = new Set(this.files.filter(item => item.type === 'folder').map(item => item.path));
      // New folders begin expanded; an existing collapsed state survives refreshes.
      for (const folder of folders) {
        if (!this.knownFolders?.has(folder)) this.expandedFolders.add(folder);
      }
      this.knownFolders = folders;
      for (const folder of this.expandedFolders) {
        if (!folders.has(folder)) this.expandedFolders.delete(folder);
      }
      if (this.selected && !this.item()) this.selected = '';
      this.render();
      $('workspace-usage').textContent = `${data.fileCount} files · ${prettySize(data.totalBytes)} used`;
      this.status('');
    } catch (error) { this.status(error.message, true); }
  }
  selectPath(path) {
    this.selected = path;
    for (const wrapper of this.panel.querySelectorAll('.workspace-tree-row')) {
      wrapper.classList.toggle('selected', wrapper.dataset.path === path);
    }
    this.syncButtons();
  }
  toggleFolder(path) {
    if (path === '') this.rootExpanded = !this.rootExpanded;
    else if (this.expandedFolders.has(path)) this.expandedFolders.delete(path);
    else this.expandedFolders.add(path);
    const expanded = path === '' ? this.rootExpanded : this.expandedFolders.has(path);
    if (!expanded && this.selected.startsWith(path ? `${path}/` : '/') && this.selected !== path) this.selected = path;
    if (!expanded && path === '') this.selected = '';
    this.render();
  }
  render() {
    this.panel.replaceChildren();
    const children = new Map();
    for (const item of this.files) {
      const parent = parentPath(item.path);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(item);
    }
    for (const siblings of children.values()) siblings.sort(compareEntries);
    const appendRow = (entry, depth) => {
      const isRoot = !entry;
      const path = isRoot ? '' : entry.path;
      const folder = isRoot || entry.type === 'folder';
      const expanded = isRoot ? this.rootExpanded : this.expandedFolders.has(path);
      const wrapper = document.createElement('div');
      wrapper.className = 'workspace-tree-row';
      wrapper.dataset.path = path;
      wrapper.style.paddingLeft = `${6 + Math.min(depth, 14) * 20}px`;
      wrapper.classList.toggle('selected', this.selected === path);
      if (folder) {
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.className = 'workspace-disclosure';
        toggle.textContent = expanded ? '▾' : '▸';
        toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${isRoot ? 'uploads' : entry.name}`);
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.addEventListener('click', () => this.toggleFolder(path));
        wrapper.append(toggle);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'workspace-disclosure'; spacer.setAttribute('aria-hidden', 'true');
        wrapper.append(spacer);
      }
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'workspace-entry';
      if (isRoot) row.classList.add('root-entry');
      if (folder) row.setAttribute('aria-expanded', String(expanded));
      const icon = document.createElement('span'); icon.className = 'workspace-entry-icon';
      icon.textContent = isRoot ? '▣' : folder ? '▣' : entry.canOpen ? '⬡' : '▤';
      const name = document.createElement('span'); name.className = 'workspace-entry-name';
      name.textContent = isRoot ? 'uploads/' : entry.name;
      row.append(icon, name);
      if (!isRoot) {
        const meta = document.createElement('span'); meta.className = 'workspace-entry-meta';
        meta.textContent = folder ? 'Folder' : prettySize(entry.size);
        row.append(meta);
      }
      row.title = isRoot ? 'uploads/' : path;
      row.addEventListener('click', () => this.selectPath(path));
      row.addEventListener('dblclick', () => {
        if (folder) this.toggleFolder(path);
        else if (entry.canOpen) this.openSelected();
      });
      if (folder) row.addEventListener('keydown', event => {
        if (event.key === 'ArrowRight' && !expanded || event.key === 'ArrowLeft' && expanded) {
          event.preventDefault(); this.toggleFolder(path);
        }
      });
      wrapper.append(row);
      this.panel.append(wrapper);
    };
    appendRow(null, 0);
    const appendChildren = (parent, depth) => {
      for (const child of children.get(parent) || []) {
        appendRow(child, depth);
        if (child.type === 'folder' && this.expandedFolders.has(child.path)) appendChildren(child.path, depth + 1);
      }
    };
    if (this.rootExpanded) appendChildren('', 1);
    if (this.rootExpanded && !this.files.length) {
      const empty = document.createElement('p'); empty.className = 'workspace-list-empty';
      empty.textContent = 'No uploaded files yet. Add a folder, CAD files or a ZIP archive.';
      this.panel.append(empty);
    }
    this.syncButtons();
  }

  async newFolder() {
    const base = this.destination();
    const name = window.prompt('Folder name inside uploads/:');
    if (name == null) return;
    try {
      const result = await jsonPost('/api/workspace/folder', {path: joinPath(base, name.trim())});
      await this.refresh(); this.selected = result.path; this.render();
      this.status(`Folder created: ${result.path}`);
    } catch (error) { this.status(error.message, true); }
  }

  async uploadSelected(fileList, isFolder) {
    const input = isFolder ? $('workspace-folder-input') : $('workspace-file-input');
    const files = Array.from(fileList || []).map(file => ({
      file, relative: isFolder ? file.webkitRelativePath || file.name : file.name,
    }));
    try { await this.uploadItems(files, []); }
    finally { input.value = ''; }
  }
  async uploadDropped(entries, fallback) {
    let items;
    if (!entries.length || entries.some(entry => !entry)) {
      items = { files: fallback.map(file => ({ file, relative: file.webkitRelativePath || file.name })), folders: [] };
    } else {
      // Walk captured browser file-system entries and preserve their directory names.
      const files = [], folders = [];
      const descend = async (entry, prefix, depth) => {
        if (depth > 24) throw new Error('Folder nesting is too deep.');
        const relative = joinPath(prefix, entry.name);
        if (entry.isDirectory) {
          folders.push(relative);
          const nested = await readDirectoryEntries(entry);
          for (const child of nested) await descend(child, relative, depth + 1);
        } else if (entry.isFile) {
          const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
          files.push({ file, relative });
          if (files.length > 3000) throw new Error('Too many files for one upload.');
        }
      };
      for (const entry of entries) await descend(entry, '', 1);
      items = { files, folders };
    }
    await this.uploadItems(items.files, items.folders);
  }
  async uploadItems(files, folders) {
    if (this.busy || (!files.length && !folders.length)) return;
    const base = this.uploadBase;
    const reviewed = await this.reviewJtUpload(files, folders, base);
    if (!reviewed) return;
    files = reviewed.files;
    folders = reviewed.folders;
    const chrReviewed = await this.reviewChrUpload(files, folders, base);
    if (!chrReviewed) return;
    files = chrReviewed.files;
    folders = chrReviewed.folders;
    // Upload referenced components before parent JT files: an incomplete
    // companion upload must not leave a newly uploaded parent in Workspace.
    const parents = new Set(files.filter(item => /\.jt$/i.test(item.relative) &&
      !/_\d+\.jt$/i.test(item.relative)).map(item => item.relative.toLowerCase()));
    const uploadRank = item => parents.has(item.relative.toLowerCase()) ? 3 :
      /\.prt$/i.test(item.relative) ? 0 : /\.chr$/i.test(item.relative) ? 2 : 1;
    files = [...files].sort((a,b) => uploadRank(a) - uploadRank(b));
    const incoming = new Set(files.map(item => joinPath(base,item.relative.replaceAll('\\','/')).toLowerCase()));
    const failedPaths = new Set();
    this.setBusy(true);
    let success = 0, foldersCreated = 0;
    const failures = [];
    const knownFolders = new Set(['', ...this.files.filter(f => f.type === 'folder').map(f => f.path)]);
    try {
      const needed = new Set();
      for (const folder of folders) needed.add(joinPath(base, folder.replaceAll('\\', '/')));
      for (const entry of files) {
        const target = joinPath(base, entry.relative.replaceAll('\\', '/'));
        let ancestor = parentPath(target);
        while (ancestor && !knownFolders.has(ancestor)) {
          needed.add(ancestor); ancestor = parentPath(ancestor);
        }
      }
      for (const folder of [...needed].sort((a, b) =>
        a.split('/').length - b.split('/').length || explorerNames.compare(a, b))) {
        if (knownFolders.has(folder)) continue;
        this.uploadStatus(`Creating folder: ${folder}`);
        try { await jsonPost('/api/workspace/folder', {path: folder}); foldersCreated += 1; }
        catch (error) { if (!/already exists/i.test(error.message)) throw error; }
        knownFolders.add(folder);
      }
      for (let i = 0; i < files.length; i += 1) {
        const { file, relative } = files[i];
        const target = joinPath(base, relative.replaceAll('\\', '/'));
        this.uploadStatus(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
        if (parents.has(relative.toLowerCase()) && failures.length) {
          failures.push(`${relative}: skipped because a companion file failed to upload.`);
          failedPaths.add(target.toLowerCase());
          continue;
        }
        const chrParent = chrDesignPath(target)?.toLowerCase();
        if (chrParent && incoming.has(chrParent) && failedPaths.has(chrParent)) {
          failures.push(`${relative}: skipped because the related PRT failed to upload.`);
          failedPaths.add(target.toLowerCase());
          continue;
        }
        try {
          try {
            await api(`/api/workspace/upload?path=${encodeURIComponent(target)}`, {
              method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: file,
            });
          } catch (error) {
            if (!/File already exists/i.test(error.message) ||
                !window.confirm(`Replace existing uploads/${target}?`)) throw error;
            await api(`/api/workspace/upload?path=${encodeURIComponent(target)}&replace=1`, {
              method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: file,
            });
          }
          success += 1;
        } catch (error) { failures.push(`${relative}: ${error.message}`); failedPaths.add(target.toLowerCase()); }
      }
    } catch (error) { failures.push(error.message); }
    finally {
      this.setBusy(false);
      await this.refresh();
    }
    const summary = failures.length ? `${success} uploaded, ${failures.length} failed. ${failures.slice(0, 2).join(' | ')}` :
      `${success} file${success === 1 ? '' : 's'} uploaded${foldersCreated ? `, ${foldersCreated} folder(s) created` : ''} to uploads/${base}`;
    this.status(summary, failures.length > 0);
    this.uploadStatus(summary, failures.length > 0);
    if (!failures.length && this.uploadDialog.open) this.uploadDialog.close();
  }

  async extract() {
    if (!this.item() || this.item().type !== 'file') return;
    const path = this.selected;
    this.setBusy(true);
    try {
      const result = await jsonPost('/api/workspace/extract', {path});
      await this.refresh(); this.selected = result.path; this.render();
      this.status(`ZIP extracted to uploads/${result.path} (${result.files} files).`);
    } catch (error) { this.status(error.message, true); }
    finally { this.setBusy(false); }
  }

  async deleteSelected() {
    const item = this.item();
    if (!item || this.busy) return;
    let plan;
    try {
      plan = await api(`/api/workspace/delete-plan?path=${encodeURIComponent(item.path)}`);
    } catch (error) {this.status(error.message, true); return;}
    const accepted = await this.startJtWizard({type:'delete', step:0, plan, problem:''});
    if (!accepted) return;
    this.setBusy(true);
    try {
      const result = await jsonPost('/api/workspace/delete-package', {
        path:plan.path, expectedPaths:plan.items.map(entry => entry.path),
      });
      this.selected = '';
      await this.refresh();
      this.status(`Deleted ${result.deleted.join(' and ')}.`);
    } catch (error) {this.status(error.message, true);}
    finally {this.setBusy(false);}
  }

  async openSelected() {
    const item = this.item();
    if (!item?.canOpen || this.busy) return;
    this.dialog.close();
    await this.onOpen(item.path);
  }
}
