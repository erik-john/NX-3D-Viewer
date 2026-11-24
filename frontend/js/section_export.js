import { intersectsSection } from './section_geometry.js';

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const scale = (a, value) => a.map(item => item * value);

// A bounding-box intersection is only a broad-phase check: curved and hollow
// parts can straddle a plane without any surface actually being cut.
export function intersectsCutSurface(part, plane) {
  if (!part.visible || !intersectsSection(part.bounds, part.offset, plane)) return false;
  const positions = part.sourcePositions;
  const indices = part.sourceIndices;
  if (!positions || !indices || !indices.length) return true;
  const epsilon = Math.max(...part.bounds.size, 1) * 1e-7;
  const n = plane.normal;
  const shifted = dot(n, part.offset) - plane.equation[3];
  for (let i = 0; i < indices.length; i += 3) {
    let min = Infinity, max = -Infinity;
    for (let j = 0; j < 3; j++) {
      const at = indices[i + j] * 3;
      const distance = n[0] * positions[at] + n[1] * positions[at + 1] +
        n[2] * positions[at + 2] + shifted;
      min = Math.min(min, distance);
      max = Math.max(max, distance);
    }
    if (min < -epsilon && max > epsilon) return true;
  }
  return false;
}

// Create a presentation-only explosion inside the section plane. Offsets are
// tangent to the plane so moving a cut component cannot remove its own cap.
export function planSectionImage(parts, plane, modelBounds) {
  if (!plane) return [];
  const cut = parts.filter(part => intersectsCutSurface(part, plane));
  if (!cut.length) return [];
  const centers = cut.map(part => part.bounds.center.map((value, i) => value + part.offset[i]));
  const mean = [0, 1, 2].map(i => centers.reduce((sum, point) => sum + point[i], 0) / centers.length);
  const spread = Math.max(...modelBounds.size, 1) * 0.15;
  return cut.map((part, index) => {
    const displacement = centers[index].map((v, i) => v - mean[i]);
    const u = dot(displacement, plane.u);
    const v = dot(displacement, plane.v);
    let [du, dv] = [u, v];
    if (Math.hypot(du, dv) < Math.max(spread * 0.08, 1e-7)) {
      const theta = 2 * Math.PI * index / cut.length + Math.PI / 4;
      du = Math.cos(theta);
      dv = Math.sin(theta);
    }
    const length = Math.hypot(du, dv) || 1;
    const outward = scale(plane.u, du / length).map((n, i) => n + plane.v[i] * dv / length);
    const shift = cut.length > 1 ? outward.map(value => value * spread) : [0, 0, 0];
    return {part, offset: part.offset.map((value, i) => value + shift[i]), shift};
  });
}

export function sectionImageName(filename, now = new Date(), suffix = null) {
  const stem = String(filename || 'NX_Model').replace(/\.(prt|jt|stl)$/i, '')
    .replace(/[^\w.\-]+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '').slice(0, 90) || 'NX_Model';
  const part = value => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}`;
  const time = `${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
  const random = suffix === null ? String(Math.floor(Math.random() * 10000)).padStart(4, '0') : String(suffix).padStart(4, '0');
  return `${stem}_Section_${date}_${time}_${random}.png`;
}


// The title has its own band above the model image. Keeping the WebGL frame
// entirely outside that band guarantees the label never obscures cut geometry.
export function sectionTitleLayout(imageWidth, imageHeight) {
  const width = Math.max(1, Math.round(imageWidth));
  const height = Math.max(1, Math.round(imageHeight));
  const scale = Math.max(0.8, Math.min(1.5, width / 1600));
  const margin = Math.round(Math.max(28, 50 * scale));
  const top = Math.round(28 * scale);
  const cardHeight = Math.round(132 * scale);
  const cardWidth = Math.min(width, Math.round(640 * scale));
  const bandHeight = top + cardHeight + Math.round(28 * scale);
  return {width: width + 2 * margin, height: bandHeight + height + margin,
    margin, top, scale, cardWidth, cardHeight, modelX: margin, modelY: bandHeight,
    modelWidth: width, modelHeight: height};
}

