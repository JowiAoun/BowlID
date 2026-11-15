// Everything Bowl ID says. It is a biometric security product and it takes itself seriously.

export const ID = {
  name: 'Bowl ID',
  tagline: 'Your password is your swing.',
  bank: 'BowlBank',
  sign: { name: 'Bowl ID', tagline: 'YOUR BACKSWING IS YOUR PASSWORD  ·  LANE 67', color: '#4a8ff0' },
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

export function ask(flow, done, need, username) {
  if (flow === 'enroll') return ['Set the password for', username, `Bowl ${need} times. Throw ${Math.min(done + 1, need)} of ${need}.`];
  if (flow === 'practice') return ['Practice lane', 'no identity check', 'Swings are recorded for evaluation only.'];
  return ['Enter the password for', username, 'Bowl once. The password is your swing.'];
}

/* The front page: why the lane did not open. */

export const USERNAME_NOTE = {
  empty: 'Type a username first. The password comes after, and it is bowling.',
  shape: 'A username is 2 to 20 letters, numbers, dots, dashes or underscores.',
  taken: (u) => `${u} is taken. If that is you, log in with your swing.`,
  missing: (u) => `Nobody called ${u} bowls here. Check the spelling, or create the account.`,
  sample: (u) => `${u} is a sample customer with a formula swing. Use the sample links below.`,
  wrongInput: (u, kind) => `${u} set their password with ${kind === 'wii' ? 'a Wii Remote' : 'a pointer'}. Switch input to log in.`,
};

/* Verdicts */

// `verdict` is match, retry or mismatch against the username that was typed.
export function headline(verdict, final) {
  if (verdict === 'match') return 'Password accepted';
  if (verdict === 'retry' && !final) return 'Password inconclusive';
  return 'Wrong password';
}

export function verdictLine(verdict, pins, username, final) {
  if (verdict === 'match') {
    if (pins.gutter) return pick(['Gutter ball. Welcome back. We would know that swing anywhere.', 'Zero pins. Full access. Your account has never cared about pins.']);
    if (pins.strike) return pick(['A strike, and it is really you. The strike was not required and has not been recorded.', 'Welcome back. Please do not make a habit of the strike. It worries us.']);
    return pick(['Welcome back. Your backswing is as we remember it.', 'Welcome back. Your follow-through remains regrettable and unmistakable.']);
  }
  if (verdict === 'retry') {
    if (final) return `Three bowls and none of them was ${username}. The account stays shut.`;
    return pick([`That was almost ${username}. Please bowl again, with more of ${username} in it.`, `Please bowl again to confirm that you are ${username}.`]);
  }
  if (pins.strike) return pick([`A strike, and still not ${username}. The account stays shut.`, `A perfect throw. It is not ${username}'s throw.`]);
  if (pins.gutter) return pick([`Not ${username}, and a gutter ball. We admire the commitment.`, `That is not how ${username} bowls, and the pins agree.`]);
  return pick([`That is not how ${username} bowls.`, `Your wrist does not match what ${username} left on file.`, `${username} does not bowl like that.`]);
}

// What a declined swing says about the person who bowled it.
export function whoElseLine(username, like) {
  if (like) return `You are not ${username}. You bowl like ${like.account.username} (${like.score} / 100). ${username} will be told.`;
  return `You are not ${username}, and nobody else on file bowls like that either. ${username} will be told somebody tried.`;
}

// The right swing for this account, which would also open somebody else's.
export const crisisLine = (other) => `This swing would also open ${other}'s account. We have decided not to think about it.`;

// One declined attempt, as the owner sees it.
export const attemptLine = (a) => (a.likeName ? `Bowled like ${a.likeName} (${a.likeScore} / 100 as them)` : 'Bowled like nobody we know');

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

// [what, amount, category, day, icon]
export const STATEMENT = [
  ['Shoe rental, size unknown', -6.5, 'Lanes & equipment', 'Today', 'shoe'],
  ['Lane wax levy', -14.0, 'Fees', 'Today', 'drop'],
  ['Interest, paid in pins', 10.0, 'Interest · 10 pins at par', 'Today', 'trend'],
  ['Nachos (business expense)', -11.25, 'Snack bar · Lane 67', 'Earlier this week', 'nacho'],
  ['Wrist strap compliance rebate', 4.2, 'Rebates', 'Earlier this week', 'watch'],
  ['Deposit: found in ball return', 20.0, 'Deposits', 'Earlier this week', 'down'],
];

// How much of the owner showed up in their own swings, on average.
export function younessLabel(avg) {
  if (avg >= 90) return 'Unmistakably you';
  if (avg >= 80) return 'Reliably you';
  if (avg >= 70) return 'Mostly you';
  return 'Barely you';
}

export const money = (v) => v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });

export const SOURCE_NOTE = {
  wii: '',
  pointer: 'Simulated input. This swing came from a pointer, which is not a Wii Remote and not a biometric.',
  synthetic: 'Sample customer. This swing was made by a formula, not by a person.',
};
