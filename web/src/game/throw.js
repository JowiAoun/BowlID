// Turns a swing into a bowling throw: speed, direction and curve.
// It shares nothing with the identity check, so pins and identity stay independent.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Flip to -1 if a clockwise wrist twist sends the ball left.
export const TILT_SIGN = 1;

// Small tilts are ignored, so a straight swing stays straight.
const dead = (v, zone) => (Math.abs(v) <= zone ? 0 : v - Math.sign(v) * zone);

// How much of the force sits on the remote's sideways axis between two times, from -1 to 1.
// Zero means the remote is level with the swing. It grows as the remote is rolled to one side.
function sideShare(samples, from, to) {
  let side = 0;
  let total = 0;
  for (const r of samples) {
    if (r[0] < from || r[0] > to) continue;
    side += r[1];
    total += Math.hypot(r[1], r[2], r[3]);
  }
  return total > 0 ? clamp(side / total, -1, 1) : 0;
}

export function throwFromSwing(swing, aim = 0) {
  const from = swing.releaseT - 350;
  const to = swing.releaseT + 60;
  let peak = 0;
  let twist = 0;
  let nt = 0;
  let pushSum = 0;
  let np = 0;
  for (const r of swing.samples) {
    if (r[0] < from || r[0] > to) continue;
    const m = Math.hypot(r[1], r[2], r[3]);
    if (m > peak) peak = m;
    if (r[0] >= swing.releaseT - 250 && r[0] <= swing.releaseT) { pushSum += Math.abs(m - 1); np++; }
    if (r[0] >= swing.releaseT - 120 && r[6] != null) { twist += r[6]; nt++; }
  }
  // Real Wii swings peak between about 2 and 6 g. The mean adds how long the push lasted.
  const push = np ? pushSum / np : 0;
  const power = clamp(0.65 * (peak - 1.6) / 4.2 + 0.35 * push / 1.6, 0, 1);

  // Tilt: how the remote is rolled at the release. A tilted release sends the ball off to that side.
  const tiltEnd = TILT_SIGN * sideShare(swing.samples, swing.releaseT - 150, swing.releaseT);
  const tiltStart = TILT_SIGN * sideShare(swing.samples, swing.pressT - 200, swing.pressT + 60);
  const tilt = dead(tiltEnd, 0.06);
  // Spin: how far the wrist turned during the swing. It makes the ball curve near the pins.
  // The gyro measures it directly when a MotionPlus is attached.
  const spin = nt ? clamp(twist / nt / 500, -1, 1) : clamp(dead(tiltEnd - tiltStart, 0.08) * 1.7, -1, 1);

  return {
    speed: 4.4 + 6.2 * power,
    startX: clamp(aim, -1, 1) * 0.36,
    angle: clamp(aim, -1, 1) * 0.022 + clamp(tilt * 0.075, -0.06, 0.06),
    hook: spin,
    power,
    tilt,
  };
}
