// What the bank says. Kept in one file so the jokes are easy to edit.

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function pinsLabel(p) {
  if (p.strike) return 'Strike';
  if (p.gutter) return 'Gutter ball';
  return `${p.pins} pin${p.pins === 1 ? '' : 's'}`;
}

export function verdictLine(verdict, pins, crisis) {
  if (crisis) return 'Bowling identity crisis. This swing fits more than one customer. Please bowl like yourself.';
  if (verdict === 'match') {
    if (pins.gutter) return pick([
      'Gutter ball. Welcome back. We would know that swing anywhere.',
      'Zero pins. Full access. Your funds have never cared about pins.',
    ]);
    if (pins.strike) return pick([
      'Strike, and it is really you. Please do not make a habit of the strike. It worries us.',
      'Identity confirmed. The strike was not required and has not been recorded.',
    ]);
    return pick([
      'Identity confirmed. Your backswing is as we remember it.',
      'Welcome back. Your follow-through remains regrettable and unmistakable.',
    ]);
  }
  if (verdict === 'retry') return pick([
    'Please bowl again to verify that you are you.',
    'That was almost you. We need a little more you.',
    'Your funds are safe. Your form is questionable.',
  ]);
  if (pins.strike) return pick([
    'Strike detected. Identity not detected.',
    'A perfect throw. Sadly, the account holder has never thrown one.',
  ]);
  if (pins.gutter) return pick([
    'Wrong swing, and a gutter ball. We admire the commitment.',
    'Suspicious wrist activity detected.',
  ]);
  return pick([
    'Your backswing does not match our records.',
    'Suspicious wrist activity detected.',
    'We do not recognise this follow-through. Security has been notified. Security is a pin.',
  ]);
}

export const QUALITY = {
  'too-short': 'That was too quick to read. Hold the button through the whole swing.',
  'too-long': 'That swing took a while. Please complete it in one motion.',
  'too-few-samples': 'We lost sight of the swing. Please bowl again.',
  'no-motion': 'We detected a button press but no bowling. Please bowl.',
};

export const STATEMENT = [
  ['Shoe rental, size unknown', -6.5],
  ['Lane wax levy', -14.0],
  ['Interest, paid in pins', 10.0],
  ['Nachos (business expense)', -11.25],
  ['Wrist strap compliance rebate', 4.2],
  ['Deposit: found in ball return', 20.0],
];

export const money = (v) => v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
