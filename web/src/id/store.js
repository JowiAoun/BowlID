// Bowling identities, kept in this browser only. Nothing here is a real account.
// An account has a username and no password. The swing profile is the password.
import { makeSignature } from '../motion/signal.js';
import { buildProfile } from '../motion/matcher.js';
import { syntheticSet, PEOPLE } from '../motion/synthetic.js';

const KEY = 'bowlid.v1';
const BALANCES = [69420.0, 80085.0, 31337.42, 12345.67, 404.04, 1000000.01, 8675.309];
const COLORS = ['#4a8ff0', '#e8590c', '#0f9d58', '#9c36b5', '#d6336c', '#f08c00', '#0c8599'];
// How many log-ins and declined attempts are kept per account.
const KEEP = 50;
// How many scored bowls are kept for the side-by-side view. Two log-ins of three bowls each fit twice over.
const RECENT = 12;
const USERNAME = /^[a-z0-9_.-]{2,20}$/;

const blankLedger = () => ({ bowls: 0, recognized: 0, unknown: 0, unsure: 0, crises: 0, guttersIn: 0, strikesOut: 0, logins: 0, loginBowls: 0, loginPins: 0 });
const blank = () => ({ accounts: [], ledger: blankLedger(), serial: 67, recent: [], lastUser: '' });

export const cleanUsername = (text) => String(text || '').trim().toLowerCase();

// Accounts saved before usernames existed get one made from their old display name.
function migrate(accounts) {
  const taken = new Set(accounts.map((a) => a.username).filter(Boolean));
  for (const a of accounts) {
    if (!a.username) {
      const base = String(a.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 17) || 'customer';
      let name = base.length < 2 ? `${base}-1` : base;
      for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
      a.username = name;
      taken.add(name);
    }
    a.history = Array.isArray(a.history) ? a.history : [];
    a.attempts = Array.isArray(a.attempts) ? a.attempts : [];
    a.seenAttempts = a.seenAttempts || 0;
    a.attemptsEver = a.attemptsEver || a.attempts.length;
  }
  return accounts;
}

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.accounts)) {
      return {
        ...blank(),
        ...data,
        accounts: migrate(data.accounts),
        ledger: { ...blankLedger(), ...data.ledger },
        recent: Array.isArray(data.recent) ? data.recent : [],
      };
    }
  } catch { /* A broken or missing save starts fresh. */ }
  return blank();
}

let state = read();
// Bowls by the sample customers stay in memory, like everything else about them.
const save = () => {
  const kept = { ...state, recent: state.recent.filter((c) => c.src !== 'synthetic') };
  try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* Private windows may refuse. The session still works. */ }
};

const accountNumber = () => `0${Math.floor(1000 + Math.random() * 9000)} ${Math.floor(100000 + Math.random() * 900000)}`;

// Sample customers for the public demo. Their swings come from a formula, not from people,
// and they are only ever compared with other formula swings. Nothing about them is saved.
// Three throws that happen to land very close together make a strict profile that turns its own
// owner away about one bowl in four. These seeds give each sample customer an ordinary enrollment.
const SAMPLE_SEEDS = [12, 11];
let samples = null;
function sampleAccounts() {
  if (!samples) {
    samples = ['margaret', 'gary'].map((key, i) => ({
      id: `sample-${key}`,
      username: key,
      name: PEOPLE[key].name,
      number: ['07734 100200', '07734 300400'][i],
      balance: [248116.5, 12.75][i],
      color: ['#9c36b5', '#0c8599'][i],
      source: 'synthetic',
      sample: true,
      sampleKey: key,
      profile: buildProfile(syntheticSet(key, 3, SAMPLE_SEEDS[i]).map(makeSignature)),
      logins: 0,
      bowls: 0,
      guttersIn: 0,
      history: [],
      attempts: [],
      seenAttempts: 0,
      attemptsEver: 0,
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
  // The account a typed username names, whatever it was enrolled with.
  find(username) {
    const u = cleanUsername(username);
    return [...state.accounts, ...sampleAccounts()].find((a) => a.username === u) || null;
  },
  // Why a username cannot be used for a new account, or null when it can.
  refuse(username) {
    const u = cleanUsername(username);
    if (!u) return 'empty';
    if (!USERNAME.test(u)) return 'shape';
    if (this.find(u)) return 'taken';
    return null;
  },
  ledger() { return state.ledger; },
  nextSerial() { return state.serial; },

  // `name` is the nickname the swing earned. It is shown, and never used to log in.
  open(username, name, profile, source, twinOf = null) {
    const account = {
      id: `c-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      username: cleanUsername(username),
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
      history: [],
      attempts: [],
      seenAttempts: 0,
      attemptsEver: 0,
    };
    state.accounts.push(account);
    state.serial++;
    save();
    return account;
  },

  close(id) {
    state.accounts = state.accounts.filter((a) => a.id !== id);
    state.recent = state.recent.filter((c) => c.account !== id);
    save();
  },

  // One scored log-in bowl, kept for the side-by-side view: its score, verdict, pins and the
  // force curve of the swing. `card.account` is the account it was tried on and `card.login`
  // the log-in it belongs to. Only the last few are kept.
  remember(card) {
    state.recent.push(card);
    if (state.recent.length > RECENT) state.recent.shift();
    save();
  },

  // The last two log-ins to this account, oldest first. A log-in that took several bowls is
  // shown by its last one.
  lastTwo(accountId) {
    const byLogin = new Map();
    for (const c of state.recent) if (c.account === accountId) byLogin.set(c.login, c);
    return [...byLogin.values()].slice(-2);
  },

  // The username last bowled for, so the page can come back with it filled in.
  lastUser() { return state.lastUser || ''; },
  setLastUser(username) {
    const u = cleanUsername(username);
    if (u === state.lastUser) return;
    state.lastUser = u;
    save();
  },

  // One log-in bowl. Only counts are kept, never the swing.
  bowl(verdict, pins, crisis = false) {
    const l = state.ledger;
    l.bowls++;
    if (verdict === 'match') l.recognized++;
    else if (verdict === 'retry') l.unsure++;
    else l.unknown++;
    if (crisis) l.crises++;
    if (verdict === 'match' && pins.gutter) l.guttersIn++;
    if (verdict !== 'match' && pins.strike) l.strikesOut++;
    save();
  },

  // A log-in to this account that ended without the swing matching. `entry` is
  // { score, bowls, pins, likeName, likeScore }. The swing itself is not kept.
  attempt(account, entry) {
    account.attempts.push({ t: Date.now(), ...entry });
    if (account.attempts.length > KEEP) account.attempts.shift();
    account.attemptsEver++;
    if (!account.sample) save();
  },

  // A finished log-in: who got in, and what it took. Returns how many declined attempts
  // were made on the account since its owner was last in.
  login(account, bowls, pins, gutter, score) {
    const fresh = account.attemptsEver - account.seenAttempts;
    account.seenAttempts = account.attemptsEver;
    account.history.push({ t: Date.now(), score });
    if (account.history.length > KEEP) account.history.shift();
    account.logins++;
    account.bowls += bowls;
    if (gutter) account.guttersIn++;
    if (!account.sample) {
      const l = state.ledger;
      l.logins++;
      l.loginBowls += bowls;
      l.loginPins += pins;
      save();
    }
    return fresh;
  },

  reset() { state = blank(); samples = null; save(); },
  // For tests: read the save again, as a fresh page load would.
  reload() { state = read(); samples = null; },
};
