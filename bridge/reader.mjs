// Finds the Wii remote's input devices and reads their raw events.

import fs from 'node:fs';
import { parseInputEvents, parseProcDevices, findWiiRemotes, isWiimoteHidId } from './evdev.mjs';

// The automated tests point these at made-up devices. Nothing else should set them.
export const TEST_DEVICES = Boolean(process.env.BOWLBANK_TEST_PROC_DEVICES);
export const PROC_DEVICES = process.env.BOWLBANK_TEST_PROC_DEVICES || '/proc/bus/input/devices';
const INPUT_DIR = process.env.BOWLBANK_TEST_INPUT_DIR || '/dev/input';

// The remotes the kernel driver has set up right now. Empty when none is connected.
export function scanRemotes() {
  try {
    return findWiiRemotes(parseProcDevices(fs.readFileSync(PROC_DEVICES, 'utf8')), INPUT_DIR);
  } catch {
    return [];
  }
}

const POLL_MS = 4;
const READ_BYTES = 24 * 256;
const open = new Set();
let pollTimer = null;

// Read everything waiting on every open device. The devices are opened non-blocking and
// polled, because a blocking read cannot be cancelled and would stop the process from exiting.
function pollAll() {
  for (const dev of [...open]) {
    for (;;) {
      let n;
      try {
        n = fs.readSync(dev.fd, dev.buf, 0, READ_BYTES, null);
      } catch (err) {
        if (err.code !== 'EAGAIN') dev.end(err);
        break;
      }
      if (n === 0) {
        dev.end(null);
        break;
      }
      const chunk = dev.buf.subarray(0, n);
      const parsed = parseInputEvents(dev.rest.length ? Buffer.concat([dev.rest, chunk]) : chunk);
      dev.rest = Buffer.from(parsed.rest);
      for (const ev of parsed.events) dev.onEvent(ev);
      if (!open.has(dev) || n < READ_BYTES) break;
    }
  }
}

// Read one /dev/input/eventN device. Opening it is what makes the driver turn that
// sensor on. `onEnd` gets the error (EACCES, ENODEV...), or null when the device closed.
export function openEventDevice(path, onEvent, onEnd) {
  const dev = { path, fd: -1, buf: Buffer.alloc(READ_BYTES), rest: Buffer.alloc(0), onEvent, end: null };
  let ended = false;
  dev.end = (err) => {
    if (ended) return;
    ended = true;
    open.delete(dev);
    if (dev.fd >= 0) {
      try {
        fs.closeSync(dev.fd);
      } catch {
        // The device is already gone.
      }
    }
    if (open.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    onEnd(err || null);
  };

  try {
    dev.fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  } catch (err) {
    // Report on the next tick, the same way a later read error arrives.
    setImmediate(() => dev.end(err));
    return { path, close: () => dev.end(null) };
  }
  open.add(dev);
  pollTimer ??= setInterval(pollAll, POLL_MS);
  return { path, close: () => dev.end(null) };
}

// Read a small sysfs file of the remote, like `devtype` or `extension`.
export function readHidAttr(hidId, attr) {
  try {
    return fs.readFileSync(`/sys/bus/hid/devices/${hidId}/${attr}`, 'utf8').trim();
  } catch {
    return null;
  }
}

// Wii remotes that are connected over Bluetooth but have no kernel driver attached.
// This happens when the hid-wiimote driver failed to start for that remote.
export function unboundWiiRemotes() {
  if (TEST_DEVICES) return [];
  try {
    return fs.readdirSync('/sys/bus/hid/devices')
      .filter(isWiimoteHidId)
      .filter((id) => !fs.existsSync(`/sys/bus/hid/devices/${id}/driver`));
  } catch {
    return [];
  }
}
