#!/usr/bin/env node
// Bowlometrics input bridge. Reads a real Wii remote through the kernel hid-wiimote driver
// and sends its buttons, motion and IR points to the browser on ws://127.0.0.1:8765.
// It never makes data up. With no remote, it says so and keeps looking.

import { Normalizer, DEFAULT_COUNTS_PER_G } from './normalize.mjs';
import {
  scanRemotes, openEventDevice, readHidAttr, unboundWiiRemotes, readAbsValues,
  accelZeroFromEnv, loadEnv, ABS_CODES, TEST_DEVICES,
} from './reader.mjs';
import { startServer } from './server.mjs';

import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

loadEnv();

const SCAN_MS = Number(process.env.BOWLBANK_SCAN_MS) || 1000;
const FLUSH_MS = 20;

const MSG_NONE = 'No Wii remote found. Press 1+2 on the remote, or run ./scripts/pair-wiimote.sh.';
const MSG_LOST = 'Wii remote disconnected. Press any button on it to reconnect.';
const MSG_NO_DRIVER = 'A Wii remote is connected over Bluetooth, but the kernel driver could not start for it. Run ./scripts/fix-driver.sh.';
const MSG_FIXING = 'The Wii remote is connected, but its driver did not start. Fixing that now. This takes a few seconds.';

// The bridge repairs the two usual problems by itself, so nobody has to run a script mid-demo.
// BOWLBANK_AUTO_FIX=0 turns that off.
const AUTO = !TEST_DEVICES && process.env.BOWLBANK_AUTO_FIX !== '0';
const FIX_SCRIPT = fileURLToPath(new URL('../scripts/fix-driver.sh', import.meta.url));
let fixing = false;
let lastFix = 0;
let connecting = false;
let lastConnect = 0;

// The driver could not start: tidy memory and restart the remote's input link.
function autoFix() {
  if (!AUTO || fixing || Date.now() - lastFix < 8000) return;
  fixing = true;
  console.log('The Wii remote driver did not start. Running scripts/fix-driver.sh.');
  const child = spawn(FIX_SCRIPT, { stdio: 'ignore' });
  const done = (code) => {
    fixing = false;
    lastFix = Date.now();
    console.log(code === 0 ? 'The driver is fixed.' : 'The driver fix did not work this time. Trying again shortly.');
  };
  child.on('exit', done);
  child.on('error', () => done(1));
}

// No remote is connected: ask Bluetooth to connect every Wii remote this laptop already knows.
// A remote that is flashing after 1+2 or SYNC waits for the laptop to make this call.
function autoConnect() {
  if (!AUTO || connecting || Date.now() - lastConnect < 6000) return;
  connecting = true;
  execFile('bluetoothctl', ['devices'], { timeout: 4000 }, (err, out) => {
    const macs = err ? [] : out.split('\n').filter((l) => /Nintendo RVL/i.test(l)).map((l) => l.split(' ')[1]);
    let left = macs.length;
    const finish = () => { connecting = false; lastConnect = Date.now(); };
    if (!left) { finish(); return; }
    for (const mac of macs) {
      execFile('bluetoothctl', ['connect', mac], { timeout: 9000 }, () => { if (--left === 0) finish(); });
    }
  });
}

const countsPerG = Number(process.env.BOWLBANK_ACCEL_COUNTS_PER_G) || DEFAULT_COUNTS_PER_G;
const norm = new Normalizer({ countsPerG, zero: accelZeroFromEnv() });
const server = startServer({ source: 'wii' });

// The remote in use: its HID id and one open reader per part.
let remote = null;
let everConnected = false;
let permissionProblem = null;

function deviceLabel(id) {
  // Made-up devices from the automated tests are always labelled, so they cannot pass as a real remote.
  if (TEST_DEVICES) return 'Test devices (not a real Wii remote)';
  const devtype = readHidAttr(id, 'devtype');
  return devtype && devtype !== 'pending' ? `Nintendo Wii Remote (${devtype})` : 'Nintendo Wii Remote';
}

