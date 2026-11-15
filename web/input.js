// One input stream, many sources. Every source pushes samples shaped like:
//   { t: ms, tiltX: -1..1, tiltY: -1..1, mag: g (1 = resting), a: bool, b: bool }
// tiltX/tiltY drive the shaky cursor; mag drives swings, waves and stillness.

const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

export class InputHub {
  constructor() {
    this.latest = { t: 0, tiltX: 0, tiltY: 0, mag: 1, a: false, b: false };
    this.listeners = new Set();
    this.source = null;
    this.sourceName = "none";
    this.status = "idle";
    this.mic = 0;
    this.keyA = false;
    window.addEventListener("keydown", (e) => { if (e.code === "Space") { this.keyA = true; e.preventDefault(); } });
    window.addEventListener("keyup", (e) => { if (e.code === "Space") this.keyA = false; });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  push(s) {
    s.a = Boolean(s.a || this.keyA); // Space always works as the A button
    this.latest = s;
    for (const fn of this.listeners) fn(s);
  }
  setStatus(s) { this.status = s; this.onStatus?.(this.sourceName, s); }
  async use(name, opts = {}) {
    this.source?.stop();
    if (!SOURCES[name]) name = "mouse";
    this.sourceName = name;
    this.source = new SOURCES[name](this, opts);
    this.setStatus("starting");
    try { await this.source.start(); }
    catch (err) { console.error(err); this.setStatus("error: " + err.message); }
  }
}

// ---------- Mouse: position = tilt, speed = force. Dev and last-resort fallback.
class MouseSource {
  constructor(hub) { this.hub = hub; this.x = 0.5; this.y = 0.5; this.down = false; }
  async start() {
    this.onMove = (e) => { this.x = e.clientX / innerWidth; this.y = e.clientY / innerHeight; };
    this.onDown = () => { this.down = true; this.latch = true; }; // latch so a fast click between frames still counts
    this.onUp = () => (this.down = false);
    addEventListener("pointermove", this.onMove);
    addEventListener("pointerdown", this.onDown);
    addEventListener("pointerup", this.onUp);
    let px = this.x, py = this.y, pt = performance.now(), speed = 0;
    const tick = (t) => {
      const dt = Math.max(1, t - pt);
      const v = Math.hypot((this.x - px) * innerWidth, (this.y - py) * innerHeight) / dt; // px/ms
      speed = speed * 0.6 + v * 0.4;
      px = this.x; py = this.y; pt = t;
      this.hub.push({ t, tiltX: this.x * 2 - 1, tiltY: this.y * 2 - 1, mag: 1 + speed * 1.6, a: this.down || this.latch, b: false });
      this.latch = false;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.hub.setStatus("live");
  }
  stop() {
    cancelAnimationFrame(this.raf);
    removeEventListener("pointermove", this.onMove);
    removeEventListener("pointerdown", this.onDown);
    removeEventListener("pointerup", this.onUp);
  }
}

// ---------- Wii Remote via the Pi bridge (pi/wiimote.py) over WebSocket.
class WiimoteSource {
  constructor(hub, opts) {
    this.hub = hub;
    const q = new URLSearchParams(location.search);
    this.url = opts.url || q.get("pi") || localStorage.getItem("piUrl") || "ws://raspberrypi.local:8765";
    if (!this.url.startsWith("ws")) this.url = "ws://" + this.url;
    this.flipX = q.has("flipx"); this.flipY = q.has("flipy");
    this.stopped = false;
  }
  async start() { this.connect(); }
  connect() {
    if (this.stopped) return;
    this.hub.setStatus("connecting " + this.url);
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => { this.hub.setStatus("live"); try { localStorage.setItem("piUrl", this.url); } catch {} };
    ws.onmessage = (ev) => {
      const d = JSON.parse(ev.data); // {t, ax, ay, az, a, b} in g
      const mag = Math.hypot(d.ax, d.ay, d.az);
      this.hub.push({
        t: performance.now(),
        tiltX: clamp((this.flipX ? -1 : 1) * d.ax),
        tiltY: clamp((this.flipY ? -1 : 1) * d.ay),
        mag, a: d.a, b: d.b,
      });
    };
    ws.onclose = () => { if (!this.stopped) { this.hub.setStatus("disconnected, retrying"); setTimeout(() => this.connect(), 1000); } };
    ws.onerror = () => ws.close();
  }
  stop() { this.stopped = true; this.ws?.close(); }
}

// ---------- Webcam: frame differencing. Moving-pixel centroid = tilt, motion energy = force.
// No ML, no downloads, works offline. Good enough for wave / still / flail, and a big swing.
class WebcamSource {
  constructor(hub) { this.hub = hub; }
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
    const video = (this.video = document.getElementById("cam"));
    video.srcObject = this.stream;
    video.classList.add("on");
    await video.play();
    const W = 80, H = 60;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    let prev = null, cx = 0.5, cy = 0.5, energy = 0;
    const tick = (t) => {
      ctx.drawImage(video, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
      const gray = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) gray[i] = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10;
      if (prev) {
        let n = 0, sx = 0, sy = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (Math.abs(gray[i] - prev[i]) > 28) { n++; sx += x; sy += y; }
        }
        const e = n / (W * H);
        energy = energy * 0.5 + e * 0.5;
        if (n > 25) { cx = cx * 0.7 + (1 - sx / n / W) * 0.3; cy = cy * 0.7 + (sy / n / H) * 0.3; } // mirrored
      }
      prev = gray;
      this.hub.push({ t, tiltX: cx * 2 - 1, tiltY: cy * 2 - 1, mag: 1 + energy * 25, a: false, b: false });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.hub.setStatus("live");
  }
  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.video?.classList.remove("on");
  }
}

const SOURCES = { mouse: MouseSource, wiimote: WiimoteSource, webcam: WebcamSource };

// ---------- Microphone level (0..1), independent of the motion source.
export async function startMic(hub) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const ac = new AudioContext();
  const an = ac.createAnalyser();
  an.fftSize = 1024;
  ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    hub.mic = Math.min(1, Math.sqrt(s / buf.length) * 4);
    requestAnimationFrame(tick);
  };
  tick();
}
