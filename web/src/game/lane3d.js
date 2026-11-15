// Draws the bowling hall with Three.js and plays a throw from the physics simulation.
import * as THREE from 'three';
import { LANE, createWorld, step, result, pinLayout } from './physics.js';
import { BRAND } from '../brand.js';

const SKY = 0xcdeaf8;
const BALL = 0x16a06c;

// Lane z runs away from the player. Three.js looks down negative z, so flip it.
const Z = (z) => -z;
const LEN = LANE.deckEnd + 1.2;
const MID = Z(LEN / 2 - 1.2);
// Distance from one lane's centre to the next.
const PITCH = LANE.wallX * 2 + 0.5;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function laneTexture() {
  return canvasTexture(256, 2048, (g, w, h) => {
    g.fillStyle = '#ecd09a';
    g.fillRect(0, 0, w, h);
    // Boards run the length of the lane.
    for (let i = 0; i < 20; i++) {
      g.fillStyle = i % 2 ? 'rgba(150,100,40,0.10)' : 'rgba(255,250,225,0.16)';
      g.fillRect((i * w) / 20, 0, w / 20 - 1, h);
    }
    // Aiming arrows and the dots near the foul line.
    g.fillStyle = 'rgba(90,50,15,0.6)';
    for (let i = -3; i <= 3; i++) {
      const x = w / 2 + i * 30;
      const y = h - 520 + Math.abs(i) * 34;
      g.beginPath();
      g.moveTo(x, y - 26);
      g.lineTo(x + 7, y);
      g.lineTo(x - 7, y);
      g.fill();
      g.beginPath();
      g.arc(x, h - 150, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#2a2a2a';
    g.fillRect(0, h - 14, w, 5);
  });
}

function signTexture() {
  return canvasTexture(1024, 256, (g, w, h) => {
    g.fillStyle = '#0f3d2e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d9ad5b';
    g.lineWidth = 8;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#f4efe4';
    g.textAlign = 'center';
    g.font = '600 112px Georgia, "Times New Roman", serif';
    // The last argument squeezes a long name to fit the sign.
    g.fillText(BRAND.name.toUpperCase(), w / 2, 138, w - 90);
    g.fillStyle = '#d9ad5b';
    g.font = '34px Georgia, serif';
    g.fillText(BRAND.tagline.toUpperCase(), w / 2, 204, w - 90);
  });
}

// Chevrons that scroll down the lane to show where the ball will go.
function aimTexture() {
  const t = canvasTexture(64, 128, (g, w) => {
    g.strokeStyle = '#ffffff';
    g.lineWidth = 12;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const y of [50, 114]) {
      g.beginPath();
      g.moveTo(10, y);
      g.lineTo(w / 2, y - 34);
      g.lineTo(w - 10, y);
      g.stroke();
    }
  });
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 5);
  return t;
}

const PIN_BODY = new THREE.LatheGeometry(
  // Outline of half a pin, spun around its axis.
  [
    [0.0, 0.0], [0.028, 0.0], [0.045, 0.05], [0.06, 0.115], [0.055, 0.18],
    [0.032, 0.25], [0.023, 0.29], [0.03, 0.335], [0.03, 0.36], [0.018, 0.378], [0.0, 0.381],
  ].map(([x, y]) => new THREE.Vector2(x, y)),
  16,
);
const PIN_BAND = new THREE.CylinderGeometry(0.0265, 0.0245, 0.022, 16, 1, true);
const PIN_WHITE = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 110, specular: 0x999999 });
const PIN_RED = new THREE.MeshBasicMaterial({ color: 0xe0352b });

function pinMesh() {
  const band = new THREE.Mesh(PIN_BAND, PIN_RED);
  band.position.y = 0.288;
  const group = new THREE.Group();
  group.add(new THREE.Mesh(PIN_BODY, PIN_WHITE), band);
  return group;
}

