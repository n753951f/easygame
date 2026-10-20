import * as THREE from 'three';

/* ================================================================
 *  超級跳跳 3D —— Three.js 3D 平台跳躍遊戲
 *  物理採固定步長 (120Hz) + 畫面插值，在 60/120/144Hz 螢幕都一樣滑順
 * ================================================================ */

// ---------- 物理與手感參數 ----------
const FIXED_DT = 1 / 120;
const MAX_FRAME_DT = 0.1;
const GRAVITY = 40;
const FALL_MULT = 1.7;          // 下落時重力加乘，落地更俐落
const LOW_JUMP_MULT = 2.6;      // 提早放開跳躍鍵 → 小跳
const MAX_FALL = 32;
const WALK_SPEED = 7.5;
const RUN_SPEED = 11.5;
const GROUND_ACCEL = 55;
const GROUND_DECEL = 45;
const AIR_ACCEL = 22;
const JUMP_SPEEDS = [15, 17.5, 20.5]; // 一段、二段、三段跳
const COYOTE_TIME = 0.1;        // 離開平台後仍可起跳的寬限時間
const JUMP_BUFFER = 0.13;       // 落地前提早按跳躍的緩衝
const COMBO_WINDOW = 0.28;      // 落地後多久內再跳算連續跳
const KILL_Y = -9;
const EPS = 0.001;
const PLAYER_HALF = new THREE.Vector3(0.36, 0.9, 0.36);
const ENEMY_HALF = new THREE.Vector3(0.55, 0.5, 0.55);
const MAX_HEALTH = 3;
const START_LIVES = 3;
const COINS_PER_LIFE = 30;
const TIME_BONUS_LIMIT = 240;

// ---------- 小工具 ----------
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), coins: $('coins'), lives: $('lives'), hearts: $('hearts'), time: $('time'), score: $('score'),
  fps: $('fps'), toast: $('toast'),
  menu: $('menu'), pause: $('pause'), win: $('win'), over: $('over'),
  startBtn: $('start-btn'), resumeBtn: $('resume-btn'), restartBtn: $('restart-btn'), quitBtn: $('quit-btn'),
  winScore: $('win-score'), winDetail: $('win-detail'), nameInput: $('player-name'), submitBtn: $('submit-btn'),
  submitMsg: $('submit-msg'), winBoard: $('win-board'), menuBoard: $('menu-board'), againBtn: $('again-btn'),
  overDetail: $('over-detail'), overBtn: $('over-btn'),
};

// ---------- 渲染器 / 場景 ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe3ff, 70, 210);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 600);

// 漸層天空
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(400, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x2f86e0) },
      bottom: { value: new THREE.Color(0xd4f0ff) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top;
      uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 1.6 + 0.2, 0.0, 1.0);
        gl_FragColor = vec4(mix(bottom, top, h), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }),
);
sky.renderOrder = -1;
scene.add(sky);

// 燈光：半球光 + 會跟著玩家移動的陰影太陽光
scene.add(new THREE.HemisphereLight(0xe2f3ff, 0x6b8f4a, 1.15));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 140 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const SUN_OFFSET = V(28, 50, 18);

// ---------- 程序產生的材質貼圖 ----------
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
function canvasTexture(size, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function rivets(g, s, color) {
  g.fillStyle = color;
  for (const [x, y] of [[16, 16], [s - 16, 16], [16, s - 16], [s - 16, s - 16]]) {
    g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
  }
}
const texRand = mulberry32(7);
const TEX = {
  grass: canvasTexture(128, (g, s) => {
    g.fillStyle = '#5ec43c'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = texRand() < 0.5 ? '#4fb02f' : '#78d854';
      g.fillRect(texRand() * s, texRand() * s, 2 + texRand() * 3, 2 + texRand() * 3);
    }
  }, true),
  dirt: canvasTexture(128, (g, s) => {
    g.fillStyle = '#b5743f'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#a0632f';
    for (let y = 0; y < s; y += 32) g.fillRect(0, y + 14, s, 6);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = texRand() < 0.5 ? '#8a5228' : '#c98a52';
      g.beginPath(); g.arc(texRand() * s, texRand() * s, 1.5 + texRand() * 3, 0, Math.PI * 2); g.fill();
    }
  }, true),
  brick: canvasTexture(128, (g, s) => {
    g.fillStyle = '#6e2e0c'; g.fillRect(0, 0, s, s);
    const rows = 4, bh = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? 0 : -s / 4;
      for (let x = off; x < s; x += s / 2) {
        g.fillStyle = '#c8642c'; g.fillRect(x + 3, r * bh + 3, s / 2 - 6, bh - 6);
        g.fillStyle = '#e48a52'; g.fillRect(x + 3, r * bh + 3, s / 2 - 6, 4);
      }
    }
  }),
  question: canvasTexture(128, (g, s) => {
    g.fillStyle = '#b06c08'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#f6b81f'; g.fillRect(6, 6, s - 12, s - 12);
    g.fillStyle = '#ffd864'; g.fillRect(6, 6, s - 12, 7);
    rivets(g, s, '#8a5200');
    g.font = 'bold 84px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#8a4b00'; g.fillText('?', s / 2 + 4, s / 2 + 9);
    g.fillStyle = '#ffffff'; g.fillText('?', s / 2, s / 2 + 5);
  }),
  used: canvasTexture(128, (g, s) => {
    g.fillStyle = '#5e3a17'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#8d5a2b'; g.fillRect(6, 6, s - 12, s - 12);
    rivets(g, s, '#4a2c10');
  }),
  lift: canvasTexture(128, (g, s) => {
    g.fillStyle = '#b88600'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#ffd23f'; g.fillRect(6, 6, s - 12, s - 12);
    g.fillStyle = '#ffe58a'; g.fillRect(6, 6, s - 12, 6);
    rivets(g, s, '#9a7300');
  }, true),
};

const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.6, ...opts });
const MAT = {
  grass: std({ map: TEX.grass, roughness: 0.95 }),
  dirt: std({ map: TEX.dirt, roughness: 1 }),
  rock: std({ color: 0x8a6a4f, roughness: 1, flatShading: true }),
  brick: std({ map: TEX.brick, roughness: 0.8 }),
  question: std({ map: TEX.question, roughness: 0.45, emissive: 0x553300, emissiveIntensity: 0.3 }),
  used: std({ map: TEX.used, roughness: 0.85 }),
  lift: std({ map: TEX.lift, roughness: 0.45, metalness: 0.2 }),
  pipe: std({ color: 0x22b14c, roughness: 0.3, metalness: 0.15 }),
  coin: std({ color: 0xffcc22, metalness: 0.85, roughness: 0.25, emissive: 0x7a5400, emissiveIntensity: 0.55 }),
  star: std({ color: 0xffd83a, metalness: 0.3, roughness: 0.3, emissive: 0xffa000, emissiveIntensity: 0.7 }),
  trunk: std({ color: 0x8b5a2b, roughness: 1 }),
  leaves: std({ color: 0x3fae3a, roughness: 0.9, flatShading: true }),
  leaves2: std({ color: 0x2f9a35, roughness: 0.9, flatShading: true }),
  hill: std({ color: 0x5cba48, roughness: 1 }),
  hill2: std({ color: 0x4aa63f, roughness: 1 }),
  cloud: std({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.25 }),
  water: std({ color: 0x2f9fd8, roughness: 0.25, metalness: 0.1 }),
  pole: std({ color: 0xdddddd, metalness: 0.6, roughness: 0.3 }),
  flagOff: std({ color: 0xbbbbbb, side: THREE.DoubleSide }),
  flagOn: std({ color: 0x29d65b, side: THREE.DoubleSide, emissive: 0x0a5a20, emissiveIntensity: 0.4 }),
  black: std({ color: 0x111111, roughness: 0.4 }),
  white: std({ color: 0xffffff, roughness: 0.4 }),
};

