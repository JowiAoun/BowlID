#!/usr/bin/env node
// Finds the accelerometer settings of one Wii remote: what each axis reads with no force
// on it, and how many counts make 1 g. Lay the remote still in at least 4 different
// positions (face up, face down, on each side, standing on each end) while it runs.
//
// Usage: node bridge/calibrate.mjs [--seconds 40]

import { fileURLToPath } from 'node:url';
import { EV_ABS, EV_SYN, SYN_REPORT, ABS_RX, ABS_RZ } from './evdev.mjs';

const REST_WINDOW = 30;
const REST_MAX_SPREAD = 1.5;
const SAME_POSITION = 12;

// Find the moments the remote lay still. `frames` are raw [x, y, z] counts.
// Returns one mean reading per distinct position.
export function findRestPoints(frames) {
  const points = [];
  for (let i = 0; i + REST_WINDOW <= frames.length; i += REST_WINDOW) {
    const win = frames.slice(i, i + REST_WINDOW);
    const mean = [0, 1, 2].map((k) => win.reduce((sum, f) => sum + f[k], 0) / win.length);
    const spread = Math.max(...[0, 1, 2].map((k) => Math.sqrt(win.reduce((sum, f) => sum + (f[k] - mean[k]) ** 2, 0) / win.length)));
    if (spread > REST_MAX_SPREAD) continue;
    const near = points.find((p) => Math.hypot(p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]) < SAME_POSITION);
    if (!near) points.push(mean);
  }
  return points;
}

// A still remote feels exactly 1 g, whatever way it lies. So its rest readings sit on a
// sphere: the centre is the zero offset and the radius is the counts per g.
// Least-squares fit of |p - c| = r, written as the linear system 2c.p + k = |p|^2.
export function fitSphere(points) {
  if (points.length < 4) return null;
  const rows = points.map((p) => [2 * p[0], 2 * p[1], 2 * p[2], 1, p[0] ** 2 + p[1] ** 2 + p[2] ** 2]);
  const m = Array.from({ length: 4 }, (_, i) => Array.from({ length: 5 }, (_, j) => rows.reduce((sum, r) => sum + r[i] * r[j], 0)));
  for (let i = 0; i < 4; i++) {
    let pivot = i;
    for (let k = i + 1; k < 4; k++) if (Math.abs(m[k][i]) > Math.abs(m[pivot][i])) pivot = k;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    // The positions all lie in one plane, so the sphere is not pinned down.
    if (Math.abs(m[i][i]) < 1e-6) return null;
    for (let k = 0; k < 4; k++) {
      if (k === i) continue;
      const f = m[k][i] / m[i][i];
      for (let j = i; j < 5; j++) m[k][j] -= f * m[i][j];
    }
  }
  const [cx, cy, cz, k] = m.map((row, i) => row[4] / row[i]);
  const radius = Math.sqrt(k + cx ** 2 + cy ** 2 + cz ** 2);
  if (!Number.isFinite(radius)) return null;
  const errors = points.map((p) => Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) - radius);
  return { zero: [cx, cy, cz], countsPerG: radius, worstError: Math.max(...errors.map(Math.abs)) };
}

async function main() {
  const { scanRemotes, openEventDevice, readAbsValues, ABS_CODES } = await import('./reader.mjs');
  const secondsIndex = process.argv.indexOf('--seconds');
  const seconds = secondsIndex >= 0 ? Number(process.argv[secondsIndex + 1]) || 40 : 40;

  const [remote] = scanRemotes();
  if (!remote?.parts.accel) {
    console.error('No Wii remote accelerometer found. Run ./scripts/check-controller.sh first.');
    process.exit(1);
  }

  const raw = [null, null, null];
  const frames = [];
  let shown = 0;
  const reader = openEventDevice(
    remote.parts.accel,
    (ev) => {
      if (ev.type === EV_ABS && ev.code >= ABS_RX && ev.code <= ABS_RZ) raw[ev.code - ABS_RX] = ev.value;
    },
    (err) => {
      if (err) {
        console.error(`Lost the remote: ${err.message}`);
        process.exit(1);
      }
    },
  );
  const start = readAbsValues(remote.parts.accel, ABS_CODES.accel);
  if (start) ABS_CODES.accel.forEach((code, i) => { raw[i] ??= start[code]; });

  console.log(`Calibrating for ${seconds} seconds.`);
  console.log('Lay the remote still for 2 seconds in each position: face up, face down, left side, right side, standing up, standing on its head.\n');

  // The kernel only reports changes, so a still remote is sampled on a timer.
  const timer = setInterval(() => {
    if (raw.every((v) => v !== null)) frames.push([...raw]);
    const count = findRestPoints(frames).length;
    if (count > shown) {
      shown = count;
      console.log(`Position ${count} recorded. Turn the remote to the next one.`);
    }
  }, 20);

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  clearInterval(timer);
  reader.close();

  const points = findRestPoints(frames);
  const fit = fitSphere(points);
  if (!fit || fit.countsPerG < 60 || fit.countsPerG > 160) {
    console.error(`\nOnly ${points.length} usable position(s). Run it again and hold the remote still in at least 4 different positions.`);
    process.exit(1);
  }
  console.log(`\nDone, from ${points.length} positions. The fit is off by at most ${fit.worstError.toFixed(1)} counts (under 3 is good).`);
  console.log('Add these two lines to the .env file at the repo root, then restart the bridge:\n');
  console.log(`BOWLBANK_ACCEL_ZERO=${fit.zero.map((v) => Math.round(v)).join(',')}`);
  console.log(`BOWLBANK_ACCEL_COUNTS_PER_G=${fit.countsPerG.toFixed(1)}`);
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
