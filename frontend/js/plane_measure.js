// Planar distance/angle and high-confidence circular/cylindrical diameter on STL.
// All positions here use the viewer's X,Z,-Y basis, preserving model units.
const pmDot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const scale = (a, k) => a.map(v => v*k);
const pmCross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length = a => Math.hypot(...a);
const normal = a => { const mag=length(a); return mag>1e-14 ? scale(a,1/mag) : null; };
const pmClamp = (n,lo,hi) => Math.min(hi,Math.max(lo,n));

// Double-sided Möller–Trumbore intersection. Returns distance along ray or null.
export function hitTriangle(origin, direction, a, b, c) {
  const edge1=sub(b,a), edge2=sub(c,a);
  const p=pmCross(direction,edge2), det=pmDot(edge1,p);
  if (Math.abs(det)<1e-12) return null;
  const inverse=1/det, delta=sub(origin,a), u=pmDot(delta,p)*inverse;
  if (u < -1e-7 || u > 1+1e-7) return null;
  const q=pmCross(delta,edge1), v=pmDot(direction,q)*inverse;
  if (v < -1e-7 || u+v > 1+1e-7) return null;
  const t=pmDot(edge2,q)*inverse;
  return t>1e-7 ? t : null;
}

export function rayForViewport(eye, target, x, y, width, height) {
  const outward=normal(sub(eye,target));
  if (!outward || width<1 || height<1) return null;
  const right=normal(pmCross([0,1,0],outward)) || [1,0,0];
  const up=pmCross(outward,right);
  const tan=Math.tan(Math.PI/8);
  const direction=normal(add(scale(outward,-1),
    add(scale(right,(2*x/width-1)*tan*width/height),scale(up,(1-2*y/height)*tan))));
  return direction ? {origin:eye,direction} : null;
}

function triangle(part, index) {
  const indices=part.sourceIndices, positions=part.sourcePositions;
  return [0,1,2].map(corner => {
    const at=indices[3*index+corner]*3;
    return [positions[at],positions[at+1],positions[at+2]];
  });
}

// Pick the front surface of the GPU-picked component, accounting for both
// Move and Explode offsets. Restricting to that mesh ID keeps clicks practical.
export function hitMeshGroup(parts, meshId, ray) {
  let closest=null, minDistance=Infinity;
  for (const part of parts) {
    if (!part.visible || part.meshId!==meshId || !part.sourceIndices) continue;
    const localOrigin=sub(ray.origin,part.offset);
    const indexCount=part.sourceIndices.length/3;
    for (let i=0;i<indexCount;i++) {
      const [a,b,c]=triangle(part,i);
      const t=hitTriangle(localOrigin,ray.direction,a,b,c);
      if (t!==null && t<minDistance) {
        minDistance=t;
        closest={part,triangleIndex:i,point:add(ray.origin,scale(ray.direction,t))};
      }
    }
  }
  return closest;
}

// Construct adjacency only for the clicked STL chunk; never run this costly
// operation per frame. Two coplanar triangles sharing an edge form a selectable
// planar patch. A cylinder's individual flat tessellation facets are rejected.
function patchIndex(part) {
  if (part.measureIndex) return part.measureIndex;
  const count=part.sourceIndices.length/3;
  const span=Math.max(...part.bounds.size,1e-6);
  const weld=Math.max(span*1e-7,1e-8);
  const vertices=new Array(part.sourcePositions.length/3);
  for (let i=0;i<vertices.length;i++) {
    const p=part.sourcePositions, k=i*3;
    vertices[i]=`${Math.round(p[k]/weld)},${Math.round(p[k+1]/weld)},${Math.round(p[k+2]/weld)}`;
  }
  const links=Array.from({length:count},()=>[]), edges=new Map();
  const normals=new Array(count), areas=new Float64Array(count);
  for (let i=0;i<count;i++) {
    const [a,b,c]=triangle(part,i), n=pmCross(sub(b,a),sub(c,a));
    areas[i]=length(n)*0.5;
    normals[i]=normal(n);
    const ids=Array.from(part.sourceIndices.subarray(i*3,i*3+3),v=>vertices[v]);
    for(let e=0;e<3;e++) {
      const left=ids[e], right=ids[(e+1)%3];
      if(left===right) continue;
      const key=left<right ? `${left}|${right}` : `${right}|${left}`;
      if (!edges.has(key)) edges.set(key,[]);
      edges.get(key).push(i);
    }
  }
  for(const group of edges.values()) {
    if(group.length>12) continue; // Reject pathological duplicate STL edges.
    for(let i=0;i<group.length;i++) for(let j=i+1;j<group.length;j++) {
      links[group[i]].push(group[j]);links[group[j]].push(group[i]);
    }
  }
  part.measureIndex={links,normals,areas,tolerance:Math.max(span*1e-5,1e-7)};
  return part.measureIndex;
}