// 共用幾何
const GEO = {
  unitBox: new THREE.BoxGeometry(1, 1, 1),
  coin: new THREE.CylinderGeometry(0.42, 0.42, 0.09, 28).rotateX(Math.PI / 2),
  sphere: new THREE.SphereGeometry(1, 20, 14),
  lowSphere: new THREE.IcosahedronGeometry(1, 1),
};

// 讓方塊的貼圖依世界尺寸重複，而非被拉伸
function worldUV(geo, w, h, d, scale = 1) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] / scale, uv.getY(k) * dims[f][1] / scale);
    }
  }
  return geo;
}

function mesh(geo, mat, x = 0, y = 0, z = 0, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// ---------- 音效（WebAudio 即時合成，不需音檔） ----------
let actx = null, master = null, muted = false;
function ensureAudio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      master.gain.value = 0.22;
      master.connect(actx.destination);
    } catch { actx = null; }
  } else if (actx.state === 'suspended') {
    actx.resume();
  }
}
function tone(freq, freqEnd, dur, type = 'square', vol = 0.5, delay = 0) {
  const t = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.03);
}
const notes = (list, step, type = 'square', vol = 0.3) =>
  list.forEach((f, i) => tone(f, null, step * 1.6, type, vol, i * step));
const SFX = {
  jump: () => tone(280, 580, 0.16, 'square', 0.25),
  jump2: () => tone(330, 720, 0.18, 'square', 0.25),
  jump3: () => { tone(330, 660, 0.12, 'square', 0.25); tone(500, 1000, 0.2, 'square', 0.25, 0.08); },
  coin: () => { tone(988, null, 0.07, 'square', 0.2); tone(1319, null, 0.32, 'square', 0.2, 0.07); },
  stomp: () => tone(440, 90, 0.18, 'triangle', 0.6),
  bump: () => tone(150, 90, 0.1, 'square', 0.3),
  hurt: () => tone(620, 120, 0.4, 'sawtooth', 0.25),
  die: () => notes([784, 659, 523, 392, 330, 262], 0.12, 'square', 0.25),
  checkpoint: () => notes([523, 659, 784, 1047], 0.08),
  oneup: () => notes([659, 784, 1319, 1047, 1175, 1568], 0.08),
  win: () => notes([523, 659, 784, 1047, 784, 1047, 1319, 1568], 0.1, 'square', 0.28),
};
function sfx(name) {
  if (!muted && actx && actx.state === 'running') SFX[name]();
}

// ---------- 粒子（InstancedMesh，一次 draw call） ----------
const _m4 = new THREE.Matrix4();
class Particles {
  constructor(max, geo, mat) {
    this.max = max;
    this.items = [];
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  spawn(x, y, z, vx, vy, vz, life, size, grav = 18) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ x, y, z, vx, vy, vz, life, max: life, size, grav });
  }
  burst(pos, n, speed, up, life, size, grav) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.5 + Math.random() * 0.5);
      this.spawn(pos.x, pos.y, pos.z, Math.cos(a) * s, up * (0.6 + Math.random() * 0.6), Math.sin(a) * s, life, size, grav);
    }
  }
  update(dt) {
    const d = this.items;
    let w = 0;
    for (let i = 0; i < d.length; i++) {
      const p = d[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      d[w++] = p;
    }
    d.length = w;
    for (let i = 0; i < w; i++) {
      const p = d[i], s = p.size * (p.life / p.max);
      _m4.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, _m4);
    }
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
const dust = new Particles(160, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xf4f1e8, transparent: true, opacity: 0.85 }));
const sparkles = new Particles(160, new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffe066 }));

// ---------- 角色模型 ----------
function buildPlayerModel() {
  const M = (c, o = {}) => std({ color: c, roughness: 0.55, ...o });
  const red = M(0xe52521), blue = M(0x2a52be), skin = M(0xffc8a0), white = M(0xffffff, { roughness: 0.4 });
  const brown = M(0x6b3a1e), hair = M(0x3b2314), yellow = M(0xffd700, { metalness: 0.6, roughness: 0.3 }), eyeBlue = M(0x1d4ed8);

  const root = new THREE.Group();
  const yawG = new THREE.Group();
  const squash = new THREE.Group();
  const flip = new THREE.Group();
  const body = new THREE.Group();
  flip.position.y = 0.9;
  body.position.y = -0.9;
  root.add(yawG); yawG.add(squash); squash.add(flip); flip.add(body);

  const legs = [], arms = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.17 * side, 0.72, 0);
    hip.add(mesh(new THREE.CapsuleGeometry(0.14, 0.3, 4, 10), blue, 0, -0.3, 0));
    const shoe = mesh(new THREE.SphereGeometry(0.17, 14, 10), brown, 0, -0.6, 0.06);
    shoe.scale.set(1, 0.7, 1.5);
    hip.add(shoe);
    body.add(hip);
    legs.push(hip);

    const sh = new THREE.Group();
    sh.position.set(0.42 * side, 1.2, 0);
    sh.rotation.z = 0.2 * side;
    sh.add(mesh(new THREE.CapsuleGeometry(0.1, 0.28, 4, 10), red, 0, -0.2, 0));
    sh.add(mesh(new THREE.SphereGeometry(0.14, 14, 10), white, 0, -0.45, 0));
    body.add(sh);
    arms.push(sh);
  }
  const overalls = mesh(new THREE.SphereGeometry(0.36, 20, 14), blue, 0, 0.92, 0);
  overalls.scale.set(1, 1.05, 0.85);
  const shirt = mesh(new THREE.SphereGeometry(0.34, 20, 14), red, 0, 1.18, 0);
  shirt.scale.set(1.05, 0.75, 0.9);
  body.add(overalls, shirt);
  for (const side of [-1, 1]) body.add(mesh(new THREE.SphereGeometry(0.045, 8, 6), yellow, 0.13 * side, 1.07, 0.3));

  const head = new THREE.Group();
  head.position.y = 1.62;
  body.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.33, 24, 16), skin));
  head.add(mesh(new THREE.SphereGeometry(0.1, 12, 8), skin, 0, -0.04, 0.33));
  for (const side of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), skin, 0.32 * side, -0.02, 0));
    const eye = mesh(new THREE.SphereGeometry(0.07, 12, 8), white, 0.11 * side, 0.07, 0.27);
    eye.scale.set(0.7, 1.25, 0.6);
    head.add(eye, mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeBlue, 0.11 * side, 0.06, 0.315));
  }
  head.add(mesh(new THREE.BoxGeometry(0.32, 0.08, 0.1), hair, 0, -0.13, 0.28));
  const cap = mesh(new THREE.SphereGeometry(0.35, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), red, 0, 0.04, 0);
  cap.scale.set(1, 0.85, 1);
  const brim = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 24), red, 0, 0.05, 0.22);
  brim.scale.set(1, 1, 0.8);
  const emblem = mesh(new THREE.CircleGeometry(0.1, 20), white, 0, 0.2, 0.3);
  emblem.rotation.x = -0.45;
  head.add(cap, brim, emblem);

  scene.add(root);
  return { root, yawG, squash, flip, legs, arms, head };
}

