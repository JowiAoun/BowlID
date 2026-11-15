#!/usr/bin/env node
// Hardware check for the Wii remote. It reads every sensor for a few seconds and reports
// what it really saw. "Detected" means the device exists. "Verified" means data arrived.
//
// Usage: node bridge/check.mjs [--seconds 6]

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { EV_KEY, EV_ABS, EV_SYN, SYN_REPORT, BUTTON_NAMES } from './evdev.mjs';
import { Normalizer } from './normalize.mjs';
import { scanRemotes, openEventDevice, readHidAttr, unboundWiiRemotes } from './reader.mjs';

const secondsIndex = process.argv.indexOf('--seconds');
const seconds = secondsIndex >= 0 ? Number(process.argv[secondsIndex + 1]) || 6 : 6;

const results = [];
const report = (state, label, detail, fix) => {
  results.push(state);
  const tag = { ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]', info: '[INFO]' }[state];
  console.log(`${tag} ${label}: ${detail}`);
  if (fix) console.log(`       Fix: ${fix}`);
};

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};

console.log('BowlBank controller check\n');

// Bluetooth adapter.
const btShow = run('bluetoothctl', ['show']);
if (btShow === null) {
  report('fail', 'Bluetooth', 'bluetoothctl is missing or not answering', 'sudo apt install bluez && sudo systemctl enable --now bluetooth');
} else if (!/Controller /.test(btShow)) {
  report('fail', 'Bluetooth', 'no Bluetooth adapter found', 'Turn Bluetooth on in Settings, or plug in a Bluetooth adapter.');
} else if (!/Powered: yes/.test(btShow)) {
  report('fail', 'Bluetooth', 'the adapter is off', 'bluetoothctl power on');
} else {
  report('ok', 'Bluetooth', 'adapter is on');
}

// Kernel driver. It loads by itself when a remote connects, so "not loaded" is fine with no remote.
const driverLoaded = fs.existsSync('/sys/module/hid_wiimote');
const driverAvailable = driverLoaded || run('modinfo', ['hid-wiimote']) !== null;
if (driverLoaded) report('ok', 'Driver', 'hid-wiimote is loaded');
else if (driverAvailable) report('info', 'Driver', 'hid-wiimote is installed and loads when a remote connects');
else report('fail', 'Driver', 'the hid-wiimote kernel module is missing', 'sudo apt install linux-modules-extra-$(uname -r)');

// Bluetooth connection.
const btConnected = run('bluetoothctl', ['devices', 'Connected']) || '';
const btRemote = btConnected.split('\n').find((l) => /Nintendo RVL/i.test(l));
if (btRemote) report('ok', 'Bluetooth link', `connected: ${btRemote.replace(/^Device /, '')}`);
else report('warn', 'Bluetooth link', 'no Wii remote is connected over Bluetooth', 'Run ./scripts/pair-wiimote.sh and press the red SYNC button under the battery cover.');

// Input devices from the driver.
const remotes = scanRemotes();
if (remotes.length === 0) {
  const unbound = unboundWiiRemotes();
  if (unbound.length > 0 || btRemote) {
    // The remote is connected, but the kernel driver did not make its input devices.
    const kernelLog = run('journalctl', ['-k', '-b', '--no-pager', '-g', 'wiimote']) || '';
    const noMemory = /Can't alloc device|failed with error -12/.test(kernelLog);
    report(
      'fail',
      'Wii remote',
      noMemory
        ? 'connected over Bluetooth, but the kernel driver could not start: it found no large free block of memory ("Can\'t alloc device" in the kernel log)'
        : 'connected over Bluetooth, but the kernel driver did not start for it',
      noMemory
        ? 'Run ./scripts/fix-driver.sh (no sudo). If that fails, close heavy apps, run: echo 1 | sudo tee /proc/sys/vm/compact_memory, then run it again. A reboot also fixes it.'
        : 'Run ./scripts/fix-driver.sh, then look at the kernel log: journalctl -k | grep -i wiimote',
    );
  } else {
    report('fail', 'Wii remote', 'no Wii remote input devices found', 'Pair the remote first: ./scripts/pair-wiimote.sh');
  }
  console.log('\nResult: no remote to test. Nothing was verified.');
  process.exit(1);
}
const remote = remotes[0];
const devtype = readHidAttr(remote.id, 'devtype');
const extension = readHidAttr(remote.id, 'extension');
report('ok', 'Wii remote', `detected (${remote.id}, type: ${devtype || 'unknown'}, extension: ${extension || 'unknown'})`);
if (remotes.length > 1) report('info', 'Wii remote', `${remotes.length} remotes are connected. Testing the first one.`);

// Read every part for a few seconds.
const ROLES = ['buttons', 'accel', 'gyro', 'ir'];
const seen = Object.fromEntries(ROLES.map((r) => [r, { opened: false, error: null, frames: 0 }]));
const pressed = new Set();
const norm = new Normalizer();
let accelSum = 0;
let accelCount = 0;
let lastAccel = null;
let gyroPeak = 0;
let irFramesWithLight = 0;
let irMaxPoints = 0;
let firstAccelMs = null;
let lastAccelMs = null;

