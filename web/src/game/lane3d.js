// Draws the bowling hall with Three.js and plays a throw from the physics simulation.
// The hall is a small retro bowling centre: honey wood, walnut trim, teal and coral.
// Light and gloss are painted into the textures, so it runs on a modest laptop.
import * as THREE from 'three';
import { LANE, createWorld, step, result, pinLayout } from './physics.js';
import { BRAND } from '../brand.js';
import { Bowler, softShadow } from './bowler.js';
import { Crowd } from './crowd.js';

// The lane is drawn shorter than it is simulated, so the pins are never far away.
const K = 0.66;
const Z = (z) => -z * K;
const PIN_Z = Z(LANE.pinZ);
const DECK_END = Z(LANE.deckEnd);
const LEN = -DECK_END + 0.05;
const MID = -LEN / 2;
// Distance from one lane's centre to the next, and how many lanes there are each side of ours.
const PITCH = LANE.wallX * 2 + 0.44;
const SIDE = 3;
const HALL_W = PITCH * (SIDE * 2 + 1);
const CEIL = 2.8;
const MASK_Y = 0.66;
const MASK_Z = PIN_Z - 0.28;
const PIT_Z = DECK_END - 0.3;
const APPROACH = 3.6;
const BACK_Z = 8.6;
const PIN_SCALE = 1.16;
// Where the bowler stands, behind the foul line.
const STAND = 0.42;

const C = {
  cream: '#f4e8d0', teal: '#2c8b88', tealDeep: '#1f6f6d', coral: '#e8573f', mustard: '#e9b949',
  walnut: '#5b3a22', honey: '#e3b876',
};
const hex = (s) => parseInt(s.slice(1), 16);
const FONT = '"Fredoka Variable", "Trebuchet MS", Arial, sans-serif';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A repeatable random number, so the wood looks the same every time.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function paintWood(g, w, h, boards, seed) {
  const r = rng(seed);
  g.fillStyle = C.honey;
  g.fillRect(0, 0, w, h);
  const bw = w / boards;
  for (let i = 0; i < boards; i++) {
    const tone = r();
    g.fillStyle = tone > 0.5 ? `rgba(255,236,190,${(tone - 0.5) * 0.36})` : `rgba(140,84,30,${(0.5 - tone) * 0.3})`;
    g.fillRect(i * bw, 0, bw, h);
    g.fillStyle = 'rgba(96,56,20,0.2)';
    g.fillRect(i * bw, 0, 1, h);
  }
  // Grain: long faint streaks along the boards.
  for (let i = 0; i < 520; i++) {
    const x = r() * w;
    const y = r() * h;
    const len = 40 + r() * 260;
    g.fillStyle = r() > 0.5 ? 'rgba(120,70,24,0.07)' : 'rgba(255,240,205,0.08)';
    g.fillRect(x, y, 1 + r(), len);
  }
}

