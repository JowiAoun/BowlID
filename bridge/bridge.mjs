#!/usr/bin/env node
// BowlBank input bridge. Reads a real Wii remote through the kernel hid-wiimote driver
// and sends its buttons, motion and IR points to the browser on ws://127.0.0.1:8765.
// It never makes data up. With no remote, it says so and keeps looking.

import { Normalizer, DEFAULT_COUNTS_PER_G } from './normalize.mjs';
import { scanRemotes, openEventDevice, readHidAttr, unboundWiiRemotes } from './reader.mjs';
import { startServer } from './server.mjs';

const SCAN_MS = 1000;
const FLUSH_MS = 20;

const MSG_NONE = 'No Wii remote found. Press 1+2 on the remote, or run ./scripts/pair-wiimote.sh.';
const MSG_LOST = 'Wii remote disconnected. Press any button on it to reconnect.';
const MSG_NO_DRIVER = 'A Wii remote is connected over Bluetooth, but the kernel driver could not start for it. Run ./scripts/fix-driver.sh.';

const countsPerG = Number(process.env.BOWLBANK_ACCEL_COUNTS_PER_G) || DEFAULT_COUNTS_PER_G;
const norm = new Normalizer({ countsPerG });
const server = startServer({ source: 'wii' });

// The remote in use: its HID id and one open reader per part.
let remote = null;
let everConnected = false;
let permissionProblem = null;

function deviceLabel(id) {
  const devtype = readHidAttr(id, 'devtype');
  return devtype && devtype !== 'pending' ? `Nintendo Wii Remote (${devtype})` : 'Nintendo Wii Remote';
}

function publish() {
  if (!remote) {
    server.setStatus({
      connected: false,
      device: null,
      sensors: { buttons: false, accel: false, gyro: false, ir: false },
      message: permissionProblem || (unboundWiiRemotes().length > 0 ? MSG_NO_DRIVER : everConnected ? MSG_LOST : MSG_NONE),
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
  publish();
}

server.ready.then(
  () => {
    console.log(`BowlBank bridge listening on ws://127.0.0.1:${server.port}`);
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
