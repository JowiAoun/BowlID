// Builds a customer's swing profile and checks a new swing against it.
import { distance } from './signal.js';

export const MATCH_CONFIG = {
  enrollThrows: 3,
  maxEnrollThrows: 6,
  // The accept distance is the customer's own spread times this factor.
  acceptFactor: 1.7,
  // Limits on the accept distance, so a very tidy or very sloppy enrollment still gives a usable profile.
  acceptFloor: 0.3,
  acceptCeil: 1.4,
  // An enrollment throw this many times further from the rest than the median is dropped.
  outlierFactor: 1.9,
  // Score bands. 70 and up is a match, 50 to 69 asks for another bowl.
  scoreMatch: 70,
  scoreRetry: 50,
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
  const hasOutlier = signatures.length >= 3 && worst > median * cfg.outlierFactor && worst > cfg.acceptFloor;
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
