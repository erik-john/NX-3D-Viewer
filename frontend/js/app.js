import { Viewer } from './viewer.js';
import { parseSTL } from './stl.js';
import { ItemTree } from './item_tree.js';
import { PartInspector } from './inspector.js';
import { FileWorkspace } from './workspace.js';
import { createExplodePlan, calculateExplodeOffsets, selectionGroupIds } from './assembly_explode.js';
import { buildComponentColors } from './component_colors.js';
import { MoveGizmo, MOVE_AXES } from './component_move.js';

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
  let explodeGroups = [];
  let explodeBounds = null;
  let explodeLevel = 0;
  const selectedOverrides = new Map();
  const manualGroupOffsets = new Map();
  let moveMode = false;
  let moveGizmo = null;
  let isolated = null; // { nodeId, previous: Map(meshId -> prior visible) }
  let componentColorEnabled = false;
  let componentColors = { available: false, colors: new Map() };
  const canExplode = () => explodeGroups.length >= 2;

  function updateComponentColorMode() {
    const active = componentColors.available && componentColorEnabled;
    const button = $('component-color-toggle');
    button.disabled = !componentColors.available;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.title = !componentColors.available ? 'Component colors require separate assembly geometry' :
      active ? 'Restore original steel appearance' : 'Color components by type';
    viewer.setComponentColorMode(active);
  }

  function selectedNode() {
    return tree.nodes.get(tree.selectedId) || null;
  }
  function meshIdsFor(node) {
    if (!node) return [];
    // Combined STL fallback only supports whole-model framing, never isolation.
    return !tree.visibilityEnabled ? (node === tree.root ? ['root'] : []) : tree.descendants(node);
  }
  function hasMesh(ids, visibleOnly = false) {
    const wanted = new Set(ids);
    return viewer.geometry.some(part => wanted.has(part.meshId) && (!visibleOnly || part.visible));
  }
  function applyVisibility(map) {
    for (const [id, visible] of map) viewer.setMeshVisible(id, visible);
    tree.setVisibilityFromMeshes(map);
    updateMoveActions();
  }
  function updateSelectionActions() {
    $('tree-selection-actions').hidden = !tree.root;
    const node = selectedNode();
    const ids = meshIdsFor(node);
    const canIsolate = !!(tree.visibilityEnabled && node && node !== tree.root &&
      ['component', 'body'].includes(node.type) && hasMesh(ids));
    // Restore stays available after clearing selection or selecting the assembly.
    const shouldRestore = !!isolated && (!canIsolate || isolated.nodeId === node.id);
    $('isolate-selected').disabled = !canIsolate && !isolated;
    $('isolate-selected').classList.toggle('is-active', shouldRestore);
    $('isolate-selected').setAttribute('aria-pressed', String(shouldRestore));
    $('isolate-selected-label').textContent = shouldRestore ? 'Restore' : 'Isolate';
    $('isolate-selected').title = shouldRestore ? 'Restore previous component visibility' :
      'Show only the selected component';
    $('fit-selected').disabled = !hasMesh(ids, true);
    updateMoveActions();
  }

  // Manual moves are per assembly occurrence, independent of explode offsets.
  // STL vertices, prototype files, and original NX component transforms stay intact.
  function movableGroupIds(node) {
    if (!tree.visibilityEnabled || !node || node.type !== 'component' || !canExplode()) return [];
    return selectionGroupIds(explodeGroups, node, target => tree.descendants(target));
  }
  function moved(offset) {
    return !!offset && offset.some(value => Math.abs(value) > 1e-8);
  }
  function updateMoveActions() {
    const node = selectedNode();
    const groupIds = movableGroupIds(node);
    const visible = !!node && hasMesh(meshIdsFor(node), true);
    const eligible = groupIds.length > 0 && visible;
    if (!eligible) moveMode = false;
    const active = moveMode && eligible;
    $('tree-move-actions').hidden = !canExplode();
    $('move-selected').disabled = !eligible;
    $('move-selected').classList.toggle('is-active', active);
    $('move-selected').setAttribute('aria-pressed', String(active));
    $('move-selected').title = active ? 'Finish moving selected component' :
      'Move selected component with the NX X/Y/Z axis handles';
    $('reset-move-selected').disabled = !groupIds.some(id => moved(manualGroupOffsets.get(id)));
    $('reset-move-all').disabled = ![...manualGroupOffsets.values()].some(moved);
    tree.setMoveState(active ? node.id : null, explodeGroups);
    moveGizmo?.setTarget(node ? meshIdsFor(node) : [], active);
    const offsets = groupIds.map(id => manualGroupOffsets.get(id) || [0,0,0]);
    if (offsets.length === 1) {
      // Viewer basis X,Z,-Y -> original NX basis X,Y,Z.
      const [x, y, z] = offsets[0];
      const format = number => `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
      $('tree-move-readout').textContent = `NX ΔX ${format(x)} · ΔY ${format(-z)} · ΔZ ${format(y)} (model units)`;
    } else {
      $('tree-move-readout').textContent = active ?
        'Drag an X/Y/Z arrow (arrow keys nudge a focused handle).' :
        'Select a component, then choose Move or its row icon.';
    }
  }
  function applyManualMovement() {
    const offsets = new Map();
    for (const group of explodeGroups) {
      const manual = manualGroupOffsets.get(group.id) || [0, 0, 0];
      for (const meshId of group.meshIds) offsets.set(meshId, manual.slice());
    }
    viewer.setManualOffsets(offsets);
    updateMoveActions();
  }
  function beginMoveSnapshot() {
    const node = selectedNode();
    if (!moveMode || !hasMesh(meshIdsFor(node),true)) return null;
    const ids = movableGroupIds(node);
    if (!ids.length) return null;
    return new Map(ids.map(id => [id, (manualGroupOffsets.get(id) || [0,0,0]).slice()]));
  }
  function translateSelected(snapshot, axis, distance) {
    const vector = MOVE_AXES[axis];
    if (!vector || !Number.isFinite(distance)) return;
    for (const [id, starting] of snapshot) {
      const result = starting.map((value,i)=>value + distance*vector[i]);
      if (moved(result)) manualGroupOffsets.set(id,result);
      else manualGroupOffsets.delete(id);
    }
    applyManualMovement();
  }
  function resetSelectedMovement() {
    for (const id of movableGroupIds(selectedNode())) manualGroupOffsets.delete(id);
    applyManualMovement();
    $('status-message').textContent = 'Selected component manual movement reset';
  }
  function resetAllMovement() {
    manualGroupOffsets.clear();
    applyManualMovement();
    $('status-message').textContent = 'All manual movements reset · Explode state preserved';
  }
  function toggleMoveSelected() {
    if (!movableGroupIds(selectedNode()).length) return;
    moveMode = !moveMode;
    updateMoveActions();
    $('status-message').textContent = moveMode ? 'Move mode · Drag X, Y or Z arrows' : 'Move mode off';
  }
  function isolateOrRestore() {
    const node = selectedNode();
    const ids = meshIdsFor(node);
    const validTarget = node && node !== tree.root && tree.visibilityEnabled &&
      ['component', 'body'].includes(node.type) && hasMesh(ids);
    if (!validTarget && !isolated) return;
    if (!validTarget || isolated?.nodeId === node.id) {
      applyVisibility(isolated.previous);
      isolated = null;
      $('status-message').textContent = 'Previous component visibility restored';
    } else {
      // Switching isolated items uses the original pre-isolation visibility snapshot.
      const previous = isolated?.previous || new Map(viewer.geometry.map(part =>
        [part.meshId, part.visible]));
      isolated = { nodeId: node.id, previous };
      const selectedIds = new Set(ids);
      applyVisibility(new Map([...previous.keys()].map(id => [id, selectedIds.has(id)])));
      $('status-message').textContent = `Isolated: ${node.name}`;
    }
    updateSelectionActions();
  }

  function updateExplodeControls() {
    tree.setExplodeState(explodeGroups, explodeLevel, selectedOverrides);
  }
  function applyExplosion() {
    viewer.setExplodeOffsets(calculateExplodeOffsets(explodeGroups, explodeBounds, explodeLevel, selectedOverrides));
    viewer.fit();
    updateExplodeControls();
    updateMoveActions();
  }
  function initializeExplosion(info, meshes, perBody) {
    explodeGroups = perBody ? createExplodePlan(info.tree, meshes) : [];
    explodeBounds = viewer.bounds;
    explodeLevel = 0;
    selectedOverrides.clear();
    manualGroupOffsets.clear();
    moveMode = false;
    viewer.setManualOffsets(new Map());
    updateExplodeControls();
    updateMoveActions();
  }
  const inspector = new PartInspector({
    panel: $('inspector-panel'), toggle: $('inspector-toggle'), content: $('inspector-content'),
  });
  const tree = new ItemTree({
    panel: $('tree-panel'), toggle: $('tree-toggle'), resizer: $('tree-resizer'),
    container: $('model-tree'), summary: $('tree-summary'), note: $('tree-note'),
    onVisibility: (meshId, visible) => {
      viewer.setMeshVisible(meshId, visible);
      // A manual visibility change takes ownership of the current visibility state.
      // Do not later overwrite it with a stale pre-isolation snapshot.
      if (isolated) isolated = null;
      updateSelectionActions();
    },
    onToggleExplode: (node, exploded) => changeNodeExplosion(node, exploded ? 75 : 0),
    onToggleAll: exploded => exploded ? explodeAll() : collapseAll(),
    onToggleMove: (node, active) => {
      tree.selectNode(node);
      moveMode = active;
      updateMoveActions();
      $('status-message').textContent = active ? `Move component: ${node.name}` : 'Move mode off';
    },
    onSelect: node => {
      inspector.select(node);
      viewer.setSelectedMeshIds(node ? tree.descendants(node) : []);
      $('status-message').textContent = node ? `Selected: ${node.name}` : 'Selection cleared';
      updateSelectionActions();
    },
  });
  moveGizmo = new MoveGizmo($('move-gizmo'), viewer, {
    onStart: beginMoveSnapshot,
    onDrag: translateSelected,
    onEnd: () => {
      const node = selectedNode();
      if (node) $('status-message').textContent = `Moved: ${node.name}`;
    },
  });
  viewer.onFrame = () => moveGizmo.update();
  viewer.onHoverMesh = meshId => {
    const node = meshId ? tree.nodeForMesh(meshId) : null;
    viewer.setHoveredMeshIds(node ? tree.descendants(node) : []);
  };
  viewer.onSelectMesh = meshId => {
    if (!meshId) tree.selectNode(null);
    else if (!tree.selectMesh(meshId)) tree.selectNode(null);
  };
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
    isolated = null;
    viewer.setScene([]);
    componentColors = { available: false, colors: new Map() };
    viewer.setComponentColors(componentColors.colors);
    updateComponentColorMode();
    explodeGroups = [];
    explodeBounds = null;
    explodeLevel = 0;
    selectedOverrides.clear();
    manualGroupOffsets.clear();
    moveMode = false;
    tree.clear();
    updateExplodeControls();
    inspector.clear();
    updateSelectionActions();
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

  async function openNXPart(workspacePath = null) {
    const button = $('open-nx-button');
    if (button.disabled) return;
    button.disabled = true;
    $('import-message').hidden = true;
    clearScene();
    $('empty-state').hidden = true;
    showLoading('Opening NX file', workspacePath ? `Preparing uploads/${workspacePath}` : 'Select a part file on the server computer; NX will prepare the geometry.');
    $('status-message').textContent = workspacePath ? `Opening uploads/${workspacePath}…` : 'Choose an NX part file on this computer…';
    try {
      const result = await fetch(workspacePath ? '/api/workspace/open' : '/api/open', {
        method: 'POST', cache: 'no-store',
        ...(workspacePath ? {headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({path: workspacePath})} : {}),
      });
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
      const structure = info.tree || { id: 'root', name: info.name, type: 'part', children: [] };
      componentColors = perBody ? buildComponentColors(structure, meshes) :
        { available: false, colors: new Map() };
      viewer.setComponentColors(componentColors.colors);
      updateComponentColorMode();
      tree.show(structure, {
        visibilityEnabled: perBody, warning: info.warning || '',
      });
      setCameraView('iso');
      initializeExplosion(info, meshes, perBody);
      inspector.show(info, meshes, { perBody, gridSize: viewer.gridSize });
      updateSelectionActions();
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

  function explodeAll() {
    if (!canExplode()) return;
    explodeLevel = explodeLevel > 0 ? explodeLevel : 60;
    selectedOverrides.clear();
    applyExplosion();
  }
  function collapseAll() {
    if (!canExplode()) return;
    explodeLevel = 0;
    selectedOverrides.clear();
    applyExplosion();
  }
  function changeNodeExplosion(node, amount) {
    if (!canExplode()) return;
    const ids = selectionGroupIds(explodeGroups, node, target => tree.descendants(target));
    if (!ids.length) return;
    for (const id of ids) selectedOverrides.set(id, amount);
    applyExplosion();
  }
  $('open-nx-button').addEventListener('click', () => openNXPart());
  new FileWorkspace(path => openNXPart(path));
  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => setCameraView(button.dataset.view));
  }
  $('fit-button').addEventListener('click', () => viewer.fit());
  $('component-color-toggle').addEventListener('click', () => {
    if (!componentColors.available) return;
    componentColorEnabled = !componentColorEnabled;
    updateComponentColorMode();
  });
  $('move-selected').addEventListener('click', toggleMoveSelected);
  $('reset-move-selected').addEventListener('click', resetSelectedMovement);
  $('reset-move-all').addEventListener('click', resetAllMovement);
  $('isolate-selected').addEventListener('click', isolateOrRestore);
  $('fit-selected').addEventListener('click', () => {
    const node = selectedNode();
    if (node && viewer.fitMeshIds(meshIdsFor(node))) {
      $('status-message').textContent = `Fit selected: ${node.name}`;
    }
  });
  $('viewer-canvas').addEventListener('dblclick', () => viewer.fit());
  window.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey ||
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const views = { '1': 'iso', '2': 'front', '3': 'top', '4': 'right' };
    if (views[event.key]) setCameraView(views[event.key]);
    else if (event.key.toLowerCase() === 'f') viewer.fit();
  });
  clearScene();
  $('status-message').textContent = 'Ready · Open an NX file to begin';
  window.__nxViewerReady = true;
}

setup();
