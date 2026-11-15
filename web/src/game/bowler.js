// The bowler: a small cartoon league bowler in a two-tone shirt, with a quiff.
// The lane tells it what state it is in and it eases between poses.
import * as THREE from 'three';

const mat = (color, shininess = 30) => new THREE.MeshPhongMaterial({ color, shininess });
const SKIN = mat(0xf6c49a, 18);
const TEAL = mat(0x1f8f8c, 22);
const CREAM = mat(0xfbf1dc, 22);
const PANTS = mat(0x343a52, 14);
const SHOE = mat(0xfbf1dc, 70);
const SHOE_TIP = mat(0xe8573f, 70);
const HAIR = mat(0x5a2f1c, 14);
const DARK = new THREE.MeshBasicMaterial({ color: 0x2a1d14 });
const WHITE = new THREE.MeshBasicMaterial({ color: 0xffffff });
const BLUSH = new THREE.MeshBasicMaterial({ color: 0xf59a86 });

const HIP_Y = 0.33;
const SHOULDER_Y = 0.3;
const ARM_LEN = 0.4;
const KEYS = ['armR', 'armL', 'spread', 'lean', 'crouch', 'nod', 'legL', 'legR'];

// One pose per state. Arm and leg swing are positive towards the pins.
const POSES = {
  address: { armR: 1.2, armL: 1.05, spread: 0.36, lean: -0.05, crouch: 0, nod: 0, legL: 0, legR: 0, rate: 8 },
  back: { armR: -1.75, armL: 0.55, spread: -0.9, lean: -0.36, crouch: 0.05, nod: 0.12, legL: 0.3, legR: -0.15, rate: 7 },
  forward: { armR: 0.8, armL: -0.5, spread: -1.15, lean: -0.5, crouch: 0.1, nod: 0.22, legL: 0.62, legR: -0.7, rate: 13 },
  follow: { armR: 2.7, armL: -0.7, spread: -1.2, lean: -0.34, crouch: 0.09, nod: 0.18, legL: 0.55, legR: -1.0, rate: 9 },
  watch: { armR: 0.35, armL: 0.25, spread: -0.3, lean: -0.14, crouch: 0.03, nod: 0, legL: 0.12, legR: -0.12, rate: 4 },
  cheer: { armR: 2.9, armL: 2.9, spread: -0.35, lean: 0.06, crouch: 0, nod: 0.14, legL: 0, legR: 0, rate: 9 },
  nice: { armR: 2.45, armL: 0.25, spread: -0.2, lean: 0.03, crouch: 0, nod: 0.1, legL: 0, legR: 0, rate: 9 },
  sad: { armR: 0.05, armL: 0.05, spread: -0.08, lean: -0.18, crouch: 0.04, nod: -0.42, legL: 0, legR: 0, rate: 6 },
  slump: { armR: 0.1, armL: 0.1, spread: -0.12, lean: -0.3, crouch: 0.07, nod: -0.55, legL: 0.1, legR: -0.1, rate: 7 },
};

