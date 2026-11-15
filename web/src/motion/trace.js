// The curve drawn for a swing: the force on the remote at each point of its signature, in g.
// These are the same recorded points the matcher reads. Nothing is smoothed or made up.
// The matcher compares every axis and the timing as well, so two curves can look alike and
// still score apart.

export const forceOf = (sig) => sig.seq.map((r) => Math.round(Math.hypot(r[0], r[1], r[2]) * 1000) / 1000);

// The swings on file as one curve: at each point the average force over the saved swings,
// with the lowest and the highest. Null when nothing is on file.
export function savedForce(profile) {
  const rows = ((profile && profile.templates) || []).map(forceOf);
  if (!rows.length) return null;
  const mean = [];
  const lo = [];
  const hi = [];
  for (let i = 0; i < rows[0].length; i++) {
    const col = rows.map((r) => r[i]);
    mean.push(Math.round((col.reduce((s, v) => s + v, 0) / col.length) * 1000) / 1000);
    lo.push(Math.min(...col));
    hi.push(Math.max(...col));
  }
  return { mean, lo, hi, swings: rows.length };
}

// One vertical scale for every curve drawn together, so two graphs side by side compare by eye.
export function forceRange(curves) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of curves) {
    for (const v of c || []) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!(hi > lo)) return { lo: 0, hi: 2 };
  const pad = Math.max(0.15, (hi - lo) * 0.08);
  return { lo: lo - pad, hi: hi + pad };
}

// The curve's value a fraction `k` of the way along, between the two points around it.
export function forceAt(curve, k) {
  const x = Math.min(1, Math.max(0, k)) * (curve.length - 1);
  const i = Math.min(curve.length - 2, Math.floor(x));
  return curve[i] + (curve[i + 1] - curve[i]) * (x - i);
}
