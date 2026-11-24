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
  return block;
}



const parameterOrder = ['Base ID', 'Basic', 'Designator', 'Extension ID', 'Index',
  'Inspection', 'Nominal Precision', 'Nominal Value', 'Reference', 'Status',
  'Type', 'Unit', 'UUID'];

export function parameterLabel(key) {
  const compact = String(key).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const aliases = {'baseid':'Base ID','extensionid':'Extension ID',
    'nominalprecision':'Nominal Precision','nominalvalue':'Nominal Value',
    'uuid':'UUID','guid':'UUID','units':'Unit'};
  return aliases[compact] || String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

export function characteristicParameters(details) {
  const unique = new Map();
  for (const [key, value] of Object.entries(details || {})) {
    const name = parameterLabel(key);
    if (!unique.has(name) || unique.get(name) === '') unique.set(name, value == null ? '' : String(value));
  }
  return [...unique].sort((a, b) => {
    const ai = parameterOrder.indexOf(a[0]), bi = parameterOrder.indexOf(b[0]);
    return (ai === -1 ? 100 : ai) - (bi === -1 ? 100 : bi) || a[0].localeCompare(b[0]);
  });
}

function characteristicTable(container, details) {
  const block = document.createElement('section');
  block.className = 'inspector-section';
  const title = document.createElement('h3');
  title.textContent = 'Characteristic Instance Details';
  block.append(title);
  const table = document.createElement('table');
  table.className = 'characteristic-parameter-table';
  const header = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const column of ['', 'Parameter', 'Value']) {
    const th = document.createElement('th');
    th.textContent = column;
    tr.append(th);
  }
  header.append(tr);
  table.append(header);
  const body = document.createElement('tbody');
  characteristicParameters(details).forEach(([key, value], index) => {
    const row = document.createElement('tr');
    for (const entry of [String(index + 1), key, value]) {
      const cell = document.createElement('td');
      cell.textContent = entry;
      cell.title = entry;
      row.append(cell);
    }
    body.append(row);
  });
  table.append(body);
  block.append(table);
  container.append(block);
}


const pmiParameterOrder = ['Size', 'Tolerance Type', 'URL', 'Unit', 'Precision',
  'Upper Tolerance', 'Lower Tolerance', 'Name', 'Type', 'Text'];

export function pmiParameters(details) {
  const merged = {'Size': 'Not reported by NX', 'Tolerance Type': 'Not reported by NX',
    'URL': 'Not reported by NX', ...(details || {})};
  return Object.entries(merged).map(([key, value]) =>
    [parameterLabel(key), value == null ? '' : String(value)]).sort((a, b) => {
      const ai = pmiParameterOrder.indexOf(a[0]);
      const bi = pmiParameterOrder.indexOf(b[0]);
      return (ai === -1 ? 100 : ai) - (bi === -1 ? 100 : bi) || a[0].localeCompare(b[0]);
    });
}

export function pmiDependencyLabels(dependencies) {
  const faces = (dependencies?.associatedObjects || []).map(entry => {
    const type = entry.type || 'NX Object';
    const name = entry.name || '';
    return name && name !== type ? `${type} "${name}"` : type;
  });
  const views = (dependencies?.modelViews || []).map(view => {
    const flags = [view.work === true ? 'Work' : '',
      view.displayed === true ? 'Displayed' : ''].filter(Boolean);
    return `${view.name || 'Model View'}${flags.length ? ` (${flags.join(', ')})` : ''}`;
  });
  return {faces, views};
}

function pmiDetailsTable(container, details) {
  const block = document.createElement('section');
  block.className = 'inspector-section';
  const title = document.createElement('h3');
  title.textContent = 'Details';
  block.append(title);
  const table = document.createElement('table');
  table.className = 'characteristic-parameter-table';
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  for (const label of ['', 'Parameter', 'Value']) {
    const th = document.createElement('th'); th.textContent = label; header.append(th);
  }
  head.append(header); table.append(head);
  const body = document.createElement('tbody');
  pmiParameters(details).forEach(([key, value], index) => {
    const tr = document.createElement('tr');
    for (const label of [String(index + 1), key, value]) {
      const td = document.createElement('td');
      td.textContent = label;
      td.title = label;
      tr.append(td);
    }
    body.append(tr);
  });
  table.append(body); block.append(table); container.append(block);
}