// A soft round shadow to lay on the floor under things.
let shadowTex = null;
export function softShadow(radius, opacity = 0.34) {
  if (!shadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(40,24,10,1)');
    grad.addColorStop(0.55, 'rgba(40,24,10,0.55)');
    grad.addColorStop(1, 'rgba(40,24,10,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 4;
  return m;
}

// The shirt: teal, with a cream yoke, cream side panels and a club badge on the back.
function shirtTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1f8f8c';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#fbf1dc';
  // Side panels sit a quarter of the way round either side of the back.
  g.fillRect(40, 0, 30, 128);
  g.fillRect(186, 0, 30, 128);
  // The yoke across the shoulders.
  g.fillRect(0, 0, 256, 26);
  g.fillStyle = '#e8573f';
  g.fillRect(0, 26, 256, 4);
  // Buttons down the front, which is where the texture wraps round.
  g.fillStyle = '#fbf1dc';
  g.fillRect(0, 30, 5, 98);
  g.fillRect(251, 30, 5, 98);
  // The badge: the lane number on a coral disc.
  g.fillStyle = '#e8573f';
  g.beginPath();
  g.arc(128, 70, 21, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fbf1dc';
  g.font = '700 26px "Fredoka Variable", "Trebuchet MS", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('67', 128, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function arm(side) {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.2, SHOULDER_Y, 0);
  const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.07, 4, 12), TEAL);
  sleeve.position.y = -0.06;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.03, 12), CREAM);
  cuff.position.y = -0.135;
  const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.15, 4, 10), SKIN);
  fore.position.y = -0.24;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.056, 12, 10), SKIN);
  hand.scale.set(1, 1.1, 0.9);
  hand.position.y = -0.36;
  const grip = new THREE.Object3D();
  grip.position.y = -ARM_LEN;
  pivot.add(sleeve, cuff, fore, hand, grip);
  pivot.userData.grip = grip;
  return pivot;
}

function leg(side) {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.085, HIP_Y, 0);
  const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.17, 4, 10), PANTS);
  limb.position.y = -0.15;
  const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.074, 12, 8), SHOE);
  shoe.scale.set(1, 0.62, 1.55);
  shoe.position.set(0, -0.285, -0.035);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), SHOE_TIP);
  tip.scale.set(1.05, 0.6, 0.9);
  tip.position.set(0, -0.283, -0.1);
  pivot.add(limb, shoe, tip);
  return pivot;
}

