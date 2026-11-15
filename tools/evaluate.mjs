#!/usr/bin/env node
// Measures the matcher on recorded swings.
// Usage: node tools/evaluate.mjs [folder or files]   (default: recordings/)
//        node tools/evaluate.mjs --synthetic         (made-up swings, to check the tool itself)
// Each file is a swing or a list of swings, as saved by the "Export recorded swings" link in the app.
// Open the app with ?who=name so every swing in the file is labelled with the person who bowled it.
import fs from 'node:fs';
import path from 'node:path';
import { makeSignature, checkQuality } from '../web/src/motion/signal.js';
import { MATCH_CONFIG, buildProfile, verify, identify } from '../web/src/motion/matcher.js';
import { syntheticSet, PEOPLE } from '../web/src/motion/synthetic.js';

const args = process.argv.slice(2);
const synthetic = args.includes('--synthetic');
const enrollN = Number((args.find((a) => a.startsWith('--enroll=')) || '').split('=')[1]) || MATCH_CONFIG.enrollThrows;
const inputs = args.filter((a) => !a.startsWith('--'));

function loadSwings() {
  if (synthetic) return Object.keys(PEOPLE).flatMap((k, i) => syntheticSet(k, 12, 500 + i));
  const targets = inputs.length ? inputs : ['recordings'];
  const files = [];
  for (const t of targets) {
    if (!fs.existsSync(t)) continue;
    if (fs.statSync(t).isDirectory()) {
      for (const f of fs.readdirSync(t)) if (f.endsWith('.json')) files.push(path.join(t, f));
    } else files.push(t);
  }
  const swings = [];
  for (const f of files.sort()) {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const s of Array.isArray(data) ? data : [data]) if (s && s.samples) swings.push(s);
  }
  return swings;
}

const swings = loadSwings();
if (!swings.length) {
  console.log('No swings found. Open the app with ?who=yourname, bowl on the practice lane, click the export link, and put the file in recordings/.');
  console.log('To check the tool with made-up data, run: npm run evaluate -- --synthetic');
  process.exit(1);
}

// Group by participant and by source. A pointer swing and a Wii swing are never compared.
const groups = new Map();
let dropped = 0;
for (const s of swings) {
  if (s.participant === 'practice' || s.participant === 'unlabelled') continue;
  if (!checkQuality(s).ok) { dropped++; continue; }
  const key = `${s.participant} (${s.source || 'unknown'})`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(makeSignature(s));
}

const people = [...groups.entries()].filter(([, sigs]) => sigs.length > enrollN);
const skipped = [...groups.entries()].filter(([, sigs]) => sigs.length <= enrollN);

console.log(synthetic
  ? 'SYNTHETIC DATA. These swings come from a formula. The numbers below say nothing about real people.\n'
  : 'Recorded swings. The numbers below describe this data set only.\n');
console.log(`Swings read: ${swings.length}. Unusable and dropped: ${dropped}.`);
console.log(`Participants with held-out swings: ${people.length}. Enrollment throws each: ${enrollN}.`);
for (const [name, sigs] of skipped) console.log(`  Skipped ${name}: ${sigs.length} swing(s), needs more than ${enrollN}.`);
if (people.length < 1) process.exit(1);

const tally = () => ({ match: 0, retry: 0, mismatch: 0, n: 0, scores: [] });
const genuine = tally();
const impostor = tally();
const rows = [];
for (const [name, sigs] of people) {
  const profile = buildProfile(sigs.slice(0, enrollN));
  const own = tally();
  for (const s of sigs.slice(enrollN)) {
    const v = verify(profile, s);
    own[v.verdict]++; own.n++; genuine[v.verdict]++; genuine.n++; genuine.scores.push(v.score);
  }
  const theirs = tally();
  for (const [other, osigs] of people) {
    if (other === name || other.split(' (').pop() !== name.split(' (').pop()) continue;
    for (const s of osigs.slice(enrollN)) {
      const v = verify(profile, s);
      theirs[v.verdict]++; theirs.n++; impostor[v.verdict]++; impostor.n++; impostor.scores.push(v.score);
    }
  }
  rows.push({ name, spread: profile.spread, accept: profile.accept, consistent: profile.consistent, own, theirs });
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : 'n/a');
const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 'n/a');