// ---------- 敵人模型（栗寶寶風格） ----------
const ENEMY_GEO = {
  head: new THREE.SphereGeometry(0.6, 20, 14),
  stem: new THREE.CylinderGeometry(0.32, 0.36, 0.35, 16),
  foot: new THREE.SphereGeometry(0.2, 12, 8),
  eye: new THREE.SphereGeometry(0.12, 12, 8),
  pupil: new THREE.SphereGeometry(0.06, 8, 6),
  brow: new THREE.BoxGeometry(0.24, 0.06, 0.06),
  fang: new THREE.ConeGeometry(0.05, 0.12, 6),
};
const ENEMY_MAT = { head: std({ color: 0x9b5323, roughness: 0.7 }), stem: std({ color: 0xf3d19c }), foot: std({ color: 0x3a2010 }) };
function buildGoomba() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const headM = mesh(ENEMY_GEO.head, ENEMY_MAT.head, 0, 0.62, 0);
  headM.scale.set(1, 0.78, 1);
  inner.add(headM, mesh(ENEMY_GEO.stem, ENEMY_MAT.stem, 0, 0.25, 0));
  const feet = [];
  for (const side of [-1, 1]) {
    const f = mesh(ENEMY_GEO.foot, ENEMY_MAT.foot, 0.2 * side, 0.1, 0.05);
    f.scale.set(1, 0.6, 1.4);
    inner.add(f);
    feet.push(f);
    const eye = mesh(ENEMY_GEO.eye, MAT.white, 0.17 * side, 0.68, 0.48, false);
    eye.scale.set(0.8, 1.2, 0.5);
    const brow = mesh(ENEMY_GEO.brow, MAT.black, 0.17 * side, 0.86, 0.5, false);
    brow.rotation.z = 0.4 * side;
    const fang = mesh(ENEMY_GEO.fang, MAT.white, 0.12 * side, 0.45, 0.5, false);
    inner.add(eye, mesh(ENEMY_GEO.pupil, MAT.black, 0.15 * side, 0.66, 0.54, false), brow, fang);
  }
  return { g, inner, feet };
}

// ---------- 關卡建構 ----------
let level = null;

function updateBounds(s) {
  s.min.subVectors(s.pos, s.half);
  s.max.addVectors(s.pos, s.half);
}

function addSolid(L, type, pos, size, obj, offset = V()) {
  const s = {
    type, pos: pos.clone(), prev: pos.clone(), half: size.clone().multiplyScalar(0.5),
    min: V(), max: V(), obj, offset, delta: V(), used: false, bumpT: 0, mover: null,
  };
  updateBounds(s);
  L.solids.push(s);
  L.group.add(obj);
  obj.position.copy(s.pos).add(offset);
  return s;
}

function addIsland(L, x, z, w, d, top, depth = 7, underside = true) {
  const grassH = 0.5;
  const g = new THREE.Group();
  g.add(mesh(L.own(worldUV(new THREE.BoxGeometry(w, grassH, d), w, grassH, d, 2)), MAT.grass, 0, -grassH / 2, 0));
  const dh = depth - grassH;
  g.add(mesh(L.own(worldUV(new THREE.BoxGeometry(w - 0.1, dh, d - 0.1), w, dh, d, 2)), MAT.dirt, 0, -grassH - dh / 2, 0));
  if (underside) {
    const r = Math.min(w, d) * 0.55;
    const rock = mesh(L.own(new THREE.CylinderGeometry(r, 0.6, depth * 0.9, 7)), MAT.rock, 0, -depth - depth * 0.45 + 0.2, 0, false, false);
    rock.scale.set(w / Math.min(w, d), 1, d / Math.min(w, d));
    g.add(rock);
  }
  return addSolid(L, 'ground', V(x, top - depth / 2, z), V(w, depth, d), g, V(0, depth / 2, 0));
}

function addBlock(L, x, y, z, type) {
  const m = mesh(GEO.unitBox, type === 'question' ? MAT.question : MAT.brick);
  return addSolid(L, type, V(x, y, z), V(1, 1, 1), m);
}

function addPipe(L, x, z, top, base) {
  const h = top - base;
  const g = new THREE.Group();
  g.add(mesh(L.own(new THREE.CylinderGeometry(0.85, 0.85, h - 0.45, 24)), MAT.pipe, 0, -0.45 / 2, 0));
  g.add(mesh(L.own(new THREE.CylinderGeometry(1, 1, 0.45, 24)), MAT.pipe, 0, h / 2 - 0.225, 0));
  const hole = mesh(L.own(new THREE.CircleGeometry(0.75, 24)), MAT.black, 0, h / 2 + 0.005, 0, false, false);
  hole.rotation.x = -Math.PI / 2;
  g.add(hole);
  return addSolid(L, 'pipe', V(x, base + h / 2, z), V(2, h, 2), g);
}

function addMover(L, w, h, d, a, b, period) {
  const m = mesh(L.own(worldUV(new THREE.BoxGeometry(w, h, d), w, h, d, 2)), MAT.lift);
  const s = addSolid(L, 'lift', a, V(w, h, d), m);
  s.mover = { a: a.clone(), b: b.clone(), period, t: 0 };
  L.movers.push(s);
  return s;
}

function addCoin(L, x, y, z) {
  const m = mesh(GEO.coin, MAT.coin, x, y, z, true, false);
  L.group.add(m);
  L.coins.push({ mesh: m, pos: V(x, y, z), taken: false, takeT: 0, phase: Math.random() * 6 });
}
function addCoinLine(L, from, to, n) {
  for (let i = 0; i < n; i++) {
    const p = from.clone().lerp(to, n === 1 ? 0.5 : i / (n - 1));
    addCoin(L, p.x, p.y, p.z);
  }
}
function addCoinArc(L, from, to, n, height) {
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = from.clone().lerp(to, t);
    addCoin(L, p.x, p.y + Math.sin(t * Math.PI) * height, p.z);
  }
}
function addCoinRing(L, cx, y, cz, r, n) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    addCoin(L, cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
  }
}

function addEnemy(L, a, b, top, rect) {
  const model = buildGoomba();
  L.group.add(model.g);
  const y = top + ENEMY_HALF.y;
  const pos = V(a[0], y, a[1]);
  L.enemies.push({
    model, pos, prev: pos.clone(), a: V(a[0], y, a[1]), b: V(b[0], y, b[1]), rect,
    toB: true, alive: true, visible: true, deadT: 0, yaw: 0, targetYaw: 0, walk: Math.random() * 6, alert: false,
  });
}

function addTree(L, x, z, top, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, top, z);
  g.scale.setScalar(s);
  g.add(mesh(L.own(new THREE.CylinderGeometry(0.2, 0.28, 1.6, 8)), MAT.trunk, 0, 0.8, 0));
  const l1 = mesh(GEO.lowSphere, MAT.leaves, 0, 2.2, 0);
  l1.scale.setScalar(1.15);
  const l2 = mesh(GEO.lowSphere, MAT.leaves2, 0.25, 3.0, 0.1);
  l2.scale.setScalar(0.75);
  g.add(l1, l2);
  L.group.add(g);
}

function addBush(L, x, z, top) {
  const g = new THREE.Group();
  g.position.set(x, top, z);
  for (const [dx, s] of [[-0.5, 0.5], [0, 0.65], [0.5, 0.5]]) {
    const b = mesh(GEO.lowSphere, MAT.leaves, dx, s * 0.6, 0);
    b.scale.setScalar(s);
    g.add(b);
  }
  L.group.add(g);
}

function addCheckpoint(L, x, z, top) {
  const g = new THREE.Group();
  g.position.set(x, top, z);
  g.add(mesh(L.own(new THREE.CylinderGeometry(0.06, 0.08, 3, 10)), MAT.pole, 0, 1.5, 0));
  g.add(mesh(L.own(new THREE.SphereGeometry(0.14, 12, 8)), MAT.pole, 0, 3.05, 0));
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(1.2, -0.4); shape.lineTo(0, -0.8); shape.closePath();
  const flagPivot = new THREE.Group();
  flagPivot.position.set(0.05, 2.9, 0);
  const flag = mesh(L.own(new THREE.ShapeGeometry(shape)), MAT.flagOff, 0, 0, 0);
  flagPivot.add(flag);
  g.add(flagPivot);
  L.group.add(g);
  L.checkpoints.push({ pos: V(x, top, z), flag, flagPivot, active: false, spawn: V(x + 1.5, top + PLAYER_HALF.y + 0.05, z) });
}