export function planarPatch(hit) {
  if(!hit) return null;
  const {part,triangleIndex,point}=hit;
  const {links,normals,areas,tolerance}=patchIndex(part);
  const referenceNormal=normals[triangleIndex];
  if(!referenceNormal || areas[triangleIndex]<1e-12) return null;
  const referencePoint=triangle(part,triangleIndex)[0];
  const visited=new Set([triangleIndex]), queue=[triangleIndex];
  let area=0, total=0;
  for(let head=0;head<queue.length;head++) {
    const i=queue[head]; area+=areas[i]; total++;
    for(const neighbor of links[i]) {
      if(visited.has(neighbor) || !normals[neighbor] ||
        Math.abs(pmDot(referenceNormal,normals[neighbor]))<0.99999) continue;
      const points=triangle(part,neighbor);
      if(points.some(p=>Math.abs(pmDot(referenceNormal,sub(p,referencePoint)))>tolerance)) continue;
      visited.add(neighbor); queue.push(neighbor);
    }
  }
  // A lone triangle on a curved tessellation is not an identifiable CAD plane.
  if(total<2) return null;
  const positions=new Float32Array(queue.length*9);
  for(let i=0;i<queue.length;i++) {
    const points=triangle(part,queue[i]);
    positions.set(points.flat(),i*9);
  }
  const selection={kind:'plane',meshId:part.meshId,normal:referenceNormal,point,part,
    triangleIndex,triangleIds:new Set(queue),faceCount:total,area,positions};
  return identifyCircularPlane(selection) || selection;
}


