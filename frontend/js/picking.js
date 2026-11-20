// One-pixel GPU color picking: each visible WebGL mesh gets a unique 24-bit ID.
// Only opaque mesh triangles participate, never the grid or reference planes.
export function encodePickId(value) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffffff) throw new RangeError('Invalid picking ID');
  return [(value & 255) / 255, ((value >>> 8) & 255) / 255, ((value >>> 16) & 255) / 255];
}

export function decodePickColor(bytes) {
  if (bytes[3] === 0) return 0;
  return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
}

// Transform a perspective projection so a single 1x1 render target sees
// precisely the cursor pixel from the full-size canvas.
export function pickMatrix(viewProjection, ndcX, ndcY, pixelWidth, pixelHeight) {
  const output = new Float32Array(viewProjection);
  for (let c = 0; c < 4; c += 1) {
    const i = 4 * c;
    output[i] = pixelWidth * (viewProjection[i] - ndcX * viewProjection[i + 3]);
    output[i + 1] = pixelHeight * (viewProjection[i + 1] - ndcY * viewProjection[i + 3]);
  }
  return output;
}
