import * as THREE from './three.module.js';

/* =========================================================
   FY-01 TEARDOWN LAB
   A hand-built, component-accurate Three.js desktop PC.
   All geometry, materials, textures and interaction are
   generated at runtime — no external 3D assets.
   ========================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

const DEG = Math.PI / 180;
const CASE_W = 232;
const CASE_H = 258;
const CASE_D = 238;

const state = {
  ready: false,
  hovered: null,
  selected: null,
  filter: 'all',
  labels: true,
  autoRotate: false,
  busy: false,
  screwCount: 0,
  totalRemovable: 0,
  sequenceToken: 0,
  explodedCount: 0,
  mobilePartsOpen: false,
};

const parts = new Map();
const partsOrder = [];
const pickables = [];
const tweens = new Set();
const fanSpinners = [];
const rgbTargets = [];
const lcdScreens = [];
const cableGroups = [];
const labelEntries = [];
const dustPoints = [];
const tempVec = new THREE.Vector3();
const tempVec2 = new THREE.Vector3();
const tempBox = new THREE.Box3();

let scene;
let camera;
let renderer;
let pcRoot;
let raycaster;
let pointer;
let clock;
let envTexture;
let hoverCage;
let selectedCage;
let debrisGroup;
let glowTexture;

/* ------------------------------------------------------------------ */
/* DOM references                                                      */
/* ------------------------------------------------------------------ */

const dom = {
  canvas: $('#scene'),
  loading: $('#loading'),
  loadingBar: $('#loadingBar'),
  loadingPct: $('#loadingPct'),
  partsList: $('#partsList'),
  filterRow: $('#filterRow'),
  progressRing: $('#progressRing'),
  progressNum: $('#progressNum'),
  progressTotal: $('#progressTotal'),
  overviewTitle: $('#overviewTitle'),
  overviewDesc: $('#overviewDesc'),
  screwCount: $('#screwCount'),
  detailEmpty: $('#detailEmpty'),
  detailContent: $('#detailContent'),
  detailPanelTitle: $('#detailPanelTitle'),
  detailCategory: $('#detailCategory'),
  detailStatus: $('#detailStatus'),
  detailIcon: $('#detailIcon'),
  detailIndex: $('#detailIndex'),
  detailName: $('#detailName'),
  detailSub: $('#detailSub'),
  detailDesc: $('#detailDesc'),
  specGrid: $('#specGrid'),
  detailTeardown: $('#detailTeardown'),
  detailScrews: $('#detailScrews'),
  detailScrewText: $('#detailScrewText'),
  detailHero: $('#detailHero'),
  togglePartBtn: $('#togglePartBtn'),
  focusPartBtn: $('#focusPartBtn'),
  detailBack: $('#detailBack'),
  labelLayer: $('#labelLayer'),
  labelLines: $('#labelLines'),
  hoverTip: $('#hoverTip'),
  hoverName: $('#hoverName'),
  hoverSpec: $('#hoverSpec'),
  toastStack: $('#toastStack'),
  footStatus: $('#footStatus'),
  guideToast: $('#guideToast'),
  guideModal: $('#guideModal'),
  partsPanel: $('#partsPanel'),
  detailPanel: $('#detailPanel'),
  filterButtons: $$('.filter-btn'),
  viewButtons: $$('.view-btn'),
};

/* ------------------------------------------------------------------ */
/* Utility: canvas texture helpers                                     */
/* ------------------------------------------------------------------ */

function makeCanvasTexture(width, height, draw, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  tex.needsUpdate = true;
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function textTexture(lines, opts = {}) {
  const {
    width = 512,
    height = 256,
    bg = null,
    color = '#ffffff',
    accent = null,
    font = '700 52px "Segoe UI", "Microsoft YaHei", sans-serif',
    subFont = '500 20px "Segoe UI", "Microsoft YaHei", sans-serif',
    align = 'left',
    padding = 36,
  } = opts;
  return makeCanvasTexture(width, height, (ctx, w, h) => {
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    if (accent) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(padding, h - padding);
      ctx.lineTo(w - padding, h - padding);
      ctx.stroke();
    }
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    const x = align === 'center' ? w / 2 : padding;
    const arr = Array.isArray(lines) ? lines : [{ text: lines }];
    const each = h / (arr.length + 0.35);
    arr.forEach((line, i) => {
      const item = typeof line === 'string' ? { text: line } : line;
      ctx.fillStyle = item.color || color;
      ctx.font = item.font || font;
      ctx.globalAlpha = item.alpha ?? 1;
      ctx.fillText(item.text, x, h * 0.2 + each * i + each * 0.45);
    });
    ctx.globalAlpha = 1;
  });
}

function labelTexture(text, opts = {}) {
  const {
    width = 512,
    height = 128,
    color = '#1b2c44',
    font = '650 44px "Segoe UI", "Microsoft YaHei", sans-serif',
    align = 'left',
    letterSpacing = 0,
  } = opts;
  return makeCanvasTexture(width, height, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    ctx.textAlign = align;
    ctx.font = font;
    ctx.fillStyle = color;
    if (letterSpacing) {
      const chars = [...text];
      let total = chars.reduce((s, c) => s + ctx.measureText(c).width + letterSpacing, 0) - letterSpacing;
      let x = align === 'center' ? (w - total) / 2 : align === 'right' ? w - total - 20 : 20;
      chars.forEach((c) => {
        ctx.fillText(c, x, h / 2 + 2);
        x += ctx.measureText(c).width + letterSpacing;
      });
    } else {
      const x = align === 'center' ? w / 2 : align === 'right' ? w - 20 : 20;
      ctx.fillText(text, x, h / 2 + 2);
    }
  });
}

function makeGlowTexture() {
  return makeCanvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.92)');
    g.addColorStop(0.18, 'rgba(141,207,255,0.58)');
    g.addColorStop(0.5, 'rgba(76,140,255,0.17)');
    g.addColorStop(1, 'rgba(76,140,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/* ------------------------------------------------------------------ */
/* Utility: geometry                                                   */
/* ------------------------------------------------------------------ */

const geoCache = new Map();

function roundedRectShape(w, h, r) {
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  const rr = Math.min(r, w / 2, h / 2);
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

function roundedBoxGeometry(w, h, d, radius = 1.5, bevel = true) {
  const key = `rb-${w}-${h}-${d}-${radius}-${bevel}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const shape = roundedRectShape(w, h, radius);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.1, d - (bevel ? radius * 1.2 : 0)),
    bevelEnabled: bevel,
    bevelSegments: 3,
    bevelSize: bevel ? Math.min(radius * 0.45, 1.8) : 0,
    bevelThickness: bevel ? Math.min(radius * 0.45, 1.8) : 0,
    curveSegments: 5,
    steps: 1,
  });
  geo.translate(0, 0, -d / 2 + (bevel ? radius * 0.0 : 0));
  geo.computeVertexNormals();
  geoCache.set(key, geo);
  return geo;
}

function box(w, h, d, mat, pos = [0, 0, 0], opts = {}) {
  const geo = opts.round
    ? roundedBoxGeometry(w, h, d, opts.round, opts.bevel !== false)
    : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  if (opts.rot) mesh.rotation.set(...opts.rot);
  mesh.castShadow = opts.cast !== false;
  mesh.receiveShadow = opts.receive !== false;
  if (opts.userData) Object.assign(mesh.userData, opts.userData);
  return mesh;
}

function cylinder(rt, rb, h, seg, mat, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const geo = new THREE.CylinderGeometry(rt, rb, h, seg);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addEdges(mesh, color = 0xb9c7d9, opacity = 0.4) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 24),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  edges.raycast = () => {};
  mesh.add(edges);
  return edges;
}

function makePlane(w, h, material, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.userData.pickable = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

const M = {
  white: new THREE.MeshPhysicalMaterial({
    color: 0xeef3f9,
    roughness: 0.32,
    metalness: 0.1,
    clearcoat: 0.72,
    clearcoatRoughness: 0.24,
    envMapIntensity: 0.8,
  }),
  whiteSoft: new THREE.MeshStandardMaterial({
    color: 0xdde5ef,
    roughness: 0.58,
    metalness: 0.03,
  }),
  whiteMetal: new THREE.MeshPhysicalMaterial({
    color: 0xd4deea,
    roughness: 0.26,
    metalness: 0.7,
    clearcoat: 0.48,
    clearcoatRoughness: 0.24,
  }),
  brightMetal: new THREE.MeshStandardMaterial({
    color: 0xb9c6d5,
    roughness: 0.22,
    metalness: 0.92,
  }),
  coolerFin: new THREE.MeshStandardMaterial({
    color: 0xd8e2ed,
    roughness: 0.3,
    metalness: 0.78,
    side: THREE.DoubleSide,
  }),
  steel: new THREE.MeshStandardMaterial({
    color: 0xaab6c5,
    roughness: 0.25,
    metalness: 0.95,
  }),
  darkSteel: new THREE.MeshStandardMaterial({
    color: 0x4b5868,
    roughness: 0.3,
    metalness: 0.88,
  }),
  gold: new THREE.MeshStandardMaterial({
    color: 0xd8aa4c,
    roughness: 0.28,
    metalness: 0.92,
  }),
  copper: new THREE.MeshStandardMaterial({
    color: 0xc07b4d,
    roughness: 0.26,
    metalness: 0.9,
  }),
  nickel: new THREE.MeshStandardMaterial({
    color: 0xc9d0d8,
    roughness: 0.2,
    metalness: 0.95,
  }),
  black: new THREE.MeshStandardMaterial({
    color: 0x11161e,
    roughness: 0.48,
    metalness: 0.18,
  }),
  blackGloss: new THREE.MeshPhysicalMaterial({
    color: 0x0a0f16,
    roughness: 0.16,
    metalness: 0.4,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
  }),
  graphite: new THREE.MeshStandardMaterial({
    color: 0x2a3039,
    roughness: 0.52,
    metalness: 0.35,
  }),
  pcbWhite: new THREE.MeshStandardMaterial({
    color: 0xdde7f1,
    roughness: 0.54,
    metalness: 0.12,
  }),
  pcbGreen: new THREE.MeshStandardMaterial({
    color: 0x1f4d3c,
    roughness: 0.46,
    metalness: 0.2,
  }),
  pcbBlack: new THREE.MeshStandardMaterial({
    color: 0x171a20,
    roughness: 0.48,
    metalness: 0.2,
  }),
  plasticBlack: new THREE.MeshStandardMaterial({
    color: 0x181b20,
    roughness: 0.66,
    metalness: 0.02,
  }),
  plasticDark: new THREE.MeshStandardMaterial({
    color: 0x262b32,
    roughness: 0.7,
    metalness: 0.03,
  }),
  rubber: new THREE.MeshStandardMaterial({
    color: 0x1f242d,
    roughness: 0.92,
    metalness: 0,
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xcfe6ff,
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.5,
    side: THREE.DoubleSide,
    depthWrite: false,
    premultipliedAlpha: false,
  }),
  glassEdge: new THREE.MeshBasicMaterial({
    color: 0x81b4e8,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  }),
  screenBlack: new THREE.MeshBasicMaterial({ color: 0x07111f }),
  ledWhite: new THREE.MeshBasicMaterial({ color: 0xf5fbff }),
  wire: new THREE.MeshStandardMaterial({
    color: 0xd4dbe3,
    roughness: 0.5,
    metalness: 0.45,
  }),
  cableWhite: new THREE.MeshStandardMaterial({
    color: 0xf1f3f6,
    roughness: 0.7,
    metalness: 0,
  }),
  cableDark: new THREE.MeshStandardMaterial({
    color: 0x303642,
    roughness: 0.75,
    metalness: 0.05,
  }),
  thermalPad: new THREE.MeshStandardMaterial({
    color: 0x9ecde0,
    roughness: 0.8,
    metalness: 0,
    transparent: true,
    opacity: 0.85,
  }),
  foam: new THREE.MeshStandardMaterial({
    color: 0x1f2630,
    roughness: 1,
    metalness: 0,
  }),
};

function emissive(color, intensity = 1, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: opts.base ?? color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: opts.roughness ?? 0.36,
    metalness: opts.metalness ?? 0.1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

function initScene() {
  renderer = new THREE.WebGLRenderer({
    canvas: dom.canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xeaf2fb, 0.00065);

  camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 5000);

  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2(-10, -10);

  pcRoot = new THREE.Group();
  pcRoot.name = 'FY-01';
  scene.add(pcRoot);

  debrisGroup = new THREE.Group();
  scene.add(debrisGroup);

  envTexture = buildEnvironmentTexture();
  scene.environment = envTexture;

  setupLights();
  buildBackdrop();
  setupCages();

  glowTexture = makeGlowTexture();

  // initial camera orbit values
  const s = sphericalFromCamera(new THREE.Vector3(-238, 369, 718), new THREE.Vector3(0, 4, 0));
  controls.theta = controls.thetaGoal = s.theta;
  controls.phi = controls.phiGoal = s.phi;
  controls.radius = controls.radiusGoal = s.radius;
  controls.target.set(0, 4, 0);
  controls.targetGoal.set(0, 4, 0);
  if (window.innerWidth / window.innerHeight < 0.82) {
    controls.radius = controls.radiusGoal = 1420;
    controls.phi = controls.phiGoal = 1.16;
  }
  updateCamera(true);
}

function buildEnvironmentTexture() {
  return makeCanvasTexture(1024, 512, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#fbfdff');
    sky.addColorStop(0.32, '#e8f2ff');
    sky.addColorStop(0.55, '#d6e8fb');
    sky.addColorStop(0.72, '#eef3fa');
    sky.addColorStop(1, '#f8fafc');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // soft studio light panels
    const panels = [
      { x: 130, y: 120, w: 250, h: 70, a: 0.95, c: '#ffffff' },
      { x: 730, y: 80, w: 190, h: 52, a: 0.85, c: '#f6fbff' },
      { x: 450, y: 190, w: 300, h: 38, a: 0.5, c: '#dcecff' },
      { x: 50, y: 310, w: 180, h: 30, a: 0.35, c: '#c8dcf7' },
      { x: 820, y: 300, w: 150, h: 25, a: 0.3, c: '#e2d3ff' },
    ];
    panels.forEach((p) => {
      const g = ctx.createLinearGradient(p.x, p.y, p.x + p.w, p.y + p.h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, p.c);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = p.a;
      ctx.fillStyle = g;
      roundRect(ctx, p.x, p.y, p.w, p.h, p.h / 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // subtle cool orb reflections
    const orb = ctx.createRadialGradient(850, 190, 0, 850, 190, 190);
    orb.addColorStop(0, 'rgba(190,205,255,0.5)');
    orb.addColorStop(1, 'rgba(190,205,255,0)');
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, w, h);

    // floor band
    const floor = ctx.createLinearGradient(0, h * 0.62, 0, h);
    floor.addColorStop(0, 'rgba(225,235,248,0)');
    floor.addColorStop(0.55, 'rgba(220,231,245,0.8)');
    floor.addColorStop(1, 'rgba(240,244,250,0.95)');
    ctx.fillStyle = floor;
    ctx.fillRect(0, h * 0.62, w, h * 0.38);
  });
}

function setupLights() {
  const hemi = new THREE.HemisphereLight(0xffffff, 0xa9b8cc, 1.0);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(330, 520, 420);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -380;
  key.shadow.camera.right = 380;
  key.shadow.camera.top = 380;
  key.shadow.camera.bottom = -380;
  key.shadow.camera.near = 80;
  key.shadow.camera.far = 1400;
  key.shadow.bias = -0.00045;
  key.shadow.normalBias = 1.8;
  key.shadow.radius = 4;
  scene.add(key);
  scene.add(key.target);

  const fill = new THREE.DirectionalLight(0xbcd8ff, 0.86);
  fill.position.set(-420, 180, 300);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xd7c8ff, 0.9);
  rim.position.set(-180, 320, -420);
  scene.add(rim);

  const front = new THREE.PointLight(0x9fd7ff, 16, 900, 2);
  front.position.set(-190, 120, 360);
  scene.add(front);

  const warm = new THREE.PointLight(0xffd6e7, 6, 620, 2);
  warm.position.set(260, -40, 240);
  scene.add(warm);

  const under = new THREE.PointLight(0x7fb7ff, 5, 500, 2);
  under.position.set(0, -140, 50);
  scene.add(under);
}

function buildBackdrop() {
  // soft contact shadow
  const shadowTex = makeCanvasTexture(512, 512, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 12, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(29,52,87,0.34)');
    g.addColorStop(0.38, 'rgba(39,65,105,0.17)');
    g.addColorStop(0.72, 'rgba(56,86,130,0.04)');
    g.addColorStop(1, 'rgba(56,86,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(620, 520),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -129.8;
  shadow.renderOrder = -2;
  shadow.userData.pickable = false;
  scene.add(shadow);

  // faint ground rings
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7aa5d8,
    transparent: true,
    opacity: 0.13,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  [200, 290, 390].forEach((r, i) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.8, 128), ringMat.clone());
    ring.material.opacity = 0.13 - i * 0.028;
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -129.4;
    ring.userData.pickable = false;
    scene.add(ring);
  });
  const dashed = new THREE.RingGeometry(338, 339, 128, 1, 0, Math.PI * 1.55);
  const dashMesh = new THREE.Mesh(
    dashed,
    new THREE.MeshBasicMaterial({ color: 0x6d9bd6, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
  );
  dashMesh.rotation.x = -Math.PI / 2;
  dashMesh.rotation.z = 0.6;
  dashMesh.position.y = -129.3;
  dashMesh.userData.pickable = false;
  scene.add(dashMesh);

  // dust motes
  const count = 150;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const radius = 220 + Math.random() * 520;
    const angle = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(angle) * radius;
    pos[i * 3 + 1] = -80 + Math.random() * 500;
    pos[i * 3 + 2] = Math.sin(angle) * radius * 0.65;
    sizes[i] = Math.random();
    dustPoints.push({
      baseY: pos[i * 3 + 1],
      speed: 1.2 + Math.random() * 3,
      phase: Math.random() * Math.PI * 2,
      amp: 3 + Math.random() * 10,
    });
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x6d9fd8,
    size: 1.45,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.userData.pickable = false;
  points.name = 'Dust';
  scene.add(points);
  state.dust = points;
}

/* ------------------------------------------------------------------ */
/* Orbit camera + cages                                                */
/* ------------------------------------------------------------------ */

const controls = {
  theta: 0,
  phi: 1.2,
  radius: 680,
  thetaGoal: 0,
  phiGoal: 1.2,
  radiusGoal: 680,
  target: new THREE.Vector3(0, 4, 0),
  targetGoal: new THREE.Vector3(0, 4, 0),
  auto: false,
};

function sphericalFromCamera(pos, target) {
  const d = pos.clone().sub(target);
  const radius = d.length();
  const phi = Math.acos(clamp(d.y / radius, -1, 1));
  const theta = Math.atan2(d.x, d.z);
  return { theta, phi, radius };
}

function updateCamera(instant = false) {
  if (instant) {
    controls.theta = controls.thetaGoal;
    controls.phi = controls.phiGoal;
    controls.radius = controls.radiusGoal;
    controls.target.copy(controls.targetGoal);
  }
  const sinPhi = Math.sin(controls.phi);
  camera.position.set(
    controls.target.x + controls.radius * sinPhi * Math.sin(controls.theta),
    controls.target.y + controls.radius * Math.cos(controls.phi),
    controls.target.z + controls.radius * sinPhi * Math.cos(controls.theta)
  );
  camera.lookAt(controls.target);
}

function dampCamera(dt) {
  if (controls.auto) controls.thetaGoal += dt * 0.16;
  controls.theta = damp(controls.theta, controls.thetaGoal, 8, dt);
  controls.phi = damp(controls.phi, controls.phiGoal, 8, dt);
  controls.radius = damp(controls.radius, controls.radiusGoal, 6, dt);
  controls.target.x = damp(controls.target.x, controls.targetGoal.x, 7, dt);
  controls.target.y = damp(controls.target.y, controls.targetGoal.y, 7, dt);
  controls.target.z = damp(controls.target.z, controls.targetGoal.z, 7, dt);
  updateCamera();
}

function setupCages() {
  hoverCage = createCornerCage(new THREE.Color(0x3b82f6), 0.35);
  hoverCage.visible = false;
  scene.add(hoverCage);

  selectedCage = createCornerCage(new THREE.Color(0x2f6df6), 0.95);
  selectedCage.visible = false;
  scene.add(selectedCage);
}

function createCornerCage(color, opacity) {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3 * 2 * 3), 3));
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 999;
  group.add(lines);
  const glowMat = new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color,
    transparent: true,
    opacity: opacity * 0.25,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.renderOrder = 998;
  group.add(glow);
  group.userData.lines = lines;
  group.userData.glow = glow;
  group.userData.mat = mat;
  group.userData.baseOpacity = opacity;
  return group;
}

function setCageToBox(cage, box3) {
  if (!cage || box3.isEmpty()) return;
  const size = box3.getSize(new THREE.Vector3());
  const center = box3.getCenter(new THREE.Vector3());
  const arr = cage.userData.lines.geometry.attributes.position.array;
  let idx = 0;
  const cornerLen = Math.max(2.5, Math.min(size.x, size.y, size.z) * 0.16);
  const min = box3.min;
  const max = box3.max;
  const corners = [
    [min.x, min.y, min.z, 1, 1, 1],
    [max.x, min.y, min.z, -1, 1, 1],
    [min.x, max.y, min.z, 1, -1, 1],
    [max.x, max.y, min.z, -1, -1, 1],
    [min.x, min.y, max.z, 1, 1, -1],
    [max.x, min.y, max.z, -1, 1, -1],
    [min.x, max.y, max.z, 1, -1, -1],
    [max.x, max.y, max.z, -1, -1, -1],
  ];
  corners.forEach(([x, y, z, sx, sy, sz]) => {
    arr[idx++] = x; arr[idx++] = y; arr[idx++] = z;
    arr[idx++] = x + sx * cornerLen; arr[idx++] = y; arr[idx++] = z;
    arr[idx++] = x; arr[idx++] = y; arr[idx++] = z;
    arr[idx++] = x; arr[idx++] = y + sy * cornerLen; arr[idx++] = z;
    arr[idx++] = x; arr[idx++] = y; arr[idx++] = z;
    arr[idx++] = x; arr[idx++] = y; arr[idx++] = z + sz * cornerLen;
  });
  cage.userData.lines.geometry.attributes.position.needsUpdate = true;
  cage.userData.lines.geometry.computeBoundingSphere();
  const glow = cage.userData.glow;
  glow.position.copy(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  glow.scale.setScalar(maxDim * 0.86);
}

function getPartBox(part, target = new THREE.Box3()) {
  target.makeEmpty();
  part.group.updateWorldMatrix(true, true);
  part.group.traverse((obj) => {
    if (!obj.isMesh || obj.userData.ignoreBounds) return;
    if (!obj.geometry) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    tempBox.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
    target.union(tempBox);
  });
  return target;
}

/* ------------------------------------------------------------------ */
/* Screws                                                              */
/* ------------------------------------------------------------------ */

const screwGeoCache = new Map();

function screwGeometry(radius, length) {
  const key = `${radius}-${length}`;
  if (screwGeoCache.has(key)) return screwGeoCache.get(key);
  const shaft = new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, length, 10);
  shaft.translate(0, -length / 2, 0);
  const thread = new THREE.CylinderGeometry(radius * 0.47, radius * 0.47, length * 0.82, 10, 5, true);
  thread.translate(0, -length * 0.52, 0);
  const head = new THREE.CylinderGeometry(radius, radius * 1.03, radius * 0.55, 16);
  head.translate(0, radius * 0.275, 0);
  const washer = new THREE.CylinderGeometry(radius * 1.18, radius * 1.18, radius * 0.13, 18);
  washer.translate(0, -radius * 0.03, 0);
  const geo = { shaft, thread, head, washer };
  screwGeoCache.set(key, geo);
  return geo;
}

function addScrew(parent, position, axis = [0, 1, 0], opts = {}) {
  const {
    radius = 1.15,
    length = 5,
    headMaterial = M.steel,
    thumbscrew = false,
    spring = false,
    label = '',
  } = opts;
  const g = new THREE.Group();
  const dir = new THREE.Vector3(...axis).normalize();
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.position.set(...position);
  g.userData.isScrew = true;
  g.userData.pickable = true;
  g.userData.screwLabel = label;

  if (thumbscrew) {
    const head = cylinder(radius * 1.65, radius * 1.7, radius * 0.75, 24, headMaterial, [0, radius * 0.38, 0]);
    head.castShadow = true;
    g.add(head);
    const ridgeMat = headMaterial;
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      const ridge = box(radius * 0.18, radius * 0.68, radius * 0.46, ridgeMat, [
        Math.cos(a) * radius * 1.67,
        radius * 0.38,
        Math.sin(a) * radius * 1.67,
      ], { cast: false, receive: false });
      ridge.rotation.y = -a;
      g.add(ridge);
    }
    const shaft = cylinder(radius * 0.34, radius * 0.34, length, 10, headMaterial, [0, -length / 2, 0]);
    g.add(shaft);
  } else {
    const geo = screwGeometry(radius, length);
    const head = new THREE.Mesh(geo.head, headMaterial);
    head.castShadow = true;
    head.receiveShadow = true;
    g.add(head);
    const shaft = new THREE.Mesh(geo.shaft, headMaterial);
    shaft.castShadow = false;
    g.add(shaft);
    const thread = new THREE.Mesh(geo.thread, M.darkSteel);
    g.add(thread);
    const washer = new THREE.Mesh(geo.washer, M.steel);
    g.add(washer);
    const slotMat = new THREE.MeshBasicMaterial({ color: 0x1e2631 });
    const slot1 = box(radius * 1.25, radius * 0.18, radius * 0.17, slotMat, [0, radius * 0.56, 0], { cast: false, receive: false });
    const slot2 = box(radius * 0.17, radius * 0.18, radius * 1.25, slotMat, [0, radius * 0.56, 0], { cast: false, receive: false });
    g.add(slot1, slot2);
  }

  if (spring) {
    const coils = 5;
    for (let i = 0; i < coils; i += 1) {
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.03, radius * 0.1, 5, 14),
        M.steel
      );
      torus.rotation.x = Math.PI / 2;
      torus.position.y = -radius * 0.5 - i * (length / (coils + 1)) * 0.7;
      g.add(torus);
    }
  }

  g.traverse((o) => {
    if (o.isMesh) {
      o.userData.isScrew = true;
      o.userData.pickable = true;
    }
  });
  parent.add(g);
  state.screwCount += 1;
  return g;
}

/* ------------------------------------------------------------------ */
/* Part registration                                                   */
/* ------------------------------------------------------------------ */

function registerPart(cfg) {
  const {
    id, name, short, category, filter = 'core', icon,
    accent = ['#3b82f6', '#1d4ed8'],
    specs = [], desc = '', teardown = '', screws = 0,
    requires = [], removable = true,
    group, offset = [0, 0, 0], rotation = [0, 0, 0],
    label = null, anchor = null, priority = 1,
    pickable = true,
  } = cfg;

  group.name = id;
  group.userData.partId = id;
  let screwCount = 0;
  group.traverse((obj) => {
    if (obj.isGroup && obj.userData.isScrew) screwCount += 1;
    if (!obj.isMesh) return;
    obj.userData.partId = id;
    if (obj.userData.pickable !== false && pickable) {
      obj.userData.pickable = true;
    }
  });

  const anchorLocal = anchor
    ? new THREE.Vector3(...anchor)
    : new THREE.Vector3();
  const part = {
    ...cfg,
    group,
    removable,
    requires,
    filter,
    priority,
    basePos: group.position.clone(),
    baseQuat: group.quaternion.clone(),
    offsetV: new THREE.Vector3(...offset),
    explodeQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    removed: false,
    animating: false,
    selected: false,
    anchorLocal,
    labelEntry: null,
    index: partsOrder.length,
    pickables: [],
  };
  group.position.copy(part.basePos);
  group.quaternion.copy(part.baseQuat);

  group.traverse((obj) => {
    if (obj.isMesh && obj.userData.pickable !== false && pickable) {
      part.pickables.push(obj);
      pickables.push(obj);
    }
  });

  if (!anchor && label) {
    getPartBox(part);
    const center = tempBox.getCenter(new THREE.Vector3());
    part.anchorLocal.copy(center).sub(group.position);
  } else if (!anchor) {
    getPartBox(part);
    const center = tempBox.getCenter(new THREE.Vector3());
    part.anchorLocal.copy(center).sub(group.position);
  }
  part.screwCount = screwCount;

  parts.set(id, part);
  partsOrder.push(part);
  pcRoot.add(group);
  if (removable) state.totalRemovable += 1;
  return part;
}

/* ------------------------------------------------------------------ */
/* Placeholder: model build (implemented below)                        */
/* ------------------------------------------------------------------ */

function buildModel() {
  buildCase();
  buildMotherboard();
  buildCPU();
  buildCooler();
  buildMemory();
  buildGPU();
  buildStorage();
  buildPowerSupply();
  buildCaseFans();
  buildWifiCard();
  buildCables();
  orientHardwareToFront();
  finalizeParts();
}

/**
 * The FY-01 showcase face is the CENTER glass. The whole hardware stack is
 * rotated so the motherboard faces +Z (front glass), the CPU fan looks
 * straight out through it, and the rear 80mm fans sit behind the motherboard.
 * This is a rigid 90° Y rotation of the platform parts around the case centre.
 */
function orientHardwareToFront() {
  const R = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
  // Shift the complete front hardware stack 15mm toward the centre glass so
  // the rear-compartment PSU no longer clips the back of the platform.
  const T = new THREE.Vector3(10, 0, 48);
  const platformIds = [
    'mobo', 'cpu', 'coolerHeatsink', 'coolerFan',
    'ram1', 'ram2', 'ssd', 'ssdHeatsink', 'wifiCard',
  ];
  platformIds.forEach((id) => {
    const p = parts.get(id);
    if (!p) return;
    p.group.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).add(T);
    p.group.quaternion.premultiply(R);
    p.group.updateMatrixWorld(true);
    p.basePos.copy(p.group.position);
    p.baseQuat.copy(p.group.quaternion);
  });

  // Nudge the 120mm cooler fan slightly to the left, so the two RGB memory
  // sticks on the right are visible through the centre glass. The heatsink
  // tower moves with it so it sits directly behind the fan.
  const fanPart = parts.get('coolerFan');
  if (fanPart) {
    fanPart.group.position.x -= 22;
    fanPart.group.updateMatrixWorld(true);
    fanPart.basePos.copy(fanPart.group.position);
  }
  const heatsinkPart = parts.get('coolerHeatsink');
  if (heatsinkPart) {
    heatsinkPart.group.position.x -= 22;
    heatsinkPart.group.updateMatrixWorld(true);
    heatsinkPart.basePos.copy(heatsinkPart.group.position);
  }

  // Final fit: nudge both RGB memory sticks and the SSD (with its 4mm white
  // heatsink) a little to the left for a better composition through the
  // centre glass.
  ['ram1', 'ram2', 'ssd', 'ssdHeatsink'].forEach((id) => {
    const p = parts.get(id);
    if (!p) return;
    p.group.position.x -= 12;
    p.group.updateMatrixWorld(true);
    p.basePos.copy(p.group.position);
  });

  // GPU: horizontal slab low in the main chamber, copper heatpipes and the
  // PCIe edge visible from the centre glass. The SFX PSU is NOT under it.
  const gpu = parts.get('gpu');
  if (gpu) {
    gpu.group.position.set(10, -90, 15);
    gpu.group.updateMatrixWorld(true);
    gpu.basePos.copy(gpu.group.position);
    gpu.baseQuat.copy(gpu.group.quaternion);
  }

  // PSU: rear compartment, fan facing the back grille, modular connector
  // panel facing the right-hand glass. 90° around X maps:
  //   local +Y (fan)     -> world -Z (rear)
  //   local +X (ports)   -> world +X (right)
  //   local +Z (branding)-> world +Y (top)
  const psu = parts.get('psu');
  if (psu) {
    psu.group.position.set(-50, -10, -86);
    psu.group.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    psu.group.updateMatrixWorld(true);
    psu.basePos.copy(psu.group.position);
    psu.baseQuat.copy(psu.group.quaternion);
  }

  // Rear exhaust fans: behind the motherboard, stacked vertically.
  [['rearFan1', 60, 52], ['rearFan2', 60, -23]].forEach(([id, x, y]) => {
    const p = parts.get(id);
    if (!p) return;
    p.group.position.set(x, y, -112);
    p.group.updateMatrixWorld(true);
    p.basePos.copy(p.group.position);
  });

  // Hide the old decorative cable routing: it was authored for the previous
  // side-facing layout and would float after the 90° rotation.
  cableGroups.forEach((c) => { c.visible = false; });
  if (psu) {
    psu.group.traverse((o) => {
      if (o.isGroup && o.name === 'custom-white-cables') o.visible = false;
    });
  }
}

/* ------------------------------------------------------------------ */
/* Fan factory                                                         */
/* ------------------------------------------------------------------ */

const fanGeoCache = new Map();

function fanFrameGeometry(size, depth, cornerR, holeR) {
  const key = `fanframe-${size}-${depth}-${cornerR}-${holeR}`;
  if (fanGeoCache.has(key)) return fanGeoCache.get(key);
  const shape = roundedRectShape(size, size, cornerR);
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.85,
    bevelThickness: 0.85,
    curveSegments: 28,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  fanGeoCache.set(key, geo);
  return geo;
}

function bladeGeometry(outerR, hubR) {
  const key = `blade-${outerR}-${hubR}`;
  if (fanGeoCache.has(key)) return fanGeoCache.get(key);
  const shape = new THREE.Shape();
  const inner = hubR * 0.94;
  const outer = outerR;
  shape.moveTo(inner, -2.1);
  shape.bezierCurveTo(inner + outer * 0.14, -4.6, outer * 0.72, -6.4, outer, -2.2);
  shape.bezierCurveTo(outer * 1.025, -1.1, outer * 1.02, 3.2, outer * 0.92, 4.4);
  shape.bezierCurveTo(outer * 0.67, 8.6, inner + outer * 0.12, 5.2, inner, 1.9);
  shape.quadraticCurveTo(inner - 0.5, 0, inner, -2.1);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.2,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.45,
    bevelThickness: 0.45,
    curveSegments: 9,
    steps: 1,
  });
  geo.translate(0, 0, -0.6);
  geo.computeVertexNormals();
  fanGeoCache.set(key, geo);
  return geo;
}

function fanLogoTexture(text, color = '#ffffff', sub = '') {
  const key = `fanlogo-${text}-${color}-${sub}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const tex = makeCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = text.length > 5 ? '800 46px "Segoe UI", sans-serif' : '800 74px "Segoe UI", sans-serif';
    ctx.fillText(text, w / 2, sub ? h / 2 - 15 : h / 2);
    if (sub) {
      ctx.font = '600 19px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(sub, w / 2, h / 2 + 42);
    }
  });
  geoCache.set(key, tex);
  return tex;
}