const readers = [];
for (const role of ROLES) {
  const path = remote.parts[role];
  if (!path) continue;
  try {
    fs.accessSync(path, fs.constants.R_OK);
  } catch (err) {
    seen[role].error = err;
    continue;
  }
  seen[role].opened = true;
  readers.push(openEventDevice(
    path,
    (ev) => {
      norm.push(role, ev);
      const frame = ev.type === EV_SYN && ev.code === SYN_REPORT;
      if (role === 'buttons' && ev.type === EV_KEY && ev.value === 1 && BUTTON_NAMES[ev.code]) {
        pressed.add(BUTTON_NAMES[ev.code]);
        seen.buttons.frames += 1;
      } else if (role === 'accel' && frame) {
        seen.accel.frames += 1;
        firstAccelMs ??= ev.ms;
        lastAccelMs = ev.ms;
        lastAccel = [...norm.accel];
        accelSum += Math.hypot(...norm.accel);
        accelCount += 1;
      } else if (role === 'gyro' && frame) {
        seen.gyro.frames += 1;
        gyroPeak = Math.max(gyroPeak, ...norm.gyro.map(Math.abs));
      } else if (role === 'ir' && frame) {
        seen.ir.frames += 1;
        const pts = norm.irPoints().length;
        if (pts > 0) irFramesWithLight += 1;
        irMaxPoints = Math.max(irMaxPoints, pts);
      } else if (ev.type === EV_ABS || ev.type === EV_KEY) {
        // Values are taken in by the normalizer above.
      }
    },
    (err) => {
      if (err) seen[role].error = err;
    },
  ));
}

console.log(`\nReading the remote for ${seconds} seconds.`);
console.log('Press some buttons, move the remote, and point it at the sensor bar.\n');
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

const permissionFix = 'sudo usermod -aG input $USER, then log out and back in.';
const errorText = (err) => (err.code === 'EACCES' ? 'permission denied' : err.code === 'ENODEV' ? 'the remote disconnected during the check' : err.message);
const errorFix = (err) => (err.code === 'EACCES' ? permissionFix : 'Press a button on the remote to reconnect, then run this check again.');

// Buttons.
if (!remote.parts.buttons) report('fail', 'Buttons', 'not detected', 'Reconnect the remote.');
else if (seen.buttons.error) report('fail', 'Buttons', `detected, but not readable (${errorText(seen.buttons.error)})`, errorFix(seen.buttons.error));
else if (pressed.size > 0) report('ok', 'Buttons', `verified working (${seen.buttons.frames} presses: ${[...pressed].join(', ')})`);
else report('warn', 'Buttons', 'detected and readable, but no press was seen', 'Press A or B on the remote while the check runs.');

// Accelerometer.
if (!remote.parts.accel) report('fail', 'Accelerometer', 'not detected', 'Reconnect the remote.');
else if (seen.accel.error) report('fail', 'Accelerometer', `detected, but not readable (${errorText(seen.accel.error)})`, errorFix(seen.accel.error));
else if (seen.accel.frames > 0) {
  const span = (lastAccelMs - firstAccelMs) / 1000;
  const rate = span > 0.5 ? ` about ${Math.round((seen.accel.frames - 1) / span)} per second,` : '';
  const mean = (accelSum / accelCount).toFixed(2);
  const last = lastAccel.map((v) => v.toFixed(2)).join(', ');
  report('ok', 'Accelerometer', `verified working (${seen.accel.frames} samples,${rate} mean size ${mean} g, last [${last}] g)`);
  if (accelCount > 20 && (mean < 0.8 || mean > 1.25) && seen.accel.frames < seconds * 30) {
    report('info', 'Accelerometer', `a still remote should read close to 1.00 g. Set BOWLBANK_ACCEL_COUNTS_PER_G=${Math.round(104 * mean)} to correct it.`);
  }
} else report('warn', 'Accelerometer', 'detected and readable, but no samples arrived', 'Move the remote while the check runs. The kernel only reports changes.');

// MotionPlus.
if (!remote.parts.gyro) report('info', 'MotionPlus', 'not attached. The app works without it, using the accelerometer only. If one is plugged in, push it in fully and wait 5 seconds.');
else if (seen.gyro.error) report('fail', 'MotionPlus', `detected, but not readable (${errorText(seen.gyro.error)})`, errorFix(seen.gyro.error));
else if (seen.gyro.frames > 0) report('ok', 'MotionPlus', `verified working (${seen.gyro.frames} samples, peak ${gyroPeak.toFixed(0)} deg/s)`);
else report('warn', 'MotionPlus', 'detected and readable, but no samples arrived', 'Turn the remote while the check runs.');

// IR camera.
if (!remote.parts.ir) report('warn', 'Infrared', 'not detected', 'Reconnect the remote. Aiming falls back to the D-pad.');
else if (seen.ir.error) report('fail', 'Infrared', `detected, but not readable (${errorText(seen.ir.error)})`, errorFix(seen.ir.error));
else if (irFramesWithLight > 0) report('ok', 'Infrared', `verified working (${irFramesWithLight} frames with light, up to ${irMaxPoints} points at once)`);
else report('warn', 'Infrared', 'camera detected and readable, but it saw no infrared light', 'Plug in the sensor bar and point the remote at it from 1 to 3 metres. Aiming falls back to the D-pad.');

const fails = results.filter((r) => r === 'fail').length;
const warns = results.filter((r) => r === 'warn').length;
const accelOk = seen.accel.frames > 0;
console.log(`\nResult: ${fails} failed, ${warns} to look at. ${accelOk && fails === 0 ? 'The remote can be used to bowl.' : 'The remote is not ready yet.'}`);
process.exit(accelOk && fails === 0 ? 0 : 1);