function addStar(L, x, y, z) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.42 : 0.95;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const geo = L.own(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 3 }));
  geo.center();
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(mesh(geo, MAT.star));
  for (const side of [-1, 1]) {
    const eye = mesh(L.own(new THREE.CapsuleGeometry(0.05, 0.14, 4, 8)), MAT.black, 0.16 * side, 0.08, 0.28, false);
    g.add(eye);
  }
  const light = new THREE.PointLight(0xffd34d, 12, 9, 2);
  g.add(light);
  L.group.add(g);
  L.star = { obj: g, pos: V(x, y, z), taken: false };
}

function addScenery(L) {
  const r = mulberry32(42);
  // 海面
  const water = mesh(L.own(new THREE.PlaneGeometry(900, 900)), MAT.water, 0, -10, -50, false, false);
  water.rotation.x = -Math.PI / 2;
  L.group.add(water);
  // 遠方山丘
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + r() * 0.3;
    const dist = 130 + r() * 60;
    const rad = 25 + r() * 25;
    const h = mesh(GEO.sphere, i % 2 ? MAT.hill : MAT.hill2, Math.cos(a) * dist, -14, -50 + Math.sin(a) * dist, false, false);
    h.scale.set(rad, rad * (0.7 + r() * 0.6), rad);
    L.group.add(h);
  }
  // 雲
  L.clouds = [];
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    const n = 3 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const s = 2 + r() * 2.5;
      const p = mesh(GEO.sphere, MAT.cloud, (k - n / 2) * 2.4, r() * 1.2, r() * 1.5, false, false);
      p.scale.set(s, s * 0.75, s);
      c.add(p);
    }
    c.position.set(-150 + r() * 300, 26 + r() * 22, -170 + r() * 260);
    c.userData.speed = 0.8 + r() * 1.2;
    L.group.add(c);
    L.clouds.push(c);
  }
}

function buildLevel() {
  if (level) {
    scene.remove(level.group);
    for (const g of level.geos) g.dispose();
  }
  const L = {
    group: new THREE.Group(), geos: [], solids: [], movers: [], coins: [], enemies: [], checkpoints: [],
    popups: [], clouds: [], star: null, spawn: V(0, PLAYER_HALF.y + 0.05, 7),
  };
  L.own = (geo) => { L.geos.push(geo); return geo; };
  scene.add(L.group);

  // ===== 1. 起點島 =====
  addIsland(L, 0, 0, 16, 20, 0);
  addTree(L, -5.5, 7, 0, 1); addTree(L, 5.8, 6, 0, 1.2); addTree(L, -6.3, -8.5, 0, 0.9); addTree(L, 6.2, -6, 0, 1);
  addBush(L, 3, 9, 0); addBush(L, -3, -9, 0);
  addCoinLine(L, V(-3, 1, 3.5), V(3, 1, 3.5), 4);
  addBlock(L, -2, 3.5, -3, 'brick');
  addBlock(L, -1, 3.5, -3, 'question');
  addBlock(L, 0, 3.5, -3, 'brick');
  addBlock(L, 1, 3.5, -3, 'question');
  addBlock(L, 2, 3.5, -3, 'brick');
  addBlock(L, 0, 7, -3, 'question');
  addEnemy(L, [-5, -7], [5, -7], 0, [-7.5, 7.5, -9.5, 9.5]);
  addCoinArc(L, V(0, 1, -8.5), V(0, 1, -15.5), 5, 2.5);

  // ===== 2. 水管島 =====
  addIsland(L, 0, -25, 14, 22, 0);
  addPipe(L, -3, -19, 2, 0);
  addCoin(L, -3, 3, -19);
  addPipe(L, 3.5, -25, 3.2, 0);
  addCoinLine(L, V(3.5, 4.2, -24.4), V(3.5, 4.2, -25.6), 2);
  addEnemy(L, [-4, -22], [4, -22], 0, [-6.5, 6.5, -35.5, -14.5]);
  addEnemy(L, [2, -29], [-4.5, -29], 0, [-6.5, 6.5, -35.5, -14.5]);
  addBlock(L, -4.5, 3.5, -30, 'question');
  for (let col = -1; col <= 1; col++) {                    // 磚塊階梯
    for (let step = 0; step < 3; step++) {
      for (let h = 0; h <= step; h++) addBlock(L, col, 0.5 + h, -31 - step, 'brick');
    }
  }
  addCoin(L, 0, 4.4, -33);
  addTree(L, -5.5, -34, 0, 0.9); addBush(L, 5.5, -16, 0);

  // ===== 3. 移動平台 =====
  addMover(L, 4, 0.6, 4, V(0, 0.2, -40), V(0, 0.2, -48), 6);
  addCoinLine(L, V(0, 1.7, -40), V(0, 1.7, -48), 3);

  // ===== 4. 中繼島 =====
  addIsland(L, 0, -60, 14, 16, 2);
  addCheckpoint(L, -4.5, -54, 2);
  addEnemy(L, [-4, -59], [4, -59], 2, [-6.5, 6.5, -67.5, -52.5]);
  addEnemy(L, [4, -65], [-4, -65], 2, [-6.5, 6.5, -67.5, -52.5]);
  addBlock(L, -1, 5.5, -58, 'question');
  addBlock(L, 0, 5.5, -58, 'brick');
  addBlock(L, 1, 5.5, -58, 'question');
  addCoinRing(L, 0, 3, -62, 2.5, 6);
  addTree(L, 5, -55, 2, 1.1); addTree(L, -5.5, -66, 2, 1);

  // ===== 5. 浮空跳台 =====
  addIsland(L, 2, -72, 3, 3, 3.5, 2, false);
  addIsland(L, -1, -77, 3, 3, 5, 2, false);
  addIsland(L, 2, -82, 3, 3, 6.5, 2, false);
  addCoin(L, 2, 4.7, -72); addCoin(L, -1, 6.2, -77); addCoin(L, 2, 7.7, -82);

  // ===== 6. 升降台 =====
  addMover(L, 4, 0.6, 4, V(0, 6.2, -87.5), V(0, 10.7, -87.5), 7);

  // ===== 7. 終點島 =====
  addIsland(L, 0, -100, 12, 16, 11, 9);
  addEnemy(L, [-3, -96], [3, -96], 11, [-5.5, 5.5, -107.5, -92.5]);
  addStar(L, 0, 12.8, -104);
  addCoinRing(L, 0, 12.2, -104, 2.4, 8);
  addTree(L, -4.5, -106.5, 11, 1); addTree(L, 4.5, -106.5, 11, 1);

  addScenery(L);
  level = L;
}

// ---------- 遊戲狀態 ----------
const player = {
  pos: V(), prev: V(), vel: V(),
  grounded: false, ground: null, coyoteT: 0, bufferT: 0, jumping: false, combo: 0, sinceLand: 99,
  facing: Math.PI, targetYaw: Math.PI, invincible: 0, knockT: 0, health: MAX_HEALTH,
  dead: false, deathMode: null, deathT: 0, deathLaunched: false, flipT: 0,
};
const anim = { phase: 0, squash: 1, squashV: 0, legL: 0, legR: 0, armL: 0, armR: 0, dustAcc: 0, spin: 0 };
const game = { coins: 0, score: 0, lives: START_LIVES, time: 0, finalScore: 0, timeBonus: 0, stomps: 0 };
const cam = { yaw: 0, pitch: 0.36, dist: 11, target: V(), frozen: false };
let state = 'menu';
let stateT = 0;
let winShown = false;

const playerModel = buildPlayerModel();

