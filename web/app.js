import { InputHub, startMic } from "./input.js";
import { Recorder, waitForSwing } from "./features.js";
import { Lane } from "./bowling.js";
import { speak, toggleMute, stopSpeaking } from "./voice.js";
import { pickCanned } from "./canned.js";

const q = new URLSearchParams(location.search);
const FULL = q.has("full"); // include the wave stage (too long for the 60s demo)
const $ = (s) => document.querySelector(s);
const hub = new InputHub();
let canned = {};
fetch("canned.json").then((r) => r.json()).then((j) => (canned = j)).catch(() => {});

// Per-source tuning: how far tilt moves the cursor, and what counts as "too still".
const TUNE = {
  wiimote: { gain: 1.7, still: 0.02 },
  webcam: { gain: 1.3, still: 0.03 },
  mouse: { gain: 1.0, still: 0.01 },
};
const tune = () => TUNE[hub.sourceName] ?? TUNE.mouse;

// ---------------------------------------------------------------- humanity meter
let humanity = 50, humanityTarget = 50, expired = false;
function setHumanity(v) { humanityTarget = v; }
(function meterLoop(t) {
  humanity += (humanityTarget - humanity) * 0.04;
  const jitter = expired ? 0 : Math.sin(t / 310) * 0.9 + Math.sin(t / 97) * 0.4;
  const shown = Math.max(0, Math.min(100, humanity + jitter));
  $("#meter-value").textContent = expired ? "N/A" : shown.toFixed(shown > 99 ? 1 : 0) + "%";
  $("#meter-fill").style.width = shown + "%";
  $("#meter-fill").style.background = shown > 80 ? "var(--good)" : shown > 35 ? "var(--warn)" : "var(--bad)";
  requestAnimationFrame(meterLoop);
})(0);

// ---------------------------------------------------------------- UI helpers
function screen(step, title, instr, html = "") {
  $("#step").textContent = step;
  $("#title").textContent = title;
  $("#instr").textContent = instr;
  $("#area").innerHTML = html;
}
function hideVerdict() { $("#verdict").hidden = true; }
async function say(text, kind = "") {
  const v = $("#verdict");
  v.hidden = false;
  v.className = "verdict " + kind;
  v.style.animation = "none"; void v.offsetWidth; v.style.animation = "";
  $("#verdict-text").textContent = text;
  await speak(text);
}

async function getVerdict(stage, outcome, variant, features) {
  const body = { stage, outcome, variant, features, input: hub.sourceName };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch("verdict", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: ctl.signal,
    });
    clearTimeout(t);
    if (r.ok) { const j = await r.json(); $("#dbg-verdict").textContent = "verdict: " + j.source; return j.line; }
  } catch {}
  $("#dbg-verdict").textContent = "verdict: canned (local)";
  return pickCanned(canned, stage, variant || outcome, features);
}

// ---------------------------------------------------------------- run control
// Each run gets an AbortController (R resets). "→" resolves the current wait early.
let run = null;
let skipResolvers = [];
const skip = () => { const r = skipResolvers; skipResolvers = []; r.forEach((f) => f("skip")); };
function skippable(p) { return Promise.race([p, new Promise((r) => skipResolvers.push(r))]); }
function sleep(ms) {
  const signal = run.signal;
  return new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("aborted", "AbortError")); }, { once: true });
  });
}
const alive = () => { if (run.signal.aborted) throw new DOMException("aborted", "AbortError"); };

const STAGES = FULL
  ? [stageCheckbox, stageBowl, stageWave, stageStill, stageHuman, stageWelcome]
  : [stageCheckbox, stageBowl, stageStill, stageHuman, stageWelcome];
const TOTAL = STAGES.length - 1;
const stepLabel = (i) => `Challenge ${i} of ${TOTAL}`;

async function startRun() {
  run?.abort();
  run = new AbortController();
  stopSpeaking();
  hideVerdict();
  expired = false;
  setHumanity(50);
  try {
    for (let i = 0; i < STAGES.length; i++) {
      alive();
      await STAGES[i](i + 1);
      alive();
      hideVerdict();
    }
  } catch (err) {
    if (err.name !== "AbortError") { console.error(err); }
  }
}

// ---------------------------------------------------------------- stage 0: start screen
function startScreen() {
  run?.abort(); run = new AbortController();
  stopSpeaking(); hideVerdict(); expired = false; setHumanity(50);
  screen("Access restricted", "Verify you are human to vote.",
    "This button is protected by HumanCheck™ physical verification.",
    `<div class="center">
       <button class="big" id="go">Begin verification</button>
       <div class="sources">
         <button data-src="wiimote">Wii Remote</button>
         <button data-src="webcam">Webcam</button>
         <button data-src="mouse">Mouse (cowards only)</button>
       </div>
     </div>`);
  const mark = () => document.querySelectorAll("[data-src]").forEach((b) => b.classList.toggle("on", b.dataset.src === hub.sourceName));
  document.querySelectorAll("[data-src]").forEach((b) => (b.onclick = async () => { await hub.use(b.dataset.src); mark(); }));
  mark();
  $("#go").onclick = async () => {
    startMic(hub).catch((e) => console.warn("mic unavailable", e)); // needs a user gesture
    startRun();
  };
}

