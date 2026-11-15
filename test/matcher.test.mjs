// These tests use synthetic swings made by a formula. They check that the code behaves.
// They say nothing about accuracy on real people.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSignature, checkQuality, distance } from '../web/src/motion/signal.js';
import { buildProfile, verify, scoreFromDistance, alsoMatches, verifyClaim } from '../web/src/motion/matcher.js';
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
  const a = buildProfile(sigs('ines', 3, 12));
  const b = buildProfile(sigs('ines', 3, 10));
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

/* Identification: one swing against everyone, with nobody named beforehand. */
import { identify, collision, traits } from '../web/src/motion/matcher.js';

const gallery = (keys, seed = 10) => keys.map((key) => ({ id: key, profile: buildProfile(sigs(key, 3, seed)) }));

test('identify picks the right synthetic person out of everyone enrolled', () => {
  const all = gallery(Object.keys(PEOPLE));
  let right = 0;
  let wrong = 0;
  let total = 0;
  for (const key of Object.keys(PEOPLE)) {
    for (const s of sigs(key, 15, 321)) {
      total++;
      const r = identify(s, all);
      if (r.outcome === 'recognized' && r.best.account.id === key) right++;
      else if (r.outcome === 'recognized') wrong++;
    }
  }
  assert.equal(wrong, 0, `recognised as the wrong person ${wrong}/${total}`);
  assert.ok(right / total > 0.9, `recognised ${right}/${total}`);
});

test('identify does not hand a stranger the nearest account', () => {
  let wrong = 0;
  let total = 0;
  for (const stranger of Object.keys(PEOPLE)) {
    const others = gallery(Object.keys(PEOPLE).filter((k) => k !== stranger));
    for (const s of sigs(stranger, 10, 654)) {
      total++;
      if (identify(s, others).outcome === 'recognized') wrong++;
    }
  }
  assert.equal(wrong, 0, `strangers let in ${wrong}/${total}`);
});

test('identify with nobody enrolled is unknown', () => {
  const [s] = sigs('tom', 1, 2);
  assert.equal(identify(s, []).outcome, 'unknown');
});

test('two near-identical customers are an identity crisis, at log-in and at enrollment', () => {
  const twins = [
    { id: 'a', profile: buildProfile(sigs('ines', 3, 5)) },
    { id: 'b', profile: buildProfile(sigs('ines', 3, 6)) },
  ];
  const [probe] = sigs('ines', 1, 7);
  assert.equal(identify(probe, twins).outcome, 'ambiguous');
  assert.equal(collision(twins[1].profile, [twins[0]]).account.id, 'a');
  assert.equal(collision(buildProfile(sigs('gary', 3, 5)), [twins[0]]), null);
});

test('the report rows are measurements, and a person agrees with their own file', () => {
  const profile = buildProfile(sigs('margaret', 3, 10));
  const [own] = sigs('margaret', 1, 77);
  const [other] = sigs('gary', 1, 77);
  const mine = traits(own, profile);
  assert.ok(mine.length >= 5);
  assert.ok(mine.filter((r) => r.ok).length >= mine.length - 1, JSON.stringify(mine));
  assert.ok(traits(other, profile).filter((r) => !r.ok).length >= 2);
  assert.equal(traits(null, profile)[0].value, null);
});

/* A username was typed. The swing is checked against that one account. */

const enrolled = (key, seed) => ({ id: key, username: key, profile: buildProfile(sigs(key, 3, seed)) });

test('the owner opens their own account, and nobody else is named', () => {
  const margaret = enrolled('margaret', 12);
  const gary = enrolled('gary', 11);
  let ok = 0;
  const swings = sigs('margaret', 20, 99);
  for (const s of swings) {
    const res = verifyClaim(s, margaret, [gary]);
    if (res.verdict === 'match') ok++;
    assert.equal(res.crisis, false);
    assert.equal(res.like, null);
  }
  assert.ok(ok / swings.length > 0.9, `owner got in ${ok}/${swings.length}`);
});

test('the wrong person on an account is declined and named', () => {
  const margaret = enrolled('margaret', 10);
  const gary = enrolled('gary', 11);
  const tom = enrolled('tom', 12);
  for (const s of sigs('gary', 10, 55)) {
    const res = verifyClaim(s, margaret, [gary, tom]);
    assert.equal(res.verdict, 'mismatch');
    assert.equal(res.crisis, false);
    assert.equal(res.like.account.id, 'gary');
    assert.ok(res.like.score >= 70);
  }
});

test('a stranger on an account is declined and nobody is blamed', () => {
  const margaret = enrolled('margaret', 10);
  const gary = enrolled('gary', 11);
  const [s] = sigs('ines', 1, 55);
  const res = verifyClaim(s, margaret, [gary]);
  assert.equal(res.verdict, 'mismatch');
  assert.equal(res.like, null);
  assert.equal(verifyClaim(s, margaret, []).closest, null);
});

test('a swing that opens two accounts gets in and is flagged', () => {
  const a = { id: 'a', username: 'a', profile: buildProfile(sigs('ines', 3, 12)) };
  const b = { id: 'b', username: 'b', profile: buildProfile(sigs('ines', 3, 10)) };
  const [probe] = sigs('ines', 1, 7);
  const res = verifyClaim(probe, a, [b]);
  assert.equal(res.verdict, 'match');
  assert.equal(res.crisis, true);
  assert.equal(res.like.account.id, 'b');
});
