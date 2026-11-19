// Compute bounds for an imported 3D mesh.
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