// Fit a 2D circle by solving its normal equations. Reject ill-conditioned
// geometry rather than guessing a radius from a bounding box.
function solve3(matrix, values) {
  const a=matrix.map((row,i)=>[...row,values[i]]);
  for(let c=0;c<3;c++) {
    let pivot=c;
    for(let r=c+1;r<3;r++) if(Math.abs(a[r][c])>Math.abs(a[pivot][c])) pivot=r;
    if(Math.abs(a[pivot][c])<1e-12) return null;
    [a[c],a[pivot]]=[a[pivot],a[c]];
    const divisor=a[c][c];for(let j=c;j<4;j++) a[c][j]/=divisor;
    for(let r=0;r<3;r++) if(r!==c) {
      const factor=a[r][c];for(let j=c;j<4;j++) a[r][j]-=factor*a[c][j];
    }
  }
  return a.map(row=>row[3]);
}
function planeBasis(axis) {
  const seed=Math.abs(axis[1])<0.85 ? [0,1,0] : [1,0,0];
  const u=normal(pmCross(axis,seed));
  return u ? {u,v:pmCross(axis,u)} : null;
}
function fitCircle(points) {
  // Center coordinates before squaring, to keep large NX placements stable.
  if(points.length<3) return null;
  const avg=[points.reduce((s,p)=>s+p[0],0)/points.length,
    points.reduce((s,p)=>s+p[1],0)/points.length];
  const pts=points.map(p=>[p[0]-avg[0],p[1]-avg[1]]);
  let matrix=[[0,0,0],[0,0,0],[0,0,0]],rhs=[0,0,0];
  for(const [x,y] of pts) {
    const row=[x,y,1], z=-(x*x+y*y);
    for(let i=0;i<3;i++) {
      rhs[i]+=row[i]*z;
      for(let j=0;j<3;j++) matrix[i][j]+=row[i]*row[j];
    }
  }
  const terms=solve3(matrix,rhs);
  if(!terms) return null;
  const cx=-terms[0]/2,cy=-terms[1]/2;
  const radii=pts.map(p=>Math.hypot(p[0]-cx,p[1]-cy));
  const radius=radii.reduce((s,r)=>s+r,0)/radii.length;
  if(!Number.isFinite(radius)||radius<=1e-7) return null;
  const error=Math.sqrt(radii.reduce((s,r)=>s+(r-radius)**2,0)/radii.length)/radius;
  const maxError=radii.reduce((worst,r)=>Math.max(worst,Math.abs(r-radius)/radius),0);
  const bins=new Set();
  for(const p of pts) {
    const theta=Math.atan2(p[1]-cy,p[0]-cx);
    bins.add(Math.floor((theta+Math.PI)/(Math.PI*2)*12)%12);
  }
  return {center:[cx+avg[0],cy+avg[1]],radius,error,maxError,coverage:bins.size};
}
function boundaryVertices(selection) {
  const {part,triangleIds}=selection;
  const edges=new Map(), weld=Math.max(Math.max(...part.bounds.size)*1e-7,1e-8);
  const key=p=>p.map(x=>Math.round(x/weld)).join(',');
  for(const id of triangleIds) {
    const pts=triangle(part,id);
    for(let i=0;i<3;i++) {
      const a=pts[i],b=pts[(i+1)%3],ka=key(a),kb=key(b);
      const k=ka<kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if(!edges.has(k)) edges.set(k,{a,b,count:0});
      edges.get(k).count++;
    }
  }
  const vertices=new Map();
  for(const edge of edges.values()) if(edge.count===1) {
    vertices.set(key(edge.a),edge.a);vertices.set(key(edge.b),edge.b);
  }
  return [...vertices.values()];
}
function identifyCircularPlane(selection) {
  const points=boundaryVertices(selection);
  if(points.length<8) return null;
  const basis=planeBasis(selection.normal);
  if(!basis) return null;
  const projected=points.map(p=>[pmDot(p,basis.u),pmDot(p,basis.v)]);
  const fitted=fitCircle(projected);
  if(!fitted||fitted.coverage<9||fitted.error>0.012||fitted.maxError>0.032) return null;
  // The plane coordinate is fixed by any vertex; the fit supplies its center.
  const offset=selection.part.offset || [0,0,0];
  const localPoint=sub(selection.point,offset);
  const depth=pmDot(localPoint,selection.normal);
  const localCenter=add(add(scale(basis.u,fitted.center[0]),scale(basis.v,fitted.center[1])),
    scale(selection.normal,depth));
  return {...selection,kind:'circle',radius:fitted.radius,
    center:add(localCenter,offset),axis:selection.normal};
}

