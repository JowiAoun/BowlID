// Pure parsing for Linux evdev data. No file access here, so tests run without hardware.
// Codes come from linux/input-event-codes.h and drivers/hid/hid-wiimote-modules.c.

export const EV_SYN = 0x00;
export const EV_KEY = 0x01;
export const EV_ABS = 0x03;
export const SYN_REPORT = 0;

export const ABS_RX = 0x03;
export const ABS_RY = 0x04;
export const ABS_RZ = 0x05;
export const ABS_HAT0X = 0x10;
export const ABS_HAT3Y = 0x17;

// The key codes hid-wiimote reports for the buttons on the remote itself.
export const BUTTON_NAMES = {
  105: 'LEFT',
  106: 'RIGHT',
  103: 'UP',
  108: 'DOWN',
  0x197: 'PLUS',
  0x19c: 'MINUS',
  0x101: '1',
  0x102: '2',
  0x130: 'A',
  0x131: 'B',
  0x13c: 'HOME',
};

export const WIIMOTE_NAME = 'Nintendo Wii Remote';

// struct input_event on 64-bit Linux: s64 sec, s64 usec, u16 type, u16 code, s32 value.
export const INPUT_EVENT_SIZE = 24;

// Parse as many whole events as the buffer holds. `rest` is the leftover partial event.
export function parseInputEvents(buf) {
  const events = [];
  const whole = buf.length - (buf.length % INPUT_EVENT_SIZE);
  for (let off = 0; off < whole; off += INPUT_EVENT_SIZE) {
    const sec = Number(buf.readBigInt64LE(off));
    const usec = Number(buf.readBigInt64LE(off + 8));
    events.push({
      ms: sec * 1000 + usec / 1000,
      type: buf.readUInt16LE(off + 16),
      code: buf.readUInt16LE(off + 18),
      value: buf.readInt32LE(off + 20),
    });
  }
  return { events, rest: buf.subarray(whole) };
}

// Build one event buffer. Used by tests and by nothing else.
export function encodeInputEvent({ ms = 0, type, code, value }) {
  const buf = Buffer.alloc(INPUT_EVENT_SIZE);
  const sec = Math.floor(ms / 1000);
  buf.writeBigInt64LE(BigInt(sec), 0);
  buf.writeBigInt64LE(BigInt(Math.round((ms - sec * 1000) * 1000)), 8);
  buf.writeUInt16LE(type, 16);
  buf.writeUInt16LE(code, 18);
  buf.writeInt32LE(value, 20);
  return buf;
}

// Parse the text of /proc/bus/input/devices into one object per input device.
export function parseProcDevices(text) {
  const devices = [];
  for (const block of text.split(/\n\s*\n/)) {
    const dev = { name: '', sysfs: '', uniq: '', phys: '', handlers: [], event: null };
    for (const line of block.split('\n')) {
      const m = /^([A-Z]): (.*)$/.exec(line.trim());
      if (!m) continue;
      const [, tag, body] = m;
      if (tag === 'N') dev.name = (/Name="(.*)"/.exec(body) || [])[1] || '';
      else if (tag === 'S') dev.sysfs = body.replace(/^Sysfs=/, '');
      else if (tag === 'U') dev.uniq = body.replace(/^Uniq=/, '');
      else if (tag === 'P') dev.phys = body.replace(/^Phys=/, '');
      else if (tag === 'H') {
        dev.handlers = body.replace(/^Handlers=/, '').trim().split(/\s+/).filter(Boolean);
        dev.event = dev.handlers.find((h) => /^event\d+$/.test(h)) || null;
      }
    }
    if (dev.name) devices.push(dev);
  }
  return devices;
}

// Which part of the remote an input device is, from its name.
export function wiimoteRole(name) {
  if (name === WIIMOTE_NAME) return 'buttons';
  if (name === `${WIIMOTE_NAME} Accelerometer`) return 'accel';
  if (name === `${WIIMOTE_NAME} IR`) return 'ir';
  if (name === `${WIIMOTE_NAME} Motion Plus`) return 'gyro';
  return null;
}

// The HID device id in a sysfs path, like "0005:057E:0306.0007". One per remote.
export function hidIdFromSysfs(sysfs) {
  return (/\/([0-9A-Fa-f]{4}:[0-9A-Fa-f]{4}:[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4})\//.exec(sysfs) || [])[1] || null;
}

// Group Wii remote input devices by remote. Each remote has up to four parts.
export function findWiiRemotes(devices) {
  const remotes = new Map();
  for (const dev of devices) {
    const role = wiimoteRole(dev.name);
    if (!role || !dev.event) continue;
    const id = hidIdFromSysfs(dev.sysfs) || dev.uniq || dev.phys || 'wiimote';
    if (!remotes.has(id)) remotes.set(id, { id, parts: {} });
    remotes.get(id).parts[role] = `/dev/input/${dev.event}`;
  }
  return [...remotes.values()];
}

// True for the HID id of a Wii remote (product 0306) or a Wii Remote Plus (product 0330) on Bluetooth.
export function isWiimoteHidId(id) {
  return /^0005:057E:(0306|0330)\.[0-9A-F]{4}$/i.test(id);
}
