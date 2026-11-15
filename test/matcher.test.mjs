// These tests use synthetic swings made by a formula. They check that the code behaves.
// They say nothing about accuracy on real people.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSignature, checkQuality, distance } from '../web/src/motion/signal.js';
import { buildProfile, verify, scoreFromDistance, alsoMatches } from '../web/src/motion/matcher.js';
import { syntheticSet, PEOPLE } from '../web/src/motion/synthetic.js';
import { SwingRecorder } from '../web/src/motion/recorder.js';
import { throwFromSwing } from '../web/src/game/throw.js';
import { simulate } from '../web/src/game/physics.js';

const sigs = (key, n, seed) => syntheticSet(key, n, seed).map(makeSignature);

test('a signature has 64 points and survives JSON', () => {
  const [s] = sigs('margaret', 1, 1);
  assert.equal(s.seq.length, 64);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('the same synthetic person matches their own profile', () => {
  let ok = 0;
  let total = 0;
  for (const key of Object.keys(PEOPLE)) {
    const profile = buildProfile(sigs(key, 3, 10));
    for (const s of sigs(key, 20, 99)) {
      total++;
      if (verify(profile, s).verdict === 'match') ok++;
    }
  }
  assert.ok(ok / total > 0.9, `genuine match rate ${ok}/${total}`);
});

test('a different synthetic person is not matched', () => {
  let wrong = 0;
  let total = 0;
  const keys = Object.keys(PEOPLE);
  for (const owner of keys) {
    const profile = buildProfile(sigs(owner, 3, 10));
    for (const other of keys) {
      if (other === owner) continue;
      for (const s of sigs(other, 10, 77)) {
        total++;
        if (verify(profile, s).verdict === 'match') wrong++;
      }
    }
  }
  assert.equal(wrong, 0, `false matches ${wrong}/${total}`);
});

test('score bands line up with the verdicts', () => {
  assert.equal(scoreFromDistance(0, 0.5), 100);
  assert.equal(scoreFromDistance(0.5, 0.5), 70);
  assert.ok(scoreFromDistance(0.5 * 1.33, 0.5) >= 49);
  assert.ok(scoreFromDistance(2, 0.5) < 10);
});

test('an inconsistent enrollment is flagged', () => {
  const mixed = [...sigs('margaret', 2, 3), ...sigs('gary', 1, 3)];
  const profile = buildProfile(mixed);
  assert.equal(profile.consistent, false);
  assert.equal(profile.outlier, 2);
});

test('two near-identical people cause an identity crisis flag', () => {
  const a = buildProfile(sigs('ines', 3, 5));
  const b = buildProfile(sigs('ines', 3, 6));
  const [probe] = sigs('ines', 1, 7);
  assert.equal(alsoMatches(probe, [a, b]), 2);
});

test('a still remote is rejected as not a swing', () => {
  const samples = Array.from({ length: 80 }, (_, i) => [i * 10, 0, 0, 1, 0, 0, 0]);
  assert.equal(checkQuality({ samples, pressT: 100, releaseT: 700 }).reason, 'no-motion');
  assert.equal(checkQuality({ samples, pressT: 100, releaseT: 150 }).reason, 'too-short');
});

test('the recorder cuts one swing out of a stream', () => {
  const [swing] = syntheticSet('tom', 1, 4);
  let got = null;
  const rec = new SwingRecorder({ onSwing: (s) => { got = s; } });
  for (const row of swing.samples) {
    if (row[0] === swing.pressT) rec.press(row[0]);
    if (row[0] >= swing.releaseT && rec.state === 'swing') rec.release(row[0]);
    rec.push([row]);
  }
  assert.ok(got, 'swing emitted');
  assert.equal(got.pressT, swing.pressT);
  assert.ok(got.samples[0][0] <= swing.pressT - 200);
  assert.ok(got.samples.at(-1)[0] >= got.releaseT + 390);
  assert.equal(checkQuality(got).ok, true);
});

test('identity and pins are independent: a gutter ball can match and a strike can be refused', () => {
  const gary = buildProfile(sigs('gary', 3, 10));
  const [garySwing] = syntheticSet('gary', 1, 55);
  const garyThrow = simulate(throwFromSwing(garySwing, garySwing.aim));
  assert.equal(garyThrow.gutter, true);
  assert.equal(verify(gary, makeSignature(garySwing)).verdict, 'match');

  // Search the aim for a strike by another person, then check it is still refused.
  const [other] = syntheticSet('margaret', 1, 56);
  let strike = null;
  for (let aim = -0.4; aim <= 0.4 && !strike; aim += 0.01) {
    if (simulate(throwFromSwing(other, aim)).strike) strike = aim;
  }
  assert.notEqual(strike, null, 'a strike exists for this swing');
  assert.equal(verify(gary, makeSignature(other)).verdict, 'mismatch');
});

test('distance is symmetric and zero to itself', () => {
  const [a, b] = sigs('tom', 2, 8);
  assert.equal(distance(a, a), 0);
  assert.ok(Math.abs(distance(a, b) - distance(b, a)) < 1e-9);
});
