import { boundsFor } from './geometry.js';

// Every assembly occurrence keeps a stable group ID. No vertex or STL data is edited.
export function createExplodePlan(root, meshes) {
  if (!root || !Array.isArray(meshes) || !meshes.length) return [];
  const owners = new Map();
  const visit = (node, component = null) => {
    const owner = node.type === 'component' ? node.id : component;
    if (node.type === 'body') owners.set(node.meshId || node.id, owner || root.id);
    for (const child of node.children || []) visit(child, owner);
  };
  visit(root);
  const grouped = new Map();
  for (const mesh of meshes) {
    const id = mesh.meshId || 'root';
    const owner = owners.get(id);
    if (!owner) continue;
    if (!grouped.has(owner)) grouped.set(owner, []);
    grouped.get(owner).push(mesh);
  }
  const overall = boundsFor(meshes);
  const groups = [...grouped].map(([id, pieces], index) => {
    const bounds = boundsFor(pieces);
    // Different components in the same position still get distinct directions.
    const angle = index * 2.399963229728653;
    const z = 1 - 2 * ((index + .5) / grouped.size);
    const radius = Math.sqrt(Math.max(0, 1 - z*z));
    const fallback = [Math.cos(angle)*radius, z, Math.sin(angle)*radius];
    const radial = bounds.center.map((v, i) => (v-overall.center[i]) / Math.max(...overall.size, 1));
    const combined = radial.map((v, i) => v + .25*fallback[i]);
    const len = Math.hypot(...combined) || 1;
    return { id, meshIds: [...new Set(pieces.map(piece => piece.meshId || 'root'))],
      center: bounds.center.slice(), direction: combined.map(v=>v/len) };
  });
  return groups;
}

// The global slider is 0..100. Per-component overrides are also percentages;
// reset of one component returns it to the assembled position even if others are exploded.
export function calculateExplodeOffsets(groups, bounds, level, overrides = new Map()) {
  const offsets = new Map();
  if (groups.length < 2) return offsets;
  const separation = Math.max(...bounds.size, .01) * .68;
  for (const group of groups) {
    const amount = Math.max(0, Math.min(100, overrides.get(group.id) ?? level)) / 100;
    const position = group.direction.map(v => v * separation * amount);
    for (const meshId of group.meshIds) offsets.set(meshId, position.slice());
  }
  return offsets;
}

export function selectionGroupIds(groups, selectedNode, descendants) {
  if (!selectedNode || !['component','body'].includes(selectedNode.type)) return [];
  const owned = new Set(descendants(selectedNode));
  return groups.filter(group=>group.meshIds.some(id=>owned.has(id))).map(group=>group.id);
}
