import { boundsFor } from './geometry.js';
import { encodePickId, decodePickColor, pickMatrix } from './picking.js';
import { rayForViewport, hitMeshGroup, measurementSurface } from './plane_measure.js';

const PI = Math.PI;
const TAU = 2 * PI;
const EMPTY_VIEW_DISTANCE = 11.5;
const MODEL_FIT_MARGIN = 1.25;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => { const l = Math.hypot(...a) || 1; return a.map(value => value / l); };
const colorFromHex = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, 2 * far * near / (near - far), 0,
  ]);
}

function lookAt(eye, target) {
  const z = normalize(eye.map((value, i) => value - target[i]));
  let x = normalize(cross([0, 1, 0], z));
  if (Math.hypot(...x) < 0.00001) x = [1, 0, 0];
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) {
        out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
      }
    }
  }
  return out;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Renderer shader failed: ${message}`);
  }
  return shader;
}

function program(gl, vertex, fragment) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Renderer program failed: ${message}`);
  }
  return p;
}

const SOLID_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uViewProjection;
uniform vec3 uOffset;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vNormal = aNormal;
  vPosition = aPosition + uOffset;
  gl_Position = uViewProjection * vec4(aPosition + uOffset, 1.0);
}`;
const SOLID_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uColor;
uniform vec3 uEye;
uniform float uWire;
uniform float uHighlight;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(uEye - vPosition);
  if (!gl_FrontFacing) normal = -normal;

  // Soft studio illumination keeps dark-facing steel surfaces legible.
  vec3 keyDir = normalize(vec3(-0.47, 0.83, 0.31));
  vec3 fillDir = normalize(vec3(0.81, 0.32, -0.51));
  vec3 backDir = normalize(vec3(-0.26, -0.39, -0.88));
  float key = max(dot(normal, keyDir), 0.0);
  float fill = max(dot(normal, fillDir), 0.0);
  float back = max(dot(normal, backDir), 0.0);
  float sky = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
  float diffuse = 0.50 + 0.34 * key + 0.16 * fill + 0.08 * back + 0.06 * sky;

  // Wide softbox reflections roll gently around cylindrical NX surfaces.
  vec3 keyHalf = normalize(keyDir + viewDir);
  vec3 fillHalf = normalize(fillDir + viewDir);
  float broad = pow(max(dot(normal, keyHalf), 0.0), 13.0) * 0.10;
  float tight = pow(max(dot(normal, fillHalf), 0.0), 52.0) * 0.035;
  vec3 reflected = reflect(-viewDir, normal);
  float softbox = pow(max(dot(reflected, normalize(vec3(-0.82, 0.49, 0.30))), 0.0), 7.0) * 0.06;

  // Keep the CAD silhouette subtle; mechanical crease lines supply edge detail.
  float facing = max(dot(normal, viewDir), 0.0);
  float silhouette = pow(1.0 - facing, 3.0);
  vec3 baseLinear = pow(clamp(uColor, 0.0, 1.0), vec3(2.2));
  vec3 linearSteel = baseLinear * diffuse * (1.0 - 0.06 * silhouette) + vec3(broad + tight + softbox);
  // Convert linear illumination to display sRGB. Without this, gray faces look charcoal.
  vec3 steel = pow(clamp(linearSteel, 0.0, 1.0), vec3(1.0 / 2.2)) * 0.96;
  // A selected component remains visibly shaded, rather than turning into a flat color.
  vec3 surface = mix(steel, vec3(0.37, 0.41, 0.45), uWire);
  if (uHighlight > 1.5) surface = mix(surface, vec3(0.24, 0.61, 0.88), 0.46);
  else if (uHighlight > 0.5) surface = mix(surface, vec3(0.23, 0.84, 0.74), 0.32);
  // CAD inspection glass: darker cool-smoke tint, a very clear center, and a
  // stronger Fresnel edge. Keep the original steel shader exact at 0% glass.
  float glassMix = smoothstep(0.0, 0.25, 1.0 - uOpacity);
  float facingGlass = clamp(abs(dot(normal, viewDir)), 0.0, 1.0);
  float rim = pow(1.0 - facingGlass, 2.0);
  float glint = pow(max(dot(normal, keyHalf), 0.0), 55.0);
  vec3 glassTint = mix(vec3(0.10, 0.30, 0.38), vec3(0.16, 0.45, 0.54), rim);
  glassTint += vec3(0.30, 0.45, 0.50) * glint * 0.44;
  if (uHighlight > 1.5) glassTint = mix(glassTint, vec3(0.13, 0.44, 0.77), 0.48);
  else if (uHighlight > 0.5) glassTint = mix(glassTint, vec3(0.13, 0.67, 0.62), 0.40);
  surface = mix(surface, glassTint, glassMix);
  // Back faces of closed STL solids otherwise pile up opacity and form an
  // almost-white slab. Keep them, but let the front glass and internal parts
  // dominate the view. Do not cull: imported CAD windings can differ.
  float glassAlpha = clamp(uOpacity + glassMix * (0.24 * rim + 0.07 * glint), 0.0, 1.0);
  float backFaceWeight = gl_FrontFacing ? 1.0 : mix(1.0, 0.22, glassMix);
  float surfaceAlpha = clamp(mix(uOpacity, glassAlpha * backFaceWeight, glassMix), 0.0, 1.0);
  gl_FragColor = vec4(surface, surfaceAlpha);
}`;
// Color ID pass shares the same mesh buffers and depth ordering as normal rendering.
const PICK_VERTEX = `
attribute vec3 aPosition;
uniform mat4 uViewProjection;
uniform vec3 uOffset;
void main() { gl_Position = uViewProjection * vec4(aPosition + uOffset, 1.0); }`;
const PICK_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uPickColor;
void main() { gl_FragColor = vec4(uPickColor, 1.0); }`;

const LINE_VERTEX = `
attribute vec3 aPosition;
attribute vec4 aColor;
uniform mat4 uViewProjection;
uniform vec3 uOffset;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProjection * vec4(aPosition + uOffset, 1.0);
}`;
const LINE_FRAGMENT = `
precision mediump float;
uniform float uOpacity;
varying vec4 vColor;
void main() { gl_FragColor = vec4(vColor.rgb, vColor.a * uOpacity); }`;

function createBuffer(gl, data, target = gl.ARRAY_BUFFER) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return buffer;
}

// Semi-transparent technical edges follow actual mesh creases rather than
// drawing every triangle of the STL tessellation.
function makeCreaseColors(count, glass = false) {
  const colors = new Float32Array(count * 4);
  // Cool blue-gray glass contours remain legible on the light workspace.
  const color = glass ? [0.11, 0.34, 0.42, 0.58] : [0.24, 0.25, 0.27, 0.58];
  for (let i = 0; i < count; i += 1) colors.set(color, i * 4);
  return colors;
}

function getEdges(indices) {
  const result = [], seen = new Set();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e += 1) {
      const a = Math.min(tri[e], tri[(e + 1) % 3]);
      const b = Math.max(tri[e], tri[(e + 1) % 3]);
      const key = `${a}/${b}`;
      if (!seen.has(key)) { seen.add(key); result.push(a, b); }
    }
  }
  return new Uint16Array(result);
}

function makeGrid(bounds, empty = false) {
  const xy = empty ? 9 : Math.max(bounds.size[0], bounds.size[2], 2);
  const full = Math.max(5, Math.ceil(xy * 1.5));
  const step = full > 35 ? Math.ceil(full / 22) : 1;
  const count = Math.ceil(full / step);
  const extent = count * step;
  const y = bounds.min[1] - 0.12;
  const positions = [], colors = [];
  function line(a, b, color) {
    positions.push(...a, ...b);
    colors.push(...color, ...color);
  }
  for (let i = -count; i <= count; i += 1) {
    const v = i * step;
    const shade = i === 0 ? [0.33, 0.50, 0.58, 0.45] : i % 5 === 0
      ? [0.28, 0.45, 0.55, 0.38] : [0.18, 0.32, 0.43, 0.31];
    line([-extent, y, v], [extent, y, v], shade);
    line([v, y, -extent], [v, y, extent], shade);
  }
  return { positions, colors, extent };
}

// NX-style datum references are centered on the part coordinate origin.
// The three datum planes remain independent from the optional floor grid.
// STL transforms NX (X,Y,Z) into WebGL (X,Z,-Y); reference geometry must match.
// Three compact positive-quadrant datum planes only: NX XY, YZ and XZ.
const NX_AXIS_DIRECTIONS = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
function makeDatum(bounds, empty = false) {
  const largest = Math.max(...bounds.size);
  const length = empty ? 1.35 : Math.max(0.22, largest * 0.105);
  const extent = length * 0.50;
  const axesPositions = [], axesColors = [];
  const planePositions = [], planeColors = [];
  const outlinePositions = [], outlineColors = [];
  const axisColors = [
    [0.64, 0.28, 0.27, 0.95], // NX X
    [0.27, 0.53, 0.39, 0.95], // NX Y (browser -Z)
    [0.29, 0.40, 0.66, 0.95], // NX Z (browser +Y)
  ];
  const axisTip = NX_AXIS_DIRECTIONS.map(axis => axis.map(v => v * length));
  function line(a, b, color, positions, colors) {
    positions.push(...a, ...b);
    colors.push(...color, ...color);
  }
  for (let i = 0; i < 3; i += 1) {
    line([0, 0, 0], axisTip[i], axisColors[i], axesPositions, axesColors);
  }
  const planes = [
    // Each plane occupies one NX-positive quadrant, avoiding duplicate faces.
    { axes: [0, 1], fill: [0.75, 0.47, 0.43, 0.09], edge: [0.62, 0.37, 0.34, 0.73] }, // NX XY
    { axes: [1, 2], fill: [0.43, 0.69, 0.58, 0.09], edge: [0.31, 0.56, 0.42, 0.73] }, // NX YZ
    { axes: [0, 2], fill: [0.53, 0.63, 0.79, 0.09], edge: [0.39, 0.50, 0.67, 0.73] }, // NX XZ
  ];
  for (const plane of planes) {
    const a = NX_AXIS_DIRECTIONS[plane.axes[0]].map(v => v * extent);
    const b = NX_AXIS_DIRECTIONS[plane.axes[1]].map(v => v * extent);
    const corners = [[0, 0, 0], a, a.map((v, i) => v + b[i]), b];
    for (const index of [0, 1, 2, 0, 2, 3]) {
      planePositions.push(...corners[index]);
      planeColors.push(...plane.fill);
    }
    for (let i = 0; i < 4; i += 1) {
      line(corners[i], corners[(i + 1) % 4], plane.edge, outlinePositions, outlineColors);
    }
  }
  return { axesPositions, axesColors, planePositions, planeColors, outlinePositions,
    outlineColors, labels: axisTip, planeCount: planes.length };
}

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, depth: true }) ||
      canvas.getContext('webgl', { alpha: true, antialias: true, depth: true });
    if (!gl) throw new Error('WebGL is unavailable. Check your browser settings and graphics driver.');
    this.gl = gl;
    this.solid = program(gl, SOLID_VERTEX, SOLID_FRAGMENT);
    this.lines = program(gl, LINE_VERTEX, LINE_FRAGMENT);
    this.pickProgram = program(gl, PICK_VERTEX, PICK_FRAGMENT);
    this.pickLoc = { position: gl.getAttribLocation(this.pickProgram, 'aPosition'),
      matrix: gl.getUniformLocation(this.pickProgram, 'uViewProjection'),
      offset: gl.getUniformLocation(this.pickProgram, 'uOffset'),
      color: gl.getUniformLocation(this.pickProgram, 'uPickColor') };
    this.pickBuffer = null;
    this.onHoverMesh = null;
    this.onSelectMesh = null;
    this.hoveredMeshIds = new Set();
    this.selectedMeshIds = new Set();
    this.componentColorsEnabled = false;
    this.solidLoc = {
      position: gl.getAttribLocation(this.solid, 'aPosition'),
      normal: gl.getAttribLocation(this.solid, 'aNormal'),
      matrix: gl.getUniformLocation(this.solid, 'uViewProjection'),
      offset: gl.getUniformLocation(this.solid, 'uOffset'),
      color: gl.getUniformLocation(this.solid, 'uColor'),
      wire: gl.getUniformLocation(this.solid, 'uWire'),
      highlight: gl.getUniformLocation(this.solid, 'uHighlight'),
      opacity: gl.getUniformLocation(this.solid, 'uOpacity'),
      eye: gl.getUniformLocation(this.solid, 'uEye'),
    };
    this.lineLoc = {
      position: gl.getAttribLocation(this.lines, 'aPosition'),
      color: gl.getAttribLocation(this.lines, 'aColor'),
      matrix: gl.getUniformLocation(this.lines, 'uViewProjection'),
      offset: gl.getUniformLocation(this.lines, 'uOffset'),
      opacity: gl.getUniformLocation(this.lines, 'uOpacity'),
    };
    this.geometry = [];
    this.measureFaces = [];
    this.measureBuffers = [];
    this.explodeOffsets = new Map();
    this.manualOffsets = new Map();
    this.onFrame = null;
    this.gridBuffers = null;
    this.axisLabels = ['x', 'y', 'z'].map(axis =>
      document.getElementById(`axis-label-${axis}`));
    this.compassAxes = ['x', 'y', 'z'].map(axis => document.getElementById(`compass-axis-${axis}`));
    this.compassLabels = ['x', 'y', 'z'].map(axis => document.getElementById(`compass-label-${axis}`));
    this.target = [0, 0, 0];
    this.yaw = PI / 4;
    this.pitch = 0.44;
    this.distance = EMPTY_VIEW_DISTANCE;
    this.showGrid = false;
    this.showAxes = true;
    this.wireframe = false;
    this.pendingRender = false;
    this.bounds = boundsFor([]);
    this.attachControls();
    this.observer = new ResizeObserver(() => this.requestRender());
    this.observer.observe(canvas);
    this.requestRender();
  }

  setScene(meshes) {
    const gl = this.gl;
    for (const item of this.geometry) {
      gl.deleteBuffer(item.position);
      gl.deleteBuffer(item.normal);
      gl.deleteBuffer(item.triangles);
      gl.deleteBuffer(item.edges);
      if (item.creasePosition) gl.deleteBuffer(item.creasePosition);
      if (item.creaseColor) gl.deleteBuffer(item.creaseColor);
      if (item.glassCreaseColor) gl.deleteBuffer(item.glassCreaseColor);
    }
    this.setMeasureFaces([]);
    this.hoveredMeshIds.clear();
    this.selectedMeshIds.clear();
    this.explodeOffsets.clear();
    this.manualOffsets.clear();
    this.geometry = meshes.map((item, index) => {
      if (item.positions.length / 3 > 65535) throw new Error('Mesh exceeds the current index limit');
      const edges = getEdges(item.indices);
      return {
        position: createBuffer(gl, item.positions),
        normal: createBuffer(gl, item.normals),
        triangles: createBuffer(gl, item.indices, gl.ELEMENT_ARRAY_BUFFER),
        triangleCount: item.indices.length,
        edges: createBuffer(gl, edges, gl.ELEMENT_ARRAY_BUFFER),
        edgeCount: edges.length,
        creasePosition: item.creasePositions?.length ? createBuffer(gl, item.creasePositions) : null,
        creaseColor: item.creasePositions?.length ? createBuffer(gl, makeCreaseColors(item.creasePositions.length / 3)) : null,
        glassCreaseColor: item.creasePositions?.length ? createBuffer(gl, makeCreaseColors(item.creasePositions.length / 3, true)) : null,
        creaseCount: (item.creasePositions?.length || 0) / 3,
        color: colorFromHex(item.color),
        componentColor: null,
        opacity: 1,
        meshId: item.meshId || 'root',
        bounds: boundsFor([item]),
        offset: [0, 0, 0],
        pickId: index + 1,
        pickColor: encodePickId(index + 1),
        visible: true,
        sourcePositions: item.positions,
        sourceIndices: item.indices,
        analyticalFaces: item.analyticalFaces || [],
        measureIndex: null,
      };
    });
    this.bounds = boundsFor(meshes);
    this.updateGrid();
    this.setView('iso');
  }

  setComponentColors(colors) {
    const byMesh = colors || new Map();
    for (const part of this.geometry) {
      const color = byMesh.get(part.meshId);
      part.componentColor = color ? colorFromHex(color) : null;
    }
    this.requestRender();
  }

  setComponentColorMode(enabled) {
    this.componentColorsEnabled = !!enabled;
    this.requestRender();
  }

  // Presentation-only per-mesh transparency. NX data and vertex buffers are unchanged.
  setMeshOpacities(opacities) {
    const values = opacities || new Map();
    for (const part of this.geometry) {
      const opacity = values.get(part.meshId);
      part.opacity = Number.isFinite(opacity) ? clamp(opacity, 0.045, 1) : 1;
    }
    this.requestRender();
  }

  // Keep manual translation independent of explosion: resetting either one never
  // changes the other, and all render/pick/fit paths use the same final offset.
  updateMeshOffsets() {
    for (const part of this.geometry) {
      const exploded = this.explodeOffsets?.get(part.meshId) || [0, 0, 0];
      const moved = this.manualOffsets?.get(part.meshId) || [0, 0, 0];
      part.offset = exploded.map((value, index) => value + moved[index]);
    }
    this.requestRender();
  }

  setExplodeOffsets(offsets) {
    this.explodeOffsets = new Map(offsets || []);
    this.updateMeshOffsets();
  }

  setManualOffsets(offsets) {
    this.manualOffsets = new Map(offsets || []);
    this.updateMeshOffsets();
  }

  getVisibleBounds() {
    return this.boundsForParts(this.geometry.filter(part => part.visible)) || this.bounds;
  }

  boundsForParts(parts) {
    if (!parts.length) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const part of parts) for (let i=0; i<3; i++) {
      min[i] = Math.min(min[i], part.bounds.min[i] + part.offset[i]);
      max[i] = Math.max(max[i], part.bounds.max[i] + part.offset[i]);
    }
    return { min, max, center: min.map((v,i)=>(v+max[i])/2), size: min.map((v,i)=>max[i]-v) };
  }

  // Frame only the *visible* selected meshes, at their exploded positions.
  // This leaves the camera orientation untouched and does not modify geometry.
  fitMeshIds(ids) {
    const selected = new Set(ids || []);
    const bounds = this.boundsForParts(this.geometry.filter(part =>
      part.visible && selected.has(part.meshId)));
    if (!bounds) return false;
    this.fit(bounds);
    return true;
  }

  setMeshVisible(meshId, visible) {
    for (const item of this.geometry) {
      if (item.meshId === meshId) item.visible = visible;
    }
    this.requestRender();
  }

  setHoveredMeshIds(ids) {
    this.updateHighlight('hoveredMeshIds', ids);
  }

  setSelectedMeshIds(ids) {
    this.updateHighlight('selectedMeshIds', ids);
  }

  updateHighlight(field, ids) {
    const next = new Set(ids || []);
    const previous = this[field];
    if (next.size === previous.size && [...next].every(id => previous.has(id))) return;
    this[field] = next;
    this.requestRender();
  }

  cameraMatrix(width, height) {
    const eye = [
      this.target[0] + this.distance * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * Math.cos(this.pitch) * Math.cos(this.yaw),
    ];
    return { eye, matrix: multiply(
      perspective(PI / 4, width / height, Math.max(0.01, this.distance / 2000), Math.max(200, this.distance * 75)),
      lookAt(eye, this.target),
    ) };
  }

  initializePicking() {
    if (this.pickBuffer) return true;
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 1, 1);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const ready = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    if (!ready) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      gl.deleteRenderbuffer(depth);
      return false;
    }
    this.pickBuffer = { framebuffer, texture, depth };
    return true;
  }

  // Return the nearest *visible* mesh, not whichever bounding box intersects first.
  // A 1x1 offscreen render avoids CPU raycasting millions of STL triangles.
  pickMesh(clientX, clientY) {
    if (!this.geometry.length) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
    if (!this.initializePicking()) return null;
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    const { matrix } = this.cameraMatrix(width, height);
    const pixelMatrix = pickMatrix(matrix, 2 * x - 1, 1 - 2 * y, width, height);
    const pixel = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickBuffer.framebuffer);
    const ditherEnabled = gl.isEnabled(gl.DITHER);
    try {
      gl.viewport(0, 0, 1, 1);
      gl.disable(gl.DITHER);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.pickProgram);
      gl.uniformMatrix4fv(this.pickLoc.matrix, false, pixelMatrix);
      gl.enableVertexAttribArray(this.pickLoc.position);
      for (const part of this.geometry) {
        if (!part.visible) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, part.position);
        gl.vertexAttribPointer(this.pickLoc.position, 3, gl.FLOAT, false, 0, 0);
        gl.uniform3fv(this.pickLoc.color, part.pickColor);
        gl.uniform3fv(this.pickLoc.offset, part.offset);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.triangles);
        gl.drawElements(gl.TRIANGLES, part.triangleCount, gl.UNSIGNED_SHORT, 0);
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    } finally {
      if (ditherEnabled) gl.enable(gl.DITHER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width || width, this.canvas.height || height);
    }
    const id = decodePickColor(pixel);
    return id && this.geometry[id - 1]?.visible ? this.geometry[id - 1].meshId : null;
  }

  // Find a planar disk, cylindrical wall, or ordinary planar patch in STL.
  pickSurface(clientX, clientY, meshId = null) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || clientX < rect.left || clientY < rect.top ||
        clientX >= rect.right || clientY >= rect.bottom) return null;
    const id = meshId || this.pickMesh(clientX, clientY);
    if (!id) return null;
    const {eye} = this.cameraMatrix(rect.width, rect.height);
    const ray = rayForViewport(eye, this.target,
      clientX - rect.left, clientY - rect.top, rect.width, rect.height);
    if (!ray) return null;
    return measurementSurface(hitMeshGroup(this.geometry, id, ray));
  }

  // Semi-transparent selected surface overlays, not permanent recoloring of solids.
  // Dispose old GL buffers when selection changes or a new NX file is opened.
  setMeasureFaces(faces) {
    const gl = this.gl;
    for (const item of this.measureBuffers || []) {
      gl.deleteBuffer(item.fillPosition); gl.deleteBuffer(item.fillColor);
      gl.deleteBuffer(item.edgePosition); gl.deleteBuffer(item.edgeColor);
    }
    this.measureFaces = [...(faces || [])];
    this.measureBuffers = this.measureFaces.map((face, index) => {
      const palette = index ? [0.58, 0.27, 0.89] : [0.08, 0.51, 0.94];
      const fill = new Float32Array(face.positions.length / 3 * 4);
      for(let i=0;i<fill.length;i+=4) fill.set([...palette,0.20],i);
      // Weld shared edges and draw only the patch boundary; no triangle wireframe.
      const weld=Math.max(Math.max(...face.part.bounds.size)*1e-7,1e-8);
      const borders = new Map(), data = face.positions;
      const key=p=>p.map(v=>Math.round(v/weld)).join(',');
      for(let t=0;t<data.length;t+=9) {
        const points=Array.from({length:3},(_,j)=>Array.from(data.subarray(t+j*3,t+j*3+3)));
        for(let edge=0;edge<3;edge++) {
          const a=points[edge],b=points[(edge+1)%3],ka=key(a),kb=key(b);
          const k=ka<kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          if(!borders.has(k)) borders.set(k,{a,b,count:0});
          borders.get(k).count++;
        }
      }
      const edgeVertices=[];
      for(const border of borders.values()) if(border.count===1) edgeVertices.push(...border.a,...border.b);
      const edges=new Float32Array(edgeVertices);
      const edgeColors=new Float32Array(edges.length/3*4);
      for(let i=0;i<edgeColors.length;i+=4) edgeColors.set([...palette,0.94],i);
      return {part:face.part,fillPosition:createBuffer(gl,face.positions),
        fillColor:createBuffer(gl,fill),fillCount:face.positions.length/3,
        edgePosition:createBuffer(gl,edges),edgeColor:createBuffer(gl,edgeColors),
        edgeCount:edges.length/3};
    });
    this.requestRender();
  }

  updateGrid() {
    const gl = this.gl;
    if (this.gridBuffers) {
      for (const buffer of Object.values(this.gridBuffers)) {
        if (buffer instanceof WebGLBuffer) gl.deleteBuffer(buffer);
      }
    }
    const lines = makeGrid(this.bounds, this.geometry.length === 0);
    const datum = makeDatum(this.bounds, this.geometry.length === 0);
    this.gridSize = 2 * lines.extent;
    this.datumLabels = datum.labels;
    this.gridBuffers = {
      position: createBuffer(gl, new Float32Array(lines.positions)),
      color: createBuffer(gl, new Float32Array(lines.colors)),
      count: lines.positions.length / 3,
      axesPosition: createBuffer(gl, new Float32Array(datum.axesPositions)),
      axesColor: createBuffer(gl, new Float32Array(datum.axesColors)),
      axesCount: datum.axesPositions.length / 3,
      planePosition: createBuffer(gl, new Float32Array(datum.planePositions)),
      planeColor: createBuffer(gl, new Float32Array(datum.planeColors)),
      planeCount: datum.planePositions.length / 3,
      outlinePosition: createBuffer(gl, new Float32Array(datum.outlinePositions)),
      outlineColor: createBuffer(gl, new Float32Array(datum.outlineColors)),
      outlineCount: datum.outlinePositions.length / 3,
    };
  }

  setView(view) {
    const angles = {
      iso: [PI / 4, 0.46],
      front: [0, 0],
      top: [0, PI / 2 - 0.0001],
      right: [PI / 2, 0],
    };
    if (!Object.hasOwn(angles, view)) throw new Error('Unknown camera view');
    [this.yaw, this.pitch] = angles[view];
    this.fit();
  }

  fit(overrideBounds = null) {
    if (this.geometry.length === 0) {
      this.target = [0, 0, 0];
      this.distance = EMPTY_VIEW_DISTANCE;
      this.requestRender();
      return;
    }

    const { min, max, center, size } = overrideBounds || this.getVisibleBounds();
    this.target = center.slice();
    const rect = this.canvas.getBoundingClientRect();
    const aspect = Math.max(0.3, rect.width / Math.max(1, rect.height));
    const tangentVertical = Math.tan(PI / 8);
    const tangentHorizontal = tangentVertical * aspect;
    const outward = normalize([
      Math.cos(this.pitch) * Math.sin(this.yaw),
      Math.sin(this.pitch),
      Math.cos(this.pitch) * Math.cos(this.yaw),
    ]);
    const right = normalize(cross([0, 1, 0], outward));
    const up = cross(outward, right);
    const clearance = Math.max(0.1, Math.hypot(...size) * 0.03);
    let distance = 0;

    // Account for all eight corners, not just the model's largest dimension.
    // Every corner stays inside both the vertical and horizontal view angles.
    for (const x of [min[0], max[0]]) {
      for (const y of [min[1], max[1]]) {
        for (const z of [min[2], max[2]]) {
          const offset = [x - center[0], y - center[1], z - center[2]];
          const sideways = Math.abs(dot(offset, right)) / tangentHorizontal;
          const upward = Math.abs(dot(offset, up)) / tangentVertical;
          distance = Math.max(distance, dot(offset, outward) +
            Math.max(MODEL_FIT_MARGIN * sideways, MODEL_FIT_MARGIN * upward, clearance));
        }
      }
    }
    this.distance = clamp(distance, 0.5, 1e9);
    this.requestRender();
  }


  // Focus on the measured finite patches, not the entire assembly. Retain the
  // current camera orientation and include their current Move/Explode offsets.
  fitMeasureFaces(faces, guidePoints=[]) {
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    let count=0;
    for(const face of faces || []) {
      if(!face?.part?.visible)continue;
      const positions=face.positions;
      const offset=face.part.offset || [0,0,0];
      if(positions?.length) {
        for(let i=0;i+2<positions.length;i+=3) {
          for(let k=0;k<3;k++) {
            const value=positions[i+k]+offset[k];
            min[k]=Math.min(min[k],value);max[k]=Math.max(max[k],value);
          }
          count++;
        }
      } else {
        const point=face.localCenter || face.localPoint || face.point;
        if(!point)continue;
        const center=(face.localCenter || face.localPoint) ? point.map((v,i)=>v+offset[i]) : point;
        const radius=face.radius || 0;
        for(let k=0;k<3;k++) {
          min[k]=Math.min(min[k],center[k]-radius);
          max[k]=Math.max(max[k],center[k]+radius);
        }
        count++;
      }
    }
    // An infinite supporting-plane guide may extend outside the bounded
    // selected patch. Keep the measurement endpoints visible too.
    for(const point of guidePoints) {
      if(!point || point.some(v=>!Number.isFinite(v)))continue;
      for(let k=0;k<3;k++) {
        min[k]=Math.min(min[k],point[k]);max[k]=Math.max(max[k],point[k]);
      }
      count++;
    }
    if(!count)return false;
    const center=min.map((v,i)=>(v+max[i])/2);
    const size=min.map((v,i)=>Math.max(1e-6,max[i]-v));
    const padding=Math.max(...size)*0.16;
    const paddedMin=min.map(v=>v-padding),paddedMax=max.map(v=>v+padding);
    this.fit({min:paddedMin,max:paddedMax,center,
      size:paddedMin.map((v,i)=>paddedMax[i]-v)});
    return true;
  }

  attachControls() {
    const canvas = this.canvas;
    let drag = null;
    let pendingHover = null;
    let hoverScheduled = false;
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.button !== 2) return;
      drag = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
        moved: false, pan: event.button === 2 || event.shiftKey };
      this.onHoverMesh?.(null);
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag) {
        if (event.pointerType === 'touch') return;
        pendingHover = [event.clientX, event.clientY];
        if (!hoverScheduled) {
          hoverScheduled = true;
          const sampleHover = () => requestAnimationFrame(() => {
            hoverScheduled = false;
            if (!drag && pendingHover) {
              this.lastHoverPickAt = Date.now();
              const id = this.pickMesh(...pendingHover);
              this.onHoverMesh?.(id);
              this.canvas.style.cursor = this.measureActive ? 'crosshair' : id ? 'pointer' : 'grab';
            }
          });
          // Picking redraws mesh vertices. Cap hover samples to ~12 Hz;
          // click selection is immediate and always uses the current cursor.
          const wait = Math.max(0, 80 - (Date.now() - (this.lastHoverPickAt || 0)));
          if (wait) setTimeout(sampleHover, wait);
          else sampleHover();
        }
        return;
      }
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) drag.moved = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.pan) {
        const outward = normalize([Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)]);
        const right = normalize(cross([0, 1, 0], outward));
        const up = normalize(cross(outward, right));
        const scale = (this.distance * Math.tan(PI / 8) * 2) / Math.max(1, canvas.clientHeight);
        this.target = this.target.map((value, i) => value - right[i] * dx * scale + up[i] * dy * scale);
      } else {
        this.yaw = (this.yaw - dx * 0.006) % TAU;
        this.pitch = clamp(this.pitch + dy * 0.006, -PI / 2 + 0.01, PI / 2 - 0.01);
      }
      this.requestRender();
    });
    canvas.addEventListener('pointerup', event => {
      const click = drag && event.button === 0 && !drag.pan && !drag.moved;
      drag = null;
      if (click) this.onSelectMesh?.(this.pickMesh(event.clientX, event.clientY), event.clientX, event.clientY);
    });
    for (const type of ['pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, () => { drag = null; });
    }
    canvas.addEventListener('pointerleave', () => {
      pendingHover = null;
      this.canvas.style.cursor = this.measureActive ? 'crosshair' : 'grab';
      this.onHoverMesh?.(null);
    });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.distance = clamp(this.distance * Math.exp(event.deltaY * 0.00125), 0.3, 50000);
      this.requestRender();
    }, { passive: false });
  }

  requestRender() {
    if (this.pendingRender) return;
    this.pendingRender = true;
    requestAnimationFrame(() => { this.pendingRender = false; this.render(); });
  }

  render() {
    const canvas = this.canvas, gl = this.gl;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    const { eye, matrix } = this.cameraMatrix(width, height);
    if (this.showGrid) this.renderLines(this.gridBuffers.position, this.gridBuffers.color, this.gridBuffers.count, matrix);
    if (this.showAxes) this.renderLines(this.gridBuffers.planePosition,
      this.gridBuffers.planeColor, this.gridBuffers.planeCount, matrix, gl.TRIANGLES);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.useProgram(this.solid);
    gl.uniformMatrix4fv(this.solidLoc.matrix, false, matrix);
    gl.uniform1f(this.solidLoc.wire, this.wireframe ? 1 : 0);
    gl.uniform3fv(this.solidLoc.eye, eye);
    // Draw opaque components first with depth writes, then transparent components
    // back-to-front with blending and depth reads only. This allows rear solid
    // components to remain visible through a selected translucent component.
    const visible = this.geometry.filter(part => part.visible);
    const opaque = visible.filter(part => (part.opacity ?? 1) >= 0.999);
    const transparent = visible.filter(part => (part.opacity ?? 1) < 0.999).sort((a, b) => {
      const squared = part => part.bounds.center.reduce((total, value, i) =>
        total + Math.pow(value + part.offset[i] - eye[i], 2), 0);
      return squared(b) - squared(a);
    });
    const drawSurface = part => {
      gl.bindBuffer(gl.ARRAY_BUFFER, part.position);
      gl.enableVertexAttribArray(this.solidLoc.position);
      gl.vertexAttribPointer(this.solidLoc.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, part.normal);
      gl.enableVertexAttribArray(this.solidLoc.normal);
      gl.vertexAttribPointer(this.solidLoc.normal, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(this.solidLoc.color,
        this.componentColorsEnabled && part.componentColor ? part.componentColor : part.color);
      gl.uniform3fv(this.solidLoc.offset, part.offset);
      gl.uniform1f(this.solidLoc.opacity, part.opacity ?? 1);
      gl.uniform1f(this.solidLoc.highlight, this.selectedMeshIds.has(part.meshId) ? 2 :
        this.hoveredMeshIds.has(part.meshId) ? 1 : 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.wireframe ? part.edges : part.triangles);
      gl.drawElements(this.wireframe ? gl.LINES : gl.TRIANGLES,
        this.wireframe ? part.edgeCount : part.triangleCount, gl.UNSIGNED_SHORT, 0);
    };
    for (const part of opaque) drawSurface(part);
    if (transparent.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const part of transparent) drawSurface(part);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (!this.wireframe) {
      for (const part of opaque) {
        if (part.creaseCount) this.renderLines(part.creasePosition, part.creaseColor,
          part.creaseCount, matrix, gl.LINES, part.offset);
      }
      for (const part of transparent) {
        if (part.creaseCount) this.renderLines(part.creasePosition, part.glassCreaseColor || part.creaseColor,
          part.creaseCount, matrix, gl.LINES, part.offset, Math.max(0.58, part.opacity ?? 1));
      }
    }
    if (this.measureBuffers?.length) {
      // Keep both selected planes inspectable even when one lies inside glass.
      gl.disable(gl.DEPTH_TEST);
      for (const item of this.measureBuffers) {
        if (!item.part.visible) continue;
        this.renderLines(item.fillPosition, item.fillColor, item.fillCount, matrix, gl.TRIANGLES, item.part.offset);
        if (item.edgeCount) this.renderLines(item.edgePosition, item.edgeColor, item.edgeCount, matrix, gl.LINES, item.part.offset);
      }
      gl.enable(gl.DEPTH_TEST);
    }
    if (this.showAxes) {
      this.renderLines(this.gridBuffers.outlinePosition,
        this.gridBuffers.outlineColor, this.gridBuffers.outlineCount, matrix);
      this.renderLines(this.gridBuffers.axesPosition,
        this.gridBuffers.axesColor, this.gridBuffers.axesCount, matrix);
    }
    this.renderAxisLabels(matrix, bounds);
    this.renderCompass();
    this.onFrame?.();
  }

  renderAxisLabels(matrix, bounds) {
    if (!this.axisLabels || !this.datumLabels) return;
    for (let i = 0; i < this.axisLabels.length; i += 1) {
      const label = this.axisLabels[i];
      if (!label) continue;
      const p = this.datumLabels[i];
      const w = matrix[3]*p[0] + matrix[7]*p[1] + matrix[11]*p[2] + matrix[15];
      const x = (matrix[0]*p[0] + matrix[4]*p[1] + matrix[8]*p[2] + matrix[12]) / w;
      const y = (matrix[1]*p[0] + matrix[5]*p[1] + matrix[9]*p[2] + matrix[13]) / w;
      const visible = this.showAxes && w > 0 && Math.abs(x) < 0.98 && Math.abs(y) < 0.98;
      label.hidden = !visible;
      if (visible) {
        label.style.left = `${(x * 0.5 + 0.5) * bounds.width}px`;
        label.style.top = `${(0.5 - y * 0.5) * bounds.height}px`;
      }
    }
  }

  renderCompass() {
    // Project the NX axis directions into the camera's screen basis.
    const outward = normalize([
      Math.cos(this.pitch) * Math.sin(this.yaw),
      Math.sin(this.pitch),
      Math.cos(this.pitch) * Math.cos(this.yaw),
    ]);
    const right = normalize(cross([0, 1, 0], outward));
    const up = cross(outward, right);
    for (let i = 0; i < NX_AXIS_DIRECTIONS.length; i += 1) {
      const axis = NX_AXIS_DIRECTIONS[i];
      const x = dot(axis, right), y = -dot(axis, up);
      const magnitude = Math.hypot(x, y);
      const size = Math.max(4, magnitude * 19);
      const line = this.compassAxes?.[i];
      const label = this.compassLabels?.[i];
      if (line) {
        line.style.width = `${size}px`;
        line.style.transform = `translateY(-50%) rotate(${Math.atan2(y, x)}rad)`;
      }
      if (label) {
        label.style.left = `${32 + x * 25}px`;
        label.style.top = `${32 + y * 25}px`;
      }
    }
  }

  renderLines(position, color, count, matrix, primitive = this.gl.LINES, offset = [0, 0, 0], opacity = 1) {
    const gl = this.gl;
    gl.useProgram(this.lines);
    gl.uniformMatrix4fv(this.lineLoc.matrix, false, matrix);
    gl.uniform3fv(this.lineLoc.offset, offset);
    gl.uniform1f(this.lineLoc.opacity, opacity);
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.enableVertexAttribArray(this.lineLoc.position);
    gl.vertexAttribPointer(this.lineLoc.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, color);
    gl.enableVertexAttribArray(this.lineLoc.color);
    gl.vertexAttribPointer(this.lineLoc.color, 4, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(primitive, 0, count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
