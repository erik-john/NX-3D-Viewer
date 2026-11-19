const $ = id => document.getElementById(id);
const prettySize = value => value == null ? '' : value < 1024 ? `${value} B` :
  value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
const parentPath = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const joinPath = (parent, name) => parent ? `${parent}/${name}` : name;
const explorerNames = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const compareEntries = (a, b) => a.type !== b.type ? (a.type === 'folder' ? -1 : 1) :
  explorerNames.compare(a.name, b.name) || a.name.localeCompare(b.name);

async function api(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let data;
  try { data = await response.json(); } catch { throw new Error(`Workspace request failed (${response.status}).`); }
  if (!response.ok || !data.ok) throw new Error(data.error || `Workspace request failed (${response.status}).`);
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
    this.panel.addEventListener('keydown', event => {
      if (event.key === 'Enter' && this.selected && this.item()?.canOpen) this.openSelected();
    });
    this.syncButtons();
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
        } catch (error) { failures.push(`${relative}: ${error.message}`); }
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
    if (!item || !window.confirm(`Delete ${item.type} "${item.path}"${item.type === 'folder' ? ' and everything inside it' : ''}? This cannot be undone.`)) return;
    this.setBusy(true);
    try {
      await api(`/api/workspace?path=${encodeURIComponent(item.path)}`, {method: 'DELETE'});
      this.selected = ''; await this.refresh(); this.status(`Deleted ${item.path}`);
    } catch (error) { this.status(error.message, true); }
    finally { this.setBusy(false); }
  }

  async openSelected() {
    const item = this.item();
    if (!item?.canOpen || this.busy) return;
    this.dialog.close();
    await this.onOpen(item.path);
  }
}
