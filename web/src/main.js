// BowlID. No usernames and no passwords: an account is opened by the way its owner bowls.
// The page has two buttons. Either one opens a CAPTCHA-style window with a bowling lane in it.
// The pins never decide anything. The swing is compared with every enrolled customer.
// The bank this grew out of still lives in bank.html and bank-main.js.
import { Lane } from './game/lane3d.js';
import { throwFromSwing } from './game/throw.js';
import { audio } from './game/audio.js';
import { SwingRecorder } from './motion/recorder.js';
import { makeSignature, checkQuality } from './motion/signal.js';
import { MATCH_CONFIG, buildProfile, identify, collision, traits } from './motion/matcher.js';
import { syntheticSet } from './motion/synthetic.js';
import { WiiSource, MouseSource, replaySwing } from './input/sources.js';
import { store } from './id/store.js';
import { track } from './analytics.js';
import {
  ID, ask, headline, verdictLine, traitLine, nameFor, pinsLabel, money,
  SKILL_LINE, QUALITY, NO_SWING, STATEMENT, SOURCE_NOTE,
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
  enroll: null, // { throws: [{ sig, pins, bad, rec }], restarts }
  login: null, // { bowls, pins, startedAt, over, finished }
  report: null,
  session: null, // { account, report, created }
};

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
  el.textContent = `Branch ledger. Gutter balls let in: ${l.guttersIn}. Strikes turned away: ${l.strikesOut}. Identity crises: ${l.crises}. Bowls to recognise yourself: ${per}.`;
}

function home() {
  const kind = state.mode === 'wii' ? 'wii' : 'pointer';
  const n = store.accounts(kind).length;
  const note = $('widget-note');
  note.className = 'widget-note';
  note.textContent = n
    ? `${n} bowling identit${n === 1 ? 'y' : 'ies'} on file for ${kind === 'wii' ? 'the Wii Remote' : 'the pointer (simulated)'}.`
    : `Nobody is on file for ${kind === 'wii' ? 'the Wii Remote' : 'the pointer (simulated)'} yet.`;
  $('widget-label').textContent = 'I am me';
  const links = [
    '<a href="#" data-act="sample">No remote? Watch a sample customer log in (simulated).</a>',
    `<a href="#" data-act="practice">Practice lane${WHO ? `, recording as ${esc(WHO)}` : ''}</a>`,
  ];
  if (recorded.length) links.push(`<a href="#" data-act="export">Export ${recorded.length} recorded swing${recorded.length === 1 ? '' : 's'}</a>`);
  $('home-links').innerHTML = links.join('<br>');
  document.body.classList.toggle('wii', state.mode === 'wii');
  ledgerLine();
}

function setPhase(phase) {
  state.phase = phase;
  widget.dataset.state = phase === 'home' ? 'idle' : phase === 'account' ? 'verified' : 'checking';
  $('home').hidden = phase === 'account';
  $('inside').hidden = phase !== 'account';
  $('create').disabled = $('login').disabled = phase !== 'home';
  if (phase === 'home') home();
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
  lane.setAim(state.aim);
  window.bowlid.lane = lane;
}

function header() {
  const e = state.enroll;
  const done = e ? e.throws.filter((t) => !t.bad).length : 0;
  const [top, main, sub] = ask(state.flow, done, MATCH_CONFIG.enrollThrows);
  $('ask-top').textContent = top;
  $('ask-main').textContent = main;
  $('ask-sub').textContent = sub;
  const sim = $('sim');
  const kind = state.sample ? 'synthetic' : srcKind();
  sim.hidden = kind === 'wii';
  sim.parentElement.classList.toggle('simulated', kind !== 'wii');
  sim.textContent = kind === 'synthetic' ? 'Simulated: sample customer, formula swing' : 'Simulated swing: pointer, not a Wii Remote';
}

