const MAX_TRIANGLES = 1_000_000;
const TRIANGLES_PER_MESH = 18000;

function vertex(x, y, z) {
  if (![x, y, z].every(Number.isFinite)) throw new Error('STL contains invalid coordinates.');
  return [x, z, -y];
}

function normalFor(points) {
  const a = points[0], b = points[1], c = points[2];
  const u = b.map((value, index) => value - a[index]);
  const v = c.map((value, index) => value - a[index]);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...n);
  return length > 1e-14 ? n.map(value => value / length) : [0, 1, 0];
}

function buildMeshes(triangleCount, readFace) {
  if (triangleCount <= 0 || triangleCount > MAX_TRIANGLES) {
    throw new Error(`STL triangle count must be between 1 and ${MAX_TRIANGLES.toLocaleString()}.`);
  }
  const meshes = [];
  for (let start = 0; start < triangleCount; start += TRIANGLES_PER_MESH) {
    const count = Math.min(TRIANGLES_PER_MESH, triangleCount - start);
    const positions = new Float32Array(count * 9);
    const normals = new Float32Array(count * 9);
    const indices = new Uint16Array(count * 3);
    for (let local = 0; local < count; local += 1) {
      const points = readFace(start + local);
      const normal = normalFor(points);
      for (let corner = 0; corner < 3; corner += 1) {
        const offset = local * 9 + corner * 3;
        positions.set(points[corner], offset);
        normals.set(normal, offset);
        indices[local * 3 + corner] = local * 3 + corner;
      }
    }
    meshes.push({
      name: `NX Surface ${meshes.length + 1}`,
      color: '#5ac9b7', positions, normals, indices,
    });
  }
  return meshes;
}

function readBinary(buffer) {
  if (buffer.byteLength < 84) return null;
  const view = new DataView(buffer);
  const triangles = view.getUint32(80, true);
  const expected = 84 + triangles * 50;
  if (!triangles || expected !== buffer.byteLength) return null;
  return buildMeshes(triangles, index => {
    const base = 84 + index * 50 + 12;
    return [0, 1, 2].map(corner => {
      const at = base + corner * 12;
      return vertex(view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true));
    });
  });
}

function readAscii(buffer) {
  const content = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (!/^\s*solid\b/i.test(content)) throw new Error('File is not a recognized binary or ASCII STL.');
  const value = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
  const expression = new RegExp(`\\bvertex\\s+(${value})\\s+(${value})\\s+(${value})`, 'gi');
  const points = [];
  for (const match of content.matchAll(expression)) {
    points.push(vertex(Number(match[1]), Number(match[2]), Number(match[3])));
    if (points.length > MAX_TRIANGLES * 3) throw new Error('STL exceeds the supported triangle limit.');
  }
  if (points.length === 0 || points.length % 3 !== 0) throw new Error('ASCII STL has incomplete triangles.');
  return buildMeshes(points.length / 3, index => points.slice(index * 3, index * 3 + 3));
}

export function parseSTL(buffer) {
  if (!(buffer instanceof ArrayBuffer)) throw new Error('Expected STL binary data.');
  if (buffer.byteLength > 256 * 1024 * 1024) throw new Error('STL exceeds the 256 MB viewer limit.');
  return readBinary(buffer) || readAscii(buffer);
}
