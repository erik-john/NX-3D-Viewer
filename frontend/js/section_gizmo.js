import { projectWorld, projectedAxis, dragAxisDistance } from './component_move.js';

const SVG = 'http://www.w3.org/2000/svg';
const add = (tag, css) => {
  const node = document.createElementNS(SVG, tag);
  if (css) node.setAttribute('class', css);
  return node;
};
const plus = (a,b)=>a.map((v,i)=>v+b[i]);
const scale = (a,s)=>a.map(v=>v*s);
const clamp = (a,b,c)=>Math.min(c,Math.max(b,a));

// An overlay for the active section plane, independent of the model's datum
// triad and component Move gizmo. All control points are projected from the
// current plane and camera every frame; none are stored in screen coordinates.
export class SectionGizmo {
  constructor(svg, viewer, onChange) {
    this.svg=svg;
    this.viewer=viewer;
    this.onChange=onChange;
    this.drag=null;
    this.projection=null;
    this.planeOutline=add('path','section-gizmo-plane');
    this.svg.append(this.planeOutline);
    this.origin=add('circle','section-gizmo-center');
    this.normal=add('line','section-gizmo-normal');
    this.tip=add('polygon','section-gizmo-tip');
    this.normalHit=add('line','section-gizmo-normal-hit');
    this.normalHit.setAttribute('tabindex','0');
    this.normalHit.setAttribute('role','slider');
    this.normalHit.setAttribute('aria-label','Move section plane along its normal');
    this.normalHit.setAttribute('aria-valuemin','0');
    this.normalHit.setAttribute('aria-valuemax','100');
    const normalTitle=add('title');
    normalTitle.textContent='Drag to move the section plane; arrow keys to nudge';
    this.normalHit.append(normalTitle);
    this.localAxes={};
    for(const [name,color] of [['U','#377dd0'],['V','#2f9d71']]) {
      const group=add('g','section-gizmo-local-axis');
      const line=add('line','section-gizmo-local-line');
      line.setAttribute('stroke',color);
      const tip=add('polygon','section-gizmo-local-tip');
      tip.setAttribute('fill',color);
      const label=add('text','section-gizmo-local-label');
      label.setAttribute('fill',color);label.textContent=name;
      group.append(line,tip,label);
      this.svg.append(group);
      this.localAxes[name]={group,line,tip,label};
    }
    this.svg.append(this.normal,this.tip,this.normalHit);
    this.rings={};
    for (const name of ['U','V']) {
      const path=add('path',`section-gizmo-ring section-gizmo-ring-${name.toLowerCase()}`);
      const hit=add('path','section-gizmo-ring-hit');
      const title=add('title');
      title.textContent=`Drag to tilt section about its ${name} axis; arrow keys to rotate`;
      hit.append(title);
      hit.setAttribute('role','slider');
      hit.setAttribute('tabindex','0');
      hit.setAttribute('aria-label',`Rotate section around ${name} axis`);
      hit.setAttribute('aria-valuemin','-180');
      hit.setAttribute('aria-valuemax','180');
      this.svg.append(path,hit);
      this.rings[name]={path,hit};
      hit.addEventListener('pointerdown',e=>this.start(e,name));
      hit.addEventListener('keydown',e=>this.key(e,name));
    }
    this.svg.append(this.origin);
    this.origin.setAttribute('r','5');
    this.normalHit.addEventListener('pointerdown',e=>this.start(e,'translate'));
    this.normalHit.addEventListener('keydown',e=>this.key(e,'translate'));
    this.svg.addEventListener('pointermove',e=>this.move(e));
    this.svg.addEventListener('pointerup',e=>this.finish(e));
    this.svg.addEventListener('pointercancel',e=>this.finish(e));
    this.svg.addEventListener('lostpointercapture',e=>this.finish(e));
  }

