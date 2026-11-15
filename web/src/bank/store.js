// Customer accounts, kept in this browser only. Nothing here is a real account.
import { makeSignature } from '../motion/signal.js';
import { buildProfile } from '../motion/matcher.js';
import { syntheticSet, PEOPLE } from '../motion/synthetic.js';

const KEY = 'bowlbank.v1';
const BALANCES = [69420.0, 80085.0, 31337.42, 12345.67, 404.04, 1000000.01, 8675.309];

const blank = () => ({ accounts: [], ledger: { attempts: 0, approvals: 0, strikesDenied: 0, guttersApproved: 0, crises: 0 } });

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.accounts)) return { ...blank(), ...data };
  } catch { /* A broken or missing save starts fresh. */ }
  return blank();
}

let state = read();
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* Private windows may refuse. The session still works. */ }
};

const accountNumber = () => `0${Math.floor(1000 + Math.random() * 9000)} ${Math.floor(100000 + Math.random() * 900000)}`;

// Sample customers. Their swings come from a formula, so the public demo has someone to break into.
const SAMPLES = ['margaret', 'gary'].map((key, i) => ({
  id: `sample-${key}`,
  name: PEOPLE[key].name,
  number: ['07734 100200', '07734 300400'][i],
  balance: [248116.5, 12.75][i],
  sample: true,
  sampleKey: key,
  source: 'synthetic',
  profile: buildProfile(syntheticSet(key, 3, 10 + i).map(makeSignature)),
  logins: 0,
  denials: 0,
}));

export const store = {
  accounts() { return [...state.accounts, ...SAMPLES]; },
  get(id) { return this.accounts().find((a) => a.id === id); },
  ledger() { return state.ledger; },

  open(name, profile, source) {
    const account = {
      id: `c-${Date.now().toString(36)}`,
      name: name.trim().slice(0, 40) || 'Valued Customer',
      number: accountNumber(),
      balance: BALANCES[state.accounts.length % BALANCES.length],
      sample: false,
      source,
      profile,
      logins: 0,
      denials: 0,
    };
    state.accounts.unshift(account);
    save();
    return account;
  },

  close(id) {
    state.accounts = state.accounts.filter((a) => a.id !== id);
    save();
  },

  // Records one sign-in attempt. Only counts are kept, never the swing itself.
  record(account, verdict, pins) {
    const l = state.ledger;
    l.attempts++;
    if (verdict === 'match') { l.approvals++; account.logins++; } else if (verdict === 'mismatch') account.denials++;
    if (verdict !== 'match' && pins.strike) l.strikesDenied++;
    if (verdict === 'match' && pins.gutter) l.guttersApproved++;
    save();
  },

  crisis() { state.ledger.crises++; save(); },
  reset() { state = blank(); save(); },
};
