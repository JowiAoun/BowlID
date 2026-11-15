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
import { forceOf, savedForce, forceRange } from './motion/trace.js';
import { heroHTML, pairHTML, actionsHTML, drawSwing } from './id/verdict.js';
import { track } from './analytics.js';
import {
  ID, ask, headline, verdictLine, whoElseLine, crisisLine, attemptLine, traitLine, nameFor, pinsLabel, money,
  SKILL_LINE, QUALITY, NO_SWING, STATEMENT, SOURCE_NOTE, USERNAME_NOTE, younessLabel,
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
  seq: 0, // Counts throws and fresh log-ins, so a lane reset meant for an earlier one is skipped.
};

// One log-in: every bowl until the account opens or the swing is turned away.
const newLogin = () => ({
  id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
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

// The branch ledger under the front door, as small stat pills.
function ledgerLine() {
  const el = $('ledger');
  const stats = ledgerStats();
  el.innerHTML = stats
    ? `<span class="lg-title">Branch ledger</span>${stats.map(([v, label]) => `<span class="lg"><b>${esc(v)}</b> ${esc(label.toLowerCase())}</span>`).join('')}`
    : '';
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
  el.className = 'widget-note';
  el.textContent = '';
}

// The side-by-side button on the front page, for the account whose username is typed.
function pairButton() {
  const a = store.find($('username').value);
  $('pair').hidden = !a || store.lastTwo(a.id).length < 2;
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
  pairButton();
  // With the remote connected, the sample customers are only clutter. They are for visitors without one.
  const links = state.mode === 'wii' ? [] : [
    '<a href="#" data-act="sample" data-swing="gary" data-as="gary">No remote? Watch Gary log in (simulated).</a>',
    '<a href="#" data-act="sample" data-swing="gary" data-as="margaret">Watch Gary try Margaret\'s account (simulated).</a>',
    '<a href="#" data-act="sample" data-swing="margaret" data-as="margaret">Watch Margaret log in (simulated).</a>',
  ];
  links.push(
    `<a href="#" data-act="practice">Practice lane${WHO ? `, recording as ${esc(WHO)}` : ''}</a>`,
  );
  if (recorded.length) links.push(`<a href="#" data-act="export">Export ${recorded.length} recorded swing${recorded.length === 1 ? '' : 's'}</a>`);
  $('home-links').innerHTML = links.join('<br>');
  document.body.classList.toggle('wii', state.mode === 'wii');
  board();
  ledgerLine();
}

function setPhase(phase) {
  state.phase = phase;
  $('login').classList.toggle('busy', phase === 'checking');
  $('home').hidden = phase === 'account';
  $('inside').hidden = phase !== 'account';
  document.body.classList.toggle('in-account', phase === 'account');
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
  if (verdictOpen()) return verdictEl.querySelector('[data-primary]');
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
  // A log-in that was closed without opening the account leaves nothing open behind it.
  state.session = null;
  if (!sample && who.username) store.setLastUser(who.username);
  state.username = who.username;
  state.claim = who.claim;
  $('username').blur();
  state.flow = flow;
  state.sample = sample;
  setPhase('checking');
  await wait(300);
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
  hideVerdict();
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
  // The side-by-side view can be opened from the front page. Closing it goes back there.
  if (verdictOpen() && state.phase !== 'challenge') { hideVerdict(); return; }
  if (state.phase !== 'challenge') return;
  // Walking away after an inconclusive bowl still counts as having tried.
  recordAttempt();
  closeChallenge();
  setPhase('home');
}

/* Input */

const recorder = new SwingRecorder({ onSwing, onState: () => hint() });
let source = null;

// A final verdict on screen holds the lane, so a stray press of B cannot clear it.
const canBowl = () =>
  state.phase === 'challenge' && !state.busy && lane && !state.login.over && !(verdictOpen() && verdict.final)
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
  hideVerdict();
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
    // On the verdict, each button that does something has the remote's button drawn on it.
    if (verdictOpen()) {
      if (name === 'A') primary()?.click();
      else if (name === 'HOME') cancel();
      else if (name === 'MINUS') $('sound').click();
      else verdictEl.querySelector(`[data-wii="${name}"]`)?.click();
      return;
    }
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
  if (state.busy || (state.login && state.login.over) || !$('report').hidden || verdictOpen()) { el.hidden = true; return; }
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
  // The verdict: Enter does what A does, Escape what HOME does. Space is left alone.
  if (verdictOpen()) {
    if (ev.code === 'Enter' || ev.code === 'NumpadEnter') { ev.preventDefault(); primary()?.click(); return; }
    if (ev.code === 'Escape') { ev.preventDefault(); cancel(); return; }
    if (ev.code === 'Space' && verdict.final) { ev.preventDefault(); return; }
  }
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
  hideVerdict();
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
  const seq = state.seq;
  await wait(ms);
  if (state.phase !== 'challenge' || seq !== state.seq) return;
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
  state.seq++;
  hint();
  setStatus(state.flow === 'practice' ? 'Recording your swing...' : 'Analyzing your signature swing...', 'plain');
  showPower(thrown.power);
  audio.thud();
  audio.setMusic(false);
  const pins = await lane.play(thrown);
  if (state.phase !== 'challenge') return;
  // Which pins fell, for the verdict. The lane is reset before the verdict is drawn.
  const down = lane.pinsDown();
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
  else afterLogin(sig, pins, src, rec, down);
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
  if (clash && e.restarts < MATCH_CONFIG.twinRedos) {
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

function afterLogin(sig, pins, src, rec, down) {
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
  // What the verdict screen and the side-by-side view draw. Every number in it was just measured.
  const like = res.like || (final ? L.like : null);
  const card = {
    account: claim.id,
    username: claim.username,
    login: L.id,
    t: Date.now(),
    src,
    score: res.score,
    verdict,
    outcome: verdict === 'match' ? 'granted' : final ? 'denied' : 'unsure',
    bowl: L.bowls,
    crisis: res.crisis,
    like: like ? { username: like.account.username, score: like.score } : null,
    pins: { pins: pins.pins, strike: pins.strike, gutter: pins.gutter },
    down: down || null,
    force: forceOf(sig),
  };
  store.remember(card);
  const reveal = () => speech.verdict(report.outcome, final, pins, res.crisis);
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
    // The account waits behind a button. On stage the verdict stays up until somebody moves on.
    showVerdict(card, claim, reveal);
    settleQuietly();
    return;
  }
  if (final) {
    report.also = whoElseLine(claim.username, L.like);
    L.finished = true;
    recordAttempt();
  }
  showVerdict(card, claim, reveal);
  settle(1200);
}

/* The verdict screen and the side-by-side view */

const verdictEl = $('verdict');
const verdict = { mode: null, final: false, anim: 0, draw: [] };
function verdictOpen() { return !verdictEl.hidden; }

function hideVerdict() {
  cancelAnimationFrame(verdict.anim);
  verdict.mode = null;
  verdict.final = false;
  verdict.draw = [];
  if (verdictEl.hidden) return;
  verdictEl.hidden = true;
  verdictEl.innerHTML = '';
  hint();
}

const VERDICT_INK = { granted: '#16a34a', denied: '#dc2626', unsure: '#d97706' };
const swingColors = (line) => ({ line, saved: '#7c879b', band: 'rgba(124, 135, 155, 0.16)' });
const QUIET = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (k) => 1 - (1 - k) ** 3;

// How long ago the last log-in to this account counts as part of the same demo.
const PAIR_WINDOW_MS = 3 * 60 * 1000;

// The buttons under a verdict, by what can happen next.
function verdictButtons(card, mode) {
  const live = state.phase === 'challenge' && state.flow === 'login';
  const pairs = store.lastTwo(card.account);
  const b = [];
  if (mode === 'hero' && card.outcome === 'unsure') {
    b.push({ act: 'again', label: 'Bowl again', key: 'A', primary: true });
    b.push({ act: 'leave', label: 'Cancel', key: '⌂', wii: 'HOME' });
    return b;
  }
  // Straight after a second log-in, the side-by-side view is the next thing to see.
  const prev = pairs.length === 2 && pairs[1].login === card.login ? pairs[0] : null;
  const fresh = Boolean(prev && card.t - prev.t < PAIR_WINDOW_MS);
  const next = live && !state.sample ? { act: 'next', label: 'Next swing' } : null;
  const pair = mode === 'hero' && pairs.length === 2 ? { act: 'compare', label: 'Side by side' } : null;
  const first = fresh && pair ? [pair, next] : [next, pair];
  first.filter(Boolean).forEach((x, i) => b.push({ ...x, key: i ? '2' : 'A', wii: i ? '2' : undefined, primary: !i }));
  const mine = state.session && state.session.account.id === card.account && card.outcome === 'granted' && mode === 'hero';
  if (live && mine) b.push({ act: 'enter', label: 'Open account', key: '+', wii: 'PLUS' });
  b.push({ act: 'leave', label: 'Close', key: '⌂', wii: 'HOME', primary: !b.length });
  return b;
}

// Draws every swing graph in the overlay at `k` of the way along. Used by the animation and on resize.
function drawVerdictGraphs(k, done) {
  for (const d of verdict.draw) {
    drawSwing(d.canvas, { ...d.args, k: Math.min(1, Math.max(0, k * d.speed - d.delay)), colors: swingColors(done ? d.ink : '#1f2937') });
  }
}

function graphsFor(cards, profile) {
  const saved = savedForce(profile);
  if (!saved) return [];
  // Each graph is scaled to fit its own two lines, so a wild swing in one card does not flatten the other.
  return [...verdictEl.querySelectorAll('[data-swing]')].map((canvas, i) => ({
    canvas,
    ink: VERDICT_INK[cards[i].outcome],
    delay: i * 0.25,
    speed: 1 + (cards.length - 1) * 0.25,
    args: { saved, force: cards[i].force, range: forceRange([saved.lo, saved.hi, cards[i].force]) },
  }));
}

// One verdict: the score counts up as this swing is drawn over the saved one, then the mark lands.
function showVerdict(card, account, onReveal) {
  cancelAnimationFrame(verdict.anim);
  verdict.mode = 'hero';
  verdict.final = card.outcome !== 'unsure';
  const saved = savedForce(account.profile);
  verdictEl.innerHTML = `<div class="v-panel v-solo counting ${card.outcome}">${heroHTML(card, Boolean(saved))}
    <div class="v-actions">${actionsHTML(verdictButtons(card, 'hero'))}</div></div>`;
  verdictEl.hidden = false;
  hint();
  const panel = verdictEl.firstElementChild;
  const num = panel.querySelector('[data-score]');
  const fill = panel.querySelector('[data-fill]');
  verdict.draw = graphsFor([card], account.profile);
  const DUR = QUIET ? 0 : 1300;
  const start = performance.now();
  let shown = -1;
  fill.style.width = '0%';
  const land = () => {
    num.textContent = card.score;
    fill.style.width = `${card.score}%`;
    drawVerdictGraphs(1, true);
    panel.classList.remove('counting');
    panel.classList.add('shown');
    if (card.outcome === 'granted') audio.chime();
    else if (card.outcome === 'denied') audio.denied();
    else audio.unsure();
    onReveal?.();
  };
  const step = (now) => {
    if (verdict.mode !== 'hero') return;
    const k = DUR ? Math.min(1, (now - start) / DUR) : 1;
    const v = Math.round(easeOut(k) * card.score);
    if (v !== shown) {
      if (Math.floor(v / 5) !== Math.floor(shown / 5)) audio.tick(v / 100);
      shown = v;
      num.textContent = v;
      fill.style.width = `${v}%`;
    }
    drawVerdictGraphs(easeOut(k), false);
    if (k < 1) verdict.anim = requestAnimationFrame(step);
    else land();
  };
  verdict.anim = requestAnimationFrame(step);
}

// The last two log-ins to one account, side by side.
function showPair(accountId) {
  const account = store.get(accountId);
  const cards = account ? store.lastTwo(accountId) : [];
  if (cards.length < 2) return;
  cancelAnimationFrame(verdict.anim);
  verdict.mode = 'pair';
  verdict.final = true;
  const split = cards.some((c) => c.outcome === 'granted') && cards.some((c) => c.outcome === 'denied');
  verdictEl.innerHTML = `<div class="v-panel v-two">${pairHTML(cards, Boolean(savedForce(account.profile)), split ? 'We turned identity theft into a sport.' : '')}
    <div class="v-actions">${actionsHTML(verdictButtons(cards[1], 'pair'))}</div></div>`;
  verdictEl.hidden = false;
  hint();
  verdict.draw = graphsFor(cards, account.profile);
  audio.whoosh();
  const DUR = QUIET ? 0 : 1500;
  const start = performance.now();
  const step = (now) => {
    if (verdict.mode !== 'pair') return;
    const k = DUR ? Math.min(1, (now - start) / DUR) : 1;
    drawVerdictGraphs(k, true);
    if (k < 1) verdict.anim = requestAnimationFrame(step);
  };
  verdict.anim = requestAnimationFrame(step);
  track('side_by_side_viewed', {
    first_score: cards[0].score,
    second_score: cards[1].score,
    first_verdict: cards[0].outcome,
    second_verdict: cards[1].outcome,
    one_in_one_out: split,
    source: cards[1].src,
  });
}

window.addEventListener('resize', () => { if (verdictOpen()) drawVerdictGraphs(1, true); });

// Straight on to the next log-in to the same account, without going back to the front page.
function nextSwing() {
  if (state.phase !== 'challenge' || state.flow !== 'login' || !state.claim) return;
  if (state.sample) { cancel(); return; }
  recordAttempt();
  clearTimeout(state.autoOpen);
  hideVerdict();
  hideReport();
  hideBanner();
  state.seq++;
  state.session = null;
  state.login = newLogin();
  state.busy = false;
  lane.reset();
  lane.setAim(state.aim);
  audio.setMusic(true);
  header();
  setStatus(`Bowl ${state.username}'s password.`, 'plain');
  hint();
  speech.waiting(900);
  track('challenge_opened', { flow: 'login', input: srcKind(), again_on_same_account: true });
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

// The account page is a bank's dashboard. Everything on it comes from the account and the
// report of the log-in that opened it: nothing here is decided, only shown.

const ACCT_STILL = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const avgOf = (list) => list.reduce((s, v) => s + v, 0) / (list.length || 1);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const UI_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif';
const INK = { ok: '#12a150', bad: '#dc2626', mid: '#d97706', file: '#c9a227' };

// Line icons, drawn with currentColor.
const ICON = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.7 12l2.3 2.3 4.4-4.6"/>',
  alert: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M12 8v4.5M12 16h.01"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  out: '<path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  pin: '<path d="M12 2.5c-1.6 0-2.5 1.3-2.5 2.8 0 1.3.7 2 .7 3.1 0 1.4-2.2 3.4-2.2 7.4 0 3.2 1.6 5.7 4 5.7s4-2.5 4-5.7c0-4-2.2-6-2.2-7.4 0-1.1.7-1.8.7-3.1 0-1.5-.9-2.8-2.5-2.8z"/><path d="M10.3 8.2h3.4"/>',
  shoe: '<path d="M3 17.5V9h5l1.5 3.5 6.5 1.5c2.4.6 5 1.6 5 3.5v0H3z"/><path d="M3 20h18"/>',
  drop: '<path d="M12 3.5s6 6.4 6 10.8a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/>',
  trend: '<path d="M4 17l5.5-5.5 4 4L20 9"/><path d="M15 9h5v5"/>',
  nacho: '<path d="M12 4l8.5 15h-17z"/><circle cx="11" cy="13" r=".8"/><circle cx="13.5" cy="16" r=".8"/>',
  watch: '<rect x="7" y="7" width="10" height="10" rx="3"/><path d="M9 7l.8-3.5h4.4L15 7M9 17l.8 3.5h4.4L15 17M12 10v2.2l1.4 1"/>',
  down: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
  spark: '<path d="M4 18l4.5-5 3.5 3 7.5-9"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ICON.pin}</svg>`;

// A ring that fills to the score, with a tick at the pass mark.
function scoreRing(score, ok) {
  const pass = MATCH_CONFIG.scoreMatch / 100;
  const a = pass * Math.PI * 2;
  const at = (r) => `${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a)).toFixed(1)}`;
  return `<div class="ring ${ok ? 'ok' : 'bad'}" aria-hidden="true">
    <svg viewBox="0 0 100 100">
      <circle class="track" cx="50" cy="50" r="42" />
      <circle class="val" cx="50" cy="50" r="42" pathLength="100" style="stroke-dasharray:${score} 100" />
      <path class="mark" d="M${at(35)} L${at(49)}" />
    </svg>
    <span>${icon(ok ? 'shield' : 'alert')}</span>
  </div>`;
}

// Ten pins in a rack, with as many knocked down as fell. Which ones fell is not known here.
function miniRack(pins) {
  const n = pins ? (pins.strike ? 10 : pins.pins) : 0;
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const rows = [[6, 7, 8, 9], [3, 4, 5], [1, 2], [0]];
  return `<div class="minirack" aria-hidden="true">${rows.map((row) => `<div>${row.map((i) => `<i class="${order.indexOf(i) < n ? 'down' : ''}"></i>`).join('')}</div>`).join('')}</div>`;
}

function acctHero(a, created) {
  const last4 = String(a.number).replace(/\s/g, '').slice(-4);
  const flag = a.sample ? 'Sample customer · formula swing' : a.source === 'pointer' ? 'Pointer password · simulated' : '';
  return `
    <section class="hero">
      <div class="hero-main">
        <div class="hero-who">
          <div class="ball" aria-hidden="true"><i></i><i></i><i></i></div>
          <div>
            <p class="hello">${created ? `Welcome to ${esc(ID.bank)}` : 'Welcome back'}</p>
            <h1 id="acct-name">${esc(a.username)}</h1>
            <p class="sub">${a.sample ? esc(a.name) : `On the lanes: ${esc(a.name)}`} · Account •••• ${esc(last4)}</p>
          </div>
        </div>
        <div class="pills">
          <span class="pill ok">${icon('check')}${created ? 'Password set' : 'Identity verified'}</span>
          <span class="pill glass">${icon('pin')}Authenticated with ${esc(ID.name)}</span>
          ${flag ? `<span class="pill warn">${esc(flag)}</span>` : ''}
        </div>
        <p class="bal-label">Available balance</p>
        <div class="balance" data-balance="${a.balance}">${money(a.balance)}</div>
        <p class="bal-note">Not real. Not withdrawable. Not even with a strike.</p>
      </div>
      <div class="bowlcard" aria-hidden="true">
        <div class="bc-top"><b>${esc(ID.bank)}</b><span>Platinum Lane</span></div>
        <div class="bc-chip"><i></i><i></i><i></i></div>
        <div class="bc-num">${esc(a.number)}</div>
        <div class="bc-bottom">
          <div><small>Card holder</small><b>${esc(a.username)}</b></div>
          <div><small>PIN</small><b>Bowl it</b></div>
        </div>
      </div>
      <p class="hero-foot">${icon('lock')}<span><b>No password was typed.</b> You bowled it.</span></p>
    </section>`;
}

// Why the account opened: the identity result and the bowling result, kept well apart.
function acctAuth(a, r, created) {
  const ok = VERDICT_CLASS[r.outcome] === 'ok';
  const identity = r.score != null ? `
      <div class="tile identity">
        ${scoreRing(r.score, ok)}
        <div>
          <span class="t-label">Bowlometric Identity Score</span>
          <b class="t-big">${r.score}<i>/100</i></b>
          <span class="chip ok">${icon('check')}It’s you</span>
          <em>${MATCH_CONFIG.scoreMatch} passes. Similarity, not a probability.</em>
        </div>
      </div>` : `
      <div class="tile identity">
        ${scoreRing(100, true)}
        <div>
          <span class="t-label">Password set</span>
          <b class="t-big">${a.profile.templates.length}<i>swings on file</i></b>
          <span class="chip ok">${icon('check')}Only you can get in</span>
          <em>Your backswing is now the only way in.</em>
        </div>
      </div>`;
  const bowling = r.pins ? `
      <div class="tile bowling">
        <span class="t-label">Bowling result</span>
        <b class="t-mid">${esc(pinsLabel(r.pins))}</b>
        ${miniRack(r.pins)}
        <span class="chip muted">Not considered</span>
      </div>` : `
      <div class="tile bowling">
        <span class="t-label">On the lanes you are</span>
        <b class="t-mid name">${esc(a.name)}</b>
        <span class="chip muted">A nickname, not a password</span>
      </div>`;
  const rows = r.rows || [];
  const compare = Boolean(r.sig);
  const matched = rows.filter((x) => x.ok).length;
  const traitsHTML = rows.map((t) => `
      <li>
        <span class="tl">${esc(t.label)}</span>
        ${compare ? `<span class="tv">${t.value} <small>${esc(t.unit)}</small></span>` : ''}
        <span class="tf">${t.onFile} <small>${esc(t.unit)}</small></span>
        ${compare ? `<span class="tk ${t.ok ? 'ok' : 'bad'}">${icon(t.ok ? 'check' : 'x')}</span>` : ''}
      </li>`).join('');
  const notes = [];
  if (r.outcome === 'recognized') notes.push(...rows.filter((x) => x.ok).slice(0, 2).map(traitLine), SKILL_LINE);
  const title = created ? 'Your backswing is your password'
    : `Why we let you in${r.pins && r.pins.gutter ? ', gutter ball and all' : ''}`;
  return `
    <section class="panel auth">
      <div class="panel-head">
        <div>
          <span class="kicker">${created ? 'New account' : 'Sign-in report'}</span>
          <h2>${esc(title)}</h2>
          <p class="lede">${esc(r.line)}</p>
        </div>
        ${SOURCE_NOTE[r.src] ? `<span class="pill warn small" title="${esc(SOURCE_NOTE[r.src])}">${r.src === 'synthetic' ? 'Formula swing' : 'Simulated input'}</span>` : ''}
      </div>
      <div class="verdict-row">
        ${identity}
        <div class="neq" aria-hidden="true">≠</div>
        ${bowling}
      </div>
      <p class="footnote">${created ? 'The pins never decide anything.' : 'Pins do not affect authentication.'}</p>
      ${r.also ? `<p class="also">${esc(r.also)}</p>` : ''}
      ${r.compare ? `
      <div class="auth-detail">
        <div class="box">
          <div class="box-head">
            <h3>Swing signature</h3>
            <div class="legend">
              <span><i style="background:${INK.file}"></i>On file</span>
              ${compare ? `<span><i style="background:${ok ? INK.ok : INK.bad}"></i>This swing</span>` : ''}
            </div>
          </div>
          <div class="chart"><canvas data-sig></canvas></div>
          <p class="caption">Force through the swing, lined up at the release.</p>
        </div>
        <div class="box">
          <div class="box-head">
            <h3>Measured</h3>
            ${compare ? `<span class="count ${matched === rows.length ? 'ok' : ''}">${matched} of ${rows.length} match</span>` : ''}
          </div>
          <ul class="tlist">
            <li class="heads"><span class="tl"></span>${compare ? '<span class="tv">This swing</span>' : ''}<span class="tf">On file</span>${compare ? '<span class="tk"></span>' : ''}</li>
            ${traitsHTML}
          </ul>
        </div>
      </div>` : ''}
      ${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </section>`;
}

// Successful sign-ins and declined attempts on this account, newest first.
function acctSecurity(a, fresh) {
  const total = a.attemptsEver;
  const newOnes = new Set(fresh ? a.attempts.slice(-fresh) : []);
  const events = [
    ...a.history.map((h) => ({ t: h.t, ok: true, h })),
    ...a.attempts.map((x) => ({ t: x.t, ok: false, x })),
  ].sort((p, q) => q.t - p.t).slice(0, 5);
  const banner = !total
    ? `<div class="sec-banner ok">${icon('shield')}<div><b>All clear</b><span>Nobody has bowled your username with the wrong swing. Yet.</span></div></div>`
    : `<div class="sec-banner ${fresh ? 'bad' : 'calm'}">${icon('alert')}<div><b>${plural(total, 'declined sign-in')}</b><span>${fresh ? `${fresh} since your last visit. ` : ''}Somebody typed your username and bowled the wrong swing.</span></div></div>`;
  const feed = events.map((e) => (e.ok ? `
      <li>
        <span class="dot ok">${icon('check')}</span>
        <div><b>Signed in</b><span>Bowled like you</span></div>
        <div class="rt"><b>${e.h.score}<small>/100</small></b><span>${clock(e.t)}</span></div>
      </li>` : `
      <li class="${newOnes.has(e.x) ? 'new' : ''}">
        <span class="dot bad">${icon('x')}</span>
        <div><b>Declined: identity mismatch${newOnes.has(e.x) ? ' <em>New</em>' : ''}</b><span>${esc(attemptLine(e.x))}</span></div>
        <div class="rt"><b>${e.x.score}<small>/100 as you</small></b><span>${clock(e.t)}</span></div>
      </li>`)).join('');
  return `
    <section class="panel security">
      <div class="panel-head"><h3>Account security</h3><span class="pill ${fresh ? 'bad' : 'okfaint'} small">${fresh ? `${fresh} new` : 'Secure'}</span></div>
      ${banner}
      <div class="stats3">
        <div><b>${a.logins}</b><span>Sign-ins</span></div>
        <div><b>${total}</b><span>Declined</span></div>
        <div><b>${fresh}</b><span>Since last visit</span></div>
      </div>
      <ul class="feed">${feed}</ul>
    </section>`;
}

// How much like themselves the owner bowls, and how the recent attempts went.
function acctYouness(a) {
  const own = a.history.map((h) => h.score);
  const avg = Math.round(avgOf(own));
  const recent = [
    ...a.history.map((h) => ({ t: h.t, score: h.score, ok: true })),
    ...a.attempts.map((x) => ({ t: x.t, score: x.score, ok: false })),
  ].sort((p, q) => p.t - q.t).slice(-6);
  return `
    <section class="panel youness">
      <div class="panel-head"><h3>You-ness</h3><span class="pill okfaint small">${esc(younessLabel(avg))}</span></div>
      <div class="yn-top">
        <b class="yn-big">${avg}<i>/100</i></b>
        <span>Average score as yourself<br>over ${plural(own.length, 'sign-in')}</span>
      </div>
      <div class="ychart"><canvas data-youness></canvas></div>
      <div class="yn-chips" aria-label="Recent scores, oldest to newest">
        ${recent.map((p) => `<span class="sc ${p.ok ? 'ok' : 'bad'}" title="${p.ok ? 'Signed in' : 'Declined'} at ${clock(p.t)}">${icon(p.ok ? 'check' : 'x')}${p.score}</span>`).join('')}
      </div>
      <div class="legend">
        <span><i style="background:${INK.ok}"></i>You, getting in</span>
        <span><i class="dotkey" style="background:${INK.bad}"></i>Declined</span>
        <span><i class="dashkey"></i>${MATCH_CONFIG.scoreMatch} to pass</span>
      </div>
    </section>`;
}

function acctStatement() {
  const days = [];
  for (const row of STATEMENT) {
    const [, , , day] = row;
    let group = days.find((d) => d.day === day);
    if (!group) days.push(group = { day, rows: [] });
    group.rows.push(row);
  }
  const net = STATEMENT.reduce((s, [, v]) => s + v, 0);
  return `
    <section class="panel statement-card">
      <div class="panel-head"><h3>Recent activity</h3><span class="muted">CAD</span></div>
      ${days.map((d) => `
        <p class="tx-day">${esc(d.day)}</p>
        <ul class="tx">${d.rows.map(([what, v, cat, , ic]) => `
          <li>
            <span class="tx-ic">${icon(ic)}</span>
            <div><b>${esc(what)}</b><span>${esc(cat || '')}</span></div>
            <span class="amt ${v > 0 ? 'in' : ''}">${v > 0 ? '+' : '−'}${money(Math.abs(v))}</span>
          </li>`).join('')}
        </ul>`).join('')}
      <div class="tx-net"><span>Net this week</span><b class="${net > 0 ? 'in' : ''}">${net > 0 ? '+' : '−'}${money(Math.abs(net))}</b></div>
    </section>`;
}

// The branch ledger: every log-in bowl at this branch, as counts.
function ledgerStats() {
  const l = store.ledger();
  if (!l.bowls) return null;
  const per = l.logins ? (l.loginBowls / l.logins).toFixed(1) : '–';
  return [
    [l.guttersIn, 'Gutter balls let in'],
    [l.strikesOut, 'Strikes turned away'],
    [l.crises, 'Identity crises'],
    [per, 'Bowls per sign-in'],
  ];
}

function acctFacts(a) {
  const per = a.logins ? (a.bowls / a.logins).toFixed(1) : '–';
  const ledger = ledgerStats();
  const tiles = (list) => list.map(([v, label]) => `<div><b>${esc(v)}</b><span>${esc(label)}</span></div>`).join('');
  return `
    <section class="panel facts">
      <div class="panel-head"><h3>Your password</h3><span class="muted">${a.profile.gyro ? 'With MotionPlus' : 'Accelerometer only'}</span></div>
      <div class="tiles">${tiles([
        [a.profile.templates.length, 'Swings on file'],
        [a.logins, 'Sign-ins'],
        [per, 'Bowls per sign-in'],
        [a.guttersIn, 'Gutter balls that got in'],
      ])}</div>
      ${ledger ? `
      <div class="panel-head sub"><h3>Branch ledger</h3><span class="muted">All customers</span></div>
      <div class="tiles ledger-tiles">${tiles(ledger)}</div>` : ''}
    </section>`;
}

// Draws force over the swing: the swings on file in gold, this swing over them in the verdict's colour.
function drawSignature(canvas, r) {
  if (!canvas || !r.compare) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const sets = r.compare.profile.templates.map((t) => ({ seq: t.seq, mine: false }));
  if (r.sig) sets.push({ seq: r.sig.seq, mine: true });
  let top = 2.5;
  for (const s of sets) for (const p of s.seq) top = Math.max(top, Math.hypot(p[0], p[1], p[2]));
  const padT = 22;
  const padB = 8;
  const X = (i, n) => (i / (n - 1)) * w;
  const Y = (v) => h - padB - (v / top) * (h - padT - padB);
  // Faint guide lines, one per g.
  g.strokeStyle = 'rgba(15, 23, 42, 0.06)';
  g.lineWidth = 1;
  for (let v = 1; v < top; v++) { g.beginPath(); g.moveTo(0, Math.round(Y(v)) + 0.5); g.lineTo(w, Math.round(Y(v)) + 0.5); g.stroke(); }
  g.font = `600 11px ${UI_FONT}`;
  g.fillStyle = 'rgba(100, 116, 139, 0.9)';
  g.fillText('Force', 0, 11);
  // The release sits three quarters of the way along every signature.
  const rx = Math.round(w * 0.75) + 0.5;
  g.strokeStyle = 'rgba(15, 23, 42, 0.28)';
  g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(rx, padT - 4); g.lineTo(rx, h); g.stroke();
  g.setLineDash([]);
  const label = 'Release';
  const lw = g.measureText(label).width + 14;
  g.fillStyle = '#0f172a';
  g.beginPath(); g.roundRect(rx - lw / 2, 0, lw, 18, 9); g.fill();
  g.fillStyle = '#fff';
  g.fillText(label, rx - lw / 2 + 7, 13);
  const ink = VERDICT_CLASS[r.outcome] === 'ok' ? INK.ok : INK.bad;
  for (const s of sets) {
    const pts = s.seq.map((p, i) => [X(i, s.seq.length), Y(Math.hypot(p[0], p[1], p[2]))]);
    if (s.mine) {
      const fill = g.createLinearGradient(0, padT, 0, h);
      fill.addColorStop(0, `${ink}33`);
      fill.addColorStop(1, `${ink}00`);
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(pts[0][0], h);
      for (const [x, y] of pts) g.lineTo(x, y);
      g.lineTo(pts[pts.length - 1][0], h);
      g.fill();
    }
    g.strokeStyle = s.mine ? ink : 'rgba(201, 162, 39, 0.75)';
    g.lineWidth = s.mine ? 3 : 2;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
}

// You-ness over time: the owner's scores as a line, declined attempts as dots, and the pass mark.
function drawYouness(canvas, a) {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const points = [
    ...a.history.map((x) => ({ t: x.t, score: x.score, own: true })),
    ...a.attempts.map((x) => ({ t: x.t, score: x.score, own: false })),
  ].sort((p, q) => p.t - q.t);
  const pad = 8;
  const x = (i) => (points.length > 1 ? pad + (i / (points.length - 1)) * (w - pad * 2) : w / 2);
  const y = (score) => h - pad - (score / 100) * (h - pad * 2);
  // The pass mark. Above it is where an owner should be.
  const passY = y(MATCH_CONFIG.scoreMatch);
  g.strokeStyle = 'rgba(15, 23, 42, 0.25)';
  g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(0, Math.round(passY) + 0.5); g.lineTo(w, Math.round(passY) + 0.5); g.stroke();
  g.setLineDash([]);
  const own = points.map((p, i) => [p, i]).filter(([p]) => p.own);
  if (own.length > 1) {
    const fill = g.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(18, 161, 80, 0.16)');
    fill.addColorStop(0.7, 'rgba(18, 161, 80, 0)');
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(x(own[0][1]), h);
    for (const [p, i] of own) g.lineTo(x(i), y(p.score));
    g.lineTo(x(own[own.length - 1][1]), h);
    g.fill();
    g.strokeStyle = INK.ok;
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.beginPath();
    own.forEach(([p, i], k) => (k ? g.lineTo(x(i), y(p.score)) : g.moveTo(x(i), y(p.score))));
    g.stroke();
  }
  points.forEach((p, i) => {
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(x(i), y(p.score), p.own ? 5 : 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = p.own ? INK.ok : INK.bad;
    g.beginPath(); g.arc(x(i), y(p.score), p.own ? 3.5 : 4.5, 0, Math.PI * 2); g.fill();
  });
}

// The balance counts up when the account opens. It is a lot of money, and it should feel like it.
function countUp(el) {
  if (!el) return;
  const to = Number(el.dataset.balance);
  if (ACCT_STILL || !Number.isFinite(to)) return;
  const start = performance.now();
  const DUR = 1200;
  const step = (now) => {
    if (!el.isConnected) return;
    const k = Math.min(1, (now - start) / DUR);
    el.textContent = money(to * (1 - (1 - k) ** 4));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function drawAccountCharts() {
  if (state.phase !== 'account' || !state.session) return;
  const el = $('inside');
  drawSignature(el.querySelector('[data-sig]'), state.session.report);
  drawYouness(el.querySelector('[data-youness]'), state.session.account);
}
let acctResize = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(acctResize);
  acctResize = requestAnimationFrame(drawAccountCharts);
});

function renderAccount() {
  const { account: a, report: r, created, fresh } = state.session;
  const el = $('inside');
  const charted = a.history.length + a.attempts.length;
  el.style.setProperty('--c', a.color);
  el.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">${icon('pin')}</span>
        <b>${esc(ID.bank)}</b>
        <span class="by">Secured by ${esc(ID.name)}</span>
      </div>
      <button class="signout" type="button" id="signout">${icon('out')}Sign out<kbd class="remote">A</kbd></button>
    </header>
    ${acctHero(a, created)}
    ${acctAuth(a, r, created)}
    <div class="acct-grid">
      ${acctSecurity(a, fresh)}
      ${charted ? acctYouness(a) : ''}
    </div>
    <div class="acct-grid wide-left">
      ${acctStatement()}
      ${acctFacts(a)}
    </div>
    <footer class="acct-foot">
      <span>${esc(ID.bank)} is a member of the BDIC, the Bowling Deposit Insurance Corporation. Deposits are insured up to one strike.</span>
      ${a.sample ? '' : '<button class="danger-btn" type="button" data-act="close">Close this account</button>'}
    </footer>`;
  $('inside').hidden = false;
  // The page opens at its top, with the charts drawn once the layout has settled.
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    drawSignature(el.querySelector('[data-sig]'), r);
    drawYouness(el.querySelector('[data-youness]'), a);
  });
  countUp(el.querySelector('[data-balance]'));
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
  next: nextSwing,
  compare: () => {
    const a = state.phase === 'challenge' ? state.claim : store.find($('username').value);
    if (a) showPair(a.id);
  },
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
$('username').addEventListener('input', () => {
  if (state.note) { state.note = null; showNote(); }
  pairButton();
});
$('username').addEventListener('focus', () => $('username').select());
$('pair').addEventListener('click', () => { audio.start(); audio.click(); actions.compare(); });

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

// The last username bowled for is already typed in, so the next log-in is one press of A.
$('username').value = store.lastUser();
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
