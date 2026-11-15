// Builds a customer's swing profile and checks a new swing against it.
import { distance } from './signal.js';

export const MATCH_CONFIG = {
  enrollThrows: 3,
  // Registration takes exactly this many throws. Raise it to let an odd throw be struck out and replaced.
  maxEnrollThrows: 3,
  // How many times a new customer who bowls like an existing one is asked to enroll again. 0 means never.
  twinRedos: 0,
  // The accept distance is the customer's own spread times this factor.
  acceptFactor: 1.7,
  // Limits on the accept distance, so a very tidy or very sloppy enrollment still gives a usable profile.
  acceptFloor: 0.3,
  acceptCeil: 1.4,
  // An enrollment throw this many times further from the rest than the median is dropped.
  // With only three throws the two closest are always close, so a low factor here strikes out
  // honest throws and makes enrollment drag on.
  outlierFactor: 2.5,
  // Score bands. 70 and up is a match, 50 to 69 asks for another bowl.
  scoreMatch: 70,
  scoreRetry: 50,
  // Identification. A second customer counts as a rival when they are within this factor
  // of the best customer's distance.
  rivalMargin: 1.35,
  // Inconclusive bowls allowed in one log-in before the answer is "unknown".
  maxLoginBowls: 3,
};

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

// Mean of the two closest templates. One odd enrollment throw cannot sink a genuine customer.
export function distanceToTemplates(sig, templates) {
  const d = templates.map((t) => distance(sig, t)).sort((x, y) => x - y);
  return mean(d.slice(0, Math.min(2, d.length)));
}

export function buildProfile(signatures, cfg = MATCH_CONFIG) {
  const others = (i) => signatures.filter((_, j) => j !== i);
  // Distance from each throw to its closest neighbour. A throw far from all the rest is an outlier.
  const near = signatures.map((s, i) => Math.min(...others(i).map((t) => distance(s, t))));
  const sorted = near.slice().sort((x, y) => x - y);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  let outlier = -1;
  let worst = 0;
  near.forEach((d, i) => {
    if (d > worst) { worst = d; outlier = i; }
  });
  const hasOutlier = signatures.length >= 3 && worst > median * cfg.outlierFactor && worst > cfg.acceptFloor * 1.5;
  const kept = hasOutlier ? signatures.filter((_, i) => i !== outlier) : signatures;
  const spread = mean(kept.map((s, i) => distanceToTemplates(s, kept.filter((_, j) => j !== i))));
  const accept = Math.min(cfg.acceptCeil, Math.max(cfg.acceptFloor, spread * cfg.acceptFactor));
  return {
    templates: signatures,
    spread: Math.round(spread * 1000) / 1000,
    accept: Math.round(accept * 1000) / 1000,
    // Too loose means the throws disagree so much that the profile would accept almost anyone.
    consistent: !hasOutlier && spread * cfg.acceptFactor <= cfg.acceptCeil,
    outlier: hasOutlier ? outlier : -1,
    gyro: signatures.every((s) => s.gyro),
  };
}

// 100 at distance zero, 70 at the accept distance, 50 at about 1.33 times it.
export function scoreFromDistance(d, accept) {
  const r = d / accept;
  return Math.max(0, Math.min(100, Math.round(100 / (1 + (3 / 7) * r ** 3))));
}

export function verify(profile, sig, cfg = MATCH_CONFIG) {
  const d = distanceToTemplates(sig, profile.templates);
  const score = scoreFromDistance(d, profile.accept);
  let verdict = 'mismatch';
  if (score >= cfg.scoreMatch) verdict = 'match';
  else if (score >= cfg.scoreRetry) verdict = 'retry';
  return { distance: Math.round(d * 1000) / 1000, score, verdict };
}

// Other customers whose profile this swing would also pass. Used to flag an identity crisis.
export function alsoMatches(sig, otherProfiles, cfg = MATCH_CONFIG) {
  return otherProfiles.filter((p) => verify(p, sig, cfg).verdict === 'match').length;
}

/* Identification: one swing against every enrolled customer, with nobody named beforehand. */

