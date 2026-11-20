// Display-only translation gizmo. STL coordinates were converted from NX
// (X,Y,Z) to the viewer's (X,Z,-Y); these vectors follow the NX axes.
export const MOVE_AXES = Object.freeze({
  X: [1, 0, 0],
  Y: [0, 0, -1],
  Z: [0, 1, 0],
});

export function projectWorld(point, matrix, width, height) {
  const [x, y, z] = point;
  const w = matrix[3]*x + matrix[7]*y + matrix[11]*z + matrix[15];
  if (!Number.isFinite(w) || w <= 1e-7) return null;
  const px = (matrix[0]*x + matrix[4]*y + matrix[8]*z + matrix[12]) / w;
  const py = (matrix[1]*x + matrix[5]*y + matrix[9]*z + matrix[13]) / w;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  return { x: (px*.5+.5)*width, y: (.5-py*.5)*height, w };
}

// Calibrate each screen-space axis to a known NX-model-space displacement.
// When an axis points almost at the camera it cannot be dragged reliably;
// hide that arrow until the viewer rotates to a less ambiguous angle.
export function projectedAxis(center, axis, matrix, width, height) {
  const origin = projectWorld(center, matrix, width, height);
  if (!origin) return null;
  const calibration = Math.max(1e-5, origin.w * 2 * Math.tan(Math.PI/8) * 60 / height);
  const test = projectWorld(center.map((v, i) => v + axis[i]*calibration), matrix, width, height);
  if (!test) return null;
  const dx = test.x - origin.x, dy = test.y - origin.y;
  const pixels = Math.hypot(dx,dy);
  if (pixels < 12) return null;
  const ux = dx/pixels, uy = dy/pixels;
  return { origin, ux, uy, calibration, pixels,
    endX: origin.x + ux*70, endY: origin.y + uy*70 };
}

export function dragAxisDistance(startX, startY, x, y, projection) {
  return ((x-startX)*projection.ux + (y-startY)*projection.uy) *
    (projection.calibration / projection.pixels);
}

function element(tag, cssClass) {
  const node = document.createElementNS('http://www.w3.org/2000/svg',tag);
  if (cssClass) node.setAttribute('class',cssClass);
  return node;
}

export class MoveGizmo {
  constructor(svg, viewer, { onStart, onDrag, onEnd }) {
    this.svg = svg;
    this.viewer = viewer;
    this.onStart = onStart;
    this.onDrag = onDrag;
    this.onEnd = onEnd;
    this.meshIds = [];
    this.active = false;
    this.drag = null;
    this.axes = new Map();
    this.origin = element('circle','move-axis-origin');
    this.origin.setAttribute('r','5');
    this.svg.append(this.origin);
    const colors = { X:'#cb5045', Y:'#319466', Z:'#377dd0' };
    for (const name of Object.keys(MOVE_AXES)) {
      const group = element('g',`move-axis move-axis-${name.toLowerCase()}`);
      const line = element('line','move-axis-line');
      line.setAttribute('stroke',colors[name]);
      const head = element('polygon','move-axis-head');
      head.setAttribute('fill',colors[name]);
      const label = element('text','move-axis-label');
      label.textContent=name;
      label.setAttribute('fill',colors[name]);
      label.setAttribute('text-anchor','middle');
      label.setAttribute('dominant-baseline','central');
      const hit = element('line','move-axis-hit');
      hit.setAttribute('tabindex','0');
      hit.setAttribute('role','button');
      hit.setAttribute('aria-label',`Move along NX ${name} axis; arrow keys to nudge`);
      const tooltip = element('title');
      tooltip.textContent=`Drag along NX ${name} (or focus and use arrow keys)`;
      hit.append(tooltip);
      group.append(line,head,label,hit);
      this.svg.append(group);
      this.axes.set(name, { group,line,head,label,hit,projection:null });
      hit.addEventListener('pointerdown', event=>this.beginDrag(event,name));
      hit.addEventListener('keydown',event=>this.nudge(event,name));
    }
    // The base circle is behind arrows; keep origin visible in their center.
    this.svg.append(this.origin);
    this.svg.addEventListener('pointermove',event=>this.moveDrag(event));
    this.svg.addEventListener('pointerup',event=>this.endDrag(event));
    this.svg.addEventListener('pointercancel',event=>this.endDrag(event));
    this.svg.addEventListener('lostpointercapture',event=>this.endDrag(event));
  }

