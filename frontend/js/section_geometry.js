// NX X/Y/Z sections use the viewer coordinate basis X,Z,-Y.
// All section geometry (clipping, caps, picking, and the manipulator) shares
// the same world-space plane; Move and Explode offsets are applied to bodies.
export const SECTION_AXES = Object.freeze({
  X: { index: 0, sign: 1 },
  Y: { index: 2, sign: -1 },
  Z: { index: 1, sign: 1 },
});
const dot = (a, b) => a.reduce((total, v, i) => total + v*b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const length = a => Math.hypot(...a);
const unit = a => a.map(v => v / (length(a) || 1));
const sum = (a, b) => a.map((v,i)=>v+b[i]);
const scale = (a, n) => a.map(v => v*n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI/180;

export function boundsCorners(bounds, offset = [0,0,0]) {
  const points=[];
  for (const x of [bounds.min[0],bounds.max[0]])
    for (const y of [bounds.min[1],bounds.max[1]])
      for (const z of [bounds.min[2],bounds.max[2]])
        points.push([x+offset[0],y+offset[1],z+offset[2]]);
  return points;
}

function rotate(vector, axis, rad) {
  const c=Math.cos(rad),s=Math.sin(rad);
  return sum(sum(scale(vector,c),scale(cross(axis,vector),s)),scale(axis,dot(axis,vector)*(1-c)));
}

// Orient the section with two local tilt angles. Input angles are in degrees;
// 180 degrees in either direction is supported, so arbitrary directions work.
export function sectionPlane(bounds, axis = 'X', percent = 50, reversed = false, tiltU = 0, tiltV = 0) {
  const direction=SECTION_AXES[axis];
  if(!direction) throw new Error('Unsupported section axis');
  const initial=[0,0,0];
  initial[direction.index]=direction.sign;
  const seed=Math.abs(initial[1])>0.9?[1,0,0]:[0,1,0];
  const u=unit(cross(seed,initial));
  const v=unit(cross(initial,u));
  const radiansU=Number.isFinite(Number(tiltU))?clamp(Number(tiltU),-180,180)*DEG:0;
  const radiansV=Number.isFinite(Number(tiltV))?clamp(Number(tiltV),-180,180)*DEG:0;
  let n=rotate(initial,u,radiansU);
  let basisV=rotate(v,u,radiansU);
  n=unit(rotate(n,basisV,radiansV));
  let basisU=unit(cross(basisV,n));
  basisV=unit(cross(n,basisU));
  const points=boundsCorners(bounds);
  const projections=points.map(p=>dot(n,p));
  const low=Math.min(...projections),high=Math.max(...projections);
  const fraction=clamp(Number(percent)||0,0,100)/100;
  // Preserve the initial slider direction for NX Y (-viewer Z) as well as X/Z.
  const position=direction.sign<0?high-(high-low)*fraction:low+(high-low)*fraction;
  const center=bounds.center||bounds.min.map((x,i)=>(x+bounds.max[i])/2);
  const origin=sum(center,scale(n,position-dot(n,center)));
  const normal=reversed?scale(n,-1):n;
  return {axis,index:direction.index,position:origin[direction.index],origin,normal,
    u:basisU,v:basisV,tiltU:Number(tiltU)||0,tiltV:Number(tiltV)||0,
    span:high-low,range:Math.max(1e-8,high-low), sign:direction.sign,
    equation:[...normal,dot(normal,origin)]};
}

// Arbitrarily rotated planes must be tested using all eight translated bounds
// corners, not the component's original axis-aligned section position.
export function intersectsSection(partBounds, offset, section) {
  if(!section) return false;
  const projections=boundsCorners(partBounds,offset).map(p=>dot(p,section.normal)-section.equation[3]);
  const span=Math.max(...partBounds.size,1);
  const epsilon=span*1e-7;
  return Math.min(...projections)<-epsilon && Math.max(...projections)>epsilon;
}

// World-aligned, two-sided cap quad with arbitrary orientation. Its projected
// bounds surround the entire solid, and the stencil winding preserves holes.
export function capQuad(partBounds, offset, section) {
  const corners=boundsCorners(partBounds,offset);
  const xy=corners.map(p=>{
    const relative=p.map((x,i)=>x-section.origin[i]);
    return [dot(relative,section.u),dot(relative,section.v)];
  });
  const padding=Math.max(...partBounds.size,1)*0.025;
  const minU=Math.min(...xy.map(p=>p[0]))-padding, maxU=Math.max(...xy.map(p=>p[0]))+padding;
  const minV=Math.min(...xy.map(p=>p[1]))-padding, maxV=Math.max(...xy.map(p=>p[1]))+padding;
  const p=(a,b)=>sum(section.origin,sum(scale(section.u,a),scale(section.v,b)));
  const a=p(minU,minV),b=p(maxU,minV),c=p(maxU,maxV),d=p(minU,maxV);
  const positions=new Float32Array([...a,...b,...c,...a,...c,...d]);
  const normal=section.normal.map(v=>-v);
  return {positions,normals:new Float32Array(Array.from({length:6},()=>normal).flat())};
}

// STL vertex buffers often repeat coordinates at face boundaries. Weld by spatial
// key to distinguish watertight solids from open surfaces before applying a cap.
export function isWatertight(positions, indices, scale = 1) {
  if (!positions || !indices || indices.length < 12 || indices.length % 3 !== 0) return false;
  const tolerance = Math.max(scale * 1e-6, 1e-8);
  const vertices = new Array(positions.length / 3);
  for (let i = 0; i < vertices.length; i++) {
    vertices[i] = [0, 1, 2].map(axis => Math.round(positions[i * 3 + axis] / tolerance)).join(',');
  }
  const edges = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [vertices[indices[i]], vertices[indices[i + 1]], vertices[indices[i + 2]]];
    if (new Set(tri).size !== 3) return false;
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  return edges.size > 0 && [...edges.values()].every(count => count === 2);
}
