// The ball, the pins and the clicks are made here with Web Audio.
// Voices, the robot crowd and the music are recorded files in public/audio.
// If a file fails to load, the made-up version of that sound plays in its place.
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
let room = null;
let nextClatter = 0;
let bar = 0;
let tune = true;

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Recorded sounds, by file name without the extension.
const SAMPLE_KEYS = [
  'ann_strike', 'ann_gutter', 'ann_pins', 'ann_approved', 'ann_denied', 'ann_strike_denied', 'ann_gutter_approved', 'ann_again',
  'u7_wait', 'u7_strike', 'u7_gutter', 'u7_denied', 'u7_approved',
  'chip_wait', 'chip_strike', 'chip_gutter', 'chip_denied', 'chip_approved', 'chip_crisis',
  'sfx_cheer', 'sfx_groan', 'sfx_murmur', 'music',
];
const samples = {};

function startLoop(key, gain) {
  const src = ctx.createBufferSource();
  src.buffer = samples[key];
  src.loop = true;
  const g = ctx.createGain();
  g.gain.value = gain;
  // Loops go through the music volume, so they duck and stop with it.
  src.connect(g).connect(music);
  src.start();
}

function loadSamples() {
  const base = `${import.meta.env.BASE_URL}audio/`;
  for (const key of SAMPLE_KEYS) {
    fetch(`${base}${key}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('missing'))))
      .then((data) => ctx.decodeAudioData(data))
      .then((buf) => {
        samples[key] = buf;
        if (key === 'music') {
          // The recorded music takes over from the made-up tune.
          tune = false;
          startLoop('music', 2);
        }
        if (key === 'sfx_murmur') startLoop('sfx_murmur', 0.9);
      })
      .catch(() => { /* The made-up sound stays in use. */ });
  }
}

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

// A mallet note, like a marimba: a soft body and a short bright knock on top.
function mallet(note, when, gain, out) {
  const f = midi(note);
  tone(f, when, 0.42, { type: 'sine', gain, attack: 0.004, out });
  tone(f * 4, when, 0.07, { type: 'sine', gain: gain * 0.28, attack: 0.002, out });
  tone(f * 2, when, 0.18, { type: 'triangle', gain: gain * 0.12, attack: 0.003, out });
}

// A hand clap: two quick bursts of noise.
function clap(when, gain = 0.2) {
  noise(0.05, when, { freq: 1300, q: 1.2, gain });
  noise(0.08, when + 0.012, { freq: 1700, q: 0.9, gain: gain * 0.8 });
}

// A light eight-bar loop for a bowling afternoon: a strolling bass, soft off-beat chords,
// a brushed shaker and a marimba tune on top.
const BEAT = 60 / 108;
const CHORDS = [
  [53, 69, 72, 76], [50, 65, 69, 72], [55, 70, 74, 77], [48, 67, 70, 76],
  [53, 69, 72, 76], [57, 67, 72, 76], [58, 65, 70, 74], [48, 64, 70, 72],
];
// [beat, note] pairs for each bar.
const TUNE_NOTES = [
  [[0, 72], [0.5, 77], [1.5, 81], [2, 79], [3, 77]],
  [[0, 74], [1, 77], [1.5, 74], [2.5, 72], [3.5, 69]],
  [[0, 70], [0.5, 74], [1.5, 79], [2, 77], [3, 74]],
  [[0, 76], [1.5, 72], [2.5, 67], [3, 70], [3.5, 72]],
  [[0, 81], [0.5, 77], [1.5, 84], [2, 81], [3, 77]],
  [[0, 79], [1, 76], [1.5, 72], [2.5, 76], [3.5, 79]],
  [[0, 77], [0.5, 74], [1.5, 70], [2, 74], [3, 77], [3.5, 79]],
  [[0, 76], [1, 72], [2, 70], [2.5, 67], [3.5, 64]],
];

function scheduleBar(t, n) {
  const chord = CHORDS[n % 8];
  const root = chord[0];
  [[0, root], [1.5, root + 7], [2, root + 12], [3, root + 7]].forEach(([b, note]) => {
    tone(midi(note - 12), t + b * BEAT, 0.34, { type: 'sine', gain: 0.5, out: music });
    tone(midi(note), t + b * BEAT, 0.12, { type: 'triangle', gain: 0.08, out: music });
  });
  for (const b of [0.5, 1.5, 2.5, 3.5]) {
    for (const note of chord.slice(1)) tone(midi(note), t + b * BEAT, 0.2, { type: 'sine', gain: 0.075, out: music });
  }
  for (let b = 0; b < 4; b += 0.5) {
    noise(0.05, t + b * BEAT, { type: 'highpass', freq: 7000, gain: b % 1 ? 0.035 : 0.018, out: music });
  }
  for (const [b, note] of TUNE_NOTES[n % 8]) mallet(note, t + b * BEAT, 0.24, music);
}

// Now and then, somebody on a far lane knocks a few pins over.
function clatter(when) {
  const out = room;
  tone(90, when, 0.5, { gain: 0.5, to: 60, out });
  for (let i = 0; i < 7; i++) {
    const at = when + 0.55 + Math.random() * 0.35;
    tone(380 + Math.random() * 420, at, 0.07, { type: 'triangle', gain: 0.45, to: 190, out });
  }
}

function pump() {
  if (!ctx) return;
  while (tune && nextBar < ctx.currentTime + 0.4) {
    scheduleBar(nextBar, bar++);
    nextBar += BEAT * 4;
  }
  if (ctx.currentTime > nextClatter) {
    clatter(ctx.currentTime + 0.1);
    nextClatter = ctx.currentTime + 7 + Math.random() * 9;
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

    // The room: a low murmur, and far-off lanes heard through it. Both are quiet.
    room = ctx.createGain();
    room.gain.value = 0.05;
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 900;
    room.connect(muffle).connect(master);
    const hum = ctx.createBufferSource();
    hum.buffer = noiseBuf;
    hum.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 320;
    band.Q.value = 0.4;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.5;
    hum.connect(band).connect(humGain).connect(room);
    hum.start();
    nextClatter = ctx.currentTime + 4;

    nextBar = ctx.currentTime + 0.15;
    timer = setInterval(pump, 120);
    pump();
    loadSamples();
  },

  // Plays one recorded sound. Returns its length in seconds, or 0 when it is not loaded.
  say(key, gain = 1) {
    if (!ctx || !samples[key]) return 0;
    const src = ctx.createBufferSource();
    src.buffer = samples[key];
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    src.start();
    return samples[key].duration;
  },

  setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.03);
  },

  setMusic(on) {
    // 'off' is silence, for when the challenge window is closed.
    if (!music) return;
    music.gain.setTargetAtTime(on === 'off' ? 0 : on ? 0.16 : 0.05, ctx.currentTime, 0.2);
    room.gain.setTargetAtTime(on === 'off' ? 0 : 0.05, ctx.currentTime, 0.2);
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
    // The ball landing on the boards.
    tone(130, ctx.currentTime, 0.2, { gain: 0.6, to: 48 });
    noise(0.06, ctx.currentTime, { type: 'lowpass', freq: 700, gain: 0.25 });
  },

  // Pins: a burst of short woody knocks. Faster balls make more of them.
  crash(speed) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = Math.round(6 + Math.min(10, speed));
    tone(150, t, 0.22, { gain: 0.5, to: 60 });
    noise(0.45, t, { freq: 1400, q: 0.6, gain: 0.3, to: 600 });
    for (let i = 0; i < n; i++) {
      const at = t + Math.random() * 0.5 * (i / n) + i * 0.014;
      const f = 420 + Math.random() * 520;
      tone(f, at, 0.08, { type: 'triangle', gain: 0.42, to: f * 0.5 });
      tone(f * 2.7, at, 0.03, { type: 'sine', gain: 0.12 });
      noise(0.04, at, { freq: 1900, q: 2, gain: 0.22 });
    }
  },

  // A strike: the seats applaud.
  cheer() {
    if (!ctx) return;
    if (this.say('sfx_cheer', 0.55)) return;
    const t = ctx.currentTime;
    // Applause from the seats, a few pleased beeps, and a little fanfare.
    for (let i = 0; i < 34; i++) clap(t + 0.1 + Math.random() * 1.7, 0.07 + Math.random() * 0.08);
    for (let i = 0; i < 9; i++) {
      const at = t + 0.2 + Math.random() * 1.3;
      const f = 900 + Math.random() * 900;
      tone(f, at, 0.1, { type: 'sine', gain: 0.05, to: f * 1.5 });
    }
    [72, 76, 79, 84].forEach((n, i) => mallet(n, t + i * 0.1, 0.4, master));
    [84, 88, 91].forEach((n) => mallet(n, t + 0.52, 0.3, master));
  },

  // A gutter ball. It should be a little funny.
  aww() {
    if (!ctx) return;
    if (this.say('sfx_groan', 0.55)) return;
    const t = ctx.currentTime;
    // A slide whistle on the way down, then two sorry notes.
    tone(1150, t, 0.7, { type: 'sine', gain: 0.22, to: 260, attack: 0.03 });
    tone(midi(62), t + 0.8, 0.3, { type: 'triangle', gain: 0.3, to: midi(61) });
    tone(midi(57), t + 1.12, 0.7, { type: 'triangle', gain: 0.3, to: midi(53) });
    for (let i = 0; i < 5; i++) {
      const f = 500 + Math.random() * 300;
      tone(f, t + 0.8 + Math.random() * 0.6, 0.2, { type: 'sine', gain: 0.04, to: f * 0.6 });
    }
  },

  chime() {
    if (!ctx) return;
    const t = ctx.currentTime;
    // Three bell notes going up, with a soft ring left hanging.
    [84, 88, 91].forEach((n, i) => {
      tone(midi(n), t + i * 0.11, 0.9, { gain: 0.26 });
      tone(midi(n) * 2.01, t + i * 0.11, 0.5, { gain: 0.07 });
    });
    tone(midi(96), t + 0.36, 1.3, { gain: 0.2 });
  },

  // The score counting up. `k` is how far up, 0 to 1, and the pitch climbs with it.
  tick(k) {
    if (!ctx) return;
    const f = 520 + 900 * k;
    tone(f, ctx.currentTime, 0.05, { type: 'triangle', gain: 0.09, to: f * 1.04 });
  },

  // Access denied: two low buzzes going down.
  denied() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(150, t, 0.26, { type: 'square', gain: 0.07, to: 140 });
    tone(110, t + 0.3, 0.5, { type: 'square', gain: 0.08, to: 98 });
    tone(75, t, 0.8, { type: 'sine', gain: 0.35, to: 55 });
  },

  // Too close to call: a question, two notes going up.
  unsure() {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(midi(67), t, 0.22, { type: 'triangle', gain: 0.22 });
    tone(midi(70), t + 0.2, 0.45, { type: 'triangle', gain: 0.22, to: midi(72) });
  },

  click() {
    if (!ctx) return;
    tone(620, ctx.currentTime, 0.05, { type: 'triangle', gain: 0.2, to: 420 });
  },
};
