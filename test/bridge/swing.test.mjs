import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { validateSwing, swingToTimeline, shiftMessage } from '../../bridge/swing.mjs';
import { startServer } from '../../bridge/server.mjs';

// A made-up swing, 100 samples a second for one second. Synthetic test data, not a real person.
function syntheticSwing() {
  const samples = [];
  for (let i = 0; i <= 100; i++) {
    const t = 5000 + i * 10;
    samples.push([t, Math.sin(i / 16), 0.1, Math.cos(i / 16), null, null, null]);
  }
  return { version: 1, label: 'test swing', source: 'synthetic', participant: 'fixture', samples, releaseT: 5700 };
}

test('validateSwing explains what is wrong', () => {
  assert.throws(() => validateSwing({ version: 2, samples: [] }), /version/);
  assert.throws(() => validateSwing({ version: 1, samples: [[0, 0, 0, 1]] }), /fewer than 2/);
  assert.throws(() => validateSwing({ version: 1, samples: [[10, 0, 0, 1], [5, 0, 0, 1]] }), /back in time/);
  assert.throws(() => validateSwing({ version: 1, samples: [[0, 0, 0, 1], [5, 'x', 0, 1]] }), /not a number/);
  assert.ok(validateSwing(syntheticSwing()));
});

test('swingToTimeline holds B, sends every sample in order, and releases at releaseT', () => {
  const timeline = swingToTimeline(syntheticSwing());
  assert.deepEqual(timeline[0].msg, { type: 'button', t: 0, name: 'B', down: true });

  const up = timeline.find((e) => e.msg.type === 'button' && !e.msg.down);
  assert.equal(up.at, 700);

  const samples = timeline.filter((e) => e.msg.type === 'samples').flatMap((e) => e.msg.s);
  assert.equal(samples.length, 101);
  assert.equal(samples[0][0], 0);
  assert.equal(samples[100][0], 1000);
  assert.ok(samples.every((s) => s.length === 7));

  // The follow-through after the release is still sent.
  assert.ok(timeline[timeline.length - 1].at > up.at);
  const ats = timeline.map((e) => e.at);
  assert.deepEqual(ats, [...ats].sort((a, b) => a - b));
});

test('a swing without gyro columns still plays', () => {
  const swing = { version: 1, samples: [[0, 0, 0, 1], [10, 0.1, 0, 1], [20, 0.2, 0, 1]] };
  const samples = swingToTimeline(swing).filter((e) => e.msg.type === 'samples').flatMap((e) => e.msg.s);
  assert.deepEqual(samples[1], [10, 0.1, 0, 1, null, null, null]);
});

test('shiftMessage moves timestamps and nothing else', () => {
  assert.deepEqual(shiftMessage({ type: 'button', t: 5, name: 'B', down: true }, 100), { type: 'button', t: 105, name: 'B', down: true });
  assert.deepEqual(shiftMessage({ type: 'samples', s: [[5, 1, 2, 3, null, null, null]] }, 100).s, [[105, 1, 2, 3, null, null, null]]);
});

test('the server sends the status on connect, then changes, then broadcasts', async () => {
  const server = startServer({ port: 0, source: 'replay' });
  await server.ready;
  const { port } = server.wss.address();
  const got = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const waitFor = (n) => new Promise((resolve) => {
    const check = () => (got.length >= n ? resolve() : setTimeout(check, 5));
    check();
  });
  ws.on('message', (data) => got.push(JSON.parse(data.toString())));
  await waitFor(1);
  assert.equal(got[0].type, 'status');
  assert.equal(got[0].source, 'replay');
  assert.equal(got[0].connected, false);
  assert.deepEqual(got[0].sensors, { buttons: false, accel: false, gyro: false, ir: false });

  const log = console.log;
  console.log = () => {};
  server.setStatus({ connected: true, sensors: { accel: true }, message: 'ready' });
  server.setStatus({ connected: true, sensors: { accel: true }, message: 'ready' });
  console.log = log;
  for (const { msg } of swingToTimeline(syntheticSwing())) server.broadcast(msg);
  await waitFor(3);
  await new Promise((resolve) => setTimeout(resolve, 50));

  // The repeated status was not sent twice.
  assert.equal(got.filter((m) => m.type === 'status').length, 2);
  assert.equal(got[1].sensors.accel, true);
  assert.equal(got[1].sensors.gyro, false);
  assert.equal(got.filter((m) => m.type === 'button').length, 2);
  assert.equal(got.filter((m) => m.type === 'samples').flatMap((m) => m.s).length, 101);

  ws.close();
  await server.close();
});