// ---------------------------------------------------------------- stage 1: the checkbox
async function stageCheckbox(i) {
  screen(stepLabel(i), "Confirm you're not a robot.", "Tilt to move the cursor. Click the box.",
    `<div class="arena" id="arena">
       <div class="captcha" id="captcha"><div class="box" id="box"></div><span>I'm not a robot</span><small>HumanCheck™<br/>Privacy · Terms</small></div>
       <svg class="cursor" id="cursor" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>
       <div class="dwell" id="dwell"></div>
     </div>`);
  const arena = $("#arena"), box = $("#box"), cap = $("#captcha"), cur = $("#cursor");
  // Put the box somewhere slightly annoying.
  cap.style.left = 20 + Math.random() * 45 + "%";
  cap.style.top = 25 + Math.random() * 45 + "%";

  let x = arena.clientWidth / 2, y = arena.clientHeight / 2, over = 0, clicked = false, prevA = true;
  const done = new Promise((resolve) => {
    const off = hub.on((s) => {
      const W = arena.clientWidth, H = arena.clientHeight, g = tune().gain;
      const tx = W / 2 + s.tiltX * g * W / 2, ty = H / 2 + s.tiltY * g * H / 2;
      x += (tx - x) * 0.15 + (Math.random() - 0.5) * 5; // the shake is part of the joke
      y += (ty - y) * 0.15 + (Math.random() - 0.5) * 5;
      x = Math.max(0, Math.min(W - 10, x)); y = Math.max(0, Math.min(H - 10, y));
      cur.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
      const a = arena.getBoundingClientRect(), b = box.getBoundingClientRect();
      const hot = x + a.left > b.left - 8 && x + a.left < b.right + 8 && y + a.top > b.top - 8 && y + a.top < b.bottom + 8;
      box.classList.toggle("hot", hot);
      const now = performance.now();
      over = hot ? over || now : 0;
      const held = over ? now - over : 0;
      $("#dwell").textContent = hot ? "hold it… " + "▮".repeat(Math.min(10, Math.floor(held / 120))) : "";
      if ((hot && s.a && !prevA) || held > 1200) clicked = true;
      prevA = s.a;
      if (clicked) { off(); resolve(); }
    });
    run.signal.addEventListener("abort", off, { once: true });
  });
  await skippable(done); alive();
  box.classList.remove("hot");
  box.classList.add("done");
  setHumanity(64);
  await sleep(700);
  box.classList.remove("done"); box.classList.add("spin");
  await sleep(1300);
  box.classList.remove("spin");
  setHumanity(52);
  await say("Hmm. We need to be sure.", "fail");
  await sleep(300);
}

// ---------------------------------------------------------------- stage 2: bowl a strike
async function stageBowl(i) {
  screen(stepLabel(i), "Bowl a strike.", "Swing the remote like you mean it.",
    `<div class="lane-wrap">
       <canvas class="lane" id="lane"></canvas>
       <div class="stats" id="stats">
         <div><b>status</b><span id="st-status">awaiting swing…</span></div>
         <div><b>live force</b><span id="st-live">1.00 g</span></div>
       </div>
     </div>`);
  const lane = new Lane($("#lane"));
  const offLive = hub.on((s) => { const el = $("#st-live"); if (el) el.textContent = s.mag.toFixed(2) + " g"; });
  const rec = new Recorder(hub).start();
  await skippable(waitForSwing(hub, { signal: run.signal })); alive();
  const f = rec.stop();
  offLive();
  $("#st-status").textContent = "rolling…";
  const verdictP = getVerdict("bowl", "fail", "fail", f); // fetch while the ball rolls
  await lane.roll({ speed: f.peakForce, curve: hub.latest.tiltX * 0.6, knocked: 9 }); alive();
  $("#stats").innerHTML = `
    <div class="pins-big">9 / 10</div>
    <div><b>peak force</b>${f.peakForce} g</div>
    <div><b>swing time</b>${f.duration} ms</div>
    <div><b>hesitation</b>${f.hesitation} ms</div>
    <div><b>verdict</b><span style="color:var(--bad)">NOT A STRIKE</span></div>`;
  setHumanity(43);
  await say(await verdictP, "fail");
  await sleep(500);
}