export function sectionPlaneCaption(section = {}) {
  const basic = {X: 'YZ', Y: 'XZ', Z: 'XY'}[section.axis] || 'Custom';
  const tilted = Math.abs(Number(section.tiltU) || 0) > 0.01 ||
    Math.abs(Number(section.tiltV) || 0) > 0.01;
  const plane = tilted ? `Custom (from ${basic})` : basic;
  return `Section Plane: ${plane}${section.reversed ? ' / Reversed' : ''}`;
}

function roundedRectangle(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fitText(ctx, value, maxWidth) {
  const text = String(value || '');
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '...').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '...';
}

// Compose a high-resolution PNG using the application's real logo and the
// already rendered section, without resizing/cropping the 3D frame itself.
export function composeSectionImage(snapshot, {filename = 'NX_Model', section = {}, logo = null} = {}) {
  if (!snapshot?.width || !snapshot?.height) throw new Error('Section image is empty.');
  const l = sectionTitleLayout(snapshot.width, snapshot.height);
  const canvas = document.createElement('canvas');
  canvas.width = l.width;
  canvas.height = l.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PNG title rendering is unavailable.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, l.width, l.height);
  ctx.drawImage(snapshot, l.modelX, l.modelY, l.modelWidth, l.modelHeight);

  const s = l.scale;
  const x = l.margin, y = l.top, cw = l.cardWidth, ch = l.cardHeight;
  ctx.save();
  ctx.shadowColor = 'rgba(30, 47, 64, 0.10)';
  ctx.shadowBlur = 13 * s;
  ctx.shadowOffsetY = 3 * s;
  roundedRectangle(ctx, x, y, cw, ch, 14 * s);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  roundedRectangle(ctx, x, y, cw, ch, 14 * s);
  ctx.lineWidth = 1.25 * s;
  ctx.strokeStyle = '#d6dce2';
  ctx.stroke();

  const logoSize = 80 * s;
  const logoX = x + 20 * s;
  const logoY = y + (ch - logoSize) / 2;
  if (logo?.complete && logo.naturalWidth > 0) {
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
  } else {
    // A readable fallback if the existing header image could not load.
    ctx.fillStyle = '#167ea7';
    roundedRectangle(ctx, logoX + 10 * s, logoY + 10 * s,
      logoSize - 20 * s, logoSize - 20 * s, 9 * s);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${29 * s}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('NX', logoX + logoSize / 2, logoY + logoSize * 0.65);
    ctx.textAlign = 'left';
  }
  const dividerX = x + 114 * s;
  ctx.strokeStyle = '#bfc8d0';
  ctx.lineWidth = 1.3 * s;
  ctx.beginPath();
  ctx.moveTo(dividerX, y + 20 * s);
  ctx.lineTo(dividerX, y + ch - 20 * s);
  ctx.stroke();

  const textX = x + 136 * s;
  const maxTextWidth = cw - (textX - x) - 19 * s;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#28323c';
  ctx.font = `700 ${27 * s}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText('NX 3D Viewer', textX, y + 42 * s);
  const originalName = String(filename || 'NX_Model').split(/[\\/]/).pop();
  ctx.font = `400 ${19 * s}px "Segoe UI", Arial, sans-serif`;
  ctx.fillStyle = '#36434f';
  ctx.fillText(fitText(ctx, originalName, maxTextWidth), textX, y + 81 * s);
  ctx.font = `400 ${17 * s}px "Segoe UI", Arial, sans-serif`;
  ctx.fillStyle = '#526171';
  ctx.fillText(fitText(ctx, sectionPlaneCaption(section), maxTextWidth), textX, y + 110 * s);
  return canvas;
}