function publish() {
  if (!remote) {
    server.setStatus({
      connected: false,
      device: null,
      sensors: { buttons: false, accel: false, gyro: false, ir: false },
      message: permissionProblem || (unboundWiiRemotes().length > 0 ? (AUTO ? MSG_FIXING : MSG_NO_DRIVER) : everConnected ? MSG_LOST : MSG_NONE),
    });
    return;
  }
  const has = (role) => Boolean(remote.readers[role]);
  const notes = [];
  if (!has('accel')) notes.push('The accelerometer is not readable.');
  if (!has('gyro')) notes.push('No MotionPlus, using the accelerometer only.');
  if (!has('ir')) notes.push('No IR camera, aim with the D-pad.');
  server.setStatus({
    connected: has('buttons') || has('accel'),
    device: deviceLabel(remote.id),
    sensors: { buttons: has('buttons'), accel: has('accel'), gyro: has('gyro'), ir: has('ir') },
    message: permissionProblem || ['Wii remote ready.', ...notes].join(' '),
  });
}

function detach() {
  if (!remote) return;
  const old = remote;
  remote = null;
  for (const reader of Object.values(old.readers)) reader.close();
  norm.reset();
  publish();
}

function openPart(role, path) {
  const owner = remote;
  owner.readers[role] = openEventDevice(
    path,
    (ev) => {
      for (const msg of norm.push(role, ev)) server.broadcast(msg);
    },
    (err) => {
      if (remote !== owner || owner.readers[role]?.path !== path) return;
      delete owner.readers[role];
      if (err && err.code === 'EACCES') {
        owner.denied.add(path);
        permissionProblem = `Cannot read ${path} (permission denied). Run: sudo usermod -aG input $USER, then log out and back in.`;
      }
      // Losing the buttons or the accelerometer means the remote itself is gone.
      // The MotionPlus and the IR camera can come and go.
      if ((role === 'buttons' || role === 'accel') && (!err || err.code !== 'EACCES')) detach();
      else publish();
    },
  );
  // The device is open, so the sensor is on. Ask where its axes are right now.
  if (ABS_CODES[role]) {
    const values = readAbsValues(path, ABS_CODES[role]);
    if (values) norm.seed(role, values);
  }
}

function scan() {
  const remotes = scanRemotes();
  if (remote && !remotes.some((r) => r.id === remote.id)) detach();
  if (!remote && remotes.length > 0) {
    remote = { id: remotes[0].id, readers: {}, denied: new Set() };
    everConnected = true;
    permissionProblem = null;
  }
  if (remote) {
    // Open any part that is new. A MotionPlus shows up a few seconds after the remote.
    const parts = remotes.find((r) => r.id === remote.id).parts;
    for (const [role, path] of Object.entries(parts)) {
      if (!remote.readers[role] && !remote.denied.has(path)) openPart(role, path);
    }
  }
  if (!remote) {
    if (unboundWiiRemotes().length > 0) autoFix(); else autoConnect();
  }
  publish();
}

server.ready.then(
  () => {
    console.log(`Bowlometrics bridge listening on ws://127.0.0.1:${server.port}`);
    if (TEST_DEVICES) console.log('TEST MODE: reading made-up devices. This is not a real Wii remote.');
    scan();
    setInterval(scan, SCAN_MS);
    setInterval(() => {
      if (!remote) return;
      for (const msg of [norm.flushSamples(), norm.flushIr()]) {
        if (msg) server.broadcast(msg);
      }
    }, FLUSH_MS);
  },
  (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${server.port} is in use. Another bridge is probably running. Stop it, or set BOWLBANK_BRIDGE_PORT.`);
    } else {
      console.error(`Could not start the bridge: ${err.message}`);
    }
    process.exit(1);
  },
);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
