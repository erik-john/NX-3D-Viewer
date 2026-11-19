// Geometry data is expressed in world coordinates; the vertical axis is Y.
function mesh(name, color, positions, normals, indices) {
  return {
    name,
    color,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

export function box(name, color, center = [0, 0, 0], size = [2, 2, 2]) {
  const [cx, cy, cz] = center;
  const [x, y, z] = size.map(value => value / 2);
  const faces = [
    { n: [0, 0, 1], p: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]] },
    { n: [0, 0, -1], p: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]] },
    { n: [1, 0, 0], p: [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]] },
    { n: [-1, 0, 0], p: [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]] },
    { n: [0, 1, 0], p: [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]] },
    { n: [0, -1, 0], p: [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]] },
  ];
  const positions = [], normals = [], indices = [];
  for (const face of faces) {
    const offset = positions.length / 3;
    for (const point of face.p) {
      positions.push(point[0] + cx, point[1] + cy, point[2] + cz);
      normals.push(...face.n);
    }
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return mesh(name, color, positions, normals, indices);
}

export function cylinder(name, color, center = [0, 0, 0], radius = 1, height = 2, segments = 48) {
  const [cx, cy, cz] = center;
  const positions = [], normals = [], indices = [];
  const half = height / 2;
  for (let i = 0; i <= segments; i += 1) {
    const angle = i * Math.PI * 2 / segments;
    const x = Math.cos(angle), z = Math.sin(angle);
    positions.push(cx + radius * x, cy - half, cz + radius * z,
      cx + radius * x, cy + half, cz + radius * z);
    normals.push(x, 0, z, x, 0, z);
    if (i < segments) {
      const n = i * 2;
      indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
  }
  for (const [sign, normal] of [[1, 1], [-1, -1]]) {
    const offset = positions.length / 3;
    positions.push(cx, cy + sign * half, cz);
    normals.push(0, normal, 0);
    for (let i = 0; i <= segments; i += 1) {
      const angle = i * Math.PI * 2 / segments;
      positions.push(cx + Math.cos(angle) * radius, cy + sign * half, cz + Math.sin(angle) * radius);
      normals.push(0, normal, 0);
      if (i < segments) {
        if (sign > 0) indices.push(offset, offset + i + 2, offset + i + 1);
        else indices.push(offset, offset + i + 1, offset + i + 2);
      }
    }
  }
  return mesh(name, color, positions, normals, indices);
}

export function sphere(name, color, center = [0, 0, 0], radius = 1.2, rings = 28, segments = 48) {
  const [cx, cy, cz] = center;
  const positions = [], normals = [], indices = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const theta = Math.PI * ring / rings;
    const y = Math.cos(theta), r = Math.sin(theta);
    for (let j = 0; j <= segments; j += 1) {
      const phi = 2 * Math.PI * j / segments;
      const x = r * Math.cos(phi), z = r * Math.sin(phi);
      normals.push(x, y, z);
      positions.push(cx + radius * x, cy + radius * y, cz + radius * z);
      if (ring < rings && j < segments) {
        const a = ring * (segments + 1) + j;
        const b = a + segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  return mesh(name, color, positions, normals, indices);
}

const catalog = {
  assembly: {
    title: 'Mechanical Assembly',
    description: 'A machined fixture with a base, housing, shaft and mounting fasteners.',
    make: () => [
      box('Mounting Base', '#536c85', [0, -0.09, 0], [3.8, 0.38, 2.7]),
      cylinder('Lower Flange', '#9ab1c3', [0, 0.23, 0], 1.08, 0.29),
      cylinder('Main Housing', '#3db5a6', [0, 0.94, 0], 0.71, 1.22),
      cylinder('Top Flange', '#8ca4b5', [0, 1.62, 0], 0.90, 0.20),
      cylinder('Drive Shaft', '#d3a77a', [0, 2.01, 0], 0.24, 0.64),
      ...[-1, 1].flatMap(x => [-1, 1].map(z => cylinder(
        'Mounting Fastener', '#9bb2c4', [x * 1.49, 0.20, z * 0.91], 0.13, 0.20, 24,
      ))),
    ],
  },
  box: {
    title: 'Precision Block',
    description: 'A six-face geometric solid for examining edge definition and orientation.',
    make: () => [box('Precision Block', '#56b7c0', [0, 0, 0], [2.5, 2.15, 2.2])],
  },
  sphere: {
    title: 'Sphere',
    description: 'A smooth curved surface represented as triangular facets.',
    make: () => [sphere('Sphere', '#51b7b0')],
  },
  cylinder: {
    title: 'Cylinder',
    description: 'A round solid with flat end caps and a continuous radial surface.',
    make: () => [cylinder('Cylinder', '#b79cda', [0, 0, 0], 1.05, 2.5)],
  },
};

export function createSample(key) {
  if (!Object.hasOwn(catalog, key)) throw new Error('Unknown scene selection');
  const item = catalog[key];
  return { title: item.title, description: item.description, meshes: item.make() };
}

export function boundsFor(meshes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const item of meshes) {
    for (let i = 0; i < item.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], item.positions[i + axis]);
        max[axis] = Math.max(max[axis], item.positions[i + axis]);
      }
    }
  }
  if (!meshes.length) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: [0, 0, 0] };
  return {
    min, max,
    center: min.map((value, i) => (value + max[i]) / 2),
    size: min.map((value, i) => max[i] - value),
  };
}