export class Lane {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(this.pixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 15, 34);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 70);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xbfd9e8, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-2, 6, 4);
    this.scene.add(sun);

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
    const wood = laneTexture();
    const laneGeo = new THREE.PlaneGeometry(LANE.halfW * 2, LEN);
    // Slightly see-through, so the reflection under it shows.
    const lane = new THREE.Mesh(laneGeo, new THREE.MeshPhongMaterial({
      map: wood, shininess: 140, specular: 0x777777, transparent: true, opacity: 0.8,
    }));
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0, MID);
    lane.renderOrder = 2;
    this.scene.add(lane);
    const under = new THREE.Mesh(laneGeo, new THREE.MeshBasicMaterial({ color: 0xe2c48c }));
    under.rotation.x = -Math.PI / 2;
    under.position.set(0, -0.45, MID);
    this.scene.add(under);

    const gutterMat = new THREE.MeshPhongMaterial({ color: 0x8fa9b8, shininess: 60 });
    const railMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 90 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0x2f8fd8 });
    const sideLane = new THREE.MeshPhongMaterial({ map: wood, shininess: 120, specular: 0x666666 });
    for (const s of [-1, 1]) {
      const gutter = new THREE.Mesh(new THREE.BoxGeometry(LANE.gutterW, 0.04, LEN), gutterMat);
      gutter.position.set(s * (LANE.halfW + LANE.gutterW / 2), -0.06, MID);
      // The ball return rail between two lanes, white with a blue stripe.
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, LEN), railMat);
      rail.position.set(s * (LANE.wallX + 0.25), 0.02, MID);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.165, LEN), stripeMat);
      stripe.position.set(s * (LANE.wallX + 0.25), 0.021, MID);
      this.scene.add(gutter, rail, stripe);

      // The lanes next door, with their own pins, so the hall feels like a hall.
      for (const n of [1, 2]) {
        const x = s * PITCH * n;
        const other = new THREE.Mesh(laneGeo, sideLane);
        other.rotation.x = -Math.PI / 2;
        other.position.set(x, 0, MID);
        const g1 = new THREE.Mesh(new THREE.BoxGeometry(LANE.gutterW, 0.04, LEN), gutterMat);
        g1.position.set(x - LANE.halfW - LANE.gutterW / 2, -0.06, MID);
        const g2 = g1.clone();
        g2.position.x = x + LANE.halfW + LANE.gutterW / 2;
        const r2 = rail.clone();
        r2.position.x = x + s * (LANE.wallX + 0.25);
        const s2 = stripe.clone();
        s2.position.x = r2.position.x;
        this.scene.add(other, g1, g2, r2, s2);
        for (const p of pinLayout()) {
          const m = pinMesh();
          m.position.set(x + p.x, 0, Z(p.z));
          this.scene.add(m);
        }
      }
    }

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 60), new THREE.MeshLambertMaterial({ color: 0xdfeef6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.5, Z(12));
    this.scene.add(floor);

    // The wall above the pins, across every lane, and the dark pit behind them.
    const wallZ = Z(LANE.deckEnd + 0.5);
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(30, 0.9), new THREE.MeshBasicMaterial({ color: 0x16283a }));
    pit.position.set(0, 0.25, wallZ);
    const mask = new THREE.Mesh(new THREE.PlaneGeometry(30, 1.5), new THREE.MeshLambertMaterial({ color: 0x2f8fd8 }));
    mask.position.set(0, 1.45, wallZ + 0.02);
    const trim = new THREE.Mesh(new THREE.PlaneGeometry(30, 0.08), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    trim.position.set(0, 0.72, wallZ + 0.03);
    const upper = new THREE.Mesh(new THREE.PlaneGeometry(30, 6), new THREE.MeshLambertMaterial({ color: 0xeaf5fb }));
    upper.position.set(0, 5.2, wallZ);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshBasicMaterial({ map: signTexture() }));
    sign.position.set(0, 1.42, wallZ + 0.05);
    this.scene.add(pit, mask, trim, upper, sign);

    this.ball = new THREE.Group();
    this.ball.add(new THREE.Mesh(
      new THREE.SphereGeometry(LANE.ballR, 32, 24),
      new THREE.MeshPhongMaterial({ color: BALL, shininess: 160, specular: 0xffffff }),
    ));
    // Finger holes, so you can see the ball roll.
    for (const [x, y] of [[-0.03, 0.03], [0.03, 0.03], [0, -0.025]]) {
      const hole = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), new THREE.MeshBasicMaterial({ color: 0x06261a }));
      hole.position.set(x, y, LANE.ballR).setLength(LANE.ballR - 0.003);
      this.ball.add(hole);
    }
    this.reflected(this.ball);

    this.aimTex = aimTexture();
    this.aimLine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 3.4),
      new THREE.MeshBasicMaterial({ map: this.aimTex, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.aimLine.rotation.x = -Math.PI / 2;
    this.aimLine.renderOrder = 3;
    this.scene.add(this.aimLine);

    this.pins = pinLayout().map(() => this.reflected(pinMesh()));
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // A tall, narrow window needs a wider view to keep the whole lane in.
    this.camera.fov = w / h < 0.9 ? 52 : 38;
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
    return new Promise((resolve) => { this.onDone = resolve; });
  }

  frame(now) {
    requestAnimationFrame(this.frame);
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

    let camZ = -3.3;
    let camY = 1.45;
    if (this.world) {
      this.acc += dt;
      const h = 1 / 120;
      while (this.acc >= h && !this.world.done) {
        step(this.world, h);
        this.acc -= h;
      }
      const b = this.world.ball;
      // The first pin hit shakes the camera.
      if (!this.hitSeen && this.world.hitTime != null && !b.gutter) {
        this.hitSeen = true;
        this.shake = 0.05 + 0.006 * Math.hypot(b.vx, b.vz);
      }
      // A short hop off the hand at the start of the roll.
      const hop = Math.max(0, 0.05 - Math.abs(this.world.time - 0.12) * 0.42);
      this.ball.visible = !b.gone;
      this.ball.position.set(b.x, (b.gutter ? LANE.ballR - 0.07 : LANE.ballR) + hop, Z(b.z));
      this.ball.rotation.x -= (b.vz * dt) / LANE.ballR;
      this.ball.rotation.z -= (b.vx * dt) / LANE.ballR;
      this.world.pins.forEach((p, i) => {
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
          m.position.y = Math.sin(tilt) * 0.055 + jump;
        }
      });
      camZ = Math.min(LANE.pinZ - 4.6, Math.max(-3.3, b.gone ? LANE.pinZ - 4.6 : b.z - 3.4));
      camY = 1.45 - 0.4 * Math.min(1, Math.max(0, camZ + 3.3) / 6);
      if (this.world.done && this.onDone) {
        const done = this.onDone;
        this.onDone = null;
        done(result(this.world));
      }
    } else {
      this.aimShown += (this.aim - this.aimShown) * Math.min(1, dt * 14);
      const x = this.aimShown * 0.36;
      // The waiting ball bobs a little, so the lane never looks frozen.
      this.ball.visible = true;
      this.ball.position.set(x, LANE.ballR + 0.012 + Math.sin(this.clock * 2.6) * 0.012, Z(0));
      this.ball.rotation.set(0, this.clock * 0.6, 0);
    }

    this.aimLine.visible = !this.world;
    if (!this.world) {
      this.aimLine.position.set(this.aimShown * 0.36 + this.aimShown * 0.022 * 2, 0.006, Z(2));
      this.aimLine.rotation.z = -this.aimShown * 0.022;
      this.aimTex.offset.y = -(this.clock * 0.9) % 1;
      this.aimLine.material.opacity = 0.65 + 0.25 * Math.sin(this.clock * 4);
    }

    for (const [obj, twin] of this.twins) {
      twin.visible = obj.visible;
      twin.position.copy(obj.position);
      twin.quaternion.copy(obj.quaternion);
    }

    const cam = this.camera.position;
    const k = Math.min(1, dt * 5);
    cam.x += (0 - cam.x) * k;
    cam.y += (camY - cam.y) * k;
    cam.z += (Z(camZ) - cam.z) * k;
    this.shake = Math.max(0, this.shake - dt * 0.22);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    this.camera.lookAt(sx, 0.2 + sy, cam.z - 7);
    this.renderer.render(this.scene, this.camera);
  }
}
