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

// Average normals only among coplanar or gently curved adjacent facets.
// Mechanical corners stay sharp and each STL chunk is handled independently.
const SMOOTH_ANGLE_COS = Math.cos(42 * Math.PI / 180);
const CREASE_ANGLE_COS = Math.cos(38 * Math.PI / 180);

function shadeSurface(positions, flatNormals) {
  const count = positions.length / 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const dimension = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  // Quantize by mesh scale so shared triangle corners can be welded without
  // changing actual STL vertex coordinates or merging distant details.
  const tolerance = Math.max(dimension * 1e-7, 1e-9);
  const groups = new Map(), vertexKeys = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const at = i * 3;
    const key = `${Math.round(positions[at] / tolerance)},${Math.round(positions[at + 1] / tolerance)},${Math.round(positions[at + 2] / tolerance)}`;
    vertexKeys[i] = key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }

  const normals = new Float32Array(flatNormals.length);
  for (const group of groups.values()) {
    // Many STL files duplicate identical facets. Group normals first to avoid
    // quadratic work on repeated/degenerate vertices in large assemblies.
    const buckets = new Map();
    for (const i of group) {
      const at = i * 3;
      const nx = flatNormals[at], ny = flatNormals[at + 1], nz = flatNormals[at + 2];
      const key = `${Math.round(nx * 10000)},${Math.round(ny * 10000)},${Math.round(nz * 10000)}`;
      if (!buckets.has(key)) buckets.set(key, { x: 0, y: 0, z: 0, count: 0 });
      const bucket = buckets.get(key);
      bucket.x += nx; bucket.y += ny; bucket.z += nz; bucket.count += 1;
    }
    const clusters = Array.from(buckets.values()).map(b => {
      const mag = Math.hypot(b.x, b.y, b.z) || 1;
      return { ...b, nx: b.x / mag, ny: b.y / mag, nz: b.z / mag };
    });
    const smoothed = new Map();
    for (const i of group) {
      const at = i * 3;
      const nx = flatNormals[at], ny = flatNormals[at + 1], nz = flatNormals[at + 2];
      const key = `${Math.round(nx * 10000)},${Math.round(ny * 10000)},${Math.round(nz * 10000)}`;
      if (!smoothed.has(key)) {
        let sumX = 0, sumY = 0, sumZ = 0;
        for (const b of clusters) {
          if (nx * b.nx + ny * b.ny + nz * b.nz >= SMOOTH_ANGLE_COS) {
            sumX += b.x; sumY += b.y; sumZ += b.z;
          }
        }
        const mag = Math.hypot(sumX, sumY, sumZ) || 1;
        smoothed.set(key, [sumX / mag, sumY / mag, sumZ / mag]);
      }
      normals.set(smoothed.get(key), at);
    }
  }

  // A single sharp-crease segment is emitted for each welded edge shared by
  // facets whose normals differ substantially. Chunk borders are excluded.
  const edges = new Map();
  for (let t = 0; t < count / 3; t += 1) {
    const first = t * 3;
    for (let corner = 0; corner < 3; corner += 1) {
      const a = first + corner, b = first + (corner + 1) % 3;
      const ka = vertexKeys[a], kb = vertexKeys[b];
      if (ka === kb) continue;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!edges.has(key)) edges.set(key, { a, b, normals: [] });
      const e = edges.get(key);
      // Different faces sometimes duplicate the same STL triangle; filter them.
      e.normals.push([flatNormals[first * 3], flatNormals[first * 3 + 1], flatNormals[first * 3 + 2]]);
    }
  }
  const crease = [];
  for (const edge of edges.values()) {
    if (edge.normals.length < 2) continue;
    const normal = edge.normals[0];
    const sharp = edge.normals.slice(1).some(other =>
      normal[0] * other[0] + normal[1] * other[1] + normal[2] * other[2] < CREASE_ANGLE_COS);
    if (!sharp) continue;
    crease.push(...positions.subarray(edge.a * 3, edge.a * 3 + 3));
    crease.push(...positions.subarray(edge.b * 3, edge.b * 3 + 3));
  }
  return { normals, creasePositions: new Float32Array(crease) };
}

function buildMeshes(triangleCount, readFace) {
  if (triangleCount <= 0 || triangleCount > MAX_TRIANGLES) {
    throw new Error(`STL triangle count must be between 1 and ${MAX_TRIANGLES.toLocaleString()}.`);
  }
  const meshes = [];
  for (let start = 0; start < triangleCount; start += TRIANGLES_PER_MESH) {
    const count = Math.min(TRIANGLES_PER_MESH, triangleCount - start);
    const positions = new Float32Array(count * 9);
    const flatNormals = new Float32Array(count * 9);
    const indices = new Uint16Array(count * 3);
    for (let local = 0; local < count; local += 1) {
      const points = readFace(start + local);
      const normal = normalFor(points);
      for (let corner = 0; corner < 3; corner += 1) {
        const offset = local * 9 + corner * 3;
        positions.set(points[corner], offset);
        flatNormals.set(normal, offset);
        indices[local * 3 + corner] = local * 3 + corner;
      }
    }
    const { normals, creasePositions } = shadeSurface(positions, flatNormals);
    meshes.push({
      name: `NX Surface ${meshes.length + 1}`,
      color: '#dee1e3', positions, normals, indices, creasePositions,
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
