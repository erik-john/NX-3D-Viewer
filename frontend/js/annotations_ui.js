import { projectPoint } from './plane_measure.js';

const records = input => Array.isArray(input) ? input.filter(item => item && typeof item === 'object') : [];
const validPoint = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
export const nxToViewer = value => validPoint(value) ? [value[0], value[2], -value[1]] : null;
const annAdd = (a, b) => a.map((x, i) => x + b[i]);
const annSubtract = (a, b) => a.map((x, i) => x - b[i]);
const annDot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const annScale = (a, value) => a.map(x => x * value);
const nativeLines = item => Array.isArray(item?.presentation?.lines) ? item.presentation.lines.filter(
  line => validPoint(line?.start) && validPoint(line?.end)).slice(0, 300) : [];
const nativeArrows = item => Array.isArray(item?.presentation?.arrows) ? item.presentation.arrows.filter(
  arrow => validPoint(arrow?.point)).slice(0, 100) : [];

// A reference-point guide is used only when the actual NX annotation
// display components are unavailable.
export function dimensionGuide(record, offset = [0, 0, 0]) {
  const shape = record?.dimension;
  const start = nxToViewer(shape?.start), end = nxToViewer(shape?.end);
  const origin = nxToViewer(shape?.origin);
  if (!start || !end) return null;
  const direction = annSubtract(end, start);
  const length = Math.hypot(...direction);
  if (!Number.isFinite(length) || length < 1e-7) return null;
  const axis = annScale(direction, 1 / length);
  const first = origin ? annAdd(origin, annScale(axis, annDot(annSubtract(start, origin), axis))) : start;
  const second = origin ? annAdd(origin, annScale(axis, annDot(annSubtract(end, origin), axis))) : end;
  if (Math.hypot(...annSubtract(start, first)) > 20 * length ||
      Math.hypot(...annSubtract(end, second)) > 20 * length) return null;
  return {start: annAdd(start, offset), end: annAdd(end, offset),
    first: annAdd(first, offset), second: annAdd(second, offset)};
}

const svgNamespace = 'http://www.w3.org/2000/svg';
const svgNode = name => document.createElementNS(svgNamespace, name);
const setLine = (node, a, b) => {
  node.setAttribute('x1', a[0]); node.setAttribute('y1', a[1]);
  node.setAttribute('x2', b[0]); node.setAttribute('y2', b[1]);
};
function arrow(node, tip, other) {
  const dx = other[0] - tip[0], dy = other[1] - tip[1];
  const size = Math.hypot(dx, dy);
  if (size < 2) { node.setAttribute('points', ''); return; }
  const ux = dx / size, uy = dy / size;
  const base = [tip[0] + ux * 9, tip[1] + uy * 9];
  node.setAttribute('points', `${tip.join(',')} ${base[0] - uy * 3.3},${base[1] + ux * 3.3} ${base[0] + uy * 3.3},${base[1] - ux * 3.3}`);
}

// A component is a logical meshId, possibly split into several STL buffers.
// Never infer a particular component for an ambiguous multi-body annotation.
// With one logical body (or the whole model retained at a common offset),
// no component association needs to be guessed to preserve the presentation.
export function sectionAnnotationRetained(item, source, geometry, retained) {
  const byId = new Map();
  for (const part of geometry) {
    if (!byId.has(part.meshId)) byId.set(part.meshId, []);
    byId.get(part.meshId).push(part);
  }
  if (!byId.size) return false;
  const refs = [...new Set([...(Array.isArray(source?.meshIds) ? source.meshIds : []),
    source?.meshId, item?.meshId].filter(Boolean))];
  const isRetained = id => byId.get(id)?.some(p => p.visible && retained.has(p));
  const sameOffset = ids => {
    const parts = ids.flatMap(id => byId.get(id) || []);
    const offset = parts[0]?.offset;
    return !!offset && parts.every(p => p.offset.every((v,i) => Math.abs(v-offset[i]) < 1e-7));
  };
  const all = [...byId.keys()];
  // Known missing or hidden references must not be ignored, except for the
  // combined-mesh fallback (root), which has no individual body IDs.
  const combined = all.length === 1 && all[0] === 'root';
  if (!combined && refs.some(id => !isRetained(id))) return false;
  if (all.length === 1) return isRetained(all[0]) && sameOffset(all);
  // Explicit native references, or legacy viewer mesh associations, are used
  // when available. Explicitly incomplete NX associations are not trusted.
  if (refs.length && source?.associationVerified !== false) return sameOffset(refs);
  return all.every(isRetained) && sameOffset(all);
}

