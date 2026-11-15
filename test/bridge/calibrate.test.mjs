import test from 'node:test';
import assert from 'node:assert/strict';
import { findRestPoints, fitSphere } from '../../bridge/calibrate.mjs';

test('fitSphere finds the zero offset and counts per g of a made-up remote', () => {
  const zero = [-13, -19, -23];
  const g = 103.5;
  const dirs = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0.6, 0.64, 0.48]];
  const fit = fitSphere(dirs.map((d) => d.map((v, i) => zero[i] + v * g)));
  assert.ok(fit.zero.every((v, i) => Math.abs(v - zero[i]) < 0.01));
  assert.ok(Math.abs(fit.countsPerG - g) < 0.01);
  assert.ok(fit.worstError < 0.01);
});

test('fitSphere matches the rest readings measured on the real remote', () => {
  // Raw counts read from the team's Wii remote lying still in six positions, 2026-11-15.
  const measured = [[-28, -5, 79], [-41, -38, 75], [-79, -82, 26], [-104, 13, 16], [-107, 13, 5], [-116, -19, -10]];
  const fit = fitSphere(measured);
  assert.deepEqual(fit.zero.map(Math.round), [-13, -19, -23]);
  assert.ok(Math.abs(fit.countsPerG - 103.5) < 0.5);
  assert.ok(fit.worstError < 1);
});

test('fitSphere refuses too few positions, or positions that pin nothing down', () => {
  assert.equal(fitSphere([[0, 0, 100], [100, 0, 0], [0, 100, 0]]), null);
  assert.equal(fitSphere([[0, 0, 100], [0, 0, 100], [0, 0, 100], [0, 0, 100]]), null);
});

test('findRestPoints keeps still moments, one per position, and skips movement', () => {
  const frames = [];
  const still = (p, n) => { for (let i = 0; i < n; i++) frames.push([p[0] + (i % 2), p[1], p[2]]); };
  const moving = (n) => { for (let i = 0; i < n; i++) frames.push([Math.sin(i) * 80, Math.cos(i) * 80, i % 50]); };
  still([0, 0, 100], 90);
  moving(60);
  still([100, 0, 0], 60);
  moving(60);
  still([0, 0, 100], 60);
  const points = findRestPoints(frames);
  assert.equal(points.length, 2);
  assert.ok(Math.abs(points[0][2] - 100) < 1);
  assert.ok(Math.abs(points[1][0] - 100.5) < 1);
});
