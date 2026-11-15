import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInputEvents, encodeInputEvent, parseProcDevices, findWiiRemotes, wiimoteRole,
  hidIdFromSysfs, INPUT_EVENT_SIZE, EV_ABS, EV_KEY, EV_SYN, ABS_RX,
} from '../../bridge/evdev.mjs';

// A cut-down /proc/bus/input/devices with a laptop keyboard and one remote with MotionPlus.
const PROC = `I: Bus=0011 Vendor=0001 Product=0001 Version=ab83
N: Name="AT Translated Set 2 keyboard"
P: Phys=isa0060/serio0/input0
S: Sysfs=/devices/platform/i8042/serio0/input/input3
U: Uniq=
H: Handlers=sysrq kbd event3 leds
B: EV=120013

I: Bus=0005 Vendor=057e Product=0306 Version=8600
N: Name="Nintendo Wii Remote Accelerometer"
P: Phys=
S: Sysfs=/devices/virtual/misc/uhid/0005:057E:0306.0007/input/input31
U: Uniq=
H: Handlers=event20 js1
B: EV=9

I: Bus=0005 Vendor=057e Product=0306 Version=8600
N: Name="Nintendo Wii Remote IR"
P: Phys=
S: Sysfs=/devices/virtual/misc/uhid/0005:057E:0306.0007/input/input32
U: Uniq=
H: Handlers=event21
B: EV=9

I: Bus=0005 Vendor=057e Product=0306 Version=8600
N: Name="Nintendo Wii Remote"
P: Phys=
S: Sysfs=/devices/virtual/misc/uhid/0005:057E:0306.0007/input/input30
U: Uniq=
H: Handlers=kbd event19
B: EV=200003

I: Bus=0005 Vendor=057e Product=0306 Version=8600
N: Name="Nintendo Wii Remote Motion Plus"
P: Phys=
S: Sysfs=/devices/virtual/misc/uhid/0005:057E:0306.0007/input/input33
U: Uniq=
H: Handlers=event22 js2
B: EV=9

I: Bus=0005 Vendor=057e Product=0306 Version=8600
N: Name="Nintendo Wii Remote Nunchuk"
P: Phys=
S: Sysfs=/devices/virtual/misc/uhid/0005:057E:0306.0007/input/input34
U: Uniq=
H: Handlers=event23 js3
B: EV=b
`;

test('parseInputEvents reads whole events and keeps the partial one', () => {
  const a = encodeInputEvent({ ms: 1700000000123.5, type: EV_ABS, code: ABS_RX, value: -104 });
  const b = encodeInputEvent({ ms: 1700000000133, type: EV_SYN, code: 0, value: 0 });
  const { events, rest } = parseInputEvents(Buffer.concat([a, b, Buffer.from([1, 2, 3])]));
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { ms: 1700000000123.5, type: EV_ABS, code: ABS_RX, value: -104 });
  assert.equal(events[1].type, EV_SYN);
  assert.equal(rest.length, 3);
});

test('parseInputEvents joins an event split across two reads', () => {
  const full = encodeInputEvent({ ms: 5000, type: EV_KEY, code: 0x131, value: 1 });
  const first = parseInputEvents(full.subarray(0, 10));
  assert.equal(first.events.length, 0);
  const second = parseInputEvents(Buffer.concat([first.rest, full.subarray(10)]));
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].code, 0x131);
  assert.equal(second.rest.length, 0);
  assert.equal(full.length, INPUT_EVENT_SIZE);
});

test('parseProcDevices finds names and event nodes', () => {
  const devices = parseProcDevices(PROC);
  assert.equal(devices.length, 6);
  assert.equal(devices[0].name, 'AT Translated Set 2 keyboard');
  assert.equal(devices[0].event, 'event3');
  assert.equal(devices[1].event, 'event20');
});

test('findWiiRemotes groups the four parts of one remote', () => {
  const remotes = findWiiRemotes(parseProcDevices(PROC));
  assert.equal(remotes.length, 1);
  assert.equal(remotes[0].id, '0005:057E:0306.0007');
  assert.deepEqual(remotes[0].parts, {
    accel: '/dev/input/event20',
    ir: '/dev/input/event21',
    buttons: '/dev/input/event19',
    gyro: '/dev/input/event22',
  });
});

test('findWiiRemotes keeps two remotes apart and handles none', () => {
  const second = PROC.replaceAll('0306.0007', '0306.0009').replaceAll(/event(\d+)/g, (_, n) => `event${Number(n) + 20}`);
  assert.equal(findWiiRemotes(parseProcDevices(`${PROC}\n${second}`)).length, 2);
  assert.deepEqual(findWiiRemotes(parseProcDevices('')), []);
});

test('a remote without MotionPlus has no gyro part', () => {
  const noMp = PROC.split('\n\n').filter((b) => !b.includes('Motion Plus')).join('\n\n');
  const [remote] = findWiiRemotes(parseProcDevices(noMp));
  assert.equal(remote.parts.gyro, undefined);
  assert.ok(remote.parts.accel);
});

test('wiimoteRole ignores extensions and other devices', () => {
  assert.equal(wiimoteRole('Nintendo Wii Remote'), 'buttons');
  assert.equal(wiimoteRole('Nintendo Wii Remote Nunchuk'), null);
  assert.equal(wiimoteRole('AT Translated Set 2 keyboard'), null);
  assert.equal(hidIdFromSysfs('/devices/platform/i8042/serio0/input/input3'), null);
});
