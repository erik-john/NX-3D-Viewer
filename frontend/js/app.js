import { createSample } from './geometry.js';
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
  const sampleSelect = $('sample-select');
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

  function loadSample(key) {
    if (!key) return;
    const sample = createSample(key);
    updateScene(sample.title, sample.description, sample.meshes, 'Sample geometry · No CAD file loaded');
    $('import-message').hidden = true;
    $('status-message').textContent = `${sample.title} ready · Drag to rotate · Scroll to zoom`;
  }

  async function openNXPart() {
    const button = $('open-nx-button');
    if (button.disabled) return;
    button.disabled = true;
    $('import-message').hidden = true;
    $('import-progress').hidden = false;
    $('status-message').textContent = 'Choose an NX part file on this computer…';
    try {
      const result = await fetch('/api/open', { method: 'POST', cache: 'no-store' });
      const info = await result.json();
      if (info.cancelled) {
        $('status-message').textContent = 'NX file selection cancelled';
        return;
      }
      if (!result.ok || !info.ok) throw new Error(info.error || 'NX could not open this file.');
      $('status-message').textContent = `Loading geometry from ${info.name}…`;
      const data = await fetch(info.modelUrl, { cache: 'no-store' });
      if (!data.ok) throw new Error('NX geometry download failed.');
      const meshes = parseSTL(await data.arrayBuffer());
      updateScene(info.name, 'NX part geometry displayed as tessellated surfaces.', meshes,
        'NX geometry · STL visualization');
      sampleSelect.value = '';
      $('status-message').textContent = `${info.name} loaded · Drag to rotate · Scroll to zoom`;
    } catch (error) {
      $('import-message').textContent = error.message;
      $('import-message').hidden = false;
      $('status-message').textContent = 'Unable to open NX part';
    } finally {
      $('import-progress').hidden = true;
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

  sampleSelect.addEventListener('change', () => loadSample(sampleSelect.value));
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
  loadSample(sampleSelect.value);
  window.__nxViewerReady = true;
}

setup();
updateConnectionStatus();