  setVisible(active) { this.active=!!active; if(!this.active)this.drag=null; this.viewer.requestRender(); }
  update() {
    const plane=this.active && this.viewer.getSectionPlane();
    const rect=this.viewer.canvas.getBoundingClientRect();
    if(!plane || rect.width<1 || rect.height<1) {this.svg.setAttribute('hidden','');return;}
    const matrix=this.viewer.cameraMatrix(rect.width,rect.height).matrix;
    const origin=projectWorld(plane.origin,matrix,rect.width,rect.height);
    if(!origin || origin.x < -100 || origin.x>rect.width+100 ||
      origin.y < -100 || origin.y>rect.height+100) {this.svg.setAttribute('hidden','');return;}
    this.svg.removeAttribute('hidden');
    this.svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
    const extent=Math.max(...this.viewer.bounds.size,1)*0.56;
    const outline=[];
    for(const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      const point=plus(plane.origin,plus(scale(plane.u,u*extent),scale(plane.v,v*extent)));
      const projectedPoint=projectWorld(point,matrix,rect.width,rect.height);
      if(projectedPoint) outline.push(`${outline.length?'L':'M'}${projectedPoint.x.toFixed(2)} ${projectedPoint.y.toFixed(2)}`);
    }
    this.planeOutline.setAttribute('d',outline.length===4?outline.join(' ')+' Z':'');
    this.origin.setAttribute('cx',origin.x);
    this.origin.setAttribute('cy',origin.y);
    this.normalHit.setAttribute('aria-valuenow',String(this.viewer.section.percent));
    for(const [name,axisParts] of Object.entries(this.localAxes)) {
      const vector=name==='U'?plane.u:plane.v;
      const projected=projectedAxis(plane.origin,vector,matrix,rect.width,rect.height);
      if(!projected){axisParts.group.style.display='none';continue;}
      axisParts.group.style.display='';
      const {ux,uy}=projected;
      const x=origin.x+ux*39,y=origin.y+uy*39;
      axisParts.line.setAttribute('x1',origin.x+ux*7);
      axisParts.line.setAttribute('y1',origin.y+uy*7);
      axisParts.line.setAttribute('x2',x);
      axisParts.line.setAttribute('y2',y);
      axisParts.tip.setAttribute('points',`${x+ux*7},${y+uy*7} ${x-ux*6-uy*4},${y-uy*6+ux*4} ${x-ux*6+uy*4},${y-uy*6-ux*4}`);
      axisParts.label.setAttribute('x',x+ux*15);
      axisParts.label.setAttribute('y',y+uy*15);
    }
    const projected=projectedAxis(plane.origin,plane.normal,matrix,rect.width,rect.height);
    const arrow=this.drag?.handle==='translate'?this.drag.projection:projected;
    this.projection=projected;
    for (const shape of [this.normal,this.tip,this.normalHit]) shape.style.display=arrow?'':'none';
    if(arrow) {
      const {ux,uy}=arrow;
      const x1=origin.x+ux*8,y1=origin.y+uy*8;
      const x2=origin.x+ux*61,y2=origin.y+uy*61;
      for(const line of [this.normal,this.normalHit]) {
        line.setAttribute('x1',x1);line.setAttribute('y1',y1);
        line.setAttribute('x2',x2);line.setAttribute('y2',y2);
      }
      const ox=-uy*6,oy=ux*6;
      this.tip.setAttribute('points',`${origin.x+ux*72},${origin.y+uy*72} ${x2+ox},${y2+oy} ${x2-ox},${y2-oy}`);
    }
    // Draw the local rotation rings as actual 3D circles projected into the
    // viewport. They must rotate with the cutting plane, not the monitor.
    const radius=origin.w*2*Math.tan(Math.PI/8)*42/Math.max(rect.height,1);
    for(const [name,ring] of Object.entries(this.rings)) {
      const a=name==='U'?plane.v:plane.u;
      const b=plane.normal;
      const samples=[];
      for(let i=0;i<=72;i++) {
        const angle=i*2*Math.PI/72;
        const pt=plus(plane.origin,plus(scale(a,Math.cos(angle)*radius),scale(b,Math.sin(angle)*radius)));
        const projectedPoint=projectWorld(pt,matrix,rect.width,rect.height);
        if(projectedPoint) samples.push(`${i===0?'M':'L'}${projectedPoint.x.toFixed(2)} ${projectedPoint.y.toFixed(2)}`);
      }
      const d=samples.length>=60?samples.join(' ')+' Z':'';
      ring.path.setAttribute('d',d);ring.hit.setAttribute('d',d);
      ring.hit.setAttribute('aria-valuenow',String(this.viewer.section[name==='U'?'tiltU':'tiltV']||0));
    }
  }
  start(e,handle) {
    if(!this.active || this.drag || e.button!==0)return;
    e.preventDefault();e.stopPropagation();
    const section=this.viewer.section;
    if(handle==='translate'&&!this.projection)return;
    this.drag={handle,id:e.pointerId,startX:e.clientX,startY:e.clientY,
      percent:section.percent||0,tiltU:section.tiltU||0,tiltV:section.tiltV||0,
      projection:this.projection,plane:this.viewer.getSectionPlane()};
    this.svg.setPointerCapture(e.pointerId);
  }
  move(e) {
    if(!this.drag || this.drag.id!==e.pointerId)return;
    e.preventDefault();e.stopPropagation();
    const drag=this.drag;
    if(drag.handle==='translate') {
      const dist=dragAxisDistance(drag.startX,drag.startY,e.clientX,e.clientY,drag.projection);
      const sign=(this.viewer.section.reversed?-1:1)*(drag.plane.sign<0?-1:1);
      this.onChange({percent:clamp(drag.percent+100*dist*sign/drag.plane.range,0,100)});
    } else {
      // A fixed initial gesture prevents compounding rotation on every frame.
      const delta=(e.clientX-drag.startX + (drag.startY-e.clientY)*0.55)*0.55;
      const key=drag.handle==='U'?'tiltU':'tiltV';
      this.onChange({[key]:clamp(drag[key]+delta,-180,180)});
    }
  }
  finish(e) {
    if(!this.drag || this.drag.id!==e.pointerId)return;
    this.drag=null;
    if(this.svg.hasPointerCapture(e.pointerId))this.svg.releasePointerCapture(e.pointerId);
  }
  key(e,handle) {
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();
    const delta=e.key==='Home'?0:['ArrowUp','ArrowRight'].includes(e.key)?1:-1;
    const key=handle==='translate'?'percent':handle==='U'?'tiltU':'tiltV';
    const current=Number(this.viewer.section[key])||0;
    const min=handle==='translate'?0:-180,max=handle==='translate'?100:180;
    this.onChange({[key]:e.key==='Home'?(handle==='translate'?50:0):clamp(current+delta*(e.shiftKey?10:1),min,max)});
  }
}
