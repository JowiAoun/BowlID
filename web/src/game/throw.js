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
  for (const r of swing.samples) {
    if (r[0] < from || r[0] > to) continue;
    const m = Math.hypot(r[1], r[2], r[3]);
    if (m > peak) peak = m;
    if (r[0] >= swing.releaseT - 120) {
      if (r[6] != null) { twist += r[6]; nt++; }
      side += r[1]; ns++;
    }
  }
  const power = clamp((peak - 1.2) / 2.6, 0, 1);
  // Wrist twist from the gyro when there is one. Sideways push otherwise.
  const hook = nt ? clamp(twist / nt / 500, -1, 1) : clamp((ns ? side / ns : 0) * 0.35, -1, 1);
  return {
    speed: 5.2 + 4.6 * power,
    startX: clamp(aim, -1, 1) * 0.36,
    angle: clamp(aim, -1, 1) * 0.022,
    hook,
    power,
  };
}
