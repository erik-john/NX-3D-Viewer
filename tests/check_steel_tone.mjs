import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../frontend/js/viewer.js', import.meta.url), 'utf8');
const stl = readFileSync(new URL('../frontend/js/stl.js', import.meta.url), 'utf8');
assert.match(src, /vec3 steel = pow\(clamp\(linearSteel, 0\.0, 1\.0\), vec3\(1\.0 \/ 2\.2\)\) \* 0\.96;/);
assert.match(stl, /color: '#dee1e3'/);
assert.match(src, /vec3 linearSteel = baseLinear \* diffuse/);
console.log('MS16 slight steel brightness adjustment verified.');