function createLCDTexture() {
  const state = { canvas: null, tex: null, last: 0 };
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  state.canvas = canvas;
  state.tex = tex;

  function draw(t = 0) {
    const pulse = 0.5 + Math.sin(t * 1.5) * 0.12;
    ctx.clearRect(0, 0, 384, 384);
    const g = ctx.createLinearGradient(0, 0, 384, 384);
    g.addColorStop(0, '#071421');
    g.addColorStop(0.6, '#0a1d31');
    g.addColorStop(1, '#07101b');
    ctx.fillStyle = g;
    roundRect(ctx, 0, 0, 384, 384, 58);
    ctx.fill();

    // grid + glow
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#4a9bff';
    ctx.lineWidth = 1;
    for (let i = 24; i < 384; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 384); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(384, i); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const orb = ctx.createRadialGradient(192, 150, 10, 192, 150, 170);
    orb.addColorStop(0, `rgba(77,155,255,${0.26 + pulse * 0.15})`);
    orb.addColorStop(1, 'rgba(77,155,255,0)');
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, 384, 384);

    ctx.fillStyle = 'rgba(167,211,255,0.64)';
    ctx.font = '600 22px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SI-100  /  CPU', 30, 44);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#6ee7c8';
    ctx.fillText('● LIVE', 352, 44);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f3f9ff';
    ctx.font = '300 98px "Segoe UI", sans-serif';
    ctx.fillText('42', 166, 190);
    ctx.font = '500 38px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(214,235,255,0.74)';
    ctx.fillText('°C', 245, 188);

    ctx.font = '500 21px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(160,199,240,0.7)';
    ctx.fillText('PACKAGE TEMP', 192, 238);

    // bars
    const barY = 282;
    for (let i = 0; i < 18; i += 1) {
      const h = 10 + Math.abs(Math.sin(t * 0.8 + i * 0.4)) * 26;
      ctx.fillStyle = i < 12 ? `rgba(92,175,255,${0.35 + i * 0.03})` : 'rgba(99,121,148,0.25)';
      roundRect(ctx, 31 + i * 18, barY + (30 - h), 8, h, 4);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(197,224,255,0.82)';
    ctx.font = '600 20px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('1.8 GHz', 30, 352);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7fe7c8';
    ctx.fillText('1,480 RPM', 352, 352);
    tex.needsUpdate = true;
  }

  draw(0);
  return { state, draw, tex };
}

function createFanModel(opts = {}) {
  const {
    size = 120,
    depth = 25,
    frameMat = M.white,
    bladeMat = M.whiteSoft,
    hubMat = M.whiteMetal,
    bladeCount = 9,
    rgb = false,
    lcd = false,
    grille = false,
    logo = '',
    logoColor = '#1b2c44',
    logoSub = '',
    cornerAccent = false,
    arrow = false,
    innerR = size * 0.455,
    hubR = size * 0.155,
    thicknessScale = 1,
  } = opts;

  const group = new THREE.Group();
  const spin = new THREE.Group();
  const frontZ = depth / 2;
  const cornerR = size * 0.085;

  const frame = new THREE.Mesh(fanFrameGeometry(size, depth, cornerR, innerR), frameMat);
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  // corner mounting pads
  const padMat = opts.padMat || M.plasticDark;
  const padR = size * 0.045;
  const offset = size * 0.39;
  [[-offset, -offset], [offset, -offset], [-offset, offset], [offset, offset]].forEach(([x, y]) => {
    const pad = cylinder(padR, padR, 0.8, 16, padMat, [x, y, frontZ + 0.2]);
    pad.castShadow = false;
    group.add(pad);
    const hole = cylinder(padR * 0.45, padR * 0.45, 0.9, 12, M.screenBlack, [x, y, frontZ + 0.55]);
    hole.castShadow = false;
    group.add(hole);
  });

  const bladeR = innerR * 0.88;
  const geo = bladeGeometry(bladeR, hubR);
  const blades = [];
  for (let i = 0; i < bladeCount; i += 1) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i / bladeCount) * Math.PI * 2;
    const blade = new THREE.Mesh(geo, bladeMat);
    blade.rotation.y = 0.34;
    blade.rotation.x = i % 2 === 0 ? 0.04 : -0.04;
    blade.castShadow = true;
    blade.receiveShadow = true;
    pivot.add(blade);
    spin.add(pivot);
    blades.push(pivot);
  }
  spin.position.z = 0;
  group.add(spin);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(hubR, hubR * 0.96, depth * 0.9 * thicknessScale, 36),
    hubMat
  );
  hub.rotation.x = Math.PI / 2;
  hub.castShadow = true;
  group.add(hub);

  const hubCap = new THREE.Mesh(
    new THREE.CylinderGeometry(hubR * 0.9, hubR * 0.9, 0.8, 36),
    hubMat
  );
  hubCap.rotation.x = Math.PI / 2;
  hubCap.position.z = depth * 0.45 + 0.4;
  group.add(hubCap);

  if (logo) {
    const tex = fanLogoTexture(logo, logoColor, logoSub);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(hubR * 1.55, hubR * 1.55), mat);
    badge.position.z = depth * 0.45 + 0.85;
    badge.userData.pickable = false;
    group.add(badge);
    const backBadge = new THREE.Mesh(new THREE.PlaneGeometry(hubR * 1.4, hubR * 1.4), mat);
    backBadge.position.z = -depth * 0.45 - 0.8;
    backBadge.rotation.y = Math.PI;
    backBadge.userData.pickable = false;
    group.add(backBadge);
  }

  if (lcd) {
    const lcd = createLCDTexture();
    lcdScreens.push(lcd);
    const bezelMat = new THREE.MeshStandardMaterial({ color: 0x101722, roughness: 0.34, metalness: 0.35 });
    const bezel = box(size * 0.35, size * 0.35, 2.2, bezelMat, [0, 0, depth * 0.45 + 0.95], {
      round: 3,
      cast: false,
      receive: false,
    });
    group.add(bezel);
    const screenMat = new THREE.MeshBasicMaterial({ map: lcd.tex, transparent: false, side: THREE.DoubleSide, toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.315, size * 0.315), screenMat);
    screen.position.z = depth * 0.45 + 2.1;
    screen.userData.pickable = false;
    group.add(screen);
    // glass reflection
    const gloss = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.31, size * 0.12),
      new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.1, depthWrite: false })
    );
    gloss.position.set(-size * 0.01, size * 0.05, depth * 0.45 + 2.13);
    gloss.rotation.z = -0.24;
    gloss.userData.pickable = false;
    group.add(gloss);
  }

  if (rgb) {
    const rgbMat = emissive(0x7c5cff, 1.6, { base: 0x8c7cff, roughness: 0.2 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(hubR + size * 0.028, size * 0.011, 8, 72), rgbMat);
    ring.position.z = depth * 0.45 + 1.1;
    ring.userData.pickable = false;
    group.add(ring);
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(innerR + size * 0.006, size * 0.006, 6, 80), rgbMat.clone());
    outerRing.position.z = depth * 0.45 + 0.65;
    outerRing.userData.pickable = false;
    group.add(outerRing);
    rgbTargets.push({ mats: [rgbMat, outerRing.material], type: 'fan', speed: 0.65, offset: Math.random() * 6 });

    if (cornerAccent) {
      const accentMat = emissive(0x7c5cff, 1.8, { base: 0xc7c0ff });
      for (let i = 0; i < 4; i += 1) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        const r = size * 0.43;
        const bar = box(size * 0.13, 1.55, 1.2, accentMat, [Math.cos(a) * r, Math.sin(a) * r, depth / 2 + 0.75], {
          round: 0.6,
          cast: false,
          receive: false,
        });
        bar.rotation.z = a + Math.PI / 2;
        bar.userData.pickable = false;
        group.add(bar);
      }
      rgbTargets.push({ mats: [accentMat], type: 'bar', speed: 0.5, offset: 1.4 });
    }
  }

  if (grille) {
    const gm = new THREE.LineBasicMaterial({ color: 0x8a9aab, transparent: true, opacity: 0.6 });
    for (let i = 1; i <= 3; i += 1) {
      const pts = [];
      const r = innerR * (i / 3.6);
      for (let a = 0; a <= 64; a += 1) {
        const ang = (a / 64) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r, frontZ + 0.75));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gm);
      line.userData.pickable = false;
      group.add(line);
    }
    for (let i = 0; i < 4; i += 1) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, frontZ + 0.75),
          new THREE.Vector3(Math.cos(ang) * innerR, Math.sin(ang) * innerR, frontZ + 0.75),
        ]),
        gm
      );
      line.userData.pickable = false;
      group.add(line);
    }
  }

  if (arrow) {
    const tex = makeCanvasTexture(128, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(37,99,235,0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(14, 32); ctx.lineTo(86, 32); ctx.moveTo(72, 18); ctx.lineTo(88, 32); ctx.lineTo(72, 46);
      ctx.stroke();
    });
    const pl = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.22, size * 0.11),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false })
    );
    pl.position.set(0, -size * 0.405, frontZ + 0.8);
    pl.userData.pickable = false;
    group.add(pl);
  }

  fanSpinners.push({
    group: spin,
    speed: opts.speed ?? (size <= 80 ? 2.6 : 1.8),
    direction: opts.direction ?? 1,
  });

  group.userData.fanSpin = spin;
  return group;
}

/* ------------------------------------------------------------------ */
/* Case, glass panels, top cover                                       */
/* ------------------------------------------------------------------ */

