import { evaluatePlanes, evaluateCircularCenters, projectPoint } from './plane_measure.js';

const muAdd=(a,b)=>a.map((v,i)=>v+b[i]);
const muScale=(a,k)=>a.map(v=>v*k);
const muCross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const muUnit=a=>{const n=Math.hypot(...a);return n>1e-12 ? muScale(a,1/n):null;};
const offsetSurface=face=>({...face,point:muAdd(face.localPoint,face.part.offset),
  center:face.localCenter ? muAdd(face.localCenter,face.part.offset) : null});

// A single round surface reports diameter. Two round surfaces with parallel
// axes report center spacing; two planar faces report distance or angle.
export class MeasurementUI {
  constructor(viewer, elements) {
    this.viewer=viewer;
    this.el=elements;
    this.faces=[];
    this.active=false;
    this.units='model units';
    this.lastMessage='';
    elements.clear.addEventListener('click',()=>this.clear());
    elements.fit.addEventListener('click',()=>this.fitSelected());
    this.update();
  }
  fitSelected() {
    if(!this.active || !this.faces.length || this.faces.some(face=>!face.part.visible)) return false;
    const pair=this.faces.length===2 ? this.faces.map(offsetSurface) : [];
    const result=pair.length===2 ?
      (pair.every(face=>face.radius && face.axis && face.center) ?
        evaluateCircularCenters(...pair) : evaluatePlanes(...pair)) : null;
    const changed=this.viewer.fitMeasureFaces(this.faces,result ? [result.from,result.to] : []);
    if(changed)this.update();
    return changed;
  }
  setModelUnits(units) { this.units=['mm','in'].includes(units) ? units : 'model units'; this.update(); }
  setActive(active) {
    this.active=!!active;
    this.clear();
    this.el.panel.hidden=!this.active;
    this.el.overlay.setAttribute('hidden','');
    this.update();
  }
  clear() {
    this.faces=[];
    this.cachedPair=null;
    this.lastMessage='';
    this.viewer.setMeasureFaces([]);
    this.update();
  }
  select(face) {
    if(!this.active) return;
    if(!face) {
      this.lastMessage='Choose a planar face or a recognizable circular/cylindrical surface.';
      this.update();return;
    }
    if(this.faces.length===2) this.faces=[];
    const previous=this.faces[0];
    if(previous && previous.part===face.part && previous.triangleIds?.has(face.triangleIndex)) {
      // Clicking the same physical patch is still one selected surface.
      this.lastMessage='';this.update();return;
    }
    face.localPoint=face.point.map((v,i)=>v-face.part.offset[i]);
    if(face.center) face.localCenter=face.center.map((v,i)=>v-face.part.offset[i]);
    this.faces.push(face);
    this.cachedPair=null;
    this.lastMessage='';
    this.viewer.setMeasureFaces(this.faces);
    this.update();
  }
  statusText() {
    if(!this.faces.length) return 'Measurement: choose a measurable surface';
    if(this.faces.length===1) return this.faces[0].radius ?
      'Diameter measured · Select another circular/cylindrical feature for center distance' :
      'First planar face selected · Choose second face';
    if(this.faces.every(f=>f.radius)) return 'Center-distance measurement · Parallel center axes required';
    return this.faces.every(f=>f.kind!=='cylinder') ?
      'Plane measurement complete · Mesh-based approximation' :
      'Two surfaces selected · Plane distance/angle requires two planar faces';
  }
  update() {
    const {panel,summary,detail,overlay,line,pointA,pointB,arc,clear,fit}=this.el;
    if(!this.active) {panel.hidden=true;overlay.setAttribute('hidden','');return;}
    panel.hidden=false;
    const count=this.faces.length;
    clear.disabled=count===0;
    fit.disabled=count===0 || this.faces.some(f=>!f.part.visible);
    panel.dataset.kind='';
    if(this.faces.some(f=>!f.part.visible)) {
      overlay.setAttribute('hidden','');
      summary.textContent='Measurement paused';
      detail.textContent='A selected surface is hidden. Show its component or clear the measurement.';
      return;
    }
    if(!count) {
      overlay.setAttribute('hidden','');
      summary.textContent='Distance, Angle & Diameter';
      detail.textContent=this.lastMessage || '1 round surface: diameter · 2 parallel-axis round surfaces: center distance · 2 planes: distance/angle.';
      return;
    }
    // One circular planar face or curved cylinder: diameter without a second click.
    if(count===1 && this.faces[0].radius) {
      const face=offsetSurface(this.faces[0]);
      summary.textContent=`⌀  ${(face.radius*2).toFixed(3)} ${this.units}`;
      detail.textContent=face.kind==='cylinder' ?
        '1 cylindrical surface · mesh-fitted diameter (approximate)' :
        '1 circular planar face · mesh-fitted diameter (approximate)';
      panel.dataset.kind='diameter';
      this.drawDiameter(face);
      return;
    }
    if(count===1) {
      overlay.setAttribute('hidden','');
      summary.textContent='Plane 1 selected';
      detail.textContent=this.lastMessage || '1 planar face selected · choose a second surface.';
      return;
    }
    const faces=this.faces.map(offsetSurface);
    const roundPair=faces.every(face=>face.radius && face.axis && face.center);
    // Avoid rerunning nearest-triangle comparisons on camera-only frames.
    const pairKey=faces.map(f=>`${f.meshId}:${f.triangleIndex}:${f.part.offset.join(',')}`).join('|');
    let result;
    if(this.cachedPair?.key===pairKey)result=this.cachedPair.result;
    else {
      result=roundPair ? evaluateCircularCenters(...faces) : evaluatePlanes(...faces);
      this.cachedPair={key:pairKey,result};
    }
    if(!result) {
      overlay.setAttribute('hidden','');
      summary.textContent='2 surfaces selected';
      detail.textContent=roundPair ?
        'Center distance needs two parallel circle/cylinder axes. Clear to retry.' :
        'This pair is unsupported. Choose two planar faces or two round surfaces with parallel axes.';
      return;
    }
    const centerDistance=result.kind==='center_distance';
    const distance=result.kind==='distance' || centerDistance;
    if(centerDistance) {
      summary.textContent=`⊙ ↔  ${result.value.toFixed(3)} ${this.units}`;
      detail.textContent=result.method==='circle_centers' ?
        '2 circular faces · center-to-center 3D distance (STL approximate)' :
        '2 parallel cylindrical/round axes · shortest centerline spacing (STL approximate)';
    } else if(distance) {
      summary.textContent=`∥  ${result.angle.toFixed(2)}° · ${result.value.toFixed(3)} ${this.units}`;
      detail.textContent='2 parallel planar faces · normal angle & plane separation (STL approximate)';
    } else {
      const perpendicular=result.relation==='perpendicular';
      const symbol=perpendicular?'⊥':'∠';
      summary.textContent=`${symbol}  ${result.value.toFixed(2)}° · ↔ ${result.gap.toFixed(3)} ${this.units}`;
      const type=result.gapMethod==='finite_patch' ?
        'nearest selected-face clearance' : 'picked-point distance';
      detail.textContent=`2 ${perpendicular?'perpendicular':'nonparallel'} planar faces · angle + ${type} (STL approx; not gear pitch distance)`;
    }
    panel.dataset.kind=result.kind;
    const rect=this.viewer.canvas.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0) {overlay.setAttribute('hidden','');return;}
    const matrix=this.viewer.cameraMatrix(rect.width,rect.height).matrix;
    const from=projectPoint(matrix,result.from,rect.width,rect.height);
    const to=projectPoint(matrix,result.to,rect.width,rect.height);
    if(!from||!to) {overlay.setAttribute('hidden','');return;}
    overlay.removeAttribute('hidden');
    overlay.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
    overlay.dataset.kind=result.kind;
    line.setAttribute('x1',String(from[0]));line.setAttribute('y1',String(from[1]));
    line.setAttribute('x2',String(to[0]));line.setAttribute('y2',String(to[1]));
    pointA.setAttribute('cx',String(from[0]));pointA.setAttribute('cy',String(from[1]));
    pointB.setAttribute('cx',String(to[0]));pointB.setAttribute('cy',String(to[1]));
    if(distance) {arc.setAttribute('hidden','');}
    else {
      arc.removeAttribute('hidden');
      const dx=to[0]-from[0],dy=to[1]-from[1],len=Math.hypot(dx,dy)||1;
      const bend=Math.min(55,Math.max(14,len*0.25));
      const mid=[(to[0]+from[0])/2 - dy/len*bend,(to[1]+from[1])/2 + dx/len*bend];
      arc.setAttribute('d',`M ${from[0]} ${from[1]} Q ${mid[0]} ${mid[1]} ${to[0]} ${to[1]}`);
    }
  }
  drawDiameter(face) {
    const {overlay,line,pointA,pointB,arc}=this.el;
    const rect=this.viewer.canvas.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0||!face.center||!face.axis) {
      overlay.setAttribute('hidden','');return;
    }
    const axis=muUnit(face.axis);
    const u=axis && muUnit(muCross(axis,Math.abs(axis[1])<0.85?[0,1,0]:[1,0,0]));
    const v=u&&muCross(axis,u);
    if(!u||!v) {overlay.setAttribute('hidden','');return;}
    const matrix=this.viewer.cameraMatrix(rect.width,rect.height).matrix;
    const project=world=>projectPoint(matrix,world,rect.width,rect.height);
    const perimeter=[];
    for(let i=0;i<=48;i++) {
      const angle=i*Math.PI*2/48;
      const p=muAdd(face.center,muAdd(muScale(u,face.radius*Math.cos(angle)),muScale(v,face.radius*Math.sin(angle))));
      const pixel=project(p);
      if(!pixel) {overlay.setAttribute('hidden','');return;}
      perimeter.push(pixel);
    }
    const option=[u,v].map(direction=>{
      const a=project(muAdd(face.center,muScale(direction,face.radius)));
      const b=project(muAdd(face.center,muScale(direction,-face.radius)));
      return a&&b ? {a,b,size:Math.hypot(a[0]-b[0],a[1]-b[1])} : null;
    }).filter(Boolean).sort((a,b)=>b.size-a.size)[0];
    if(!option) {overlay.setAttribute('hidden','');return;}
    overlay.removeAttribute('hidden');
    overlay.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
    overlay.dataset.kind='diameter';
    arc.removeAttribute('hidden');
    arc.setAttribute('d',perimeter.map((p,i)=>`${i?'L':'M'} ${p[0]} ${p[1]}`).join(' ')+' Z');
    line.setAttribute('x1',String(option.a[0]));line.setAttribute('y1',String(option.a[1]));
    line.setAttribute('x2',String(option.b[0]));line.setAttribute('y2',String(option.b[1]));
    pointA.setAttribute('cx',String(option.a[0]));pointA.setAttribute('cy',String(option.a[1]));
    pointB.setAttribute('cx',String(option.b[0]));pointB.setAttribute('cy',String(option.b[1]));
  }
}