// `accounts` is a list of { id, profile }. The result is one of four outcomes:
//   recognized: one customer fits, and no other customer is close.
//   ambiguous:  the swing fits one customer, and a second one nearly as well.
//   unsure:     the best customer is close but not close enough. Worth another bowl.
//   unknown:    nobody on file fits.
// The nearest customer is never returned as a match just because they are nearest.
export function identify(sig, accounts, cfg = MATCH_CONFIG) {
  const ranked = accounts
    .map((account) => {
      const v = verify(account.profile, sig, cfg);
      return { account, ...v, ratio: v.distance / account.profile.accept };
    })
    .sort((a, b) => a.ratio - b.ratio);
  const best = ranked[0];
  if (!best) return { outcome: 'unknown', best: null, rival: null, ranked };
  if (best.verdict === 'mismatch') return { outcome: 'unknown', best, rival: null, ranked };
  if (best.verdict === 'retry') return { outcome: 'unsure', best, rival: null, ranked };
  // A rival is nearly as close as the best customer, by either measure: against their own
  // accept distance, or in plain distance. Somebody far away by their own standard is no rival.
  const near = (c) => c.ratio < best.ratio * cfg.rivalMargin || c.distance < best.distance * cfg.rivalMargin;
  const rival = ranked.slice(1).find((c) => c.verdict !== 'mismatch' && near(c)) || null;
  return { outcome: rival ? 'ambiguous' : 'recognized', best, rival, ranked };
}

/* A claim: a username was typed, and one swing is checked against that one account. */

// `account` and `others` are { id, profile } rows. `others` are the rest of the customers on file.
//   verdict: match, retry or mismatch, against the claimed account only.
//   crisis:  the swing opens the claimed account and would also open somebody else's.
//   like:    the other customer this swing fits, when it fits one. { account, score } or null.
// A swing that fits nobody else leaves `like` null. The nearest customer is not named for being nearest.
export function verifyClaim(sig, account, others, cfg = MATCH_CONFIG) {
  const v = verify(account.profile, sig, cfg);
  const res = identify(sig, others, cfg);
  const fits = res.outcome === 'recognized' || res.outcome === 'ambiguous';
  return {
    ...v,
    crisis: v.verdict === 'match' && alsoMatches(sig, others.map((a) => a.profile), cfg) > 0,
    like: fits ? { account: res.best.account, score: res.best.score } : null,
    closest: res.best ? res.best.score : null,
  };
}

// At enrollment: is this new profile too close to somebody already on file?
// Each side's throws are checked against the other side's profile. Returns the closest clash or null.
export function collision(profile, accounts, cfg = MATCH_CONFIG) {
  let worst = null;
  for (const account of accounts) {
    const mine = mean(profile.templates.map((t) => distanceToTemplates(t, account.profile.templates))) / account.profile.accept;
    const theirs = mean(account.profile.templates.map((t) => distanceToTemplates(t, profile.templates))) / profile.accept;
    const ratio = Math.min(mine, theirs);
    if (ratio <= 1 && (!worst || ratio < worst.ratio)) worst = { account, ratio: Math.round(ratio * 100) / 100 };
  }
  return worst;
}

/* The report: what was measured in this swing, next to the same measurement on file. */

const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};

// Every row is a real measurement from the remote. `floor` is the smallest tolerance a row gets,
// so three very tidy enrollment throws do not make the report call everything a mismatch.
const TRAITS = [
  { key: 'length', label: 'Swing length', unit: 's', floor: (m) => 0.2 * m, get: (f) => f.dur / 1000, digits: 2 },
  { key: 'power', label: 'Peak force', unit: 'g', floor: () => 0.6, get: (f) => f.peak, digits: 1 },
  { key: 'release', label: 'Release after peak force', unit: 'ms', floor: () => 60, get: (f) => (1 - f.tPeak) * f.dur, digits: 0 },
  { key: 'windup', label: 'Effort in the first half', unit: '%', floor: () => 12, get: (f) => f.early * 100, digits: 0 },
  { key: 'wrist', label: 'Peak wrist and arm turn', unit: '°/s', gyro: true, floor: (m) => 0.25 * m, get: (f) => f.spin, digits: 0 },
  { key: 'side', label: 'Sideways share of motion', unit: '%', gyro: false, floor: () => 12, get: (f) => f.axis[0] * 100, digits: 0 },
  { key: 'follow', label: 'Follow-through', unit: 'g', floor: () => 0.25, get: (f) => f.follow, digits: 2 },
];

// Rows of { key, label, unit, value, onFile, ok }. `sig` may be null to describe a profile alone.
export function traits(sig, profile) {
  const gyro = profile.templates.every((t) => t.feat.spin != null) && (!sig || sig.feat.spin != null);
  const rows = [];
  for (const t of TRAITS) {
    if (t.gyro === true && !gyro) continue;
    if (t.gyro === false && gyro) continue;
    const filed = profile.templates.map((s) => t.get(s.feat));
    const onFile = mean(filed);
    const k = 10 ** t.digits;
    const row = { key: t.key, label: t.label, unit: t.unit, onFile: Math.round(onFile * k) / k, value: null, ok: null };
    if (sig) {
      const value = t.get(sig.feat);
      row.value = Math.round(value * k) / k;
      row.ok = Math.abs(value - onFile) <= Math.max(2.5 * sd(filed), t.floor(onFile));
    }
    rows.push(row);
  }
  return rows;
}
