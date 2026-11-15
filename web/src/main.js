// The bank. One page, a few screens, and a lane on the right.
import { Lane } from './game/lane3d.js';
import { throwFromSwing } from './game/throw.js';
import { SwingRecorder } from './motion/recorder.js';
import { makeSignature, checkQuality } from './motion/signal.js';
import { MATCH_CONFIG, buildProfile, verify, alsoMatches } from './motion/matcher.js';
import { syntheticSet } from './motion/synthetic.js';
import { WiiSource, MouseSource, replaySwing } from './input/sources.js';
import { store } from './bank/store.js';
import { verdictLine, pinsLabel, QUALITY, STATEMENT, money } from './bank/copy.js';
import { track } from './analytics.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const BRIDGE_URL = `ws://127.0.0.1:${params.get('bridge') || 8765}`;

const desk = $('desk');
const laneEl = $('lane');
const lane = new Lane(laneEl);

const state = {
  screen: 'home',
  mode: 'demo',
  status: { connected: true, sensors: {}, message: '' },
  account: null,
  enroll: null,
  attempt: 0,
  last: null,
  busy: false,
  aim: 0,
  pressAim: 0,
  flash: '',
};

// Every swing recorded in this session, kept in memory for the export link.
const recorded = [];

/* Drawing */

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
  // The release point sits three quarters of the way along every signature.
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(w * 0.75, 0);
  g.lineTo(w * 0.75, h);
  g.stroke();
  g.setLineDash([]);
  for (const s of sets) {
    g.strokeStyle = s.color;
    g.lineWidth = s.width || 1.5;
    g.beginPath();
    s.seq.forEach((r, i) => {
      const x = (i / (s.seq.length - 1)) * w;
      const y = h - 3 - (Math.hypot(r[0], r[1], r[2]) / top) * (h - 6);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke();
  }
}

const trace = {
  rows: [],
  add(rows) {
    for (const r of rows) this.rows.push([r[0], Math.hypot(r[1], r[2], r[3])]);
    const cut = this.rows.length ? this.rows[this.rows.length - 1][0] - 2500 : 0;
    while (this.rows.length && this.rows[0][0] < cut) this.rows.shift();
  },
  draw() {
    const c = $('trace');
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (this.rows.length < 2) return;
    const end = this.rows[this.rows.length - 1][0];
    g.strokeStyle = recorder.state === 'idle' ? '#9db8aa' : '#e7c98a';
    g.lineWidth = 2;
    g.beginPath();
    this.rows.forEach(([t, m], i) => {
      const x = c.width - ((end - t) / 2500) * c.width;
      const y = c.height - 4 - Math.min(1, m / 5) * (c.height - 8);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke();
  },
};
(function loop() { trace.draw(); requestAnimationFrame(loop); })();

/* Input */

const recorder = new SwingRecorder({ onSwing, onState: () => hint() });
let source = null;

const canBowl = () =>
  !state.busy && ['home', 'enroll', 'verify'].includes(state.screen) && (state.mode === 'demo' || state.status.connected);

// The hub is what every source and every replay talks to.
const hub = {
  emit(name, ...args) {
    if (name === 'samples') { recorder.push(args[0]); trace.add(args[0]); }
    else if (name === 'aim') { state.aim = args[0]; if (!state.busy) lane.setAim(args[0]); }
    else if (name === 'press') { if (canBowl()) { state.pressAim = state.aim; hideStamp(); recorder.press(args[0]); } }
    else if (name === 'release') recorder.release(args[0]);
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
  // The A button on the remote presses the main button on screen.
  source.on('button', (name, down) => {
    if (name === 'A' && down) desk.querySelector('[data-primary]')?.click();
  });
  state.status = mode === 'wii'
    ? { connected: false, bridge: false, sensors: {}, message: 'Looking for the Wii remote bridge.' }
    : { connected: true, sensors: {}, message: '' };
  source.start();
  chrome();
}

// Mode button, blocker and hint: the parts outside the desk.
function chrome() {
  const b = $('mode');
  const s = state.status;
  if (state.mode === 'wii') {
    b.textContent = s.connected ? 'Wii remote connected' : 'Wii remote not connected';
    b.className = `mode ${s.connected ? 'ok' : 'bad'}`;
  } else {
    b.textContent = 'Demo mode (pointer)';
    b.className = 'mode';
  }
  const blocker = $('blocker');
  const blocked = state.mode === 'wii' && !s.connected;
  blocker.hidden = !blocked;
  if (blocked) {
    blocker.innerHTML = s.bridge
      ? `<h2>The Wii remote is not connected</h2>
         <p>${esc(s.message || 'Press any button on the remote to wake it.')}</p>
         <p>If it stays off, run <code>./scripts/pair-wiimote.sh</code> and press the red SYNC button.</p>
         <button class="btn plain" data-act="demo" style="color:#f4efe4;border-color:#f4efe4">Use demo mode instead</button>`
      : `<h2>The Wii remote bridge is not running</h2>
         <p>On the demo laptop, run <code>./scripts/start.sh</code>. This page reconnects by itself.</p>
         <button class="btn plain" data-act="demo" style="color:#f4efe4;border-color:#f4efe4">Use demo mode instead</button>`;
  }
  hint();
}

function hint() {
  const el = $('hint');
  if (state.flash) { el.innerHTML = `<b>${esc(state.flash)}</b>`; return; }
  if (recorder.state === 'swing') { el.innerHTML = '<b>Reading your swing.</b> Release to let go of the ball.'; return; }
  if (state.mode === 'wii') {
    const ir = source.irActive && source.irActive();
    el.innerHTML = `${ir ? 'Point at the lane to aim.' : 'Aim with the D-pad.'} <b>Hold B</b>, swing, <b>release B</b>. Wear the wrist strap.`;
  } else {
    el.innerHTML = 'Move to aim. <b>Press</b> on the lane, pull back, flick forward, <b>release</b>.';
  }
}

function flash(text) {
  state.flash = text;
  hint();
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { state.flash = ''; hint(); }, 3200);
}

function showStamp(verdict, text, sub) {
  const el = $('stamp');
  el.className = `stamp ${verdict}`;
  el.innerHTML = `${esc(text)}<small>${esc(sub)}</small>`;
  el.hidden = false;
}
function hideStamp() { $('stamp').hidden = true; }

/* Throws */

async function onSwing(swing) {
  if (state.busy) return;
  const q = checkQuality(swing);
  if (!q.ok) { flash(QUALITY[q.reason]); return; }
  state.busy = true;
  const aim = state.pressAim;
  const src = state.replaying ? 'synthetic' : state.mode === 'wii' ? 'wii' : 'mouse';
  state.replaying = false;
  state.lastSource = src;
  const pins = await lane.play(throwFromSwing(swing, aim));
  const sig = makeSignature(swing);
  recorded.push({
    version: 1,
    label: state.screen,
    source: src,
    participant: state.screen === 'enroll' ? state.enroll.name : state.account ? state.account.name : 'practice',
    samples: swing.samples,
    pressT: swing.pressT,
    releaseT: swing.releaseT,
    aim,
    pins: pins.pins,
  });
  $('export').hidden = false;
  if (state.screen === 'enroll') afterEnroll(sig, pins);
  else if (state.screen === 'verify') afterVerify(sig, pins);
  else flash(`${pinsLabel(pins)}. Nice. It proves nothing about who you are.`);
  setTimeout(() => { lane.reset(); lane.setAim(state.aim); state.busy = false; }, 1500);
}

function afterEnroll(sig, pins) {
  const e = state.enroll;
  e.throws.push({ sig, pins, bad: false });
  const good = e.throws.filter((t) => !t.bad);
  e.message = '';
  if (good.length >= MATCH_CONFIG.enrollThrows) {
    const profile = buildProfile(good.map((t) => t.sig));
    const outOfTries = e.throws.length >= MATCH_CONFIG.maxEnrollThrows;
    if (profile.consistent || outOfTries) {
      const account = store.open(e.name, profile, state.mode === 'wii' ? 'wii' : 'mouse');
      track('account_opened', { source: account.source, enroll_throws: e.throws.length, spread: profile.spread, consistent: profile.consistent });
      state.account = account;
      state.screen = 'account';
      state.welcome = profile.consistent
        ? 'Your account is open. Your swing is now the only way in.'
        : 'Your account is open. Your form is erratic, so we filed all of it.';
      render();
      return;
    }
    if (profile.outlier >= 0) {
      good[profile.outlier].bad = true;
      e.message = 'One of those throws did not look like the others, so we struck it out. Bowl once more.';
    } else {
      e.message = 'Your throws disagree with each other. Bowl once more, the way you usually do.';
    }
  }
  render();
}

function afterVerify(sig, pins) {
  const account = state.account;
  state.attempt++;
  const v = verify(account.profile, sig);
  // A swing that also fits another customer is an identity crisis. We ask again.
  const others = store.accounts().filter((a) => a.id !== account.id && a.source === account.source).map((a) => a.profile);
  const crisis = v.verdict === 'match' && alsoMatches(sig, others) > 0;
  const verdict = crisis ? 'retry' : v.verdict;
  if (crisis) store.crisis();
  store.record(account, verdict, pins);
  track('signin_attempt', {
    bowlometric_identity_score: v.score,
    verdict,
    pins: pins.pins,
    strike: pins.strike,
    gutter: pins.gutter,
    attempt: state.attempt,
    source: state.lastSource,
    sample_account: account.sample,
    identity_crisis: crisis,
  });
  state.last = { sig, pins, score: v.score, verdict, crisis, line: verdictLine(verdict, pins, crisis) };
  const words = { match: 'Approved', mismatch: 'Declined', retry: 'Bowl again' }[verdict];
  showStamp(verdict, words, `${pinsLabel(pins)} · score ${v.score}`);
  render();
}

/* Screens */

function ledgerLine() {
  const l = store.ledger();
  const per = l.approvals ? (l.attempts / l.approvals).toFixed(1) : 'n/a';
  $('ledger').textContent =
    `Branch ledger. Strikes declined: ${l.strikesDenied}. Gutter balls approved: ${l.guttersApproved}. Bowls per sign-in: ${per}. Identity crises: ${l.crises}.`;
}

function home() {
  const rows = store.accounts().map((a) => `
    <li>
      <div class="who"><b>${esc(a.name)}</b><span>${esc(a.number)}</span>
        ${a.sample ? '<div class="tag">Sample customer, synthetic swing</div>' : ''}</div>
      <button class="btn plain" data-act="signin" data-id="${esc(a.id)}">Sign in</button>
    </li>`).join('');
  return `
    <h1>Passwords are over. Please bowl.</h1>
    <p class="lede">BowlBank protects your savings with the one thing a thief cannot guess: your backswing. To sign in, bowl. How many pins you hit is your own business.</p>
    <div class="row"><button class="btn" data-act="open" data-primary>Open an account</button></div>
    <h3>Customers at this branch</h3>
    <ul class="customers">${rows}</ul>
    <p class="note" style="margin-top:14px">The lane is open. Bowl a practice ball any time.</p>`;
}

function open() {
  return `
    <h2>Open an account</h2>
    <p>No password, no security questions, no mother's maiden name. We will ask you to bowl ${MATCH_CONFIG.enrollThrows} times and keep your form on file.</p>
    <form data-form="open">
      <label for="name">Name on the account (make one up)</label>
      <input id="name" type="text" maxlength="40" autocomplete="off" placeholder="Pat Lanesworth" />
      <div class="row">
        <button class="btn" type="submit" data-primary>Begin enrollment</button>
        <button class="btn plain" type="button" data-act="home">Cancel</button>
      </div>
    </form>
    <p class="note" style="margin-top:18px">This is not a real bank. Use a fake name.</p>`;
}

function enroll() {
  const e = state.enroll;
  const good = e.throws.filter((t) => !t.bad).length;
  const need = Math.max(MATCH_CONFIG.enrollThrows, e.throws.length + (good < MATCH_CONFIG.enrollThrows ? MATCH_CONFIG.enrollThrows - good : 0));
  let slots = '';
  for (let i = 0; i < need; i++) {
    const t = e.throws[i];
    slots += t
      ? `<div class="slot ${t.bad ? 'bad' : ''}"><span class="n">${i + 1}</span><canvas data-seq="${i}"></canvas><span>${esc(pinsLabel(t.pins))}</span></div>`
      : `<div class="slot empty"><span class="n">${i + 1}</span><span>${i === e.throws.length ? 'Bowl now' : 'Waiting'}</span><span></span></div>`;
  }
  return `
    <h2>Enrolling ${esc(e.name)}</h2>
    <p>Bowl the way you always bowl. We are reading the swing. The pins are for your own enjoyment.</p>
    <div class="slots">${slots}</div>
    ${e.message ? `<p class="results"><span class="mid">${esc(e.message)}</span></p>` : ''}
    <div class="row"><button class="btn plain" data-act="home">Cancel</button></div>`;
}

function verifyScreen() {
  const a = state.account;
  const r = state.last;
  const head = `<h2>Signing in as ${esc(a.name)}</h2>`;
  const replay = a.sample
    ? `<p class="note">This is a sample customer with a synthetic swing. <button class="btn link" data-act="replay">Replay ${esc(a.name.split(' ')[0])}'s own recorded swing</button></p>`
    : '';
  const mixed = a.source !== 'synthetic' && a.source !== (state.mode === 'wii' ? 'wii' : 'mouse')
    ? `<p class="note">This account was opened with ${a.source === 'wii' ? 'a Wii remote' : 'a pointer'}. Signing in the other way will not go well.</p>` : '';
  if (!r) {
    return `${head}
      <p class="lede">Bowl once to prove you are you.</p>
      <p>We compare your swing with the form on file. A strike will not help you.</p>
      ${replay}${mixed}
      <div class="row"><button class="btn plain" data-act="home">Back to customers</button></div>`;
  }
  const cls = { match: 'good', mismatch: 'bad', retry: 'mid' }[r.verdict];
  const idWord = { match: 'Approved', mismatch: 'Declined', retry: r.crisis ? 'Identity crisis' : 'Unclear, bowl again' }[r.verdict];
  const pinCls = r.pins.strike ? 'good' : r.pins.gutter ? 'bad' : '';
  return `${head}
    <div class="score">${r.score}<small>Bowlometric Identity Score, out of 100</small></div>
    <div class="meter">
      <div class="track"></div><div class="zone retry"></div><div class="zone match"></div>
      <div class="mark" style="left:${r.score}%"></div>
      <div class="ticks"><span style="left:50%">50</span><span style="left:70%">70</span></div>
    </div>
    <table class="results">
      <tr><th>Bowling result</th><td class="${pinCls}">${esc(pinsLabel(r.pins))}</td></tr>
      <tr><th>Identity result</th><td class="${cls}">${esc(idWord)}</td></tr>
      <tr><th>Bowls this sign-in</th><td>${state.attempt}</td></tr>
    </table>
    <p class="lede">${esc(r.line)}</p>
    <canvas class="overlay" data-overlay></canvas>
    <div class="key"><span><i style="background:#b8893b"></i>Form on file</span><span><i style="background:${r.verdict === 'match' ? '#1f6e45' : '#a3271f'}"></i>This swing</span></div>
    ${replay}
    <div class="row">
      ${r.verdict === 'match'
        ? '<button class="btn" data-act="enter" data-primary>Enter account</button>'
        : '<span class="note">Bowl again whenever you are ready.</span>'}
      <button class="btn plain" data-act="home">Back to customers</button>
    </div>`;
}

function account() {
  const a = state.account;
  const rows = STATEMENT.map(([what, v]) => `<tr><td>${esc(what)}</td><td class="${v < 0 ? 'neg' : ''}">${money(v)}</td></tr>`).join('');
  return `
    <h3 style="margin-top:0">${esc(a.name)} · ${esc(a.number)}</h3>
    <div class="balance">${money(a.balance)}</div>
    <p class="note">Available balance. Not real. Not withdrawable. Not even with a strike.</p>
    ${state.welcome ? `<p class="lede">${esc(state.welcome)}</p>` : ''}
    <h3>Recent activity</h3>
    <table class="statement">${rows}</table>
    <h3>Your form on file</h3>
    <canvas class="overlay" data-profile></canvas>
    <p class="note">${a.profile.templates.length} swings on file. Signed in ${a.logins} time${a.logins === 1 ? '' : 's'}, declined ${a.denials}.</p>
    <div class="row">
      <button class="btn" data-act="home" data-primary>Sign out</button>
      ${a.sample ? '' : '<button class="btn plain" data-act="close">Close account</button>'}
    </div>`;
}

function render() {
  desk.innerHTML = { home, open, enroll, verify: verifyScreen, account }[state.screen]();
  ledgerLine();
  desk.querySelectorAll('[data-seq]').forEach((c) => {
    const t = state.enroll.throws[Number(c.dataset.seq)];
    drawSeqs(c, [{ seq: t.sig.seq, color: t.bad ? '#a3271f' : '#0f3d2e' }]);
  });
  const templates = state.account ? state.account.profile.templates.map((t) => ({ seq: t.seq, color: '#b8893b', width: 1.2 })) : [];
  const overlay = desk.querySelector('[data-overlay]');
  if (overlay) drawSeqs(overlay, [...templates, { seq: state.last.sig.seq, color: state.last.verdict === 'match' ? '#1f6e45' : '#a3271f', width: 2.2 }]);
  const prof = desk.querySelector('[data-profile]');
  if (prof) drawSeqs(prof, templates);
  if (state.screen === 'open') $('name').focus();
  hint();
}

function go(screen) {
  state.screen = screen;
  if (screen === 'home') { state.account = null; state.enroll = null; state.last = null; hideStamp(); }
  if (screen !== 'account') state.welcome = '';
  render();
}

const actions = {
  open: () => go('open'),
  home: () => go('home'),
  demo: () => setMode('demo'),
  signin: (el) => {
    state.account = store.get(el.dataset.id);
    state.attempt = 0;
    state.last = null;
    go('verify');
  },
  enter: () => { hideStamp(); go('account'); },
  close: () => { store.close(state.account.id); go('home'); },
  replay: () => {
    if (!canBowl()) return;
    // A fresh synthetic swing from the same sample customer. It was not used to build the profile.
    const [swing] = syntheticSet(state.account.sampleKey, 1, 1000 + Math.floor(Math.random() * 100000));
    flash('Replaying a synthetic sample swing.');
    recorder.cancel();
    state.replaying = true;
    replaySwing(swing, hub);
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  ev.preventDefault();
  actions[el.dataset.act]?.(el);
});

desk.addEventListener('submit', (ev) => {
  ev.preventDefault();
  state.enroll = { name: $('name').value.trim() || 'Valued Customer', throws: [], message: '' };
  go('enroll');
});

$('mode').addEventListener('click', () => setMode(state.mode === 'wii' ? 'demo' : 'wii'));

$('export').addEventListener('click', (ev) => {
  ev.preventDefault();
  const blob = new Blob([JSON.stringify(recorded)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bowlbank-swings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/* Start */

function boot() {
  const want = params.get('mode');
  if (want === 'wii') { setMode('wii'); return; }
  setMode('demo');
  if (want === 'demo') return;
  // On the demo laptop the bridge is running. If it answers with a live remote, use it.
  try {
    const probe = new WebSocket(BRIDGE_URL);
    const stop = setTimeout(() => probe.close(), 1500);
    probe.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type !== 'status') return;
      clearTimeout(stop);
      probe.close();
      if (msg.connected && msg.source !== 'replay') setMode('wii');
    };
    probe.onerror = () => {};
  } catch { /* No bridge here. Demo mode stays. */ }
}

render();
boot();

// For the diagnostics page and for automated checks.
window.bowlbank = { state, store, hub, lane, recorded, replaySwing, syntheticSet };