// Tessellated cylinders can have partial arcs, including 180-degree rounded
// ends. Accept a connected, high-confidence circular sweep with at least three
// different side strips, while rejecting a flat face or a two-strip chamfer.
export function cylindricalPatch(hit) {
  if(!hit) return null;
  const {part,triangleIndex,point}=hit;
  const {links,normals,tolerance}=patchIndex(part);
  const ref=normals[triangleIndex];if(!ref) return null;
  // Walk a few coplanar facets first: STL often splits each side quad in two.
  const flatSet=new Set([triangleIndex]), flatQueue=[triangleIndex];
  for(let k=0;k<flatQueue.length&&k<24;k++) for(const i of links[flatQueue[k]]) {
    if(flatSet.has(i)||!normals[i]||Math.abs(pmDot(ref,normals[i]))<0.99995) continue;
    flatSet.add(i);flatQueue.push(i);
  }
  const candidates=new Set();
  for(const id of flatQueue) for(const neighbor of links[id]) {
    if(flatSet.has(neighbor)||!normals[neighbor]) continue;
    const alignment=Math.abs(pmDot(ref,normals[neighbor]));
    if(alignment>=0.35&&alignment<=0.99995) candidates.add(neighbor);
  }
  const span=Math.hypot(...part.bounds.size);
  for(const adjacent of candidates) {
    const axis=normal(pmCross(ref,normals[adjacent]));
    if(!axis) continue;
    const basis=planeBasis(axis);if(!basis) continue;
    const seeds=[...new Set([...flatQueue,adjacent])];
    const vertexMap=new Map();
    const coordKey=p=>p.map(v=>v.toPrecision(10)).join(',');
    for(const id of seeds) for(const p of triangle(part,id)) vertexMap.set(coordKey(p),p);
    const projected=[...vertexMap.values()].map(p=>[pmDot(p,basis.u),pmDot(p,basis.v)]);
    const fit=fitCircle(projected);
    if(!fit||fit.radius>span*4||fit.error>0.006||fit.maxError>0.015) continue;
    const center=add(scale(basis.u,fit.center[0]),scale(basis.v,fit.center[1]));
    const radius=fit.radius, allowed=Math.max(radius*0.012,tolerance*2);
    const isSide=id=>{
      const n=normals[id];if(!n||Math.abs(pmDot(n,axis))>0.12) return false;
      const points=triangle(part,id);
      if(points.some(p=>Math.abs(length(sub(p,add(center,scale(axis,pmDot(p,axis)))))-radius)>allowed)) return false;
      const mid=scale(points.reduce((sum,p)=>add(sum,p),[0,0,0]),1/3);
      const radial=sub(mid,add(center,scale(axis,pmDot(mid,axis))));
      return Math.abs(pmDot(n,normal(radial)||[0,0,0]))>0.88;
    };
    if(!isSide(triangleIndex)||!isSide(adjacent)) continue;
    const visited=new Set([triangleIndex]),queue=[triangleIndex];
    for(let cursor=0;cursor<queue.length;cursor++) for(const neighbor of links[queue[cursor]]) {
      if(visited.has(neighbor)||!isSide(neighbor)) continue;
      visited.add(neighbor);queue.push(neighbor);
    }
    if(queue.length<6) continue;
    const uniqueNormals=[];
    for(const id of queue) {
      const n=normals[id];
      if(n && !uniqueNormals.some(existing=>Math.abs(pmDot(n,existing))>0.9995))
        uniqueNormals.push(n);
    }
    if(uniqueNormals.length<3) continue;
    const circlePoints=new Map();
    for(const id of queue) for(const p of triangle(part,id)) circlePoints.set(coordKey(p),p);
    const coords=[...circlePoints.values()].map(p=>[pmDot(p,basis.u),pmDot(p,basis.v)]);
    const refined=fitCircle(coords);
    if(!refined||refined.coverage<3||refined.error>0.009||refined.maxError>0.016||
      Math.abs(refined.radius-radius)>radius*0.012) continue;
    // Reject short fillets and arbitrary sloped patches. A meaningful arc
    // must span at least 80 degrees around a common cylinder axis.
    const angles=coords.map(p=>Math.atan2(p[1]-refined.center[1],p[0]-refined.center[0]))
      .sort((a,b)=>a-b);
    let largestGap=0;
    for(let i=0;i<angles.length;i++) {
      const next=i+1<angles.length ? angles[i+1] : angles[0]+2*Math.PI;
      largestGap=Math.max(largestGap,next-angles[i]);
    }
    if(2*Math.PI-largestGap < 80*Math.PI/180) continue;
    const corrected=add(scale(basis.u,refined.center[0]),scale(basis.v,refined.center[1]));
    const offset=part.offset || [0,0,0];
    const localPoint=sub(point,offset);
    const circleCenter=add(add(corrected,scale(axis,pmDot(localPoint,axis))),offset);
    const positions=new Float32Array(queue.length*9);
    for(let i=0;i<queue.length;i++) positions.set(triangle(part,queue[i]).flat(),i*9);
    return {kind:'cylinder',method:'mesh_fit',meshId:part.meshId,part,point,triangleIndex,
      triangleIds:visited,axis,center:circleCenter,radius:refined.radius,
      faceCount:queue.length,positions};
  }
  return null;
}

