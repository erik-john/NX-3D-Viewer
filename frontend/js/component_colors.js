/** Assign distinct display colors by NX prototype, not by assembly occurrence. */
// Alternating warm/cool colors make nearby types easy to distinguish. The list
// supports the common case of a 24-component assembly without color repeats.
const PALETTE = [
  '#D77C64', '#5D9DC8', '#9BAF56', '#A184C9', '#D6A04C', '#58A99A',
  '#CB7EAC', '#7D91CB', '#B48A62', '#69A96E', '#BB78D3', '#53A8BC',
  '#CD8A8A', '#7FAD55', '#8583C8', '#D0915E', '#68A8D8', '#ADAA66',
  '#A27990', '#56B3A8', '#C590BF', '#8B9D63', '#BE8062', '#7B96A5',
  '#E0A65F', '#669B83', '#9F91D8', '#C47786', '#6FA6A2', '#A49F56',
  '#C589D7', '#8DAED2', '#D49073', '#7BAC75', '#B47E9F', '#75A2BE',
];

// Name fallback is for older manifests; current NX journals export partKey
// from each prototype path/name, so repeated occurrences map to the same key.
function typeKey(node) {
  const raw = String(node.partKey || node.name || node.id).trim().toLocaleLowerCase('en-US');
  return node.partKey ? raw.replace(/\\/g, '/') :
    raw.replace(/\s*(?:\(\d+\)|\[\d+\]|#\d+)\s*$/, '').trim();
}

function colorAt(index) {
  if (index < PALETTE.length) return PALETTE[index];
  // Beyond the curated palette, generate additional distinguishable hues.
  const hue = (index * 137.507764 + 41) % 360;
  const saturation = [56, 67, 48][index % 3];
  const lightness = [55, 62, 48][Math.floor(index / 3) % 3];
  const f = n => {
    const k = (n + hue / 30) % 12;
    const a = saturation / 100 * Math.min(lightness / 100, 1 - lightness / 100);
    return Math.round(255 * (lightness / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

export function buildComponentColors(root, meshes) {
  const owners = new Map();
  let componentCount = 0;
  function walk(node, owner = null) {
    if (node.type === 'component') {
      componentCount++;
      owner = typeKey(node);
    }
    if (node.type === 'body') owners.set(node.meshId || node.id, owner);
    for (const child of node.children || []) walk(child, owner);
  }
  if (root) walk(root);
  const meshIds = new Set((meshes || []).map(mesh => mesh.meshId));
  const keys = [...new Set([...owners].filter(([id, owner]) => meshIds.has(id) && owner)
    .map(([, owner]) => owner))].sort((a, b) => a.localeCompare(b, 'en'));
  const byType = new Map(keys.map((key, index) => [key, colorAt(index)]));
  const colors = new Map();
  for (const [id, owner] of owners) {
    if (meshIds.has(id) && byType.has(owner)) colors.set(id, byType.get(owner));
  }
  return { available: componentCount >= 2 && colors.size >= 2,
    colors, typeCount: keys.length };
}