async function openChallenge(flow, sample = null) {
  if (state.phase !== 'home') return;
  audio.start();
  audio.click();
  state.flow = flow;
  state.sample = sample;
  $('widget-label').textContent = flow === 'enroll' ? 'Learning who you are...' : 'Confirming that you are you...';
  setPhase('checking');
  await wait(850);
  state.enroll = flow === 'enroll' ? { throws: [], restarts: 0 } : null;
  state.login = { bowls: 0, pins: 0, startedAt: performance.now(), over: false, finished: false };
  state.busy = false;
  $('veil').hidden = false;
  document.body.classList.add('challenge');
  ensureLane();
  lane.reset();
  lane.setActive(true);
  audio.setMusic(true);
  state.phase = 'challenge';
  header();
  setStatus(flow === 'enroll' ? 'Create a swing that feels like you.' : flow === 'login' ? 'Show us your signature swing.' : '', 'plain');
  hideBanner();
  hideReport();
  drawSlots();
  hint();
  track('challenge_opened', { flow, input: sample ? 'synthetic' : srcKind() });
  if (sample) {
    await wait(1100);
    if (state.phase === 'challenge') playSample(sample);
  }
}

function closeChallenge() {
  clearTimeout(state.autoOpen);
  $('veil').hidden = true;
  document.body.classList.remove('challenge');
  $('info').hidden = true;
  hideReport();
  hideBanner();
  if (lane) { lane.reset(); lane.setActive(false); }
  audio.roll(0);
  audio.setMusic('off');
  recorder.cancel();
  state.busy = false;
  state.charge = null;
  state.replaying = false;
  state.sample = null;
}

function cancel() {
  if (state.phase !== 'challenge') return;
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
  if (state.login.finished) state.login = { bowls: 0, pins: 0, startedAt: performance.now(), over: false, finished: false };
}

// The hub is what every source and every replay talks to.
const hub = {
  emit(name, ...args) {
    if (name === 'samples') recorder.push(args[0]);
    else if (name === 'aim') {
      // The aim is locked while a swing is being read. The remote points everywhere during a swing.
      if (recorder.state === 'idle' && !state.charge) setAim(args[0]);
    } else if (name === 'press') {
      if (!canBowl()) return;
      state.pressAim = steadyAim();
      lane.setAim(state.pressAim);
      lane.setSwing('back');
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
    if (!state.status.connected) { el.innerHTML = state.status.bridge ? 'Press any button on the Wii Remote to wake it.' : 'Wii Remote bridge not found. Run <kbd>./scripts/start.sh</kbd>'; return; }
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
    lines.push(...good, SKILL_LINE);
  } else if (r.outcome === 'unknown' || r.outcome === 'unsure') {
    lines.push(...r.rows.filter((x) => x.ok === false).slice(0, 2).map(traitLine));
  }
  const versus = r.outcome === 'created' ? 'Your swings, now on file'
    : r.outcome === 'recognized' ? 'This swing against your swings on file'
      : r.rows.length ? 'This swing against the closest customer on file' : '';
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
  const el = $('report');
  const cls = VERDICT_CLASS[r.outcome];
  let actions = '';
  if (r.outcome === 'recognized' || r.outcome === 'created') {
    actions = '<button class="verify" type="button" data-act="enter" data-primary>Open my account</button>';
  } else if (r.final) {
    actions = `<button class="verify" type="button" data-act="to-enroll" data-primary>Create an account</button>
      <span>or bowl again.</span>`;
  } else {
    actions = `<span>Bowl again. Attempt ${r.bowls} of ${MATCH_CONFIG.maxLoginBowls}.</span>`;
  }
  el.className = `report ${cls}`;
  el.innerHTML = `
    <div class="head">
      <small>BowlID biometric report</small>
      <h2>${esc(r.title)}</h2>
      <p>${esc(r.line)}</p>
    </div>
    ${reportBody(r)}
    <div class="actions">${actions}</div>`;
  el.hidden = false;
  drawReportGraph(el, r);
  setStatus(r.title, cls === 'ok' ? 'ok' : cls === 'bad' ? '' : 'plain');
  hint();
}
function hideReport() { $('report').hidden = true; }

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
  const guess = res.outcome === 'recognized' ? `Would open ${res.best.account.name} (score ${res.best.score}).`
    : res.outcome === 'ambiguous' ? `Would be an identity crisis: ${res.best.account.name} or ${res.rival.account.name}.`
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
    setStatus(`Your swing looks a lot like ${clash.account.name}'s. If that is you, cancel and log in. If not, bowl ${MATCH_CONFIG.enrollThrows} more with a flourish that is yours.`);
    track('enroll_clash', { input: src });
    next();
    return;
  }
  const taken = [...store.accounts(), ...store.accounts('synthetic')].map((a) => a.name);
  const name = nameFor(profile, good.map((t) => t.pins), taken, store.nextSerial());
  const account = store.open(name, profile, src, clash ? clash.account.id : null);
  if (!WHO) for (const t of e.throws) t.rec.participant = name;
  track('identity_created', { input: src, enroll_throws: e.throws.length, spread: profile.spread, consistent: profile.consistent, has_twin: Boolean(clash), motionplus: profile.gyro });
  drawSlots();
  const report = {
    outcome: 'created',
    final: true,
    title: 'Identity created',
    line: clash
      ? `You are now ${name}. Your password is your backswing, which you appear to share with ${clash.account.name}.`
      : `You are now ${name}. Your password is now your backswing.`,
    pins: null,
    score: null,
    rows: traits(null, profile),
    compare: account,
    sig: null,
    src,
  };
  state.login.over = true;
  state.session = { account, report, created: true };
  audio.chime();
  showReport(report);
  lane.reset();
  hideBanner();
  state.autoOpen = setTimeout(enter, 7000);
}