function pmiDependencySection(container, entry) {
  const block = document.createElement('section');
  block.className = 'inspector-section pmi-dependencies';
  const title = document.createElement('h3'); title.textContent = 'Dependencies'; block.append(title);
  const outline = document.createElement('details'); outline.open = true;
  const summary = document.createElement('summary');
  summary.textContent = entry.name || 'PMI'; outline.append(summary);
  const {faces, views} = pmiDependencyLabels(entry.dependencies);
  function group(name, values) {
    const details = document.createElement('details'); details.open = true;
    const label = document.createElement('summary'); label.textContent = name; details.append(label);
    const items = document.createElement('ul');
    items.className = 'pmi-dependency-list';
    for (const value of values) {
      const li = document.createElement('li'); li.textContent = value; li.title = value; items.append(li);
    }
    if (!values.length) {
      const li = document.createElement('li'); li.className = 'pmi-dependency-empty';
      li.textContent = 'Not reported by NX'; items.append(li);
    }
    details.append(items); outline.append(details);
  }
  group('Associated Objects', faces);
  group('Model Views', views);
  block.append(outline); container.append(block);
}


function leafIds(node) {
  if (node.type === 'body') return [node.meshId || node.id];
  return (node.children || []).flatMap(leafIds);
}

export class PartInspector {
  constructor({ panel, toggle, content, tabs, onSelectAnnotation = null, onTabChange = null }) {
    this.panel = panel;
    this.toggle = toggle;
    this.content = content;
    this.tabs = tabs;
    this.onSelectAnnotation = onSelectAnnotation;
    this.onTabChange = onTabChange;
    this.activeTab = 'information';
    this.tabButtons = new Map([...(tabs?.querySelectorAll?.('[data-inspector-tab]') || [])]
      .map(button => [button.dataset.inspectorTab, button]));
    toggle.addEventListener('click', () => this.setCollapsed(!panel.classList.contains('is-collapsed')));
    for (const [key, button] of this.tabButtons) {
      button.addEventListener('click', () => this.setTab(key));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const options = [...this.tabButtons.values()].filter(option => !option.disabled);
        if (!options.length) return;
        const current = options.indexOf(button);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
          (current + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
        event.preventDefault();
        options[next].focus();
        this.setTab(options[next].dataset.inspectorTab);
      });
    }
    this.clear();
  }

  setCollapsed(collapsed) {
    this.panel.classList.toggle('is-collapsed', collapsed);
    this.toggle.textContent = collapsed ? '‹' : '›';
    this.toggle.setAttribute('aria-expanded', String(!collapsed));
    this.toggle.setAttribute('aria-label', collapsed ? 'Expand Part Inspector' : 'Collapse Part Inspector');
    this.toggle.title = collapsed ? 'Expand Part Inspector' : 'Collapse Part Inspector';
  }

  setTab(key) {
    const button = this.tabButtons.get(key);
    if (!button || button.disabled || this.activeTab === key) return;
    this.activeTab = key;
    this.selected = null;
    this.render();
    this.onTabChange?.(this.activeTab);
  }

  updateTabs() {
    const annotations = this.info?.annotations || {};
    const keys = {pmi: 'pmi', characteristics: 'characteristics'};
    for (const [key, button] of this.tabButtons) {
      const entries = annotations[keys[key]];
      const count = Array.isArray(entries) ? entries.length : 0;
      const linkedChr = key === 'characteristics' && Boolean(annotations.characteristicsFile?.name);
      button.disabled = key !== 'information' && count === 0 && !linkedChr;
      const unavailable = key !== 'information' && !count && (annotations.warnings || []).some(message =>
        /not accessible|unavailable|not expose|could not enumerate/i.test(message));
      button.title = linkedChr && !count ?
        'Associated CHR file found; NX characteristic parameters have not been extracted' :
        button.disabled ?
          (unavailable ? `${key === 'pmi' ? 'PMI' : 'Characteristics'} data could not be read from NX; absence is not confirmed` :
            `No ${key === 'pmi' ? 'PMI' : 'Characteristic'} records in this export`) :
          (key === 'information' ? 'Product and selection information' : `${count} ${key} record${count === 1 ? '' : 's'}`);
    }
    if (this.tabButtons.get(this.activeTab)?.disabled) this.activeTab = 'information';
    for (const [key, button] of this.tabButtons) {
      button.setAttribute('aria-selected', String(this.activeTab === key));
      button.tabIndex = this.activeTab === key ? 0 : -1;
      button.classList.toggle('is-active', this.activeTab === key);
    }
    this.content.setAttribute('aria-labelledby', `inspector-tab-${this.activeTab}`);
  }

  clear() {
    this.info = null;
    this.metrics = null;
    this.selected = null;
    this.activeTab = 'information';
    this.updateTabs();
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
    this.activeTab = 'information';
    this.render();
    this.onTabChange?.(this.activeTab);
  }

  select(node) {
    if (!this.info) return;
    const previousTab = this.activeTab;
    this.selected = node;
    if (node?.type === 'pmi') this.activeTab = 'pmi';
    else if (node?.type === 'characteristic') this.activeTab = 'characteristics';
    else if (node && !['annotation-group'].includes(node.type)) this.activeTab = 'information';
    this.render();
    if (previousTab !== this.activeTab) this.onTabChange?.(this.activeTab);
  }

  render() {
    if (!this.info) return this.clear();
    this.updateTabs();
    const {info, metrics} = this;
    this.content.replaceChildren();
    if (this.activeTab === 'pmi') return this.renderPmi();
    if (this.activeTab === 'characteristics') return this.renderCharacteristics();
    const file = info.file || {};
    const nx = info.nx || {};
    const totals = countTree(info.tree || null);
    const units = nx.units || 'NX model units (not reported)';
    const size = metrics.overall.size;
    const filename = document.createElement('p');
    filename.className = 'inspector-filename';
    filename.textContent = info.name || 'NX part';
    this.content.append(filename);
    if (this.selected && !['pmi', 'characteristic'].includes(this.selected.type)) {
      const selected = this.selected;
      const selectedBlock = section(this.content, 'Selected Item', [
        ['Name', selected.name, true],
        ['Type', selected.type],
        ['Identifier', selected.id, true],
      ]);
      selectedBlock.className += ' is-selected-info';
    }
    const annotations = info.annotations || {};
    const pmi = Array.isArray(annotations.pmi) ? annotations.pmi : [];
    const chr = Array.isArray(annotations.characteristics) ? annotations.characteristics : [];
    section(this.content, 'PMI & Characteristics', [
      ['PMI records available', integer.format(pmi.length)],
      ['Characteristic records available', integer.format(chr.length)],
      ['Characteristics file', annotations.characteristicsFile?.name || null, true],
      ['Characteristics file status', annotations.characteristicsFile?.status || null],
    ], (annotations.warnings || []).join(' '));
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
      ['File type', (info.name || '').toLowerCase().endsWith('.jt') ? '.jt · JT Model' : '.prt · Siemens NX Part'],
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
        ['Name', node.name, true], ['Type', node.type], ['Bodies in item', integer.format(ids.length)],
      ];
      if (selectedBounds) rowsForSelection.push(
        ['X dimension', format(selectedBounds.size[0])],
        ['Y dimension', format(selectedBounds.size[2])],
        ['Z dimension', format(selectedBounds.size[1])],
        ['Mesh vertices', integer.format(groups.reduce((sum, entry) => sum + entry.vertices, 0))],
        ['Triangles', integer.format(groups.reduce((sum, entry) => sum + entry.triangles, 0))],
      );
      section(this.content, 'Selected Geometry', rowsForSelection,
        !selectedBounds && ids.length ? 'Individual mesh measurements are unavailable for combined exports.' : '');
    }
    if (Array.isArray(nx.attributes) && nx.attributes.length) {
      section(this.content, 'NX Attributes', nx.attributes.slice(0, 50)
        .filter(entry => entry && typeof entry.name === 'string')
        .map(entry => [entry.name, entry.value, true]));
    }
  }

  annotationButton(entry, type, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inspector-annotation-item';
    button.classList.toggle('is-selected', this.selected?.id === entry.id);
    button.textContent = label;
    button.title = `Highlight ${type === 'pmi' ? 'PMI' : 'Characteristic'} in 3D`;
    button.addEventListener('click', () => {
      if (this.onSelectAnnotation) this.onSelectAnnotation(entry.id);
      else this.select({id: entry.id, type, annotation: entry, name: entry.name, details: entry.details});
    });
    return button;
  }

  renderAnnotationList(items, type) {
    const block = document.createElement('section');
    block.className = 'inspector-section annotation-records-section';
    const heading = document.createElement('h3');
    heading.textContent = type === 'pmi' ? `PMI (${items.length})` : `Characteristic Navigator (${items.length})`;
    block.append(heading);
    if (type === 'pmi') {
      const root = document.createElement('details'); root.open = true;
      const summary = document.createElement('summary'); summary.textContent = 'PMI'; root.append(summary);
      const dimension = document.createElement('details'); dimension.open = true;
      const dimensionSummary = document.createElement('summary'); dimensionSummary.textContent = 'Dimension'; dimension.append(dimensionSummary);
      const list = document.createElement('div'); list.className = 'inspector-annotation-tree-children';
      for (const entry of items) {
        const kind = String(entry.type || 'Dimension').replace(/^Pmi/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Dimension';
        const label = entry.name && !/^PMI\s*\d+$/i.test(entry.name) ? entry.name : kind;
        list.append(this.annotationButton(entry, type, `${label}${entry.text ? ` · ${entry.text}` : ''}`));
      }
      dimension.append(list); root.append(dimension); block.append(root);
    } else {
      const root = document.createElement('details'); root.open = true;
      const summary = document.createElement('summary'); summary.textContent = 'Characteristics'; root.append(summary);
      const list = document.createElement('div'); list.className = 'inspector-annotation-tree-children';
      for (const entry of items) {
        const kind = entry.details?.Type || entry.typeLabel || 'Characteristic';
        const id = entry.details?.Designator || entry.name || entry.id;
        list.append(this.annotationButton(entry, type, `${kind} (${id}) "${id}"`));
      }
      root.append(list); block.append(root);
    }
    this.content.append(block);
  }

  renderPmi() {
    const items = this.info.annotations?.pmi || [];
    this.renderAnnotationList(items, 'pmi');
    const selected = items.find(entry => entry.id === this.selected?.id) || (items.length === 1 ? items[0] : null);
    if (!selected) {
      section(this.content, 'PMI Details', [], 'Choose a PMI record above to see its parameters.');
      return;
    }
    pmiDependencySection(this.content, selected);
    pmiDetailsTable(this.content, selected.details || {});
    const presentation = selected.presentation;
    const nativeCount = presentation?.lines?.length || 0;
    const dim = selected.dimension;
    if (nativeCount) section(this.content, 'NX Annotation Graphics', [
      ['Source', presentation.source],
      ['NX line segments', nativeCount],
      ['NX arrow positions', presentation.arrows?.length || 0],
      ['NX text components', presentation.texts?.length || 0],
    ], 'Guide geometry is read from the actual NX annotation display.');
    else if (dim) section(this.content, 'Dimension Geometry (NX coordinates)', [
      ['First reference', Array.isArray(dim.start) ? dim.start.join(', ') : null, true],
      ['Second reference', Array.isArray(dim.end) ? dim.end.join(', ') : null, true],
      ['Text origin', Array.isArray(dim.origin) ? dim.origin.join(', ') : null, true],
      ['Geometry source', dim.source],
    ], 'Native NX presentation lines were unavailable; this is a reference-point reconstruction.');
    else section(this.content, 'Dimension Graphics', [],
      'NX provided PMI text but no readable model-space annotation lines or dimension reference points. Accurate guides cannot be drawn from text alone.');
  }

  renderCharacteristics() {
    const items = this.info.annotations?.characteristics || [];
    const source = this.info.annotations?.characteristicsFile;
    const renderSource = () => {
      if (source?.name) section(this.content, 'Characteristics Source', [
        ['File', source.name, true], ['NX extraction', source.status],
      ]);
    };
    if (!items.length && source?.name) {
      const hints = Array.isArray(source.observedDesignators) ? source.observedDesignators : [];
      if (hints.length) section(this.content, 'Identifiers detected in CHR (unverified)',
        hints.map(hint => [hint.designator, hint.uuid, true]),
        'These identifiers were observed in the native binary file. They are not decoded NX Characteristic instances and cannot be used as engineering parameter records.');
      section(this.content, 'Characteristic extraction unavailable', [],
        'The companion CHR file was found, but NX did not return readable Inspector instances. No parameter values or PMI links have been inferred. Run the read-only NX Inspector API diagnostic to identify the supported NX 2506 interface.');
      renderSource();
      return;
    }
    this.renderAnnotationList(items, 'characteristic');
    const selected = items.find(entry => entry.id === this.selected?.id) || (items.length === 1 ? items[0] : null);
    if (!selected) {
      section(this.content, 'Characteristic Instance Details', [], 'Choose a Characteristic record above to inspect its saved parameters.');
      renderSource();
      return;
    }
    const instances = document.createElement('section');
    instances.className = 'inspector-section';
    const title = document.createElement('h3'); title.textContent = 'Characteristic Instances';
    instances.append(title);
    const inst = this.annotationButton(selected, 'characteristic', selected.details?.Designator || selected.name || 'Instance');
    instances.append(inst);
    this.content.append(instances);
    section(this.content, 'Characteristic', [
      ['Designator', selected.name, true],
      [selected.associationSource?.includes('inferred') ? 'Linked PMI (inferred)' : 'Linked PMI',
        selected.pmiId || 'Not reported', true],
      ['Association source', selected.associationSource || null, true],
    ]);
    characteristicTable(this.content, selected.details || {});
    renderSource();
  }
}