// The lane: boards, arrows, dots, and the shine of the pit lights painted on the far end.
function laneTexture() {
  return canvasTexture(256, 2048, (g, w, h) => {
    paintWood(g, w, h, 13, 7);
    g.fillStyle = 'rgba(92,52,18,0.72)';
    for (let i = -3; i <= 3; i++) {
      const x = w / 2 + i * 31;
      const y = h * 0.72 + Math.abs(i) * 36;
      g.beginPath();
      g.moveTo(x, y - 40);
      g.lineTo(x + 8, y);
      g.lineTo(x - 8, y);
      g.fill();
      g.beginPath();
      g.arc(x, h * 0.93, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    // The pin deck is a paler wood.
    const deck = h * (1 - (-PIN_Z - 0.35) / LEN);
    g.fillStyle = 'rgba(255,244,214,0.3)';
    g.fillRect(0, 0, w, deck);
    // Gloss: bright near the pins, a long soft streak down the middle.
    const shine = g.createLinearGradient(0, 0, 0, h * 0.4);
    shine.addColorStop(0, 'rgba(255,250,228,0.5)');
    shine.addColorStop(0.35, 'rgba(255,246,214,0.16)');
    shine.addColorStop(1, 'rgba(255,246,214,0)');
    g.fillStyle = shine;
    g.fillRect(0, 0, w, h * 0.4);
    const streak = g.createLinearGradient(0, 0, w, 0);
    streak.addColorStop(0.2, 'rgba(255,255,255,0)');
    streak.addColorStop(0.5, 'rgba(255,248,220,0.1)');
    streak.addColorStop(0.8, 'rgba(255,255,255,0)');
    g.fillStyle = streak;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a2413';
    g.fillRect(0, h - 10, w, 5);
  });
}

function approachTexture() {
  const t = canvasTexture(256, 512, (g, w, h) => {
    paintWood(g, w, h, 13, 19);
    g.fillStyle = 'rgba(92,52,18,0.6)';
    for (let i = -3; i <= 3; i++) {
      for (const y of [h * 0.12, h * 0.62]) {
        g.beginPath();
        g.arc(w / 2 + i * 31, y, 3.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    // A little darker towards the seats, where the lane lights do not reach.
    const fade = g.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, 'rgba(255,246,220,0.14)');
    fade.addColorStop(1, 'rgba(80,44,14,0.2)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);
  });
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(HALL_W / (LANE.halfW * 2), 1);
  return t;
}

function carpetTexture() {
  const t = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#245f66';
    g.fillRect(0, 0, w, h);
    const r = rng(3);
    const shapes = [C.coral, C.mustard, '#3f8f93', '#f4e8d0'];
    for (let i = 0; i < 14; i++) {
      g.save();
      g.translate(r() * w, r() * h);
      g.rotate(r() * 6);
      g.fillStyle = shapes[i % 4];
      g.globalAlpha = 0.75;
      if (i % 3 === 0) g.fillRect(-7, -2, 14, 4);
      else if (i % 3 === 1) { g.beginPath(); g.moveTo(0, -6); g.lineTo(6, 5); g.lineTo(-6, 5); g.fill(); }
      else { g.beginPath(); g.arc(0, 0, 3.5, 0, 7); g.fill(); }
      g.restore();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(HALL_W / 1.4, (BACK_Z - APPROACH) / 1.4);
  return t;
}

// Wooden slats with one round lamp per tile. The lamp's glow is painted on.
function ceilingTexture() {
  const t = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#9a6a3c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? '#a87745' : '#b98651';
      g.fillRect(i * 16, 0, 14, h);
      g.fillStyle = 'rgba(50,26,8,0.5)';
      g.fillRect(i * 16 + 14, 0, 2, h);
    }
    const glow = g.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, 120);
    glow.addColorStop(0, 'rgba(255,240,196,0.95)');
    glow.addColorStop(0.35, 'rgba(255,226,160,0.4)');
    glow.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff8e2';
    g.beginPath();
    g.arc(w / 2, h / 2, 24, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d9b56c';
    g.lineWidth = 4;
    g.stroke();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(SIDE * 2 + 1, 6);
  return t;
}

function starburst(g, x, y, r, color) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = r * 0.09;
  g.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const len = i % 2 ? r * 0.6 : r;
    g.rotate(Math.PI / 4);
    g.beginPath();
    g.moveTo(0, -len * 0.25);
    g.lineTo(0, -len);
    g.stroke();
    if (i % 2 === 0) { g.beginPath(); g.arc(0, -len, r * 0.1, 0, 7); g.fill(); }
  }
  g.beginPath();
  g.arc(0, 0, r * 0.14, 0, 7);
  g.fill();
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// The wall above the pins, for every lane at once. Drawn in metres, from the ceiling down.
function endWallTexture(sign) {
  const H = CEIL - MASK_Y;
  return canvasTexture(4096, 512, (g, w, h) => {
    g.scale(w / HALL_W, h / H);
    const maskTop = H - 0.86;
    // Upper wall: cream, with a walnut cornice and two stripes.
    const wall = g.createLinearGradient(0, 0, 0, maskTop);
    wall.addColorStop(0, '#e2cfa8');
    wall.addColorStop(0.35, C.cream);
    wall.addColorStop(1, '#efe0c2');
    g.fillStyle = wall;
    g.fillRect(0, 0, HALL_W, maskTop);
    g.fillStyle = C.walnut;
    g.fillRect(0, 0, HALL_W, 0.07);
    g.fillStyle = C.coral;
    g.fillRect(0, maskTop - 0.4, HALL_W, 0.075);
    g.fillStyle = C.teal;
    g.fillRect(0, maskTop - 0.29, HALL_W, 0.03);
    // A row of small diamonds under the cornice.
    g.fillStyle = C.mustard;
    for (let x = 0.25; x < HALL_W; x += 0.5) {
      g.beginPath();
      g.moveTo(x, 0.26);
      g.lineTo(x + 0.06, 0.36);
      g.lineTo(x, 0.46);
      g.lineTo(x - 0.06, 0.36);
      g.fill();
    }
    for (let n = 0; n < SIDE * 2 + 1; n++) {
      const x = n * PITCH;
      const ours = n === SIDE;
      // One panel per lane.
      g.fillStyle = C.tealDeep;
      g.fillRect(x, maskTop, PITCH, 0.86);
      const panel = g.createLinearGradient(0, maskTop, 0, H);
      panel.addColorStop(0, '#39a09b');
      panel.addColorStop(1, C.teal);
      g.fillStyle = panel;
      roundRect(g, x + 0.06, maskTop + 0.06, PITCH - 0.12, 0.7, 0.06);
      g.fill();
      g.strokeStyle = C.cream;
      g.lineWidth = 0.018;
      g.stroke();
      // A cream plaque with the lane number, or the name over our lane.
      const pw = ours ? 1.5 : 0.62;
      g.fillStyle = C.cream;
      roundRect(g, x + PITCH / 2 - pw / 2, maskTop + 0.17, pw, 0.48, 0.24);
      g.fill();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (ours) {
        g.fillStyle = sign ? sign.color : C.tealDeep;
        g.font = `700 0.3px ${FONT}`;
        g.fillText(sign ? sign.name : BRAND.name, x + PITCH / 2, maskTop + 0.385, pw - 0.3);
        g.fillStyle = C.coral;
        g.font = `600 0.07px ${FONT}`;
        g.fillText('LANE 67', x + PITCH / 2, maskTop + 0.57);
      } else {
        g.fillStyle = C.coral;
        g.font = `700 0.34px ${FONT}`;
        g.fillText(String(64 + n), x + PITCH / 2, maskTop + 0.425);
        starburst(g, x + 0.36, maskTop + 0.41, 0.15, C.mustard);
        starburst(g, x + PITCH - 0.36, maskTop + 0.41, 0.15, C.mustard);
      }
      // Walnut trim and the lamp that lights the pins.
      g.fillStyle = C.walnut;
      g.fillRect(x, H - 0.075, PITCH, 0.045);
      g.fillStyle = '#fff3cf';
      g.fillRect(x + 0.24, H - 0.03, PITCH - 0.48, 0.03);
      g.fillStyle = C.walnut;
      g.fillRect(x - 0.02, maskTop, 0.04, 0.86);
    }
  });
}

// The wall behind the seats.
function backWallTexture() {
  return canvasTexture(2048, 512, (g, w, h) => {
    g.scale(w / HALL_W, h / CEIL);
    g.fillStyle = C.cream;
    g.fillRect(0, 0, HALL_W, CEIL);
    g.fillStyle = C.teal;
    g.fillRect(0, CEIL - 1.05, HALL_W, 1.05);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < HALL_W; x += 0.22) g.fillRect(x, CEIL - 1.05, 0.015, 1.05);
    g.fillStyle = C.walnut;
    g.fillRect(0, CEIL - 1.1, HALL_W, 0.07);
    g.fillStyle = C.coral;
    g.fillRect(0, 0.42, HALL_W, 0.09);
    g.fillStyle = C.walnut;
    g.fillRect(0, 0, HALL_W, 0.07);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = C.tealDeep;
    g.font = `700 0.34px ${FONT}`;
    g.fillText('BOWL LIKE YOURSELF', HALL_W / 2, 1.08);
    starburst(g, HALL_W / 2 - 2.4, 1.08, 0.3, C.mustard);
    starburst(g, HALL_W / 2 + 2.4, 1.08, 0.3, C.mustard);
    starburst(g, HALL_W / 2 - 4.6, 1.0, 0.2, C.coral);
    starburst(g, HALL_W / 2 + 4.6, 1.0, 0.2, C.coral);
  });
}

function sideWallTexture() {
  return canvasTexture(64, 256, (g, w, h) => {
    const s = h / CEIL;
    g.fillStyle = '#eadbb9';
    g.fillRect(0, 0, w, h);
    g.fillStyle = C.walnut;
    g.fillRect(0, 0, w, 0.07 * s);
    g.fillStyle = C.coral;
    g.fillRect(0, 0.95 * s, w, 0.075 * s);
    g.fillStyle = C.tealDeep;
    g.fillRect(0, (CEIL - 1.0) * s, w, 1.0 * s);
    g.fillStyle = C.walnut;
    g.fillRect(0, (CEIL - 1.04) * s, w, 0.06 * s);
  });
}

// The dark space the pins are swept into, with a little light spilling in at the bottom.
function pitTexture() {
  return canvasTexture(8, 64, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#120c08');
    grad.addColorStop(0.6, '#1e1410');
    grad.addColorStop(1, '#4a3322');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

// A polished ball: a deep colour with paler swirls through it.
function ballTexture(base, swirl, seed) {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const r = rng(seed);
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = i % 3 ? swirl : 'rgba(0,0,0,0.25)';
      g.globalAlpha = 0.12 + r() * 0.28;
      g.lineWidth = 2 + r() * 9;
      const y = r() * h;
      g.beginPath();
      g.moveTo(-20, y);
      g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 90, w * 0.6, y + (r() - 0.5) * 90, w + 20, y);
      g.stroke();
    }
  });
}

// Chevrons that scroll down the lane to show where the ball will go.
function aimTexture() {
  const t = canvasTexture(64, 128, (g, w) => {
    g.strokeStyle = '#ffffff';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const y of [50, 114]) {
      g.beginPath();
      g.moveTo(14, y);
      g.lineTo(w / 2, y - 30);
      g.lineTo(w - 14, y);
      g.stroke();
    }
  });
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 6);
  return t;
}

