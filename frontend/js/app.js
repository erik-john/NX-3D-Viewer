import { createSample } from './geometry.js';
import { Viewer } from './viewer.js';

const $ = id => document.getElementById(id);

async function updateConnectionStatus() {
  const label = $('connection-label');
  const dot = $('connection-dot');
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('Server unavailable');
    const data = await response.json();
    if (data.status !== 'ok') throw new Error('Unexpected response');
    label.textContent = 'Connected';
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
  function loadSample(key) {
    const sample = createSample(key);
    viewer.setScene(sample.meshes);
    $('scene-title').textContent = sample.title;
    $('scene-description').textContent = sample.description;
    $('scene-objects').textContent = String(sample.meshes.length);
    $('scene-triangles').textContent = sample.meshes.reduce((n, item) => n + item.indices.length / 3, 0).toLocaleString();
    $('status-message').textContent = `${sample.title} ready · Drag to rotate · Scroll to zoom`;
    setCameraView('iso');
  }
  function setCameraView(view) {
    selectedView = view;
    viewer.setView(view);
    for (const button of document.querySelectorAll('[data-view]')) {
      const active = button.dataset.view === selectedView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
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
