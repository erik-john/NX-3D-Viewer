import assert from 'node:assert/strict';
import fs from 'node:fs';

const code = fs.readFileSync(new URL('../frontend/js/stl.js', import.meta.url), 'utf8');
const { parseSTL } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(code));
const binary = new ArrayBuffer(84 + 50);
const view = new DataView(binary);
view.setUint32(80, 1, true);
const vertices = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
for (let c = 0; c < 3; c++) {
  for (let k = 0; k < 3; k++) view.setFloat32(84 + 12 + c * 12 + k * 4, vertices[c][k], true);
}
const binaryMeshes = parseSTL(binary);
assert.equal(binaryMeshes.length, 1);
assert.equal(binaryMeshes[0].indices.length, 3);
assert.deepEqual(Array.from(binaryMeshes[0].positions.slice(6, 9)), [0, 0, -1]);

const ascii = `solid NX\nfacet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\nendfacet\nendsolid\n`;
const asciiMeshes = parseSTL(new TextEncoder().encode(ascii).buffer);
assert.equal(asciiMeshes[0].indices.length, 3);

const tooLarge = new ArrayBuffer(84 + 18_001 * 50);
const large = new DataView(tooLarge);
large.setUint32(80, 18_001, true);
const chunks = parseSTL(tooLarge);
assert.equal(chunks.length, 2);
assert.equal(chunks[0].indices.length, 18_000 * 3);
assert.equal(chunks[1].indices.length, 3);
assert.throws(() => parseSTL(new ArrayBuffer(10)));
console.log('STL binary, ASCII, axes, invalid file, and chunking checks passed.');
