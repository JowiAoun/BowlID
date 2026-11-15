// Bowl ID. A username and no password: the password is the way the account's owner bowls.
// The page has a username field and two buttons. Either button opens a CAPTCHA-style window
// with a bowling lane in it. The pins never decide anything. The swing is checked against the
// one account the username names, and a swing that does not fit is an attempt on that account.
// The bank this grew out of still lives in bank.html and bank-main.js.
import { Lane } from './game/lane3d.js';
import { throwFromSwing } from './game/throw.js';
import { audio } from './game/audio.js';
import { speech } from './game/speech.js';
import { SwingRecorder } from './motion/recorder.js';
import { makeSignature, checkQuality } from './motion/signal.js';
import { MATCH_CONFIG, buildProfile, identify, verifyClaim, collision, traits } from './motion/matcher.js';
import { syntheticSet } from './motion/synthetic.js';
import { WiiSource, MouseSource, replaySwing } from './input/sources.js';
import { store, cleanUsername } from './id/store.js';
import { track } from './analytics.js';
import {
  ID, ask, headline, verdictLine, whoElseLine, crisisLine, attemptLine, traitLine, nameFor, pinsLabel, money,
  SKILL_LINE, QUALITY, NO_SWING, STATEMENT, SOURCE_NOTE, USERNAME_NOTE,
} from './id/copy.js';
import '@fontsource-variable/fredoka';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const BRIDGE_URL = `ws://127.0.0.1:${params.get('bridge') || 8765}`;
// `?who=name` labels every recorded swing with that person, for the evaluation tool.
const WHO = (params.get('who') || '').trim().slice(0, 40);

const widget = $('widget');
const laneEl = $('lane');
let lane = null;

const state = {
  phase: 'home', // home, checking, challenge, account
  flow: 'login', // login, enroll, practice
  mode: 'demo',
  status: { connected: true, sensors: {}, message: '' },
  busy: false,
  aim: 0,
  pressAim: 0,
  charge: null,
  replaying: false,
  sample: null,
  username: '', // The username this challenge is for.
  claim: null, // The account that username names, at log-in.
  note: null, // Why the lane did not open: { text, kind }.
  enroll: null, // { throws: [{ sig, pins, bad, rec }], restarts }
  login: null, // See newLogin().
  report: null,
  session: null, // { account, report, created, fresh }
};

// One log-in: every bowl until the account opens or the swing is turned away.
const newLogin = () => ({
  bowls: 0, pins: 0, lastPins: 0, startedAt: performance.now(), over: false, finished: false,
  best: 0, like: null, src: null, logged: false,
});

// Every swing recorded in this session, kept in memory for the export link.
const recorded = [];

// Which kind of input a swing came from. Profiles are only compared within one kind.
const srcKind = () => (state.replaying ? 'synthetic' : state.mode === 'wii' ? 'wii' : 'pointer');

/* The front page */

function setStatus(text, kind = '') {
  const el = $('status');
  el.className = `status ${kind}`;
  el.textContent = text;
}

function ledgerLine() {
  const l = store.ledger();
  const el = $('ledger');
  if (!l.bowls) { el.textContent = ''; return; }
  const per = l.logins ? (l.loginBowls / l.logins).toFixed(1) : 'n/a';
  el.textContent = `Branch ledger. Gutter balls let in: ${l.guttersIn}. Strikes turned away: ${l.strikesOut}. Identity crises: ${l.crises}. Bowls per log-in: ${per}.`;
}

const inputKind = () => (state.mode === 'wii' ? 'wii' : 'pointer');

// Under the widget: why the lane did not open, or else who is on file.
function showNote() {
  const el = $('widget-note');
  if (state.note) {
    el.className = `widget-note ${state.note.kind}`;
    el.textContent = state.note.text;
    return;
  }
  const kind = inputKind();
  const n = store.accounts(kind).length;
  const what = kind === 'wii' ? 'the Wii Remote' : 'the pointer (simulated)';
  el.className = 'widget-note';
  el.textContent = n ? `${n} account${n === 1 ? '' : 's'} on file for ${what}.` : `Nobody is on file for ${what} yet.`;
}

// Most and least themselves: everyone who has got in, by how much they bowled like themselves.
function board() {
  const el = $('board');
  const rows = [...store.accounts(inputKind()), ...store.accounts('synthetic')]
    .filter((a) => a.history.length)
    .map((a) => ({ a, avg: a.history.reduce((sum, h) => sum + h.score, 0) / a.history.length }))
    .sort((x, y) => y.avg - x.avg);
  el.hidden = !rows.length;
  if (!rows.length) return;
  const body = rows.map(({ a, avg }, i) => `
    <tr>
      <td>${i + 1}</td>
      <th>${esc(a.username)}${a.sample ? ' <i>sample</i>' : ''}</th>
      <td>${Math.round(avg)} / 100</td>
      <td>${a.history.length}</td>
      <td>${a.attemptsEver}</td>
    </tr>`).join('');
  el.innerHTML = `
    <h3>Most and least themselves</h3>
    <table class="statement ranks">
      <tr class="heads"><td></td><th>Customer</th><td>Average score as themselves</td><td>Log-ins</td><td>Declined attempts</td></tr>
      ${body}
    </table>`;
}

function home() {
  showNote();
  // Usernames are not secret. The swing is.
  $('known').innerHTML = store.accounts(inputKind()).map((a) => `<option value="${esc(a.username)}"></option>`).join('');
  $('widget-label').textContent = 'I am me';
  const links = [
    '<a href="#" data-act="sample" data-swing="gary" data-as="gary">No remote? Watch Gary log in (simulated).</a>',
    '<a href="#" data-act="sample" data-swing="gary" data-as="margaret">Watch Gary try Margaret\'s account (simulated).</a>',
    '<a href="#" data-act="sample" data-swing="margaret" data-as="margaret">Watch Margaret log in (simulated).</a>',
    `<a href="#" data-act="practice">Practice lane${WHO ? `, recording as ${esc(WHO)}` : ''}</a>`,
  ];
  if (recorded.length) links.push(`<a href="#" data-act="export">Export ${recorded.length} recorded swing${recorded.length === 1 ? '' : 's'}</a>`);
  $('home-links').innerHTML = links.join('<br>');
  document.body.classList.toggle('wii', state.mode === 'wii');
  board();
  ledgerLine();
}

