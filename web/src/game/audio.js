// Every sound is made here with Web Audio. There are no sound files.
// Nothing plays until start() is called from a click or a button press.

let ctx = null;
let master = null;
let music = null;
let noiseBuf = null;
let rollSrc = null;
let rollGain = null;
let muted = false;
let timer = null;
let nextBar = 0;
let bar = 0;

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

function noise(dur, when, { type = 'bandpass', freq = 1500, q = 1, gain = 0.3, to = null, out = master } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, when);
  if (to) f.frequency.exponentialRampToValueAtTime(to, when + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + Math.min(0.02, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f).connect(g).connect(out);
  src.start(when, Math.random() * 0.5);
  src.stop(when + dur + 0.05);
}

function tone(freq, when, dur, { type = 'sine', gain = 0.2, to = null, attack = 0.008, out = master } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, when);
  if (to) o.frequency.exponentialRampToValueAtTime(to, when + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g).connect(out);
  o.start(when);
  o.stop(when + dur + 0.05);
}

// A light four-bar loop: walking bass, off-beat chords, a small tune on top.
const BEAT = 60 / 116;
const CHORDS = [[48, 64, 67, 69], [45, 60, 64, 67], [50, 60, 65, 69], [43, 59, 62, 65]];
// [beat, note] pairs for each bar.
const TUNE_NOTES = [
  [[0, 76], [1, 79], [1.5, 81], [2.5, 79], [3.5, 76]],
  [[0, 72], [1, 76], [1.5, 79], [2.5, 76], [3, 74]],
  [[0, 77], [0.5, 81], [1.5, 77], [2, 74], [3, 77], [3.5, 81]],
  [[0, 79], [1.5, 71], [2, 74], [3, 79]],
];

function scheduleBar(t, n) {
  const chord = CHORDS[n % 4];
  const root = chord[0];
  [[0, root], [1.5, root + 7], [2, root], [3, root + 4], [3.5, root + 7]].forEach(([b, note]) => {
    tone(midi(note - 12), t + b * BEAT, 0.28, { type: 'triangle', gain: 0.5, out: music });
  });
  for (const b of [0.5, 1.5, 2.5, 3.5]) {
    for (const note of chord.slice(1)) tone(midi(note), t + b * BEAT, 0.16, { type: 'triangle', gain: 0.1, out: music });
    noise(0.04, t + b * BEAT, { type: 'highpass', freq: 6000, gain: 0.05, out: music });
  }
  for (const [b, note] of TUNE_NOTES[n % 4]) {
    tone(midi(note), t + b * BEAT, 0.3, { type: 'sine', gain: 0.22, out: music });
    tone(midi(note + 12), t + b * BEAT, 0.12, { type: 'sine', gain: 0.05, out: music });
  }
}

function pump() {
  if (!ctx) return;
  while (nextBar < ctx.currentTime + 0.4) {
    scheduleBar(nextBar, bar++);
    nextBar += BEAT * 4;
  }
}

export const audio = {
  get on() { return Boolean(ctx); },
  get muted() { return muted; },

  start() {
    if (ctx) { ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
    music = ctx.createGain();
    music.gain.value = 0.16;
    music.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // The rumble of the ball runs the whole time. Its volume follows the ball's speed.
    rollSrc = ctx.createBufferSource();
    rollSrc.buffer = noiseBuf;
    rollSrc.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    rollGain = ctx.createGain();
    rollGain.gain.value = 0;
    rollSrc.connect(lp).connect(rollGain).connect(master);
    rollSrc.start();

    nextBar = ctx.currentTime + 0.15;
    timer = setInterval(pump, 120);
    pump();
  },

  setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.03);
  },

  setMusic(on) {
    // 'off' is silence, for when the challenge window is closed.
    if (music) music.gain.setTargetAtTime(on === 'off' ? 0 : on ? 0.16 : 0.05, ctx.currentTime, 0.2);
  },

  roll(speed) {
    if (!ctx) return;
    rollGain.gain.setTargetAtTime(Math.min(0.9, speed / 9), ctx.currentTime, 0.06);
  },

  whoosh() {
    if (!ctx) return;
    noise(0.28, ctx.currentTime, { freq: 500, to: 2600, q: 1.5, gain: 0.25 });
  },

  thud() {
    if (!ctx) return;
    tone(120, ctx.currentTime, 0.18, { gain: 0.6, to: 50 });
  },

  // Pins: a burst of short woody knocks. Faster balls make more of them.
  crash(speed) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = Math.round(6 + Math.min(10, speed));
    noise(0.5, t, { type: 'highpass', freq: 900, gain: 0.35 });
    for (let i = 0; i < n; i++) {
      const at = t + Math.random() * 0.45 * (i / n) + i * 0.012;
      tone(700 + Math.random() * 900, at, 0.07, { type: 'triangle', gain: 0.4, to: 260 });
      noise(0.05, at, { freq: 2400, q: 2, gain: 0.3 });
    }
  },

  // Robots cheering: rising chirps.
  cheer() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 26; i++) {
      const at = t + Math.random() * 1.5;
      const f = 700 + Math.random() * 1400;
      tone(f, at, 0.12, { type: 'square', gain: 0.045, to: f * 1.6 });
    }
    [72, 76, 79, 84, 88].forEach((n, i) => tone(midi(n), t + i * 0.09, 0.4, { type: 'triangle', gain: 0.3 }));
  },

  // Robots disappointed: two falling notes and some sagging beeps.
  aww() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(midi(63), t, 0.32, { type: 'sawtooth', gain: 0.12, to: midi(62) });
    tone(midi(58), t + 0.34, 0.6, { type: 'sawtooth', gain: 0.12, to: midi(54) });
    for (let i = 0; i < 8; i++) {
      const f = 500 + Math.random() * 500;
      tone(f, t + Math.random() * 0.7, 0.2, { type: 'square', gain: 0.03, to: f * 0.6 });
    }
  },

  chime() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(midi(88), t, 0.5, { gain: 0.3 });
    tone(midi(93), t + 0.12, 0.8, { gain: 0.3 });
  },

  click() {
    if (!ctx) return;
    tone(900, ctx.currentTime, 0.05, { type: 'triangle', gain: 0.2 });
  },
};
