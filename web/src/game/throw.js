// Turns a swing into a bowling throw. This is about power and direction only.
// It shares nothing with the identity check, so pins and identity stay independent.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function throwFromSwing(swing, aim = 0) {
  const from = swing.releaseT - 350;
  const to = swing.releaseT + 60;
  let peak = 0;
  let twist = 0;
  let nt = 0;
  let side = 0;
  let ns = 0;
  let pushSum = 0;
  let np = 0;
  for (const r of swing.samples) {
    if (r[0] < from || r[0] > to) continue;
    const m = Math.hypot(r[1], r[2], r[3]);
    if (m > peak) peak = m;
    if (r[0] >= swing.releaseT - 250 && r[0] <= swing.releaseT) { pushSum += Math.abs(m - 1); np++; }
    if (r[0] >= swing.releaseT - 120) {
      if (r[6] != null) { twist += r[6]; nt++; }
      side += r[1]; ns++;
    }
  }
  // Real Wii swings peak between about 2 and 6 g. The mean adds how long the push lasted.
  const push = np ? pushSum / np : 0;
  const power = clamp(0.65 * (peak - 1.6) / 4.2 + 0.35 * push / 1.6, 0, 1);
  // Wrist twist from the gyro when there is one. Without it, only a small sideways drift,
  // so the ball goes where the aim line points.
  const hook = nt ? clamp(twist / nt / 500, -1, 1) : clamp((ns ? side / ns : 0) * 0.1, -0.25, 0.25);
  return {
    speed: 4.4 + 6.2 * power,
    startX: clamp(aim, -1, 1) * 0.36,
    angle: clamp(aim, -1, 1) * 0.022,
    hook,
    power,
  };
}