// NX analytical cylinder data describes partial arcs even if their STL mesh
// contains only a few flat strips. Associate a clicked facet with a unique
// CAD face using its bounding box, radius, axis and neighboring triangles.
const nxVector = values => [values[0],values[2],-values[1]];
function nxBounds(values) {
  if(!Array.isArray(values)||values.length!==6) return null;
  const result={min:[values[0],values[2],-values[4]],
    max:[values[3],values[5],-values[1]]};
  return [...result.min,...result.max].every(Number.isFinite) ? result : null;
}
function analyticalCylinderPatch(hit) {
  if(!hit||!Array.isArray(hit.part.analyticalFaces)||!hit.part.analyticalFaces.length) return null;
  const {part,triangleIndex,point}=hit;
  const {links,normals}=patchIndex(part);
  const localPoint=sub(point,part.offset || [0,0,0]);
  const matches=[];
  for(const face of part.analyticalFaces) {
    if(face?.type!=='cylinder'||!(face.radius>0)||!Array.isArray(face.point)||
      !Array.isArray(face.axis)) continue;
    const radius=Number(face.radius), axisPoint=nxVector(face.point),axis=normal(nxVector(face.axis));
    const bounds=nxBounds(face.bounds);
    if(!axis||!bounds||!Number.isFinite(radius)) continue;
    const allowance=Math.max(radius*0.015,Math.max(...part.bounds.size)*1e-5,1e-5);
    const inside=p=>p.every((v,i)=>v>=bounds.min[i]-allowance&&v<=bounds.max[i]+allowance);
    if(!inside(localPoint)) continue;
    const matchingTriangle=id=>{
      const n=normals[id];if(!n||Math.abs(pmDot(n,axis))>0.17) return false;
      const pts=triangle(part,id);
      if(!pts.every(inside)) return false;
      const midpoint=scale(pts.reduce((a,b)=>add(a,b),[0,0,0]),1/3);
      const radial=sub(sub(midpoint,axisPoint),scale(axis,pmDot(sub(midpoint,axisPoint),axis)));
      const radialUnit=normal(radial);
      if(!radialUnit||Math.abs(pmDot(radialUnit,n))<0.89) return false;
      const edgeLength=(a,b)=>{
        const edge=sub(a,b);
        return length(sub(edge,scale(axis,pmDot(edge,axis))));
      };
      const edges=[edgeLength(pts[0],pts[1]),edgeLength(pts[1],pts[2]),
        edgeLength(pts[2],pts[0])];
      // Facet chords lie inside the CAD cylinder; tolerate chordal sagitta,
      // not arbitrary displacement from the analytical radius.
      const chord=Math.min(Math.max(...edges),2*radius);
      const sagitta=radius-Math.sqrt(Math.max(0,radius*radius-chord*chord/4));
      const gap=Math.abs(length(radial)-radius);
      return gap<=Math.max(allowance,1.6*sagitta);
    };
    if(!matchingTriangle(triangleIndex)) continue;
    const visited=new Set([triangleIndex]), queue=[triangleIndex];
    for(let i=0;i<queue.length;i++) for(const neighbor of links[queue[i]]) {
      if(visited.has(neighbor)||!matchingTriangle(neighbor)) continue;
      visited.add(neighbor);queue.push(neighbor);
    }
    if(queue.length<4) continue;
    // Reject a single flat tangent strip; a curved face should contain
    // distinct radial directions across its faceted neighborhood.
    const reference=normals[triangleIndex];
    if(!queue.some(id=>Math.abs(pmDot(reference,normals[id]))<0.9998)) continue;
    const localCenter=add(axisPoint,scale(axis,pmDot(sub(localPoint,axisPoint),axis)));
    const positions=new Float32Array(queue.length*9);
    for(let i=0;i<queue.length;i++) positions.set(triangle(part,queue[i]).flat(),i*9);
    matches.push({kind:'cylinder',method:'nx_cad',meshId:part.meshId,part,point,triangleIndex,
      triangleIds:visited,axis,center:add(localCenter,part.offset || [0,0,0]),radius,
      faceCount:queue.length,positions});
  }
  // Ambiguous overlapping analytical surfaces should not claim an exact value.
  return matches.length===1 ? matches[0] : null;
}

// Check cylinders before planar patches; each flat STL side facet is itself
// coplanar and would otherwise be mistaken for a legitimate CAD plane.
export function measurementSurface(hit) {
  if(!hit) return null;
  return analyticalCylinderPatch(hit) || cylindricalPatch(hit) || planarPatch(hit);
}