export class AnnotationDisplay {
  constructor(viewer, layer, onSelect) {
    this.viewer = viewer;
    this.layer = layer;
    this.onSelect = onSelect;
    this.data = {pmi: [], characteristics: []};
    this.visibility = {pmi: false, characteristics: false};
    this.selectedId = null;
    this.elements = [];
    this.linework = [];
  }
  clear() {
    this.data = {pmi: [], characteristics: []};
    this.visibility = {pmi: false, characteristics: false};
    this.selectedId = null;
    this.elements = [];
    this.linework = [];
    this.layer.replaceChildren();
    this.svg = null;
  }
  addDimension(item, source = item, key = 'pmi') {
    const native = nativeLines(source);
    const actual = native.length > 0;
    if (!actual && !dimensionGuide(source)) return;
    if (!this.svg) {
      this.svg = svgNode('svg');
      this.svg.classList.add('annotation-dimensions');
      this.svg.setAttribute('aria-label', 'NX PMI dimension lines');
      this.layer.append(this.svg);
    }
    const group = svgNode('g');
    group.classList.add('annotation-dimension');
    group.classList.add(`annotation-dimension-${key}`);
    group.dataset.annotationId = item.id;
    group.dataset.geometrySource = actual ? 'nx-components' : 'nx-associativity';
    const lines = Array.from({length: actual ? native.length : 3}, () => svgNode('line'));
    const arrows = Array.from({length: actual ? nativeArrows(source).length : 2}, () => svgNode('polygon'));
    group.append(...lines, ...arrows);
    group.addEventListener('click', () => this.onSelect(item.id));
    this.svg.append(group);
    this.linework.push({item, source, key, group, lines, arrows, actual, native});
  }
  setData(data) {
    this.clear();
    this.data = {pmi: records(data?.pmi), characteristics: records(data?.characteristics)};
    this.visibility.pmi = false;
    this.visibility.characteristics = false;
    const pmiById = new Map(this.data.pmi.map(item => [item.id, item]));
    for (const [key, list] of Object.entries(this.data)) {
      for (const item of list) {
        const linkedPmi = key === 'characteristics' ? pmiById.get(item.pmiId) : null;
        if (key === 'pmi') this.addDimension(item);
        else if (linkedPmi) this.addDimension(item, linkedPmi, key);
        const location = (linkedPmi && validPoint(linkedPmi.position) ? linkedPmi.position : null) ||
          (validPoint(item.position) ? item.position : null) ||
          (key === 'pmi' ? item.presentation?.texts?.find(entry => validPoint(entry.position))?.position : null) ||
          (linkedPmi ? linkedPmi.presentation?.texts?.find(entry => validPoint(entry.position))?.position : null);
        if (!validPoint(location)) continue;
        const label = document.createElement('button');
        label.type = 'button';
        label.className = `annotation-marker annotation-marker-${key}`;
        label.dataset.annotationId = item.id;
        label.textContent = key === 'pmi' ? (item.text || item.name || 'PMI') : (item.name || 'Characteristic');
        label.title = `Select ${key === 'pmi' ? 'PMI' : 'Characteristic'}: ${item.name || item.text || ''}`;
        label.addEventListener('click', () => this.onSelect(item.id));
        this.layer.append(label);
        this.elements.push({key, item, location, label});
      }
    }
    this.update();
  }
  setMode(tab) {
    this.visibility.pmi = tab === 'pmi';
    this.visibility.characteristics = tab === 'characteristics';
    this.update();
  }
  setSelected(id) {
    this.selectedId = id;
    this.update();
  }
  setVisible(key, visible) {
    if (!(key in this.visibility)) return;
    this.visibility[key] = !!visible;
    this.update();
  }
  position(item, value) {
    const local = nxToViewer(value);
    const mesh = this.viewer.geometry.find(entry => entry.meshId === item.meshId);
    return {mesh, xyz: local && mesh ? annAdd(local, mesh.offset) : local};
  }
  hasDisplayedAnnotations() {
    return this.elements.some(e => this.visibility[e.key] && !e.label.hidden) ||
      this.linework.some(e => this.visibility[e.key] && e.group.getAttribute('visibility') === 'visible');
  }
  // Freeze the displayed presentation before export changes mesh visibility.
  // NX presentation graphics may extend across the cut plane; they are not
  // model geometry and must not be clipped or require dimension endpoints.
  captureSectionOverlay(retained, rect) {
    this.update();
    const candidates = new Map();
    const get = e => {
      const id = `${e.key}:${e.item.id}`;
      if (!candidates.has(id)) candidates.set(id, {key:e.key, item:e.item, lines:[], arrows:[]});
      return candidates.get(id);
    };
    const number = (node, key) => {
      const value = node.getAttribute(key);
      return value === null || value === '' ? NaN : Number(value);
    };
    for (const e of this.linework) {
      if (!this.visibility[e.key] || e.group.getAttribute('visibility') !== 'visible') continue;
      const record = get(e);
      for (const node of e.lines) {
        if (node.getAttribute('visibility') === 'hidden') continue;
        const line = ['x1','y1','x2','y2'].map(key => number(node,key));
        if (line.every(Number.isFinite)) record.lines.push(line);
      }
      for (const node of e.arrows) {
        if (node.getAttribute('visibility') === 'hidden') continue;
        const raw = node.getAttribute('points')?.trim();
        const points = raw ? raw.split(/[\s,]+/).map(Number) : [];
        if (points.length === 6 && points.every(Number.isFinite)) record.arrows.push(points);
      }
    }
    for (const e of this.elements) {
      if (!this.visibility[e.key] || e.label.hidden) continue;
      const x = parseFloat(e.label.style.left), y = parseFloat(e.label.style.top);
      if (Number.isFinite(x) && Number.isFinite(y)) get(e).label = {x,y,text:e.label.textContent};
    }
    const overlay = {width:rect.width, height:rect.height, displayed:0, omitted:0, records:[]};
    for (const record of candidates.values()) {
      if (!record.label && !record.lines.length && !record.arrows.length) continue;
      overlay.displayed++;
      const source = record.key === 'characteristics' ?
        this.data.pmi.find(p => p.id === record.item.pmiId) : record.item;
      if (sectionAnnotationRetained(record.item, source, this.viewer.geometry, retained)) overlay.records.push(record);
      else overlay.omitted++;
    }
    this.sectionOmitted = overlay.omitted;
    this.sectionIncluded = overlay.records.length;
    return overlay;
  }
  paintSection(ctx, width, height, overlay) {
    if (!overlay?.records.length) return;
    ctx.save();
    try {
      ctx.scale(width / overlay.width, height / overlay.height);
      ctx.strokeStyle = ctx.fillStyle = '#253947'; ctx.lineWidth = 1.45;
      for (const e of overlay.records) {
        for (const [x1,y1,x2,y2] of e.lines) {
          ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
        }
        for (const [x1,y1,x2,y2,x3,y3] of e.arrows) {
          ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3);
          ctx.closePath(); ctx.fill();
        }
      }
      for (const e of overlay.records) {
        if (!e.label) continue;
        const {x,y,text} = e.label;
        const chr = e.key === 'characteristics';
        ctx.font = `700 ${chr?12:15}px Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        const baseline = y - (chr?45:11);
        if (chr) {
          const w = ctx.measureText(text).width + 14;
          ctx.fillStyle = '#e6f7f2'; ctx.fillRect(x-w/2,baseline-17,w,21);
          ctx.strokeStyle = '#0c8d72'; ctx.strokeRect(x-w/2,baseline-17,w,21);
        }
        ctx.fillStyle = chr?'#055d62':'#263b48'; ctx.fillText(text,x,baseline);
      }
    } finally {ctx.restore();}
  }
  update() {
    const rect = this.viewer.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const matrix = this.viewer.cameraMatrix(rect.width, rect.height).matrix;
    if (this.svg) this.svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    for (const {key, item, location, label} of this.elements) {
      const source = key === 'characteristics' ? this.data.pmi.find(pmi => pmi.id === item.pmiId) : null;
      const {mesh, xyz} = this.position({...item, meshId: item.meshId || source?.meshId}, location);
      const xy = xyz ? projectPoint(matrix, xyz, rect.width, rect.height) : null;
      const shown = this.visibility[key] && xy && xy[0] > -50 && xy[0] < rect.width + 50 &&
        xy[1] > -50 && xy[1] < rect.height + 50 && (!mesh || mesh.visible);
      label.hidden = !shown;
      label.classList.toggle('is-selected', item.id === this.selectedId);
      if (shown) {
        label.style.left = `${xy[0]}px`;
        label.style.top = `${xy[1]}px`;
      }
    }
    for (const {item, source, key, group, lines, arrows, actual, native} of this.linework) {
      const mesh = this.viewer.geometry.find(entry => entry.meshId === (item.meshId || source.meshId));
      const enabled = this.visibility[key] && (!mesh || mesh.visible);
      group.classList.toggle('is-selected', item.id === this.selectedId);
      if (actual) {
        let anyVisible = false;
        const offset = mesh?.offset || [0, 0, 0];
        const segments = native.map((segment, index) => {
          const ends = [segment.start, segment.end].map(value => {
            const xyz = nxToViewer(value);
            return xyz && projectPoint(matrix, annAdd(xyz, offset), rect.width, rect.height);
          });
          const shown = enabled && ends.every(Boolean);
          lines[index].setAttribute('visibility', shown ? 'visible' : 'hidden');
          if (shown) { setLine(lines[index], ends[0], ends[1]); anyVisible = true; }
          return shown ? ends : null;
        }).filter(Boolean);
        // Arrows are placed at NX's recorded tips and oriented along their
        // nearest visible dimension/leader segment, without changing the tip.
        nativeArrows(source).forEach((itemArrow, index) => {
          const xyz = nxToViewer(itemArrow.point);
          const tip = xyz && projectPoint(matrix, annAdd(xyz, offset), rect.width, rect.height);
          let choice = null, distance = Infinity;
          for (const [first, second] of segments) {
            for (const [near, far] of [[first, second], [second, first]]) {
              const gap = Math.hypot(tip?.[0] - near[0], tip?.[1] - near[1]);
              if (gap < distance) { distance = gap; choice = far; }
            }
          }
          const shown = enabled && tip && choice && distance <= 14;
          arrows[index].setAttribute('visibility', shown ? 'visible' : 'hidden');
          if (shown) { arrow(arrows[index], tip, choice); anyVisible = true; }
        });
        group.setAttribute('visibility', enabled && anyVisible ? 'visible' : 'hidden');
        continue;
      }
      const guide = dimensionGuide(source, mesh?.offset);
      const xy = guide && [guide.start, guide.end, guide.first, guide.second]
        .map(point => projectPoint(matrix, point, rect.width, rect.height));
      const shown = enabled && xy && xy.every(Boolean);
      group.setAttribute('visibility', shown ? 'visible' : 'hidden');
      if (!shown) continue;
      setLine(lines[0], xy[0], xy[2]);
      setLine(lines[1], xy[1], xy[3]);
      setLine(lines[2], xy[2], xy[3]);
      arrow(arrows[0], xy[2], xy[3]);
      arrow(arrows[1], xy[3], xy[2]);
    }
  }
}