  setTarget(ids, active) {
    this.meshIds = ids || [];
    this.active = !!active;
    if (!this.active) this.drag = null;
    this.viewer.requestRender();
  }

  update() {
    const viewer = this.viewer;
    const ids = new Set(this.meshIds);
    const bounds = this.active && viewer.boundsForParts(viewer.geometry.filter(p=>
      p.visible && ids.has(p.meshId)));
    if (!bounds) { this.svg.setAttribute('hidden',''); return; }
    const rect=viewer.canvas.getBoundingClientRect();
    if (rect.width<1 || rect.height<1) { this.svg.setAttribute('hidden',''); return; }
    const matrix=viewer.cameraMatrix(rect.width,rect.height).matrix;
    const center=bounds.center;
    const origin=projectWorld(center,matrix,rect.width,rect.height);
    if (!origin || origin.x < -100 || origin.x > rect.width+100 ||
        origin.y < -100 || origin.y > rect.height+100) {
      this.svg.setAttribute('hidden',''); return;
    }
    this.svg.removeAttribute('hidden');
    this.svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
    this.origin.setAttribute('cx',origin.x);
    this.origin.setAttribute('cy',origin.y);
    for (const [name,parts] of this.axes) {
      const projection=projectedAxis(center,MOVE_AXES[name],matrix,rect.width,rect.height);
      parts.projection=projection;
      // Preserve the currently dragged handle if it becomes nearly parallel
      // to the view as a component moves; its initial projection is frozen.
      const geometry = this.drag?.axis === name ? this.drag.projection : projection;
      if (!geometry) { parts.group.style.display='none'; continue; }
      parts.group.style.display='';
      const {ux,uy} = geometry;
      const endX=origin.x+ux*70, endY=origin.y+uy*70;
      const startX=origin.x+ux*7, startY=origin.y+uy*7;
      const lineEndX=endX-ux*7, lineEndY=endY-uy*7;
      for (const line of [parts.line,parts.hit]) {
        line.setAttribute('x1',startX); line.setAttribute('y1',startY);
        line.setAttribute('x2',lineEndX); line.setAttribute('y2',lineEndY);
      }
      const px=-uy*6.5, py=ux*6.5;
      parts.head.setAttribute('points',`${endX},${endY} ${endX-ux*14+px},${endY-uy*14+py} ${endX-ux*14-px},${endY-uy*14-py}`);
      parts.label.setAttribute('x',endX+ux*14);
      parts.label.setAttribute('y',endY+uy*14);
    }
  }

  beginDrag(event,name) {
    if (!this.active || event.button !== 0 || this.drag) return;
    const projection = this.axes.get(name)?.projection;
    if (!projection) return;
    const snapshot=this.onStart?.();
    if (!snapshot) return;
    event.preventDefault();
    event.stopPropagation();
    this.drag={ pointerId:event.pointerId, axis:name,
      startX:event.clientX,startY:event.clientY, projection,snapshot };
    this.svg.setPointerCapture?.(event.pointerId);
  }

  moveDrag(event) {
    if (!this.drag || event.pointerId!==this.drag.pointerId) return;
    event.preventDefault();
    const drag=this.drag;
    const distance=dragAxisDistance(drag.startX,drag.startY,
      event.clientX,event.clientY,drag.projection);
    if (Number.isFinite(distance)) this.onDrag?.(drag.snapshot,drag.axis,distance);
  }

  endDrag(event) {
    if (!this.drag || event.pointerId!==this.drag.pointerId) return;
    this.drag=null;
    if (this.svg.hasPointerCapture?.(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
    this.onEnd?.();
    this.viewer.requestRender();
  }

  nudge(event,name) {
    if (!this.active || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    const snapshot=this.onStart?.();
    if (!snapshot) return;
    event.preventDefault();
    const direction = ['ArrowUp','ArrowRight'].includes(event.key) ? 1 : -1;
    const extent=Math.max(...this.viewer.bounds.size,1);
    const step=extent*.01*(event.shiftKey?10:1);
    this.onDrag?.(snapshot,name,direction*step);
    this.onEnd?.();
  }
}
