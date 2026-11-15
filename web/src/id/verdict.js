// The verdict screen: one huge score, a mark, the swing drawn against the swings on file, and
// the pins kept to one side. It also draws the last two log-ins to one account side by side.
// Everything here is drawn from a card that afterLogin() saved. Nothing is worked out again.
import { MATCH_CONFIG } from '../motion/matcher.js';
import { forceAt } from '../motion/trace.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MARKS = {
  granted: '<path d="M27 52 L43 68 L74 33"/>',
  denied: '<path d="M32 32 L68 68 M68 32 L32 68"/>',
  unsure: '<path d="M36 39 C36 30 42 24 50 24 C58 24 64 30 64 38 C64 45 60 48 55 52 C51 55 50 58 50 63"/><path d="M50 77 L50 77.500"/>',
};

export const WORD = { granted: 'Access granted', denied: 'Access denied', unsure: 'Bowl again' };

const mark = (outcome) => `<svg class="v-mark" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/>${MARKS[outcome]}</svg>`;

// The one short line under a verdict, when there is something true to add.
export function alsoLine(c) {
  if (c.outcome === 'granted') return c.crisis && c.like ? `Also opens ${c.like.username}'s account` : '';
  if (c.outcome === 'unsure') return `Too close to call · bowl ${c.bowl} of ${MATCH_CONFIG.maxLoginBowls}`;
  if (c.like) return `Bowls like ${c.like.username} · ${c.like.score}/100`;
  if (c.verdict === 'retry') return `${c.bowl} bowls, none close enough`;
  return '';
}

// A pointer or a formula is not a person's arm, and the screen says so.
const simLine = (src) => (src === 'pointer' ? 'Simulated swing · pointer' : src === 'synthetic' ? 'Simulated · formula swing' : '');

const RACK_ROWS = [[6, 7, 8, 9], [3, 4, 5], [1, 2], [0]];

// The pins, kept apart from the identity score and marked as not counting.
function pinsHTML(c) {
  const down = c.down || [];
  const rack = RACK_ROWS.map((row) => `<div>${row.map((i) => `<i class="${down[i] ? 'down' : ''}"></i>`).join('')}</div>`).join('');
  return `
    <div class="v-pins">
      <div class="v-rack" aria-hidden="true">${rack}</div>
      <div class="v-pincount"><span>Pins knocked down</span><b>${c.pins.pins}<i> / 10</i></b></div>
      <em>doesn't count</em>
    </div>`;
}

function graphHTML(c, hasSaved) {
  if (!hasSaved || !c.force) return '';
  return `
    <div class="v-graph"><canvas data-swing></canvas></div>
    <div class="v-key">
      <span><i class="dash"></i>${esc(c.username)}'s saved swing</span>
      <span><i class="solid"></i>this swing</span>
    </div>`;
}

const meter = (score) => `
  <div class="v-meter" aria-hidden="true">
    <i data-fill style="width:${score}%"></i>
    <u style="left:${MATCH_CONFIG.scoreMatch}%"><s>${MATCH_CONFIG.scoreMatch}</s></u>
  </div>`;

// One result, as large as the window allows.
export function heroHTML(c, hasSaved) {
  const also = alsoLine(c);
  const sim = simLine(c.src);
  return `
    <section class="v-hero">
      <p class="v-label">Bowlometric Identity Score</p>
      <div class="v-top">
        ${mark(c.outcome)}
        <div class="v-score"><b data-score style="min-width:${String(c.score).length}ch">${c.score}</b><i>/100</i></div>
      </div>
      ${meter(c.score)}
      <h2 class="v-word">${WORD[c.outcome]}</h2>
      <p class="v-also">${esc(also) || '&nbsp;'}</p>
      ${graphHTML(c, hasSaved)}
      ${pinsHTML(c)}
      ${sim ? `<p class="v-sim">${sim}</p>` : ''}
    </section>`;
}

// The last two log-ins to one account, side by side.
export function pairHTML(cards, hasSaved, punchline) {
  const titles = ['First swing', 'Second swing'];
  const body = cards.map((c, i) => {
    const also = alsoLine(c);
    const sim = simLine(c.src);
    return `
      <article class="v-card ${c.outcome}" style="--i:${i}">
        <header>${titles[i]}</header>
        <div class="v-top">
          ${mark(c.outcome)}
          <div class="v-score"><b>${c.score}</b><i>/100</i></div>
        </div>
        ${graphHTML(c, hasSaved)}
        <h2 class="v-word">${WORD[c.outcome]}</h2>
        ${also ? `<p class="v-also">${esc(also)}</p>` : ''}
        ${pinsHTML(c)}
        ${sim ? `<p class="v-sim">${sim}</p>` : ''}
      </article>`;
  }).join('');
  return `
    <section class="v-pair">
      <p class="v-label">One account, <b>${esc(cards[0].username)}</b> · two swings</p>
      <div class="v-cards">${body}</div>
      ${punchline ? `<p class="v-punch">${esc(punchline)}</p>` : ''}
    </section>`;
}

// `buttons` is a list of { act, label, key, primary }. `key` is the button on the Wii Remote.
export function actionsHTML(buttons) {
  return buttons.map((b) => `
    <button type="button" class="v-btn${b.primary ? ' solid' : ''}" data-act="${b.act}"${b.primary ? ' data-primary' : ''}>
      ${b.key ? `<kbd>${b.key}</kbd>` : ''}${esc(b.label)}
    </button>`).join('');
}

/* Drawing a swing against the swings on file */

// A smooth line through every point. The points themselves are not moved.
function trace(g, pts) {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    g.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1],
    );
  }
}

// `saved` is { mean, lo, hi } from the swings on file and `force` is this swing. The saved swing
// is the dashed line, with the reach of the saved swings as a soft band behind it. This swing
// is the solid line, drawn as far as `k` (0 to 1) with a dot at its tip while it is still moving.
export function drawSwing(canvas, { saved, force, range, k = 1, colors }) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const line = Math.max(3, Math.min(9, h * 0.04));
  const pad = line * 1.6;
  const n = force.length;
  const X = (i) => pad + (i / (n - 1)) * (w - pad * 2);
  const Y = (v) => h - pad - ((v - range.lo) / (range.hi - range.lo)) * (h - pad * 2);
  const pts = (curve) => curve.map((v, i) => [X(i), Y(v)]);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  g.beginPath();
  trace(g, pts(saved.hi));
  const low = pts(saved.lo).reverse();
  g.lineTo(low[0][0], low[0][1]);
  for (const p of low) g.lineTo(p[0], p[1]);
  g.closePath();
  g.fillStyle = colors.band;
  g.fill();

  g.beginPath();
  trace(g, pts(saved.mean));
  g.strokeStyle = colors.saved;
  g.lineWidth = line * 0.8;
  g.setLineDash([line * 0.2, line * 2.1]);
  g.stroke();
  g.setLineDash([]);

  if (k <= 0) return;
  const tip = pad + Math.min(1, k) * (w - pad * 2);
  g.save();
  g.beginPath();
  g.rect(0, 0, k >= 1 ? w : tip, h);
  g.clip();
  g.beginPath();
  trace(g, pts(force));
  g.strokeStyle = colors.line;
  g.lineWidth = line;
  g.stroke();
  g.restore();
  if (k < 1) {
    g.beginPath();
    g.arc(tip, Y(forceAt(force, k)), line * 1.3, 0, Math.PI * 2);
    g.fillStyle = colors.line;
    g.fill();
  }
}
