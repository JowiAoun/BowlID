// Draws the bowling hall with Three.js and plays a throw from the physics simulation.
import * as THREE from 'three';
import { LANE, createWorld, step, result, pinLayout } from './physics.js';
import { BRAND } from '../brand.js';
import { Bowler } from './bowler.js';
import { Crowd } from './crowd.js';

const SKY = 0xcdeaf8;
const WARM = 0xfff1d6;
const BALL = 0x16a06c;
// Where the bowler stands, behind the foul line.
const STAND_Z = -0.32;

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

function signTexture(sign) {
  return canvasTexture(1024, 256, (g, w, h) => {
    if (sign) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = sign.color;
      g.fillRect(12, 12, w - 24, h - 24);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.font = '700 118px "Fredoka Variable", "Trebuchet MS", Arial, sans-serif';
      g.fillText(sign.name, w / 2, 140, w - 90);
      g.font = '600 36px "Fredoka Variable", "Trebuchet MS", Arial, sans-serif';
      g.fillText(sign.tagline, w / 2, 206, w - 90);
      return;
    }
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
  // `cast` adds the bowler, the robots and the third-person camera. `sign` is { name, tagline, color }.
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
    this.onHit = null;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(this.pixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const sky = cast ? WARM : SKY;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, 15, 34);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 70);

    this.scene.add(new THREE.HemisphereLight(0xffffff, cast ? 0xf2d9b0 : 0xbfd9e8, 1.9));
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

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 60), new THREE.MeshLambertMaterial({ color: this.cast ? 0xf3e2c4 : 0xdfeef6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.5, Z(12));
    this.scene.add(floor);

    // The wall above the pins, across every lane, and the dark pit behind them.
    const wallZ = Z(LANE.deckEnd + 0.5);
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(30, 0.9), new THREE.MeshBasicMaterial({ color: 0x16283a }));
    pit.position.set(0, 0.25, wallZ);
    const maskH = this.cast ? 2.7 : 1.5;
    const mask = new THREE.Mesh(new THREE.PlaneGeometry(30, maskH), new THREE.MeshLambertMaterial({ color: 0x2f8fd8 }));
    mask.position.set(0, 0.7 + maskH / 2, wallZ + 0.02);
    const trim = new THREE.Mesh(new THREE.PlaneGeometry(30, 0.08), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    trim.position.set(0, 0.72, wallZ + 0.03);
    const upper = new THREE.Mesh(new THREE.PlaneGeometry(30, 6), new THREE.MeshLambertMaterial({ color: this.cast ? 0xfff6e6 : 0xeaf5fb }));
    upper.position.set(0, 5.2, wallZ);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(this.cast ? 4.4 : 2.2, this.cast ? 1.1 : 0.55), new THREE.MeshBasicMaterial({ map: signTexture(this.sign) }));
    sign.position.set(0, this.cast ? 1.72 : 1.42, wallZ + 0.05);
    this.scene.add(pit, mask, trim, upper, sign);

    this.ball = new THREE.Group();
    this.ball.add(new THREE.Mesh(
      new THREE.SphereGeometry(LANE.ballR, 32, 24),
      new THREE.MeshPhongMaterial({ color: this.cast ? 0x2f6fe0 : BALL, shininess: 160, specular: 0xffffff }),
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
      new THREE.PlaneGeometry(0.16, this.cast ? 6 : 3.4),
      new THREE.MeshBasicMaterial({ map: this.aimTex, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.aimLine.rotation.x = -Math.PI / 2;
    this.aimLine.renderOrder = 3;
    this.scene.add(this.aimLine);

    this.pins = pinLayout().map(() => this.reflected(pinMesh()));
    if (this.cast) this.buildCast();
  }

  // The approach, the bowler, the robots and the wall behind them.
  buildCast() {
    const approach = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshPhongMaterial({ color: 0xf1d6a2, shininess: 50 }));
    approach.rotation.x = -Math.PI / 2;
    approach.position.set(0, -0.003, Z(-3.5));
    const foul = new THREE.Mesh(new THREE.PlaneGeometry(14, 0.05), new THREE.MeshBasicMaterial({ color: 0x8a5a2b }));
    foul.rotation.x = -Math.PI / 2;
    foul.position.set(0, -0.002, Z(-0.02));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), new THREE.MeshBasicMaterial({ color: 0xfff1d6, side: THREE.DoubleSide }));
    back.position.set(0, 2.5, Z(-7));
    const band = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.5), new THREE.MeshBasicMaterial({ color: 0x4a8ff0, side: THREE.DoubleSide }));
    band.position.set(0, 1.9, Z(-6.98));
    this.scene.add(approach, foul, back, band);

    // Two rows of seats behind the approach.
    const seatMat = new THREE.MeshPhongMaterial({ color: 0x4a8ff0, shininess: 40 });
    for (const [z, y] of [[-4.9, 0.25], [-5.9, 0.55]]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(6.4, y, 0.8), seatMat);
      bench.position.set(0, y / 2, Z(z));
      this.scene.add(bench);
    }
    // A rack of spare balls beside the approach.
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 1.0), new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 90 }));
    rack.position.set(-1.25, 0.15, Z(-1.3));
    this.scene.add(rack);
    [0xff6f59, 0xffd23f, 0x3ccf91].forEach((c, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(LANE.ballR, 20, 14), new THREE.MeshPhongMaterial({ color: c, shininess: 140, specular: 0xffffff }));
      b.position.set(-1.25, 0.3 + LANE.ballR * 0.8, Z(-1.3 - 0.3 + i * 0.3));
      this.scene.add(b);
    });

    this.bowler = new Bowler();
    this.scene.add(this.bowler.group);
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(LANE.ballR * 1.1, 16),
      new THREE.MeshBasicMaterial({ color: 0x3b2a14, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.renderOrder = 4;
    this.scene.add(this.ballShadow);

    const spots = [];
    const railX = LANE.wallX + 0.25;
    // Small robots perched on the rails beside the lane, facing it.
    for (let i = 0; i < 6; i++) {
      const z = 2.2 + i * 2.1;
      spots.push([-railX, 0.1, Z(z), Math.PI / 2, 0.85], [railX, 0.1, Z(z + 1), -Math.PI / 2, 0.85]);
    }
    // Bigger ones standing beside the approach.
    spots.push([1.5, 0, Z(-0.9), -2.3, 1.5], [2.1, 0, Z(-0.2), -2.2, 1.35], [-1.9, 0, Z(-0.3), 2.3, 1.4], [-2.5, 0, Z(-1.2), 2.2, 1.55]);
    // And the audience on the seats behind, facing down the lane.
    for (let i = 0; i < 7; i++) {
      spots.push([-2.7 + i * 0.9, 0.25, Z(-4.9), Math.PI, 1.5], [-2.25 + i * 0.9, 0.55, Z(-5.9), Math.PI, 1.5]);
    }
    this.crowd = new Crowd(this.scene, spots);
  }

  // 'back' while the button is held, 'forward' once it is released, 'idle' otherwise.
  setSwing(state) { this.swing = state; }

  // Shows the bowler and the robots reacting. `kind` is 'strike', 'miss' or 'gutter'.
  react(kind) {
    if (!this.cast) return;
    this.reaction = kind;
    this.cut = true;
    this.bowler.set(kind === 'strike' ? 'cheer' : 'sad');
    this.crowd.setMood(kind === 'strike' ? 'cheer' : 'sad');
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
    this.camera.fov = w / h < 0.9 ? 52 : this.cast ? 40 : 38;
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
    if (this.reaction) this.cut = true;
    this.reaction = null;
    if (this.cast) { this.bowler.set('address'); this.crowd.setMood('idle'); }
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
    if (this.cast) this.bowler.set('follow');
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

    let camZ = -3.3;
    let camY = 1.45;
    if (this.world) {
      // The last metre before the pins and the first moment of the crash run slower, for suspense.
      const w0 = this.world;
      const near = this.cast && !w0.ball.gutter && w0.ball.z > LANE.pinZ - 1.3 && (w0.hitTime == null || w0.time - w0.hitTime < 0.4);
      this.acc += dt * (near ? 0.5 : 1);
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
        if (this.onHit) this.onHit(Math.hypot(b.vx, b.vz));
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
    if (this.cast) this.frameCast(dt);

    this.aimLine.visible = !this.world;
    if (!this.world) {
      const mid = this.cast ? 3.4 : 2;
      this.aimLine.position.set(this.aimShown * 0.36 + this.aimShown * 0.022 * mid, 0.006, Z(mid));
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
    const k = this.cut ? 1 : Math.min(1, dt * 5);
    this.shake = Math.max(0, this.shake - dt * 0.22);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    if (this.cast) {
      const v = this.view;
      cam.x += (v.x - cam.x) * k;
      cam.y += (v.y - cam.y) * k;
      cam.z += (v.z - cam.z) * k;
      this.look.x += (v.lx - this.look.x) * k;
      this.look.y += (v.ly - this.look.y) * k;
      this.look.z += (v.lz - this.look.z) * k;
      this.camera.lookAt(this.look.x + sx, this.look.y + sy, this.look.z);
    } else {
      cam.x += (0 - cam.x) * k;
      cam.y += (camY - cam.y) * k;
      cam.z += (Z(camZ) - cam.z) * k;
      this.camera.lookAt(sx, 0.2 + sy, cam.z - 7);
    }
    this.cut = false;
    this.renderer.render(this.scene, this.camera);
  }

  // The bowler, the robots and the third-person camera.
  frameCast(dt) {
    const bw = this.bowler;
    const w = this.world;
    const ballX = this.aimShown * 0.36;
    if (!w) {
      bw.set(this.swing === 'back' ? 'back' : this.swing === 'forward' ? 'forward' : 'address');
      bw.group.position.x = ballX - 0.2;
    } else if (!this.reaction && bw.state === 'follow' && bw.t > 1) {
      bw.set('watch');
    }
    bw.group.position.z = Z(STAND_Z);
    bw.update(dt, this.clock);
    if (!w) {
      // The ball rides in the bowling hand until the throw starts.
      bw.group.updateMatrixWorld(true);
      bw.grip.getWorldPosition(this.hand);
      this.ball.position.set(this.hand.x, Math.max(LANE.ballR, this.hand.y - 0.02), this.hand.z - 0.03);
      this.ball.rotation.set(0.4, 0, 0);
    }
    const bp = this.ball.position;
    this.ballShadow.visible = this.ball.visible && !(w && w.ball.gutter);
    this.ballShadow.position.set(bp.x, 0.008, bp.z);
    this.ballShadow.scale.setScalar(Math.max(0.4, 1 - (bp.y - LANE.ballR) * 1.2));

    const rolling = w && !this.reaction;
    if (rolling) this.crowd.setMood(w.hitTime == null && w.ball.z > 7 ? 'tense' : 'idle');
    const bx = bw.group.position.x;
    if (rolling && !w.ball.gone) this.crowd.update(dt, this.clock, bp);
    else this.crowd.update(dt, this.clock, { x: rolling ? 0 : bx, z: rolling ? Z(LANE.pinZ) : Z(STAND_Z) });

    const v = this.view || (this.view = {});
    if (this.reaction) {
      // Looking back up the lane at the bowler and the seats.
      v.x = bx + 0.7; v.y = 0.95; v.z = Z(STAND_Z + 2.4);
      v.lx = bx; v.ly = 0.66; v.lz = Z(STAND_Z);
    } else if (w) {
      const b = w.ball;
      const stop = LANE.pinZ - 4.2;
      const cz = b.gone ? stop : Math.min(stop, Math.max(-3.9, b.z - 2.9));
      const low = Math.min(1, Math.max(0, (cz + 1.5) / 3.5));
      v.x = b.x * 0.5; v.y = 1.78 - 0.86 * low; v.z = Z(cz);
      v.lx = b.x * 0.35; v.ly = -0.05 + 0.5 * low; v.lz = Z(cz + 7);
    } else {
      v.x = ballX * 0.6 + 0.12; v.y = 1.78; v.z = Z(-3.9);
      v.lx = ballX * 0.5; v.ly = -0.05; v.lz = Z(3.2);
    }
  }
}