// ---------- 輸入 ----------
const keys = new Set();
const input = { x: 0, y: 0, run: false, jumpHeld: false, jumpPressed: false, camX: 0, camY: 0 };
let padPrev = { a: false, start: false };

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.code === 'Enter' && e.target === ui.nameInput) submitScore();
    return;
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  ensureAudio();
  if (!e.repeat) {
    if (e.code === 'Space' || e.code === 'KeyK') input.jumpPressed = true;
    if (e.code === 'KeyP') togglePause();
    if (e.code === 'Escape') pause(); // Esc 同時會解除滑鼠鎖定，只做暫停避免立刻又恢復
    if (e.code === 'KeyM') { muted = !muted; showToast(muted ? '靜音' : '音效開啟', 900); }
    if (e.code === 'Enter' && state === 'menu' && !ui.startBtn.disabled) startGame();
    if (e.code === 'KeyR' && state === 'paused') startGame();
  }
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (state === 'playing') pause(); });

const isLocked = () => document.pointerLockElement === canvas;
function lockPointer() {
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch { /* 部分瀏覽器不支援，改用拖曳旋轉鏡頭 */ }
}
canvas.addEventListener('click', () => { if (state === 'playing' && !isLocked()) lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  if (!isLocked() && state === 'playing') pause();
});
addEventListener('mousemove', (e) => {
  const dragging = !isLocked() && (e.buttons & 1) && e.target === canvas;
  if (!isLocked() && !dragging) return;
  cam.yaw -= e.movementX * 0.0028;
  cam.pitch = clamp(cam.pitch + e.movementY * 0.0022, 0.05, 1.25);
});
canvas.addEventListener('wheel', (e) => {
  cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 0.8, 6, 18);
}, { passive: true });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const deadzone = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
function pollInput() {
  let x = 0, y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
  let run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  let jumpHeld = keys.has('Space') || keys.has('KeyK');
  let camX = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
  let camY = 0;

  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    x += deadzone(gp.axes[0] || 0);
    y -= deadzone(gp.axes[1] || 0);
    camX += deadzone(gp.axes[2] || 0);
    camY += deadzone(gp.axes[3] || 0);
    const a = !!gp.buttons[0]?.pressed;
    const start = !!gp.buttons[9]?.pressed;
    if (a && !padPrev.a) {
      input.jumpPressed = true;
      ensureAudio();
      if (state === 'menu' && !ui.startBtn.disabled) startGame();
    }
    if (start && !padPrev.start) togglePause();
    padPrev = { a, start };
    jumpHeld ||= a;
    run ||= !!gp.buttons[2]?.pressed || (gp.buttons[7]?.value || 0) > 0.3;
    break;
  }
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  Object.assign(input, { x, y, run, jumpHeld, camX, camY });
}

// ---------- 物理 ----------
function overlaps(p, s) {
  const h = PLAYER_HALF;
  return p.x + h.x > s.min.x && p.x - h.x < s.max.x &&
         p.y + h.y > s.min.y && p.y - h.y < s.max.y &&
         p.z + h.z > s.min.z && p.z - h.z < s.max.z;
}

function moveAxis(axis, amt) {
  if (amt === 0) return;
  const p = player;
  p.pos[axis] += amt;
  for (const s of level.solids) {
    if (!overlaps(p.pos, s)) continue;
    if (amt > 0) p.pos[axis] = s.min[axis] - PLAYER_HALF[axis] - EPS;
    else p.pos[axis] = s.max[axis] + PLAYER_HALF[axis] + EPS;
    if (axis === 'y') {
      if (amt < 0) { p.grounded = true; p.ground = s; }
      else hitHead(s);
      p.vel.y = 0;
    } else {
      p.vel[axis] = 0;
    }
  }
}

function hitHead(s) {
  if (s.type !== 'question' && s.type !== 'brick') return;
  if (s.bumpT === 0) s.bumpT = 0.0001;
  if (s.type === 'question' && !s.used) {
    s.used = true;
    s.obj.material = MAT.used;
    const m = mesh(GEO.coin, MAT.coin, s.pos.x, s.pos.y + 0.8, s.pos.z, false, false);
    level.group.add(m);
    level.popups.push({ mesh: m, t: 0, base: s.pos.y + 0.8 });
    addCoins(1);
    sfx('coin');
  } else {
    sfx('bump');
  }
}

function stepMovers(dt) {
  for (const s of level.movers) {
    s.prev.copy(s.pos);
    const m = s.mover;
    m.t += dt;
    const k = (1 - Math.cos((m.t / m.period) * Math.PI * 2)) / 2;
    s.pos.lerpVectors(m.a, m.b, k);
    s.delta.subVectors(s.pos, s.prev);
    updateBounds(s);
  }
}

function stepPlayer(dt) {
  const p = player;
  p.prev.copy(p.pos);

  if (p.dead) {
    p.deathT += dt;
    if (p.deathMode === 'hit') {
      if (p.deathT > 0.45) {
        if (!p.deathLaunched) { p.vel.y = 13; p.deathLaunched = true; }
        p.vel.y -= GRAVITY * dt;
        p.pos.y += p.vel.y * dt;
      }
    } else {
      p.vel.y = Math.max(p.vel.y - GRAVITY * dt, -MAX_FALL);
      p.pos.y += p.vel.y * dt;
    }
    return;
  }
  if (state === 'won') return;

  // 被移動平台載著走
  if (p.grounded && p.ground && p.ground.mover) p.pos.add(p.ground.delta);

  // 計時器
  p.invincible = Math.max(0, p.invincible - dt);
  p.knockT = Math.max(0, p.knockT - dt);
  if (input.jumpPressed) { p.bufferT = JUMP_BUFFER; input.jumpPressed = false; }
  else p.bufferT = Math.max(0, p.bufferT - dt);
  p.coyoteT = p.grounded ? COYOTE_TIME : Math.max(0, p.coyoteT - dt);
  p.sinceLand += dt;

  // 以鏡頭方向為基準的移動輸入
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  const dx = rx * input.x + fx * input.y;
  const dz = rz * input.x + fz * input.y;
  const mag = Math.hypot(dx, dz);
  const maxSpd = input.run ? RUN_SPEED : WALK_SPEED;
  let accel = p.grounded ? (mag > 0.05 ? GROUND_ACCEL : GROUND_DECEL) : AIR_ACCEL;
  if (p.knockT > 0) accel = 4;
  const ddx = dx * maxSpd - p.vel.x, ddz = dz * maxSpd - p.vel.z;
  const dl = Math.hypot(ddx, ddz), maxStep = accel * dt;
  if (dl <= maxStep) { p.vel.x += ddx; p.vel.z += ddz; }
  else { p.vel.x += (ddx / dl) * maxStep; p.vel.z += (ddz / dl) * maxStep; }
  if (mag > 0.05 && p.knockT <= 0) p.targetYaw = Math.atan2(dx, dz);
  p.facing = lerpAngle(p.facing, p.targetYaw, damp(p.grounded ? 16 : 8, dt));

  // 跳躍（含二段、三段跳）
  if (p.bufferT > 0 && (p.grounded || p.coyoteT > 0)) {
    const hs = Math.hypot(p.vel.x, p.vel.z);
    p.combo = (p.sinceLand < COMBO_WINDOW && hs > 4 && p.combo < 2) ? p.combo + 1 : 0;
    p.vel.y = JUMP_SPEEDS[p.combo];
    p.grounded = false; p.ground = null; p.coyoteT = 0; p.bufferT = 0; p.jumping = true;
    p.flipT = p.combo === 2 ? 0.0001 : 0;
    anim.squashV = 5;
    sfx(['jump', 'jump2', 'jump3'][p.combo]);
    dust.burst(V(p.pos.x, p.pos.y - PLAYER_HALF.y + 0.1, p.pos.z), 6, 2.5, 1.5, 0.4, 0.18, 2);
  }

  // 重力（可變跳躍高度）
  let g = GRAVITY;
  if (p.vel.y < 0) g *= FALL_MULT;
  else if (p.jumping && !input.jumpHeld) g *= LOW_JUMP_MULT;
  p.vel.y = Math.max(p.vel.y - g * dt, -MAX_FALL);

  // 分軸移動與碰撞
  const wasGrounded = p.grounded;
  const preVy = p.vel.y;
  p.grounded = false;
  moveAxis('x', p.vel.x * dt);
  moveAxis('z', p.vel.z * dt);
  moveAxis('y', p.vel.y * dt);
  if (p.grounded) {
    p.jumping = false;
    if (!wasGrounded) onLand(preVy);
  } else {
    p.ground = null;
  }
}

