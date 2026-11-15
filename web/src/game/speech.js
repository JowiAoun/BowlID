// Who says what. The Announcer is heard. The two robots also get a bubble over their head.
// Lines wait in a queue, so nobody talks over anybody.
import { audio } from './audio.js';

const LINES = {
  ann_strike: 'Strike!',
  ann_gutter: 'Gutter ball!',
  ann_pins: 'Some pins were harmed.',
  ann_approved: 'Identity confirmed. Welcome back.',
  ann_denied: 'Access denied!',
  ann_strike_denied: 'A perfect strike. And it means nothing.',
  ann_gutter_approved: 'Zero pins. Full access.',
  ann_again: 'That was almost you. Bowl again.',
  u7_wait: 'I am not a robot.',
  u7_roll: 'Loading. Loading. Loading.',
  u7_strike: 'Absolute cinema.',
  u7_gutter: 'Skill issue.',
  u7_denied: 'Sus.',
  u7_approved: 'He is him.',
  chip_wait: 'Let him cook!',
  chip_strike: 'W swing! W swing!',
  chip_gutter: 'L + ratio + gutter.',
  chip_denied: 'Impostor! Impostor!',
  chip_approved: 'Certified human!',
  chip_crisis: 'Who are you? Who am I?',
};

// Each robot prefers its own spot in the crowd: the ones standing up.
// Unit 7 is the attendant by the ball return. Chip is a regular by the next lane.
const ROBOTS = {
  u7: { name: 'Unit 7', spots: [10], side: 'right' },
  chip: { name: 'Chip', spots: [8, 9], side: 'left' },
};

let lane = null;
let hud = null;
let queue = [];
let busy = false;
let timer = null;
let bubble = null;
let waitTimer = null;

const pick = (...keys) => keys[Math.floor(Math.random() * keys.length)];

function showBubble(who, text, seconds) {
  hideBubble();
  const r = ROBOTS[who];
  const el = document.createElement('div');
  el.className = 'bubble';
  el.innerHTML = '<b></b><span></span>';
  el.firstChild.textContent = r.name;
  el.lastChild.textContent = text;
  hud.appendChild(el);
  // Use the robot's own spot when the camera can see it. Any robot in view is the next choice.
  let spot = r.spots.find((i) => lane.headOnScreen(i));
  if (spot == null) {
    for (let i = 0; i < 40 && spot == null; i++) if (lane.headOnScreen(i)) spot = i;
  }
  bubble = { el, spot, side: r.side, until: performance.now() + seconds * 1000 };
  follow();
}

function hideBubble() {
  if (bubble) bubble.el.remove();
  bubble = null;
}

// Keeps the bubble over the robot's head while the camera moves.
function follow() {
  if (!bubble) return;
  if (performance.now() > bubble.until) { hideBubble(); return; }
  const at = bubble.spot == null ? null : lane.headOnScreen(bubble.spot);
  const el = bubble.el;
  if (at) {
    el.classList.remove('pinned', 'left', 'right');
    const half = el.offsetWidth / 2;
    const x = Math.max(half + 8, Math.min(hud.clientWidth - half - 8, at.x));
    el.style.left = `${x}px`;
    el.style.top = `${Math.max(el.offsetHeight + 8, at.y)}px`;
  } else {
    // The robot is off screen. Park the bubble in its corner.
    el.classList.add('pinned', bubble.side);
    el.style.left = '';
    el.style.top = '';
  }
  requestAnimationFrame(follow);
}

function next() {
  if (busy || !queue.length || !lane) return;
  const key = queue.shift();
  busy = true;
  // With no sound loaded the line still shows, for about as long as it takes to read.
  const seconds = audio.say(key) || 0.6 + LINES[key].length * 0.05;
  const who = key.split('_')[0];
  if (ROBOTS[who]) showBubble(who, LINES[key], seconds + 0.9);
  timer = setTimeout(() => { busy = false; next(); }, seconds * 1000 + 180);
}

function say(...keys) {
  queue.push(...keys);
  next();
}

export const speech = {
  init(theLane, theHud) {
    lane = theLane;
    hud = theHud;
  },

  // Right after the pins settle. `chatty` adds a robot's opinion, for throws with no verdict to come.
  pins(pins, chatty) {
    if (pins.strike) say('ann_strike');
    else if (pins.gutter) say('ann_gutter');
    else say('ann_pins');
    if (!chatty) return;
    if (pins.strike) say(pick('u7_strike', 'chip_strike'));
    else if (pins.gutter) say(pick('u7_gutter', 'chip_gutter'));
  },

  // The identity verdict. It is separate from the pins, and the lines enjoy the difference.
  // `crisis` is a swing that opens this account and would also open somebody else's.
  verdict(outcome, final, pins, crisis = false) {
    if (outcome === 'recognized') {
      say(pins.gutter ? 'ann_gutter_approved' : 'ann_approved', crisis ? 'chip_crisis' : pick('u7_approved', 'chip_approved'));
    } else if (final) {
      say(pins.strike ? 'ann_strike_denied' : 'ann_denied', pick('u7_denied', 'chip_denied'));
    } else {
      say('ann_again', 'u7_denied');
    }
  },

  // A new identity was just created.
  welcome() { say('chip_approved'); },

  // Something for a robot to say while the bowler gets ready.
  waiting(delay = 1200) {
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => { if (!busy && !queue.length) say(pick('u7_wait', 'chip_wait')); }, delay);
  },

  // While the ball is on its way, now and then.
  rolling() {
    if (!busy && !queue.length && Math.random() < 0.45) say('u7_roll');
  },

  clear() {
    clearTimeout(timer);
    clearTimeout(waitTimer);
    queue = [];
    busy = false;
    hideBubble();
  },
};
