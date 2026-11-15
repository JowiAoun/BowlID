// Runs the real bridge program against made-up input devices (named pipes), to test
// connect, data flow, disconnect and reconnect without a Wii remote. This is test data,
// and the bridge labels it as such.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { encodeInputEvent, EV_ABS, EV_KEY, EV_SYN, ABS_RX, ABS_RY, ABS_RZ, ABS_HAT0X } from '../../bridge/evdev.mjs';

const BRIDGE = fileURLToPath(new URL('../../bridge/bridge.mjs', import.meta.url));

const PROC = ['', ' Accelerometer', ' IR'].map((suffix, i) => `I: Bus=0005 Vendor=057e Product=0306 Version=8600
N: Name="Nintendo Wii Remote${suffix}"
P: Phys=
S: Sysfs=/devices/virtual/misc/uhid/0005:057E:0306.0001/input/input${i}
U: Uniq=
H: Handlers=event${i}
B: EV=9
`).join('\n');

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const hasMkfifo = (() => {
  try {
    execFileSync('mkfifo', ['--version'], { stdio: 'ignore' });
    return process.platform === 'linux';
  } catch {
    return false;
  }
})();

test('bridge: connect, data, disconnect and reconnect with made-up devices', { skip: !hasMkfifo && 'needs Linux and mkfifo', timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowlbank-bridge-'));
  const procFile = path.join(dir, 'devices');
  fs.writeFileSync(procFile, '');
  const fifos = [0, 1, 2].map((i) => path.join(dir, `event${i}`));
  for (const fifo of fifos) execFileSync('mkfifo', [fifo]);
  // Holding a pipe open for writing stands in for a connected device.
  const openWriters = () => fifos.map((fifo) => fs.openSync(fifo, fs.constants.O_RDWR));
  let writers = openWriters();
  const [BUTTONS, ACCEL, IR] = [0, 1, 2];
  const send = (which, events) => fs.writeSync(writers[which], Buffer.concat(events.map((e) => encodeInputEvent({ ms: Date.now(), ...e }))));
  const syn = { type: EV_SYN, code: 0, value: 0 };

  const port = await freePort();
  const child = spawn(process.execPath, [BRIDGE], {
    env: {
      ...process.env,
      BOWLBANK_BRIDGE_PORT: String(port),
      BOWLBANK_TEST_PROC_DEVICES: procFile,
      BOWLBANK_TEST_INPUT_DIR: dir,
      BOWLBANK_SCAN_MS: '50',
      // Fixed here so a calibration in the local .env cannot change the expected numbers.
      BOWLBANK_ACCEL_ZERO: '0,0,0',
      BOWLBANK_ACCEL_COUNTS_PER_G: '104',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));

  const got = [];
  let ws;
  // Wait for a message that matches, looking only at messages from index `from` on.
  const waitFor = (what, match, from = 0) => new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const hit = got.slice(from).find(match);
      if (hit) return resolve(hit);
      if (Date.now() - started > 4000) return reject(new Error(`timed out waiting for ${what}\n${log}`));
      setTimeout(check, 10);
    };
    check();
  });

  try {
    // Connect once the bridge listens.
    for (let i = 0; i < 100 && !ws; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      ws = await new Promise((resolve) => {
        const sock = new WebSocket(`ws://127.0.0.1:${port}`);
        sock.once('open', () => resolve(sock));
        sock.once('error', () => resolve(null));
        sock.on('message', (d) => got.push(JSON.parse(d.toString())));
      });
    }
    assert.ok(ws, `the bridge did not start\n${log}`);

    // No remote yet.
    const none = await waitFor('first status', (m) => m.type === 'status');
    assert.equal(none.source, 'wii');
    assert.equal(none.connected, false);
    assert.match(none.message, /No Wii remote found/);
    assert.equal(got.some((m) => m.type === 'samples'), false);

    // The remote appears.
    fs.writeFileSync(procFile, PROC);
    const ready = await waitFor('connected status', (m) => m.type === 'status' && m.connected && m.sensors.accel && m.sensors.ir && m.sensors.buttons);
    assert.equal(ready.sensors.gyro, false);
    assert.match(ready.device, /Test devices/);
    assert.match(ready.message, /No MotionPlus/);

    // Buttons, motion and IR flow through.
    send(BUTTONS, [{ type: EV_KEY, code: 0x131, value: 1 }, syn]);
    const down = await waitFor('B down', (m) => m.type === 'button');
    assert.deepEqual([down.name, down.down], ['B', true]);

    send(ACCEL, [{ type: EV_ABS, code: ABS_RX, value: 52 }, { type: EV_ABS, code: ABS_RY, value: 0 }, { type: EV_ABS, code: ABS_RZ, value: 104 }, syn]);
    const samples = await waitFor('samples', (m) => m.type === 'samples');
    assert.deepEqual(samples.s[0].slice(1), [0.5, 0, 1, null, null, null]);

    send(IR, [{ type: EV_ABS, code: ABS_HAT0X, value: 256 }, { type: EV_ABS, code: ABS_HAT0X + 1, value: 384 }, syn]);
    const ir = await waitFor('ir', (m) => m.type === 'ir');
    assert.equal(ir.pts.length, 1);

    // Timestamps from the three devices share one clock that never goes back.
    const sampleTimes = got.filter((m) => m.type === 'samples').flatMap((m) => m.s.map((s) => s[0]));
    assert.deepEqual(sampleTimes, [...sampleTimes].sort((a, b) => a - b));

    // The remote goes away.
    let mark = got.length;
    fs.writeFileSync(procFile, '');
    for (const fd of writers) fs.closeSync(fd);
    const lost = await waitFor('disconnected status', (m) => m.type === 'status' && !m.connected, mark);
    assert.match(lost.message, /disconnected/);
    assert.deepEqual(lost.sensors, { buttons: false, accel: false, gyro: false, ir: false });
    const afterLost = got.indexOf(lost);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(got.slice(afterLost).some((m) => m.type === 'samples'), false, 'no samples may be sent without a remote');

    // It comes back, and input flows again.
    mark = got.length;
    writers = openWriters();
    fs.writeFileSync(procFile, PROC);
    await waitFor('reconnected status', (m) => m.type === 'status' && m.connected && m.sensors.accel, mark);
    send(BUTTONS, [{ type: EV_KEY, code: 0x131, value: 0 }, syn]);
    const up = await waitFor('B up', (m) => m.type === 'button', mark);
    assert.deepEqual([up.name, up.down], ['B', false]);

    // It stops promptly when asked.
    ws.close();
    child.kill('SIGTERM');
    const result = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('hung'), 2000))]);
    assert.notEqual(result, 'hung', 'the bridge did not exit on SIGTERM');
    assert.match(log, /TEST MODE/);
  } finally {
    child.kill('SIGKILL');
    for (const fd of writers) {
      try {
        fs.closeSync(fd);
      } catch {
        // Already closed.
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
