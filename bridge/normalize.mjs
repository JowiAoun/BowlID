// Turns raw evdev events from the Wii remote into the messages the browser reads.
// No file or network access here, so tests run without hardware.

import {
  EV_SYN, EV_KEY, EV_ABS, SYN_REPORT,
  ABS_RX, ABS_RY, ABS_RZ, ABS_HAT0X, ABS_HAT3Y, BUTTON_NAMES,
} from './evdev.mjs';

// The driver reports the 10-bit accelerometer value minus 0x200. A remote reads about
// 104 counts per g. Each remote is a little different and the driver applies no calibration.
export const DEFAULT_COUNTS_PER_G = 104;

// From the driver: MotionPlus values are scaled to 8192 * 9 / 440 units per deg/s.
export const GYRO_UNITS_PER_DPS = (8192 * 9) / 440;

// The IR camera is 1024 x 768. A slot with no light reads 1023.
const IR_MAX_X = 1023;
const IR_MAX_Y = 767;
const IR_NO_POINT = 1023;

// A gyro reading older than this is dropped, so a detached MotionPlus stops showing up.
const GYRO_STALE_MS = 250;
const IR_MIN_INTERVAL_MS = 20;

const round = (v, places) => {
  const k = 10 ** places;
  return Math.round(v * k) / k;
};

export class Normalizer {
  constructor({ countsPerG = DEFAULT_COUNTS_PER_G, now = () => performance.now() } = {}) {
    this.countsPerG = countsPerG;
    this.now = now;
    this.reset();
  }

  reset() {
    this.clockOffset = null;
    this.lastT = 0;
    this.accel = [0, 0, 0];
    this.hasAccel = false;
    this.gyro = [0, 0, 0];
    this.gyroT = -Infinity;
    this.irRaw = new Array(8).fill(IR_NO_POINT);
    this.lastIrT = -Infinity;
    this.irHeld = false;
    this.pending = [];
    this.lastSampleT = -Infinity;
  }

  // Map an event timestamp onto one clock that starts near `now()` and never goes back.
  // Event times are wall-clock, so a clock change is caught and the offset is redone.
  time(eventMs) {
    const now = this.now();
    if (this.clockOffset === null || Math.abs(eventMs - this.clockOffset - now) > 1000) {
      this.clockOffset = eventMs - now;
    }
    const t = Math.max(this.lastT, eventMs - this.clockOffset);
    this.lastT = t;
    return t;
  }

  gyroNow(t) {
    return t - this.gyroT <= GYRO_STALE_MS ? this.gyro : [null, null, null];
  }

  pushSample(t) {
    const [gx, gy, gz] = this.gyroNow(t);
    this.pending.push([round(t, 2), this.accel[0], this.accel[1], this.accel[2], gx, gy, gz]);
    this.lastSampleT = t;
  }

  // Feed one event from one part of the remote. Returns messages to send right away.
  push(role, ev) {
    const out = [];
    if (role === 'buttons') {
      // Value 2 is key repeat. Only presses and releases matter.
      if (ev.type === EV_KEY && BUTTON_NAMES[ev.code] && ev.value !== 2) {
        out.push({ type: 'button', t: round(this.time(ev.ms), 2), name: BUTTON_NAMES[ev.code], down: ev.value === 1 });
      }
    } else if (role === 'accel') {
      if (ev.type === EV_ABS) {
        const g = round(ev.value / this.countsPerG, 4);
        if (ev.code === ABS_RX) this.accel[0] = g;
        else if (ev.code === ABS_RY) this.accel[1] = g;
        else if (ev.code === ABS_RZ) this.accel[2] = g;
        this.hasAccel = true;
      } else if (ev.type === EV_SYN && ev.code === SYN_REPORT && this.hasAccel) {
        this.pushSample(this.time(ev.ms));
      }
    } else if (role === 'gyro') {
      if (ev.type === EV_ABS) {
        // The driver reports yaw on RX, roll on RY and pitch on RZ. They are stored as
        // [pitch, roll, yaw] so each one is the turn rate around the matching accel axis.
        const dps = round(ev.value / GYRO_UNITS_PER_DPS, 2);
        if (ev.code === ABS_RZ) this.gyro[0] = dps;
        else if (ev.code === ABS_RY) this.gyro[1] = dps;
        else if (ev.code === ABS_RX) this.gyro[2] = dps;
      } else if (ev.type === EV_SYN && ev.code === SYN_REPORT) {
        this.gyroT = this.time(ev.ms);
      }
    } else if (role === 'ir') {
      if (ev.type === EV_ABS && ev.code >= ABS_HAT0X && ev.code <= ABS_HAT3Y) {
        this.irRaw[ev.code - ABS_HAT0X] = ev.value;
      } else if (ev.type === EV_SYN && ev.code === SYN_REPORT) {
        const t = this.time(ev.ms);
        if (t - this.lastIrT >= IR_MIN_INTERVAL_MS) {
          this.lastIrT = t;
          this.irHeld = false;
          out.push({ type: 'ir', t: round(t, 2), pts: this.irPoints() });
        } else {
          // Too soon after the last one. Keep it for flushIr, so the newest state is never lost.
          this.irHeld = true;
        }
      }
    }
    return out;
  }

  // Visible IR points as 0..1. X is mirrored so pointing right gives a larger x.
  irPoints() {
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const x = this.irRaw[i * 2];
      const y = this.irRaw[i * 2 + 1];
      if (x >= IR_NO_POINT || y >= IR_NO_POINT) continue;
      pts.push([round(1 - x / IR_MAX_X, 4), round(Math.min(1, y / IR_MAX_Y), 4)]);
    }
    return pts;
  }

  // Called about every 20 ms. Returns the IR message that was held back, or null.
  // The kernel only reports changes, so the last frame before the light is lost must go out.
  flushIr() {
    if (!this.irHeld) return null;
    const t = Math.max(this.lastT, this.now());
    if (t - this.lastIrT < IR_MIN_INTERVAL_MS) return null;
    this.lastT = t;
    this.lastIrT = t;
    this.irHeld = false;
    return { type: 'ir', t: round(t, 2), pts: this.irPoints() };
  }

  // Called about every 20 ms. Returns a `samples` message, or null when there is none.
  // The kernel sends nothing while a value does not change, so a still remote would go
  // quiet. In that case the last real reading is sent again with the current time.
  flushSamples() {
    if (this.pending.length === 0 && this.hasAccel) {
      const t = Math.max(this.lastT, this.now());
      if (t - this.lastSampleT >= 15) {
        this.lastT = t;
        this.pushSample(t);
      }
    }
    if (this.pending.length === 0) return null;
    const s = this.pending;
    this.pending = [];
    return { type: 'samples', s };
  }
}
