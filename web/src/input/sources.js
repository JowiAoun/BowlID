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
      const x = msg.pts.reduce((s, p) => s + p[0], 0) / msg.pts.length;
      // Smooth the pointer so the aim does not shake.
      this.irX = this.irX == null ? x : this.irX + (x - this.irX) * 0.3;
      this.lastIr = performance.now();
      this.setAim((this.irX - this.irCentre) * 3);
    } else if (msg.type === 'status') {
      this.setStatus({ ...msg, bridge: true });
    }
  }

  irActive() { return performance.now() - this.lastIr < 1500; }
}

// Demo mode. The pointer stands in for the remote: its speed changes become the swing signal.
export class MouseSource extends Source {
  constructor(element) {
    super('mouse');
    this.el = element;
    this.down = false;
    this.pos = null;
    this.prev = null;
    this.vel = [0, 0];
    this.tick = this.tick.bind(this);
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
    requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerdown', this.press);
    window.removeEventListener('pointerup', this.release);
    window.removeEventListener('pointercancel', this.release);
  }

  where(ev) {
    const r = this.el.getBoundingClientRect();
    // Both axes are measured in lane heights, so the swing does not depend on the window size.
    return [(ev.clientX - r.left - r.width / 2) / r.height, (ev.clientY - r.top) / r.height, r.width / r.height];
  }

  move(ev) {
    const [x, y, ratio] = this.where(ev);
    this.pos = [x, y];
    if (!this.down) this.emit('aim', clamp((x / ratio) * 2.4, -1, 1));
  }

  press(ev) {
    if (ev.button > 0) return;
    ev.preventDefault();
    this.el.setPointerCapture?.(ev.pointerId);
    this.move(ev);
    this.down = true;
    this.emit('press', performance.now());
  }

  release() {
    if (!this.down) return;
    this.down = false;
    this.emit('release', performance.now());
  }

  tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this.tick);
    if (!this.pos) return;
    if (this.prev) {
      const dt = Math.max(0.004, (now - this.prev.t) / 1000);
      const vx = (this.pos[0] - this.prev.x) / dt;
      const vy = (this.pos[1] - this.prev.y) / dt;
      // Screen up is the forward swing. 0.08 puts a normal flick at 2 to 4 g, like a real swing.
      const ax = clamp(((vx - this.vel[0]) / dt) * 0.08, -6, 6);
      const ay = clamp((-(vy - this.vel[1]) / dt) * 0.08, -6, 6);
      this.vel = [vx, vy];
      this.emit('samples', [[now, ax, ay, 1, null, null, null]]);
    }
    this.prev = { t: now, x: this.pos[0], y: this.pos[1] };
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
