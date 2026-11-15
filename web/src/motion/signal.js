// Turns a recorded swing into a fixed-size signature and compares two signatures.
// A sample row is [t, ax, ay, az, gx, gy, gz]: t in ms, accel in g, gyro in deg/s or null.

export const PRE_MS = 250;
export const POST_MS = 400;
// 48 points up to the release and 16 after it, so the release always lands on the same index.
export const N_BEFORE = 48;
export const N_AFTER = 16;
const GYRO_SCALE = 250;

const mag = (r) => Math.hypot(r[1], r[2], r[3]);

function interp(samples, t, idx) {
  // idx is a cursor into samples, kept by the caller to keep this linear.
  let i = idx.i;
  while (i < samples.length - 2 && samples[i + 1][0] < t) i++;
  idx.i = i;
  const a = samples[i];
  const b = samples[Math.min(i + 1, samples.length - 1)];
  const span = b[0] - a[0];
  const k = span > 0 ? Math.min(1, Math.max(0, (t - a[0]) / span)) : 0;
  const row = new Array(6);
  for (let c = 0; c < 6; c++) {
    const va = a[c + 1];
    const vb = b[c + 1];
    row[c] = va == null || vb == null ? 0 : va + (vb - va) * k;
  }
  return row;
}

function resample(samples, t0, t1, n) {
  const out = [];
  const idx = { i: 0 };
  for (let j = 0; j < n; j++) {
    out.push(interp(samples, t0 + ((t1 - t0) * j) / (n - 1), idx));
  }
  return out;
}

export function hasGyro(samples) {
  let n = 0;
  for (const r of samples) if (r[4] != null) n++;
  return n > samples.length / 2;
}

// Returns { ok, reason } so the bank can ask for another throw when a recording is unusable.
export function checkQuality(swing) {
  const s = swing.samples || [];
  const inSwing = s.filter((r) => r[0] >= swing.pressT && r[0] <= swing.releaseT);
  const dur = swing.releaseT - swing.pressT;
  if (dur < 150) return { ok: false, reason: 'too-short' };
  if (dur > 6000) return { ok: false, reason: 'too-long' };
  if (inSwing.length < 10) return { ok: false, reason: 'too-few-samples' };
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of inSwing) {
    const m = mag(r);
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  if (hi - lo < 0.3) return { ok: false, reason: 'no-motion' };
  return { ok: true, reason: null };
}

export function makeSignature(swing) {
  const s = swing.samples;
  const t0 = Math.max(s[0][0], swing.pressT - PRE_MS);
  const t1 = Math.min(s[s.length - 1][0], swing.releaseT + POST_MS);
  const before = resample(s, t0, swing.releaseT, N_BEFORE);
  const after = resample(s, swing.releaseT, Math.max(t1, swing.releaseT + 1), N_AFTER);
  const gyro = hasGyro(s);
  const seq = before.concat(after).map((r) => [
    r[0], r[1], r[2],
    gyro ? r[3] / GYRO_SCALE : 0,
    gyro ? r[4] / GYRO_SCALE : 0,
    gyro ? r[5] / GYRO_SCALE : 0,
  ].map((v) => Math.round(v * 1000) / 1000 || 0));

  // Timing and shape features, measured between the press and the release.
  const dur = swing.releaseT - swing.pressT;
  let peak = 0;
  let peakT = swing.pressT;
  let e1 = 0;
  let e2 = 0;
  const mid = swing.pressT + dur / 2;
  const mean = [0, 0, 0];
  const inSwing = s.filter((r) => r[0] >= swing.pressT && r[0] <= swing.releaseT);
  for (const r of inSwing) {
    const m = mag(r);
    if (m > peak) { peak = m; peakT = r[0]; }
    const dyn = Math.abs(m - 1);
    if (r[0] < mid) e1 += dyn; else e2 += dyn;
    mean[0] += r[1]; mean[1] += r[2]; mean[2] += r[3];
  }
  const n = Math.max(1, inSwing.length);
  mean[0] /= n; mean[1] /= n; mean[2] /= n;
  const axis = [0, 0, 0];
  for (const r of inSwing) {
    axis[0] += (r[1] - mean[0]) ** 2;
    axis[1] += (r[2] - mean[1]) ** 2;
    axis[2] += (r[3] - mean[2]) ** 2;
  }
  const axisSum = axis[0] + axis[1] + axis[2] || 1;
  let follow = 0;
  let nf = 0;
  for (const r of s) {
    if (r[0] > swing.releaseT && r[0] <= swing.releaseT + POST_MS) { follow += Math.abs(mag(r) - 1); nf++; }
  }
  const r3 = (v) => Math.round(v * 1000) / 1000 || 0;
  const feat = {
    dur: Math.round(dur),
    peak: r3(peak),
    tPeak: r3((peakT - swing.pressT) / dur),
    early: r3(e1 / (e1 + e2 || 1)),
    axis: axis.map((v) => r3(v / axisSum)),
    follow: r3(nf ? follow / nf : 0),
  };
  return { seq, feat, gyro };
}

// Dynamic time warping over the multi-axis sequences, inside a band so it stays cheap.
export function dtw(a, b, useGyro, band = 8) {
  const n = a.length;
  const m = b.length;
  const C = useGyro ? 6 : 3;
  const INF = 1e12;
  let prev = new Float64Array(m + 1).fill(INF);
  let cur = new Float64Array(m + 1).fill(INF);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(INF);
    const jLo = Math.max(1, i - band);
    const jHi = Math.min(m, i + band);
    for (let j = jLo; j <= jHi; j++) {
      let d = 0;
      const ra = a[i - 1];
      const rb = b[j - 1];
      for (let c = 0; c < C; c++) d += (ra[c] - rb[c]) ** 2;
      d = Math.sqrt(d);
      cur[j] = d + Math.min(prev[j], prev[j - 1], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m] / (n + m);
}

export function featureDistance(fa, fb) {
  const ln = (x, y) => Math.abs(Math.log(Math.max(x, 1e-3) / Math.max(y, 1e-3)));
  const axis = (Math.abs(fa.axis[0] - fb.axis[0]) + Math.abs(fa.axis[1] - fb.axis[1]) + Math.abs(fa.axis[2] - fb.axis[2])) / 2;
  return (
    1.0 * ln(fa.dur, fb.dur) +
    0.8 * ln(fa.peak, fb.peak) +
    2.0 * Math.abs(fa.tPeak - fb.tPeak) +
    1.5 * Math.abs(fa.early - fb.early) +
    1.5 * axis +
    1.0 * Math.abs(fa.follow - fb.follow)
  );
}

// One number for how far apart two swings are. Smaller is closer. It is not a probability.
export function distance(sa, sb) {
  const useGyro = sa.gyro && sb.gyro;
  return 2.0 * dtw(sa.seq, sb.seq, useGyro) + 0.5 * featureDistance(sa.feat, sb.feat);
}