// Two circular/cylindrical features are comparable only when their center axes
// are parallel (including opposite direction). Circle centers are points, so
// the result is their true 3D distance. A cylinder has infinitely many axis
// points; for one or two cylinders use the shortest perpendicular distance
// between their parallel axes, independent of which spot on a curved wall was hit.
export function evaluateCircularCenters(first, second) {
  if (!first || !second || !['circle','cylinder'].includes(first.kind) ||
    !['circle','cylinder'].includes(second.kind) || !first.center || !second.center ||
    !first.axis || !second.axis) return null;
  const n1=normal(first.axis),n2=normal(second.axis);
  if (!n1 || !n2 || Math.abs(pmDot(n1,n2))<Math.cos(0.5*Math.PI/180)) return null;
  const delta=sub(second.center,first.center);
  const containsCylinder=first.kind==='cylinder' || second.kind==='cylinder';
  // Cylindrical features have no privileged longitudinal center.
  const displacement=containsCylinder ? sub(delta,scale(n1,pmDot(delta,n1))) : delta;
  return {kind:'center_distance',value:length(displacement),
    from:first.center,to:add(first.center,displacement),
    method:containsCylinder ? 'axis_spacing' : 'circle_centers'};
}

// Finite STL planar patches can have a measurable closest-point clearance even
// though their mathematically infinite supporting planes intersect. This is NOT
// the pitch-circle clearance of two gears; NX B-rep/pitch geometry is required
// to derive an exact gear pitch point. Select a bounded neighborhood around the
// clicked facets so dense plates don't cause quadratic work in every frame.
function measurementTriangles(face, limit=128) {
  const positions=face.positions;
  if (!positions || positions.length<9) return [];
  const delta=face.part?.offset || [0,0,0];
  const triangles=[];
  for(let i=0;i+8<positions.length;i+=9) {
    const points=[0,3,6].map(k=>add([positions[i+k],positions[i+k+1],positions[i+k+2]],delta));
    const center=scale(add(add(points[0],points[1]),points[2]),1/3);
    triangles.push({points,sort:length(sub(center,face.point))});
  }
  if(triangles.length>limit) triangles.sort((a,b)=>a.sort-b.sort);
  return triangles.slice(0,limit).map(t=>t.points);
}
function closestOnTriangle(p,a,b,c) {
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a);
  const d1=pmDot(ab,ap),d2=pmDot(ac,ap);
  if(d1<=0&&d2<=0) return a;
  const bp=sub(p,b),d3=pmDot(ab,bp),d4=pmDot(ac,bp);
  if(d3>=0&&d4<=d3) return b;
  const vc=d1*d4-d3*d2;
  if(vc<=0&&d1>=0&&d3<=0) return add(a,scale(ab,d1/(d1-d3)));
  const cp=sub(p,c),d5=pmDot(ab,cp),d6=pmDot(ac,cp);
  if(d6>=0&&d5<=d6) return c;
  const vb=d5*d2-d1*d6;
  if(vb<=0&&d2>=0&&d6<=0) return add(a,scale(ac,d2/(d2-d6)));
  const va=d3*d6-d5*d4;
  if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0) {
    const w=(d4-d3)/((d4-d3)+(d5-d6));
    return add(b,scale(sub(c,b),w));
  }
  const denom=va+vb+vc;
  if(Math.abs(denom)<1e-20) return a;
  const v=vb/denom,w=vc/denom;
  return add(a,add(scale(ab,v),scale(ac,w)));
}
function closestOnSegments(p0,p1,q0,q1) {
  const u=sub(p1,p0),v=sub(q1,q0),w=sub(p0,q0);
  const a=pmDot(u,u),b=pmDot(u,v),c=pmDot(v,v);
  const d=pmDot(u,w),e=pmDot(v,w);
  if(a<1e-20||c<1e-20) return null;
  const D=a*c-b*b;
  let sN=D,tN=D,sD=D,tD=D;
  if(D<1e-18) {sN=0;sD=1;tN=e;tD=c;}
  else {
    sN=b*e-c*d;tN=a*e-b*d;
    if(sN<0) {sN=0;tN=e;tD=c;}
    else if(sN>sD) {sN=sD;tN=e+b;tD=c;}
  }
  if(tN<0) {tN=0;if(-d<0)sN=0;else if(-d>a)sN=sD;else{sN=-d;sD=a;}}
  else if(tN>tD) {tN=tD;if(-d+b<0)sN=0;else if(-d+b>a)sN=sD;else{sN=-d+b;sD=a;}}
  const s=Math.abs(sN)<1e-18?0:sN/sD,t=Math.abs(tN)<1e-18?0:tN/tD;
  return [add(p0,scale(u,s)),add(q0,scale(v,t))];
}
function segmentHitsTriangle(start,end,tri) {
  const direction=sub(end,start);
  const a=tri[0],b=tri[1],c=tri[2];
  const edge1=sub(b,a),edge2=sub(c,a);
  const p=pmCross(direction,edge2),det=pmDot(edge1,p);
  if(Math.abs(det)<1e-12)return null;
  const inv=1/det,delta=sub(start,a),u=pmDot(delta,p)*inv;
  if(u< -1e-7||u>1+1e-7)return null;
  const q=pmCross(delta,edge1),v=pmDot(direction,q)*inv;
  if(v< -1e-7||u+v>1+1e-7)return null;
  const t=pmDot(edge2,q)*inv;
  return t>=-1e-7&&t<=1+1e-7?add(start,scale(direction,pmClamp(t,0,1))):null;
}
export function nearestPlanarPatchGap(first,second) {
  const left=measurementTriangles(first),right=measurementTriangles(second);
  if(!left.length||!right.length)return null;
  let best=Infinity,from=null,to=null;
  const update=(a,b)=>{
    const d=pmDot(sub(a,b),sub(a,b));
    if(d<best) {best=d;from=a;to=b;}
  };
  for(const a of left)for(const b of right) {
    for(let k=0;k<3;k++) {
      update(a[k],closestOnTriangle(a[k],...b));
      update(closestOnTriangle(b[k],...a),b[k]);
    }
    for(let i=0;i<3;i++)for(let j=0;j<3;j++) {
      const edgeA=[a[i],a[(i+1)%3]],edgeB=[b[j],b[(j+1)%3]];
      const intersection=segmentHitsTriangle(...edgeA,b);
      if(intersection)return {value:0,from:intersection,to:intersection,method:'finite_patch'};
      const reverse=segmentHitsTriangle(...edgeB,a);
      if(reverse)return {value:0,from:reverse,to:reverse,method:'finite_patch'};
      const pair=closestOnSegments(...edgeA,...edgeB);
      if(pair)update(...pair);
    }
    if(best<1e-16)return {value:0,from,to,method:'finite_patch'};
  }
  return {value:Math.sqrt(best),from,to,method:'finite_patch'};
}

