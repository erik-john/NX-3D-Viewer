// Orthogonal NX section planes use the same X,Z,-Y coordinate basis as the viewer.
export const SECTION_AXES = Object.freeze({
  X: { index: 0, sign: 1 },
  Y: { index: 2, sign: -1 },
  Z: { index: 1, sign: 1 },
});

export function sectionPlane(bounds, axis = 'X', percent = 50, reversed = false) {
  const direction = SECTION_AXES[axis];
  if (!direction) throw new Error('Unsupported section axis');
  const fraction = Math.min(1, Math.max(0, Number(percent) / 100));
  const position = bounds.min[direction.index] +
    (bounds.max[direction.index] - bounds.min[direction.index]) * fraction;
  const polarity = reversed ? -1 : 1;
  const normal = [0, 0, 0];
  normal[direction.index] = direction.sign * polarity;
  return { axis, position, index: direction.index, normal,
    equation: [...normal, normal[direction.index] * position] };
}

export function capQuad(partBounds, offset, section) {
  const index = section.index;
  const other = [0, 1, 2].filter(i => i !== index);
  const from = partBounds.min.map((v, i) => v + offset[i]);
  const to = partBounds.max.map((v, i) => v + offset[i]);
  const padding = Math.max(...partBounds.size, 1) * 0.02;
  for (const i of other) { from[i] -= padding; to[i] += padding; }
  const point = (u, v) => {
    const value = [0, 0, 0];
    value[index] = section.position;
    value[other[0]] = u;
    value[other[1]] = v;
    return value;
  };
  const a = point(from[other[0]], from[other[1]]);
  const b = point(to[other[0]], from[other[1]]);
  const c = point(to[other[0]], to[other[1]]);
  const d = point(from[other[0]], to[other[1]]);
  const positions = new Float32Array([...a, ...b, ...c, ...a, ...c, ...d]);
  // The cap's outward normal is toward the clipped-away half-space.
  const normal = section.normal.map(v => -v);
  const normals = new Float32Array([...normal, ...normal, ...normal,
    ...normal, ...normal, ...normal]);
  return { positions, normals };
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
