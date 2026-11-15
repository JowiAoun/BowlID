import test from 'node:test';
import assert from 'node:assert/strict';
import { Normalizer, GYRO_UNITS_PER_DPS } from '../../bridge/normalize.mjs';
import { EV_ABS, EV_KEY, EV_SYN, ABS_RX, ABS_RY, ABS_RZ, ABS_HAT0X } from '../../bridge/evdev.mjs';

// A fake clock. Event times are wall-clock, the normalizer's own clock starts at 1000.
const WALL = 1_700_000_000_000;
function setup() {
  const clock = { now: 1000 };
  const norm = new Normalizer({ countsPerG: 100, now: () => clock.now });
  const at = (ms) => {
    clock.now = 1000 + ms;
    return WALL + ms;
  };
  const abs = (role, code, value, ms) => norm.push(role, { ms: at(ms), type: EV_ABS, code, value });
  const syn = (role, ms) => norm.push(role, { ms: at(ms), type: EV_SYN, code: 0, value: 0 });
  return { norm, clock, at, abs, syn };
}

test('accelerometer frames become samples in g with null gyro', () => {
  const { norm, abs, syn } = setup();
  abs('accel', ABS_RX, 0, 0);
  abs('accel', ABS_RY, 0, 0);
  abs('accel', ABS_RZ, 100, 0);
  syn('accel', 0);
  abs('accel', ABS_RX, 50, 10);
  syn('accel', 10);
  const msg = norm.flushSamples();
  assert.equal(msg.type, 'samples');
  assert.deepEqual(msg.s, [
    [1000, 0, 0, 1, null, null, null],
    [1010, 0.5, 0, 1, null, null, null],
  ]);
});

test('gyro is in deg/s, ordered pitch, roll, yaw, and goes null when stale', () => {
  const { norm, abs, syn } = setup();
  abs('gyro', ABS_RX, Math.round(GYRO_UNITS_PER_DPS * 30), 0);
  abs('gyro', ABS_RY, Math.round(GYRO_UNITS_PER_DPS * -20), 0);
  abs('gyro', ABS_RZ, Math.round(GYRO_UNITS_PER_DPS * 10), 0);
  syn('gyro', 0);
  abs('accel', ABS_RZ, 100, 5);
  syn('accel', 5);
  abs('accel', ABS_RZ, 101, 400);
  syn('accel', 400);
  const [fresh, stale] = norm.flushSamples().s;
  assert.ok(Math.abs(fresh[4] - 10) < 0.1);
  assert.ok(Math.abs(fresh[5] + 20) < 0.1);
  assert.ok(Math.abs(fresh[6] - 30) < 0.1);
  assert.deepEqual(stale.slice(4), [null, null, null]);
});

test('timestamps never go back, even when event times do', () => {
  const { norm, clock } = setup();
  const send = (ms) => {
    norm.push('accel', { ms: WALL + ms, type: EV_ABS, code: ABS_RX, value: ms });
    norm.push('accel', { ms: WALL + ms, type: EV_SYN, code: 0, value: 0 });
  };
  send(0);
  send(30);
  send(20);
  clock.now += 40;
  send(40);
  const ts = norm.flushSamples().s.map((s) => s[0]);
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  assert.equal(ts.length, 4);
});

test('a still remote keeps sending its last real reading', () => {
  const { norm, clock, abs, syn } = setup();
  assert.equal(norm.flushSamples(), null);
  abs('accel', ABS_RZ, 100, 0);
  syn('accel', 0);
  assert.equal(norm.flushSamples().s.length, 1);
  clock.now += 20;
  const hold = norm.flushSamples();
  assert.deepEqual(hold.s, [[1020, 0, 0, 1, null, null, null]]);
});

test('button presses and releases are named, repeats are dropped', () => {
  const { norm, at } = setup();
  const key = (code, value, ms) => norm.push('buttons', { ms: at(ms), type: EV_KEY, code, value });
  assert.deepEqual(key(0x131, 1, 0), [{ type: 'button', t: 1000, name: 'B', down: true }]);
  assert.deepEqual(key(0x131, 2, 50), []);
  assert.deepEqual(key(0x131, 0, 100), [{ type: 'button', t: 1100, name: 'B', down: false }]);
  assert.equal(key(0x130, 1, 110)[0].name, 'A');
  assert.equal(key(0x197, 1, 120)[0].name, 'PLUS');
  assert.deepEqual(key(30, 1, 130), []);
});

test('IR points are 0..1, mirrored in x, and hidden slots are left out', () => {
  const { norm, abs, syn } = setup();
  abs('ir', ABS_HAT0X, 1023 / 4, 0);
  abs('ir', ABS_HAT0X + 1, 767 / 2, 0);
  const [msg] = syn('ir', 0);
  assert.equal(msg.type, 'ir');
  assert.equal(msg.pts.length, 1);
  assert.ok(Math.abs(msg.pts[0][0] - 0.75) < 0.001);
  assert.ok(Math.abs(msg.pts[0][1] - 0.5) < 0.001);

  // Light lost: the slot goes back to 1023 and the message has no points.
  abs('ir', ABS_HAT0X, 1023, 30);
  abs('ir', ABS_HAT0X + 1, 1023, 30);
  assert.deepEqual(syn('ir', 30)[0].pts, []);
});

test('IR messages are held to about 50 a second', () => {
  const { norm, abs, syn } = setup();
  abs('ir', ABS_HAT0X, 500, 0);
  abs('ir', ABS_HAT0X + 1, 300, 0);
  let sent = 0;
  for (let ms = 0; ms < 1000; ms += 5) sent += syn('ir', ms).length;
  assert.ok(sent >= 45 && sent <= 51, `sent ${sent}`);
});

test('reset clears everything after a disconnect', () => {
  const { norm, abs, syn } = setup();
  abs('accel', ABS_RZ, 100, 0);
  syn('accel', 0);
  norm.reset();
  assert.equal(norm.flushSamples(), null);
});

test('an IR frame that came too soon is sent on the next flush, so losing the light is never missed', () => {
  const { norm, clock, abs, syn } = setup();
  abs('ir', ABS_HAT0X, 500, 0);
  abs('ir', ABS_HAT0X + 1, 300, 0);
  assert.equal(syn('ir', 0)[0].pts.length, 1);
  assert.equal(norm.flushIr(), null);

  // The light is lost 10 ms later, inside the throttle window.
  abs('ir', ABS_HAT0X, 1023, 10);
  abs('ir', ABS_HAT0X + 1, 1023, 10);
  assert.deepEqual(syn('ir', 10), []);
  assert.equal(norm.flushIr(), null);
  clock.now += 15;
  assert.deepEqual(norm.flushIr().pts, []);
  assert.equal(norm.flushIr(), null);
});
