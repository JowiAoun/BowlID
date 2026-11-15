// Everything BowlID says. It is a biometric security product and it takes itself seriously.

export const ID = {
  name: 'BowlID',
  tagline: 'Your identity is in your swing.',
  bank: 'BowlBank',
  sign: { name: 'BowlID', tagline: 'YOUR BACKSWING IS YOUR PASSWORD  ·  LANE 67', color: '#4a8ff0' },
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

export function pinsLabel(p) {
  if (p.strike) return 'Strike';
  if (p.gutter) return 'Gutter ball';
  return `${p.pins} pin${p.pins === 1 ? '' : 's'}`;
}

// The name on a new account. It comes from what was measured in the enrollment throws:
// whichever habit is furthest from a middling swing gives the name. The middling values are
// rough guesses, so the name is a joke about the swing and not a measurement of it.
const HABITS = [
  { get: (f) => f.dur, mid: 900, scale: 350, high: 'The Long Wind-up', low: 'The Quick Draw' },
  { get: (f) => f.peak, mid: 3.3, scale: 1.0, high: 'The Cannon', low: 'The Gentle Roller' },
  { get: (f) => f.follow, mid: 0.6, scale: 0.35, high: 'The Follow-Through', low: 'The Sudden Stop' },
  { get: (f) => f.early, mid: 0.35, scale: 0.12, high: 'The Early Bloomer', low: 'The Late Surge' },
  { get: (f) => f.axis[0], mid: 0.2, scale: 0.12, high: 'The Wrist Whisperer', low: 'The Straight Arrow' },
];

export function nameFor(profile, pinsList, taken, serial) {
  const ideas = [];
  if (pinsList.every((p) => p.gutter)) ideas.push('Gutter Royalty');
  if (pinsList.every((p) => p.strike)) ideas.push('Suspiciously Good');
  const ranked = HABITS.map((h) => {
    const z = (mean(profile.templates.map((t) => h.get(t.feat))) - h.mid) / h.scale;
    return { name: z > 0 ? h.high : h.low, far: Math.abs(z) };
  }).sort((x, y) => y.far - x.far);
  ideas.push(...ranked.map((r) => r.name));
  const number = `Customer #${String(serial).padStart(3, '0')}`;
  return ideas.find((n) => !taken.includes(n)) || number;
}

/* The header of the challenge window, per flow. */

export function ask(flow, done, need) {
  if (flow === 'enroll') return ['Create your', 'bowling identity', `Bowl ${need} times. Throw ${Math.min(done + 1, need)} of ${need}.`];
  if (flow === 'practice') return ['Practice lane', 'no identity check', 'Swings are recorded for evaluation only.'];
  return ['Verify your', 'bowling identity', 'Bowl once. Please confirm that you are you.'];
}

/* Verdicts */

export function headline(outcome, final) {
  if (outcome === 'recognized') return 'Identity verified';
  if (outcome === 'ambiguous') return 'Bowling identity crisis';
  if (outcome === 'unsure') return final ? 'Identity unknown' : 'Identity inconclusive';
  return 'Identity unknown';
}

export function verdictLine(outcome, pins, names, final) {
  if (outcome === 'recognized') {
    if (pins.gutter) return pick(['Gutter ball. Welcome back. We would know that swing anywhere.', 'Zero pins. Full access. Your account has never cared about pins.']);
    if (pins.strike) return pick(['A strike, and it is really you. The strike was not required and has not been recorded.', 'Welcome back. Please do not make a habit of the strike. It worries us.']);
    return pick(['Welcome back. Your backswing is as we remember it.', 'Welcome back. Your follow-through remains regrettable and unmistakable.']);
  }
  if (outcome === 'ambiguous') {
    const pair = `${names[0]} and ${names[1]}`;
    if (final) return `We could not tell ${pair} apart. Neither account has been opened.`;
    return pick([
      `Your swing looks suspiciously like two of our customers: ${pair}. Please bowl again.`,
      `Please bowl again. We are having trouble determining whether you are ${names[0]} or ${names[1]}.`,
    ]);
  }
  if (outcome === 'unsure') {
    if (final) return 'We are unable to verify that you are yourself.';
    return pick(['That was almost somebody. Please bowl again, with more of you in it.', 'Please bowl again to confirm that you are you.']);
  }
  if (pins.strike) return pick(['Strike detected. Identity not detected. Who are you?', 'A perfect throw from a perfect stranger.']);
  if (pins.gutter) return pick(['Unknown swing, and a gutter ball. We admire the commitment.', 'We do not know you, and neither do the pins.']);
  return pick(['Your wrist does not match our records.', 'We do not recognise this backswing. Who are you?', 'No customer on file bowls like that.']);
}

// Lines for the report. Each one is tied to a row that was actually measured.
const TRAIT_LINES = {
  length: ['Your backswing takes as long as we remember.', 'This swing took a different amount of time than yours.'],
  power: ['Swing force is consistent with our records.', 'The force of this swing is not on file.'],
  release: ['You let go when you always let go.', 'The release came at the wrong moment.'],
  windup: ['Your wind-up effort matches our records.', 'The wind-up does not match our records.'],
  wrist: ['Your wrist activity is consistent.', 'Suspicious wrist activity detected.'],
  side: ['Your sideways drift is on file.', 'Suspicious sideways activity detected.'],
  follow: ['Your follow-through is unmistakable.', 'We do not recognise this follow-through.'],
};
export const traitLine = (row) => TRAIT_LINES[row.key][row.ok ? 0 : 1];

export const SKILL_LINE = 'Your bowling skills remain under investigation.';

export const QUALITY = {
  'too-short': 'That was a click. A click has no backswing. Hold the button through the whole swing.',
  'too-long': 'That swing timed out. Please complete it in one motion.',
  'too-few-samples': 'We lost sight of the swing. Please bowl again.',
  'no-motion': 'A button was pressed but nobody bowled. Please bowl.',
};

export const NO_SWING = 'The keyboard has no backswing. That bowl was for fun and carried no identity.';

export const STATEMENT = [
  ['Shoe rental, size unknown', -6.5],
  ['Lane wax levy', -14.0],
  ['Interest, paid in pins', 10.0],
  ['Nachos (business expense)', -11.25],
  ['Wrist strap compliance rebate', 4.2],
  ['Deposit: found in ball return', 20.0],
];

export const money = (v) => v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });

export const SOURCE_NOTE = {
  wii: '',
  pointer: 'Simulated input. This swing came from a pointer, which is not a Wii Remote and not a biometric.',
  synthetic: 'Sample customer. This swing was made by a formula, not by a person.',
};