// Infinite-plane separation is different from shortest distance between two
// finite faces. Preserve the oriented 0/180 normal angle as a parallel status,
// but use the acute unoriented angle for nonparallel planes.
export function evaluatePlanes(first, second) {
  if(!first || !second || first.kind==='cylinder' || second.kind==='cylinder') return null;
  const orientation=pmClamp(pmDot(first.normal,second.normal),-1,1);
  const orientedAngle=Math.acos(orientation)*180/Math.PI;
  const similarity=Math.abs(orientation);
  const acute=Math.acos(pmClamp(similarity,0,1))*180/Math.PI;
  if(acute<=0.5) {
    const signed=pmDot(first.normal,sub(second.point,first.point));
    return {kind:'distance',value:Math.abs(signed),relation:'parallel',
      angle:orientedAngle<=90?0:180,
      from:sub(second.point,scale(first.normal,signed)),to:second.point};
  }
  const perpendicular=Math.abs(acute-90)<=0.5;
  const gap=nearestPlanarPatchGap(first,second);
  // When there is no reliable finite patch (e.g. an older mesh fixture),
  // use explicitly identified click points, never a fictitious plane gap.
  const from=gap?.from || first.point,to=gap?.to || second.point;
  return {kind:'angle',value:acute,angle:acute,relation:perpendicular?'perpendicular':'oblique',
    gap:gap ? gap.value : length(sub(second.point,first.point)),
    gapMethod:gap ? 'finite_patch' : 'picked_points',from,to};
}

export function projectPoint(matrix, point, width, height) {
  const [x,y,z]=point;
  const w=matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15];
  if(w<=0) return null;
  const px=(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])/w;
  const py=(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])/w;
  if(!Number.isFinite(px)||!Number.isFinite(py)) return null;
  return [(px*.5+.5)*width,(.5-py*.5)*height];
}
