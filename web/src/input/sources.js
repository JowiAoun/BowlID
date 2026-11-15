// Input sources. Each one reports the same four things: samples, press, release and aim.
// The game and the matcher never know which source is active.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

class Source {
  constructor(kind) {
    this.kind = kind;
    this.handlers = {};
  }
  on(name, fn) { this.handlers[name] = fn; return this; }
  emit(name, ...args) { if (this.handlers[name]) this.handlers[name](...args); }
  start() {}
  stop() {}
}

// The real Wii remote, through the local bridge.
export class WiiSource extends Source {
  constructor(url) {
    super('wii');
    this.url = url;
    this.ws = null;
    this.alive = false;
    this.status = { connected: false, bridge: false, sensors: {}, message: 'Looking for the bridge.' };
    this.aim = 0;
    this.irCentre = 0.5;
    this.irX = null;
    this.lastIr = 0;
    this.held = { LEFT: false, RIGHT: false };
  }

  start() {
    this.alive = true;
    this.connect();
    // The D-pad moves the aim while it is held.
    this.pad = setInterval(() => {
      const dir = (this.held.RIGHT ? 1 : 0) - (this.held.LEFT ? 1 : 0);
      if (dir) this.setAim(this.aim + dir * 0.03);
    }, 30);
  }

  stop() {
    this.alive = false;
    clearInterval(this.pad);
    clearTimeout(this.retry);
    if (this.ws) this.ws.close();
  }

  connect() {
    if (!this.alive) return;
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.schedule(); return; }
    this.ws = ws;
    ws.onmessage = (ev) => this.handle(JSON.parse(ev.data));
    ws.onclose = () => {
      this.setStatus({ connected: false, bridge: false, sensors: {}, message: 'The Wii remote bridge is not running.' });
      this.schedule();
    };
    ws.onerror = () => ws.close();
  }

  schedule() {
    clearTimeout(this.retry);
    if (this.alive) this.retry = setTimeout(() => this.connect(), 1500);
  }

  setStatus(s) {
    this.status = s;
    this.emit('status', s);
  }

  setAim(a) {
    this.aim = clamp(a, -1, 1);
    this.emit('aim', this.aim);
  }

  handle(msg) {
    if (msg.type === 'samples') {
      this.emit('samples', msg.s);
    } else if (msg.type === 'button') {
      if (msg.name === 'B') this.emit(msg.down ? 'press' : 'release', msg.t);
      else if (msg.name === 'LEFT' || msg.name === 'RIGHT') this.held[msg.name] = msg.down;
      else if (msg.name === '1' && msg.down && this.irX != null) this.irCentre = this.irX;
      this.emit('button', msg.name, msg.down);
    } else if (msg.type === 'ir') {
      if (!msg.pts.length) return;
      const x = this.barCentre(msg.pts);
      // Filter hard when the pointer is nearly still, and lightly when it moves, so it is steady but not slow.
      const k = this.irX == null ? 1 : clamp(0.1 + Math.abs(x - this.irX) * 7, 0.1, 0.7);
      this.irX = this.irX == null ? x : this.irX + (x - this.irX) * k;
      this.lastIr = performance.now();
      this.setAim((this.irX - this.irCentre) * 2.2);
    } else if (msg.type === 'status') {
      this.setStatus({ ...msg, bridge: true });
    }
  }

  // The middle of the sensor bar. When one of its two lights drops out of view,
  // the last known gap between them keeps the middle from jumping.
  barCentre(pts) {
    const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
    if (xs.length >= 2) {
      const left = xs[0];
      const right = xs[xs.length - 1];
      this.irHalf = (right - left) / 2;
      this.irEnds = [left, right];
      return (left + right) / 2;
    }
    if (this.irHalf == null) return xs[0];
    const isLeft = Math.abs(xs[0] - this.irEnds[0]) <= Math.abs(xs[0] - this.irEnds[1]);
    this.irEnds = isLeft ? [xs[0], xs[0] + this.irHalf * 2] : [xs[0] - this.irHalf * 2, xs[0]];
    return isLeft ? xs[0] + this.irHalf : xs[0] - this.irHalf;
  }

  irActive() { return performance.now() - this.lastIr < 1500; }
}

// Demo mode. The pointer stands in for the remote: its speed changes become the swing signal.
// Pointer positions are kept with their own timestamps and resampled at 100 Hz,
// so the signal is the same on a fast laptop and on a slow one.
const GRID_MS = 10;
const LAG_MS = 24;

export class MouseSource extends Source {
  constructor(element) {
    super('mouse');
    this.el = element;
    this.down = false;
    this.track = [];
    this.gridT = null;
    this.gridPos = null;
    this.vel = [0, 0];
    this.acc = [0, 0];
    this.flush = this.flush.bind(this);
    this.frame = this.frame.bind(this);
    this.move = this.move.bind(this);
    this.press = this.press.bind(this);
    this.release = this.release.bind(this);
  }

