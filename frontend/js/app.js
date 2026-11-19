import { Viewer } from './viewer.js';
import { parseSTL } from './stl.js';
import { ItemTree } from './item_tree.js';

const $ = id => document.getElementById(id);
const MAX_TOTAL_STL_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_TRIANGLES = 1_000_000;

function setup() {
  let viewer;
  try {
    viewer = new Viewer($('viewer-canvas'));
  } catch (error) {
    $('viewer-error').hidden = false;
    $('viewer-error-text').textContent = error.message;
    $('status-message').textContent = 'Unable to start 3D renderer';
    return;
  }
  const tree = new ItemTree({
    panel: $('tree-panel'), toggle: $('tree-toggle'), resizer: $('tree-resizer'),
    container: $('model-tree'), summary: $('tree-summary'), note: $('tree-note'),
    onVisibility: (meshId, visible) => viewer.setMeshVisible(meshId, visible),
    onSelect: node => { $('status-message').textContent = `Selected: ${node.name}`; },
  });
  let selectedView = 'iso';

  function setCameraView(view) {
    selectedView = view;
    viewer.setView(view);
    for (const button of document.querySelectorAll('[data-view]')) {
      const active = button.dataset.view === selectedView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function clearScene() {
    viewer.setScene([]);
    tree.clear();
    setCameraView('iso');
    $('empty-state').hidden = false;
  }

  function showLoading(title, detail) {
    $('loading-title').textContent = title;
    $('loading-detail').textContent = detail;
    $('loading-overlay').hidden = false;
    $('viewer-workspace').setAttribute('aria-busy', 'true');
  }

  function finishLoading() {
    $('loading-overlay').hidden = true;
    $('viewer-workspace').removeAttribute('aria-busy');
  }

  async function readSTL(url) {
    const reply = await fetch(url, { cache: 'no-store' });
    if (!reply.ok) throw new Error('NX geometry download failed.');
    return reply.arrayBuffer();
  }

  async function loadGeometry(info) {
    if (info.geometryMode !== 'separate' || !Array.isArray(info.meshes) || !info.meshes.length) {
      const buffer = await readSTL(info.modelUrl);
      const meshes = parseSTL(buffer).map(mesh => ({ ...mesh, meshId: 'root' }));
      return { meshes, perBody: false };
    }
    const pieces = new Array(info.meshes.length);
    let current = 0, completed = 0, totalBytes = 0, totalTriangles = 0;
    const workers = Math.min(4, info.meshes.length);
    await Promise.all(Array.from({ length: workers }, async () => {
      while (current < info.meshes.length) {
        const at = current++;
        const item = info.meshes[at];
        const buffer = await readSTL(item.url);
        totalBytes += buffer.byteLength;
        if (totalBytes > MAX_TOTAL_STL_BYTES) throw new Error('NX geometry exceeds the 256 MB viewer limit.');
        const meshes = parseSTL(buffer).map(mesh => ({ ...mesh, meshId: item.id }));
        totalTriangles += meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
        if (totalTriangles > MAX_TOTAL_TRIANGLES) throw new Error('NX geometry exceeds the 1,000,000 triangle viewer limit.');
        pieces[at] = meshes;
        completed += 1;
        $('loading-detail').textContent = `Loading NX bodies · ${completed} / ${info.meshes.length}`;
      }
    }));
    return { meshes: pieces.flat(), perBody: true };
  }

  async function openNXPart() {
    const button = $('open-nx-button');
    if (button.disabled) return;
    button.disabled = true;
    $('import-message').hidden = true;
    clearScene();
    $('empty-state').hidden = true;
    showLoading('Opening NX file', 'Select a part file on the server computer; NX will prepare the geometry.');
    $('status-message').textContent = 'Choose an NX part file on this computer…';
    try {
      const result = await fetch('/api/open', { method: 'POST', cache: 'no-store' });
      const info = await result.json();
      if (info.cancelled) {
        $('empty-state').hidden = false;
        $('status-message').textContent = 'NX file selection cancelled · No model loaded';
        return;
      }
      if (!result.ok || !info.ok) throw new Error(info.error || 'NX could not open this file.');
      showLoading('Loading NX geometry', `Preparing the geometry for ${info.name}…`);
      $('status-message').textContent = `Loading geometry from ${info.name}…`;
      const { meshes, perBody } = await loadGeometry(info);
      viewer.setScene(meshes);
      tree.show(info.tree || { id: 'root', name: info.name, type: 'part', children: [] }, {
        visibilityEnabled: perBody, warning: info.warning || '',
      });
      setCameraView('iso');
      $('empty-state').hidden = true;
      $('status-message').textContent = `${info.name} loaded · Drag to rotate · Scroll to zoom`;
    } catch (error) {
      clearScene();
      $('import-message').textContent = error.message;
      $('import-message').hidden = false;
      $('status-message').textContent = 'Unable to open NX part';
    } finally {
      finishLoading();
      button.disabled = false;
    }
  }

  function toggle(id, prop) {
    viewer[prop] = !viewer[prop];
    const button = $(id);
    button.classList.toggle('active', viewer[prop]);
    button.setAttribute('aria-pressed', String(viewer[prop]));
    viewer.requestRender();
  }

  $('open-nx-button').addEventListener('click', openNXPart);
  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => setCameraView(button.dataset.view));
  }
  $('fit-button').addEventListener('click', () => viewer.fit());
  $('grid-button').addEventListener('click', () => toggle('grid-button', 'showGrid'));
  $('axes-button').addEventListener('click', () => toggle('axes-button', 'showAxes'));
  $('wire-button').addEventListener('click', () => toggle('wire-button', 'wireframe'));
  $('viewer-canvas').addEventListener('dblclick', () => viewer.fit());
  window.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey ||
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const views = { '1': 'iso', '2': 'front', '3': 'top', '4': 'right' };
    if (views[event.key]) setCameraView(views[event.key]);
    else if (event.key.toLowerCase() === 'f') viewer.fit();
    else if (event.key.toLowerCase() === 'g') toggle('grid-button', 'showGrid');
    else if (event.key.toLowerCase() === 'w') toggle('wire-button', 'wireframe');
  });
  clearScene();
  $('status-message').textContent = 'Ready · Open an NX file to begin';
  window.__nxViewerReady = true;
}

setup();