console.log('\nPer participant');
for (const r of rows) {
  console.log(`  ${r.name}: spread ${r.spread}, accept distance ${r.accept}${r.consistent ? '' : ' (inconsistent enrollment)'}`);
  console.log(`    own swings:    ${r.own.match}/${r.own.n} approved, ${r.own.retry} asked again, ${r.own.mismatch} declined`);
  console.log(`    other people:  ${r.theirs.match}/${r.theirs.n} approved, ${r.theirs.retry} asked again, ${r.theirs.mismatch} declined`);
}
console.log('\nTotals');
console.log(`  Genuine attempts:  ${genuine.n}. Accepted ${pct(genuine.match, genuine.n)}, asked again ${pct(genuine.retry, genuine.n)}, falsely rejected ${pct(genuine.mismatch, genuine.n)}. Median score ${med(genuine.scores)}.`);
console.log(`  Impostor attempts: ${impostor.n}. Falsely accepted ${pct(impostor.match, impostor.n)}, asked again ${pct(impostor.retry, impostor.n)}, rejected ${pct(impostor.mismatch, impostor.n)}. Median score ${med(impostor.scores)}.`);
/* Identification: the question the product asks. One swing, everyone enrolled, nobody named. */

const kinds = [...new Set(people.map(([name]) => name.split(' (').pop()))];
const idTally = () => ({ n: 0, right: 0, wrong: 0, crisis: 0, unsure: 0, unknown: 0 });
const known = idTally();
const stranger = idTally();
for (const kind of kinds) {
  const group = people.filter(([name]) => name.split(' (').pop() === kind);
  const gallery = group.map(([name, sigs]) => ({ id: name, profile: buildProfile(sigs.slice(0, enrollN)) }));
  for (const [name, sigs] of group) {
    for (const s of sigs.slice(enrollN)) {
      // Enrolled: this person is on file, with everybody else.
      const r = identify(s, gallery);
      known.n++;
      if (r.outcome === 'recognized') known[r.best.account.id === name ? 'right' : 'wrong']++;
      else known[r.outcome === 'ambiguous' ? 'crisis' : r.outcome]++;
      // Stranger: the same swing, with this person taken off the file. Needs somebody else on file.
      const rest = gallery.filter((g) => g.id !== name);
      if (!rest.length) continue;
      const q = identify(s, rest);
      stranger.n++;
      if (q.outcome === 'recognized') stranger.wrong++;
      else stranger[q.outcome === 'ambiguous' ? 'crisis' : q.outcome]++;
    }
  }
}
console.log('\nIdentification (one bowl, nobody named beforehand)');
console.log(`  Enrolled people, ${known.n} held-out bowls: opened the right account ${pct(known.right, known.n)}, opened SOMEBODY ELSE'S account ${pct(known.wrong, known.n)}, identity crisis ${pct(known.crisis, known.n)}, asked to bowl again ${pct(known.unsure, known.n)}, not recognised ${pct(known.unknown, known.n)}.`);
if (stranger.n) {
  console.log(`  Strangers, ${stranger.n} bowls (each person taken off the file in turn): let into somebody's account ${pct(stranger.wrong, stranger.n)}, identity crisis ${pct(stranger.crisis, stranger.n)}, asked to bowl again ${pct(stranger.unsure, stranger.n)}, correctly unknown ${pct(stranger.unknown, stranger.n)}.`);
} else {
  console.log('  Strangers: needs at least two people recorded with the same kind of input.');
}
if (known.n < 20) console.log('  Small sample. Treat these rates as a rough guide.');


if (genuine.n < 20 || impostor.n < 20) console.log('\nSmall sample. Treat these rates as a rough guide.');
console.log('\nTo tune: edit MATCH_CONFIG in web/src/motion/matcher.js (acceptFactor, acceptFloor, acceptCeil, rivalMargin) and run this again.');