const PIN_BODY = new THREE.LatheGeometry(
  // Outline of half a pin, spun around its axis.
  [
    [0.0, 0.0], [0.028, 0.0], [0.045, 0.05], [0.06, 0.115], [0.055, 0.18],
    [0.032, 0.25], [0.023, 0.29], [0.03, 0.335], [0.03, 0.36], [0.018, 0.378], [0.0, 0.381],
  ].map(([x, y]) => new THREE.Vector2(x, y)),
  18,
);
// Two red bands round the neck.
const PIN_BAND = new THREE.CylinderGeometry(0.0262, 0.0242, 0.014, 16, 1, true);
const PIN_WHITE = new THREE.MeshPhongMaterial({ color: 0xfffdf6, shininess: 120, specular: 0xaaaaaa, emissive: 0x2a2620 });
const PIN_RED = new THREE.MeshBasicMaterial({ color: 0xdc3a2c });
const BAND_Y = [0.279, 0.299];

function pinMesh() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(PIN_BODY, PIN_WHITE));
  for (const y of BAND_Y) {
    const band = new THREE.Mesh(PIN_BAND, PIN_RED);
    band.position.y = y;
    group.add(band);
  }
  group.scale.setScalar(PIN_SCALE);
  return group;
}

// Many copies of one shape in one draw call. Each entry of `list` places one copy.
function copies(geo, material, list) {
  const mesh = new THREE.InstancedMesh(geo, material, list.length);
  const o = new THREE.Object3D();
  list.forEach((place, i) => {
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.set(1, 1, 1);
    place(o);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
  });
  mesh.frustumCulled = false;
  return mesh;
}

