// The bowler: a small cartoon person built from spheres and capsules.
// The lane tells it what state it is in and it eases between poses.
import * as THREE from 'three';

const mat = (color, shininess = 30) => new THREE.MeshPhongMaterial({ color, shininess });
const SKIN = mat(0xffcfa3);
const SHIRT = mat(0xff6f59);
const TRIM = mat(0xfff4e0);
const PANTS = mat(0x2d3f73);
const SHOE = mat(0xffffff, 80);
const HAIR = mat(0x5b3a21, 10);
const DARK = new THREE.MeshBasicMaterial({ color: 0x2a1d14 });

const SHOULDER_Y = 0.3;
const ARM_LEN = 0.4;

// One pose per state: arm swing (forward is positive), left arm spread, lean, crouch, turn, head nod.
const POSES = {
  address: { armR: 1.25, armL: 1.05, spread: 0.35, lean: -0.06, crouch: 0, turn: 0, nod: 0, rate: 8 },
  back: { armR: -1.7, armL: 0.5, spread: -0.9, lean: -0.34, crouch: 0.05, turn: 0, nod: 0.1, rate: 7 },
  forward: { armR: 0.75, armL: -0.6, spread: -1.1, lean: -0.46, crouch: 0.11, turn: 0, nod: 0.2, rate: 13 },
  follow: { armR: 2.6, armL: -0.7, spread: -1.0, lean: -0.3, crouch: 0.1, turn: 0, nod: 0.15, rate: 9 },
  watch: { armR: 0.5, armL: 0.3, spread: -0.25, lean: -0.12, crouch: 0.03, turn: 0, nod: 0, rate: 4 },
  cheer: { armR: 2.9, armL: 2.9, spread: -0.3, lean: 0.05, crouch: 0, turn: 0, nod: 0.12, rate: 9 },
  sad: { armR: 0.05, armL: 0.05, spread: -0.08, lean: -0.16, crouch: 0.04, turn: 0, nod: -0.4, rate: 6 },
};

function arm(side) {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.2, SHOULDER_Y, 0);
  const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.08, 4, 10), SHIRT);
  sleeve.position.y = -0.07;
  const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.16, 4, 10), SKIN);
  fore.position.y = -0.23;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 10), SKIN);
  hand.position.y = -0.36;
  const grip = new THREE.Object3D();
  grip.position.y = -ARM_LEN;
  pivot.add(sleeve, fore, hand, grip);
  pivot.userData.grip = grip;
  return pivot;
}

export class Bowler {
  constructor() {
    this.group = new THREE.Group();
    this.state = 'address';
    this.t = 0;
    this.p = { ...POSES.address };

    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.16, 4, 10), PANTS);
      leg.position.set(s * 0.085, 0.17, 0);
      const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), SHOE);
      shoe.scale.set(1, 0.6, 1.5);
      shoe.position.set(s * 0.085, 0.045, -0.03);
      this.group.add(leg, shoe);
    }

    // Everything above the hips leans together.
    this.upper = new THREE.Group();
    this.upper.position.y = 0.3;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.14, 6, 14), SHIRT);
    torso.position.y = 0.2;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.05, 18, 1, true), TRIM);
    band.position.y = 0.15;
    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), PANTS);
    hips.scale.y = 0.6;
    hips.position.y = 0.03;

    this.head = new THREE.Group();
    this.head.position.y = 0.55;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), SKIN);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), HAIR);
    hair.rotation.x = 0.55;
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), HAIR);
    tuft.position.set(0, 0.17, -0.02);
    this.head.add(skull, hair, tuft);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.021, 8, 8), DARK);
      eye.scale.y = 1.4;
      eye.position.set(s * 0.06, 0.0, -0.158);
      this.head.add(eye);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 12, Math.PI), DARK);
    smile.rotation.z = Math.PI;
    smile.position.set(0, -0.055, -0.158);
    this.head.add(smile);
    this.smile = smile;
    // Rosy cheeks, so the face reads from across a room.
    for (const s of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff9d8a }));
      cheek.scale.z = 0.3;
      cheek.position.set(s * 0.1, -0.04, -0.137);
      this.head.add(cheek);
    }

    this.armR = arm(1);
    this.armL = arm(-1);
    this.grip = this.armR.userData.grip;
    this.upper.add(hips, torso, band, this.head, this.armR, this.armL);
    this.group.add(this.upper);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.24, 20),
      new THREE.MeshBasicMaterial({ color: 0x3b2a14, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.004;
    this.group.add(this.shadow);
  }

  set(state) {
    if (state === this.state) return;
    this.state = state;
    this.t = 0;
    // The mouth turns over when the throw goes badly.
    const sad = state === 'sad';
    this.smile.rotation.z = sad ? 0 : Math.PI;
    this.smile.position.y = sad ? -0.085 : -0.055;
  }

  update(dt, clock) {
    this.t += dt;
    const target = POSES[this.state];
    const k = Math.min(1, dt * target.rate);
    for (const key of ['armR', 'armL', 'spread', 'lean', 'crouch', 'turn', 'nod']) {
      this.p[key] += (target[key] - this.p[key]) * k;
    }
    const p = this.p;
    let y = -p.crouch;
    let sway = 0;
    if (this.state === 'cheer') y += Math.abs(Math.sin(this.t * 8.5)) * 0.2;
    if (this.state === 'address') sway = Math.sin(clock * 2.2) * 0.02;
    this.group.position.y = Math.max(-0.12, y);
    this.shadow.position.y = 0.004 - this.group.position.y;
    this.group.rotation.y = p.turn;
    this.upper.rotation.x = p.lean + sway;
    this.head.rotation.x = p.nod;
    this.armR.rotation.x = p.armR + (this.state === 'cheer' ? Math.sin(this.t * 17) * 0.12 : 0);
    this.armL.rotation.x = p.armL + (this.state === 'cheer' ? Math.cos(this.t * 17) * 0.12 : 0);
    this.armL.rotation.z = -p.spread;
    this.armR.rotation.z = this.state === 'cheer' ? 0.3 : 0;
  }
}