function onLand(vy) {
  const p = player;
  p.sinceLand = 0;
  p.flipT = 0;
  const impact = clamp(-vy / 30, 0, 1);
  anim.squashV = -(3 + impact * 7);
  if (impact > 0.3) dust.burst(V(p.pos.x, p.pos.y - PLAYER_HALF.y + 0.1, p.pos.z), Math.round(4 + impact * 8), 3, 1.2, 0.45, 0.2, 2);
}

function stepEnemy(e, dt) {
  e.prev.copy(e.pos);
  if (!e.alive) { e.deadT += dt; return; }
  const p = player;
  const [minX, maxX, minZ, maxZ] = e.rect;
  const pdx = p.pos.x - e.pos.x, pdz = p.pos.z - e.pos.z;
  const playerInArea = p.pos.x > minX && p.pos.x < maxX && p.pos.z > minZ && p.pos.z < maxZ;
  let tx, tz, speed;
  if (!p.dead && state === 'playing' && playerInArea && Math.hypot(pdx, pdz) < 7 && Math.abs(p.pos.y - e.pos.y) < 2.5) {
    tx = p.pos.x; tz = p.pos.z; speed = 3.4; e.alert = true;
  } else {
    const t = e.toB ? e.b : e.a;
    tx = t.x; tz = t.z; speed = 1.8; e.alert = false;
    if (Math.hypot(tx - e.pos.x, tz - e.pos.z) < 0.2) e.toB = !e.toB;
  }
  const mx = tx - e.pos.x, mz = tz - e.pos.z, ml = Math.hypot(mx, mz);
  if (ml > 0.05) {
    const st = Math.min(ml, speed * dt);
    e.pos.x += (mx / ml) * st;
    e.pos.z += (mz / ml) * st;
    e.targetYaw = Math.atan2(mx, mz);
  }
  e.pos.x = clamp(e.pos.x, minX, maxX);
  e.pos.z = clamp(e.pos.z, minZ, maxZ);
}

function checkEnemies() {
  const p = player;
  for (const e of level.enemies) {
    if (!e.alive) continue;
    if (Math.abs(p.pos.x - e.pos.x) > PLAYER_HALF.x + ENEMY_HALF.x ||
        Math.abs(p.pos.y - e.pos.y) > PLAYER_HALF.y + ENEMY_HALF.y ||
        Math.abs(p.pos.z - e.pos.z) > PLAYER_HALF.z + ENEMY_HALF.z) continue;
    const prevFeet = p.prev.y - PLAYER_HALF.y;
    if (p.vel.y <= 0 && prevFeet > e.pos.y) {
      // 踩扁！
      e.alive = false;
      e.deadT = 0;
      p.vel.y = input.jumpHeld ? 16 : 11;
      p.jumping = true; p.grounded = false; p.ground = null;
      anim.squashV = 4;
      game.score += 200;
      game.stomps++;
      sfx('stomp');
      sparkles.burst(e.pos, 10, 4, 5, 0.5, 0.12, 14);
    } else if (p.invincible <= 0) {
      hurt(e.pos);
    }
  }
}

function hurt(from) {
  const p = player;
  p.health--;
  sfx('hurt');
  if (p.health <= 0) { killPlayer('hit'); return; }
  p.invincible = 1.6;
  p.knockT = 0.35;
  const dx = p.pos.x - from.x, dz = p.pos.z - from.z, l = Math.hypot(dx, dz) || 1;
  p.vel.set((dx / l) * 9, 9, (dz / l) * 9);
  p.grounded = false; p.ground = null; p.jumping = false;
}

function addCoins(n) {
  const before = Math.floor(game.coins / COINS_PER_LIFE);
  game.coins += n;
  game.score += 100 * n;
  if (Math.floor(game.coins / COINS_PER_LIFE) > before) {
    game.lives++;
    sfx('oneup');
    showToast('1UP！');
  }
}

function checkPickups() {
  const p = player;
  for (const c of level.coins) {
    if (c.taken) continue;
    const dx = c.pos.x - p.pos.x, dy = c.pos.y - p.pos.y, dz = c.pos.z - p.pos.z;
    if (Math.abs(dy) < 1.3 && dx * dx + dz * dz < 0.8) {
      c.taken = true;
      addCoins(1);
      sfx('coin');
      sparkles.burst(c.pos, 8, 3, 4, 0.4, 0.1, 10);
    }
  }
  for (const cp of level.checkpoints) {
    if (cp.active) continue;
    if (Math.hypot(p.pos.x - cp.pos.x, p.pos.z - cp.pos.z) < 1.8 && Math.abs(p.pos.y - cp.pos.y) < 3) {
      cp.active = true;
      cp.flag.material = MAT.flagOn;
      level.spawn.copy(cp.spawn);
      sfx('checkpoint');
      showToast('中繼點！');
      sparkles.burst(V(cp.pos.x, cp.pos.y + 3, cp.pos.z), 14, 4, 4, 0.6, 0.12, 8);
    }
  }
  const st = level.star;
  if (st && !st.taken && p.pos.distanceTo(st.pos) < 1.6) {
    st.taken = true;
    winGame();
  }
}

function killPlayer(mode) {
  const p = player;
  if (p.dead) return;
  p.dead = true;
  p.deathMode = mode;
  p.deathT = 0;
  p.deathLaunched = false;
  p.flipT = 0;
  p.vel.set(0, mode === 'hit' ? 0 : p.vel.y, 0);
  cam.frozen = true;
  state = 'dying';
  stateT = 0;
  sfx('die');
}

function afterDeath() {
  game.lives--;
  if (game.lives <= 0) {
    game.lives = 0;
    gameOver();
    return;
  }
  respawn();
  state = 'playing';
  stateT = 0;
  showToast(`剩餘 ${game.lives} 條命`);
}

function respawn() {
  const p = player;
  p.pos.copy(level.spawn);
  p.prev.copy(p.pos);
  p.vel.set(0, 0, 0);
  Object.assign(p, {
    grounded: false, ground: null, coyoteT: 0, bufferT: 0, jumping: false, combo: 0, sinceLand: 99,
    facing: Math.PI, targetYaw: Math.PI, invincible: 1.0, knockT: 0, health: MAX_HEALTH,
    dead: false, deathMode: null, deathT: 0, deathLaunched: false, flipT: 0,
  });
  anim.squash = 1; anim.squashV = 0;
  cam.yaw = 0;
  cam.frozen = false;
  cam.target.set(p.pos.x, p.pos.y + 1, p.pos.z);
}

function step(dt) {
  stateT += dt;
  if (state === 'playing') game.time += dt;
  stepMovers(dt);
  stepPlayer(dt);
  for (const e of level.enemies) stepEnemy(e, dt);
  if (state === 'playing') {
    checkEnemies();
    if (state === 'playing') checkPickups();
    if (state === 'playing' && player.pos.y < KILL_Y) killPlayer('fall');
  }
  if (state === 'dying' && stateT > 1.8) afterDeath();
  if (state === 'won' && stateT > 2 && !winShown) showWin();
}

// ---------- 畫面更新（每個顯示幀） ----------
const renderPos = V();
const camFocus = V();