function afterLogin(sig, pins, src, rec) {
  const L = state.login;
  L.bowls++;
  L.pins += pins.pins;
  const gallery = store.accounts(src);
  const res = identify(sig, gallery);
  const outcome = res.outcome;
  const final = outcome === 'recognized' || outcome === 'unknown' || L.bowls >= MATCH_CONFIG.maxLoginBowls;
  // Sample customers are formula swings. They stay out of the ledger.
  if (src !== 'synthetic') store.bowl(outcome, pins);
  track('login_bowl', {
    bowlometric_identity_score: res.best ? res.best.score : null,
    outcome,
    pins: pins.pins,
    strike: pins.strike,
    gutter: pins.gutter,
    attempt: L.bowls,
    identities_on_file: gallery.length,
    input: src,
  });
  const names = res.rival ? [res.best.account.name, res.rival.account.name] : [];
  const report = {
    outcome,
    final,
    bowls: L.bowls,
    title: gallery.length ? headline(outcome, final) : 'Identity unknown',
    line: gallery.length ? verdictLine(outcome, pins, names, final) : 'Nobody is on file yet. There is no one for you to be.',
    pins,
    score: res.best ? res.best.score : null,
    rows: res.best ? traits(sig, res.best.account.profile) : [],
    compare: res.best ? res.best.account : null,
    sig,
    src,
  };
  if (outcome === 'recognized') {
    const account = res.best.account;
    report.title = 'Identity verified';
    report.line = `${verdictLine(outcome, pins, names, final)} You are ${account.name}.`;
    if (!WHO) rec.participant = account.name;
    L.over = true;
    if (src !== 'synthetic') store.login(account, L.bowls, L.pins, pins.gutter);
    track('login_done', {
      bowls_to_recognise_yourself: L.bowls,
      pins_before_account_access: L.pins,
      seconds_spent: Math.round((performance.now() - L.startedAt) / 1000),
      got_in_on_a_gutter_ball: pins.gutter,
      input: src,
    });
    state.session = { account, report, created: false };
    audio.chime();
    showReport(report);
    state.autoOpen = setTimeout(enter, 7000);
    settleQuietly();
    return;
  }
  if (final) L.finished = true;
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

function renderAccount() {
  const { account: a, report: r, created } = state.session;
  const el = $('inside');
  const rows = STATEMENT.map(([what, v]) => `<tr><td>${esc(what)}</td><td class="${v < 0 ? 'neg' : ''}">${money(v)}</td></tr>`).join('');
  const per = a.logins ? (a.bowls / a.logins).toFixed(1) : null;
  el.style.setProperty('--c', a.color);
  el.innerHTML = `
    <div class="who">
      <div class="ball" aria-hidden="true"><i></i><i></i><i></i></div>
      <div>
        <small>${esc(ID.bank)} · signed in with ${esc(ID.name)}</small>
        <h1 id="acct-name">${esc(a.name)}</h1>
        <span>Account ${esc(a.number)}${a.sample ? ' · sample customer, formula swing' : a.source === 'pointer' ? ' · pointer identity (simulated)' : ''}</span>
      </div>
      ${a.sample ? '' : '<button class="link" type="button" data-act="rename">Rename</button>'}
    </div>
    <div class="balance">${money(a.balance)}</div>
    <p class="fine left">Available balance. Not real. Not withdrawable. Not even with a strike.</p>
    <div class="why ${VERDICT_CLASS[r.outcome]}">
      <h3>${created ? 'Your account is open. Your backswing is the only way in.' : `Why we let you in${r.pins && r.pins.gutter ? ', gutter ball and all' : ''}`}</h3>
      ${reportBody(r)}
    </div>
    <h3>Recent activity</h3>
    <table class="statement">${rows}</table>
    <p class="fine left">${a.profile.templates.length} swings on file${a.profile.gyro ? ', with MotionPlus' : ''}. Recognised ${a.logins} time${a.logins === 1 ? '' : 's'}${per ? `, in ${per} bowl${per === '1.0' ? '' : 's'} on average` : ''}. Gutter balls that got in: ${a.guttersIn}.</p>
    <div class="row">
      <button class="submit" type="button" id="signout">Sign out</button>
      ${a.sample ? '' : '<button class="link danger" type="button" data-act="close">Close this account</button>'}
    </div>
    <p class="fine">No password was used. There is no password.</p>`;
  $('inside').hidden = false;
  drawReportGraph(el, r);
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
  'to-enroll': () => {
    // Stay in the same window and switch to enrollment.
    state.flow = 'enroll';
    state.enroll = { throws: [], restarts: 0 };
    state.login = { bowls: 0, pins: 0, startedAt: performance.now(), over: false, finished: false };
    hideReport();
    header();
    drawSlots();
    setStatus('Create a swing that feels like you.', 'plain');
    hint();
  },
  sample: () => openChallenge('login', 'gary'),
  practice: () => openChallenge('practice'),
  export: () => {
    const blob = new Blob([JSON.stringify(recorded)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bowlid-swings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  rename: () => {
    const h = $('acct-name');
    if (h.querySelector('input')) return;
    const a = state.session.account;
    h.innerHTML = `<input id="new-name" type="text" maxlength="32" value="${esc(a.name)}" aria-label="Display name. It is never used to log in." />`;
    const input = $('new-name');
    input.focus();
    input.select();
    const done = () => {
      store.rename(a.id, input.value);
      h.textContent = store.get(a.id).name;
      state.session.account = store.get(a.id);
    };
    input.addEventListener('blur', done);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); });
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

$('verify').addEventListener('click', () => {
  audio.click();
  if (state.busy) return;
  const p = primary();
  if (p) { p.click(); return; }
  setStatus(state.flow === 'enroll' ? 'There is nothing to click. Please bowl.' : 'Your backswing is your password. Please bowl.');
});

$('reload').addEventListener('click', () => {
  audio.click();
  if (state.busy || !lane || state.login.over) return;
  lane.reset();
  hideBanner();
  hideReport();
  setStatus('New challenge loaded. It is also bowling.', 'plain');
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
    There is no password reset. There is no password.`;
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
window.bowlid = { state, hub, lane: null, store, recorded, replaySwing, syntheticSet, bowl, identify };

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