  start() {
    this.running = true;
    this.el.addEventListener('pointermove', this.move);
    this.el.addEventListener('pointerdown', this.press);
    window.addEventListener('pointerup', this.release);
    window.addEventListener('pointercancel', this.release);
    this.emit('status', { connected: true, bridge: false, sensors: { accel: true }, message: 'Demo mode. Your pointer is the remote.' });
    this.timer = setInterval(this.flush, GRID_MS);
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerdown', this.press);
    window.removeEventListener('pointerup', this.release);
    window.removeEventListener('pointercancel', this.release);
  }

  frame() {
    if (!this.running) return;
    this.flush();
    requestAnimationFrame(this.frame);
  }

  where(ev) {
    const r = this.el.getBoundingClientRect();
    // Both axes are measured in lane heights, so the swing does not depend on the window size.
    return [(ev.clientX - r.left - r.width / 2) / r.height, (ev.clientY - r.top) / r.height, r.width / r.height];
  }

  move(ev) {
    // The browser may bundle several pointer positions into one event. Keep them all.
    const parts = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
    for (const e of parts.length ? parts : [ev]) {
      const [x, y] = this.where(e);
      const t = e.timeStamp || ev.timeStamp;
      const last = this.track[this.track.length - 1];
      if (!last || t > last[0]) this.track.push([t, x, y]);
    }
    if (!this.down) {
      const [x, , ratio] = this.where(ev);
      this.emit('aim', clamp((x / ratio) * 2.4, -1, 1));
    }
  }

  press(ev) {
    if (ev.button > 0) return;
    ev.preventDefault();
    this.el.setPointerCapture?.(ev.pointerId);
    this.move(ev);
    this.down = true;
    this.emit('press', ev.timeStamp);
  }

  release(ev) {
    if (!this.down) return;
    this.down = false;
    this.flush();
    this.emit('release', ev.timeStamp || performance.now());
  }

  // Where the pointer was at time t, between the two recorded positions around it.
  at(t) {
    const tr = this.track;
    while (tr.length > 2 && tr[1][0] <= t) tr.shift();
    const a = tr[0];
    const b = tr[1];
    if (!b || t <= a[0]) return [a[1], a[2]];
    if (t >= b[0]) return [b[1], b[2]];
    const k = (t - a[0]) / (b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  flush() {
    if (!this.running || !this.track.length) return;
    const until = performance.now() - LAG_MS;
    if (this.gridT == null || until - this.gridT > 2000) {
      // First sample, or a long pause: start again from here.
      this.gridT = until;
      this.gridPos = this.at(until);
      this.vel = [0, 0];
      return;
    }
    const rows = [];
    const dt = GRID_MS / 1000;
    while (this.gridT + GRID_MS <= until) {
      this.gridT += GRID_MS;
      const pos = this.at(this.gridT);
      const vx = (pos[0] - this.gridPos[0]) / dt;
      const vy = (pos[1] - this.gridPos[1]) / dt;
      // Screen up is the forward swing. 0.08 puts a normal flick at 2 to 4 g, like a real swing.
      const rawX = clamp(((vx - this.vel[0]) / dt) * 0.08, -8, 8);
      const rawY = clamp((-(vy - this.vel[1]) / dt) * 0.08, -8, 8);
      this.vel = [vx, vy];
      this.gridPos = pos;
      // Pointer positions come in whole pixels. A filter keeps the signal from spiking.
      this.acc[0] += (rawX - this.acc[0]) * 0.18;
      this.acc[1] += (rawY - this.acc[1]) * 0.18;
      rows.push([this.gridT, this.acc[0], this.acc[1], 1, null, null, null]);
    }
    if (rows.length) this.emit('samples', rows);
  }
}

// Plays a recorded or synthetic swing back in real time through the same events.
export function replaySwing(swing, target) {
  return new Promise((resolve) => {
    const base = performance.now() - swing.samples[0][0];
    let i = 0;
    let pressed = false;
    let released = false;
    if (swing.aim != null) target.emit('aim', swing.aim);
    const timer = setInterval(() => {
      const now = performance.now() - base;
      const rows = [];
      while (i < swing.samples.length && swing.samples[i][0] <= now) {
        const r = swing.samples[i++];
        if (!pressed && r[0] >= swing.pressT) { pressed = true; target.emit('samples', rows.splice(0)); target.emit('press', r[0]); }
        if (!released && r[0] >= swing.releaseT) { released = true; target.emit('samples', rows.splice(0)); target.emit('release', r[0]); }
        rows.push(r);
      }
      if (rows.length) target.emit('samples', rows);
      if (i >= swing.samples.length) { clearInterval(timer); resolve(); }
    }, 16);
  });
}
