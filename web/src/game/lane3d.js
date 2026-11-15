// Draws the lane with Three.js and plays a throw from the physics simulation.
import * as THREE from 'three';
import { LANE, createWorld, step, result, pinLayout } from './physics.js';

const WOOD = '#d9b77c';
const GREEN = 0x0f3d2e;
const BRASS = 0xb8893b;

// Lane z runs away from the player. Three.js looks down negative z, so flip it.
const Z = (z) => -z;

function laneTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 2048;
  const g = c.getContext('2d');
  g.fillStyle = WOOD;
  g.fillRect(0, 0, c.width, c.height);
  // Boards run the length of the lane.
  for (let i = 0; i < 20; i++) {
    g.fillStyle = i % 2 ? 'rgba(120,80,30,0.10)' : 'rgba(255,240,200,0.10)';
    g.fillRect((i * c.width) / 20, 0, c.width / 20 - 1, c.height);
  }
  // Aiming arrows, about a third of the way down.
  g.fillStyle = 'rgba(60,35,10,0.55)';
  for (let i = -3; i <= 3; i++) {
    const x = c.width / 2 + i * 30;
    const y = c.height - 520 + Math.abs(i) * 34;
    g.beginPath();
    g.moveTo(x, y - 26);
    g.lineTo(x + 7, y);
    g.lineTo(x - 7, y);
    g.fill();
  }
  // Foul line.
  g.fillStyle = '#1b1b1b';
  g.fillRect(0, c.height - 14, c.width, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0f3d2e';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#b8893b';
  g.lineWidth = 6;
  g.strokeRect(14, 14, c.width - 28, c.height - 28);
  g.fillStyle = '#f4efe4';
  g.textAlign = 'center';
  g.font = '600 112px Georgia, "Times New Roman", serif';
  g.fillText('BOWLBANK', c.width / 2, 138);
  g.fillStyle = '#b8893b';
  g.font = '34px Georgia, serif';
  g.fillText('YOUR MONEY. YOUR SWING.', c.width / 2, 204);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pinMesh() {
  // Outline of half a pin, spun around its axis.
  const pts = [
    [0.0, 0.0], [0.028, 0.0], [0.045, 0.05], [0.06, 0.115], [0.055, 0.18],
    [0.032, 0.25], [0.023, 0.29], [0.03, 0.335], [0.03, 0.36], [0.018, 0.378], [0.0, 0.381],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 14),
    new THREE.MeshPhongMaterial({ color: 0xf7f3ea, shininess: 70 }),
  );
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0265, 0.0245, 0.022, 14, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xb3261e }),
  );
  band.position.y = 0.288;
  const group = new THREE.Group();
  group.add(body, band);
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
    this.scene.background = new THREE.Color(0x0b2a20);
    this.scene.fog = new THREE.Fog(0x0b2a20, 14, 26);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    sun.position.set(1.5, 5, 3);
    this.scene.add(sun);
    const pinLight = new THREE.PointLight(0xfff1d6, 14, 7);
    pinLight.position.set(0, 2.2, Z(LANE.pinZ - 0.8));
    this.scene.add(pinLight);

    this.build();
    this.world = null;
    this.onDone = null;
    this.aim = 0;
    this.aimShown = 0;
    this.idle = true;
    this.slow = 0;
    this.last = performance.now();
    this.acc = 0;

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    new ResizeObserver(this.resize).observe(container);
    this.resize();
    this.resetPins();
    requestAnimationFrame(this.frame);
  }

  build() {
    const len = LANE.deckEnd + 1.2;
    const lane = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE.halfW * 2, len),
      new THREE.MeshPhongMaterial({ map: laneTexture(), shininess: 90, specular: 0x554433 }),
    );
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0, Z(len / 2 - 1.2));
    this.scene.add(lane);

    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1f1d });
    const side = new THREE.MeshLambertMaterial({ color: 0x143a2d });
    for (const s of [-1, 1]) {
      const gutter = new THREE.Mesh(new THREE.BoxGeometry(LANE.gutterW, 0.04, len), dark);
      gutter.position.set(s * (LANE.halfW + LANE.gutterW / 2), -0.06, Z(len / 2 - 1.2));
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, len), side);
      wall.position.set(s * (LANE.wallX + 0.25), 0.1, Z(len / 2 - 1.2));
      this.scene.add(gutter, wall);
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 40), new THREE.MeshLambertMaterial({ color: 0x0d3024 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.09, Z(10));
    this.scene.add(floor);

    const back = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.4), new THREE.MeshLambertMaterial({ color: 0x08110e }));
    back.position.set(0, 1.0, Z(LANE.deckEnd + 0.5));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: signTexture() }));
    sign.position.set(0, 1.25, Z(LANE.deckEnd + 0.45));
    this.scene.add(back, sign);

    this.ball = new THREE.Group();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(LANE.ballR, 28, 20),
      new THREE.MeshPhongMaterial({ color: GREEN, shininess: 120, specular: 0x88aa99 }),
    );
    this.ball.add(sphere);
    // Finger holes, so you can see the ball roll.
    for (const [x, y] of [[-0.03, 0.03], [0.03, 0.03], [0, -0.025]]) {
      const hole = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), new THREE.MeshBasicMaterial({ color: 0x050505 }));
      hole.position.set(x, y, 0).add(new THREE.Vector3(0, 0, LANE.ballR)).setLength(LANE.ballR - 0.003);
      this.ball.add(hole);
    }
    this.scene.add(this.ball);

    this.aimLine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.035, 3.2),
      new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: 0.85 }),
    );
    this.aimLine.rotation.x = -Math.PI / 2;
    this.scene.add(this.aimLine);

    this.pins = pinLayout().map(() => {
      const p = pinMesh();
      this.scene.add(p);
      return p;
    });
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
    this.idle = true;
    this.resetPins();
  }

  setAim(aim) {
    this.aim = Math.max(-1, Math.min(1, aim));
  }

  // Plays one throw. Resolves with { pins, strike, gutter } when the pins settle.
  play(throwParams) {
    this.world = createWorld(throwParams);
    this.idle = false;
    this.acc = 0;
    return new Promise((resolve) => { this.onDone = resolve; });
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

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
      this.ball.visible = !b.gone;
      this.ball.position.set(b.x, b.gutter ? LANE.ballR - 0.07 : LANE.ballR, Z(b.z));
      this.ball.rotation.x -= (b.vz * dt) / LANE.ballR;
      this.ball.rotation.z -= (b.vx * dt) / LANE.ballR;
      this.world.pins.forEach((p, i) => {
        const m = this.pins[i];
        m.visible = !p.gone;
        m.position.x = p.x;
        m.position.z = Z(p.z);
        if (p.down) {
          const tilt = Math.min(Math.PI / 2, p.fallT * 7);
          // Tip over in the direction the pin was pushed, and keep spinning as it slides.
          m.rotation.set(0, 0, 0);
          m.rotateY(Math.atan2(p.dirX, -p.dirZ) + p.spin * Math.min(p.fallT, 1.2));
          m.rotateX(-tilt);
          m.position.y = Math.sin(tilt) * 0.055;
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
      this.ball.visible = true;
      this.ball.position.set(x, LANE.ballR, Z(0));
      this.ball.rotation.set(0, 0, 0);
    }
    this.aimLine.visible = !this.world;
    if (!this.world) {
      const x = this.aimShown * 0.36;
      this.aimLine.position.set(x + this.aimShown * 0.022 * 1.9, 0.004, Z(1.9));
      this.aimLine.rotation.z = -this.aimShown * 0.022;
    }

    const cam = this.camera.position;
    const k = Math.min(1, dt * 5);
    cam.x += (0 - cam.x) * k;
    cam.y += (camY - cam.y) * k;
    cam.z += (Z(camZ) - cam.z) * k;
    this.camera.lookAt(0, 0.2, cam.z - 7);
    this.renderer.render(this.scene, this.camera);
  }
}
