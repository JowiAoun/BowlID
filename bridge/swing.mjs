// The recorded swing file format, and how a swing becomes a timed list of bridge messages.
// {"version":1,"label":"...","source":"wii"|"mouse"|"synthetic","participant":"...",
//  "samples":[[t,ax,ay,az,gx,gy,gz],...],"releaseT":ms}

const BATCH_MS = 20;

// Throws with a plain message when the file is not a usable swing.
export function validateSwing(swing) {
  if (!swing || typeof swing !== 'object') throw new Error('The swing file is not a JSON object.');
  if (swing.version !== 1) throw new Error(`Unknown swing version: ${swing.version}. Expected 1.`);
  if (!Array.isArray(swing.samples) || swing.samples.length < 2) throw new Error('The swing has fewer than 2 samples.');
  let last = -Infinity;
  for (const [i, s] of swing.samples.entries()) {
    if (!Array.isArray(s) || s.length < 4) throw new Error(`Sample ${i} needs at least [t, ax, ay, az].`);
    if (![s[0], s[1], s[2], s[3]].every(Number.isFinite)) throw new Error(`Sample ${i} has a value that is not a number.`);
    if (s[0] < last) throw new Error(`Sample ${i} goes back in time.`);
    last = s[0];
  }
  return swing;
}

// Turn a swing into [{ at, msg }], with `at` in ms from the start of playback.
// B goes down at the first sample and up at `releaseT`, the same way a live throw looks.
export function swingToTimeline(swing) {
  validateSwing(swing);
  const t0 = swing.samples[0][0];
  const tEnd = swing.samples[swing.samples.length - 1][0];
  const release = Number.isFinite(swing.releaseT) ? Math.min(Math.max(swing.releaseT, t0), tEnd) : tEnd;
  const timeline = [{ at: 0, msg: { type: 'button', t: 0, name: 'B', down: true } }];

  let batch = [];
  let batchStart = 0;
  const flush = () => {
    if (batch.length) timeline.push({ at: batch[batch.length - 1][0], msg: { type: 'samples', s: batch } });
    batch = [];
  };
  for (const s of swing.samples) {
    const at = s[0] - t0;
    if (batch.length && at - batchStart >= BATCH_MS) flush();
    if (!batch.length) batchStart = at;
    batch.push([at, s[1], s[2], s[3], s[4] ?? null, s[5] ?? null, s[6] ?? null]);
  }
  flush();

  timeline.push({ at: release - t0, msg: { type: 'button', t: release - t0, name: 'B', down: false } });
  // Stable sort keeps the samples before a button event that shares their time.
  return timeline.sort((a, b) => a.at - b.at);
}

// Shift every timestamp in a message by `base`, so playback sits on the live clock.
export function shiftMessage(msg, base) {
  if (msg.type === 'samples') return { ...msg, s: msg.s.map((s) => [Math.round((s[0] + base) * 100) / 100, ...s.slice(1)]) };
  return { ...msg, t: Math.round((msg.t + base) * 100) / 100 };
}
