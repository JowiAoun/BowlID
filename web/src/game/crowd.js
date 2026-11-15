// The spectators are robots. They have no backswing and so no accounts, and they watch.
import * as THREE from 'three';
import { softShadow } from './bowler.js';

const BODY_COLORS = [0xf3ead8, 0xf0b9a4, 0xf2d58a, 0xa9d6cf, 0xe6e0d2, 0xd9c7ea];
const SCREEN = new THREE.MeshBasicMaterial({ color: 0x1d2733 });
const METAL = new THREE.MeshPhongMaterial({ color: 0x8d8f96, shininess: 80 });
const CAP = new THREE.MeshPhongMaterial({ color: 0xe8573f, shininess: 40 });
const CAP_TOP = new THREE.CylinderGeometry(0.1, 0.11, 0.05, 12);
const CAP_PEAK = new THREE.BoxGeometry(0.2, 0.012, 0.09);
const BOW = new THREE.ConeGeometry(0.03, 0.05, 6);
const EYES = new THREE.MeshBasicMaterial({ color: 0x5fe3ff });
const MOODS = { idle: 0x5fe3ff, cheer: 0x67ff8f, sad: 0xff5a4d, tense: 0xffd23f };

const BODY = new THREE.BoxGeometry(0.2, 0.2, 0.15);
const HEAD = new THREE.BoxGeometry(0.24, 0.17, 0.18);
const FACE = new THREE.PlaneGeometry(0.19, 0.11);
const EYE = new THREE.CircleGeometry(0.02, 10);
const ARM = new THREE.BoxGeometry(0.04, 0.15, 0.04);
const BASE = new THREE.CylinderGeometry(0.07, 0.1, 0.06, 10);
const ROD = new THREE.CylinderGeometry(0.006, 0.006, 0.08, 5);
const BULB = new THREE.SphereGeometry(0.02, 8, 6);
const bodyMats = BODY_COLORS.map((c) => new THREE.MeshPhongMaterial({ color: c, shininess: 60 }));

function robot(i, staff) {
  const m = bodyMats[i % bodyMats.length];
  const g = new THREE.Group();
  const base = new THREE.Mesh(BASE, METAL);
  base.position.y = 0.03;
  const body = new THREE.Mesh(BODY, m);
  body.position.y = 0.16;
  const head = new THREE.Group();
  head.position.y = 0.36;
  const box = new THREE.Mesh(HEAD, m);
  const face = new THREE.Mesh(FACE, SCREEN);
  face.position.z = 0.091;
  head.add(box, face);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(EYE, EYES);
    eye.position.set(s * 0.045, 0.005, 0.093);
    head.add(eye);
  }
  const rod = new THREE.Mesh(ROD, METAL);
  rod.position.y = 0.125;
  const bulb = new THREE.Mesh(BULB, EYES);
  bulb.position.y = 0.17;
  head.add(rod, bulb);
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.125, 0.24, 0);
    const a = new THREE.Mesh(ARM, METAL);
    a.position.y = -0.07;
    pivot.add(a);
    pivot.userData.side = s;
    return pivot;
  });
  g.add(base, body, head, ...arms);
  if (staff) {
    // The attendant wears a cap and a bow tie.
    const top = new THREE.Mesh(CAP_TOP, CAP);
    top.position.y = 0.105;
    const peak = new THREE.Mesh(CAP_PEAK, CAP);
    peak.position.set(0, 0.088, 0.12);
    head.add(top, peak);
    for (const s of [-1, 1]) {
      const bow = new THREE.Mesh(BOW, CAP);
      bow.rotation.z = s * Math.PI / 2;
      bow.position.set(s * 0.022, 0.235, 0.08);
      g.add(bow);
    }
  }
  const shadow = softShadow(0.17, 0.3);
  shadow.position.y = 0.004;
  g.add(shadow);
  return { g, head, arms, phase: i * 1.7, yaw: 0, y: 0, scale: 1 };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Crowd {
  // `spots` are [x, y, z, yaw, scale, staff] in scene coordinates. Yaw 0 faces +z.
  constructor(scene, spots) {
    this.mood = 'idle';
    this.moodT = 0;
    this.bots = spots.map(([x, y, z, yaw, scale, staff], i) => {
      const r = robot(i, staff);
      r.g.position.set(x, y, z);
      r.g.rotation.y = yaw;
      r.g.scale.setScalar(scale);
      r.yaw = yaw;
      r.y = y;
      r.scale = scale;
      scene.add(r.g);
      return r;
    });
  }

  setMood(mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    this.moodT = 0;
    EYES.color.setHex(MOODS[mood]);
  }

  // `look` is the point every robot watches: the ball while it rolls, the bowler otherwise.
  update(dt, clock, look) {
    this.moodT += dt;
    const cheer = this.mood === 'cheer';
    const sad = this.mood === 'sad';
    for (const r of this.bots) {
      const p = r.g.position;
      const want = wrap(Math.atan2(look.x - p.x, look.z - p.z) - r.yaw);
      const yaw = Math.max(-1.5, Math.min(1.5, want));
      r.head.rotation.y += (yaw - r.head.rotation.y) * Math.min(1, dt * 7);
      const nod = sad ? 0.45 : this.mood === 'tense' ? -0.08 : 0;
      r.head.rotation.x += (nod - r.head.rotation.x) * Math.min(1, dt * 6);
      const hop = cheer ? Math.abs(Math.sin(this.moodT * 9 + r.phase)) * 0.16 * r.scale : Math.sin(clock * 2 + r.phase) * 0.008;
      p.y = r.y + hop;
      const up = cheer ? 2.7 + Math.sin(this.moodT * 16 + r.phase) * 0.3 : sad ? 0.05 : 0.12;
      for (const a of r.arms) {
        const target = a.userData.side * up;
        a.rotation.z += (target - a.rotation.z) * Math.min(1, dt * 10);
      }
    }
  }
}