// ---------------------------------------------------------------- stage: wave (full mode only)
async function stageWave(i) {
  screen(stepLabel(i), "Wave hello. Sincerely.", "We are measuring sincerity.",
    `<div class="center"><div class="wave-emoji">👋</div><div class="timer"><div id="tm"></div></div></div>`);
  const moved = new Promise((r) => { const off = hub.on((s) => { if (s.mag > 1.35) { off(); r(); } }); });
  const rec = new Recorder(hub).start();
  await skippable(moved); alive();
  await timer(2500);
  const f = rec.stop();
  setHumanity(27);
  await say(await getVerdict("wave", "fail", "fail", f), "fail");
  await sleep(400);
}

// ---------------------------------------------------------------- stage 3: hold perfectly still
async function stageStill(i) {
  screen(stepLabel(i), "Hold perfectly still.", "Do not move. At all.",
    `<div class="center"><div class="count" id="count">3</div>
       <div class="livebar" style="margin-top:24px"><div class="row">tremor<div class="bar"><div id="trem"></div></div></div></div></div>`);
  for (const n of [3, 2, 1]) { $("#count").textContent = n; await sleep(700); }
  $("#count").textContent = "HOLD";
  const rec = new Recorder(hub).start();
  const offLive = hub.on((s) => { const el = $("#trem"); if (el) el.style.width = Math.min(100, Math.abs(s.mag - 1) * 400) + "%"; });
  await skippable(sleep(3000)); alive();
  offLive();
  const f = rec.stop();
  const variant = f.tremor < tune().still ? "too_still" : "trembling";
  $("#count").textContent = variant === "too_still" ? "TOO STILL" : "SHAKING";
  setHumanity(variant === "too_still" ? 9 : 14);
  await say(await getVerdict("still", "fail", variant, f), "fail");
  await sleep(400);
}

// ---------------------------------------------------------------- stage 4: do something only a human would do
async function stageHuman(i) {
  screen(stepLabel(i), "Do something only a human would do.", "",
    `<div class="livebar">
       <div class="row">movement<div class="bar"><div id="lv-m"></div></div></div>
       <div class="row">noise<div class="bar"><div id="lv-a"></div></div></div>
       <div class="row">dignity<div class="bar"><div id="lv-d" style="width:100%;background:var(--good)"></div></div></div>
       <div class="timer"><div id="tm"></div></div>
     </div>`);
  let dignity = 100;
  const rec = new Recorder(hub).start();
  const off = hub.on((s) => {
    const m = $("#lv-m"), a = $("#lv-a"), d = $("#lv-d");
    if (!m) return;
    m.style.width = Math.min(100, (s.mag - 1) * 40) + "%";
    a.style.width = Math.min(100, hub.mic * 100) + "%";
    dignity = Math.max(0, dignity - Math.max(0, s.mag - 1.2) * 0.4 - hub.mic * 0.5);
    d.style.width = dignity + "%";
  });
  await skippable(timer(5000)); alive();
  off();
  const f = rec.stop();
  setHumanity(99.7);
  await say(await getVerdict("human", "pass", "pass", f), "pass");
  await sleep(400);
}

// ---------------------------------------------------------------- finale
async function stageWelcome() {
  screen("Verified", "Welcome, fellow human.", "You may now access the protected resource.",
    `<div class="center"><button class="big vote" id="vote">Vote for our project</button></div>`);
  let prevA = true;
  const clicked = new Promise((r) => {
    $("#vote").onclick = r;
    const off = hub.on((s) => { if (s.a && !prevA) { off(); r(); } prevA = s.a; });
  });
  await skippable(clicked); alive();
  expired = true;
  setHumanity(0);
  screen("Error 419", "Your session has expired.", "Please verify you are human.",
    `<div class="center"><button class="big" id="again">Verify again</button></div>`);
  $("#again").onclick = () => startRun();
  await say("Welcome! Your session has expired.", "fail");
}

function timer(ms) {
  return new Promise((res) => {
    const el = $("#tm"), t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      if (el) el.style.width = k * 100 + "%";
      if (k < 1 && !run.signal.aborted) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------- presenter hotkeys + debug
addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") skip();
  else if (e.key === "r" || e.key === "R") startScreen();
  else if (e.key === "m" || e.key === "M") toggleMute();
  else if (e.key === "1") hub.use("wiimote");
  else if (e.key === "2") hub.use("webcam");
  else if (e.key === "3") hub.use("mouse");
  else if (e.key === "d" || e.key === "D") $("#debug").hidden = !$("#debug").hidden;
});
hub.onStatus = (src, st) => { $("#dbg-src").textContent = `${src}: ${st}`; };
hub.on((s) => {
  if ($("#debug").hidden) return;
  $("#dbg-live").textContent = `mag ${s.mag.toFixed(2)} tilt ${s.tiltX.toFixed(2)},${s.tiltY.toFixed(2)} A ${s.a ? 1 : 0} mic ${hub.mic.toFixed(2)}`;
});
if (q.has("debug")) { $("#debug").hidden = false; window.hub = hub; } // window.hub lets you inject test samples

await hub.use(q.get("input") || "mouse");
startScreen();
