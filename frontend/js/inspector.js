import { boundsFor } from './geometry.js';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function format(value) {
  return Number.isFinite(value) ? number.format(value) : 'Unavailable';
}

export function summarizeGeometry(meshes) {
  const byMesh = new Map();
  const overall = boundsFor(meshes);
  let vertices = 0;
  let triangles = 0;
  for (const mesh of meshes) {
    const id = mesh.meshId || 'root';
    const record = byMesh.get(id) || { meshes: [], vertices: 0, triangles: 0 };
    const count = Math.floor(mesh.positions.length / 3);
    const faces = Math.floor(mesh.indices.length / 3);
    vertices += count;
    triangles += faces;
    record.vertices += count;
    record.triangles += faces;
    record.meshes.push(mesh);
    byMesh.set(id, record);
  }
  return { overall, vertices, triangles, byMesh };
}

function countTree(root) {
  const totals = { parts: 0, components: 0, bodies: 0 };
  function visit(node) {
    if (node.type === 'part') totals.parts++;
    if (node.type === 'component') totals.components++;
    if (node.type === 'body') totals.bodies++;
    for (const child of node.children || []) visit(child);
  }
  if (root) visit(root);
  return totals;
}

function rows(container, items) {
  const dl = document.createElement('dl');
  dl.className = 'inspector-rows';
  for (const [label, value, long] of items) {
    if (value === undefined || value === null || value === '') continue;
    const entry = document.createElement('div');
    entry.className = 'inspector-row' + (long ? ' is-long' : '');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = String(value);
    entry.append(dt, dd);
    dl.append(entry);
  }
  container.append(dl);
}

function section(container, heading, items, note = '') {
  const block = document.createElement('section');
  block.className = 'inspector-section';
  const title = document.createElement('h3');
  title.textContent = heading;
  block.append(title);
  rows(block, items);
  if (note) {
    const text = document.createElement('p');
    text.className = 'inspector-note';
    text.textContent = note;
    block.append(text);
  }
  container.append(block);
}

function leafIds(node) {
  if (node.type === 'body') return [node.meshId || node.id];
  return (node.children || []).flatMap(leafIds);
}

export class PartInspector {
  constructor({ panel, toggle, content }) {
    this.panel = panel;
    this.toggle = toggle;
    this.content = content;
    toggle.addEventListener('click', () => this.setCollapsed(!panel.classList.contains('is-collapsed')));
    this.clear();
  }

  setCollapsed(collapsed) {
    this.panel.classList.toggle('is-collapsed', collapsed);
    this.toggle.textContent = collapsed ? '‹' : '›';
    this.toggle.setAttribute('aria-expanded', String(!collapsed));
    this.toggle.setAttribute('aria-label', collapsed ? 'Expand Part Inspector' : 'Collapse Part Inspector');
    this.toggle.title = collapsed ? 'Expand Part Inspector' : 'Collapse Part Inspector';
  }

  clear() {
    this.info = null;
    this.metrics = null;
    this.selected = null;
    this.content.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'inspector-empty';
    empty.textContent = 'Open an NX file to view part information.';
    this.content.append(empty);
  }

  show(info, meshes, { perBody = false, gridSize = null } = {}) {
    this.info = info;
    this.metrics = summarizeGeometry(meshes);
    this.perBody = perBody;
    this.gridSize = gridSize;
    this.selected = null;
    this.render();
  }

  select(node) {
    if (!this.info) return;
    this.selected = node;
    this.render();
  }

  render() {
    if (!this.info) return this.clear();
    const { info, metrics } = this;
    const file = info.file || {};
    const nx = info.nx || {};
    const tree = info.tree || null;
    const totals = countTree(tree);
    const units = nx.units || 'NX model units (not reported)';
    const size = metrics.overall.size;
    this.content.replaceChildren();
    const filename = document.createElement('p');
    filename.className = 'inspector-filename';
    filename.textContent = info.name || 'NX part';
    this.content.append(filename);
    section(this.content, 'Dimensions', [
      ['X dimension', format(size[0])],
      ['Y dimension', format(size[2])],
      ['Z dimension', format(size[1])],
      ['Units', units],
    ]);
    section(this.content, 'Geometry Information', [
      ['Mesh vertices', integer.format(metrics.vertices)],
      ['Triangles', integer.format(metrics.triangles)],
      ['Geometry', 'Triangulated STL mesh'],
      ['Mesh chunks', integer.format(metrics.byMesh.size ? [...metrics.byMesh.values()].reduce((sum, group) => sum + group.meshes.length, 0) : 0)],
      ['Grid size (viewer X × Z)', Number.isFinite(this.gridSize) ? `${format(this.gridSize)} × ${format(this.gridSize)}` : null],
    ], 'Dimensions are measured from displayed geometry; mesh vertices count STL vertices, not unique CAD vertices.');
    section(this.content, 'NX Item Structure', [
      ['Components', integer.format(totals.components)],
      ['Bodies', integer.format(totals.bodies)],
      ['Body visibility', this.perBody ? 'Individual bodies available' : 'Combined geometry'],
    ]);
    section(this.content, 'File Information', [
      ['File name', info.name],
      ['File type', '.prt · Siemens NX Part'],
      ['File size', Number.isFinite(file.size) ? `${format(file.size / 1024)} KB` : null],
      ['Last modified', file.modified || null],
      ['File location', file.path || null, true],
    ]);
    if (this.selected) {
      const node = this.selected;
      const ids = [...new Set(leafIds(node))];
      const groups = this.perBody ? ids.map(id => metrics.byMesh.get(id)).filter(Boolean) : [];
      const selectedMeshes = groups.flatMap(group => group.meshes);
      const selectedBounds = selectedMeshes.length ? boundsFor(selectedMeshes) : null;
      const rowsForSelection = [
        ['Name', node.name, true],
        ['Type', node.type],
        ['Bodies in item', integer.format(ids.length)],
      ];
      if (selectedBounds) {
        rowsForSelection.push(
          ['X dimension', format(selectedBounds.size[0])],
          ['Y dimension', format(selectedBounds.size[2])],
          ['Z dimension', format(selectedBounds.size[1])],
          ['Mesh vertices', integer.format(groups.reduce((sum, entry) => sum + entry.vertices, 0))],
          ['Triangles', integer.format(groups.reduce((sum, entry) => sum + entry.triangles, 0))],
        );
      }
      section(this.content, 'Selected Item', rowsForSelection,
        !selectedBounds && ids.length ? 'Individual mesh measurements are unavailable for combined exports.' : '');
    }
    if (Array.isArray(nx.attributes) && nx.attributes.length) {
      section(this.content, 'NX Attributes', nx.attributes.slice(0, 50)
        .filter(entry => entry && typeof entry.name === 'string')
        .map(entry => [entry.name, entry.value, true]));
    }
  }
}
