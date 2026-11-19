import { Viewer } from './viewer.js';
import { parseSTL } from './stl.js';

const $ = id => document.getElementById(id);

async function updateConnectionStatus() {
  const label = $('connection-label');
  const dot = $('connection-dot');
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('Server unavailable');
    const data = await response.json();
    if (data.status !== 'ok') throw new Error('Unexpected response');
    label.textContent = data.nxAvailable ? 'NX available' : 'Connected · NX not found';
    dot.className = 'connection-dot online';
  } catch {
    label.textContent = 'Disconnected';
    dot.className = 'connection-dot offline';
  }
}

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

  function updateScene(title, description, meshes, source) {
    viewer.setScene(meshes);
    $('scene-title').textContent = title;
    $('scene-description').textContent = description;
    $('scene-objects').textContent = String(meshes.length);
    $('scene-triangles').textContent = meshes.reduce((n, item) => n + item.indices.length / 3, 0).toLocaleString();
    $('scene-source').textContent = source;
    setCameraView('iso');
  }

  function clearScene() {
    viewer.setScene([]);
    $('scene-title').textContent = 'No model loaded';
    $('scene-description').textContent = 'Open an NX file to visualize its geometry.';
    $('scene-objects').textContent = '0';
    $('scene-triangles').textContent = '0';
    $('scene-source').textContent = 'No NX file selected';
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
      showLoading('Retrieving 3D geometry', `Downloading the converted geometry for ${info.name}…`);
      $('status-message').textContent = `Loading geometry from ${info.name}…`;
      const data = await fetch(info.modelUrl, { cache: 'no-store' });
      if (!data.ok) throw new Error('NX geometry download failed.');
      showLoading('Loading 3D model', `Building the viewer geometry for ${info.name}…`);
      const meshes = parseSTL(await data.arrayBuffer());
      updateScene(info.name, 'NX part geometry displayed as tessellated surfaces.', meshes,
        'NX geometry · STL visualization');
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
      updateConnectionStatus();
    }
  }

  function toggle(id, prop) {
    viewer[prop] = !viewer[prop];
    const button = $(id);
    button.classList.toggle('active', viewer[prop]);
    button.setAttribute('aria-pressed', String(viewer[prop]));
    if (prop === 'wireframe') $('scene-render-mode').textContent = viewer[prop] ? 'Wireframe' : 'Solid';
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
updateConnectionStatus();