function buildCase() {
  const g = new THREE.Group();
  g.position.set(0, 0, 0);

  const W = CASE_W;
  const H = CASE_H;
  const D = CASE_D;

  // bottom plinth
  const base = box(W, 12, D, M.white, [0, -H / 2 + 6, 0], { round: 5 });
  g.add(base);
  const baseShadow = box(W - 14, 7, D - 14, M.whiteSoft, [0, -H / 2 + 1, 0], { round: 4 });
  g.add(baseShadow);

  // four feet
  const feetPos = [
    [-W / 2 + 28, -H / 2 - 1, -D / 2 + 28],
    [W / 2 - 28, -H / 2 - 1, -D / 2 + 28],
    [-W / 2 + 28, -H / 2 - 1, D / 2 - 28],
    [W / 2 - 28, -H / 2 - 1, D / 2 - 28],
  ];
  feetPos.forEach((p, i) => {
    const foot = cylinder(9, 10, 7, 24, i % 2 ? M.plasticDark : M.rubber, [p[0], p[1] + 1, p[2]]);
    foot.castShadow = true;
    g.add(foot);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9.3, 0.55, 6, 30), M.brightMetal);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p[0], p[1] + 4.5, p[2]);
    g.add(ring);
  });

  // No vertical corner pillars: the left / centre / right glass panels meet
  // directly, as on the real FY-01. Only slim top and bottom rails remain.

  // bottom and top rails around the glass
  const railFrontBottom = box(W - 12, 9, 8, M.white, [0, -H / 2 + 14, D / 2 - 4], { round: 2.5 });
  const railFrontTop = box(W - 12, 8, 8, M.white, [0, H / 2 - 15, D / 2 - 4], { round: 2.5 });
  g.add(railFrontBottom, railFrontTop);
  const railRearBottom = box(W - 12, 8, 8, M.white, [0, -H / 2 + 14, -D / 2 + 4], { round: 2.5 });
  const railRearTop = box(W - 12, 8, 8, M.white, [0, H / 2 - 15, -D / 2 + 4], { round: 2.5 });
  g.add(railRearBottom, railRearTop);
  const railLeftBottom = box(8, 8, D - 14, M.white, [-W / 2 + 4, -H / 2 + 14, 0], { round: 2.5 });
  const railLeftTop = box(8, 8, D - 14, M.white, [-W / 2 + 4, H / 2 - 15, 0], { round: 2.5 });
  const railRightBottom = box(8, 8, D - 14, M.white, [W / 2 - 4, -H / 2 + 14, 0], { round: 2.5 });
  const railRightTop = box(8, 8, D - 14, M.white, [W / 2 - 4, H / 2 - 15, 0], { round: 2.5 });
  g.add(railLeftBottom, railLeftTop, railRightBottom, railRightTop);

  // front lower bezel with brand
  const frontBezel = box(W - 16, 22, 3.5, M.white, [0, -H / 2 + 27, D / 2 - 1], { round: 3.5 });
  g.add(frontBezel);
  const brandTex = textTexture(
    [{ text: 'FY-01', font: '800 54px "Segoe UI", sans-serif' }, { text: 'MINI  ITX  ·  11.5L', font: '600 17px "Segoe UI", sans-serif', color: '#8a9cb1' }],
    { width: 512, height: 180, color: '#1c2b40', align: 'left', padding: 28 }
  );
  const brandPlate = makePlane(70, 24.5, new THREE.MeshBasicMaterial({ map: brandTex, transparent: true }), [0, -H / 2 + 27, D / 2 + 0.85]);
  g.add(brandPlate);
  // front IO
  const pwr = cylinder(5.3, 5.3, 1.2, 30, M.brightMetal, [W / 2 - 33, H / 2 - 27, D / 2 + 0.9], [Math.PI / 2, 0, 0]);
  g.add(pwr);
  const pwrLed = cylinder(2.3, 2.3, 0.45, 20, emissive(0x73e6c9, 2.5, { base: 0xd6fff6 }), [W / 2 - 33, H / 2 - 27, D / 2 + 1.55], [Math.PI / 2, 0, 0]);
  pwrLed.userData.pickable = false;
  g.add(pwrLed);
  const usbC = box(9.2, 3.8, 1.2, M.plasticDark, [W / 2 - 55, H / 2 - 27, D / 2 + 0.9], { round: 1.5 });
  g.add(usbC);
  const audio = cylinder(2.1, 2.1, 1, 18, M.plasticDark, [W / 2 - 70, H / 2 - 27, D / 2 + 0.9], [Math.PI / 2, 0, 0]);
  g.add(audio);

  // rear panel
  const rear = box(W - 12, H - 8, 3, M.white, [0, 0, -D / 2 + 2], { round: 3 });
  g.add(rear);
  // rear perforated exhaust grilles (dot pattern, one behind each 80mm fan)
  const ventTex = makeCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#eef3f9';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(42,58,80,0.82)';
    for (let y = 10; y < h; y += 26) {
      for (let x = 10; x < w; x += 26) {
        ctx.beginPath();
        ctx.arc(x + (Math.floor(y / 26) % 2) * 13, y, 7.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  const grilleRim = M.brightMetal;
  const holePositions = [];
  const grilleCenters = [
    { x: 60, y: 52, r: 44.5 },
    { x: 60, y: -23, r: 44.5 },
    { x: -56, y: -8, r: 41.5 },
  ];
  grilleCenters.forEach(({ x: cx, y: cy, r }) => {
    for (let iy = -5; iy <= 5; iy += 1) {
      for (let ix = -5; ix <= 5; ix += 1) {
        const px = cx + ix * 8.2;
        const py = cy + iy * 8.2;
        if (Math.hypot(px - cx, py - cy) <= r - 2) holePositions.push([px, py]);
      }
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 1.1, 6, 48), grilleRim);
    rim.position.set(cx, cy, -D / 2 - 0.9);
    rim.userData.pickable = false;
    g.add(rim);
  });
  const holeGeo = new THREE.BufferGeometry();
  const holeArray = new Float32Array(holePositions.length * 3);
  holePositions.forEach(([x, y], i) => {
    holeArray[i * 3] = x;
    holeArray[i * 3 + 1] = y;
    holeArray[i * 3 + 2] = -D / 2 - 0.62;
  });
  holeGeo.setAttribute('position', new THREE.BufferAttribute(holeArray, 3));
  const holes = new THREE.Points(holeGeo, new THREE.PointsMaterial({
    color: 0x33465c,
    size: 5.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  }));
  holes.frustumCulled = false;
  holes.userData.pickable = false;
  g.add(holes);
  // rear IO cutout and panel
  const ioCut = box(42, 68, 2, M.plasticDark, [W / 2 - 34, 24, -D / 2 + 4]);
  g.add(ioCut);
  const ioFrame = box(48, 74, 2.5, M.brightMetal, [W / 2 - 34, 24, -D / 2 + 3.2], { round: 2 });
  g.add(ioFrame);
  // rear power socket
  const psuSocket = box(28, 22, 3, M.plasticDark, [-W / 2 + 42, -H / 2 + 42, -D / 2 + 4], { round: 2 });
  g.add(psuSocket);
  const socketInset = box(21, 14, 2, M.black, [-W / 2 + 42, -H / 2 + 42, -D / 2 + 2.6], { round: 1 });
  g.add(socketInset);
  // No motherboard tray behind the right-hand glass. The 90° platform
  // rotation leaves this side open so the cooling stack and side profiles
  // are visible straight through the side pane.

  // top lip / panel seat
  const topSeat = box(W - 14, 4, D - 14, M.whiteSoft, [0, H / 2 - 3.5, 0], { round: 3 });
  g.add(topSeat);

  // feet screws and frame screws
  addScrew(g, [-W / 2 + 28, -H / 2 + 9, -D / 2 + 28], [0, 1, 0], { radius: 1.25, length: 4, headMaterial: M.darkSteel });
  addScrew(g, [W / 2 - 28, -H / 2 + 9, -D / 2 + 28], [0, 1, 0], { radius: 1.25, length: 4, headMaterial: M.darkSteel });
  addScrew(g, [-W / 2 + 28, -H / 2 + 9, D / 2 - 28], [0, 1, 0], { radius: 1.25, length: 4, headMaterial: M.darkSteel });
  addScrew(g, [W / 2 - 28, -H / 2 + 9, D / 2 - 28], [0, 1, 0], { radius: 1.25, length: 4, headMaterial: M.darkSteel });
  // corner joint screws
  [[-W / 2 + 5, H / 2 - 8, D / 2 - 5], [W / 2 - 5, H / 2 - 8, D / 2 - 5], [-W / 2 + 5, -H / 2 + 9, D / 2 - 5], [W / 2 - 5, -H / 2 + 9, D / 2 - 5]].forEach((p) => {
    addScrew(g, p, [0, 0, 1], { radius: 1.05, length: 3.5, headMaterial: M.steel });
  });

  const part = registerPart({
    id: 'case',
    name: '菲远 FY-01 机箱',
    short: '白色 · 三面玻璃 · 11.5L',
    category: '机箱结构',
    filter: 'case',
    icon: 'CASE',
    accent: ['#64748b', '#334155'],
    specs: [
      ['机箱型号', '菲远 FY-01 白色'],
      ['外形尺寸', '230 × 200 × 250 mm'],
      ['容积', '约 11.5 L'],
      ['结构', 'ITX · 三面钢化玻璃'],
      ['风道', '顶进 2×80 / 后排 2×80'],
      ['材质', 'SPCC 钢架 + 阳极氧化铝饰条'],
    ],
    desc: '一台强调“全透观察”的迷你海景房机箱。前面与左右两侧均为钢化玻璃，顶部为白色冲孔进风面板，三面视角下都能看到内部硬件。',
    teardown: '机箱主体保留为展示骨架。玻璃侧板、顶部冲孔盖与后部风扇均独立可拆，可先拆玻璃再逐层取件。',
    screws: 8,
    removable: false,
    group: g,
    label: { show: true, spec: '三面玻璃 · 11.5L', dx: -194, dy: 118, align: 'right' },
    anchor: [0, 100, 110],
    priority: 1,
  });

  buildGlassPanels();
  buildTopCover();
}

let glassStreakTexture;
function getGlassStreakTexture() {
  if (glassStreakTexture) return glassStreakTexture;
  glassStreakTexture = makeCanvasTexture(512, 1024, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    // broad diagonal studio highlights
    const drawStreak = (x, y, sw, sh, angle, alpha) => {
      const g = ctx.createLinearGradient(x, y, x + sw, y + sh);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.42, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.58, `rgba(200,228,255,${alpha * 0.6})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, sw, sh);
      ctx.restore();
    };
    drawStreak(-40, 80, 260, 650, -0.42, 0.16);
    drawStreak(280, -30, 120, 520, -0.34, 0.1);
    drawStreak(40, 760, 410, 160, 0.22, 0.07);
    // window reflection
    ctx.strokeStyle = 'rgba(235,247,255,0.34)';
    ctx.lineWidth = 2;
    ctx.strokeRect(44, 128, 142, 314);
    ctx.strokeRect(58, 142, 114, 286);
    ctx.fillStyle = 'rgba(225,242,255,0.08)';
    ctx.fillRect(44, 128, 142, 314);
    // small corner glint
    const orb = ctx.createRadialGradient(430, 210, 0, 430, 210, 74);
    orb.addColorStop(0, 'rgba(255,255,255,0.28)');
    orb.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = orb;
    ctx.fillRect(330, 110, 200, 200);
  });
  glassStreakTexture.wrapS = glassStreakTexture.wrapT = THREE.ClampToEdgeWrapping;
  return glassStreakTexture;
}

function makeGlassPanel({ id, side, position, size, screwsAxis, accent }) {
  const g = new THREE.Group();
  g.position.set(...position);
  const [w, h, d] = size;
  const isFront = side === 'front';
  const panelW = isFront ? w : d;
  const panelH = h;

  const glass = box(isFront ? w : 0.9, h, isFront ? 0.9 : d, M.glass, [0, 0, 0], { cast: false, receive: false });
  glass.userData.pickable = false;
  g.add(glass);

  // dark inner gasket, makes the glass read as a real panel
  const gasket = M.plasticDark;
  if (isFront) {
    g.add(box(w - 4, 2.2, 1.4, gasket, [0, h / 2 - 5, -0.7], { round: 0.4, cast: false }));
    g.add(box(w - 4, 2.2, 1.4, gasket, [0, -h / 2 + 5, -0.7], { round: 0.4, cast: false }));
  } else {
    g.add(box(1.4, 2.2, d - 4, gasket, [0, h / 2 - 5, 0], { round: 0.4, cast: false }));
    g.add(box(1.4, 2.2, d - 4, gasket, [0, -h / 2 + 5, 0], { round: 0.4, cast: false }));
  }

  // subtle studio reflection / glass sheen
  const streakMat = new THREE.MeshBasicMaterial({
    map: getGlassStreakTexture(),
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  if (isFront) {
    const sheen = new THREE.Mesh(new THREE.PlaneGeometry(w - 14, h - 14), streakMat);
    sheen.position.set(0, 0, 0.58);
    sheen.userData.pickable = false;
    g.add(sheen);
  } else {
    const sheen = new THREE.Mesh(new THREE.PlaneGeometry(d - 14, h - 14), streakMat.clone());
    sheen.rotation.y = side === 'left' ? -Math.PI / 2 : Math.PI / 2;
    sheen.position.set(side === 'left' ? -0.58 : 0.58, 0, 0);
    sheen.userData.pickable = false;
    g.add(sheen);
  }

  // edge glow line
  const edgePoints = [];
  if (isFront) {
    const z = 0;
    const x1 = -w / 2, x2 = w / 2, y1 = -h / 2, y2 = h / 2;
    edgePoints.push(
      new THREE.Vector3(x1, y1, z), new THREE.Vector3(x2, y1, z),
      new THREE.Vector3(x2, y1, z), new THREE.Vector3(x2, y2, z),
      new THREE.Vector3(x2, y2, z), new THREE.Vector3(x1, y2, z),
      new THREE.Vector3(x1, y2, z), new THREE.Vector3(x1, y1, z)
    );
  } else {
    const x = 0;
    const z1 = -d / 2, z2 = d / 2, y1 = -h / 2, y2 = h / 2;
    edgePoints.push(
      new THREE.Vector3(x, y1, z1), new THREE.Vector3(x, y1, z2),
      new THREE.Vector3(x, y1, z2), new THREE.Vector3(x, y2, z2),
      new THREE.Vector3(x, y2, z2), new THREE.Vector3(x, y2, z1),
      new THREE.Vector3(x, y2, z1), new THREE.Vector3(x, y1, z1)
    );
  }
  const edge = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(edgePoints),
    new THREE.LineBasicMaterial({ color: 0x8dc6ff, transparent: true, opacity: 0.36 })
  );
  edge.userData.pickable = false;
  g.add(edge);

  // frame bars
  const bar = 6;
  const frameMat = M.white;
  // Only horizontal top / bottom trims: no vertical pillars between the
  // left, centre and right glass panes.
  if (isFront) {
    g.add(box(w, bar, 7, frameMat, [0, h / 2 - bar / 2, 0], { round: 1.5 }));
    g.add(box(w, bar, 7, frameMat, [0, -h / 2 + bar / 2, 0], { round: 1.5 }));
  } else {
    g.add(box(7, bar, d, frameMat, [0, h / 2 - bar / 2, 0], { round: 1.5 }));
    g.add(box(7, bar, d, frameMat, [0, -h / 2 + bar / 2, 0], { round: 1.5 }));
  }

  // logo etch
  if (isFront) {
    const etchTex = textTexture([{ text: 'FY-01', font: '700 36px "Segoe UI", sans-serif' }], {
      width: 256, height: 96, color: 'rgba(255,255,255,0.34)', align: 'center',
    });
    const etch = makePlane(40, 15, new THREE.MeshBasicMaterial({ map: etchTex, transparent: true, opacity: 0.6, depthWrite: false }), [w / 2 - 44, -h / 2 + 24, 0.55]);
    etch.userData.pickable = false;
    g.add(etch);
  }

  // four corner thumbscrews
  const sx = isFront ? w / 2 - 16 : 0;
  const sy = h / 2 - 17;
  const sz = isFront ? 4 : d / 2 - 16;
  const positions = isFront
    ? [[-sx, sy, 4], [sx, sy, 4], [-sx, -sy, 4], [sx, -sy, 4]]
    : [[0, sy, -sz], [0, sy, sz], [0, -sy, -sz], [0, -sy, sz]];
  positions.forEach((p) => {
    addScrew(g, p, screwsAxis, {
      radius: 2.1,
      length: 7,
      headMaterial: M.steel,
      thumbscrew: true,
    });
  });

  const part = registerPart({
    id,
    name: side === 'front' ? '前面板钢化玻璃' : side === 'left' ? '左侧钢化玻璃' : '右侧钢化玻璃',
    short: '4mm 钢化玻璃 · 手拧固定',
    category: '机箱结构',
    filter: 'case',
    icon: 'GLS',
    accent,
    specs: [
      ['位置', side === 'front' ? '机箱前部' : side === 'left' ? '机箱左侧' : '机箱右侧'],
      ['材质', '4mm 钢化玻璃'],
      ['固定', '4 颗手拧螺丝'],
      ['透光率', '约 91%'],
    ],
    desc: side === 'front'
      ? '正面全透钢化玻璃，让 SI-100 与 RGB 内存成为视觉中心。四角使用金属手拧螺丝固定。'
      : `${side === 'left' ? '左' : '右'}侧全透钢化玻璃，是观察主板、显卡与散热器侧面的主视角。无框内嵌设计，四角金属手拧螺丝。`,
    teardown: '先拧松四角手拧螺丝，再向外平移取下面板。拆下后可直接点击内部任意部件。',
    screws: 4,
    group: g,
    offset: side === 'front' ? [0, -210, 130] : [side === 'left' ? -220 : 220, 60, 20],
    rotation: side === 'front' ? [0, 0, 0.02] : [0, side === 'left' ? 0.08 : -0.08, 0],
    label: null,
    anchor: isFront ? [0, 0, 0] : [0, 0, 0],
    priority: 2,
  });
  return part;
}

function buildGlassPanels() {
  makeGlassPanel({
    id: 'glassFront',
    side: 'front',
    position: [0, 1, CASE_D / 2 - 4],
    size: [212, 238, 1],
    screwsAxis: [0, 0, 1],
    accent: ['#38bdf8', '#0369a1'],
  });
  makeGlassPanel({
    id: 'glassLeft',
    side: 'left',
    position: [-CASE_W / 2 + 4, 1, 0],
    size: [1, 238, 222],
    screwsAxis: [-1, 0, 0],
    accent: ['#38bdf8', '#1d4ed8'],
  });
  makeGlassPanel({
    id: 'glassRight',
    side: 'right',
    position: [CASE_W / 2 - 4, 1, 0],
    size: [1, 238, 222],
    screwsAxis: [1, 0, 0],
    accent: ['#38bdf8', '#1d4ed8'],
  });
}

function buildTopCover() {
  const g = new THREE.Group();
  g.position.set(0, CASE_H / 2 + 1.8, 0);

  const perfTex = makeCanvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#f2f6fb';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    const step = 25;
    for (let y = 12; y < h; y += step) {
      for (let x = 12; x < w; x += step) {
        const off = (Math.floor(y / step) % 2) * (step / 2);
        ctx.beginPath();
        ctx.arc(x + off, y, 8.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // edge mask
    ctx.globalCompositeOperation = 'destination-in';
    roundRect(ctx, 0, 0, w, h, 34);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  });

  const perfMat = new THREE.MeshStandardMaterial({
    map: perfTex,
    transparent: true,
    alphaTest: 0.24,
    roughness: 0.45,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(CASE_W - 10, CASE_D - 10), perfMat);
  panel.rotation.x = -Math.PI / 2;
  panel.position.y = 0;
  panel.castShadow = true;
  panel.receiveShadow = true;
  panel.userData.pickable = true;
  g.add(panel);

  // frame
  g.add(box(CASE_W - 4, 5, 8, M.white, [0, 0.5, -CASE_D / 2 + 5], { round: 1.4 }));
  g.add(box(CASE_W - 4, 5, 8, M.white, [0, 0.5, CASE_D / 2 - 5], { round: 1.4 }));
  g.add(box(8, 5, CASE_D - 16, M.white, [-CASE_W / 2 + 5, 0.5, 0], { round: 1.4 }));
  g.add(box(8, 5, CASE_D - 16, M.white, [CASE_W / 2 - 5, 0.5, 0], { round: 1.4 }));
  g.add(box(1.4, 4, CASE_D - 30, M.brightMetal, [CASE_W / 2 - 10, 0.4, 0], { cast: false }));
  g.add(box(1.4, 4, CASE_D - 30, M.brightMetal, [-CASE_W / 2 + 10, 0.4, 0], { cast: false }));

  // subtle top logo
  const tex = textTexture([{ text: 'FY-01', font: '800 42px "Segoe UI", sans-serif' }, { text: 'AIRFLOW  INTAKE', font: '600 13px "Segoe UI", sans-serif', color: '#93a5ba' }], {
    width: 512, height: 160, color: 'rgba(36,55,82,0.54)', align: 'center', padding: 16,
  });
  const badge = makePlane(64, 20, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }), [0, 2.8, CASE_D / 2 - 27], [-Math.PI / 2, 0, 0]);
  badge.userData.pickable = false;
  g.add(badge);

  // corner screws
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    addScrew(g, [sx * (CASE_W / 2 - 14), 2.8, sz * (CASE_D / 2 - 14)], [0, 1, 0], {
      radius: 1.55,
      length: 4.5,
      headMaterial: M.steel,
    });
  });

  const part = registerPart({
    id: 'topPanel',
    name: '顶部冲孔进风面板',
    short: '白色冲孔网 · 4 颗固定螺丝',
    category: '机箱结构',
    filter: 'case',
    icon: 'TOP',
    accent: ['#94a3b8', '#475569'],
    specs: [
      ['位置', '机箱顶部'],
      ['工艺', '白色喷涂冲孔钢网'],
      ['开孔', 'φ8mm 六边形排布'],
      ['固定', '4 颗十字螺丝'],
    ],
    desc: '顶部整块白色冲孔面板，为两把 80mm 进风风扇提供保护与风道。拆下后可直接维护顶部风扇。',
    teardown: '卸下四角 4 颗十字螺丝，向上平移提起。注意风扇线与前面板 IO 线束。',
    screws: 4,
    group: g,
    offset: [0, 178, 40],
    rotation: [0.08, 0, 0],
    label: null,
    anchor: [0, 0, 0],
    priority: 2,
  });
}

/* ------------------------------------------------------------------ */
/* Motherboard                                                         */
/* ------------------------------------------------------------------ */

function makeBoardTexture() {
  return makeCanvasTexture(1024, 1024, (ctx, w, h) => {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#f2f6fa');
    bg.addColorStop(0.55, '#e7edf5');
    bg.addColorStop(1, '#dde6f1');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // PCB weave grid
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = '#aab8c9';
    ctx.lineWidth = 1;
    for (let i = 0; i < w; i += 18) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const rand = mulberry32(2077);

    // dense copper traces
    for (let i = 0; i < 130; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      const len = 20 + rand() * 160;
      const horiz = rand() > 0.5;
      ctx.strokeStyle = `rgba(106,140,178,${0.08 + rand() * 0.16})`;
      ctx.lineWidth = rand() > 0.8 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      if (horiz) {
        ctx.lineTo(x + len, y);
        ctx.lineTo(x + len, y + 20);
      } else {
        ctx.lineTo(x, y + len);
        ctx.lineTo(x + 20, y + len);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(169,145,96,0.35)';
      ctx.beginPath();
      ctx.arc(x + (horiz ? len : 0), y + (horiz ? 0 : len), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // silkscreen labels
    ctx.fillStyle = 'rgba(39,59,84,0.82)';
    ctx.font = '800 47px "Segoe UI", sans-serif';
    ctx.fillText('JGINYUE', 52, 82);
    ctx.font = '600 25px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(52,74,102,0.66)';
    ctx.fillText('B760I  GAMING', 54, 112);
    ctx.font = '500 17px "Segoe UI", sans-serif';
    ctx.fillText('DDR4  ·  LGA1700  ·  PCIe 4.0', 54, 138);

    // socket keep-out square
    ctx.strokeStyle = 'rgba(85,103,126,0.24)';
    ctx.lineWidth = 2;
    ctx.strokeRect(352, 320, 302, 300);
    ctx.font = '600 15px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(73,94,119,0.52)';
    ctx.fillText('LGA1700 SOCKET', 356, 315);

    // dimm area
    ctx.fillStyle = 'rgba(37,52,72,0.9)';
    ctx.fillRect(762, 274, 28, 410);
    ctx.fillRect(812, 274, 28, 410);
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    for (let i = 0; i < 32; i += 1) {
      ctx.fillRect(766, 285 + i * 12, 20, 3);
      ctx.fillRect(816, 285 + i * 12, 20, 3);
    }
    ctx.fillStyle = 'rgba(39,59,84,0.78)';
    ctx.font = '600 17px "Segoe UI", sans-serif';
    ctx.save();
    ctx.translate(770, 720);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('DIMM A1 / B1  DDR4', 0, 0);
    ctx.restore();

    // PCIe lane traces
    ctx.globalAlpha = 0.28;
    for (let i = 0; i < 16; i += 1) {
      ctx.strokeStyle = 'rgba(121,101,62,0.8)';
      ctx.beginPath();
      ctx.moveTo(250 + i * 13, 818);
      ctx.lineTo(250 + i * 13, 910);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // M.2 zone
    ctx.fillStyle = 'rgba(52,74,100,0.12)';
    ctx.fillRect(300, 706, 440, 82);
    ctx.fillStyle = 'rgba(39,59,84,0.6)';
    ctx.font = '600 15px "Segoe UI", sans-serif';
    ctx.fillText('M.2_1  PCIe 4.0 x4', 310, 748);

    // component labels
    const labels = [
      ['VRM 10 PHASE', 490, 215], ['CPU_FAN', 524, 670], ['SYS_FAN', 610, 670],
      ['DDR4 A1', 840, 260], ['DDR4 B1', 890, 260], ['M.2_2', 660, 760],
      ['SATA 3.0', 880, 760], ['F_PANEL', 820, 880], ['RGB 5V', 720, 888],
      ['2.5G LAN', 184, 808], ['ALC897', 204, 866], ['CMOS', 638, 548],
      ['PCIe 4.0 x16', 246, 802], ['USB 3.2', 850, 815],
    ];
    ctx.font = '500 13px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(48,70,95,0.42)';
    labels.forEach(([t, x, y]) => ctx.fillText(t, x, y));

    // tiny white silkscreen dots / fiducials
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    for (let i = 0; i < 80; i += 1) {
      const x = rand() * w;
      const y = rand() * h;
      if (x > 330 && x < 690 && y > 300 && y < 640) continue;
      ctx.beginPath();
      ctx.arc(x, y, 1.2 + rand() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // corner mounting holes
    ctx.fillStyle = 'rgba(81,102,128,0.6)';
    [[52, 52], [972, 52], [52, 972], [972, 972]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(245,248,252,1)';
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(81,102,128,0.6)';
    });
  });
}

function mulberry32(a) {
  return function rng() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSocketContactTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#10161e';
    ctx.fillRect(0, 0, w, h);
    const step = 13;
    for (let y = 14; y < h - 8; y += step) {
      for (let x = 14; x < w - 8; x += step) {
        const off = (Math.round(y / step) % 2) * (step / 2);
        ctx.fillStyle = ((x + y) % 3 === 0) ? '#e5bf63' : '#c89a43';
        ctx.fillRect(x + off, y, 5.5, 5.5);
        ctx.fillStyle = 'rgba(255,241,199,0.55)';
        ctx.fillRect(x + off, y, 5.5, 1.4);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 4;
    ctx.strokeRect(3, 3, w - 6, h - 6);
  });
}

function buildMotherboard() {
  const g = new THREE.Group();
  g.position.set(88, 16, -10);

  const board = box(2.2, 170, 170, M.pcbWhite, [0, 0, 0], { round: 2.5 });
  g.add(board);
  const boardTex = makeBoardTexture();
  boardTex.anisotropy = 8;
  const face = makePlane(170, 170, new THREE.MeshStandardMaterial({
    map: boardTex,
    roughness: 0.52,
    metalness: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }), [-1.16, 0, 0], [0, -Math.PI / 2, 0]);
  face.userData.pickable = true;
  g.add(face);

  // CPU socket body
  const socket = box(5, 54, 54, M.plasticDark, [-3.7, 25, 10], { round: 1.4 });
  g.add(socket);
  const socketInner = box(1.3, 47, 47, M.plasticBlack, [-6.05, 25, 10], { round: 1 });
  g.add(socketInner);
  const contacts = makePlane(44, 44, new THREE.MeshStandardMaterial({
    map: makeSocketContactTexture(),
    roughness: 0.34,
    metalness: 0.7,
    emissive: 0x3b2c10,
    emissiveIntensity: 0.08,
  }), [-6.76, 25, 10], [0, -Math.PI / 2, 0]);
  contacts.userData.pickable = false;
  g.add(contacts);

  // socket retention frame
  const frameMat = M.nickel;
  g.add(box(2.8, 3.2, 58, frameMat, [-7.1, 25, -19.5], { round: 0.8 }));
  g.add(box(2.8, 3.2, 58, frameMat, [-7.1, 25, 39.5], { round: 0.8 }));
  g.add(box(2.8, 58, 3.2, frameMat, [-7.1, -3, 10], { round: 0.8 }));
  g.add(box(2.8, 58, 3.2, frameMat, [-7.1, 53, 10], { round: 0.8 }));
  // load plate and lever
  const plate = box(1.2, 48, 48, M.nickel, [-7.55, 25, 10], { round: 1.6 });
  plate.material = plate.material.clone();
  plate.material.transparent = true;
  plate.material.opacity = 0.55;
  g.add(plate);
  const leverCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-8.1, 4, 39),
    new THREE.Vector3(-8.6, 2, 48),
    new THREE.Vector3(-8.9, -2, 56),
    new THREE.Vector3(-9.3, -8, 57),
  ]);
  const lever = new THREE.Mesh(new THREE.TubeGeometry(leverCurve, 24, 0.9, 6, false), M.nickel);
  lever.castShadow = true;
  g.add(lever);
  const leverKnob = cylinder(2, 2, 2.6, 12, M.nickel, [-9.3, -8, 57], [0, 0, Math.PI / 2]);
  g.add(leverKnob);

  // socket mounting screws
  [[-7.15, -3, -17], [-7.15, 53, -17], [-7.15, -3, 37], [-7.15, 53, 37]].forEach((p) => {
    addScrew(g, p, [-1, 0, 0], { radius: 1.1, length: 3.4, headMaterial: M.darkSteel });
  });

  // VRM heat sinks with fins
  const vrmTop = box(15, 23, 72, M.whiteMetal, [-10, 82, -18], { round: 2.2 });
  g.add(vrmTop);
  for (let i = 0; i < 9; i += 1) {
    g.add(box(2.2, 2.2, 66, M.brightMetal, [-17.9, 75 + i * 1.75, -18], { cast: false, receive: false }));
  }
  const vrmSide = box(15, 78, 20, M.whiteMetal, [-10, 41, -76], { round: 2.2 });
  g.add(vrmSide);
  for (let i = 0; i < 10; i += 1) {
    g.add(box(2.2, 70, 2.2, M.brightMetal, [-17.9, 39 + i * 1.8, -86.7], { cast: false, receive: false }));
  }

  // I/O shroud
  const ioShroud = box(27, 44, 24, M.white, [-15, 60, -82], { round: 3.2 });
  g.add(ioShroud);
  const ioLabelTex = textTexture([{ text: 'JGINYUE', font: '800 42px "Segoe UI", sans-serif' }, { text: 'B760I GAMING', font: '600 17px "Segoe UI", sans-serif', color: '#8092a8' }], {
    width: 512, height: 200, color: '#263951', align: 'left', padding: 24,
  });
  const ioLabel = makePlane(38, 15, new THREE.MeshBasicMaterial({ map: ioLabelTex, transparent: true }), [-28.6, 61, -82], [0, -Math.PI / 2, 0]);
  ioLabel.userData.pickable = false;
  g.add(ioLabel);

  // chipset heat sink
  const chipset = box(17, 40, 40, M.whiteMetal, [-10, -31, -52], { round: 3 });
  g.add(chipset);
  for (let i = 0; i < 8; i += 1) {
    g.add(box(2.5, 2, 34, M.brightMetal, [-19, -47 + i * 4.2, -52], { cast: false, receive: false }));
  }
  const chipLogo = makePlane(26, 9, new THREE.MeshBasicMaterial({
    map: labelTexture('JGINYUE', { width: 512, height: 128, color: 'rgba(54,74,100,0.68)', font: '700 48px "Segoe UI", sans-serif', align: 'center' }),
    transparent: true,
  }), [-18.7, -30, -52], [0, -Math.PI / 2, 0]);
  g.add(chipLogo);

  // DIMM slots
  [68, 80].forEach((z, idx) => {
    const slot = box(9, 101, 8.5, M.plasticBlack, [-4.4, 16, z], { round: 1.2 });
    g.add(slot);
    const metal = box(9.8, 6, 9.8, M.brightMetal, [-4.4, 64, z], { round: 1.2 });
    g.add(metal);
    const metal2 = box(9.8, 6, 9.8, M.brightMetal, [-4.4, -32, z], { round: 1.2 });
    g.add(metal2);
    const goldStrip = box(0.6, 74, 2, M.gold, [-8.95, 16, z], { cast: false });
    g.add(goldStrip);
    // latches
    const latch = box(4, 13, 5, M.whiteSoft, [-7.3, 67, z + (idx ? 5 : -5)], { round: 1 });
    latch.rotation.z = idx ? -0.25 : 0.25;
    g.add(latch);
  });

  // M.2 connector + standoff
  const m2slot = box(7, 9, 15, M.plasticBlack, [-4.2, -40, -17], { round: 1.2 });
  g.add(m2slot);
  addScrew(g, [-5.2, -40, 61], [-1, 0, 0], { radius: 1.05, length: 3.2, headMaterial: M.steel });
  const standoff = cylinder(3.4, 3.4, 4.5, 8, M.darkSteel, [-4.2, -40, 61], [0, 0, Math.PI / 2]);
  standoff.userData.pickable = false;
  g.add(standoff);

  // PCIe x16 slot
  const pcie = box(8, 91, 12, M.plasticBlack, [-4.2, -57, -8], { round: 1.2 });
  pcie.rotation.x = Math.PI / 2;
  pcie.userData.pickable = false;
  g.add(pcie);
  // the slot is long along z: rebuild oriented properly
  pcie.visible = false;
  const pcieSlot = box(8, 8.5, 96, M.plasticBlack, [-4.6, -56, -4], { round: 1.4 });
  g.add(pcieSlot);
  const pcieGold = box(0.6, 2.2, 76, M.gold, [-8.8, -56, -4], { cast: false });
  g.add(pcieGold);
  const pcieLatch = box(4, 7, 15, M.plasticDark, [-4.6, -56, 48], { round: 1 });
  pcieLatch.rotation.x = 0.16;
  g.add(pcieLatch);

  // 24-pin ATX
  const atx = box(16, 35, 14, M.whiteSoft, [-6.5, 52, 78], { round: 1.8 });
  g.add(atx);
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 12; c += 1) {
      g.add(box(1.1, 2, 2, M.plasticDark, [-14.8, 42 + c * 1.85, 77 + r * 3.5], { cast: false, receive: false }));
    }
  }

  // EPS 8-pin
  const eps = box(17, 15, 20, M.whiteSoft, [-6.5, 78, -44], { round: 1.8 });
  g.add(eps);
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      g.add(box(1.1, 2.8, 2.8, M.plasticDark, [-15.2, 74 + c * 3.5, -49 + r * 6], { cast: false, receive: false }));
    }
  }

  // SATA ports
  for (let i = 0; i < 4; i += 1) {
    const sata = box(9, 8, 10, i % 2 ? M.whiteSoft : M.plasticDark, [-5.5, -28 + i * 9, 81], { round: 0.8 });
    g.add(sata);
    const hole = box(3.2, 2.4, 1, M.black, [-10.4, -28 + i * 9, 84.7], { cast: false });
    g.add(hole);
  }

  // front USB / audio / fan / RGB headers
  const header = box(9, 14, 6, M.whiteSoft, [-5, 64, 82], { round: 0.8 });
  g.add(header);
  const audioHeader = box(8, 9, 6, M.whiteSoft, [-5, 43, 82], { round: 0.8 });
  g.add(audioHeader);
  const rgbHeader = box(7, 6, 4, M.whiteSoft, [-6, 22, 84], { round: 0.6 });
  g.add(rgbHeader);
  const rgbPins = box(5, 2, 1.4, M.gold, [-8.2, 22, 86.3], { cast: false });
  g.add(rgbPins);

  // fan headers along top edge
  [[-49, 80], [-26, 84]].forEach(([z, y]) => {
    const h = box(7, 5, 8, M.plasticDark, [-4.8, y, z], { round: 0.7 });
    g.add(h);
    g.add(box(1, 1.6, 7, M.gold, [-8.4, y, z], { cast: false }));
  });

  // CMOS battery
  const battery = cylinder(8.2, 8.2, 2.2, 28, M.brightMetal, [-4.2, 1, 72], [0, 0, Math.PI / 2]);
  g.add(battery);
  const batteryTop = cylinder(6.6, 6.6, 0.4, 24, M.steel, [-5.4, 1, 72], [0, 0, Math.PI / 2]);
  g.add(batteryTop);

  // SMD components
  const smdColors = [M.plasticDark, M.graphite, M.whiteSoft, M.brightMetal];
  const rand = mulberry32(73);
  for (let i = 0; i < 44; i += 1) {
    let x;
    let y;
    let z;
    let tries = 0;
    do {
      y = -78 + rand() * 156;
      z = -78 + rand() * 156;
      tries += 1;
    } while (Math.abs(y - 25) < 36 && Math.abs(z - 10) < 38 && tries < 40);
    x = -2.8 - rand() * 2.2;
    const w = 0.8 + rand() * 1.7;
    const h = 2 + rand() * 6;
    const d = 2 + rand() * 6;
    const comp = box(w, h, d, smdColors[Math.floor(rand() * smdColors.length)], [x, y, z], {
      round: 0.4,
      cast: false,
      receive: false,
    });
    g.add(comp);
  }
  // chokes / mosfets around socket
  for (let i = 0; i < 10; i += 1) {
    const choke = box(4.8, 7, 7, M.graphite, [-4.6, 48 + i * 6.4, -28], { round: 1, cast: false });
    g.add(choke);
  }
  for (let i = 0; i < 7; i += 1) {
    const choke = box(4.8, 7, 7, M.graphite, [-4.6, 49, -52 + i * 8.2], { round: 1, cast: false });
    g.add(choke);
  }
  // capacitors
  for (let i = 0; i < 8; i += 1) {
    const cap = cylinder(2.7, 2.7, 5, 14, M.nickel, [-4.8, 18 + (i % 2) * 8, -22 - Math.floor(i / 2) * 8], [0, 0, Math.PI / 2]);
    g.add(cap);
    const capTop = cylinder(2.2, 2.2, 0.3, 14, M.plasticDark, [-7.35, 18 + (i % 2) * 8, -22 - Math.floor(i / 2) * 8], [0, 0, Math.PI / 2]);
    capTop.userData.pickable = false;
    g.add(capTop);
  }

  // audio / network shielding
  const lanChip = box(6, 12, 12, M.brightMetal, [-4, -2, -70], { round: 2, cast: false });
  g.add(lanChip);
  const audioChip = box(5, 9, 9, M.whiteSoft, [-4, -13, 37], { round: 1.4, cast: false });
  g.add(audioChip);

  // rear I/O cluster
  const ioBack = box(34, 112, 22, M.brightMetal, [-12, 52, -96], { round: 2.5 });
  g.add(ioBack);
  const portY = [12, 28, 44, 60, 76, 92];
  portY.forEach((y, i) => {
    const port = box(24, i < 4 ? 9 : 7, 5, i === 3 ? M.plasticDark : M.brightMetal, [-13, y, -108], { round: 1 });
    g.add(port);
    g.add(box(16, 5, 1.2, M.black, [-13, y, -110.7], { cast: false }));
  });
  // RJ45 with LEDs
  const rj45 = box(22, 13, 6, M.steel, [-13, 4, -108], { round: 1.2 });
  g.add(rj45);
  const rjLed1 = box(1.6, 1.6, 0.6, emissive(0x62e6be, 2), [-4, 6, -111.3], { cast: false });
  rjLed1.userData.pickable = false;
  g.add(rjLed1);
  // WiFi antenna connectors
  const ant1 = cylinder(2.2, 2.2, 3, 14, M.gold, [-17, 112, -99], [Math.PI / 2, 0, 0]);
  const ant2 = cylinder(2.2, 2.2, 3, 14, M.gold, [-7, 112, -99], [Math.PI / 2, 0, 0]);
  g.add(ant1, ant2);

  // motherboard mounting screws
  [[-72, -72], [72, -72], [-72, 72], [72, 72]].forEach(([y, z]) => {
    addScrew(g, [-3.0, y, z], [-1, 0, 0], {
      radius: 1.45,
      length: 5,
      headMaterial: M.steel,
      spring: true,
    });
  });

  const part = registerPart({
    id: 'mobo',
    name: '精粤 B760I GAMING',
    short: 'ITX 17×17 · B760 · LGA1700',
    category: '核心硬件',
    filter: 'core',
    icon: 'MB',
    accent: ['#0ea5e9', '#0369a1'],
    specs: [
      ['板型', 'Mini-ITX · 170 × 170 mm'],
      ['芯片组', 'Intel B760'],
      ['CPU 支持', 'LGA1700 · 12/13/14 代'],
      ['内存', 'DDR4 ×2 · 最高 64GB'],
      ['存储', '2 × M.2 PCIe 4.0 · 4 × SATA'],
      ['网络', '2.5G LAN + AX201 WiFi 6'],
    ],
    desc: '白色 PCB 的 ITX 主板，10 相供电，双 M.2 插槽与 2.5G 网卡。板载 AX201 无线网卡贴片，为小体积主机提供完整的扩展能力。',
    teardown: '拆下 CPU 散热、内存、显卡、M.2 与 4 颗主板固定螺丝后，可整体取出主板。注意后置 IO 挡板与机箱走线。',
    screws: 4,
    group: g,
    requires: ['coolerFan', 'coolerHeatsink', 'cpu', 'ram1', 'ram2', 'gpu', 'ssdHeatsink', 'ssd', 'psu', 'wifiCard'],
    offset: [200, 25, -60],
    rotation: [0, 0, -0.03],
    label: { show: true, spec: 'B760 ITX · 10相供电', dx: 128, dy: -68, align: 'left' },
    anchor: [-2, 12, 4],
    priority: 1,
  });
}

/* ------------------------------------------------------------------ */
/* CPU                                                                 */
/* ------------------------------------------------------------------ */

function makeIhsTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(249,251,253,0.98)');
    g.addColorStop(0.45, 'rgba(213,220,228,0.96)');
    g.addColorStop(0.55, 'rgba(195,204,214,0.96)');
    g.addColorStop(1, 'rgba(240,244,248,0.98)');
    ctx.fillStyle = g;
    roundRect(ctx, 0, 0, w, h, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    roundRect(ctx, 7, 7, w - 14, h - 14, 16);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(41,54,69,0.86)';
    ctx.font = '600 18px "Segoe UI", sans-serif';
    ctx.fillText('INTEL®  CORE™  i5', w / 2, 118);
    ctx.font = '800 47px "Segoe UI", sans-serif';
    ctx.fillText('i5-14490F', w / 2, 176);
    ctx.font = '500 14px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(48,64,82,0.55)';
    ctx.fillText('SRM8H   ·   24M CACHE   ·   4.90 GHz', w / 2, 212);
    ctx.fillText('LGA1700   ·   65W   ·   MADE IN CHINA', w / 2, 236);

    // notch + triangles
    ctx.fillStyle = 'rgba(80,95,112,0.4)';
    ctx.beginPath();
    ctx.moveTo(32, 32); ctx.lineTo(62, 32); ctx.lineTo(32, 62); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.arc(w - 42, 44, 5, 0, Math.PI * 2); ctx.fill();
    // etched micro lines
    ctx.strokeStyle = 'rgba(70,87,104,0.14)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 22; i += 1) {
      ctx.beginPath();
      ctx.moveTo(28 + i * 21, 292);
      ctx.lineTo(28 + i * 21, 350);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(53,69,86,0.45)';
    ctx.font = '500 12px "Segoe UI", sans-serif';
    ctx.fillText('VCORE  1.284 V', w / 2, 396);
    ctx.fillText('FAB  2024  ·  BATCH  X448A', w / 2, 418);

    // QR-like mark
    const qx = 42, qy = 386, qs = 64;
    ctx.fillStyle = 'rgba(58,75,92,0.4)';
    for (let yy = 0; yy < 8; yy += 1) {
      for (let xx = 0; xx < 8; xx += 1) {
        if ((xx * 7 + yy * 13 + xx * yy) % 3 === 0) {
          ctx.fillRect(qx + xx * (qs / 8), qy + yy * (qs / 8), qs / 8 - 1, qs / 8 - 1);
        }
      }
    }
  });
}

function buildCPU() {
  const g = new THREE.Group();
  g.position.set(84.5, 41, 0);

  // package substrate
  const pcb = box(4, 50, 50, M.pcbGreen, [0, 0, 0], { round: 1.4 });
  g.add(pcb);
  const pcbTop = box(0.35, 47, 47, M.pcbBlack, [2.06, 0, 0], { round: 1.4, cast: false });
  g.add(pcbTop);

  // IHS
  const ihs = box(2.7, 42, 39, M.nickel, [-1.5, 0, 0], { round: 2.5 });
  g.add(ihs);
  const ihsTop = box(0.35, 40, 37, M.brightMetal, [-2.95, 0, 0], { round: 2, cast: false });
  g.add(ihsTop);
  const tex = makeIhsTexture();
  const face = makePlane(37.5, 36, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }), [-3.16, 0, 0], [0, -Math.PI / 2, 0]);
  face.userData.pickable = false;
  g.add(face);
  addEdges(ihsTop, 0xffffff, 0.28);

  // notches / keying
  const notch = box(3.8, 5, 3.8, M.plasticDark, [0, -25.2, 20], { cast: false });
  g.add(notch);
  const notch2 = box(3.8, 5, 3.8, M.plasticDark, [0, -25.2, -20], { cast: false });
  g.add(notch2);
  const dot = cylinder(1.1, 1.1, 0.5, 12, M.gold, [-2.9, 18, 16], [0, 0, Math.PI / 2]);
  dot.userData.pickable = false;
  g.add(dot);

  // gold contact pads (visible when lifted)
  const padGroup = new THREE.Group();
  for (let i = 0; i < 12; i += 1) {
    for (let j = 0; j < 12; j += 1) {
      const pad = box(0.14, 2.1, 2.1, M.gold, [2.15, -29 + i * 4.8, -29 + j * 4.8], { cast: false, receive: false, userData: { pickable: false } });
      padGroup.add(pad);
    }
  }
  padGroup.userData.pickable = false;
  g.add(padGroup);

  const part = registerPart({
    id: 'cpu',
    name: '英特尔 Core i5-14490F',
    short: '10核16线程 · 最高4.9GHz',
    category: '核心硬件',
    filter: 'core',
    icon: 'CPU',
    accent: ['#3b82f6', '#1d4ed8'],
    specs: [
      ['核心 / 线程', '10 核 / 16 线程'],
      ['最高频率', '4.90 GHz'],
      ['三级缓存', '24 MB Intel Smart Cache'],
      ['插槽', 'LGA1700'],
      ['基础功耗', '65 W'],
      ['核显', '无（F 系列）'],
    ],
    desc: '第 14 代酷睿 i5 的中国市场特供型号，6 个性能核 + 4 个能效核，最高 4.9GHz。无核显设计，需要搭配独立显卡使用。',
    teardown: '先拆下 SI-100 散热器，松开 LGA1700 扣具压杆，再垂直向上取出 CPU。安装时注意三角防呆标记。',
    screws: 0,
    group: g,
    requires: ['coolerFan', 'coolerHeatsink', 'glassLeft'],
    offset: [135, 140, 80],
    rotation: [0.18, 0.35, 0.22],
    label: { show: true, spec: '10C/16T · 4.9GHz', dx: 96, dy: -72, align: 'left' },
    anchor: [-3.4, 15, 22],
    priority: 3,
  });
}

/* ------------------------------------------------------------------ */
/* CPU cooler: Thermalright SI-100 + Jungle Leopard LCD fan            */
/* ------------------------------------------------------------------ */

function buildCooler() {
  // ---------------- heat sink ----------------
  const g = new THREE.Group();
  g.position.set(45, 41, 0);

  const base = box(8, 50, 55, M.copper, [32.5, 0, 0], { round: 2.2 });
  g.add(base);
  const basePlate = box(1.8, 52, 57, M.nickel, [27.8, 0, 0], { round: 2.2 });
  g.add(basePlate);

  // fin stack
  const finCount = 35;
  const finStart = 26;
  const finStep = -1.83;
  for (let i = 0; i < finCount; i += 1) {
    const x = finStart + finStep * i;
    const fin = box(0.52, 107, 108, M.coolerFin, [x, 0, 0], {
      round: 0.2,
      bevel: false,
      cast: false,
      receive: true,
    });
    fin.userData.pickable = true;
    g.add(fin);
    if (i % 5 === 0) {
      g.add(box(0.23, 100, 100, M.brightMetal, [x - 0.45, 0, 0], { cast: false, receive: false }));
    }
  }

  // top cover
  const topPlate = box(1.6, 108, 120, M.whiteMetal, [-37.3, 0, 0], { round: 2.5 });
  g.add(topPlate);
  addEdges(topPlate, 0xd7e2ef, 0.5);
  const logo = makePlane(76, 34, new THREE.MeshBasicMaterial({
    map: textTexture(
      [{ text: 'THERMALRIGHT', font: '800 31px "Segoe UI", sans-serif' }, { text: 'SI-100  ·  AGHP III  ·  6 HEATPIPES', font: '600 12px "Segoe UI", sans-serif', color: '#92a4b8' }],
      { width: 768, height: 256, color: '#273a50', align: 'center', padding: 20 }
    ),
    transparent: true,
  }), [-38.2, 0, 0], [0, -Math.PI / 2, 0]);
  logo.userData.pickable = false;
  g.add(logo);
  const smallLogo = makePlane(40, 8, new THREE.MeshBasicMaterial({
    map: labelTexture('AGHP III  /  6 × 6mm HEATPIPE', { width: 768, height: 96, color: 'rgba(58,76,98,0.7)', font: '500 28px "Segoe UI", sans-serif', align: 'center' }),
    transparent: true,
  }), [-38.2, -42, 0], [0, -Math.PI / 2, 0]);
  smallLogo.userData.pickable = false;
  g.add(smallLogo);

  // 6 heatpipes with gentle bends, visible at both edges
  const pipeMat = M.nickel;
  for (let i = 0; i < 6; i += 1) {
    const zOff = -45 + i * 18;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(35, -13, zOff * 0.78),
      new THREE.Vector3(32, -5, zOff),
      new THREE.Vector3(25, 0, zOff),
      new THREE.Vector3(0, 0, zOff),
      new THREE.Vector3(-27, 0, zOff),
      new THREE.Vector3(-36.5, 0, zOff + (i % 2 ? 2.4 : -2.4)),
    ]);
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 3, 8, false), pipeMat);
    pipe.castShadow = true;
    g.add(pipe);
    const tip = cylinder(3.1, 3.1, 2, 10, M.darkSteel, [-37, 0, zOff + (i % 2 ? 2.4 : -2.4)], [0, 0, Math.PI / 2]);
    tip.userData.pickable = false;
    g.add(tip);
  }

  // mounting rails and 4 spring screws
  const rail = box(2.8, 8, 78, M.darkSteel, [34.8, -31, 0], { round: 1, cast: false });
  g.add(rail);
  const rail2 = box(2.8, 8, 78, M.darkSteel, [34.8, 31, 0], { round: 1, cast: false });
  g.add(rail2);
  const crossA = box(2.8, 78, 7, M.darkSteel, [35.2, 0, -33], { round: 1, cast: false });
  const crossB = box(2.8, 78, 7, M.darkSteel, [35.2, 0, 33], { round: 1, cast: false });
  g.add(crossA, crossB);
  [[-32, -32], [32, -32], [-32, 32], [32, 32]].forEach(([y, z]) => {
    addScrew(g, [28.8, y, z], [-1, 0, 0], {
      radius: 2.1,
      length: 12,
      headMaterial: M.brightMetal,
      spring: true,
      label: 'SI-100 弹簧扣具',
    });
  });
  // little thermal paste on base edge
  const paste = box(0.55, 34, 34, M.thermalPad, [36.1, 0, 0], { round: 1.2, cast: false });
  paste.userData.pickable = false;
  g.add(paste);

  const cooler = registerPart({
    id: 'coolerHeatsink',
    name: '利民 SI-100 下压散热塔体',
    short: '6热管 · 100mm · 白色',
    category: '散热系统',
    filter: 'cool',
    icon: 'COOL',
    accent: ['#f59e0b', '#b45309'],
    specs: [
      ['型号', 'Thermalright SI-100 WHITE'],
      ['散热器尺寸', '120 × 108 × 74.8 mm'],
      ['整体高度', '100 mm（含风扇）'],
      ['热管', '6 × 6mm AGHP III'],
      ['底座', 'C1100 纯铜镀镍'],
      ['重量', '约 490g（含风扇）'],
    ],
    desc: '利民为 ITX 平台设计的 100mm 高度下压式散热器。6 根 AGHP III 热管贯穿密集白色铝鳍片，在有限空间里兼顾内存避让与解热能力。',
    teardown: '先拆下四颗加长风扇螺丝与风扇，再对角交替松开四颗弹簧扣具螺丝，垂直提起塔体。安装时需涂抹 TF7 硅脂。',
    screws: 4,
    group: g,
    requires: ['coolerFan', 'glassLeft'],
    offset: [-180, 120, 60],
    rotation: [0.14, 0.1, 0.08],
    label: { show: true, spec: '6×AGHP III · 100mm', dx: -128, dy: -86, align: 'right' },
    anchor: [-37, 0, 0],
    priority: 2,
  });

  // ---------------- LCD fan ----------------
  const fanGroup = new THREE.Group();
  fanGroup.position.set(-4.5, 41, 0);
  const fan = createFanModel({
    size: 120,
    depth: 25,
    frameMat: M.white,
    bladeMat: new THREE.MeshPhysicalMaterial({
      color: 0xdfe8f4,
      roughness: 0.38,
      metalness: 0.05,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
      transparent: true,
      opacity: 0.96,
    }),
    hubMat: M.whiteMetal,
    bladeCount: 9,
    rgb: true,
    lcd: true,
    logo: '',
    cornerAccent: true,
    arrow: true,
    innerR: 54.5,
    hubR: 18,
    speed: 1.7,
  });
  fan.rotation.y = -Math.PI / 2;
  fanGroup.add(fan);

  // 4 longer fan screws + visible springs
  [[-50, -50], [50, -50], [-50, 50], [50, 50]].forEach(([y, z]) => {
    addScrew(fanGroup, [-13.1, y, z], [-1, 0, 0], {
      radius: 1.9,
      length: 36,
      headMaterial: M.brightMetal,
      spring: true,
      label: '4× 加长风扇螺丝',
    });
  });

  const fanPart = registerPart({
    id: 'coolerFan',
    name: '丛林豹 星际积木 V4 LCD',
    short: '120mm · 1.5″ LCD · ARGB',
    category: '散热系统',
    filter: 'cool',
    icon: 'FAN',
    accent: ['#8b5cf6', '#5b21b6'],
    specs: [
      ['尺寸', '120 × 120 × 25 mm'],
      ['转速', '600–2100 RPM ±10%'],
      ['风量 / 风压', '55.4 CFM / 2.8 mmH₂O'],
      ['屏幕', '1.5 英寸 LCD 数显'],
      ['灯效', '∞ 镜面 ARGB 灯环'],
      ['固定', '4 颗加长螺丝（替换原装风扇）'],
    ],
    desc: '用于替换 SI-100 原装 TL-E12 的白色正叶积木风扇。中心 1.5 英寸 LCD 显示温度与转速，四面无限镜灯效与白色塔体形成统一视觉。',
    teardown: '四颗加长螺丝贯穿风扇与鳍片，需对角交替松开。原装螺丝长度不足，改装时使用了加长规格。拆下风扇后才能取出散热塔体。',
    screws: 4,
    group: fanGroup,
    requires: ['glassLeft'],
    offset: [-255, 20, 120],
    rotation: [0.1, -0.25, 0.16],
    label: { show: true, spec: '120mm LCD · 2100RPM', dx: -156, dy: 68, align: 'right' },
    anchor: [0, 0, 0],
    priority: 3,
  });
}

/* ------------------------------------------------------------------ */
/* DDR4 memory                                                         */
/* ------------------------------------------------------------------ */

function buildMemoryModule(index, position) {
  const g = new THREE.Group();
  g.position.set(...position);

  const diffuserMat = new THREE.MeshStandardMaterial({
    color: 0xe4e8ff,
    emissive: 0x9b7cff,
    emissiveIntensity: 1.4,
    roughness: 0.26,
    metalness: 0.05,
    transparent: true,
    opacity: 0.9,
  });
  const awningMat = new THREE.MeshPhysicalMaterial({
    color: 0xf5f7fb,
    roughness: 0.24,
    metalness: 0.38,
    clearcoat: 0.7,
    clearcoatRoughness: 0.18,
  });

  // PCB
  const pcb = box(31, 132, 2.2, M.pcbBlack, [0, 0, 0], { round: 0.8 });
  g.add(pcb);

  // heat spreaders front/back
  const front = box(32, 122, 4.2, M.white, [0, 4, 5.1], { round: 2.8 });
  const back = box(32, 122, 3.8, M.white, [0, 4, -5.1], { round: 2.8 });
  g.add(front, back);
  // angular top shoulders
  const shoulderL = box(11, 21, 5, awningMat, [-10.5, 60, 5.2], { round: 2 });
  shoulderL.rotation.z = -0.22;
  g.add(shoulderL);
  const shoulderR = box(11, 21, 5, awningMat, [10.5, 60, 5.2], { round: 2 });
  shoulderR.rotation.z = 0.22;
  g.add(shoulderR);
  // metallic inlay lines
  g.add(box(20, 1.2, 0.65, M.brightMetal, [0, 31, 7.35], { cast: false, receive: false }));
  g.add(box(14, 0.9, 0.65, M.brightMetal, [0, -21, 7.35], { cast: false, receive: false }));
  g.add(box(20, 1.2, 0.65, M.brightMetal, [0, 31, -7.35], { cast: false, receive: false }));

  // white label with model
  const labelTex = textTexture(
    [
      { text: '疆珑  i9 龙雪', font: '800 43px "Microsoft YaHei", "Segoe UI", sans-serif' },
      { text: 'RGB DDR4 8GB', font: '600 23px "Segoe UI", sans-serif', color: '#6c7d92' },
    ],
    { width: 512, height: 240, color: '#1e3048', align: 'center', padding: 20 }
  );
  const label = makePlane(27, 13, new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }), [0, 2, 7.2]);
  label.userData.pickable = false;
  g.add(label);
  const labelBack = makePlane(27, 13, new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }), [0, 2, -7.2], [0, Math.PI, 0]);
  labelBack.userData.pickable = false;
  g.add(labelBack);

  // RGB diffuser on the outer edge
  const diffuser = box(4.2, 126, 7.3, diffuserMat, [-16.8, 1, 0], { round: 2.2, cast: false, receive: false });
  diffuser.userData.pickable = true;
  g.add(diffuser);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xb69cff,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  glow.position.set(-19.2, 1, 0);
  glow.scale.set(52, 78, 1);
  glow.userData.pickable = false;
  g.add(glow);

  // gold edge connector
  const gold = box(28, 9, 1.4, M.gold, [0, -65.3, 0], { cast: false });
  g.add(gold);
  for (let i = 0; i < 18; i += 1) {
    g.add(box(1.1, 8.3, 0.6, M.screenBlack, [-12.8 + i * 1.5, -65.3, 0.95], { cast: false, receive: false }));
  }
  // clips
  g.add(box(4, 2.5, 6, M.brightMetal, [0, 66, 3], { round: 0.6, cast: false }));
  g.add(box(4, 2.5, 6, M.brightMetal, [0, 66, -3], { round: 0.6, cast: false }));

  const light = new THREE.PointLight(0xaa88ff, 3.2, 170, 2);
  light.position.set(-21, 1, 0);
  g.add(light);
  rgbTargets.push({
    mats: [diffuserMat],
    type: 'ram',
    light,
    glow,
    speed: 0.55,
    offset: index * 2.1,
  });

  const part = registerPart({
    id: index === 0 ? 'ram1' : 'ram2',
    name: `疆珑 i9 龙雪 RGB DDR4 8G · ${index === 0 ? 'A1' : 'B1'}`,
    short: 'DDR4 8GB · 白色 RGB 马甲',
    category: '核心硬件',
    filter: 'core',
    icon: 'RAM',
    accent: ['#ec4899', '#9d174d'],
    specs: [
      ['型号', '疆珑 i9 龙雪 RGB'],
      ['容量', '8GB（单条）'],
      ['类型', 'DDR4 U-DIMM'],
      ['灯效', '顶部 RGB 导光条'],
      ['马甲', '白色铝合金'],
      ['安装位置', index === 0 ? 'DIMM A1' : 'DIMM B1'],
    ],
    desc: '两条白色 DDR4 内存组成 16GB 双通道。顶部 RGB 导光条带柔和渐变灯效，提升整机内部氛围，同时与白色 SI-100 散热器保持一致。',
    teardown: '先拆左侧玻璃，向外掰开内存插槽卡扣，内存条会轻微弹起，随后垂直向上取出。两条内存请成对安装以启用双通道。',
    screws: 0,
    group: g,
    requires: ['glassLeft'],
    offset: index === 0 ? [150, 60, 120] : [180, 95, 100],
    rotation: index === 0 ? [0.25, 0.18, 0.16] : [0.36, -0.18, 0.08],
    label: index === 0 ? { show: true, spec: 'DDR4 8G ×2 · RGB', dx: 104, dy: 38, align: 'left' } : null,
    anchor: [-16, 24, 0],
    priority: 2,
  });
  return part;
}

function buildMemory() {
  buildMemoryModule(0, [71, 20, 58]);
  buildMemoryModule(1, [71, 20, 70]);
}

/* ------------------------------------------------------------------ */
/* Graphics card: ELSA RTX 5060 Phantom 8G                             */
/* ------------------------------------------------------------------ */

function buildGPU() {
  const g = new THREE.Group();
  // Final mount: hinged forward from the centre glass. The card lies flat,
  // fans down, backplate up, long edge left→right; the copper pipes on the
  // original top edge now point forward toward the centre glass.
  g.position.set(10, -90, 0);
  const qY = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
  const qForward = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  g.quaternion.copy(qForward).multiply(qY);

  const L = 173;
  const H = 118;
  const T = 42;

  const shroud = box(T - 2, H - 4, L - 3, M.plasticBlack, [0, 0, 0], { round: 5 });
  g.add(shroud);
  const frontPlate = box(1.8, H - 12, L - 14, M.graphite, [-19.6, 0, 0], { round: 4 });
  g.add(frontPlate);
  addEdges(shroud, 0x3f4956, 0.36);

  // angular light-catcher strips
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x8a96a5, roughness: 0.25, metalness: 0.92 });
  const strip1 = box(0.45, 2.2, 128, accentMat, [-20.5, 32, -3], { round: 0.4, cast: false, receive: false });
  strip1.rotation.x = 0.42;
  g.add(strip1);
  const strip2 = box(0.45, 1.2, 100, accentMat, [-20.5, -33, 5], { round: 0.4, cast: false, receive: false });
  strip2.rotation.x = -0.28;
  g.add(strip2);
  const strip3 = box(0.45, 1.2, 112, new THREE.MeshStandardMaterial({ color: 0x40526a, roughness: 0.2, metalness: 0.8 }), [-20.4, 0, 3], { round: 0.4, cast: false, receive: false });
  strip3.rotation.x = 0.06;
  g.add(strip3);

  // dual fans
  const fanPositions = [-43, 43];
  fanPositions.forEach((z, idx) => {
    const fan = createFanModel({
      size: 78,
      depth: 17,
      frameMat: M.plasticBlack,
      bladeMat: M.blackGloss,
      hubMat: M.graphite,
      bladeCount: 9,
      logo: 'ELSA',
      logoColor: '#f1f5fb',
      speed: 0.85 + idx * 0.06,
      innerR: 35.6,
      hubR: 12.5,
      padMat: M.black,
    });
    fan.rotation.y = -Math.PI / 2;
    fan.position.set(-21.2, 0, z);
    g.add(fan);
    // machined fan ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(36.4, 1.25, 8, 64), accentMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-21.7, 0, z);
    ring.userData.pickable = false;
    g.add(ring);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(35.2, 0.5, 6, 60), M.darkSteel);
    inner.rotation.y = Math.PI / 2;
    inner.position.set(-22.0, 0, z);
    inner.userData.pickable = false;
    g.add(inner);
  });

  // top edge trim / branding
  const sideBadgeTex = makeCanvasTexture(1024, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(4,8,13,0.85)';
    roundRect(ctx, 0, 0, w, h, 18);
    ctx.fill();
    ctx.fillStyle = '#f5f8fc';
    ctx.font = '800 92px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ELSA', 42, 148);
    ctx.fillStyle = 'rgba(190,205,224,0.8)';
    ctx.font = '600 30px "Segoe UI", sans-serif';
    ctx.fillText('RTX 5060  PHANTOM 8G', 254, 118);
    ctx.fillStyle = 'rgba(117,137,162,0.7)';
    ctx.font = '500 21px "Segoe UI", sans-serif';
    ctx.fillText('GDDR7  ·  145W  ·  PCIe 5.0', 254, 156);
    ctx.fillStyle = '#8492a5';
    ctx.font = '700 24px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('173 mm', w - 38, 228);
  });
  const sideBadge = makePlane(105, 26, new THREE.MeshBasicMaterial({ map: sideBadgeTex, transparent: false }), [-20.4, -21, 42], [0, -Math.PI / 2, 0]);
  sideBadge.userData.pickable = false;
  g.add(sideBadge);

  // long edge branding visible when the card is laid horizontally
  const edgeTex = makeCanvasTexture(1024, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8,12,18,0.78)';
    roundRect(ctx, 0, 0, w, h, 18);
    ctx.fill();
    ctx.fillStyle = 'rgba(245,249,255,0.95)';
    ctx.font = '800 118px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ELSA', 32, 162);
    ctx.fillStyle = 'rgba(180,196,216,0.8)';
    ctx.font = '600 38px "Segoe UI", sans-serif';
    ctx.fillText('RTX 5060  PHANTOM 8G', 330, 128);
    ctx.fillStyle = 'rgba(120,142,168,0.7)';
    ctx.font = '500 23px "Segoe UI", sans-serif';
    ctx.fillText('GDDR7  ·  173mm  ·  145W', 332, 172);
    ctx.strokeStyle = 'rgba(139,165,196,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(330, 190);
    ctx.lineTo(980, 190);
    ctx.stroke();
  });
  const edgePlaneGeo = new THREE.PlaneGeometry(158, 34);
  edgePlaneGeo.rotateX(-Math.PI / 2);
  edgePlaneGeo.rotateY(Math.PI / 2);
  const edgeBadge = new THREE.Mesh(edgePlaneGeo, new THREE.MeshBasicMaterial({ map: edgeTex, transparent: true, depthWrite: false }));
  edgeBadge.position.set(0, 59.1, 0);
  edgeBadge.userData.pickable = false;
  g.add(edgeBadge);

  // Original copper heatpipe layout (position kept as-is). After the card is
  // stood up against the centre glass, this long edge is visible from the front.
  for (let i = 0; i < 4; i += 1) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(10, 53, -58 + i * 30),
      new THREE.Vector3(9, 60, -56 + i * 30),
      new THREE.Vector3(2, 62, -42 + i * 30),
      new THREE.Vector3(-6, 61, -20 + i * 30),
    ]);
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 2.6, 8, false), M.copper);
    pipe.castShadow = true;
    g.add(pipe);
  }
  for (let i = 0; i < 18; i += 1) {
    g.add(box(25, 44, 0.75, M.graphite, [3, 0, -77 + i * 8.7], { cast: false, receive: false }));
  }

  // backplate
  const backplate = box(1.6, H - 8, L - 12, M.graphite, [20.2, 0, 0], { round: 4.5 });
  g.add(backplate);
  const backTex = makeCanvasTexture(1024, 512, (ctx, w, h) => {
    const gr = ctx.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#2a3037');
    gr.addColorStop(0.6, '#1a1f25');
    gr.addColorStop(1, '#10151a');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    for (let i = -h; i < w; i += 50) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(242,247,255,0.9)';
    ctx.font = '800 82px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ELSA', 46, 104);
    ctx.fillStyle = 'rgba(173,190,210,0.6)';
    ctx.font = '600 26px "Segoe UI", sans-serif';
    ctx.fillText('PHANTOM  RTX 5060  8GB  GDDR7', 48, 146);
    ctx.strokeStyle = 'rgba(160,179,203,0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(46, 180);
    ctx.lineTo(650, 180);
    ctx.stroke();
    ctx.fillStyle = 'rgba(130,148,169,0.45)';
    ctx.font = '500 18px "Segoe UI", sans-serif';
    ctx.fillText('DESIGNED FOR COMPACT PERFORMANCE  /  173mm', 48, 214);
    // ventilation slots
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let i = 0; i < 12; i += 1) {
      roundRect(ctx, 720, 60 + i * 28, 220, 10, 5);
      ctx.fill();
    }
  });
  const backFace = makePlane(162, 108, new THREE.MeshBasicMaterial({ map: backTex }), [21.05, 0, 0], [0, Math.PI / 2, 0]);
  backFace.userData.pickable = false;
  g.add(backFace);

  // power connector
  const power = box(14, 13, 24, M.plasticBlack, [4, 55.5, 54], { round: 2 });
  g.add(power);
  const powerPins = box(9, 3, 18, M.graphite, [5, 61.2, 54], { round: 1, cast: false });
  g.add(powerPins);
  const powerLabel = makePlane(18, 5, new THREE.MeshBasicMaterial({
    map: labelTexture('8 PIN  PCIe', { width: 512, height: 128, color: 'rgba(224,233,244,0.7)', font: '600 38px "Segoe UI", sans-serif', align: 'center' }),
    transparent: true,
  }), [0, 62.5, 74], [-Math.PI / 2, 0, 0]);
  powerLabel.userData.pickable = false;
  g.add(powerLabel);

  // PCIe 4.0 x16 gold-finger edge. The old decorative white blocks were
  // removed — this is where the real edge connector belongs.
  const fingers = box(9, 7, 96, M.gold, [0, -58.8, 8], { round: 0.7, cast: false });
  g.add(fingers);
  for (let i = 0; i < 25; i += 1) {
    g.add(box(4.5, 1.2, 2.1, M.screenBlack, [0, -61.9, -35 + i * 3.5], { cast: false, receive: false }));
  }
  const edgeLabel = makePlane(34, 5, new THREE.MeshBasicMaterial({
    map: labelTexture('PCIe 4.0 x16', { width: 512, height: 96, color: 'rgba(255,245,215,0.78)', font: '700 36px "Segoe UI", sans-serif', align: 'center' }),
    transparent: true,
    depthWrite: false,
  }), [-4.55, -58.8, 8], [0, -Math.PI / 2, 0]);
  edgeLabel.userData.pickable = false;
  g.add(edgeLabel);

  // bracket + ports
  const bracket = box(48, 120, 2.2, M.brightMetal, [0, 0, -88], { round: 2 });
  g.add(bracket);
  for (let i = 0; i < 2; i += 1) {
    const slot = box(33, 3.6, 1.4, M.screenBlack, [0, -35 + i * 14, -89.4], { cast: false });
    g.add(slot);
  }
  const ports = [
    { x: 0, y: 38, w: 17, h: 10, type: 'HDMI' },
    { x: 0, y: 23, w: 17, h: 10, type: 'DP' },
    { x: 0, y: 8, w: 17, h: 10, type: 'DP' },
    { x: 0, y: -7, w: 17, h: 10, type: 'DP' },
  ];
  ports.forEach((p) => {
    const port = box(p.w, p.h, 3, M.darkSteel, [p.x, p.y, -89.7], { round: 1.2 });
    g.add(port);
    const hole = box(p.w - 4, p.h - 4, 1, M.black, [p.x, p.y, -91.4], { cast: false });
    g.add(hole);
  });
  // bracket thumbscrews
  addScrew(g, [0, 52, -90], [0, 0, -1], { radius: 2.4, length: 8, headMaterial: M.steel, thumbscrew: true });
  addScrew(g, [0, -52, -90], [0, 0, -1], { radius: 2.4, length: 8, headMaterial: M.steel, thumbscrew: true });
  // shroud screws
  [[-16, -52], [-16, 52]].forEach(([x, y]) => {
    addScrew(g, [x, y, -83], [0, 0, -1], { radius: 1.2, length: 3, headMaterial: M.darkSteel });
  });

  const part = registerPart({
    id: 'gpu',
    name: '艾尔莎 RTX 5060 幻影者 8G',
    short: '8GB GDDR7 · 173mm 短卡',
    category: '核心硬件',
    filter: 'core',
    icon: 'GPU',
    accent: ['#7c3aed', '#4c1d95'],
    specs: [
      ['型号', 'ELSA RTX 5060 幻影者 8G'],
      ['显存', '8GB GDDR7 · 128-bit'],
      ['核心', 'GB206 · 3840 CUDA'],
      ['长度', '173 mm（双风扇短卡）'],
      ['功耗', '145 W · 单 8-pin'],
      ['输出', '3 × DP + 1 × HDMI'],
    ],
    desc: '专为 ITX 机箱设计的 173mm 双风扇 RTX 5060。黑色幻影者外壳搭配双 9 叶风扇与金属背板，在 145W 功耗下提供 1080p / 2K 游戏性能。',
    teardown: '先拆左侧玻璃，松开显卡挡板两颗手拧螺丝，按下 PCIe 插槽卡扣，再沿 PCIe 延长线方向水平取出。注意 8-pin 供电线。',
    screws: 4,
    group: g,
    requires: ['glassLeft'],
    offset: [-260, -95, 88],
    rotation: [0.03, 0.28, 0.13],
    label: { show: true, spec: 'RTX 5060 8G · 173mm', dx: -142, dy: 24, align: 'right' },
    anchor: [-19, 20, 20],
    priority: 4,
  });
}

/* ------------------------------------------------------------------ */
/* Storage: Colorful CN600 2TB PRO + white 4mm heatsink                */
/* ------------------------------------------------------------------ */

function buildStorage() {
  const center = new THREE.Vector3(83.2, -24, 15);

  // bare SSD
  const g = new THREE.Group();
  g.position.copy(center);
  const pcb = box(2.2, 22, 80, M.pcbGreen, [0, 0, 0], { round: 1.2 });
  g.add(pcb);
  const labelTex = makeCanvasTexture(256, 768, (ctx, w, h) => {
    ctx.fillStyle = '#1e5542';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d9f5e8';
    ctx.font = '800 42px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('COLORFUL', w / 2, 88);
    ctx.font = '800 60px "Segoe UI", sans-serif';
    ctx.fillText('CN600', w / 2, 160);
    ctx.font = '600 26px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(212,242,231,0.76)';
    ctx.fillText('2TB  PRO', w / 2, 206);
    ctx.font = '500 17px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(203,238,225,0.45)';
    ctx.fillText('PCIe NVMe SSD', w / 2, h - 54);
  });
  const ssdLabel = makePlane(17, 58, new THREE.MeshBasicMaterial({ map: labelTex }), [1.13, 0, 0], [0, Math.PI / 2, 0]);
  ssdLabel.userData.pickable = false;
  g.add(ssdLabel);

  // chips
  const chipMat = new THREE.MeshStandardMaterial({ color: 0x161c23, roughness: 0.52, metalness: 0.2 });
  for (let i = 0; i < 4; i += 1) {
    const chip = box(1.2, 15, 15, chipMat, [-0.4, 2, -23 + i * 15], { round: 0.6, cast: false });
    g.add(chip);
  }
  const ctrl = box(1.3, 10, 13, M.graphite, [-0.45, -5, 24], { round: 0.4, cast: false });
  g.add(ctrl);
  // gold edge
  const edge = box(1.8, 14, 6, M.gold, [0, 0, -39], { cast: false });
  g.add(edge);
  const notch = box(2.3, 3, 3, M.screenBlack, [0, 0, -37], { cast: false });
  g.add(notch);
  // tiny screw
  addScrew(g, [1.2, 0, 33], [1, 0, 0], { radius: 0.9, length: 2.8, headMaterial: M.steel });

  const ssd = registerPart({
    id: 'ssd',
    name: '七彩虹 CN600 2TB PRO',
    short: '2TB NVMe · M.2 2280 裸条',
    category: '核心硬件',
    filter: 'core',
    icon: 'SSD',
    accent: ['#14b8a6', '#0f766e'],
    specs: [
      ['型号', 'Colorful CN600 2TB PRO'],
      ['容量', '2 TB'],
      ['规格', 'M.2 2280'],
      ['接口', 'PCIe NVMe'],
      ['形态', '裸条（无原装马甲）'],
      ['散热', '白色 4mm 铝合金马甲'],
    ],
    desc: '2TB 容量的 M.2 2280 固态硬盘，以裸条形式安装，并额外覆盖一层约 4mm 厚的白色铝合金散热马甲，兼顾导热与整机白色主题。',
    teardown: '先拆下白色散热马甲，再拧下 M.2 尾部固定螺丝，SSD 会以约 30° 角弹起，随后抽出。安装时注意金手指缺口。',
    screws: 1,
    group: g,
    requires: ['glassLeft', 'ssdHeatsink'],
    offset: [240, -75, 100],
    rotation: [-0.25, -0.2, 0.18],
    label: null,
    anchor: [-1, 0, 0],
    priority: 2,
  });

  // heatsink
  const hs = new THREE.Group();
  hs.position.set(80.7, -24, 15);
  const plate = box(4.2, 26, 84, M.white, [0, 0, 0], { round: 3.2 });
  hs.add(plate);
  addEdges(plate, 0xd9e5f2, 0.5);
  // chamfered top / fins
  hs.add(box(4.6, 2.2, 76, M.brightMetal, [0, 13, 0], { round: 0.8, cast: false }));
  for (let i = 0; i < 6; i += 1) {
    hs.add(box(4.9, 0.7, 70, M.white, [0, 8 + i * 0.9, 0], { cast: false, receive: false }));
  }
  // thermal pad
  const pad = box(1.2, 19, 71, M.thermalPad, [2.5, -0.6, 0], { round: 1, cast: false });
  pad.userData.pickable = false;
  hs.add(pad);
  const hsTex = makeCanvasTexture(768, 256, (ctx, w, h) => {
    const gr = ctx.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.5, '#eef3f9');
    gr.addColorStop(1, '#dce6f2');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(36,54,78,0.88)';
    ctx.font = '800 48px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('COLORFUL', 34, 84);
    ctx.font = '600 28px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(58,78,103,0.66)';
    ctx.fillText('CN600  2TB  PRO', 36, 126);
    ctx.font = '500 18px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(84,106,132,0.5)';
    ctx.fillText('M.2 2280  ·  NVMe  ·  WHITE HEATSINK', 36, 160);
    ctx.strokeStyle = 'rgba(60,82,110,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(34, 186);
    ctx.lineTo(w - 34, 186);
    ctx.stroke();
    ctx.fillStyle = 'rgba(71,97,131,0.45)';
    ctx.font = '500 15px "Segoe UI", sans-serif';
    ctx.fillText('4mm ALUMINIUM  /  THERMAL PAD', 36, 214);
  });
  const hsLabel = makePlane(68, 22.5, new THREE.MeshBasicMaterial({ map: hsTex }), [-2.14, 0, 0], [0, -Math.PI / 2, 0]);
  hsLabel.userData.pickable = false;
  hs.add(hsLabel);
  addScrew(hs, [-1.8, 0, 37], [-1, 0, 0], { radius: 1.1, length: 4, headMaterial: M.steel });

  const hsPart = registerPart({
    id: 'ssdHeatsink',
    name: 'CN600 白色 4mm 散热马甲',
    short: '铝合金 · 4mm · 白色',
    category: '核心硬件',
    filter: 'core',
    icon: 'M.2',
    accent: ['#38bdf8', '#0369a1'],
    specs: [
      ['适配', 'M.2 2280'],
      ['厚度', '约 4 mm'],
      ['材质', '白色阳极氧化铝'],
      ['导热', '硅胶导热垫'],
      ['固定', '1 颗 M.2 螺丝'],
    ],
    desc: '为 CN600 裸条额外加装的白色铝合金马甲，厚度约 4mm，不干扰显卡与散热器风道，同时统一整机白色主题。',
    teardown: '先拆下尾部 M.2 螺丝，再水平滑出马甲。安装时确认导热垫完整贴合 NAND 与主控。',
    screws: 1,
    group: hs,
    requires: ['glassLeft'],
    offset: [275, -120, 80],
    rotation: [-0.18, 0.24, 0.12],
    label: { show: true, spec: 'CN600 2TB PRO · 4mm', dx: 112, dy: 78, align: 'left' },
    anchor: [0, 0, 0],
    priority: 2,
  });
}

/* ------------------------------------------------------------------ */
/* PSU                                                                 */
/* ------------------------------------------------------------------ */

function buildPowerSupply() {
  const g = new THREE.Group();
  g.position.set(40, -97, -38);

  const body = box(125, 63.5, 100, M.white, [0, 0, 0], { round: 4 });
  g.add(body);
  addEdges(body, 0xc8d5e4, 0.42);
  // seams
  g.add(box(126, 0.7, 1.2, M.brightMetal, [0, 8, 49.2], { cast: false, receive: false }));
  g.add(box(1.2, 63, 1.4, M.brightMetal, [62.2, 0, -30], { cast: false, receive: false }));

  // fan side on top
  const fanDisc = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x222932, roughness: 0.7, metalness: 0.2 }));
  fanDisc.rotation.x = -Math.PI / 2;
  fanDisc.position.set(-6, 32, 2);
  fanDisc.userData.pickable = false;
  g.add(fanDisc);
  const fanSpinner = new THREE.Group();
  for (let i = 0; i < 7; i += 1) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 7) * Math.PI * 2;
    const blade = box(22, 0.8, 9, M.graphite, [13, 0, 0], { round: 2.4, cast: false, receive: false });
    pivot.add(blade);
    fanSpinner.add(pivot);
  }
  fanSpinner.position.set(-6, 33.2, 2);
  g.add(fanSpinner);
  fanSpinners.push({ group: fanSpinner, speed: 0.8, direction: 1, horizontal: true });
  // grille
  for (let i = 1; i <= 3; i += 1) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8 + i * 9.4, 0.65, 6, 48), M.wire);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(-6, 34.2, 2);
    ring.userData.pickable = false;
    g.add(ring);
  }
  for (let i = 0; i < 4; i += 1) {
    const bar = box(0.9, 0.6, 72, M.wire, [-6, 34.15, 2], { cast: false, receive: false });
    bar.rotation.y = (i / 4) * Math.PI;
    bar.userData.pickable = false;
    g.add(bar);
  }

  // side branding panel
  const psuTex = makeCanvasTexture(1024, 512, (ctx, w, h) => {
    const gr = ctx.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#f8fafc');
    gr.addColorStop(0.6, '#e9eff6');
    gr.addColorStop(1, '#dbe4ef');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(83,108,140,0.13)';
    ctx.lineWidth = 2;
    for (let i = -h; i < w; i += 36) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
    }
    ctx.fillStyle = '#26394f';
    ctx.font = '800 66px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('DEEPCOOL', 46, 130);
    ctx.fillStyle = 'rgba(46,68,94,0.58)';
    ctx.font = '600 28px "Segoe UI", sans-serif';
    ctx.fillText('GAMER STORM  ·  PS650G-FE', 48, 174);
    ctx.fillStyle = 'rgba(48,73,102,0.5)';
    ctx.font = '500 18px "Segoe UI", sans-serif';
    ctx.fillText('650W  ·  SFX  ·  FULLY MODULAR  ·  ATX 3.1', 48, 208);
    ctx.fillStyle = '#1c2f45';
    ctx.font = '800 44px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('PLATINUM', w - 46, 430);
    ctx.fillStyle = 'rgba(43,66,92,0.55)';
    ctx.font = '600 19px "Segoe UI", sans-serif';
    ctx.fillText('CYBENETICS  ·  80 PLUS', w - 48, 462);
    // small certificate mark
    ctx.strokeStyle = 'rgba(52,76,104,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w - 98, 372, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(52,76,104,0.52)';
    ctx.font = '600 12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('80+', w - 98, 376);
  });
  const side = makePlane(98, 46, new THREE.MeshBasicMaterial({ map: psuTex }), [0, 0, 50.6]);
  side.userData.pickable = false;
  g.add(side);

  // modular connector side (towards motherboard)
  const panel = box(2.4, 48, 82, M.whiteSoft, [62.2, 0, -4], { round: 2 });
  g.add(panel);
  const sockets = [
    { y: 16, z: -25, w: 11, h: 20, rows: 2 },
    { y: 16, z: 0, w: 11, h: 20, rows: 2 },
    { y: 16, z: 25, w: 9, h: 15, rows: 1 },
    { y: -12, z: -24, w: 8, h: 14, rows: 1 },
    { y: -12, z: 0, w: 8, h: 14, rows: 1 },
    { y: -12, z: 22, w: 7, h: 10, rows: 1 },
  ];
  sockets.forEach((s) => {
    const sock = box(2.4, s.h, s.w, M.plasticDark, [63.8, s.y, s.z], { round: 1 });
    g.add(sock);
    const pins = [];
    const cols = s.rows === 2 ? 2 : 1;
    for (let r = 0; r < cols; r += 1) {
      for (let c = 0; c < 6; c += 1) {
        pins.push(box(0.7, 1.6, 1, M.steel, [65.2, s.y - s.h / 2 + 4 + c * 2.4, s.z - s.w / 2 + 2 + r * 2.8], { cast: false, receive: false }));
      }
    }
    g.add(...pins);
  });
  const psuLabel = makePlane(18, 4, new THREE.MeshBasicMaterial({
    map: labelTexture('PS650G-FE', { width: 512, height: 100, color: 'rgba(54,75,100,0.65)', font: '700 42px "Segoe UI", sans-serif', align: 'center' }),
    transparent: true,
  }), [64.0, 28, -4], [0, Math.PI / 2, 0]);
  psuLabel.userData.pickable = false;
  g.add(psuLabel);

  // rubber feet
  [[-48, -35], [48, -35], [-48, 35], [48, 35]].forEach(([x, z]) => {
    const foot = cylinder(4, 4, 2.2, 14, M.rubber, [x, -32.6, z]);
    foot.castShadow = false;
    g.add(foot);
  });

  // mounting screws
  [[-56, -28], [-56, 28], [56, -28], [56, 28]].forEach(([x, z]) => {
    addScrew(g, [x, 33.5, z], [0, 1, 0], { radius: 1.3, length: 5, headMaterial: M.steel });
  });

  const part = registerPart({
    id: 'psu',
    name: '九州风神 PS650G-FE',
    short: '650W SFX · 白色全模组',
    category: '供电器材',
    filter: 'power',
    icon: 'PSU',
    accent: ['#22c55e', '#15803d'],
    specs: [
      ['型号', 'DeepCool PS650G-FE'],
      ['额定功率', '650 W'],
      ['规格', 'SFX · ATX 3.1'],
      ['认证', 'Cybenetics Platinum'],
      ['尺寸', '125 × 100 × 63.5 mm'],
      ['线材', '全模组 · 白色定制线'],
    ],
    desc: '650W SFX 全模组白色电源，ATX 3.1 规范，原生 12V-2x6 接口。紧凑尺寸适配 FY-01 的底部电源仓，白色线材贯穿整机。',
    teardown: '先拆前面板与左侧玻璃，断开主板 24-pin、CPU 8-pin、显卡 8-pin 以及 SATA 供电，再卸下 4 颗电源固定螺丝，向后方抽出。',
    screws: 4,
    group: g,
    requires: ['glassFront', 'glassLeft'],
    offset: [80, -210, 120],
    rotation: [0.04, 0.16, 0.03],
    label: { show: true, spec: '650W SFX · 铂金', dx: -164, dy: 44, align: 'right' },
    anchor: [0, 12, 52],
    priority: 2,
  });
}

/* ------------------------------------------------------------------ */
/* Case fans                                                           */
/* ------------------------------------------------------------------ */

function addFanCable(parent, points, radius = 0.8) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, radius, 5, false), M.cableDark);
  tube.userData.pickable = false;
  tube.castShadow = false;
  parent.add(tube);
  return tube;
}

function buildTopFan(index) {
  const x = index === 0 ? -55 : 35;
  const g = new THREE.Group();
  g.position.set(x, 114, 40);

  const fan = createFanModel({
    size: 80,
    depth: 25,
    frameMat: M.white,
    bladeMat: M.whiteSoft,
    hubMat: M.whiteMetal,
    bladeCount: 7,
    logo: 'TR',
    logoColor: 'rgba(57,75,97,0.72)',
    innerR: 35.6,
    hubR: 11,
    speed: 2.6,
    padMat: M.rubber,
    arrow: false,
  });
  fan.rotation.x = Math.PI / 2;
  g.add(fan);

  // anti vibration pads
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const pad = box(8, 1.3, 8, M.rubber, [sx * 35, -12.8, sz * 35], { round: 2, cast: false, receive: false });
    pad.userData.pickable = false;
    g.add(pad);
  });

  [[-35, -35], [35, -35], [-35, 35], [35, 35]].forEach(([sx, sz]) => {
    addScrew(g, [sx, 13.4, sz], [0, 1, 0], {
      radius: 1.15,
      length: 5,
      headMaterial: M.darkSteel,
      label: '顶部风扇固定螺丝',
    });
  });

  addFanCable(g, [
    [25, 8, 20],
    [35, -8, 26],
    [46, -38, 38],
    [58, -58, 58],
  ]);
  const label = index === 0
    ? { show: true, spec: '80×25 · 2200RPM ×2', dx: 104, dy: -48, align: 'left' }
    : null;

  const part = registerPart({
    id: index === 0 ? 'topFan1' : 'topFan2',
    name: `利民 TL-B8W 顶部进风风扇 ${index === 0 ? 'A' : 'B'}`,
    short: '80×80×25 · 2200RPM',
    category: '散热系统',
    filter: 'cool',
    icon: 'FAN',
    accent: ['#06b6d4', '#0e7490'],
    specs: [
      ['型号', 'Thermalright TL-B8W 白色'],
      ['尺寸', '80 × 80 × 25 mm'],
      ['转速', '2200 RPM ±10%'],
      ['风量 / 风压', '34 CFM / 2.7 mmH₂O'],
      ['噪音', '≤ 24 dBA'],
      ['轴承 / 接口', 'S-FDB V2 / 4-pin PWM'],
    ],
    desc: '顶部两把 80mm 标规白风扇作为进风，直接向下吹向 CPU 散热器与内存区域，形成自顶向下的正压风道。',
    teardown: '先拆顶部冲孔面板，再卸下四角固定螺丝即可向下取出风扇。安装时注意风扇出风方向箭头朝向机箱内部。',
    screws: 4,
    group: g,
    requires: ['topPanel'],
    offset: [index === 0 ? -90 : 60, 160 + index * 30, 70 + index * 30],
    rotation: [0.15, 0.15, index === 0 ? 0.04 : -0.08],
    label,
    anchor: [0, 0, 0],
    priority: 2,
  });
}

function buildRearFan(index) {
  const x = -55;
  const g = new THREE.Group();
  g.position.set(x, index === 0 ? 52 : -23, -111.2);

  const fan = createFanModel({
    size: 80,
    depth: 15,
    frameMat: M.white,
    bladeMat: M.whiteSoft,
    hubMat: M.whiteMetal,
    bladeCount: 7,
    logo: 'TR',
    logoColor: 'rgba(57,75,97,0.68)',
    innerR: 35.6,
    hubR: 10,
    speed: 2.4,
    padMat: M.rubber,
    grille: true,
    arrow: false,
  });
  fan.rotation.y = Math.PI;
  g.add(fan);

  [[-35, -35], [35, -35], [-35, 35], [35, 35]].forEach(([sx, sy]) => {
    addScrew(g, [sx, sy, 8.4], [0, 0, 1], {
      radius: 1.05,
      length: 5,
      headMaterial: M.darkSteel,
      label: '后置风扇固定螺丝',
    });
  });
  addFanCable(g, [
    [-25, 10, -2],
    [-30, -6, 8],
    [-22, -32, 24],
    [6, -44, 40],
  ]);

  const part = registerPart({
    id: index === 0 ? 'rearFan1' : 'rearFan2',
    name: `利民 TL-8015W 后部排风风扇 ${index === 0 ? 'A' : 'B'}`,
    short: '80×80×15 · 2200RPM',
    category: '散热系统',
    filter: 'cool',
    icon: 'FAN',
    accent: ['#06b6d4', '#0e7490'],
    specs: [
      ['型号', 'Thermalright TL-8015W 白色'],
      ['尺寸', '80 × 80 × 15 mm 薄款'],
      ['转速', '2200 RPM ±10%'],
      ['风量 / 风压', '28.4 CFM / 1.25 mmH₂O'],
      ['噪音', '≤ 23.3 dBA'],
      ['轴承 / 接口', 'S-FDB V2 / 4-pin PWM'],
    ],
    desc: '机箱后部两把 15mm 薄款 80mm 风扇，作为排风将机箱内的热空气抽出。薄款设计为后置 IO 与线材留出了宝贵空间。',
    teardown: '卸下四角 4 颗固定螺丝，向外侧取下风扇。安装时注意薄款风扇方向与排风箭头，线材从下方走线槽汇入。',
    screws: 4,
    group: g,
    requires: [],
    offset: [index === 0 ? -190 : 255, -52 - index * 12, -36],
    rotation: [0, 0.18, index === 0 ? 0.06 : -0.08],
    label: index === 0 ? { show: true, spec: '80×15 薄款 · 2200RPM ×2', dx: 94, dy: -34, align: 'left' } : null,
    anchor: [0, 0, 0],
    priority: 1,
  });
}

function buildCaseFans() {
  buildTopFan(0);
  buildTopFan(1);
  buildRearFan(0);
  buildRearFan(1);
}

/* ------------------------------------------------------------------ */
/* Intel AX201 WiFi card                                               */
/* ------------------------------------------------------------------ */

function buildWifiCard() {
  const g = new THREE.Group();
  g.position.set(84.2, 70, -74);
  const pcb = box(2, 24, 31, M.pcbGreen, [0, 0, 0], { round: 1.2 });
  g.add(pcb);
  const shield = box(1.2, 17, 24, M.brightMetal, [-1.1, 1, 0], { round: 1 });
  g.add(shield);
  const shTex = makeCanvasTexture(384, 256, (ctx, w, h) => {
    ctx.fillStyle = '#c6ced8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(41,56,75,0.82)';
    ctx.font = '800 36px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Intel', w / 2, 72);
    ctx.font = '700 26px "Segoe UI", sans-serif';
    ctx.fillText('AX201NGW', w / 2, 112);
    ctx.font = '500 15px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(52,70,92,0.55)';
    ctx.fillText('Wi-Fi 6  ·  BT 5.2', w / 2, 148);
    ctx.fillText('M.2 2230  ·  CNVi', w / 2, 174);
  });
  const lbl = makePlane(17, 11, new THREE.MeshBasicMaterial({ map: shTex }), [-1.72, 1, 0], [0, -Math.PI / 2, 0]);
  lbl.userData.pickable = false;
  g.add(lbl);
  // gold edge connector
  g.add(box(1.4, 3, 10, M.gold, [0, -11.6, 0], { cast: false }));
  // antenna feeds
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x2d3440, roughness: 0.8 });
  [[-4, 3], [4, 3]].forEach(([z, y]) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.8, y + 6, z),
      new THREE.Vector3(3, y + 16, z - 7),
      new THREE.Vector3(12, y + 25, z - 20),
      new THREE.Vector3(24, y + 18, z - 38),
    ]);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.5, 5, false), wireMat);
    wire.userData.pickable = false;
    g.add(wire);
  });
  addScrew(g, [-1.5, 9.5, 0], [-1, 0, 0], { radius: 0.8, length: 2.5, headMaterial: M.steel });

  const part = registerPart({
    id: 'wifiCard',
    name: 'Intel AX201 无线网卡',
    short: 'WiFi 6 · Bluetooth 5.2',
    category: '核心硬件',
    filter: 'core',
    icon: 'NET',
    accent: ['#0284c7', '#075985'],
    specs: [
      ['型号', 'Intel AX201NGW'],
      ['无线', 'WiFi 6 · 2.4/5GHz'],
      ['蓝牙', 'Bluetooth 5.2'],
      ['接口', 'M.2 2230 · CNVi'],
      ['天线', '2 × 2 双频'],
      ['位置', '主板 M.2 E-Key'],
    ],
    desc: '主板原装贴片式 AX201 无线网卡，支持 WiFi 6 与蓝牙 5.2，两根白色天线沿机箱内侧引出，避免外置网卡占用空间。',
    teardown: '先拆左侧玻璃，卸下 M.2 2230 固定螺丝，将网卡沿插槽斜向上抽出。注意两根极细的天线馈线。',
    screws: 1,
    group: g,
    requires: ['glassLeft'],
    offset: [176, -50, 114],
    rotation: [0.2, 0.2, 0.35],
    label: null,
    anchor: [0, 0, 0],
    priority: 1,
  });
}

/* ------------------------------------------------------------------ */
/* Cables                                                              */
/* ------------------------------------------------------------------ */

function cableBundle(parent, worldPoints, opts = {}) {
  const {
    strands = 5,
    radius = 1.1,
    spread = 1.65,
    material = M.cableWhite,
    combEvery = 2,
  } = opts;
  const psuPos = parts.get('psu').basePos;
  const basePts = worldPoints.map((p) => new THREE.Vector3(...p).sub(psuPos));
  const curve = new THREE.CatmullRomCurve3(basePts);
  const tubeGroup = new THREE.Group();
  for (let s = 0; s < strands; s += 1) {
    const offset = (s - (strands - 1) / 2) * spread;
    const pts = [];
    for (let i = 0; i < 14; i += 1) {
      const t = i / 13;
      const p = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();
      const side = new THREE.Vector3(-tangent.y, tangent.x, 0.15).normalize();
      p.addScaledVector(side, offset * Math.sin(Math.PI * Math.min(1, t * 1.1)));
      pts.push(p);
    }
    const strandCurve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(strandCurve, 40, radius, 6, false), material);
    tube.userData.pickable = false;
    tube.castShadow = true;
    tube.receiveShadow = true;
    tubeGroup.add(tube);
  }
  for (let i = 1; i < basePts.length - 1; i += combEvery) {
    const p = basePts[i];
    const comb = box(3.2, 7.5, 7.5, M.whiteSoft, [p.x, p.y, p.z], { round: 1.4, cast: false, receive: false });
    comb.userData.pickable = false;
    tubeGroup.add(comb);
  }
  parent.add(tubeGroup);
  return tubeGroup;
}

function buildCables() {
  const psu = parts.get('psu');
  if (!psu) return;
  const cables = new THREE.Group();
  cables.name = 'custom-white-cables';
  psu.group.add(cables);

  cableBundle(cables, [
    [72, -64, -38],
    [80, -40, -6],
    [76, -2, 34],
    [70, 40, 60],
    [67, 62, 68],
  ], { strands: 6, radius: 1.15, spread: 1.65 });

  cableBundle(cables, [
    [52, -64, -70],
    [56, -48, -82],
    [54, -6, -76],
    [48, 42, -66],
    [58, 82, -54],
  ], { strands: 4, radius: 1.05, spread: 1.5, combEvery: 3 });

  cableBundle(cables, [
    [55, -64, -12],
    [36, -54, 8],
    [4, -36, 30],
    [-24, -14, 42],
    [-46, 8, 46],
  ], { strands: 4, radius: 1.0, spread: 1.45, combEvery: 2 });

  // GPU riser ribbon. It is a decorative part of the chassis, not selectable.
  const riserGroup = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(78, -42, -12),
    new THREE.Vector3(58, -74, -6),
    new THREE.Vector3(20, -94, 0),
    new THREE.Vector3(-20, -100, 4),
    new THREE.Vector3(-47, -100, 6),
  ]);
  for (let i = 0; i < 6; i += 1) {
    const off = (i - 2.5) * 1.4;
    const pts = [];
    for (let s = 0; s < 14; s += 1) {
      const t = s / 13;
      const p = curve.getPoint(t);
      p.y += off * Math.sin(t * Math.PI);
      pts.push(p);
    }
    const c = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(c, 36, 0.8, 5, false), M.cableWhite);
    tube.userData.pickable = false;
    riserGroup.add(tube);
  }
  riserGroup.userData.pickable = false;
  pcRoot.add(riserGroup);
  cableGroups.push(riserGroup);
}

/* ------------------------------------------------------------------ */
/* Finalize parts, labels, glows                                       */
/* ------------------------------------------------------------------ */

const cageBox = new THREE.Box3();
let lastLCDUpdate = 0;
let lastCageUpdate = 0;

function finalizeParts() {
  state.screwCount = 0;
  partsOrder.forEach((part) => {
    state.screwCount += part.screwCount || 0;
    if (!part.anchorLocal || part.anchorLocal.lengthSq() === 0) {
      const b = getPartBox(part, new THREE.Box3());
      if (!b.isEmpty()) {
        const c = b.getCenter(new THREE.Vector3());
        part.anchorLocal.copy(c).sub(part.group.position);
      }
    }
    const b = getPartBox(part, new THREE.Box3());
    const size = b.isEmpty() ? new THREE.Vector3(20, 20, 20) : b.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 10);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: new THREE.Color(part.accent[0]),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }));
    sprite.position.copy(part.anchorLocal);
    sprite.scale.setScalar(maxDim * 0.9);
    sprite.renderOrder = 997;
    sprite.userData.pickable = false;
    sprite.userData.glowBase = maxDim * 0.9;
    part.glowSprite = sprite;
    part.glowLevel = 0;
    part.glowTarget = 0;
    part.group.add(sprite);
  });

  createLabels();
  dom.progressTotal.textContent = state.totalRemovable;
  dom.screwCount.textContent = state.screwCount;
}

const LABEL_NAMES = {
  case: '菲远 FY-01',
  mobo: '精粤 B760I GAMING',
  cpu: 'i5-14490F',
  gpu: 'ELSA RTX 5060',
  ram1: '疆珑 DDR4 8G ×2',
  coolerHeatsink: 'SI-100 塔体',
  coolerFan: '星际积木 V4 LCD',
  ssdHeatsink: 'CN600 散热马甲',
  psu: 'PS650G-FE',
  topFan1: 'TL-B8W ×2',
  rearFan1: 'TL-8015W ×2',
};

let lastLabelLayout = -10000;

function createLabels() {
  dom.labelLines.innerHTML = '';
  labelEntries.length = 0;
  const svgNS = 'http://www.w3.org/2000/svg';
  partsOrder.forEach((part) => {
    if (!part.label || !part.label.show) return;
    const cfg = part.label;
    const el = document.createElement('div');
    el.className = `scene-label ${cfg.align === 'right' ? 'left' : ''}`;
    el.dataset.id = part.id;
    el.dataset.priority = part.priority;
    el.style.setProperty('--dx', `${cfg.dx}px`);
    el.style.setProperty('--dy', `${cfg.dy}px`);
    el.innerHTML = `
      <span class="label-dot"></span>
      <span class="label-pill">
        <i class="tag"></i>
        <span class="name">${LABEL_NAMES[part.id] || part.name}</span>
        <span class="spec">${cfg.spec || part.short}</span>
      </span>
    `;
    dom.labelLayer.appendChild(el);
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('stroke', 'rgba(51,88,140,0.35)');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '2 3');
    dom.labelLines.appendChild(line);
    const entry = {
      part,
      el,
      line,
      cfg,
      pill: el.querySelector('.label-pill'),
      offsetX: cfg.dx,
      offsetY: cfg.dy,
      visible: true,
      screenX: 0,
      screenY: 0,
    };
    part.labelEntry = entry;
    labelEntries.push(entry);
  });
}

function labelCandidateOffsets(cfg, pw) {
  const bx = cfg.dx;
  const by = cfg.dy;
  const sign = bx >= 0 ? 1 : -1;
  const spreadX = Math.max(Math.abs(bx) * 0.86, pw + 48);
  const base = [
    [bx, by],
    [bx, by - 32],
    [bx, by + 32],
    [bx, by - 62],
    [bx, by + 62],
    [sign * spreadX, by - 86],
    [sign * spreadX, by + 86],
    [-sign * Math.min(spreadX, 150), by - 50],
    [-sign * Math.min(spreadX, 150), by + 50],
    [sign * Math.min(spreadX, 120), by + 118],
  ];
  return base;
}

function layoutLabels(w, h) {
  const compact = w < 980;
  const removedNow = partsOrder.filter((p) => p.removable && p.removed).length;
  const manyExploded = removedNow > 5;
  const placed = [];
  const visibleEntries = [];
  labelEntries.forEach((entry) => {
    const { part, el, line } = entry;
    const world = part.anchorLocal.clone().applyMatrix4(part.group.matrixWorld);
    const ndc = world.clone().project(camera);
    entry.screenX = (ndc.x * 0.5 + 0.5) * w;
    entry.screenY = (-ndc.y * 0.5 + 0.5) * h;
    const inFrustum = ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) < 1.3 && Math.abs(ndc.y) < 1.3;
    const underPanel = w > 1180 && (entry.screenX < 315 || entry.screenX > w - 352);
    const allowCompact = !compact || part.priority >= 2 || state.selected === part.id;
    const allowExploded = !manyExploded || state.selected === part.id || state.hovered === part.id;
    entry.visible = inFrustum && !underPanel && allowCompact && allowExploded;
    if (entry.visible) visibleEntries.push(entry);
    else {
      el.style.display = 'none';
      line.style.display = 'none';
    }
  });

  visibleEntries.sort((a, b) => {
    if (a.part.id === state.selected) return -1;
    if (b.part.id === state.selected) return 1;
    return (b.part.priority || 0) - (a.part.priority || 0) || a.part.index - b.part.index;
  });

  const minX = w > 1180 ? 318 : 12;
  const maxX = w > 1180 ? w - 352 : w - 12;
  const minY = w <= 880 ? 78 : 88;
  const maxY = h - 118;

  visibleEntries.forEach((entry) => {
    const { cfg, pill, screenX, screenY } = entry;
    const pw = Math.max(90, pill.offsetWidth || 150);
    const ph = Math.max(20, pill.offsetHeight || 24);
    const candidates = labelCandidateOffsets(cfg, pw);
    let chosen = null;
    for (const [dx, dy] of candidates) {
      const left = cfg.align === 'right' ? screenX + dx - pw : screenX + dx;
      const top = screenY + dy - ph / 2;
      const rect = { left, top, right: left + pw, bottom: top + ph };
      if (rect.left < minX || rect.right > maxX || rect.top < minY || rect.bottom > maxY) continue;
      let overlaps = false;
      for (const other of placed) {
        if (rect.left < other.right + 5 && rect.right > other.left - 5 && rect.top < other.bottom + 5 && rect.bottom > other.top - 5) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        chosen = { dx, dy, rect };
        break;
      }
    }
    if (!chosen) {
      entry.visible = false;
      entry.el.style.display = 'none';
      entry.line.style.display = 'none';
      return;
    }
    entry.offsetX = chosen.dx;
    entry.offsetY = chosen.dy;
    entry.el.style.setProperty('--dx', `${chosen.dx.toFixed(1)}px`);
    entry.el.style.setProperty('--dy', `${chosen.dy.toFixed(1)}px`);
    placed.push(chosen.rect);
    entry.el.style.display = '';
    entry.line.style.display = '';
  });
}

function updateLabels() {
  if (!state.labels) {
    dom.labelLayer.classList.add('hidden');
    return;
  }
  dom.labelLayer.classList.remove('hidden');
  const w = window.innerWidth;
  const h = window.innerHeight;
  const now = performance.now();
  if (now - lastLabelLayout > 140) {
    lastLabelLayout = now;
    layoutLabels(w, h);
  }
  labelEntries.forEach((entry) => {
    if (!entry.visible) {
      entry.el.style.display = 'none';
      entry.line.style.display = 'none';
      return;
    }
    const x = entry.screenX;
    const y = entry.screenY;
    const dx = entry.offsetX;
    const dy = entry.offsetY;
    entry.el.style.display = '';
    entry.line.style.display = '';
    entry.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    entry.line.setAttribute('x1', x.toFixed(1));
    entry.line.setAttribute('y1', y.toFixed(1));
    entry.line.setAttribute('x2', (x + dx).toFixed(1));
    entry.line.setAttribute('y2', (y + dy).toFixed(1));
    entry.el.classList.toggle('removed', entry.part.removed);
    entry.el.classList.toggle('selected', state.selected === entry.part.id);
    entry.el.style.opacity = entry.part.removed ? '0.72' : '1';
  });
}

/* ------------------------------------------------------------------ */
/* Part selection and camera focus                                     */
/* ------------------------------------------------------------------ */

function selectPart(part) {
  state.selected = part ? part.id : null;
  partsOrder.forEach((p) => { p.selected = part && p.id === part.id; });
  labelEntries.forEach((entry) => {
    entry.el.classList.toggle('selected', part && entry.part.id === part.id);
  });
  if (part) {
    dom.detailEmpty.hidden = true;
    dom.detailContent.hidden = false;
    renderDetail(part);
    dom.footStatus.textContent = `${part.name} · ${part.removed ? '已拆下' : '已安装'}`;
    if (window.innerWidth <= 880) {
      dom.detailPanel.classList.add('open');
      dom.partsPanel.classList.remove('open');
    }
  } else {
    dom.detailEmpty.hidden = false;
    dom.detailContent.hidden = true;
    dom.detailPanelTitle.textContent = '细节档案';
    dom.footStatus.textContent = '实时渲染 · 点击部件开始拆解';
    dom.detailPanel.classList.remove('open');
  }
  updatePartItemStates();
}

function deselectPart() {
  selectPart(null);
}

function focusPart(part) {
  if (!part) return;
  const box = getPartBox(part, new THREE.Box3());
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 20);
  controls.targetGoal.copy(center);
  controls.radiusGoal = clamp(maxDim * 3.15, 440, 1080);
  if (window.innerWidth <= 880) dom.detailPanel.classList.remove('open');
  showToast(`已聚焦：${part.name}`);
}

function setView(view) {
  dom.viewButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  const presets = {
    iso: { theta: -0.32, phi: 1.12, radius: 840 },
    left: { theta: -Math.PI / 2, phi: 1.31, radius: 660 },
    front: { theta: 0, phi: 1.32, radius: 680 },
    top: { theta: -0.36, phi: 0.43, radius: 670 },
    rear: { theta: Math.PI, phi: 1.3, radius: 680 },
  };
  const p = presets[view] || presets.iso;
  controls.thetaGoal = p.theta;
  controls.phiGoal = p.phi;
  controls.radiusGoal = p.radius;
  controls.targetGoal.set(0, 4, 0);
}

/* ------------------------------------------------------------------ */
/* Part state animation                                                */
/* ------------------------------------------------------------------ */

function getPartCenter(part) {
  const b = getPartBox(part, new THREE.Box3());
  return b.isEmpty() ? part.group.position.clone() : b.getCenter(new THREE.Vector3());
}

function makeTrail(part) {
  removeTrail(part);
  const from = getPartCenter(part);
  const target = part.basePos.clone().add(part.offsetV);
  const to = target.clone().add(part.anchorLocal);
  const mid = from.clone().lerp(to, 0.5);
  mid.y += 38;
  const curve = new THREE.CatmullRomCurve3([from, mid, to]);
  const points = curve.getPoints(32);
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineDashedMaterial({
    color: new THREE.Color(part.accent[0]),
    transparent: true,
    opacity: 0.4,
    dashSize: 3.2,
    gapSize: 3.2,
    depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  line.userData.pickable = false;
  line.renderOrder = 5;
  scene.add(line);
  part.trail = line;
}

function removeTrail(part) {
  if (part.trail) {
    scene.remove(part.trail);
    part.trail.geometry.dispose();
    part.trail.material.dispose();
    part.trail = null;
  }
}

function setPartState(part, removed, opts = {}) {
  const { duration = 860, silent = false, fromSequence = false } = opts;
  if (!part || !part.removable) return Promise.resolve();
  if (part.animating) return Promise.resolve();
  if (part.removed === removed) return Promise.resolve();

  const fromPos = part.group.position.clone();
  const toPos = removed ? part.basePos.clone().add(part.offsetV) : part.basePos.clone();
  const fromQuat = part.group.quaternion.clone();
  const toQuat = removed
    ? part.baseQuat.clone().multiply(part.explodeQuat)
    : part.baseQuat.clone();

  part.removed = removed;
  part.animating = true;
  part.glowTarget = removed ? 0.55 : 0;

  if (removed) makeTrail(part);
  else removeTrail(part);

  updateUI();

  const tween = {
    part,
    fromPos,
    toPos,
    fromQuat,
    toQuat,
    start: performance.now(),
    duration,
    arc: removed ? 34 : 18,
    resolve: null,
    removed,
    silent,
    fromSequence,
  };
  return new Promise((resolve) => {
    tween.resolve = resolve;
    tweens.add(tween);
  });
}

function updateTweens(now) {
  for (const t of [...tweens]) {
    const k = clamp((now - t.start) / t.duration, 0, 1);
    const e = easeInOutCubic(k);
    const pos = t.fromPos.clone().lerp(t.toPos, e);
    // graceful arc, scales down as it settles
    pos.y += Math.sin(Math.PI * k) * t.arc;
    t.part.group.position.copy(pos);
    t.part.group.quaternion.slerpQuaternions(t.fromQuat, t.toQuat, e);
    if (k >= 1) {
      t.part.group.position.copy(t.toPos);
      t.part.group.quaternion.copy(t.toQuat);
      t.part.animating = false;
      t.part.glowTarget = t.removed ? 0.22 : 0;
      tweens.delete(t);
      t.resolve && t.resolve();
      if (t.removed) {
        setTimeout(() => { if (t.part.removed) t.part.glowTarget = 0.16; }, 1400);
      }
      updateUI();
    }
  }
}

function revealExplodedPart(part) {
  const finalCenter = part.basePos.clone().add(part.offsetV).add(part.anchorLocal);
  controls.targetGoal.set(0, 4, 0).lerp(finalCenter, 0.5);
  controls.targetGoal.x = clamp(controls.targetGoal.x, -180, 200);
  controls.targetGoal.y = clamp(controls.targetGoal.y, -95, 110);
  controls.radiusGoal = Math.max(controls.radiusGoal, 1280);
}

function collectBlockers(part, acc = [], seen = new Set()) {
  (part.requires || []).forEach((id) => {
    const req = parts.get(id);
    if (!req || req.removed || !req.removable) return;
    collectBlockers(req, acc, seen);
    if (!seen.has(id)) {
      seen.add(id);
      acc.push(req);
    }
  });
  return acc;
}

async function activatePart(part) {
  if (!part) return;
  if (!part.removable) {
    selectPart(part);
    showToast('机箱主体保留为展示骨架');
    return;
  }
  if (state.busy) {
    showToast('拆解序列进行中，请稍候…', 'warn');
    return;
  }
  if (part.animating) return;
  selectPart(part);

  if (part.removed) {
    await setPartState(part, false, { duration: 820 });
    showToast(`${part.name} 已装回`);
    return;
  }

  const blockers = collectBlockers(part);
  if (blockers.length) {
    showToast(`按装配顺序先移除 ${blockers.length} 个遮挡部件`);
    for (const blocker of blockers) {
      await setPartState(blocker, true, { duration: 430, silent: true, fromSequence: true });
      await wait(70);
    }
  }
  revealExplodedPart(part);
  await setPartState(part, true, { duration: 880 });
  showToast(`${part.name} 已拆下`);
}

const TEARDOWN_ORDER = [
  'glassFront',
  'glassLeft',
  'glassRight',
  'topPanel',
  'topFan1',
  'topFan2',
  'rearFan1',
  'rearFan2',
  'coolerFan',
  'coolerHeatsink',
  'ram1',
  'ram2',
  'gpu',
  'ssdHeatsink',
  'ssd',
  'psu',
  'wifiCard',
  'cpu',
  'mobo',
];

async function explodeAll() {
  if (state.busy) return;
  const pending = partsOrder.filter((p) => p.removable && !p.removed);
  if (!pending.length) {
    showToast('整机已经处于完全拆解状态');
    return;
  }
  state.busy = true;
  document.body.classList.add('sequencing');
  dom.footStatus.textContent = '自动拆解序列运行中…';
  showToast('开始按装配顺序拆解整机');
  controls.targetGoal.set(5, 0, 10);
  controls.radiusGoal = 1580;
  controls.thetaGoal = -0.34;
  controls.phiGoal = 1.12;
  const promises = [];
  for (const id of TEARDOWN_ORDER) {
    const p = parts.get(id);
    if (!p || !p.removable || p.removed) continue;
    promises.push(setPartState(p, true, { duration: 860, silent: true, fromSequence: true }));
    await wait(145);
  }
  await Promise.all(promises);
  state.busy = false;
  document.body.classList.remove('sequencing');
  updateUI();
  dom.footStatus.textContent = '整机已完全拆解 · 可单独点选查看';
  showToast('拆解完成 · 19 个部件已展开');
}

async function restoreAll() {
  if (state.busy) return;
  const pending = partsOrder.filter((p) => p.removable && p.removed);
  if (!pending.length) {
    showToast('整机已经完整装配');
    return;
  }
  state.busy = true;
  document.body.classList.add('sequencing');
  dom.footStatus.textContent = '自动复原序列运行中…';
  showToast('按相反顺序装回所有部件');
  const promises = [];
  for (const id of [...TEARDOWN_ORDER].reverse()) {
    const p = parts.get(id);
    if (!p || !p.removable || !p.removed) continue;
    promises.push(setPartState(p, false, { duration: 820, silent: true, fromSequence: true }));
    await wait(115);
  }
  await Promise.all(promises);
  state.busy = false;
  document.body.classList.remove('sequencing');
  setView('iso');
  updateUI();
  dom.footStatus.textContent = '整机已复原 · 实时渲染';
  showToast('所有部件已装回原位');
}

/* ------------------------------------------------------------------ */
/* UI rendering                                                        */
/* ------------------------------------------------------------------ */

const GROUPS = [
  { key: 'core', label: '核心硬件', icon: 'CORE' },
  { key: 'cool', label: '散热系统', icon: 'THERMAL' },
  { key: 'power', label: '供电系统', icon: 'POWER' },
  { key: 'case', label: '机箱结构', icon: 'CHASSIS' },
];

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function renderPartsList() {
  const html = GROUPS.map((group) => {
    const list = partsOrder.filter((p) => p.filter === group.key && (state.filter === 'all' || state.filter === p.filter));
    if (!list.length) return '';
    return `
      <div class="part-group">
        <div class="group-title">${group.label} <span>${String(list.length).padStart(2, '0')}</span></div>
        ${list.map((p) => `
          <div class="part-item ${state.selected === p.id ? 'selected' : ''} ${p.removed ? 'removed' : ''}" data-id="${p.id}" role="button" tabindex="0" aria-label="${escapeHTML(p.name)}">
            <span class="part-ico" style="--c1:${p.accent[0]};--c2:${p.accent[1]}">${escapeHTML(p.icon)}</span>
            <span class="item-main">
              <span class="item-name">${escapeHTML(p.name)}</span>
              <span class="item-spec">${escapeHTML(p.short)}</span>
            </span>
            <span class="item-state"></span>
            <span class="item-tools">
              ${p.removable ? `<button class="mini-action ${p.removed ? '' : 'remove'}" data-action="toggle" aria-label="${p.removed ? '装回' : '拆下'}">
                ${p.removed
                  ? '<svg viewBox="0 0 24 24"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg>'
                  : '<svg viewBox="0 0 24 24"><path d="M12 20V8M7 13l5-5 5 5M5 4h14"/></svg>'}
              </button>` : '<button class="mini-action" data-action="focus" aria-label="聚焦"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/></svg></button>'}
            </span>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
  dom.partsList.innerHTML = html;
}

function updatePartItemStates() {
  $$('.part-item', dom.partsList).forEach((el) => {
    const p = parts.get(el.dataset.id);
    if (!p) return;
    el.classList.toggle('selected', state.selected === p.id);
    el.classList.toggle('removed', p.removed);
    const btn = $('.mini-action', el);
    if (btn && p.removable) {
      btn.classList.toggle('remove', !p.removed);
      btn.innerHTML = p.removed
        ? '<svg viewBox="0 0 24 24"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M12 20V8M7 13l5-5 5 5M5 4h14"/></svg>';
      btn.setAttribute('aria-label', p.removed ? '装回' : '拆下');
    }
  });
}

function updateUI() {
  const removed = partsOrder.filter((p) => p.removable && p.removed).length;
  const total = state.totalRemovable;
  const pct = total ? Math.round((removed / total) * 100) : 0;
  dom.progressNum.textContent = removed;
  dom.progressTotal.textContent = total;
  dom.progressRing.style.setProperty('--progress', pct);
  dom.screwCount.textContent = state.screwCount;

  if (removed === 0) {
    dom.overviewTitle.textContent = '整机装配完整';
    dom.overviewDesc.innerHTML = '点击部件即可独立拆解<br/>玻璃与风扇均可交互';
  } else if (removed >= total) {
    dom.overviewTitle.textContent = '整机已完全拆解';
    dom.overviewDesc.innerHTML = '所有部件已展开<br/>点击部件可单独装回';
  } else {
    dom.overviewTitle.textContent = `${removed} 个部件已拆下`;
    dom.overviewDesc.innerHTML = `拆解进度 ${pct}%<br/>继续点击部件逐层探索`;
  }
  renderPartsList();
  if (state.selected) {
    const p = parts.get(state.selected);
    if (p) {
      renderDetail(p);
      dom.footStatus.textContent = `${p.name} · ${p.removed ? '已拆下' : '已安装'}`;
    }
  }
  updateDetailButton();
}

function renderDetail(part) {
  dom.detailPanelTitle.textContent = '细节档案';
  dom.detailContent.hidden = false;
  dom.detailEmpty.hidden = true;
  dom.detailHero.style.setProperty('--hero-a', part.accent[0]);
  dom.detailHero.style.setProperty('--hero-b', part.accent[1]);
  dom.detailCategory.textContent = part.category;
  dom.detailStatus.textContent = part.removed ? '已拆下' : '已安装';
  dom.detailStatus.classList.toggle('removed', part.removed);
  dom.detailIcon.textContent = part.icon;
  dom.detailIndex.textContent = String(part.index + 1).padStart(2, '0');
  dom.detailName.textContent = part.name;
  dom.detailSub.textContent = `${part.icon === 'MB' ? 'JGINYUE' : part.icon === 'GPU' ? 'ELSA' : part.icon === 'CPU' ? 'INTEL' : part.icon === 'PSU' ? 'DEEPCOOL' : part.icon === 'CASE' ? 'FEIYUAN' : part.icon === 'COOL' ? 'THERMALRIGHT' : 'FY-01 BUILD'} · ${part.short}`;
  dom.detailDesc.textContent = part.desc;
  dom.detailTeardown.textContent = part.teardown;
  dom.detailScrewText.textContent = part.screwCount ? `${part.screwCount} 颗固定螺丝 / 五金件` : '无固定螺丝 · 插接式安装';
  const dots = part.screwCount > 0 ? Math.min(part.screwCount, 8) : 0;
  $('.screw-dots', dom.detailScrews).innerHTML = Array.from({ length: Math.max(dots, 0) }, () => '<i></i>').join('');
  dom.specGrid.innerHTML = part.specs.map(([k, v]) => `
    <div class="spec-cell"><span>${escapeHTML(k)}</span><b>${escapeHTML(v)}</b></div>
  `).join('');
  updateDetailButton();
  const label = labelEntries.find((e) => e.part.id === part.id);
  labelEntries.forEach((e) => e.el.classList.toggle('selected', e.part.id === part.id));
}

function updateDetailButton() {
  const part = state.selected ? parts.get(state.selected) : null;
  if (!part) return;
  const btn = dom.togglePartBtn;
  btn.disabled = !part.removable || state.busy;
  if (!part.removable) {
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7l8-4z"/><path d="M9 12l2 2 4-4"/></svg><span>展示骨架 · 不可拆</span>';
  } else if (part.removed) {
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg><span>装回原位</span>';
  } else {
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 20V8M7 13l5-5 5 5M5 4h14"/></svg><span>拆下此部件</span>';
  }
  dom.detailStatus.textContent = part.removed ? '已拆下' : '已安装';
  dom.detailStatus.classList.toggle('removed', part.removed);
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

let lastToastAt = 0;
function showToast(message, type = '') {
  const now = performance.now();
  if (now - lastToastAt < 180 && type !== 'force') return;
  lastToastAt = now;
  const el = document.createElement('div');
  el.className = `toast ${type === 'warn' ? 'warn' : ''}`;
  el.innerHTML = `<i></i><span>${escapeHTML(message)}</span>`;
  dom.toastStack.appendChild(el);
  setTimeout(() => el.remove(), 3400);
  while (dom.toastStack.children.length > 3) dom.toastStack.firstElementChild.remove();
}

/* ------------------------------------------------------------------ */
/* Interaction                                                         */
/* ------------------------------------------------------------------ */

const pointerState = {
  down: false,
  moved: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  button: 0,
  mode: 'orbit',
  pointers: new Map(),
  pinchDistance: 0,
  pinchRadius: 0,
  touchTap: false,
};

function setPointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickPart(e) {
  setPointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  for (const hit of hits) {
    const partId = hit.object.userData.partId;
    if (partId && parts.has(partId)) return parts.get(partId);
  }
  return null;
}

function setHovered(part, e) {
  if (state.hovered === (part ? part.id : null)) {
    if (part && e) positionHoverTip(e);
    return;
  }
  state.hovered = part ? part.id : null;
  if (part) {
    dom.hoverName.textContent = part.name;
    dom.hoverSpec.textContent = part.short;
    dom.hoverTip.classList.add('show');
    dom.canvas.classList.add('hovering');
  } else {
    dom.hoverTip.classList.remove('show');
    dom.canvas.classList.remove('hovering');
  }
}

function positionHoverTip(e) {
  dom.hoverTip.style.left = `${e.clientX}px`;
  dom.hoverTip.style.top = `${e.clientY}px`;
}

function onPointerDown(e) {
  if (e.button === 2) e.preventDefault();
  renderer.domElement.setPointerCapture?.(e.pointerId);
  pointerState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  pointerState.down = true;
  pointerState.moved = false;
  pointerState.startX = e.clientX;
  pointerState.startY = e.clientY;
  pointerState.lastX = e.clientX;
  pointerState.lastY = e.clientY;
  pointerState.button = e.button;
  pointerState.mode = e.button === 2 ? 'pan' : 'orbit';
  dom.canvas.classList.add('dragging');
  dom.hoverTip.classList.remove('show');

  if (pointerState.pointers.size === 2) {
    const [a, b] = [...pointerState.pointers.values()];
    pointerState.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    pointerState.pinchRadius = controls.radiusGoal;
  }
}

function onPointerMove(e) {
  if (pointerState.pointers.has(e.pointerId)) {
    pointerState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  if (pointerState.pointers.size === 2) {
    const [a, b] = [...pointerState.pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pointerState.pinchDistance > 0) {
      controls.radiusGoal = clamp(pointerState.pinchRadius * (pointerState.pinchDistance / Math.max(dist, 20)), 420, 1380);
    }
    pointerState.moved = true;
    return;
  }

  if (pointerState.down) {
    const dx = e.clientX - pointerState.lastX;
    const dy = e.clientY - pointerState.lastY;
    const total = Math.hypot(e.clientX - pointerState.startX, e.clientY - pointerState.startY);
    if (total > 4) pointerState.moved = true;
    if (pointerState.moved) {
      if (pointerState.mode === 'orbit' && pointerState.button === 0) {
        controls.thetaGoal -= dx * 0.0052;
        controls.phiGoal = clamp(controls.phiGoal - dy * 0.0046, 0.2, 1.53);
        dom.viewButtons.forEach((b) => b.classList.remove('active'));
      } else if (pointerState.mode === 'pan' || pointerState.button === 2) {
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        const scale = controls.radius * 0.0011;
        controls.targetGoal.addScaledVector(right, -dx * scale);
        controls.targetGoal.addScaledVector(up, dy * scale);
        controls.targetGoal.x = clamp(controls.targetGoal.x, -150, 150);
        controls.targetGoal.y = clamp(controls.targetGoal.y, -100, 100);
        controls.targetGoal.z = clamp(controls.targetGoal.z, -150, 150);
      }
    }
    pointerState.lastX = e.clientX;
    pointerState.lastY = e.clientY;
    if (pointerState.moved) {
      dom.hoverTip.classList.remove('show');
      return;
    }
  }

  if (e.pointerType !== 'touch') {
    const part = pickPart(e);
    setHovered(part, e);
  }
}

function onPointerUp(e) {
  const wasTap = pointerState.down && !pointerState.moved && pointerState.pointers.size === 1;
  pointerState.pointers.delete(e.pointerId);
  pointerState.down = pointerState.pointers.size > 0;
  dom.canvas.classList.remove('dragging');

  if (wasTap && pointerState.button === 0) {
    const part = pickPart(e);
    if (part) {
      activatePart(part);
    } else {
      deselectPart();
    }
  }
  if (pointerState.pointers.size < 2) pointerState.pinchDistance = 0;
}

function onPointerLeave() {
  pointerState.down = false;
  pointerState.pointers.clear();
  dom.canvas.classList.remove('dragging');
  setHovered(null);
}

function onKeyDown(e) {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'Escape') {
    if (!dom.guideModal.hidden) closeModal('guideModal');
    else {
      deselectPart();
      dom.partsPanel.classList.remove('open');
      dom.detailPanel.classList.remove('open');
      dom.hoverTip.classList.remove('show');
    }
  } else if (e.key.toLowerCase() === 'r') {
    setView('iso');
    showToast('视角已重置');
  } else if (e.code === 'Space') {
    e.preventDefault();
    state.autoRotate = !state.autoRotate;
    controls.auto = state.autoRotate;
    dom.rotateBtn.classList.toggle('active', state.autoRotate);
    showToast(state.autoRotate ? '自动旋转已开启' : '自动旋转已关闭');
  } else if (e.key === '1') setView('iso');
  else if (e.key === '2') setView('left');
  else if (e.key === '3') setView('front');
  else if (e.key === '4') setView('top');
  else if (e.key === '5') setView('rear');
}

function setupUIEvents() {
  dom.partsList.addEventListener('click', (e) => {
    const item = e.target.closest('.part-item');
    if (!item) return;
    const part = parts.get(item.dataset.id);
    const action = e.target.closest('[data-action]');
    if (action) {
      e.stopPropagation();
      if (action.dataset.action === 'focus') {
        selectPart(part);
        focusPart(part);
      } else {
        activatePart(part);
      }
      return;
    }
    selectPart(part);
  });
  dom.partsList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.part-item');
    if (!item) return;
    e.preventDefault();
    const part = parts.get(item.dataset.id);
    if (part) selectPart(part);
  });

  dom.filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      dom.filterButtons.forEach((b) => b.classList.toggle('active', b === btn));
      renderPartsList();
    });
  });

  dom.viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  $('#explodeBtn').addEventListener('click', explodeAll);
  $('#heroExplodeBtn').addEventListener('click', explodeAll);
  $('#restoreBtn').addEventListener('click', restoreAll);
  $('#resetBtn').addEventListener('click', () => { setView('iso'); showToast('视角已重置'); });
  $('#rotateBtn').addEventListener('click', (e) => {
    state.autoRotate = !state.autoRotate;
    controls.auto = state.autoRotate;
    e.currentTarget.classList.toggle('active', state.autoRotate);
    showToast(state.autoRotate ? '自动旋转已开启' : '自动旋转已关闭');
  });
  $('#labelsBtn').addEventListener('click', (e) => {
    state.labels = !state.labels;
    e.currentTarget.classList.toggle('active', state.labels);
    showToast(state.labels ? '部件标注已显示' : '部件标注已隐藏');
  });

  dom.togglePartBtn.addEventListener('click', () => {
    const part = state.selected ? parts.get(state.selected) : null;
    if (part) activatePart(part);
  });
  dom.focusPartBtn.addEventListener('click', () => {
    const part = state.selected ? parts.get(state.selected) : null;
    if (part) focusPart(part);
  });
  dom.detailBack.addEventListener('click', deselectPart);

  $('#collapseParts').addEventListener('click', () => {
    dom.partsPanel.classList.toggle('collapsed');
    if (window.innerWidth <= 880) dom.partsPanel.classList.remove('open');
  });
  $('#togglePartsBtn').addEventListener('click', () => {
    dom.partsPanel.classList.toggle('open');
    dom.detailPanel.classList.remove('open');
  });
  $('#toggleDetailBtn').addEventListener('click', () => {
    dom.detailPanel.classList.toggle('open');
    dom.partsPanel.classList.remove('open');
  });

  $('#guideBtn').addEventListener('click', () => {
    dom.guideModal.hidden = false;
  });
  $$('[data-close="guideModal"]').forEach((el) => el.addEventListener('click', () => closeModal('guideModal')));
  $('#dismissToast').addEventListener('click', () => dom.guideToast.classList.add('hide'));
  setTimeout(() => dom.guideToast.classList.add('hide'), 11000);

  $('#fullscreenBtn').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (err) {
      showToast('当前浏览器不支持全屏', 'warn');
    }
  });

  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0011);
    controls.radiusGoal = clamp(controls.radiusGoal * factor, 400, 1420);
  }, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  dom.labelLines.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = true;
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  dom.labelLines.setAttribute('viewBox', `0 0 ${w} ${h}`);
  if (w / h < 0.82 && controls.radiusGoal < 1250) {
    controls.radiusGoal = 1420;
    controls.phiGoal = Math.min(controls.phiGoal, 1.2);
  }
  if (w > 880) {
    dom.partsPanel.classList.remove('open');
    dom.detailPanel.classList.remove('open');
  }
}

/* ------------------------------------------------------------------ */
/* Animated details                                                    */
/* ------------------------------------------------------------------ */

function updateSpinners(dt, t) {
  fanSpinners.forEach((f) => {
    if (f.horizontal) f.group.rotation.y += f.speed * dt * f.direction;
    else f.group.rotation.z += f.speed * dt * f.direction;
  });
}

function updateRGB(t) {
  rgbTargets.forEach((target) => {
    const hue = (t * 0.032 * target.speed + target.offset) % 1;
    const pulse = 0.82 + Math.sin(t * 1.8 + target.offset) * 0.18;
    target.mats.forEach((mat) => {
      if (!mat) return;
      mat.color.setHSL(hue, 0.72, 0.64);
      if (mat.emissive) {
        mat.emissive.setHSL(hue, 0.9, 0.52);
        mat.emissiveIntensity = (target.type === 'ram' ? 1.5 : 1.9) * pulse;
      }
    });
    if (target.light) {
      target.light.color.setHSL(hue, 0.8, 0.55);
      target.light.intensity = 2.2 + Math.sin(t * 2 + target.offset) * 0.7;
    }
    if (target.glow) {
      target.glow.material.color.setHSL(hue, 0.85, 0.65);
      target.glow.material.opacity = 0.18 + pulse * 0.12;
    }
  });
}

function updateLCD(t) {
  if (t - lastLCDUpdate < 0.45) return;
  lastLCDUpdate = t;
  lcdScreens.forEach((lcd, i) => lcd.draw(t + i * 0.7));
}

function updateGlows(dt, t) {
  const selected = state.selected ? parts.get(state.selected) : null;
  const hovered = state.hovered ? parts.get(state.hovered) : null;
  partsOrder.forEach((part) => {
    let target = 0;
    if (part === selected) target = 0.5;
    else if (part === hovered) target = 0.24;
    else if (part.removed) target = 0.13;
    if (part.animating) target = 0.44;
    part.glowTarget = Math.max(part.glowTarget * 0.88, target * 0.7);
    part.glowLevel = damp(part.glowLevel, Math.max(target, part.glowTarget), 6, dt);
    if (part.glowSprite) {
      part.glowSprite.material.opacity = part.glowLevel * (0.7 + Math.sin(t * 2.4 + part.index) * 0.12);
      const base = part.glowSprite.userData.glowBase || 60;
      const s = base * (1 + Math.sin(t * 1.7 + part.index) * 0.025);
      part.glowSprite.scale.setScalar(s);
    }
  });

  if (selected) {
    getPartBox(selected, cageBox);
    setCageToBox(selectedCage, cageBox);
    selectedCage.visible = true;
    selectedCage.userData.mat.opacity = 0.78 + Math.sin(t * 3.2) * 0.16;
    selectedCage.userData.glow.material.opacity = 0.16;
  } else {
    selectedCage.visible = false;
  }

  if (hovered && hovered !== selected) {
    getPartBox(hovered, cageBox);
    setCageToBox(hoverCage, cageBox);
    hoverCage.visible = true;
    hoverCage.userData.mat.opacity = 0.34;
    hoverCage.userData.glow.material.opacity = 0.08;
  } else {
    hoverCage.visible = false;
  }
}

function updateDust(t) {
  if (!state.dust) return;
  const positions = state.dust.geometry.attributes.position.array;
  dustPoints.forEach((p, i) => {
    positions[i * 3 + 1] = p.baseY + Math.sin(t * 0.16 * p.speed + p.phase) * p.amp;
  });
  state.dust.geometry.attributes.position.needsUpdate = true;
  state.dust.material.opacity = 0.24 + Math.sin(t * 0.3) * 0.08;
}

/* ------------------------------------------------------------------ */
/* Loading / init / render loop                                        */
/* ------------------------------------------------------------------ */

function setLoading(percent, text) {
  dom.loadingBar.style.width = `${percent}%`;
  dom.loadingPct.textContent = `${Math.round(percent)}%`;
  if (text) {
    const sub = $('.loading-sub', dom.loading);
    if (sub) sub.textContent = text;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  dampCamera(dt);
  updateTweens(performance.now());
  updateSpinners(dt, t);
  updateRGB(t);
  updateLCD(t);
  updateGlows(dt, t);
  updateDust(t);
  updateLabels();
  renderer.render(scene, camera);
}

async function init() {
  try {
    setLoading(6, '初始化渲染器与物理光照…');
    await wait(60);
    initScene();
    setLoading(24, '构建机箱结构与三面钢化玻璃…');
    await wait(80);
    buildModel();
    setLoading(76, '校准螺丝、线材与部件装配关系…');
    await wait(60);
    setupUIEvents();
    setLoading(92, '生成可交互标注与拆解动画…');
    updateUI();
    renderPartsList();
    await wait(120);
    setLoading(100, '准备就绪');
    await wait(420);
    state.ready = true;
    dom.loading.classList.add('done');
    setTimeout(() => {
      if (!state.ready) return;
      showToast('欢迎来到 FY-01 装机实验室');
    }, 500);
    animate();
  } catch (error) {
    console.error(error);
    dom.loading.classList.add('done');
    const err = $('#webglError');
    if (err) {
      err.hidden = false;
      $('.error-card p', err).textContent = `3D 场景初始化失败：${error.message}`;
    }
  }
}

window.FY = {
  state,
  parts,
  setView,
  selectPart,
  deselectPart,
  focusPart,
  explodeAll,
  restoreAll,
  activatePart: (id) => activatePart(typeof id === 'string' ? parts.get(id) : id),
  setPartState: (id, removed, opts) => setPartState(typeof id === 'string' ? parts.get(id) : id, removed, opts),
  controls,
  camera,
  scene,
  renderer,
  updateCamera,
  updateUI,
};

init();


