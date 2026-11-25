import { Viewer } from './viewer.js';
import { parseSTL } from './stl.js';
import { ItemTree } from './item_tree.js';
import { PartInspector } from './inspector.js';
import { FileWorkspace } from './workspace.js';
import { createExplodePlan, calculateExplodeOffsets, selectionGroupIds } from './assembly_explode.js';
import { buildComponentColors } from './component_colors.js';
import { MoveGizmo, MOVE_AXES } from './component_move.js';
import { SectionGizmo } from './section_gizmo.js';
import { makeSectionPanelDraggable, makeSectionSliderPresets } from './section_panel_controls.js';
import { sectionImageName, composeSectionImage } from './section_export.js';
import { MeasurementUI } from './measurement_ui.js';
import { AnnotationDisplay } from './annotations_ui.js';

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
  const componentOpacities = new Map(); // meshId -> opacity, per occurrence
  let moveMode = false;
  let moveGizmo = null;
  let measureMode = false;
  let measurement = null;
  let annotations = null;
  let isolated = null; // { nodeId, previous: Map(meshId -> prior visible) }
  let componentColorEnabled = false;
  let componentColors = { available: false, colors: new Map() };
  const canExplode = () => explodeGroups.length >= 2;
  let sectionEnabled = false;
  let sectionAxis = 'X';
  let sectionReversed = false;
  let sectionFill = true;
  let sectionTiltU = 0;
  let sectionTiltV = 0;
  let sectionGizmoEnabled = true;
  let sectionGizmo = null;
  let openedModelName = 'NX_Model';
  const sectionPanelDrag = makeSectionPanelDraggable(
    $('section-panel'), $('section-drag-handle'), $('viewer-viewport'));
  const sectionPresetControls = [
    makeSectionSliderPresets($('section-depth'), $('section-depth-presets'),
      [0, 25, 50, 75, 100], {unit: '%', snapTolerance: 2}),
    makeSectionSliderPresets($('section-tilt-u'), $('section-tilt-u-presets'),
      [-180, -135, -90, -45, 0, 45, 90, 135, 180], {unit: '°', snapTolerance: 3}),
    makeSectionSliderPresets($('section-tilt-v'), $('section-tilt-v-presets'),
      [-180, -135, -90, -45, 0, 45, 90, 135, 180], {unit: '°', snapTolerance: 3}),
  ];

  function refreshSection() {
    viewer.setSection({ enabled: sectionEnabled, axis: sectionAxis,
      percent: Number($('section-depth').value), reversed: sectionReversed,
      showCap: sectionFill, tiltU: sectionTiltU, tiltV: sectionTiltV,
      showGizmo: sectionGizmoEnabled });
    sectionGizmo?.setVisible(sectionEnabled && sectionGizmoEnabled);
    const state = sectionEnabled ? viewer.sectionState() : { active: false, caps: 0, open: 0 };
    $('section-menu-button').classList.toggle('active', sectionEnabled);
    $('section-menu-button').setAttribute('aria-pressed', String(sectionEnabled));
    $('section-panel').hidden = !sectionEnabled;
    $('section-save-image').disabled = !sectionEnabled || !viewer.geometry.length;
    $('section-depth-value').textContent = `${$('section-depth').value}%`;
    for (const button of document.querySelectorAll('[data-section-axis]')) {
      button.setAttribute('aria-pressed', String(button.dataset.sectionAxis === sectionAxis));
    }
    $('section-flip').setAttribute('aria-pressed', String(sectionReversed));
    $('section-cap').checked = sectionFill;
    $('section-tilt-u').value = String(sectionTiltU);
    $('section-tilt-v').value = String(sectionTiltV);
    $('section-tilt-u-value').textContent = `${Math.round(sectionTiltU)}°`;
    $('section-tilt-v-value').textContent = `${Math.round(sectionTiltV)}°`;
    $('section-gizmo-visible').checked = sectionGizmoEnabled;
    for (const presets of sectionPresetControls) presets.update();
    if (sectionEnabled) sectionPanelDrag.keepInView();
    $('section-status').textContent = !state.active ? 'Section inactive' : !state.stencil && sectionFill
      ? 'Cut active · solid caps unavailable (stencil support required)'
      : `${state.caps} closed cut face(s) · ${state.open} open mesh(es)` +
        (state.open ? ' (open meshes are not filled)' : '');
  }


  function updateComponentColorMode() {
    const active = componentColors.available && componentColorEnabled;
    for (const button of [$('component-color-toggle'), $('component-color-menu-button')]) {
      button.disabled = !componentColors.available;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.title = !componentColors.available ? 'Component colors require separate assembly geometry' :
        active ? 'Restore original steel appearance' : 'Color components by type';
    }
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
    if (sectionEnabled) refreshSection();
    tree.setVisibilityFromMeshes(map);
    updateMoveActions();
  }
  // 0 = unchanged steel, 100 = clear glass with a thin visible silhouette.
  // A perceptual curve opens up the interior sooner than linear alpha; its
  // exact inverse keeps the selected component's saved slider value stable.
  const GLASS_ALPHA = 0.045;
  const transparencyToAlpha = value => GLASS_ALPHA + (1 - GLASS_ALPHA) *
    Math.pow(1 - Math.min(100, Math.max(0, value)) / 100, 2);
  const alphaToTransparency = alpha => {
    const remaining = Math.min(1, Math.max(0, (alpha - GLASS_ALPHA) / (1 - GLASS_ALPHA)));
    return Math.round(100 * (1 - Math.sqrt(remaining)));
  };
  function transparencyTarget() {
    const node = selectedNode();
    if (!tree.visibilityEnabled || node?.type !== 'component') return null;
    const ids = meshIdsFor(node);
    return ids.length && hasMesh(ids) ? { node, ids } : null;
  }
  function updateTransparencyActions() {
    const target = transparencyTarget();
    const slider = $('component-opacity-slider');
    const currentAlpha = target ?
      (componentOpacities.get(target.ids.find(id => componentOpacities.has(id))) ?? 1) : 1;
    const current = Math.max(0, Math.min(100, alphaToTransparency(currentAlpha)));
    $('tree-opacity-actions').hidden = !tree.root || !tree.visibilityEnabled;
    $('transparency-menu-toggle').disabled = !tree.root || !tree.visibilityEnabled;
    $('reset-transparency-all').disabled = componentOpacities.size === 0;
    slider.disabled = !target;
    slider.value = String(current);
    $('component-opacity-value').textContent = `${current}%`;
  }
  function applyTransparency() {
    viewer.setMeshOpacities(componentOpacities);
    updateTransparencyActions();
  }
  function updateSelectionActions() {
    $('tree-selection-actions').hidden = !tree.root;
    $('component-menu-toggle').disabled = !tree.root;
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
    updateTransparencyActions();
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
    if (sectionEnabled) refreshSection();
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
    const exploded = explodeLevel > 0 || [...selectedOverrides.values()].some(value => value > 0);
    const button = $('header-explode');
    button.disabled = !canExplode();
    const label = button.querySelector?.('#header-explode-label');
    if (label) label.textContent = exploded ? 'Collapse' : 'Explode';
    else button.textContent = exploded ? 'Collapse' : 'Explode';
    button.title = exploded ? 'Collapse all assembly components' : 'Explode all assembly components';
    button.setAttribute('aria-pressed', String(exploded));
    button.classList.toggle('is-active', exploded);
  }
  function applyExplosion() {
    viewer.setExplodeOffsets(calculateExplodeOffsets(explodeGroups, explodeBounds, explodeLevel, selectedOverrides));
    if (sectionEnabled) refreshSection();
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
    tabs: $('inspector-tabs'),
  });
  const tree = new ItemTree({
    panel: $('tree-panel'), toggle: $('tree-toggle'), resizer: $('tree-resizer'),
    container: $('model-tree'), summary: $('tree-summary'), note: $('tree-note'),
    onVisibility: (meshId, visible) => {
      viewer.setMeshVisible(meshId, visible);
      if (sectionEnabled) refreshSection();
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
      annotations?.setSelected(null);
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
  measurement = new MeasurementUI(viewer, {
    panel: $('measurement-panel'), summary: $('measurement-summary'),
    detail: $('measurement-detail'), clear: $('measurement-clear'), fit: $('measurement-fit'),
    overlay: $('measurement-overlay'), line: $('measurement-line'),
    pointA: $('measurement-point-a'), pointB: $('measurement-point-b'),
    center: $('measurement-center'), arc: $('measurement-arc'),
  });
  function updateMeasureButton() {
    const button = $('measure-planes-toggle');
    button.disabled = !viewer.geometry.length;
    button.classList.toggle('active', measureMode);
    button.setAttribute('aria-pressed', String(measureMode));
    button.title = measureMode ? 'Exit measurement' : 'Measure diameter, center spacing, or planar distance/angle';
    viewer.measureActive = measureMode;
    viewer.canvas.classList.toggle('is-measuring', measureMode);
    viewer.canvas.style.cursor = measureMode ? 'crosshair' : 'grab';
  }
  function setMeasureMode(active) {
    measureMode = !!active && !!viewer.geometry.length;
    if (measureMode && moveMode) { moveMode = false; updateMoveActions(); }
    measurement.setActive(measureMode);
    viewer.setHoveredMeshIds([]);
    updateMeasureButton();
    if (measureMode) $('status-message').textContent = 'Measurement: select a round surface for diameter, two round surfaces for center distance, or two planes';
  }
  function selectAnnotation(id) {
    const entries = inspector.info?.annotations || {};
    const item = [...(entries.pmi || []), ...(entries.characteristics || [])].find(record => record.id === id);
    if (!item) return;
    const type = (entries.pmi || []).some(record => record.id === id) ? 'pmi' : 'characteristic';
    tree.selectNode(null);
    inspector.select({id: item.id, name: item.name, type, annotation: item, details: item.details});
    viewer.setSelectedMeshIds(item.meshId ? [item.meshId] : []);
    annotations.setSelected(id);
    $('status-message').textContent = `Selected ${type === 'pmi' ? 'PMI' : 'Characteristic'}: ${item.name || item.text}`;
  }
  annotations = new AnnotationDisplay(viewer, $('annotation-layer'), selectAnnotation);
  inspector.onSelectAnnotation = selectAnnotation;
  inspector.onTabChange = tab => {
    annotations.setSelected(null);
    annotations.setMode(tab);
    const activeComponent = selectedNode();
    viewer.setSelectedMeshIds(activeComponent ? meshIdsFor(activeComponent) : []);
  };
  sectionGizmo = new SectionGizmo($('section-gizmo'), viewer, changes => {
    if (changes.percent !== undefined) $('section-depth').value = String(changes.percent);
    if (changes.tiltU !== undefined) sectionTiltU = changes.tiltU;
    if (changes.tiltV !== undefined) sectionTiltV = changes.tiltV;
    refreshSection();
  });
  viewer.onFrame = () => { moveGizmo.update(); sectionGizmo.update(); measurement.update(); annotations.update(); };
  viewer.onHoverMesh = meshId => {
    const node = !measureMode && meshId ? tree.nodeForMesh(meshId) : null;
    viewer.setHoveredMeshIds(node ? tree.descendants(node) : []);
  };
  viewer.onSelectMesh = (meshId, x, y) => {
    if (measureMode) {
      measurement.select(viewer.pickSurface(x, y, meshId));
      $('status-message').textContent = measurement.statusText();
      return;
    }
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
    openedModelName = 'NX_Model';
    sectionEnabled = false;
    sectionTiltU = 0; sectionTiltV = 0; sectionAxis = 'X'; sectionReversed = false;
    $('section-depth').value = '50';
    $('section-menu-button').disabled = true;
    refreshSection();
    isolated = null;
    viewer.setScene([]);
    setMeasureMode(false);
    componentOpacities.clear();
    viewer.setMeshOpacities(componentOpacities);
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
    annotations.clear();
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
        const meshes = parseSTL(buffer).map(mesh => ({ ...mesh, meshId: item.id,
          analyticalFaces: item.analyticalFaces || [] }));
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
    showLoading('Opening CAD file', workspacePath ? `Preparing uploads/${workspacePath}` : 'Select a .prt or .jt file on this computer; NX will prepare the geometry.');
    $('status-message').textContent = workspacePath ? `Opening uploads/${workspacePath}…` : 'Choose an NX part or JT file on this computer…';
    try {
      const result = await fetch(workspacePath ? '/api/workspace/open' : '/api/open', {
        method: 'POST', cache: 'no-store',
        ...(workspacePath ? {headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({path: workspacePath})} : {}),
      });
      const info = await result.json();
      if (info.cancelled) {
        $('empty-state').hidden = false;
        $('status-message').textContent = 'File selection cancelled · No model loaded';
        return;
      }
      if (!result.ok || !info.ok) throw new Error(info.error || 'NX could not open this file.');
      showLoading('Loading NX geometry', `Preparing the geometry for ${info.name}…`);
      $('status-message').textContent = `Loading geometry from ${info.name}…`;
      const { meshes, perBody } = await loadGeometry(info);
      viewer.setScene(meshes);
      openedModelName = info.name || 'NX_Model';
      $('section-menu-button').disabled = !viewer.geometry.length;
      sectionEnabled = false;
      sectionTiltU = 0; sectionTiltV = 0; sectionAxis = 'X'; sectionReversed = false;
      $('section-depth').value = '50';
      refreshSection();
      measurement.setModelUnits(info.nx?.units);
      updateMeasureButton();
      const geometryStructure = info.tree || { id: 'root', name: info.name, type: 'part', children: [] };
      const structure = geometryStructure;
      componentColors = perBody ? buildComponentColors(structure, meshes) :
        { available: false, colors: new Map() };
      viewer.setComponentColors(componentColors.colors);
      updateComponentColorMode();
      tree.show(structure, {
        visibilityEnabled: perBody, warning: info.warning || '',
      });
      setCameraView('iso');
      initializeExplosion(info, meshes, perBody);
      annotations.setData(info.annotations);
      inspector.show(info, meshes, { perBody, gridSize: viewer.gridSize });
      annotations.setMode(inspector.activeTab);
      updateSelectionActions();
      $('empty-state').hidden = true;
      $('status-message').textContent = `${info.name} loaded · Drag to rotate · Scroll to zoom`;
    } catch (error) {
      clearScene();
      $('import-message').textContent = error.message;
      $('import-message').hidden = false;
      $('status-message').textContent = 'Unable to open CAD file';
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
  const headerMenus = new Map([
    ['component-menu-toggle', 'component-menu'],
    ['transparency-menu-toggle', 'transparency-menu'],
    ['viewer-menu-toggle', 'viewer-menu'],
  ]);
  function closeHeaderMenus() {
    for (const [triggerId, menuId] of headerMenus) {
      $(menuId).hidden = true;
      $(triggerId).setAttribute('aria-expanded', 'false');
    }
  }
  for (const [triggerId, menuId] of headerMenus) {
    $(triggerId).addEventListener('click', () => {
      const trigger = $(triggerId);
      const menu = $(menuId);
      const wasOpen = !menu.hidden;
      closeHeaderMenus();
      if (wasOpen || trigger.disabled) return;
      const anchor = trigger.getBoundingClientRect();
      menu.hidden = false;
      menu.style.top = `${Math.min(window.innerHeight - 25, anchor.bottom + 6)}px`;
      const width = menu.getBoundingClientRect().width;
      menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
      trigger.setAttribute('aria-expanded', 'true');
    });
  }
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.header-menu, .header-menu-trigger')) closeHeaderMenus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeHeaderMenus();
  });
  window.addEventListener('resize', closeHeaderMenus);
  document.querySelectorAll('#component-menu button, #viewer-menu button, #reset-transparency-all')
    .forEach(button => button.addEventListener('click', closeHeaderMenus));
  // In LAN mode, file selection must happen in the browser, not on the server desktop.
  const localViewer = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
  $('open-nx-button').addEventListener('click', () => {
    if (localViewer) openNXPart();
    else $('workspace-button').click();
  });
  $('header-explode').addEventListener('click', () => {
    const exploded = explodeLevel > 0 || [...selectedOverrides.values()].some(value => value > 0);
    if (exploded) collapseAll();
    else explodeAll();
  });
  new FileWorkspace(path => openNXPart(path));
  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => setCameraView(button.dataset.view));
  }
  $('fit-button').addEventListener('click', () => viewer.fit());
  $('fit-menu-button').addEventListener('click', () => viewer.fit());
  $('measure-planes-toggle').addEventListener('click', () => {
    if (sectionEnabled) { sectionEnabled = false; refreshSection(); }
    setMeasureMode(!measureMode);
  });
  $('section-menu-button').addEventListener('click', () => {
    sectionEnabled = !sectionEnabled;
    if (sectionEnabled && measureMode) setMeasureMode(false);
    refreshSection();
  });
  $('section-close').addEventListener('click', () => { sectionEnabled = false; refreshSection(); });
  for (const button of document.querySelectorAll('[data-section-axis]')) {
    button.addEventListener('click', () => { sectionAxis = button.dataset.sectionAxis;
      sectionTiltU = 0; sectionTiltV = 0; refreshSection(); });
  }
  $('section-depth').addEventListener('input', refreshSection);
  for (const name of ['u', 'v']) {
    $(`section-tilt-${name}`).addEventListener('input', () => {
      if (name === 'u') sectionTiltU = Number($('section-tilt-u').value);
      else sectionTiltV = Number($('section-tilt-v').value);
      refreshSection();
    });
  }
  $('section-gizmo-visible').addEventListener('change', () => {
    sectionGizmoEnabled = $('section-gizmo-visible').checked;
    refreshSection();
  });
  $('section-reset').addEventListener('click', () => {
    sectionAxis = 'X'; sectionTiltU = 0; sectionTiltV = 0;
    sectionReversed = false; $('section-depth').value = '50';
    refreshSection();
  });
  $('section-flip').addEventListener('click', () => { sectionReversed = !sectionReversed; refreshSection(); });
  $('section-cap').addEventListener('change', () => { sectionFill = $('section-cap').checked; refreshSection(); });
  $('section-save-image').addEventListener('click', async () => {
    if (!sectionEnabled || !viewer.geometry.length) return;
    const button = $('section-save-image');
    const filename = sectionImageName(openedModelName);
    let handlePromise = null;
    // File picker must be opened directly from the user gesture. Non-secure
    // HTTP sessions and unsupported browsers use a normal PNG download.
    if (window.isSecureContext && typeof window.showSaveFilePicker === 'function') {
      try {
        handlePromise = window.showSaveFilePicker({ suggestedName: filename,
          types: [{ description: 'PNG image', accept: {'image/png': ['.png']} }] });
        // Catch picker dismissal even if the capture fails before awaiting it.
        handlePromise.catch(() => {});
      } catch (error) {
        $('section-status').textContent = `Save dialog could not open: ${error.message}`;
        return;
      }
    }
    button.disabled = true;
    try {
      const snapshot = viewer.captureSectionImage(annotations);
      const image = composeSectionImage(snapshot, {filename: openedModelName,
        section: {...viewer.section}, logo: document.querySelector('.brand-logo')});
      const blob = await new Promise((resolve, reject) => image.toBlob(result =>
        result ? resolve(result) : reject(new Error('Could not encode PNG.')), 'image/png'));
      let chosenFilename = filename;
      if (handlePromise) {
        const handle = await handlePromise;
        chosenFilename = handle.name || filename;
        const writer = await handle.createWritable();
        await writer.write(blob);
        await writer.close();
      } else {
        const url = URL.createObjectURL(blob);
        try {
          const link = document.createElement('a');
          link.href = url; link.download = filename;
          document.body.append(link);
          link.click();
          link.remove();
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 30000);
        }
      }
      $('section-status').textContent = handlePromise ? `Saved ${chosenFilename}` :
        `PNG downloaded: ${filename} · Browser download settings control the save location.`;
      if (annotations.sectionIncluded) $('section-status').textContent += ` · ${annotations.sectionIncluded} annotation(s) included.`;
      if (annotations.sectionOmitted) $('section-status').textContent += ` · ${annotations.sectionOmitted} annotation(s) omitted (hidden, ambiguous or inconsistent component references).`;
    } catch (error) {
      if (error.name !== 'AbortError') $('section-status').textContent = `Image export failed: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });

  for (const button of [$('component-color-toggle'), $('component-color-menu-button')]) {
    button.addEventListener('click', () => {
      if (!componentColors.available) return;
      componentColorEnabled = !componentColorEnabled;
      updateComponentColorMode();
    });
  }
  $('component-opacity-slider').addEventListener('input', () => {
    const target = transparencyTarget();
    if (!target) return;
    const amount = Number($('component-opacity-slider').value);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100) return;
    for (const id of target.ids) {
      if (amount === 0) componentOpacities.delete(id);
      else componentOpacities.set(id, transparencyToAlpha(amount));
    }
    applyTransparency();
    $('status-message').textContent = `Transparency ${Math.round(amount)}%: ${target.node.name}`;
  });
  $('reset-transparency-all').addEventListener('click', () => {
    componentOpacities.clear();
    applyTransparency();
    $('status-message').textContent = 'All components restored to solid appearance';
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