function setPhase(phase) {
  state.phase = phase;
  widget.dataset.state = phase === 'home' ? 'idle' : phase === 'account' ? 'verified' : 'checking';
  $('home').hidden = phase === 'account';
  $('inside').hidden = phase !== 'account';
  $('create').disabled = $('login').disabled = $('username').disabled = phase !== 'home';
  if (phase === 'account') $('board').hidden = true;
  if (phase === 'home') home();
}

// The lane stays shut, and the page says why.
function refuse(text) {
  state.note = { text, kind: 'bad' };
  showNote();
  $('username').focus();
}

// Checks the typed username for this flow. Returns { username, claim }, or null after saying why not.
function readUsername(flow) {
  const username = cleanUsername($('username').value);
  if (flow === 'enroll') {
    const why = store.refuse(username);
    if (why) { refuse(why === 'taken' ? USERNAME_NOTE.taken(username) : USERNAME_NOTE[why]); return null; }
    return { username, claim: null };
  }
  if (!username) { refuse(USERNAME_NOTE.empty); return null; }
  const claim = store.find(username);
  if (!claim) { refuse(USERNAME_NOTE.missing(username)); return null; }
  if (claim.sample) { refuse(USERNAME_NOTE.sample(username)); return null; }
  if (claim.source !== inputKind()) { refuse(USERNAME_NOTE.wrongInput(username, claim.source)); return null; }
  return { username, claim };
}

// What the A button on the remote presses right now.
function primary() {
  if (state.phase === 'home') return $('login');
  if (state.phase === 'account') return $('signout');
  if (state.phase === 'challenge' && !$('report').hidden) return $('report').querySelector('[data-primary]');
  return null;
}

/* The challenge window */

function ensureLane() {
  if (lane) return;
  lane = new Lane(laneEl, { cast: true, sign: ID.sign });
  lane.onHit = (speed) => audio.crash(speed);
  speech.init(lane, document.querySelector('.stage .hud'));
  lane.setAim(state.aim);
  window.bowlid.lane = lane;
}

function header() {
  const e = state.enroll;
  const done = e ? e.throws.filter((t) => !t.bad).length : 0;
  const [top, main, sub] = ask(state.flow, done, MATCH_CONFIG.enrollThrows, state.username);
  $('ask-top').textContent = top;
  $('ask-main').textContent = main;
  $('ask-sub').textContent = sub;
  const sim = $('sim');
  const kind = state.sample ? 'synthetic' : srcKind();
  sim.hidden = kind === 'wii';
  sim.parentElement.classList.toggle('simulated', kind !== 'wii');
  sim.textContent = kind === 'synthetic' ? 'Simulated: sample customer, formula swing' : 'Simulated swing: pointer, not a Wii Remote';
}

// While the challenge is open the page behind it does not scroll. The width its scrollbar took
// is padded back, so the page does not jump sideways.
function lockPage(on) {
  const bar = on ? window.innerWidth - document.documentElement.clientWidth : 0;
  document.body.style.paddingRight = bar > 0 ? `${bar}px` : '';
  document.body.classList.toggle('challenge', on);
}

// `sample` is the sample customer whose formula swing is replayed, and `as` the sample
// customer whose account that swing is tried on.
async function openChallenge(flow, sample = null, as = null) {
  if (state.phase !== 'home') return;
  audio.start();
  audio.click();
  let who = { username: '', claim: null };
  if (sample) {
    const claim = store.find(as || sample);
    who = { username: claim.username, claim };
  } else if (flow !== 'practice') {
    who = readUsername(flow);
    if (!who) return;
  }
  state.note = null;
  state.username = who.username;
  state.claim = who.claim;
  $('username').blur();
  state.flow = flow;
  state.sample = sample;
  $('widget-label').textContent = flow === 'enroll' ? 'Learning how you bowl...' : flow === 'login' ? `Checking that you are ${who.username}...` : 'Opening the practice lane...';
  setPhase('checking');
  await wait(850);
  state.enroll = flow === 'enroll' ? { throws: [], restarts: 0 } : null;
  state.login = newLogin();
  state.busy = false;
  lockPage(true);
  $('veil').hidden = false;
  ensureLane();
  lane.reset();
  lane.setActive(true);
  audio.setMusic(true);
  state.phase = 'challenge';
  header();
  controller();
  setStatus(flow === 'enroll' ? 'Bowl a swing that feels like you.' : flow === 'login' ? `Bowl ${who.username}'s password.` : '', 'plain');
  hideBanner();
  hideReport();
  drawSlots();
  hint();
  speech.waiting(1500);
  track('challenge_opened', { flow, input: sample ? 'synthetic' : srcKind() });
  if (sample) {
    await wait(1100);
    if (state.phase === 'challenge') playSample(sample);
  }
}

function closeChallenge() {
  clearTimeout(state.autoOpen);
  $('veil').hidden = true;
  lockPage(false);
  $('info').hidden = true;
  hideReport();
  hideBanner();
  if (lane) { lane.reset(); lane.setActive(false); }
  audio.roll(0);
  audio.setMusic('off');
  speech.clear();
  recorder.cancel();
  state.busy = false;
  state.charge = null;
  state.replaying = false;
  state.sample = null;
}

// A log-in that ends without the swing matching is one attempt on the account that was named.
// It is counted once, however many bowls it took.
function recordAttempt() {
  const L = state.login;
  if (state.flow !== 'login' || !state.claim || !L || L.logged || L.over || !L.bowls) return;
  L.logged = true;
  store.attempt(state.claim, {
    score: L.best,
    bowls: L.bowls,
    pins: L.lastPins,
    likeName: L.like ? L.like.account.username : null,
    likeScore: L.like ? L.like.score : null,
  });
  track('account_attempt_declined', { best_score: L.best, bowls: L.bowls, intruder_identified: Boolean(L.like), source: L.src });
}

function cancel() {
  if (state.phase !== 'challenge') return;
  // Walking away after an inconclusive bowl still counts as having tried.
  recordAttempt();
  closeChallenge();
  setPhase('home');
}

/* Input */

const recorder = new SwingRecorder({ onSwing, onState: () => hint() });
let source = null;

const canBowl = () =>
  state.phase === 'challenge' && !state.busy && lane && !state.login.over
  && (state.replaying || state.mode === 'demo' || state.status.connected);

