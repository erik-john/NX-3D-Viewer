import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../frontend/js/stl.js', import.meta.url), 'utf8');
const { parseSTL } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));
const renderer = fs.readFileSync(new URL('../frontend/js/viewer.js', import.meta.url), 'utf8');

function binarySTL(faces) {
  const bytes = new ArrayBuffer(84 + faces.length * 50);
  const dv = new DataView(bytes);
  dv.setUint32(80, faces.length, true);
  faces.forEach((tri, fi) => tri.forEach((pos, vi) => pos.forEach((value, ci) =>
    dv.setFloat32(84 + fi * 50 + 12 + vi * 12 + ci * 4, value, true))));
  return bytes;
}

const first = [[0,0,0],[1,0,0],[0,1,0]];
const angled = [[0,0,0],[1,0,0],[0,Math.cos(Math.PI / 12), Math.sin(Math.PI / 12)]];
const smooth = parseSTL(binarySTL([first,angled]))[0];
assert.equal(smooth.indices.length,6);
assert.equal(smooth.creasePositions.length, 0, 'a gently curved seam should not show a hard edge');
const a = smooth.normals.slice(0,3), b = smooth.normals.slice(9,12);
assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]) < 0.01, 'coincident curved vertices must get the same normal');
assert.ok(Math.abs(a[0]) < 0.3 && Math.abs(a[2]) < 0.3, 'surface normals remain nearly aligned with the original face');

const orthogonal = [[0,1,0],[0,0,0],[0,0,1]];
const hard = parseSTL(binarySTL([first,orthogonal]))[0];
assert.equal(hard.creasePositions.length, 6, 'shared 90-degree corner should produce one dark crease line');
const ha = hard.normals.slice(0,3), hb = hard.normals.slice(12,15);
assert.ok(Math.abs(ha[0]*hb[0]+ha[1]*hb[1]+ha[2]*hb[2]) < 0.2, 'hard normals must not blend across the corner');
assert.match(renderer, /gl\.enable\(gl\.POLYGON_OFFSET_FILL\)/);
assert.match(renderer, /creaseCount/);
assert.match(renderer, /float silhouette = pow/);
assert.doesNotMatch(renderer, /fresnel\s*\*/i);
assert.match(renderer, /gl_FragColor = vec4\(surface, surfaceAlpha\)/);

console.log('Satin steel normals, 90-degree creases, opaque default with alpha-capable shading, and CAD silhouette passed.');
