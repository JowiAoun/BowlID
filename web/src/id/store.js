// Bowling identities, kept in this browser only. Nothing here is a real account.
// An account has no username and no password. Its only key is the swing profile.
import { makeSignature } from '../motion/signal.js';
import { buildProfile } from '../motion/matcher.js';
import { syntheticSet, PEOPLE } from '../motion/synthetic.js';

const KEY = 'bowlid.v1';
const BALANCES = [69420.0, 80085.0, 31337.42, 12345.67, 404.04, 1000000.01, 8675.309];
const COLORS = ['#4a8ff0', '#e8590c', '#0f9d58', '#9c36b5', '#d6336c', '#f08c00', '#0c8599'];

const blankLedger = () => ({ bowls: 0, recognized: 0, unknown: 0, unsure: 0, crises: 0, guttersIn: 0, strikesOut: 0, logins: 0, loginBowls: 0, loginPins: 0 });
const blank = () => ({ accounts: [], ledger: blankLedger(), serial: 67 });

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.accounts)) return { ...blank(), ...data, ledger: { ...blankLedger(), ...data.ledger } };
  } catch { /* A broken or missing save starts fresh. */ }
  return blank();
}

let state = read();
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* Private windows may refuse. The session still works. */ }
};

const accountNumber = () => `0${Math.floor(1000 + Math.random() * 9000)} ${Math.floor(100000 + Math.random() * 900000)}`;

// Sample customers for the public demo. Their swings come from a formula, not from people,
// and they are only ever compared with other formula swings.
let samples = null;
function sampleAccounts() {
  if (!samples) {
    samples = ['margaret', 'gary'].map((key, i) => ({
      id: `sample-${key}`,
      name: PEOPLE[key].name,
      number: ['07734 100200', '07734 300400'][i],
      balance: [248116.5, 12.75][i],
      color: ['#9c36b5', '#0c8599'][i],
      source: 'synthetic',
      sample: true,
      sampleKey: key,
      profile: buildProfile(syntheticSet(key, 3, 10 + i).map(makeSignature)),
      logins: 0,
      bowls: 0,
      guttersIn: 0,
    }));
  }
  return samples;
}

export const store = {
  // Everyone enrolled with this kind of input. A pointer swing is never compared with a Wii swing.
  accounts(source) {
    if (source === 'synthetic') return sampleAccounts();
    return state.accounts.filter((a) => !source || a.source === source);
  },
  get(id) { return [...state.accounts, ...sampleAccounts()].find((a) => a.id === id); },
  ledger() { return state.ledger; },
  nextSerial() { return state.serial; },

  open(name, profile, source, twinOf = null) {
    const account = {
      id: `c-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      name,
      number: accountNumber(),
      balance: BALANCES[state.accounts.length % BALANCES.length],
      color: COLORS[state.accounts.length % COLORS.length],
      source,
      profile,
      twinOf,
      logins: 0,
      bowls: 0,
      guttersIn: 0,
    };
    state.accounts.push(account);
    state.serial++;
    save();
    return account;
  },

  // A display name only. It is never used to find or open an account.
  rename(id, name) {
    const a = state.accounts.find((x) => x.id === id);
    if (a) { a.name = name.trim().slice(0, 32) || a.name; save(); }
  },

  close(id) {
    state.accounts = state.accounts.filter((a) => a.id !== id);
    save();
  },

  // One log-in bowl. Only counts are kept, never the swing.
  bowl(outcome, pins) {
    const l = state.ledger;
    l.bowls++;
    if (outcome === 'recognized') l.recognized++;
    else if (outcome === 'ambiguous') l.crises++;
    else if (outcome === 'unsure') l.unsure++;
    else l.unknown++;
    if (outcome === 'recognized' && pins.gutter) l.guttersIn++;
    if (outcome !== 'recognized' && pins.strike) l.strikesOut++;
    save();
  },

  // A finished log-in: who got in, and what it took.
  login(account, bowls, pins, gutter) {
    const l = state.ledger;
    l.logins++;
    l.loginBowls += bowls;
    l.loginPins += pins;
    account.logins++;
    account.bowls += bowls;
    if (gutter) account.guttersIn++;
    save();
  },

  reset() { state = blank(); save(); },
};