// Pressing B jerks the remote. The throw uses where it pointed just before the press.
const aimLog = [];
function steadyAim() {
  if (state.replaying) return state.aim;
  const now = performance.now();
  const recent = aimLog.filter(([t]) => t >= now - 350 && t <= now - 70);
  if (!recent.length) return state.aim;
  return recent.reduce((s, [, a]) => s + a, 0) / recent.length;
}

function setAim(aim) {
  state.aim = clamp(aim, -1, 1);
  aimLog.push([performance.now(), state.aim]);
  if (aimLog.length > 120) aimLog.shift();
  if (lane && !state.busy) lane.setAim(state.aim);
}

// A new bowl clears the last verdict. After a final "unknown", it also starts a new log-in.
function beginBowl() {
  hideBanner();
  hideReport();
  $('info').hidden = true;
  if (state.login.finished) state.login = newLogin();
}

// While B is held on a real remote, the bowler's arm follows the remote's tilt.
// Gravity gives the tilt, so it is only read while the remote is not being thrown about.
// This is drawing only. It is never part of the identity check. `?arm=off` turns it off.
const ARM_LIVE = params.get('arm') !== 'off';
let armAngle = 1.2;
function driveArm(rows) {
  if (!ARM_LIVE || state.mode !== 'wii' || state.replaying || !lane || recorder.state !== 'swing') return;
  for (const r of rows) {
    const g = Math.hypot(r[1], r[2], r[3]);
    if (g < 0.6 || g > 1.5) continue;
    // 0 hangs straight down, positive points at the pins, negative is behind the bowler.
    let a = Math.atan2(r[3], -r[2]);
    if (a < -2.6) a += Math.PI * 2;
    armAngle += (a - armAngle) * 0.35;
  }
  lane.setArm(armAngle);
}

// The hub is what every source and every replay talks to.
const hub = {
  emit(name, ...args) {
    if (name === 'samples') { recorder.push(args[0]); driveArm(args[0]); }
    else if (name === 'aim') {
      // The aim is locked while a swing is being read. The remote points everywhere during a swing.
      if (recorder.state === 'idle' && !state.charge) setAim(args[0]);
    } else if (name === 'press') {
      if (!canBowl()) return;
      state.pressAim = steadyAim();
      lane.setAim(state.pressAim);
      lane.setSwing('back');
      armAngle = 1.2;
      beginBowl();
      recorder.press(args[0]);
    } else if (name === 'release') {
      if (recorder.state === 'swing') { lane.setSwing('forward'); audio.whoosh(); }
      recorder.release(args[0]);
    }
  },
};

function setMode(mode) {
  if (source) source.stop();
  recorder.cancel();
  state.mode = mode;
  source = mode === 'wii' ? new WiiSource(BRIDGE_URL) : new MouseSource(laneEl);
  // While a sample swing is replaying, the live source is ignored so the two never mix.
  for (const name of ['samples', 'aim', 'press', 'release']) {
    source.on(name, (...a) => { if (!state.replaying) hub.emit(name, ...a); });
  }
  source.on('status', (s) => { state.status = s; chrome(); });
  source.on('button', (name, down) => {
    if (!down) return;
    audio.start();
    if (name === 'A') primary()?.click();
    else if (name === '2' && state.phase === 'home') $('create').click();
    else if (name === 'HOME') cancel();
    else if (name === 'PLUS') $('reload').click();
    else if (name === 'MINUS') $('sound').click();
  });
  state.status = mode === 'wii'
    ? { connected: false, bridge: false, sensors: {}, message: 'Looking for the Wii Remote bridge.' }
    : { connected: true, sensors: {}, message: '' };
  source.start();
  chrome();
}

// A small controller light in the corner of the lane. Hardware trouble goes here, not across the game.
const ctrl = document.createElement('button');
ctrl.type = 'button';
ctrl.className = 'ctrl';
ctrl.hidden = true;
laneEl.parentElement.appendChild(ctrl);
ctrl.addEventListener('click', () => {
  if (state.mode !== 'wii' || state.status.connected || state.busy) return;
  // The pointer is offered, never assumed. The lane then says "simulated" for as long as it is used.
  setMode('demo');
  setStatus('Switched to the pointer. Swings are simulated and say so.', 'plain');
});

function controller() {
  const s = state.status;
  ctrl.hidden = state.mode !== 'wii' || Boolean(state.sample);
  if (ctrl.hidden) return;
  const plus = s.sensors && s.sensors.gyro ? ' + MotionPlus' : '';
  ctrl.className = `ctrl ${s.connected ? 'ok' : 'bad'}`;
  ctrl.innerHTML = s.connected ? `Wii Remote${plus}`
    : `${s.bridge ? 'Wii Remote asleep' : 'No Wii Remote'} · <u>use the pointer (simulated)</u>`;
  ctrl.title = s.connected ? 'Real Wii Remote motion' : s.bridge ? 'Press any button on the Wii Remote to wake it.' : 'The Wii Remote bridge is not running. Start it with ./scripts/start.sh';
}

function chrome() {
  const b = $('mode');
  const s = state.status;
  if (state.mode === 'wii') {
    const plus = s.connected && s.sensors && s.sensors.gyro ? ' + MotionPlus' : '';
    b.textContent = s.connected ? `Wii Remote connected${plus}` : s.bridge ? 'Wii Remote asleep' : 'Wii Remote bridge not running';
    b.className = `mode ${s.connected ? 'ok' : 'bad'}`;
  } else {
    b.textContent = 'Pointer and keyboard (simulated swing)';
    b.className = 'mode';
  }
  if (state.phase === 'home') home();
  if (state.phase === 'challenge') header();
  controller();
  hint();
}

function hint() {
  const el = $('hint');
  if (state.busy || (state.login && state.login.over) || !$('report').hidden) { el.hidden = true; return; }
  el.hidden = false;
  if (state.replaying) { el.innerHTML = 'Replaying a <b>simulated</b> sample swing.'; return; }
  if (state.charge) { el.innerHTML = 'Let go of <kbd>Space</kbd> to bowl.'; return; }
  if (recorder.state === 'swing') { el.innerHTML = state.mode === 'wii' ? 'Reading your swing. <b>Let go of B</b> to release.' : 'Flick forward and <b>let go</b>.'; return; }
  if (state.mode === 'wii') {
    // With no bridge at all, the controller light in the corner says so and offers the pointer.
    if (!state.status.connected) { el.hidden = !state.status.bridge; el.innerHTML = 'Press any button on the Wii Remote to wake it.'; return; }
    const ir = source.irActive && source.irActive();
    el.innerHTML = `${ir ? 'Point to aim.' : 'Aim with <kbd>✚</kbd>.'} Hold <kbd>B</kbd>, swing, let go.`;
  } else {
    el.innerHTML = 'Press, pull back, flick forward, let go.';
  }
}

