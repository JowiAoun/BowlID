// A small top-down bowling simulation. The ball and the pins are discs on the lane.
// x is across the lane in metres, z is down the lane. No physics library is needed.

export const LANE = {
  halfW: 0.53,
  gutterW: 0.24,
  pinZ: 14,
  spacing: 0.3048,
  ballR: 0.108,
  pinR: 0.06,
  fallenR: 0.13,
};
LANE.deckEnd = LANE.pinZ + 1.15;
LANE.wallX = LANE.halfW + LANE.gutterW;

// Feel of the pin action. Tuned with a sweep over aim and power.
// Tuned with a sweep over aim and power. The pocket either side of the head pin strikes.
// A ball straight down the middle usually leaves a pin or two, and a slow ball leaves more.
export const TUNE = { ballM: 9, pinM: 1.55, eBall: 0.62, ePin: 0.8, drag: 2.6, nudge: 2.0 };

export function pinLayout() {
  const pins = [];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      pins.push({
        x: (i - row / 2) * LANE.spacing,
        z: LANE.pinZ + row * LANE.spacing * 0.866,
      });
    }
  }
  return pins;
}

export function createWorld(t) {
  return {
    time: 0,
    hitTime: null,
    done: false,
    ball: {
      x: t.startX, z: 0,
      vx: t.speed * Math.sin(t.angle), vz: t.speed * Math.cos(t.angle),
      hook: t.hook, gutter: false, gone: false,
    },
    pins: pinLayout().map((p) => ({
      x: p.x, z: p.z, vx: 0, vz: 0,
      down: false, gone: false, fallT: 0, dirX: 0, dirZ: 1, spin: 0, pop: 0,
    })),
  };
}

function knock(pin, world) {
  if (pin.down) return;
  pin.down = true;
  pin.fallT = 0;
  const sp = Math.hypot(pin.vx, pin.vz) || 1;
  pin.dirX = pin.vx / sp;
  pin.dirZ = pin.vz / sp;
  pin.spin = (pin.vx > 0 ? 1 : -1) * (2 + sp * 1.5);
  // How hard the pin jumps off the deck. Only the drawing uses this.
  pin.pop = Math.min(1.7, sp * 0.4);
  if (world.hitTime == null) world.hitTime = world.time;
}

// Bounce two discs off each other. Returns true when they touched.
function collide(a, b, ra, rb, ma, mb, e) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  const min = ra + rb;
  if (dist >= min || dist === 0) return false;
  const nx = dx / dist;
  const nz = dz / dist;
  const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  const overlap = min - dist;
  const total = ma + mb;
  a.x -= nx * overlap * (mb / total);
  a.z -= nz * overlap * (mb / total);
  b.x += nx * overlap * (ma / total);
  b.z += nz * overlap * (ma / total);
  if (rel >= 0) return true;
  const imp = (-(1 + e) * rel) / (1 / ma + 1 / mb);
  a.vx -= (imp / ma) * nx;
  a.vz -= (imp / ma) * nz;
  b.vx += (imp / mb) * nx;
  b.vz += (imp / mb) * nz;
  return true;
}

export function step(world, dt) {
  if (world.done) return;
  world.time += dt;
  const { ball, pins } = world;

  if (!ball.gone) {
    if (!ball.gutter) {
      // The hook bites harder near the pins, like a real lane with oil up front.
      const bite = ball.z > 6 ? 1 : 0.25;
      ball.vx += ball.hook * 0.55 * bite * dt;
      if (Math.abs(ball.x) > LANE.halfW) {
        ball.gutter = true;
        ball.vx = 0;
        ball.x = Math.sign(ball.x) * (LANE.halfW + LANE.gutterW / 2);
      }
    }
    ball.x += ball.vx * dt;
    ball.z += ball.vz * dt;
    if (ball.z > LANE.deckEnd + 0.4) {
      ball.gone = true;
      if (world.hitTime == null) world.hitTime = world.time;
    }
  }

  for (const p of pins) {
    if (p.gone) continue;
    if (p.down) {
      p.fallT += dt;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0) {
        const drop = Math.min(sp, TUNE.drag * dt);
        p.vx -= (p.vx / sp) * drop;
        p.vz -= (p.vz / sp) * drop;
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      if (Math.abs(p.x) > LANE.wallX - LANE.pinR) {
        p.x = Math.sign(p.x) * (LANE.wallX - LANE.pinR);
        p.vx *= -0.45;
      }
      if (p.z > LANE.deckEnd || p.z < LANE.pinZ - 1.2) p.gone = p.z > LANE.deckEnd;
    }
  }

  if (!ball.gone && !ball.gutter) {
    for (const p of pins) {
      if (p.gone) continue;
      const r = p.down ? LANE.fallenR : LANE.pinR;
      if (collide(ball, p, LANE.ballR, r, TUNE.ballM, TUNE.pinM, TUNE.eBall)) knock(p, world);
    }
  }
  for (let i = 0; i < pins.length; i++) {
    const a = pins[i];
    if (a.gone) continue;
    for (let j = i + 1; j < pins.length; j++) {
      const b = pins[j];
      if (b.gone || (!a.down && !b.down)) continue;
      const ra = a.down ? LANE.fallenR : LANE.pinR;
      const rb = b.down ? LANE.fallenR : LANE.pinR;
      if (!collide(a, b, ra, rb, TUNE.pinM, TUNE.pinM, TUNE.ePin)) continue;
      // A standing pin that only gets a light nudge stays up.
      for (const p of [a, b]) {
        if (p.down) continue;
        if (Math.hypot(p.vx, p.vz) > TUNE.nudge) knock(p, world);
        else { p.vx = 0; p.vz = 0; }
      }
    }
  }

  if (world.hitTime != null) {
    const since = world.time - world.hitTime;
    const moving = pins.some((p) => p.down && !p.gone && Math.hypot(p.vx, p.vz) > 0.08);
    if ((ball.gone && !moving && since > 0.9) || since > 4.5) world.done = true;
  }
  if (world.time > 14) world.done = true;
}

export function result(world) {
  const pins = world.pins.filter((p) => p.down || p.gone).length;
  return { pins, strike: pins === 10, gutter: world.ball.gutter && pins === 0 };
}

export function simulate(throwParams, dt = 1 / 120) {
  const world = createWorld(throwParams);
  while (!world.done) step(world, dt);
  return result(world);
}