function animatePlayer(dt, pos) {
  const p = player, m = playerModel;
  m.root.position.set(pos.x, pos.y - PLAYER_HALF.y, pos.z);
  m.yawG.rotation.y = p.facing;
  const hs = Math.hypot(p.vel.x, p.vel.z);
  let legL = 0, legR = 0, armL = 0, armR = 0, k = 14;

  if (state === 'won') {
    anim.spin += dt * 10;
    m.yawG.rotation.y = cam.yaw + Math.max(0, 1 - stateT * 0.7) * anim.spin;
    armL = armR = -2.9;
  } else if (p.dead && p.deathMode === 'hit') {
    m.yawG.rotation.y = cam.yaw;
    armL = armR = -2.8; legL = 0.3; legR = -0.3;
  } else if (!p.grounded) {
    if (p.vel.y > 0) { armR = -2.7; armL = 0.5; legL = -0.9; legR = 0.4; }
    else { armR = -1.9; armL = -1.2; legL = -0.4; legR = 0.3; }
  } else if (hs > 0.3) {
    anim.phase += dt * (4 + hs * 1.15);
    const amp = Math.min(1, hs / WALK_SPEED) * 0.95;
    const s = Math.sin(anim.phase);
    legL = s * amp; legR = -s * amp; armL = -s * amp * 0.9; armR = s * amp * 0.9;
    k = 30;
    // 奔跑揚塵
    if (hs > 9) {
      anim.dustAcc += dt;
      if (anim.dustAcc > 0.06) {
        anim.dustAcc = 0;
        dust.spawn(pos.x, pos.y - PLAYER_HALF.y + 0.1, pos.z, -p.vel.x * 0.05, 1, -p.vel.z * 0.05, 0.4, 0.16, 1);
      }
    }
  } else {
    const b = Math.sin(performance.now() * 0.003) * 0.05;
    armL = b; armR = -b;
  }
  const t = damp(k, dt);
  anim.legL = lerp(anim.legL, legL, t); anim.legR = lerp(anim.legR, legR, t);
  anim.armL = lerp(anim.armL, armL, t); anim.armR = lerp(anim.armR, armR, t);
  m.legs[0].rotation.x = anim.legL; m.legs[1].rotation.x = anim.legR;
  m.arms[0].rotation.x = anim.armL; m.arms[1].rotation.x = anim.armR;

  // 擠壓伸展彈簧
  const sdt = Math.min(dt, 1 / 30);
  anim.squashV += (-(anim.squash - 1) * 220 - anim.squashV * 14) * sdt;
  anim.squash = clamp(anim.squash + anim.squashV * sdt, 0.6, 1.4);
  let sy = anim.squash;
  if (!p.grounded && !p.dead) sy *= 1 + clamp(p.vel.y / 60, -0.08, 0.12);
  const sxz = 1 / Math.sqrt(sy);
  m.squash.scale.set(sxz, sy, sxz);

  // 三段跳空翻
  if (p.flipT > 0) {
    p.flipT += dt;
    const pr = Math.min(1, p.flipT / 0.55);
    m.flip.rotation.x = (1 - Math.pow(1 - pr, 2)) * Math.PI * 2;
    if (pr >= 1) p.flipT = 0;
  } else {
    m.flip.rotation.x = 0;
  }

  m.root.visible = !(p.invincible > 0 && !p.dead && Math.floor(p.invincible * 14) % 2 === 0);
}

function renderWorld(dt, alpha) {
  const L = level;
  const now = performance.now() / 1000;

  // 移動平台與方塊彈跳
  for (const s of L.solids) {
    if (s.mover) {
      s.obj.position.lerpVectors(s.prev, s.pos, alpha).add(s.offset);
    } else if (s.bumpT > 0) {
      s.bumpT += dt;
      const pr = Math.min(1, s.bumpT / 0.22);
      s.obj.position.y = s.pos.y + Math.sin(pr * Math.PI) * 0.35;
      if (pr >= 1) s.bumpT = 0;
    }
  }
  MAT.question.emissiveIntensity = 0.25 + Math.sin(now * 4) * 0.15;

  // 玩家（插值）
  renderPos.lerpVectors(player.prev, player.pos, alpha);
  animatePlayer(dt, renderPos);

  // 敵人
  for (const e of L.enemies) {
    if (!e.visible) continue;
    const g = e.model.g;
    g.position.set(lerp(e.prev.x, e.pos.x, alpha), e.pos.y - ENEMY_HALF.y, lerp(e.prev.z, e.pos.z, alpha));
    e.yaw = lerpAngle(e.yaw, e.targetYaw, damp(8, dt));
    g.rotation.y = e.yaw;
    if (e.alive) {
      e.walk += dt * (e.alert ? 16 : 9);
      const s = Math.sin(e.walk);
      e.model.feet[0].position.z = 0.05 + s * 0.14;
      e.model.feet[1].position.z = 0.05 - s * 0.14;
      e.model.inner.rotation.z = s * 0.08;
      e.model.inner.position.y = Math.abs(s) * 0.05;
    } else {
      const t = damp(25, dt);
      e.model.inner.scale.set(lerp(e.model.inner.scale.x, 1.35, t), lerp(e.model.inner.scale.y, 0.22, t), lerp(e.model.inner.scale.z, 1.35, t));
      e.model.inner.rotation.z = 0;
      if (e.deadT > 0.6) { g.visible = false; e.visible = false; }
    }
  }

  // 金幣
  for (const c of L.coins) {
    if (c.taken) {
      if (c.mesh.visible) {
        c.takeT += dt;
        c.mesh.position.y += dt * 7;
        c.mesh.rotation.y += dt * 25;
        c.mesh.scale.setScalar(Math.max(0.01, 1 - c.takeT / 0.3));
        if (c.takeT > 0.3) c.mesh.visible = false;
      }
      continue;
    }
    c.mesh.rotation.y = now * 3 + c.phase;
    c.mesh.position.y = c.pos.y + Math.sin(now * 2.5 + c.phase) * 0.08;
  }
  for (let i = L.popups.length - 1; i >= 0; i--) {
    const pc = L.popups[i];
    pc.t += dt;
    pc.mesh.position.y = pc.base + 4 * pc.t - 8 * pc.t * pc.t;
    pc.mesh.rotation.y += dt * 20;
    if (pc.t > 0.45) {
      sparkles.burst(pc.mesh.position, 6, 2.5, 3, 0.35, 0.1, 8);
      L.group.remove(pc.mesh);
      L.popups.splice(i, 1);
    }
  }

  // 終點星星
  if (L.star) {
    const st = L.star.obj;
    if (state === 'won') {
      st.position.lerp(V(renderPos.x, renderPos.y + 2.2, renderPos.z), damp(6, dt));
      st.rotation.y += dt * 12;
    } else {
      st.rotation.y = now * 1.6;
      st.position.y = L.star.pos.y + Math.sin(now * 2) * 0.2;
      if (Math.random() < dt * 8) sparkles.spawn(st.position.x + (Math.random() - 0.5) * 2, st.position.y + (Math.random() - 0.5) * 2, st.position.z, 0, 0.6, 0, 0.8, 0.08, 0);
    }
  }

  for (const cp of L.checkpoints) cp.flagPivot.rotation.y = Math.sin(now * 3 + cp.pos.z) * (cp.active ? 0.35 : 0.12);
  for (const c of L.clouds) {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 170) c.position.x = -170;
  }

  dust.update(dt);
  sparkles.update(dt);
  updateCamera(dt);

  sun.position.copy(cam.target).add(SUN_OFFSET);
  sun.target.position.copy(cam.target);
  sky.position.copy(camera.position);
}