/* Keyboard: arrows aim, holding Space charges a throw. No swing is read, so it carries no identity. */

const keys = { left: false, right: false };
window.addEventListener('keydown', (ev) => {
  if (state.phase !== 'challenge') return;
  if (ev.code === 'Escape') { cancel(); return; }
  if (ev.code === 'ArrowLeft') { keys.left = true; ev.preventDefault(); }
  else if (ev.code === 'ArrowRight') { keys.right = true; ev.preventDefault(); }
  else if (ev.code === 'Space') {
    ev.preventDefault();
    if (ev.repeat || state.charge || !canBowl() || state.replaying || recorder.state !== 'idle') return;
    state.charge = { t: performance.now() };
    state.pressAim = state.aim;
    lane.setSwing('back');
    beginBowl();
    const el = $('power');
    el.hidden = false;
    el.classList.add('live');
    hint();
  }
});
window.addEventListener('keyup', (ev) => {
  if (ev.code === 'ArrowLeft') keys.left = false;
  else if (ev.code === 'ArrowRight') keys.right = false;
  else if (ev.code === 'Space' && state.charge) {
    const power = chargePower();
    state.charge = null;
    $('power').classList.remove('live');
    if (state.phase !== 'challenge' || state.busy) return;
    lane.setSwing('forward');
    audio.whoosh();
    const aim = state.pressAim;
    state.busy = true;
    hint();
    setTimeout(() => {
      state.busy = false;
      bowl({ speed: 3.0 + 7.6 * power, startX: aim * 0.36, angle: aim * 0.022, hook: 0, power }, 'keyboard', null);
    }, 330);
  }
});
// The bar fills and empties, so a full-power throw takes timing.
function chargePower() {
  const t = (performance.now() - state.charge.t) / 1100;
  return clamp(1 - Math.abs((t % 2) - 1), 0.02, 1);
}

/* The game overlay */

const rack = $('rack');
const RACK_ROWS = [[6, 7, 8, 9], [3, 4, 5], [1, 2], [0]];
const dots = [];
for (const row of RACK_ROWS) {
  const line = document.createElement('div');
  for (const i of row) {
    dots[i] = document.createElement('i');
    line.appendChild(dots[i]);
  }
  rack.appendChild(line);
}
function drawRack() {
  const down = lane && lane.pinsDown();
  dots.forEach((d, i) => d.classList.toggle('down', Boolean(down && down[i])));
}

function showPower(power) {
  const el = $('power');
  el.hidden = false;
  el.classList.remove('live');
  const bar = el.querySelector('b');
  requestAnimationFrame(() => { bar.style.width = `${Math.round(8 + power * 92)}%`; });
}

const CONFETTI = ['#ffd23f', '#ff6b6b', '#4a8ff0', '#3ccf91', '#ffffff', '#ff9f1c'];
function showBanner(pins) {
  const el = $('banner');
  const kind = pins.strike ? 'strike' : pins.gutter ? 'gutter' : 'count';
  const text = pins.strike ? 'Strike!' : pins.gutter ? 'Gutter ball' : `${pins.pins} pin${pins.pins === 1 ? '' : 's'}`;
  el.className = `banner ${kind}`;
  el.innerHTML = `<span>${text}</span>`;
  if (pins.strike) {
    for (let i = 0; i < 40; i++) {
      const bit = document.createElement('em');
      const angle = Math.random() * Math.PI * 2;
      const far = 140 + Math.random() * 260;
      bit.style.setProperty('--x', `${Math.cos(angle) * far}px`);
      bit.style.setProperty('--y', `${Math.sin(angle) * far - 80}px`);
      bit.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
      bit.style.background = CONFETTI[i % CONFETTI.length];
      bit.style.animationDelay = `${Math.random() * 0.12}s`;
      el.appendChild(bit);
    }
  }
  el.hidden = false;
}
function hideBanner() { $('banner').hidden = true; $('power').hidden = true; }

/* Drawing a swing: force over time, with the release always at the same place. */

