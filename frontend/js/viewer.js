import { boundsFor } from './geometry.js';

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
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vNormal = aNormal;
  vPosition = aPosition;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;
const SOLID_FRAGMENT = `
precision mediump float;
uniform vec3 uColor;
uniform vec3 uEye;
uniform float uWire;
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vec3 normal = normalize(vNormal);
  vec3 eyeDir = normalize(uEye - vPosition);
  if (!gl_FrontFacing) normal = -normal;
  vec3 keyDir = normalize(vec3(-0.48, 0.84, 0.32));
  vec3 fillDir = normalize(vec3(0.75, 0.15, -0.62));
  float key = max(dot(normal, keyDir), 0.0);
  float fill = max(dot(normal, fillDir), 0.0);
  float diffuse = 0.43 + 0.44 * key + 0.16 * fill;
  float specular = pow(max(dot(reflect(-keyDir, normal), eyeDir), 0.0), 32.0) * 0.42;
  specular += pow(max(dot(reflect(-fillDir, normal), eyeDir), 0.0), 22.0) * 0.11;
  float rim = pow(1.0 - max(dot(normal, eyeDir), 0.0), 3.0) * 0.08;
  vec3 silver = uColor * diffuse + vec3(specular + rim);
  gl_FragColor = vec4(mix(silver, vec3(0.36, 0.41, 0.47), uWire), 1.0);
}`;
const LINE_VERTEX = `
attribute vec3 aPosition;
attribute vec4 aColor;
uniform mat4 uViewProjection;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;
const LINE_FRAGMENT = `
precision mediump float;
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;

function createBuffer(gl, data, target = gl.ARRAY_BUFFER) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return buffer;
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
    this.solidLoc = {
      position: gl.getAttribLocation(this.solid, 'aPosition'),
      normal: gl.getAttribLocation(this.solid, 'aNormal'),
      matrix: gl.getUniformLocation(this.solid, 'uViewProjection'),
      color: gl.getUniformLocation(this.solid, 'uColor'),
      wire: gl.getUniformLocation(this.solid, 'uWire'),
      eye: gl.getUniformLocation(this.solid, 'uEye'),
    };
    this.lineLoc = {
      position: gl.getAttribLocation(this.lines, 'aPosition'),
      color: gl.getAttribLocation(this.lines, 'aColor'),
      matrix: gl.getUniformLocation(this.lines, 'uViewProjection'),
    };
    this.geometry = [];
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
    }
    this.geometry = meshes.map(item => {
      if (item.positions.length / 3 > 65535) throw new Error('Mesh exceeds the current index limit');
      const edges = getEdges(item.indices);
      return {
        position: createBuffer(gl, item.positions),
        normal: createBuffer(gl, item.normals),
        triangles: createBuffer(gl, item.indices, gl.ELEMENT_ARRAY_BUFFER),
        triangleCount: item.indices.length,
        edges: createBuffer(gl, edges, gl.ELEMENT_ARRAY_BUFFER),
        edgeCount: edges.length,
        color: colorFromHex(item.color),
        meshId: item.meshId || 'root',
        visible: true,
      };
    });
    this.bounds = boundsFor(meshes);
    this.updateGrid();
    this.setView('iso');
  }

  setMeshVisible(meshId, visible) {
    for (const item of this.geometry) {
      if (item.meshId === meshId) item.visible = visible;
    }
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

  fit() {
    if (this.geometry.length === 0) {
      this.target = [0, 0, 0];
      this.distance = EMPTY_VIEW_DISTANCE;
      this.requestRender();
      return;
    }

    const { min, max, center, size } = this.bounds;
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

  attachControls() {
    const canvas = this.canvas;
    let drag = null;
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.button !== 2) return;
      drag = { x: event.clientX, y: event.clientY, pan: event.button === 2 || event.shiftKey };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
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
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, () => { drag = null; });
    }
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
    const eye = [
      this.target[0] + this.distance * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * Math.cos(this.pitch) * Math.cos(this.yaw),
    ];
    const matrix = multiply(
      perspective(PI / 4, width / height, Math.max(0.01, this.distance / 2000), Math.max(200, this.distance * 75)),
      lookAt(eye, this.target),
    );
    if (this.showGrid) this.renderLines(this.gridBuffers.position, this.gridBuffers.color, this.gridBuffers.count, matrix);
    if (this.showAxes) this.renderLines(this.gridBuffers.planePosition,
      this.gridBuffers.planeColor, this.gridBuffers.planeCount, matrix, gl.TRIANGLES);
    gl.useProgram(this.solid);
    gl.uniformMatrix4fv(this.solidLoc.matrix, false, matrix);
    gl.uniform1f(this.solidLoc.wire, this.wireframe ? 1 : 0);
    gl.uniform3fv(this.solidLoc.eye, eye);
    for (const part of this.geometry) {
      if (!part.visible) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, part.position);
      gl.enableVertexAttribArray(this.solidLoc.position);
      gl.vertexAttribPointer(this.solidLoc.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, part.normal);
      gl.enableVertexAttribArray(this.solidLoc.normal);
      gl.vertexAttribPointer(this.solidLoc.normal, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(this.solidLoc.color, part.color);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.wireframe ? part.edges : part.triangles);
      gl.drawElements(this.wireframe ? gl.LINES : gl.TRIANGLES,
        this.wireframe ? part.edgeCount : part.triangleCount, gl.UNSIGNED_SHORT, 0);
    }
    if (this.showAxes) {
      this.renderLines(this.gridBuffers.outlinePosition,
        this.gridBuffers.outlineColor, this.gridBuffers.outlineCount, matrix);
      this.renderLines(this.gridBuffers.axesPosition,
        this.gridBuffers.axesColor, this.gridBuffers.axesCount, matrix);
    }
    this.renderAxisLabels(matrix, bounds);
    this.renderCompass();
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

  renderLines(position, color, count, matrix, primitive = this.gl.LINES) {
    const gl = this.gl;
    gl.useProgram(this.lines);
    gl.uniformMatrix4fv(this.lineLoc.matrix, false, matrix);
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
