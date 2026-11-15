// Synthetic swings for tests and for the sample customers. These are made up by a formula.
// They stand in for a Wii remote on a swinging arm. They are not recordings of real people.

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A person is a set of swing habits. Each attempt wobbles around them.
export const PEOPLE = {
  margaret: { name: 'Margaret Pinsworth', back: 620, fwd: 380, pause: 60, thetaB: 0.9, thetaF: 0.5, roll: 0.15, twist: 120, tremor: 0.03, aim: 0.05 },
  gary: { name: 'Gary Gutterman', back: 400, fwd: 270, pause: 0, thetaB: 1.2, thetaF: 0.9, roll: 0.9, twist: 420, tremor: 0.05, aim: 0.98 },
  ines: { name: 'Ines Okafor', back: 900, fwd: 300, pause: 180, thetaB: 1.2, thetaF: 0.7, roll: -0.4, twist: 40, tremor: 0.02, aim: -0.2 },
  tom: { name: 'Tom Albrecht', back: 450, fwd: 450, pause: 20, thetaB: 0.7, thetaF: 0.9, roll: 0.5, twist: 260, tremor: 0.05, aim: 0.3 },
};

const ease = (k) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, k)));

export function syntheticSwing(person, rand, jitter = 0.06) {
  const j = (v) => v * (1 + (rand() * 2 - 1) * jitter);
  const back = j(person.back);
  const fwd = j(person.fwd);
  const pause = person.pause * (0.6 + rand() * 0.8);
  const thetaB = j(person.thetaB);
  const thetaF = j(person.thetaF);
  const roll = person.roll + (rand() * 2 - 1) * 0.06;
  const twist = j(person.twist);
  const L = 0.7;
  const G = 9.81;
  const pre = 300;
  const post = 450;
  const pressT = pre;
  const releaseT = pre + back + pause + fwd;
  const total = releaseT + post;
  const dt = 10;

  // Arm angle in radians: zero hanging down, negative behind the body.
  const theta = (t) => {
    const u = t - pre;
    if (u <= 0) return 0;
    if (u < back) return -thetaB * ease(u / back);
    if (u < back + pause) return -thetaB;
    const v = u - back - pause;
    const span = fwd * 1.5;
    return -thetaB + (thetaB + thetaF * 1.5) * ease(v / span);
  };

  const samples = [];
  for (let t = 0; t <= total; t += dt) {
    const th = theta(t);
    const w = (theta(t + dt) - theta(t - dt)) / (2 * dt / 1000);
    const al = (theta(t + dt) - 2 * th + theta(t - dt)) / ((dt / 1000) ** 2);
    const along = (L * w * w + G * Math.cos(th)) / G;
    const tang = (L * al + G * Math.sin(th)) / G;
    const near = Math.exp(-(((t - releaseT) / 90) ** 2));
    const n = () => (rand() * 2 - 1) * person.tremor;
    samples.push([
      t,
      tang * Math.sin(roll) + near * twist / 900 + n(),
      along + n(),
      tang * Math.cos(roll) + n(),
      (w * 180 / Math.PI) * Math.cos(roll) + n() * 40,
      (w * 180 / Math.PI) * Math.sin(roll) + n() * 40,
      near * twist + n() * 40,
    ].map((v, i) => (i === 0 ? v : Math.round(v * 1000) / 1000)));
  }
  return {
    version: 1,
    label: 'synthetic swing',
    source: 'synthetic',
    participant: person.name,
    samples,
    pressT,
    releaseT,
    aim: person.aim + (rand() * 2 - 1) * 0.03,
  };
}

export function syntheticSet(key, count, seed) {
  const rand = rng(seed);
  return Array.from({ length: count }, () => syntheticSwing(PEOPLE[key], rand));
}