function drawSeqs(canvas, sets) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  let top = 2.5;
  for (const s of sets) for (const r of s.seq) top = Math.max(top, Math.hypot(r[0], r[1], r[2]));
  // The release sits three quarters of the way along every signature.
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(w * 0.75, 0);
  g.lineTo(w * 0.75, h);
  g.stroke();
  g.setLineDash([]);
  if (h > 40) {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.font = '10px Roboto, Arial, sans-serif';
    g.fillText('release', w * 0.75 + 4, 10);
    g.fillText('force (g)', 2, 10);
  }
  for (const s of sets) {
    g.strokeStyle = s.color;
    g.lineWidth = s.width || 1.5;
    g.lineJoin = 'round';
    g.beginPath();
    s.seq.forEach((r, i) => {
      const x = (i / (s.seq.length - 1)) * w;
      const y = h - 3 - (Math.hypot(r[0], r[1], r[2]) / top) * (h - 8);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke();
  }
}

// Enrollment progress: one small card per throw, with the swing drawn in it.
function drawSlots() {
  const el = $('slots');
  const e = state.enroll;
  el.hidden = !e;
  if (!e) return;
  const good = e.throws.filter((t) => !t.bad).length;
  const need = e.throws.length + Math.max(0, MATCH_CONFIG.enrollThrows - good);
  let html = '';
  for (let i = 0; i < need; i++) {
    const t = e.throws[i];
    html += t
      ? `<div class="slot ${t.bad ? 'bad' : 'done'}"><canvas data-slot="${i}" width="72" height="30"></canvas><span>${esc(pinsLabel(t.pins))}</span></div>`
      : `<div class="slot"><b>${i + 1}</b><span>${i === e.throws.length ? 'Bowl now' : 'Waiting'}</span></div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-slot]').forEach((c) => {
    const t = e.throws[Number(c.dataset.slot)];
    drawSeqs(c, [{ seq: t.sig.seq, color: t.bad ? '#d93025' : '#2f6fd0', width: 1.6 }]);
  });
}

/* The biometric report */

const VERDICT_CLASS = { recognized: 'ok', created: 'ok', ambiguous: 'mid', unsure: 'mid', unknown: 'bad' };

function traitTable(rows, compare) {
  if (!rows.length) return '';
  const body = rows.map((r) => `
    <tr>
      <th>${esc(r.label)}</th>
      ${compare ? `<td>${r.value} ${esc(r.unit)}</td>` : ''}
      <td>${r.onFile} ${esc(r.unit)}</td>
      ${compare ? `<td class="${r.ok ? 'yes' : 'no'}">${r.ok ? '✓' : '✗'}</td>` : ''}
    </tr>`).join('');
  return `<table class="traits">
    <tr class="heads"><th>Measured</th>${compare ? '<td>This swing</td>' : ''}<td>On file</td>${compare ? '<td></td>' : ''}</tr>${body}</table>`;
}

// The inside of a report: the two results side by side, the graph and the measurements.
function reportBody(r) {
  const cls = VERDICT_CLASS[r.outcome];
  const colour = cls === 'ok' ? '#0f9d58' : cls === 'bad' ? '#d93025' : '#e37400';
  const score = r.score == null ? '' : `
    <div><span>Bowlometric Identity Score</span><b>${r.score}<i> / 100</i></b><em>Similarity, not a probability. 70 passes.</em></div>`;
  const pins = r.pins ? `
    <div><span>Bowling result</span><b>${esc(pinsLabel(r.pins))}</b><em>Not considered.</em></div>` : '';
  const lines = [];
  if (r.outcome === 'recognized') {
    const good = r.rows.filter((x) => x.ok).slice(0, 2).map(traitLine);
    if (r.also) lines.push(r.also);
    lines.push(...good, SKILL_LINE);
  } else if (r.outcome === 'unknown' || r.outcome === 'unsure') {
    lines.push(...r.rows.filter((x) => x.ok === false).slice(0, 2).map(traitLine));
  }
  const versus = r.outcome === 'created' ? 'Your swings, now on file'
    : r.outcome === 'recognized' ? 'This swing against your swings on file'
      : `This swing against the swings ${r.username} left on file`;
  return `
    <div class="two">${pins}${score}</div>
    ${r.compare ? `<div class="graph"><canvas data-graph></canvas></div>
    <div class="key"><span><i style="background:#c9a227"></i>On file</span>${r.sig ? `<span><i style="background:${colour}"></i>This swing</span>` : ''}<span class="what">${esc(versus)}</span></div>` : ''}
    ${traitTable(r.rows, Boolean(r.sig))}
    ${lines.length ? `<ul class="lines">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${SOURCE_NOTE[r.src] ? `<p class="src">${esc(SOURCE_NOTE[r.src])}</p>` : ''}`;
}

function drawReportGraph(root, r) {
  const c = root.querySelector('[data-graph]');
  if (!c || !r.compare) return;
  const cls = VERDICT_CLASS[r.outcome];
  const sets = r.compare.profile.templates.map((t) => ({ seq: t.seq, color: '#c9a227', width: 1.3 }));
  if (r.sig) sets.push({ seq: r.sig.seq, color: cls === 'ok' ? '#0f9d58' : cls === 'bad' ? '#d93025' : '#e37400', width: 2.4 });
  drawSeqs(c, sets);
}

function showReport(r) {
  state.report = r;
  clearTimeout(state.reportTimer);
  const el = $('report');
  const cls = VERDICT_CLASS[r.outcome];
  const passed = r.outcome === 'recognized' || r.outcome === 'created';
  // "Bowl again" is a small card in the corner, so the lane stays in view for the next throw.
  const compact = !passed && !r.final;
  let actions = '';
  if (r.outcome === 'recognized' || r.outcome === 'created') {
    actions = '<button class="verify" type="button" data-act="enter" data-primary>Open my account</button>';
  } else if (r.final) {
    actions = `<button class="verify" type="button" data-act="leave" data-primary>Close</button>
      <button class="link" type="button" data-act="again">or bowl again</button>`;
  } else {
    actions = `<span>${r.score == null ? '' : `Score ${r.score} of 100. `}Bowl again. Attempt ${r.bowls} of ${MATCH_CONFIG.maxLoginBowls}.</span>`;
  }
  el.className = `report ${cls}${compact ? ' compact' : ''}`;
  el.innerHTML = `
    <div class="head">
      <small>Bowl ID biometric report</small>
      <h2>${esc(r.title)}</h2>
      <p>${esc(r.line)}</p>
      ${r.also && r.outcome !== 'recognized' ? `<p class="also">${esc(r.also)}</p>` : ''}
    </div>
    ${reportBody(r)}
    <div class="actions">${actions}</div>`;
  el.hidden = false;
  // A new report starts at its top, wherever the last one was scrolled to.
  el.scrollTop = 0;
  lane?.setPanel(!compact);
  if (compact) state.reportTimer = setTimeout(hideReport, 3000);
  else drawReportGraph(el, r);
  setStatus(r.title, cls === 'ok' ? 'ok' : cls === 'bad' ? '' : 'plain');
  hint();
}
function hideReport() { clearTimeout(state.reportTimer); $('report').hidden = true; lane?.setPanel(false); }

// The report covers most of the lane. This puts it away so there is a lane to bowl on.
function again() {
  if (state.phase !== 'challenge' || state.login.over) return;
  hideBanner();
  hideReport();
  $('info').hidden = true;
  setStatus(state.flow === 'login' ? `Bowl ${state.username}'s password.` : '', 'plain');
  hint();
}

/* Throws */

function onSwing(swing) {
  if (state.busy || state.phase !== 'challenge') { lane?.setSwing('idle'); state.replaying = false; return; }
  const q = checkQuality(swing);
  if (!q.ok) {
    lane.setSwing('idle');
    state.replaying = false;
    setStatus(QUALITY[q.reason] || 'Please bowl again.');
    return;
  }
  const src = srcKind();
  state.replaying = false;
  bowl(throwFromSwing(swing, state.pressAim), src, swing);
}

// After a throw, the lane is put back and the next bowl is allowed.
async function settle(ms = 1700) {
  await wait(ms);
  if (state.phase !== 'challenge') return;
  lane.reset();
  lane.setAim(state.aim);
  hideBanner();
  audio.setMusic(true);
  state.busy = false;
  hint();
}

// One throw, start to verdict. The pins fall however they fall. The swing is judged separately.
async function bowl(thrown, src, swing) {
  if (state.busy || state.phase !== 'challenge') return;
  state.busy = true;
  hint();
  setStatus(state.flow === 'practice' ? 'Recording your swing...' : 'Analyzing your signature swing...', 'plain');
  showPower(thrown.power);
  audio.thud();
  audio.setMusic(false);
  const pins = await lane.play(thrown);
  if (state.phase !== 'challenge') return;
  showBanner(pins);
  lane.react(pins.strike ? 'strike' : pins.gutter ? 'gutter' : 'miss');
  if (pins.strike) audio.cheer(); else if (pins.gutter) audio.aww();
  // A login throw gets its verdict next, so the robots save their opinion for that.
  speech.pins(pins, state.flow !== 'login' || !swing);
  if (!swing) {
    setStatus(NO_SWING);
    settle();
    return;
  }
  const sig = makeSignature(swing);
  const rec = {
    version: 1,
    label: state.flow,
    source: src,
    participant: WHO || (state.flow === 'practice' ? 'practice' : 'unlabelled'),
    samples: swing.samples,
    pressT: swing.pressT,
    releaseT: swing.releaseT,
    aim: state.pressAim,
    pins: pins.pins,
  };
  if (src !== 'synthetic') recorded.push(rec);
  // The game celebrates first. The verdict comes a moment later.
  await wait(1250);
  if (state.phase !== 'challenge') return;
  if (state.flow === 'enroll') afterEnroll(sig, pins, src, rec);
  else if (state.flow === 'practice') afterPractice(sig, pins, src);
  else afterLogin(sig, pins, src, rec);
}

function afterPractice(sig, pins, src) {
  const res = identify(sig, store.accounts(src));
  const guess = res.outcome === 'recognized' ? `Would open ${res.best.account.username}'s account (score ${res.best.score}).`
    : res.outcome === 'ambiguous' ? `Would open two accounts: ${res.best.account.username} and ${res.rival.account.username}.`
      : res.best ? `Would not open any account (closest score ${res.best.score}).` : 'Nobody is on file.';
  setStatus(`${pinsLabel(pins)}. Swing ${recorded.length} recorded${WHO ? ` as ${WHO}` : ''}. ${guess}`, 'plain');
  settle(1400);
}

function afterEnroll(sig, pins, src, rec) {
  const e = state.enroll;
  e.throws.push({ sig, pins, bad: false, rec });
  const good = e.throws.filter((t) => !t.bad);
  const next = () => { drawSlots(); header(); settle(1400); };
  if (good.length < MATCH_CONFIG.enrollThrows) {
    setStatus(`Throw ${good.length} is on file. ${pinsLabel(pins)}, not that it matters.`, 'plain');
    next();
    return;
  }
  const profile = buildProfile(good.map((t) => t.sig));
  const outOfTries = e.throws.length >= MATCH_CONFIG.maxEnrollThrows;
  if (!profile.consistent && !outOfTries) {
    if (profile.outlier >= 0) {
      good[profile.outlier].bad = true;
      setStatus('One of those throws did not look like the others, so it was struck out. Bowl once more.');
    } else {
      setStatus('Your throws disagree with each other. Bowl once more, the way you usually do.');
    }
    next();
    return;
  }
  // Somebody already on file bowls like this. Ask once for a swing with more of this person in it.
  const clash = collision(profile, store.accounts(src));
  if (clash && e.restarts < 1) {
    e.restarts++;
    e.throws = [];
    setStatus(`Your swing looks a lot like ${clash.account.username}'s. Two accounts would share one password. Bowl ${MATCH_CONFIG.enrollThrows} more with a flourish that is yours.`);
    track('enroll_clash', { input: src });
    next();
    return;
  }
  const taken = [...store.accounts(), ...store.accounts('synthetic')].map((a) => a.name);
  const name = nameFor(profile, good.map((t) => t.pins), taken, store.nextSerial());
  const account = store.open(state.username, name, profile, src, clash ? clash.account.id : null);
  if (!WHO) for (const t of e.throws) t.rec.participant = account.username;
  track('identity_created', { input: src, enroll_throws: e.throws.length, spread: profile.spread, consistent: profile.consistent, has_twin: Boolean(clash), motionplus: profile.gyro });
  drawSlots();
  const report = {
    outcome: 'created',
    final: true,
    username: account.username,
    title: 'Password set',
    line: clash
      ? `${account.username}, your password is your backswing, which you appear to share with ${clash.account.username}. On the lanes you are ${name}.`
      : `${account.username}, your password is now your backswing. On the lanes you are ${name}.`,
    pins: null,
    score: null,
    rows: traits(null, profile),
    compare: account,
    sig: null,
    src,
  };
  state.login.over = true;
  state.session = { account, report, created: true, fresh: 0 };
  audio.chime();
  speech.welcome();
  showReport(report);
  lane.reset();
  hideBanner();
  // The account opens by itself. Nobody has to press the button.
  state.autoOpen = setTimeout(enter, 3000);
}

function afterLogin(sig, pins, src, rec) {
  const L = state.login;
  const claim = state.claim;
  // A sample customer's account is only ever tried with a formula swing.
  if (claim.source !== src) {
    setStatus('That is a sample customer. Only the formula swing is checked against that account.');
    settle(1200);
    return;
  }
  L.bowls++;
  L.pins += pins.pins;
  L.lastPins = pins.pins;
  L.src = src;
  const others = store.accounts(src).filter((a) => a.id !== claim.id);
  const res = verifyClaim(sig, claim, others);
  const { verdict } = res;
  L.best = Math.max(L.best, res.score);
  if (res.like && (!L.like || res.like.score > L.like.score)) L.like = res.like;
  const final = verdict !== 'retry' || L.bowls >= MATCH_CONFIG.maxLoginBowls;
  // Sample customers are formula swings. They stay out of the ledger.
  if (src !== 'synthetic') store.bowl(verdict, pins, res.crisis);
  // Scores and counts only. No usernames.
  track('signin_attempt', {
    bowlometric_identity_score: res.score,
    verdict,
    pins: pins.pins,
    strike: pins.strike,
    gutter: pins.gutter,
    attempt: L.bowls,
    source: src,
    sample_account: Boolean(claim.sample),
    identity_crisis: res.crisis,
    fits_another_customer: Boolean(res.like),
    closest_other_score: res.closest,
    identities_on_file: others.length + 1,
  });
  const report = {
    outcome: verdict === 'match' ? 'recognized' : final ? 'unknown' : 'unsure',
    final,
    bowls: L.bowls,
    username: claim.username,
    title: headline(verdict, final),
    line: verdictLine(verdict, pins, claim.username, final),
    also: null,
    pins,
    score: res.score,
    rows: traits(sig, claim.profile),
    compare: claim,
    sig,
    src,
  };
  if (verdict === 'match') {
    if (res.crisis) report.also = crisisLine(res.like.account.username);
    if (!WHO) rec.participant = claim.username;
    L.over = true;
    const fresh = store.login(claim, L.bowls, L.pins, pins.gutter, res.score);
    track('login_done', {
      bowls_to_recognise_yourself: L.bowls,
      pins_before_account_access: L.pins,
      seconds_spent: Math.round((performance.now() - L.startedAt) / 1000),
      got_in_on_a_gutter_ball: pins.gutter,
      attempts_since_last_visit: fresh,
      input: src,
    });
    state.session = { account: claim, report, created: false, fresh };
    audio.chime();
    speech.verdict(report.outcome, final, pins, res.crisis);
    showReport(report);
    // The account opens by itself. Nobody has to press the button.
  state.autoOpen = setTimeout(enter, 3000);
    settleQuietly();
    return;
  }
  if (final) {
    report.also = whoElseLine(claim.username, L.like);
    L.finished = true;
    recordAttempt();
  }
  speech.verdict(report.outcome, final, pins);
  showReport(report);
  settle(1200);
}

// After a verdict that ends the bowling: tidy the lane but keep it closed.
async function settleQuietly() {
  await wait(1700);
  if (state.phase !== 'challenge') return;
  hideBanner();
}

function playSample(key) {
  if (!canBowl()) return;
  // A fresh formula swing from the sample customer. It was not one of the swings in their profile.
  const [swing] = syntheticSet(key, 1, 1000 + Math.floor(Math.random() * 100000));
  recorder.cancel();
  state.replaying = true;
  hint();
  replaySwing(swing, hub);
}

/* The account */

function enter() {
  clearTimeout(state.autoOpen);
  if (state.phase !== 'challenge' || !state.session) return;
  closeChallenge();
  renderAccount();
  setPhase('account');
}

const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Declined log-ins to this account. `fresh` of them happened since the owner was last in.
function attemptsPanel(a, fresh) {
  const total = a.attemptsEver;
  if (!total) {
    return `<h3>Attempts on your account</h3>
      <p class="fine left">Nobody has typed your username and bowled the wrong swing. Yet.</p>`;
  }
  const rows = a.attempts.slice(-5).reverse().map((x, i) => `
    <tr class="${i < fresh ? 'new' : ''}">
      <td>${clock(x.t)}${i < fresh ? ' <b>new</b>' : ''}</td>
      <td>${esc(attemptLine(x))}</td>
      <td>${x.score} / 100 as you</td>
    </tr>`).join('');
  return `<h3>Attempts on your account</h3>
    <p class="alarm ${fresh ? 'on' : ''}">${total} declined log-in${total === 1 ? '' : 's'} to this account${fresh ? `, ${fresh} since you were last here` : ''}.</p>
    <table class="statement attempts">${rows}</table>
    <p class="fine left">Each one typed your username and bowled a swing that did not match yours. One that fits nobody on file may be a stranger, or you on a bad day.</p>`;
}

// You-ness over time: the owner's scores as a line, declined attempts as dots, and the pass mark.
function drawYouness(canvas, a) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const points = [
    ...a.history.map((x) => ({ t: x.t, score: x.score, own: true })),
    ...a.attempts.map((x) => ({ t: x.t, score: x.score, own: false })),
  ].sort((p, q) => p.t - q.t);
  const pad = 10;
  const x = (i) => (points.length > 1 ? pad + (i / (points.length - 1)) * (w - pad * 2) : w / 2);
  const y = (score) => h - 6 - (score / 100) * (h - 14);
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(0, y(MATCH_CONFIG.scoreMatch));
  g.lineTo(w, y(MATCH_CONFIG.scoreMatch));
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.font = '10px Roboto, Arial, sans-serif';
  g.fillText(`${MATCH_CONFIG.scoreMatch} passes`, 2, y(MATCH_CONFIG.scoreMatch) - 3);
  g.strokeStyle = '#0f9d58';
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.beginPath();
  let started = false;
  points.forEach((p, i) => {
    if (!p.own) return;
    if (started) g.lineTo(x(i), y(p.score)); else g.moveTo(x(i), y(p.score));
    started = true;
  });
  g.stroke();
  points.forEach((p, i) => {
    g.fillStyle = p.own ? '#0f9d58' : '#d93025';
    g.beginPath();
    g.arc(x(i), y(p.score), p.own ? 3 : 4, 0, Math.PI * 2);
    g.fill();
  });
}

function renderAccount() {
  const { account: a, report: r, created, fresh } = state.session;
  const el = $('inside');
  const rows = STATEMENT.map(([what, v]) => `<tr><td>${esc(what)}</td><td class="${v < 0 ? 'neg' : ''}">${money(v)}</td></tr>`).join('');
  const per = a.logins ? (a.bowls / a.logins).toFixed(1) : null;
  const charted = a.history.length + a.attempts.length;
  el.style.setProperty('--c', a.color);
  el.innerHTML = `
    <div class="who">
      <div class="ball" aria-hidden="true"><i></i><i></i><i></i></div>
      <div>
        <small>${esc(ID.bank)} · signed in with ${esc(ID.name)}</small>
        <h1 id="acct-name">${esc(a.username)}</h1>
        <span>${a.sample ? esc(a.name) : `On the lanes: ${esc(a.name)}`} · Account ${esc(a.number)}${a.sample ? ' · sample customer, formula swing' : a.source === 'pointer' ? ' · pointer password (simulated)' : ''}</span>
      </div>
    </div>
    <div class="balance">${money(a.balance)}</div>
    <p class="fine left">Available balance. Not real. Not withdrawable. Not even with a strike.</p>
    <div class="why ${VERDICT_CLASS[r.outcome]}">
      <h3>${created ? 'Your account is open. Your backswing is the only way in.' : `Why we let you in${r.pins && r.pins.gutter ? ', gutter ball and all' : ''}`}</h3>
      ${reportBody(r)}
    </div>
    ${attemptsPanel(a, fresh)}
    ${charted ? `<h3>You-ness over time</h3>
    <div class="graph"><canvas data-youness></canvas></div>
    <div class="key"><span><i style="background:#0f9d58"></i>You, getting in</span><span><i style="background:#d93025"></i>Declined attempts</span><span class="what">Score against your swings, oldest to newest</span></div>` : ''}
    <h3>Recent activity</h3>
    <table class="statement">${rows}</table>
    <p class="fine left">${a.profile.templates.length} swings on file${a.profile.gyro ? ', with MotionPlus' : ''}. Logged in ${a.logins} time${a.logins === 1 ? '' : 's'}${per ? `, in ${per} bowl${per === '1.0' ? '' : 's'} on average` : ''}. Gutter balls that got in: ${a.guttersIn}.</p>
    <div class="row">
      <button class="submit" type="button" id="signout">Sign out</button>
      ${a.sample ? '' : '<button class="link danger" type="button" data-act="close">Close this account</button>'}
    </div>
    <p class="fine">No password was typed. You bowled it.</p>`;
  $('inside').hidden = false;
  drawReportGraph(el, r);
  const chart = el.querySelector('[data-youness]');
  if (chart) drawYouness(chart, a);
  $('signout').addEventListener('click', signOut);
}

function signOut() {
  audio.click();
  state.session = null;
  setPhase('home');
}

/* Buttons and links */

const actions = {
  enter,
  leave: cancel,
  again,
  sample: (el) => openChallenge('login', el.dataset.swing, el.dataset.as),
  practice: () => openChallenge('practice'),
  export: () => {
    const blob = new Blob([JSON.stringify(recorded)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bowlid-swings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  close: () => {
    store.close(state.session.account.id);
    signOut();
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  ev.preventDefault();
  audio.click();
  actions[el.dataset.act]?.(el);
});

$('create').addEventListener('click', () => openChallenge('enroll'));
$('login').addEventListener('click', () => openChallenge('login'));
$('cancel').addEventListener('click', cancel);
$('username').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('login').click(); });
$('username').addEventListener('input', () => { if (state.note) { state.note = null; showNote(); } });

$('verify').addEventListener('click', () => {
  audio.click();
  if (state.busy) return;
  const p = primary();
  if (p) { p.click(); return; }
  setStatus(state.flow === 'enroll' ? 'There is nothing to click. Please bowl.' : 'Your backswing is your password. Please bowl.');
});

// The restart button starts the whole test again: enrollment goes back to throw one,
// and a log-in gets a fresh set of bowls.
$('reload').addEventListener('click', () => {
  audio.click();
  if (state.busy || !lane || state.phase !== 'challenge' || state.login.over) return;
  // Starting again after an inconclusive bowl still counts as having tried, like walking away.
  recordAttempt();
  recorder.cancel();
  speech.clear();
  if (state.flow === 'enroll') state.enroll = { throws: [], restarts: 0 };
  state.login = newLogin();
  lane.reset();
  lane.setAim(state.aim);
  hideBanner();
  hideReport();
  header();
  drawSlots();
  setStatus(state.flow === 'enroll' ? 'Starting again from the first throw. It is still bowling.' : 'New challenge loaded. It is also bowling.', 'plain');
  hint();
});

$('sound').addEventListener('click', () => {
  audio.start();
  audio.setMuted(!audio.muted);
  $('sound').classList.toggle('off', audio.muted);
});

$('help').addEventListener('click', () => {
  audio.click();
  const el = $('info');
  el.innerHTML = `<b>Bowl like yourself.</b>
    <ul>
      <li>Wii Remote: point or use the D-pad to aim. Hold B, swing, let go of B.</li>
      <li>We read the whole swing: how long it takes, where the force peaks, how the remote turns, when you let go and what your arm does afterwards.</li>
      <li>The pins are for your own enjoyment. A gutter ball can get in. A strike can be turned away.</li>
      <li>Mouse or touch works too, as a simulation: press, pull back, flick forward, let go. The keyboard can bowl but has no backswing.</li>
    </ul>
    There is no password reset. Your password is your arm.`;
  el.hidden = !el.hidden;
});

$('mode').addEventListener('click', () => {
  if (state.phase === 'challenge' || state.phase === 'checking') return;
  setMode(state.mode === 'wii' ? 'demo' : 'wii');
});

/* Start */

function boot() {
  const want = params.get('mode');
  if (want === 'wii') { setMode('wii'); return; }
  setMode('demo');
  // Only look for the bridge when the page is served from this machine.
  // On the public site a browser would ask the visitor for local network access.
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (want === 'demo' || !local) return;
  try {
    const probe = new WebSocket(BRIDGE_URL);
    const stop = setTimeout(() => probe.close(), 1500);
    probe.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type !== 'status') return;
      clearTimeout(stop);
      probe.close();
      if (msg.connected && msg.source !== 'replay' && state.phase === 'home') setMode('wii');
    };
    probe.onerror = () => {};
  } catch { /* No bridge here. The pointer stays. */ }
}

// For automated checks and for rehearsal.
window.bowlid = { state, hub, lane: null, store, recorded, replaySwing, syntheticSet, bowl, identify, verifyClaim };

setPhase('home');
boot();

let lastFrame = performance.now();
(function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, ((now || lastFrame) - lastFrame) / 1000);
  lastFrame = now || lastFrame;
  if (state.phase !== 'challenge' || !lane) return;
  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (dir && !state.busy && !state.charge && recorder.state === 'idle') setAim(state.aim + dir * dt * 0.9);
  if (state.charge) $('power').querySelector('b').style.width = `${Math.round(chargePower() * 100)}%`;
  drawRack();
  audio.roll(lane.world && !lane.world.ball.gone && lane.world.hitTime == null ? lane.rollSpeed() : 0);
})();
