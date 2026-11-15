// Finds the Wii remote's input devices and reads their raw events.

import fs from 'node:fs';
import { parseInputEvents, parseProcDevices, findWiiRemotes } from './evdev.mjs';

export const PROC_DEVICES = '/proc/bus/input/devices';

// The remotes the kernel driver has set up right now. Empty when none is connected.
export function scanRemotes() {
  try {
    return findWiiRemotes(parseProcDevices(fs.readFileSync(PROC_DEVICES, 'utf8')));
  } catch {
    return [];
  }
}

// Read one /dev/input/eventN device. Opening it is what makes the driver turn that
// sensor on. `onEnd` gets the error, or null when the device just closed.
export function openEventDevice(path, onEvent, onEnd) {
  let rest = Buffer.alloc(0);
  let ended = false;
  const stream = fs.createReadStream(path, { highWaterMark: 24 * 64 });

  const end = (err) => {
    if (ended) return;
    ended = true;
    stream.destroy();
    onEnd(err || null);
  };

  stream.on('data', (chunk) => {
    const parsed = parseInputEvents(rest.length ? Buffer.concat([rest, chunk]) : chunk);
    rest = Buffer.from(parsed.rest);
    for (const ev of parsed.events) onEvent(ev);
  });
  stream.on('error', end);
  stream.on('end', () => end(null));

  return { path, close: () => end(null) };
}

// Read a small sysfs file of the remote, like `devtype` or `extension`.
export function readHidAttr(hidId, attr) {
  try {
    return fs.readFileSync(`/sys/bus/hid/devices/${hidId}/${attr}`, 'utf8').trim();
  } catch {
    return null;
  }
}
