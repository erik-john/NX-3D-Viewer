/** NX item hierarchy and geometry visibility controls. */
export class ItemTree {
  constructor({ panel, toggle, resizer, container, summary, note, onVisibility, onSelect,
    onToggleExplode = () => {}, onToggleAll = () => {} }) {
    this.panel = panel;
    this.toggle = toggle;
    this.resizer = resizer;
    this.container = container;
    this.summary = summary;
    this.note = note;
    this.onVisibility = onVisibility;
    this.onSelect = onSelect;
    this.onToggleExplode = onToggleExplode;
    this.onToggleAll = onToggleAll;
    this.explodeActions = new Map();
    this.root = null;
    this.checkboxes = new Map();
    this.rows = new Map();
    this.selectedId = null;
    this.nodes = new Map();
    this.parents = new Map();
    this.meshNodes = new Map();
    this.nestedLists = new Map();
    this.disclosures = new Map();
    this.expanded = new Set();
    this.toggle.addEventListener('click', () => this.setCollapsed(!panel.classList.contains('is-collapsed')));
    this.resizer.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const start = event.clientX;
      const initial = panel.getBoundingClientRect().width;
      const change = e => {
        const available = Math.max(210, panel.parentElement.getBoundingClientRect().width - 170);
        panel.style.setProperty('--tree-width', `${Math.max(210, Math.min(470, available, initial + e.clientX - start))}px`);
        this.resizer.classList.add('is-resizing');
      };
      const end = () => {
        window.removeEventListener('pointermove', change);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        this.resizer.classList.remove('is-resizing');
      };
      window.addEventListener('pointermove', change);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
    this.resizer.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
      event.preventDefault();
      const width = panel.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 20 : -20);
      panel.style.setProperty('--tree-width', `${Math.max(210, Math.min(470, width))}px`);
    });
    this.clear();
  }

  setCollapsed(collapsed) {
    this.panel.classList.toggle('is-collapsed', collapsed);
    this.toggle.textContent = collapsed ? '›' : '‹';
    this.toggle.setAttribute('aria-expanded', String(!collapsed));
    this.toggle.setAttribute('aria-label', collapsed ? 'Expand item structure panel' : 'Collapse item structure panel');
    this.toggle.title = collapsed ? 'Expand panel' : 'Collapse panel';
  }

  clear() {
    this.root = null;
    this.assemblyHasComponents = false;
    this.checkboxes.clear();
    this.explodeActions.clear();
    this.rows.clear();
    this.nodes.clear();
    this.parents.clear();
    this.meshNodes.clear();
    this.nestedLists.clear();
    this.disclosures.clear();
    this.expanded.clear();
    this.selectedId = null;
    this.container.replaceChildren();
    this.summary.textContent = 'No NX file loaded';
    this.note.hidden = true;
    this.note.textContent = '';
  }

  show(root, { visibilityEnabled = false, warning = '' } = {}) {
    this.clear();
    this.root = root;
    this.visibilityEnabled = visibilityEnabled;
    const totals = { components: 0, bodies: 0 };
    const count = node => {
      if (node.type === 'component') totals.components += 1;
      if (node.type === 'body') totals.bodies += 1;
      for (const child of node.children || []) count(child);
    };
    count(root);
    this.assemblyHasComponents = totals.components > 0;
    this.summary.textContent = `${totals.components} components · ${totals.bodies} bodies`;
    this.note.textContent = warning || (!visibilityEnabled && totals.bodies ?
      'The structure is available; individual visibility is unavailable for this file.' : '');
    this.note.hidden = !this.note.textContent;
    const rootList = document.createElement('ul');
    rootList.setAttribute('role', 'group');
    rootList.append(this.createNode(root, 0));
    this.container.replaceChildren(rootList);
  }

  descendants(node) {
    if (node.type === 'body') return [node.meshId || node.id];
    return (node.children || []).flatMap(child => this.descendants(child));
  }

  // For a body hit, select its enclosing component occurrence where available.
  nodeForMesh(meshId) {
    if (!this.root) return null;
    if (meshId === 'root' && !this.visibilityEnabled) return this.root;
    let node = this.meshNodes.get(meshId);
    if (!node) return null;
    let candidate = node;
    while (node) {
      if (node.type === 'component') return node;
      node = this.parents.get(node.id);
    }
    return candidate;
  }

  selectMesh(meshId) {
    const node = this.nodeForMesh(meshId);
    if (node) this.selectNode(node);
    return node;
  }

  selectNode(node) {
    if (this.selectedId) this.rows.get(this.selectedId)?.classList.remove('is-selected');
    this.selectedId = node?.id || null;
    if (node) {
      let parent = this.parents.get(node.id);
      while (parent) {
        const list = this.nestedLists.get(parent.id);
        if (list) {
          list.hidden = false;
          const item = list.parentElement;
          item?.setAttribute('aria-expanded', 'true');
          const disclosure = this.disclosures.get(parent.id);
          if (disclosure) disclosure.textContent = '▾';
        }
        parent = this.parents.get(parent.id);
      }
      const row = this.rows.get(node.id);
      row?.classList.add('is-selected');
      row?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    this.onSelect(node || null);
  }

  // Reflect programmatic visibility changes in every checkbox, including parents.
  // Only leaf/body checkboxes are authoritative; parent checkboxes are derived.
  setVisibilityFromMeshes(visibility) {
    for (const node of this.nodes.values()) {
      if (node.type !== 'body') continue;
      const checkbox = this.checkboxes.get(node.id);
      if (checkbox && visibility.has(node.meshId || node.id)) {
        checkbox.checked = visibility.get(node.meshId || node.id);
        checkbox.indeterminate = false;
      }
    }
    this.updateAncestors();
  }

  updateAncestors() {
    if (!this.root) return;
    const walk = node => {
      const checkbox = this.checkboxes.get(node.id);
      const childChecks = (node.children || []).map(walk);
      if (childChecks.length) {
        const all = childChecks.every(status => status === 'all');
        const none = childChecks.every(status => status === 'none');
        if (checkbox) {
          checkbox.checked = all;
          checkbox.indeterminate = !all && !none;
        }
        return all ? 'all' : none ? 'none' : 'mixed';
      }
      return checkbox && !checkbox.checked ? 'none' : 'all';
    };
    walk(this.root);
  }

  // Each assembly/component row has one position toggle, independent of visibility.
  // A partially exploded parent is active and clicking it resets its group.
  setExplodeState(groups = [], level = 0, overrides = new Map()) {
    const available = groups.length >= 2;
    for (const [nodeId, button] of this.explodeActions) {
      const node = this.nodes.get(nodeId);
      const meshIds = new Set(node === this.root ? [] : this.descendants(node));
      const relevant = node === this.root ? groups : groups.filter(group =>
        group.meshIds.some(id => meshIds.has(id)));
      const enabled = available && relevant.length > 0;
      const moved = enabled && relevant.some(group => (overrides.get(group.id) ?? level) > 0);
      const isRoot = node === this.root;
      const action = moved ? 'Reset' : 'Explode';
      const label = isRoot ? `${action} all components` : `${action} component ${node.name}`;
      button.disabled = !enabled;
      button.classList.toggle('is-active', moved);
      button.setAttribute('aria-pressed', String(moved));
      button.setAttribute('aria-label', label);
      button.title = enabled ? label : 'Separate component geometry required';
    }
  }

  createExplodeToggle(callback) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-explode-toggle';
    button.disabled = true;
    button.setAttribute('aria-pressed', 'false');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [state, paths] of Object.entries({
      explode: ['M8 8 3 3', 'M3 7V3h4', 'm16 16 5 5', 'M17 21h4v-4',
        'M13 11 21 3', 'M17 3h4v4', 'M11 13 3 21', 'M3 17v4h4'],
      reset: ['M3 3h5v5', 'M3 3l7 7', 'M21 3h-5v5', 'M21 3l-7 7',
        'M3 21h5v-5', 'm3 21 7-7', 'M21 21h-5v-5', 'm-3 21-7-7'],
    })) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', `icon-${state}`);
      for (const d of paths) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        group.append(path);
      }
      svg.append(group);
    }
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '17');
    svg.setAttribute('height', '17');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    button.append(svg);
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (!button.disabled) callback(button.getAttribute('aria-pressed') !== 'true');
    });
    return button;
  }

  createNode(node, depth, parent = null) {
    this.nodes.set(node.id, node);
    if (parent) this.parents.set(node.id, parent);
    if (node.type === 'body') this.meshNodes.set(node.meshId || node.id, node);
    const children = node.children || [];
    const li = document.createElement('li');
    li.className = 'tree-item';
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-label', node.name);
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.kind = node.type;
    this.rows.set(node.id, row);
    const disclosure = document.createElement('button');
    disclosure.type = 'button';
    disclosure.className = 'tree-disclosure';
    disclosure.setAttribute('aria-label', `Toggle ${node.name}`);
    disclosure.textContent = children.length ? '▾' : '·';
    if (!children.length) disclosure.classList.add('is-empty');
    row.append(disclosure);
    const symbol = document.createElement('span');
    symbol.className = 'tree-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = node.type === 'body' ? '◇' : node.type === 'part' ? '▣' : '▤';
    row.append(symbol);
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'tree-label';
    label.title = node.name;
    label.textContent = node.name;
    label.addEventListener('click', () => this.selectNode(node));
    row.append(label);
    const leafIds = this.descendants(node);
    if (leafIds.length) {
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'tree-visibility';
      check.checked = true;
      check.disabled = !this.visibilityEnabled;
      check.setAttribute('aria-label', `Show ${node.name}`);
      check.title = this.visibilityEnabled ? 'Show or hide geometry' : 'Individual visibility unavailable';
      check.addEventListener('change', () => {
        const checked = check.checked;
        const visit = target => {
          const entry = this.checkboxes.get(target.id);
          if (entry) {
            entry.checked = checked;
            entry.indeterminate = false;
          }
          if (target.type === 'body') this.onVisibility(target.meshId || target.id, checked);
          for (const child of target.children || []) visit(child);
        };
        visit(node);
        this.updateAncestors();
      });
      this.checkboxes.set(node.id, check);
      row.append(check);
    }
    // Assembly-wide actions on the root, per-occurrence actions on components.
    // Body rows retain their existing visibility checkbox only.
    if ((depth === 0 && this.assemblyHasComponents) || node.type === 'component') {
      const isRoot = depth === 0;
      const positionToggle = this.createExplodeToggle(exploded =>
        isRoot ? this.onToggleAll(exploded) : this.onToggleExplode(node, exploded));
      positionToggle.setAttribute('aria-label', isRoot ?
        'Explode all components' : `Explode component ${node.name}`);
      positionToggle.title = 'Separate component geometry required';
      this.explodeActions.set(node.id, positionToggle);
      row.append(positionToggle);
    }
    li.append(row);
    if (children.length) {
      const nested = document.createElement('ul');
      nested.setAttribute('role', 'group');
      for (const child of children) nested.append(this.createNode(child, depth + 1, node));
      const open = depth === 0;
      nested.hidden = !open;
      li.setAttribute('aria-expanded', String(open));
      disclosure.textContent = open ? '▾' : '▸';
      disclosure.addEventListener('click', () => {
        nested.hidden = !nested.hidden;
        li.setAttribute('aria-expanded', String(!nested.hidden));
        disclosure.textContent = nested.hidden ? '▸' : '▾';
      });
      this.nestedLists.set(node.id, nested);
      this.disclosures.set(node.id, disclosure);
      li.append(nested);
    }
    return li;
  }
}