function flat(w, d, material) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2;
  return m;
}

export class Lane {
  // `cast` adds the bowler, the robots and the seats. `sign` is { name, tagline, color }.
  constructor(container, { cast = false, sign = null } = {}) {
    this.container = container;
    this.cast = cast;
    this.sign = sign;
    this.active = true;
    this.swing = 'idle';
    this.reaction = null;
    this.cut = true;
    this.look = new THREE.Vector3();
    this.hand = new THREE.Vector3();
    this.view = { x: 0, y: 1.4, z: 5, lx: 0, ly: 0.4, lz: -7, fov: 28 };
    this.fov = 28;
    this.wide = 1;
    this.onHit = null;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(this.pixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a1c12);
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);

    // Warm light from the ceiling lamps, and a softer fill from the seats so faces and pins read.
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0xc9a070, 1.75));
    const key = new THREE.DirectionalLight(0xfff0d6, 1.5);
    key.position.set(-2.5, 6, 5);
    const fill = new THREE.DirectionalLight(0xffe2c0, 0.45);
    fill.position.set(3, 2.5, -6);
    this.scene.add(key, fill);

    // Everything in here is drawn a second time upside down, as the reflection in the polished lane.
    this.mirror = new THREE.Group();
    this.mirror.scale.y = -1;
    this.scene.add(this.mirror);
    this.twins = [];

    this.build();
    this.world = null;
    this.onDone = null;
    this.aim = 0;
    this.aimShown = 0;
    this.shake = 0;
    this.hitSeen = false;
    this.slow = 0;
    this.clock = 0;
    this.last = performance.now();
    this.acc = 0;

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    new ResizeObserver(this.resize).observe(container);
    this.resize();
    this.resetPins();
    requestAnimationFrame(this.frame);
  }

  // Adds an object to the scene and a twin of it to the reflection.
  reflected(obj) {
    this.scene.add(obj);
    const twin = obj.clone();
    this.mirror.add(twin);
    this.twins.push([obj, twin]);
    return obj;
  }

  build() {
    const scene = this.scene;
    const wood = laneTexture();
    const laneGeo = new THREE.PlaneGeometry(LANE.halfW * 2, LEN);
    laneGeo.rotateX(-Math.PI / 2);
    // Our lane is slightly see-through, so the reflection under it shows.
    const lane = new THREE.Mesh(laneGeo, new THREE.MeshPhongMaterial({
      map: wood, shininess: 150, specular: 0x8a7a66, transparent: true, opacity: 0.84,
    }));
    lane.position.set(0, 0, MID);
    lane.renderOrder = 2;
    const under = flat(LANE.halfW * 2, LEN, new THREE.MeshBasicMaterial({ color: 0xf0c888 }));
    under.position.set(0, -0.6, MID);
    scene.add(lane, under);

    const others = [];
    for (let n = -SIDE; n <= SIDE; n++) if (n) others.push(n);
    scene.add(copies(laneGeo, new THREE.MeshPhongMaterial({ map: wood, shininess: 120, specular: 0x66594a }),
      others.map((n) => (o) => o.position.set(n * PITCH, 0, MID))));

    // Gutters: dark half-pipes either side of every lane.
    const gutterGeo = new THREE.CylinderGeometry(LANE.gutterW / 2, LANE.gutterW / 2, LEN, 10, 1, true, -Math.PI / 2, Math.PI);
    const gutterMat = new THREE.MeshPhongMaterial({ color: 0x3a2c25, shininess: 70, specular: 0x6b5a4c, side: THREE.DoubleSide });
    const gutters = [];
    const caps = [];
    for (let n = -SIDE; n <= SIDE; n++) {
      for (const s of [-1, 1]) {
        gutters.push((o) => {
          o.position.set(n * PITCH + s * (LANE.halfW + LANE.gutterW / 2), 0, MID);
          o.rotation.x = Math.PI / 2;
          o.scale.z = 0.62;
        });
      }
    }
    for (let n = -SIDE - 1; n <= SIDE; n++) caps.push(n);
    scene.add(copies(gutterGeo, gutterMat, gutters));
    // Under the gutters, so nothing shows through at the ends.
    const bedMat = new THREE.MeshBasicMaterial({ color: 0x241913 });
    const bedW = HALL_W / 2 - LANE.halfW;
    for (const s of [-1, 1]) {
      const bed = flat(bedW, LEN, bedMat);
      bed.position.set(s * (LANE.halfW + bedW / 2), -0.09, MID);
      scene.add(bed);
    }

    // The capping between two lanes: walnut, with a cream strip along the top.
    const capW = PITCH - LANE.wallX * 2;
    const walnut = new THREE.MeshPhongMaterial({ color: hex(C.walnut), shininess: 60, specular: 0x554433 });
    const cream = new THREE.MeshPhongMaterial({ color: hex(C.cream), shininess: 40 });
    const capLen = -PIN_Z + 0.1;
    scene.add(
      copies(new THREE.BoxGeometry(capW, 0.1, capLen), walnut, caps.map((n) => (o) => o.position.set((n + 0.5) * PITCH, 0.01, -capLen / 2))),
      copies(new THREE.BoxGeometry(capW * 0.42, 0.012, capLen), cream, caps.map((n) => (o) => o.position.set((n + 0.5) * PITCH, 0.064, -capLen / 2))),
      // The posts between the openings the pins stand in.
      copies(new THREE.BoxGeometry(capW, MASK_Y + 0.02, PIN_Z - PIT_Z + 0.1), new THREE.MeshPhongMaterial({ color: 0x2f6f6b, shininess: 30 }),
        caps.map((n) => (o) => o.position.set((n + 0.5) * PITCH, MASK_Y / 2, (PIN_Z + 0.1 + PIT_Z) / 2))),
    );

    // The wall above the pins, the dark pit behind them, the ceiling and the side walls.
    const endWall = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, CEIL - MASK_Y), new THREE.MeshBasicMaterial({ map: endWallTexture(this.sign) }));
    endWall.position.set(0, (CEIL + MASK_Y) / 2, MASK_Z);
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, MASK_Y + 0.2), new THREE.MeshBasicMaterial({ map: pitTexture() }));
    pit.position.set(0, MASK_Y / 2, PIT_Z);
    const soffit = flat(HALL_W, MASK_Z - PIT_Z, new THREE.MeshBasicMaterial({ color: 0x1a120d, side: THREE.DoubleSide }));
    soffit.position.set(0, MASK_Y, (MASK_Z + PIT_Z) / 2);
    const depth = BACK_Z - PIT_Z;
    const ceiling = flat(HALL_W, depth, new THREE.MeshBasicMaterial({ map: ceilingTexture(), side: THREE.BackSide }));
    ceiling.position.set(0, CEIL, (BACK_Z + PIT_Z) / 2);
    scene.add(endWall, pit, soffit, ceiling);
    const sideMat = new THREE.MeshBasicMaterial({ map: sideWallTexture() });
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(depth, CEIL), sideMat);
      wall.rotation.y = -s * Math.PI / 2;
      wall.position.set(s * HALL_W / 2, CEIL / 2, (BACK_Z + PIT_Z) / 2);
      scene.add(wall);
    }

    // The approach, the foul line, and the carpet where the seats are.
    const approach = flat(HALL_W, APPROACH, new THREE.MeshPhongMaterial({ map: approachTexture(), shininess: 90, specular: 0x5a4c3c }));
    approach.position.set(0, -0.002, APPROACH / 2);
    const foul = flat(HALL_W, 0.035, new THREE.MeshBasicMaterial({ color: 0x3a2413 }));
    foul.position.set(0, 0.001, 0.02);
    const carpet = flat(HALL_W, BACK_Z - APPROACH, new THREE.MeshLambertMaterial({ map: carpetTexture() }));
    carpet.position.set(0, -0.002, (BACK_Z + APPROACH) / 2);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, CEIL), new THREE.MeshBasicMaterial({ map: backWallTexture() }));
    back.rotation.y = Math.PI;
    back.position.set(0, CEIL / 2, BACK_Z);
    scene.add(approach, foul, carpet, back);

    // The lanes next door, some of them part way through a frame.
    const r = rng(11);
    const bodies = [];
    for (const n of others) {
      const standing = r() > 0.55 ? 0.55 : 1;
      for (const p of pinLayout()) {
        if (r() > standing) continue;
        bodies.push([n * PITCH + p.x, Z(p.z)]);
      }
    }
    const bands = [];
    for (const [x, z] of bodies) for (const y of BAND_Y) bands.push((o) => { o.position.set(x, y * PIN_SCALE, z); o.scale.setScalar(PIN_SCALE); });
    scene.add(
      copies(PIN_BODY, PIN_WHITE, bodies.map(([x, z]) => (o) => { o.position.set(x, 0, z); o.scale.setScalar(PIN_SCALE); })),
      copies(PIN_BAND, PIN_RED, bands),
    );

    this.buildReturns(walnut, cream);

    this.ball = new THREE.Group();
    this.ball.add(new THREE.Mesh(
      new THREE.SphereGeometry(LANE.ballR, 32, 24),
      new THREE.MeshPhongMaterial({ map: ballTexture('#c93a2e', '#ffb09a', 5), shininess: 190, specular: 0xffffff, emissive: 0x220806 }),
    ));
    // Finger holes, so you can see the ball roll.
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x2a0a08 });
    for (const [x, y] of [[-0.03, 0.03], [0.03, 0.03], [0, -0.03]]) {
      const hole = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), holeMat);
      hole.position.set(x, y, LANE.ballR).setLength(LANE.ballR - 0.004);
      this.ball.add(hole);
    }
    this.reflected(this.ball);
    this.ballShadow = softShadow(LANE.ballR * 1.7, 0.5);
    scene.add(this.ballShadow);

    this.aimTex = aimTexture();
    this.aimLine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.11, 4.2),
      new THREE.MeshBasicMaterial({ map: this.aimTex, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.aimLine.rotation.x = -Math.PI / 2;
    this.aimLine.renderOrder = 3;
    scene.add(this.aimLine);

    this.pins = pinLayout().map(() => this.reflected(pinMesh()));
    this.pinShadows = this.pins.map(() => {
      const s = softShadow(0.11, 0.42);
      s.renderOrder = 3;
      scene.add(s);
      return s;
    });
    if (this.cast) this.buildCast();
  }

  // A ball return on every other capping: a low walnut cabinet, a cream hood and a few house balls.
  buildReturns(walnut, cream) {
    const ballGeo = new THREE.SphereGeometry(LANE.ballR, 18, 12);
    const balls = [
      ballTexture('#e2a52e', '#fff0b8', 21), ballTexture('#1f7f86', '#a9ecec', 22), ballTexture('#6a3f8f', '#dcbcf2', 23),
    ].map((map) => new THREE.MeshPhongMaterial({ map, shininess: 160, specular: 0xffffff }));
    const hoodGeo = new THREE.SphereGeometry(0.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    for (const n of [-3, -1, 1]) {
      const x = (n + 0.5) * PITCH;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 1.5), walnut);
      base.position.set(x, 0.15, 1.35);
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 1.0), cream);
      tray.position.set(x, 0.31, 1.55);
      const hood = new THREE.Mesh(hoodGeo, cream);
      hood.scale.set(0.82, 0.8, 1.15);
      hood.position.set(x, 0.3, 0.82);
      this.scene.add(base, tray, hood);
      balls.forEach((m, i) => {
        if (n !== -1 && i === (n + 4) % 3) return;
        const b = new THREE.Mesh(ballGeo, m);
        b.position.set(x, 0.325 + LANE.ballR, 1.28 + i * 0.26);
        b.rotation.set(i, n, 0.4);
        this.scene.add(b);
      });
    }
  }

  // The bowler, the seats behind the approach, and the robots in them.
  buildCast() {
    const seat = new THREE.MeshPhongMaterial({ color: hex(C.coral), shininess: 40 });
    const frame = new THREE.MeshPhongMaterial({ color: hex(C.cream), shininess: 30 });
    const rows = [[5.7, 0.3], [6.7, 0.52]];
    for (const [z, y] of rows) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.1, 0.62), seat);
      bench.position.set(0, y - 0.05, z);
      const rest = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.42, 0.1), seat);
      rest.position.set(0, y + 0.2, z + 0.34);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(5.5, y - 0.1, 0.7), frame);
      plinth.position.set(0, (y - 0.1) / 2, z + 0.02);
      this.scene.add(bench, rest, plinth);
    }

    this.bowler = new Bowler();
    this.scene.add(this.bowler.group);

    // Yaw 0 faces the seats, so the audience is turned round to face the pins.
    const spots = [];
    [-2.1, -1.2, 0.5, 1.5].forEach((x) => spots.push([x, rows[0][1], rows[0][0], Math.PI, 1.5]));
    [-1.7, -0.3, 0.9, 2.2].forEach((x) => spots.push([x, rows[1][1], rows[1][0], Math.PI, 1.5]));
    // Two regulars standing by the next lane, and the attendant by the ball return.
    spots.push([-2.5, 0, 2.3, 2.5, 1.45], [-3.05, 0, 2.75, 2.4, 1.3]);
    spots.push([2.15, 0, 0.25, -2.0, 1.35, true]);
    this.crowd = new Crowd(this.scene, spots);
  }

  // 'back' while the button is held, 'forward' once it is released, 'idle' otherwise.
  setSwing(state) {
    this.swing = state;
    if (state !== 'back' && this.bowler) this.bowler.drive = null;
  }

  // Where the real controller says the bowling arm is: 0 hangs straight down, positive is towards the pins.
  setArm(angle) {
    if (this.bowler && this.swing === 'back') this.bowler.drive = angle;
  }

  // Tells the lane that a panel is covering its right-hand side.
  setPanel(on) { this.panel = Boolean(on); }

  // Shows the bowler and the robots reacting. `kind` is 'strike', 'miss' or 'gutter'.
  react(kind) {
    if (!this.cast) return;
    this.reaction = kind;
    this.cut = true;
    // Most of the pins is still a good throw, and the bowler knows it.
    const down = this.world ? this.world.pins.filter((p) => p.down || p.gone).length : 0;
    const good = kind === 'miss' && down >= 7;
    this.bowler.set(kind === 'strike' ? 'cheer' : kind === 'gutter' ? 'slump' : good ? 'nice' : 'sad');
    this.crowd.setMood(kind === 'strike' || (good && down >= 9) ? 'cheer' : good ? 'idle' : 'sad');
  }

  // Where robot `i`'s head is in the lane element, in pixels. Null when it is out of view.
  headOnScreen(i) {
    const r = this.crowd && this.crowd.bots[i];
    if (!r) return null;
    const v = this.headPoint || (this.headPoint = new THREE.Vector3());
    r.head.localToWorld(v.set(0, 0.24, 0)).project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 0.92 || v.y > 0.8 || v.y < -0.9) return null;
    return { x: (v.x * 0.5 + 0.5) * this.container.clientWidth, y: (-v.y * 0.5 + 0.5) * this.container.clientHeight };
  }

  // Stop drawing while the challenge is closed.
  setActive(on) {
    this.active = on;
    if (on) { this.last = performance.now(); this.cut = true; this.resize(); }
  }

  // Speed of the ball while it is rolling on the lane, for the rumble sound.
  rollSpeed() {
    if (!this.world || this.world.ball.gone) return 0;
    const b = this.world.ball;
    return Math.hypot(b.vx, b.vz);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // A tall, narrow window needs a wider view to keep the whole lane in.
    this.wide = w / h < 0.9 ? 1.5 : w / h < 1.3 ? 1.2 : 1;
    this.camera.updateProjectionMatrix();
  }

  resetPins() {
    pinLayout().forEach((p, i) => {
      const m = this.pins[i];
      m.visible = true;
      m.position.set(p.x, 0, Z(p.z));
      m.rotation.set(0, 0, 0);
    });
  }

  // Put the ball back at the foul line, ready for the next throw.
  reset() {
    this.world = null;
    this.resetPins();
    this.swing = 'idle';
    this.cut = true;
    this.reaction = null;
    if (this.cast) { this.bowler.drive = null; this.bowler.set('address'); this.crowd.setMood('idle'); }
  }

  setAim(aim) {
    this.aim = Math.max(-1, Math.min(1, aim));
  }

  // Which of the ten pins are down right now, for the pin display.
  pinsDown() {
    if (!this.world) return null;
    return this.world.pins.map((p) => p.down || p.gone);
  }

  // Plays one throw. Resolves with { pins, strike, gutter } when the pins settle.
  play(throwParams) {
    this.world = createWorld(throwParams);
    this.acc = 0;
    this.hitSeen = false;
    this.swing = 'idle';
    if (this.cast) { this.bowler.drive = null; this.bowler.set('follow'); }
    return new Promise((resolve) => { this.onDone = resolve; });
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    if (!this.active) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;

    // Drop the resolution if this machine cannot keep up.
    if (dt > 0.03) this.slow += dt; else this.slow = Math.max(0, this.slow - dt * 0.5);
    if (this.slow > 1.5 && this.pixelRatio > 0.75) {
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.slow = 0;
    }

    const w = this.world;
    if (w) {
      // The last metre before the pins and the first moment of the crash run slower, for suspense.
      const near = !w.ball.gutter && w.ball.z > LANE.pinZ - 1.3 && (w.hitTime == null || w.time - w.hitTime < 0.4);
      this.acc += dt * (near ? 0.5 : 1);
      const h = 1 / 120;
      while (this.acc >= h && !w.done) {
        step(w, h);
        this.acc -= h;
      }
      const b = w.ball;
      // The first pin hit shakes the camera.
      if (!this.hitSeen && w.hitTime != null && !b.gutter) {
        this.hitSeen = true;
        this.shake = 0.04 + 0.005 * Math.hypot(b.vx, b.vz);
        if (this.onHit) this.onHit(Math.hypot(b.vx, b.vz));
      }
      // A short hop off the hand at the start of the roll.
      const hop = Math.max(0, 0.05 - Math.abs(w.time - 0.12) * 0.42);
      this.ball.visible = !b.gone;
      this.ball.position.set(b.x, (b.gutter ? LANE.ballR - 0.07 : LANE.ballR) + hop, Z(b.z));
      this.ball.rotation.x -= (b.vz * dt * K) / LANE.ballR;
      this.ball.rotation.z -= (b.vx * dt) / LANE.ballR;
      w.pins.forEach((p, i) => {
        const m = this.pins[i];
        m.visible = !p.gone;
        m.position.x = p.x;
        m.position.z = Z(p.z);
        if (p.down) {
          const tilt = Math.min(Math.PI / 2, p.fallT * 7);
          // Tip over the way the pin was pushed, jump off the deck, and keep spinning as it slides.
          m.rotation.set(0, 0, 0);
          m.rotateY(Math.atan2(p.dirX, -p.dirZ) + p.spin * Math.min(p.fallT, 1.2));
          m.rotateX(-tilt);
          const jump = Math.max(0, p.pop * p.fallT - 4.9 * p.fallT * p.fallT);
          m.position.y = Math.sin(tilt) * 0.06 + jump;
        }
      });
      if (w.done && this.onDone) {
        const done = this.onDone;
        this.onDone = null;
        done(result(w));
      }
    } else {
      this.aimShown += (this.aim - this.aimShown) * Math.min(1, dt * 14);
      // The waiting ball bobs a little, so the lane never looks frozen.
      this.ball.visible = true;
      this.ball.position.set(this.aimShown * 0.36, LANE.ballR + 0.012 + Math.sin(this.clock * 2.6) * 0.012, 0);
      this.ball.rotation.set(0, this.clock * 0.6, 0);
    }
    if (this.cast) this.frameCast(dt);
    this.frameView();

    const bp = this.ball.position;
    this.ballShadow.visible = this.ball.visible && !(w && w.ball.gutter);
    this.ballShadow.position.set(bp.x, 0.007, bp.z);
    this.ballShadow.scale.setScalar(Math.max(0.45, 1 - (bp.y - LANE.ballR) * 0.9));
    this.pins.forEach((m, i) => {
      const s = this.pinShadows[i];
      s.visible = m.visible;
      s.position.set(m.position.x, 0.005, m.position.z);
    });

    this.aimLine.visible = !w && this.swing !== 'forward';
    if (!w) {
      const mid = 2.5;
      const drift = (this.aimShown * 0.022) / K;
      this.aimLine.position.set(this.aimShown * 0.36 + drift * mid, 0.006, -mid);
      this.aimLine.rotation.z = -drift;
      this.aimTex.offset.y = -(this.clock * 0.8) % 1;
      this.aimLine.material.opacity = 0.42 + 0.14 * Math.sin(this.clock * 4);
    }

    for (const [obj, twin] of this.twins) {
      twin.visible = obj.visible;
      twin.position.copy(obj.position);
      twin.quaternion.copy(obj.quaternion);
    }

    const cam = this.camera.position;
    const v = this.view;
    const k = this.cut ? 1 : Math.min(1, dt * (v.rate || 5));
    this.shake = Math.max(0, this.shake - dt * 0.2);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    cam.x += (v.x - cam.x) * k;
    cam.y += (v.y - cam.y) * k;
    cam.z += (v.z - cam.z) * k;
    this.look.x += (v.lx - this.look.x) * k;
    this.look.y += (v.ly - this.look.y) * k;
    this.look.z += (v.lz - this.look.z) * k;
    this.fov += (v.fov * this.wide - this.fov) * k;
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.look.x + sx, this.look.y + sy, this.look.z);
    this.cut = false;
    this.renderer.render(this.scene, this.camera);
  }

  // Where the camera wants to be: behind the bowler, chasing the ball, watching the pins, or on the bowler's face.
  frameView() {
    const v = this.view;
    const w = this.world;
    const ballX = this.aimShown * 0.36;
    v.rate = 5;
    if (this.reaction && this.cast) {
      // Looking back up the lane at the bowler and the seats.
      const bx = this.bowler.group.position.x;
      // When the report covers the right of the lane, the bowler is framed in what is left.
      const aside = this.panel && this.wide === 1 ? 0.68 : 0;
      v.x = bx + 0.75 - aside; v.y = 0.92; v.z = STAND - 2.5;
      v.lx = bx + 0.05 - aside; v.ly = 0.64; v.lz = STAND;
      v.fov = 32;
    } else if (w) {
      const b = w.ball;
      const bz = Z(Math.min(b.z, LANE.pinZ + 0.6));
      // Chase the ball, low down. Stop short of the pins and creep in while they fall.
      const since = w.hitTime == null ? 0 : w.time - w.hitTime;
      const stop = PIN_Z + 3.3 - Math.min(0.7, since * 0.5);
      const cz = Math.max(stop, bz + 2.3);
      const close = Math.min(1, Math.max(0, (2.6 - cz) / 3));
      // Pass the bowler on the right, then settle in behind the ball.
      const beside = this.cast ? 0.8 * Math.min(1, Math.max(0, (cz + 1.6) / 1.4)) : 0;
      v.x = b.x * 0.55 + beside; v.y = 1.15 - 0.5 * close; v.z = cz;
      v.lx = b.x * 0.6 + beside * 0.35; v.ly = 0.2 + 0.05 * close; v.lz = Math.max(PIN_Z, cz - 5.5);
      v.fov = 34 - 2 * close;
      v.rate = 4.2;
    } else if (this.cast) {
      // Behind the bowler's right shoulder. The bowler stands left of the frame and the lane stays clear.
      v.x = ballX * 0.55 + 0.95; v.y = 1.62; v.z = 5.2;
      v.lx = ballX * 0.4 + 0.1; v.ly = 0.55; v.lz = -7;
      v.fov = 28;
    } else {
      v.x = ballX * 0.5; v.y = 1.05; v.z = 2.9;
      v.lx = ballX * 0.4; v.ly = 0.3; v.lz = -7;
      v.fov = 30;
    }
  }

  // The bowler and the robots.
  frameCast(dt) {
    const bw = this.bowler;
    const w = this.world;
    const ballX = this.aimShown * 0.36;
    if (!w) {
      bw.set(this.swing === 'back' ? 'back' : this.swing === 'forward' ? 'forward' : 'address');
      bw.group.position.x = ballX - 0.2;
    } else if (!this.reaction && bw.state === 'follow' && bw.t > 0.9) {
      bw.set('watch');
    }
    bw.sway = w ? Math.max(-1, Math.min(1, (w.ball.x - (bw.group.position.x + 0.2)) * 2.2)) : 0;
    bw.group.position.z = STAND;
    bw.update(dt, this.clock);
    if (!w) {
      // The ball rides in the bowling hand until the throw starts.
      bw.group.updateMatrixWorld(true);
      bw.grip.getWorldPosition(this.hand);
      this.ball.position.set(this.hand.x, Math.max(LANE.ballR, this.hand.y - 0.02), this.hand.z - 0.03);
      this.ball.rotation.set(0.4, 0, 0);
    }
    const bp = this.ball.position;
    const rolling = w && !this.reaction;
    if (rolling) this.crowd.setMood(w.hitTime == null && w.ball.z > LANE.pinZ * 0.5 ? 'tense' : 'idle');
    const bx = bw.group.position.x;
    if (rolling && !w.ball.gone) this.crowd.update(dt, this.clock, bp);
    else this.crowd.update(dt, this.clock, { x: rolling ? 0 : bx, z: rolling ? PIN_Z : STAND });
  }
}