function updateCamera(dt) {
  if (state === 'menu') {
    cam.yaw += dt * 0.12;
    cam.target.set(0, 2, 0);
  } else {
    cam.yaw -= input.camX * 2.4 * dt;
    cam.pitch = clamp(cam.pitch + input.camY * 1.6 * dt, 0.05, 1.25);
    if (!cam.frozen) {
      camFocus.set(renderPos.x, renderPos.y + 1, renderPos.z);
      cam.target.x = lerp(cam.target.x, camFocus.x, damp(10, dt));
      cam.target.z = lerp(cam.target.z, camFocus.z, damp(10, dt));
      // 垂直方向較慢跟隨，跳躍時畫面不會晃
      const ky = player.grounded || player.vel.y < -14 || camFocus.y < cam.target.y - 3 ? 7 : 2.2;
      cam.target.y = lerp(cam.target.y, camFocus.y, damp(ky, dt));
    }
  }
  const cp = Math.cos(cam.pitch);
  camera.position.set(
    cam.target.x + Math.sin(cam.yaw) * cp * cam.dist,
    cam.target.y + Math.sin(cam.pitch) * cam.dist,
    cam.target.z + Math.cos(cam.yaw) * cp * cam.dist,
  );
  camera.lookAt(cam.target);
}

// ---------- HUD / UI ----------
const hudCache = {};
function setText(el, key, val) {
  if (hudCache[key] !== val) {
    hudCache[key] = val;
    el.textContent = val;
  }
}
function updateHud() {
  setText(ui.coins, 'c', String(game.coins));
  setText(ui.lives, 'l', String(game.lives));
  setText(ui.score, 's', String(game.score));
  setText(ui.time, 't', game.time.toFixed(1));
  const h = Math.max(0, player.dead ? 0 : player.health);
  if (hudCache.h !== h) {
    hudCache.h = h;
    ui.hearts.innerHTML = '❤'.repeat(h) + `<span class="empty">${'❤'.repeat(MAX_HEALTH - h)}</span>`;
  }
}

let toastTimer = 0;
function showToast(text, ms = 1300) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
}

let fpsAcc = 0, fpsFrames = 0;
function updateFps(dt) {
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    ui.fps.textContent = `${Math.round(fpsFrames / fpsAcc)} FPS`;
    fpsAcc = 0; fpsFrames = 0;
  }
}

function showOverlay(el) {
  for (const o of [ui.menu, ui.pause, ui.win, ui.over]) o.classList.toggle('hidden', o !== el);
}

function startGame() {
  ensureAudio();
  buildLevel();
  Object.assign(game, { coins: 0, score: 0, lives: START_LIVES, time: 0, finalScore: 0, timeBonus: 0, stomps: 0 });
  respawn();
  player.invincible = 0;
  cam.pitch = 0.36;
  winShown = false;
  state = 'playing';
  stateT = 0;
  input.jumpPressed = false;
  showOverlay(null);
  ui.hud.classList.remove('hidden');
  lockPointer();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  showOverlay(ui.pause);
  if (isLocked()) document.exitPointerLock();
}
function resume() {
  if (state !== 'paused') return;
  state = 'playing';
  input.jumpPressed = false;
  showOverlay(null);
  lockPointer();
}
function togglePause() {
  if (state === 'playing') pause();
  else if (state === 'paused') resume();
}
function toMenu() {
  state = 'menu';
  ui.hud.classList.add('hidden');
  showOverlay(ui.menu);
  loadBoard(ui.menuBoard);
}

function winGame() {
  state = 'won';
  stateT = 0;
  player.vel.set(0, 0, 0);
  game.timeBonus = Math.max(0, Math.round((TIME_BONUS_LIMIT - game.time) * 20));
  game.finalScore = game.score + 5000 + game.timeBonus + game.lives * 500;
  sfx('win');
  showToast('拿到星星！', 1800);
  sparkles.burst(level.star.pos, 30, 6, 6, 0.9, 0.15, 6);
  if (isLocked()) document.exitPointerLock();
}

function showWin() {
  winShown = true;
  ui.hud.classList.add('hidden');
  ui.winScore.textContent = game.finalScore.toLocaleString();
  ui.winDetail.innerHTML =
    `金幣 ${game.coins} × 100 ・ 踩敵 ${game.stomps} × 200<br>` +
    `星星 +5000 ・ 時間 ${game.time.toFixed(1)} 秒 → +${game.timeBonus}<br>剩餘命數 ${game.lives} × 500`;
  ui.submitMsg.textContent = '';
  ui.submitBtn.disabled = false;
  try { ui.nameInput.value = localStorage.getItem('easygame-name') || ''; } catch { /* 無痕模式 */ }
  showOverlay(ui.win);
  loadBoard(ui.winBoard);
  setTimeout(() => ui.nameInput.focus(), 50);
}

function gameOver() {
  state = 'over';
  ui.hud.classList.add('hidden');
  ui.overDetail.textContent = `分數 ${game.score} ・ 金幣 ${game.coins}`;
  showOverlay(ui.over);
  if (isLocked()) document.exitPointerLock();
}

// ---------- 排行榜（PHP API） ----------
const API = 'api/scores.php';
function renderBoard(el, list, highlightId) {
  el.replaceChildren();
  if (!list.length) {
    el.innerHTML = '<li class="muted">還沒有紀錄，成為第一名吧！</li>';
    return;
  }
  list.forEach((s, i) => {
    const li = document.createElement('li');
    if (s.id && s.id === highlightId) li.className = 'me';
    const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = i + 1;
    const name = document.createElement('span'); name.className = 'name'; name.textContent = s.name;
    const time = document.createElement('span'); time.className = 'muted'; time.textContent = `${Number(s.time).toFixed(1)}s`;
    const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = Number(s.score).toLocaleString();
    li.append(rank, name, time, pts);
    el.append(li);
  });
}
async function loadBoard(el) {
  el.innerHTML = '<li class="muted">載入中…</li>';
  try {
    const r = await fetch(API, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    renderBoard(el, j.scores || []);
  } catch {
    el.innerHTML = '<li class="muted">排行榜需透過 XAMPP 的 http://localhost/ 開啟</li>';
  }
}
async function submitScore() {
  if (ui.submitBtn.disabled) return;
  const name = ui.nameInput.value.trim() || 'Player';
  try { localStorage.setItem('easygame-name', name); } catch { /* 無痕模式 */ }
  ui.submitBtn.disabled = true;
  ui.submitMsg.textContent = '上傳中…';
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score: game.finalScore, coins: game.coins, time: Number(game.time.toFixed(2)) }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || r.status);
    ui.submitMsg.textContent = j.rank ? `上傳成功！你是第 ${j.rank} 名` : '上傳成功！';
    renderBoard(ui.winBoard, j.scores || [], j.id);
  } catch (err) {
    ui.submitMsg.textContent = `上傳失敗：${err.message || err}`;
    ui.submitBtn.disabled = false;
  }
}

ui.startBtn.addEventListener('click', startGame);
ui.resumeBtn.addEventListener('click', resume);
ui.restartBtn.addEventListener('click', startGame);
ui.quitBtn.addEventListener('click', toMenu);
ui.againBtn.addEventListener('click', startGame);
ui.overBtn.addEventListener('click', startGame);
ui.submitBtn.addEventListener('click', submitScore);

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 主迴圈：固定步長物理 + 插值渲染 ----------
let lastTime = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  dt = clamp(dt, 0, MAX_FRAME_DT);

  pollInput();
  if (state === 'playing' || state === 'dying' || state === 'won') {
    acc += dt;
    while (acc >= FIXED_DT) {
      step(FIXED_DT);
      acc -= FIXED_DT;
    }
  }
  renderWorld(dt, acc / FIXED_DT);
  if (state !== 'menu') updateHud();
  renderer.render(scene, camera);
  updateFps(dt);
}

buildLevel();
respawn();
ui.startBtn.disabled = false;
ui.startBtn.textContent = '開始遊戲（Enter）';
loadBoard(ui.menuBoard);
renderer.compile(scene, camera);
window.__gameReady = true;
if (new URLSearchParams(location.search).has('debug')) {
  window.__game = { player, game, cam, get level() { return level; }, get state() { return state; } };
}
requestAnimationFrame(frame);