export class Bowler {
  constructor() {
    this.group = new THREE.Group();
    this.state = 'address';
    this.t = 0;
    this.p = { ...POSES.address };
    // Where the real controller says the arm is, in radians from straight down. Null when unknown.
    this.drive = null;
    // Leaning after the ball as it curves, from -1 to 1.
    this.sway = 0;

    this.legL = leg(-1);
    this.legR = leg(1);
    this.group.add(this.legL, this.legR);

    // Everything above the hips leans together.
    this.upper = new THREE.Group();
    this.upper.position.y = HIP_Y;
    const torso = new THREE.Mesh(
      new THREE.LatheGeometry(
        [[0, -0.03], [0.12, -0.02], [0.142, 0.03], [0.158, 0.14], [0.172, 0.24], [0.16, 0.31], [0.11, 0.355], [0.06, 0.375], [0, 0.378]]
          .map(([x, y]) => new THREE.Vector2(x, y)),
        22,
      ),
      new THREE.MeshPhongMaterial({ map: shirtTexture(), shininess: 22 }),
    );
    // Turned so the badge is on the back and the seam runs down the buttons.
    torso.rotation.y = Math.PI;
    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 10), PANTS);
    hips.scale.y = 0.62;
    hips.position.y = 0.0;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.105, 0.05, 16, 1, true), CREAM);
    collar.material.side = THREE.DoubleSide;
    collar.position.y = 0.385;

    this.head = new THREE.Group();
    this.head.position.y = 0.565;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.168, 24, 18), SKIN);
    skull.scale.set(1, 1.04, 0.98);
    // Hair swept back over the crown, with a quiff standing up at the front.
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.178, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), HAIR);
    hair.rotation.x = 0.62;
    const quiff = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), HAIR);
    // Turned on its side, so the pinched ends of the sphere face the ears.
    quiff.rotation.z = Math.PI / 2;
    quiff.scale.set(0.66, 1.2, 0.95);
    quiff.position.set(0.01, 0.142, -0.07);
    this.head.add(skull, hair, quiff);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), SKIN);
      ear.scale.z = 0.6;
      ear.position.set(s * 0.165, -0.01, 0.0);
      const burn = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.05), HAIR);
      burn.position.set(s * 0.158, 0.035, -0.035);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.023, 10, 8), DARK);
      eye.scale.set(1, 1.45, 0.5);
      eye.position.set(s * 0.062, 0.005, -0.156);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 6), WHITE);
      glint.position.set(s * 0.062 + 0.007, 0.018, -0.168);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), HAIR);
      brow.position.set(s * 0.062, 0.062, -0.158);
      brow.rotation.z = s * 0.14;
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), BLUSH);
      cheek.scale.z = 0.3;
      cheek.position.set(s * 0.105, -0.045, -0.134);
      this.head.add(ear, burn, eye, glint, brow, cheek);
      (s < 0 ? (this.browL = brow) : (this.browR = brow));
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), SKIN);
    nose.position.set(0, -0.022, -0.17);
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.008, 6, 14, Math.PI), DARK);
    smile.rotation.z = Math.PI;
    smile.position.set(0, -0.058, -0.156);
    this.head.add(nose, smile);
    this.smile = smile;

    this.armR = arm(1);
    this.armL = arm(-1);
    this.grip = this.armR.userData.grip;
    this.upper.add(hips, torso, collar, this.head, this.armR, this.armL);
    this.group.add(this.upper);

    this.shadow = softShadow(0.34, 0.42);
    this.shadow.position.y = 0.006;
    this.group.add(this.shadow);
  }

  set(state) {
    if (state === this.state) return;
    this.state = state;
    this.t = 0;
    // The mouth turns over and the brows drop when the throw goes badly.
    const sad = state === 'sad' || state === 'slump';
    this.smile.rotation.z = sad ? 0 : Math.PI;
    this.smile.position.y = sad ? -0.102 : -0.058;
    this.browL.rotation.z = sad ? 0.3 : -0.14;
    this.browR.rotation.z = sad ? -0.3 : 0.14;
  }

  update(dt, clock) {
    this.t += dt;
    const target = POSES[this.state];
    const k = Math.min(1, dt * target.rate);
    for (const key of KEYS) {
      let want = target[key];
      if (key === 'armR' && this.state === 'back') {
        // First the ball is pushed away from the chest, then it swings back.
        if (this.t < 0.13) want = 1.5;
        // With a real controller, the arm goes where the controller is.
        else if (this.drive != null) want = Math.max(-2.0, Math.min(1.4, this.drive));
      }
      this.p[key] += (want - this.p[key]) * k;
    }
    const p = this.p;
    const cheer = this.state === 'cheer';
    let y = -p.crouch;
    let breathe = 0;
    if (cheer) y += Math.abs(Math.sin(this.t * 8.5)) * 0.22;
    if (this.state === 'address') breathe = Math.sin(clock * 2.2) * 0.02;
    this.group.position.y = Math.max(-0.1, y);
    this.shadow.position.y = 0.006 - this.group.position.y;
    this.shadow.material.opacity = cheer ? 0.28 : 0.42;
    const lean = this.state === 'watch' ? this.sway * 0.28 : 0;
    this.group.rotation.z += (-lean - this.group.rotation.z) * Math.min(1, dt * 5);
    this.upper.rotation.x = p.lean + breathe;
    this.head.rotation.x = p.nod;
    // A slow shake of the head after a gutter ball.
    this.head.rotation.y = this.state === 'slump' ? Math.sin(this.t * 5) * 0.4 * Math.min(1, this.t * 2) : 0;
    // A small fist pump for a good count that was not a strike.
    const pump = this.state === 'nice' ? Math.sin(Math.min(this.t, 1.2) * 13) * 0.3 : 0;
    this.armR.rotation.x = p.armR + pump + (cheer ? Math.sin(this.t * 17) * 0.12 : 0);
    this.armL.rotation.x = p.armL + (cheer ? Math.cos(this.t * 17) * 0.12 : 0);
    this.armL.rotation.z = -p.spread;
    this.armR.rotation.z = cheer ? 0.3 : 0;
    this.legL.rotation.x = p.legL;
    this.legR.rotation.x = p.legR;
  }
}
