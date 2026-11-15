// Records a window of samples and turns it into the numbers Claude roasts.
const MOVE_G = 1.35; // above this, we count it as "moving"

export class Recorder {
  constructor(hub) { this.hub = hub; this.samples = []; this.mic = 0; }
  start() {
    this.t0 = performance.now();
    this.samples = [];
    this.mic = 0;
    this.off = this.hub.on((s) => {
      this.samples.push({ ...s, t: performance.now() });
      this.mic = Math.max(this.mic, this.hub.mic || 0);
    });
    return this;
  }
  stop() { this.off?.(); return this.features(); }
  features() {
    const s = this.samples;
    if (s.length < 3) return { peakForce: 1, duration: 0, hesitation: 0, tremor: 0, reversals: 0, micPeak: 0 };
    const mags = s.map((x) => x.mag);
    const peak = Math.max(...mags);
    const firstMove = s.find((x) => x.mag > MOVE_G);
    const lastMove = [...s].reverse().find((x) => x.mag > MOVE_G);
    const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
    const sd = Math.sqrt(mags.reduce((a, b) => a + (b - mean) ** 2, 0) / mags.length);
    // direction reversals in tiltX, ignoring tiny wiggles
    let rev = 0, dir = 0, anchor = s[0].tiltX;
    for (const x of s) {
      const d = x.tiltX - anchor;
      if (Math.abs(d) > 0.08) {
        const nd = Math.sign(d);
        if (dir && nd !== dir) rev++;
        dir = nd; anchor = x.tiltX;
      }
    }
    return {
      peakForce: +peak.toFixed(2),
      duration: firstMove ? Math.round(lastMove.t - firstMove.t) : 0,
      hesitation: Math.round((firstMove ?? s[s.length - 1]).t - this.t0),
      tremor: +sd.toFixed(3),
      reversals: rev,
      micPeak: +this.mic.toFixed(2),
    };
  }
}

// Resolve when a swing starts (mag crosses `start`) and finishes (stays below `end` for `quietMs`).
export function waitForSwing(hub, { start = 2.0, end = 1.25, quietMs = 250, maxMs = 2500, signal } = {}) {
  return new Promise((resolve, reject) => {
    let began = 0, quietSince = 0;
    const off = hub.on((s) => {
      const now = performance.now();
      if (!began) { if (s.mag > start) began = now; return; }
      if (s.mag < end) { quietSince ||= now; if (now - quietSince > quietMs) done(); }
      else quietSince = 0;
      if (now - began > maxMs) done();
    });
    const done = () => { off(); resolve(); };
    signal?.addEventListener("abort", () => { off(); reject(new DOMException("aborted", "AbortError")); });
  });
}
