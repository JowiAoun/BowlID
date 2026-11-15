// The account store, run without a browser. localStorage is a plain object here.
import test from 'node:test';
import assert from 'node:assert/strict';

const saved = new Map();
globalThis.localStorage = {
  getItem: (k) => (saved.has(k) ? saved.get(k) : null),
  setItem: (k, v) => { saved.set(k, String(v)); },
};

const { store, cleanUsername } = await import('../web/src/id/store.js');
const profile = { templates: [], spread: 0.2, accept: 0.4, consistent: true, outlier: -1, gyro: false };

test('a username is trimmed and lowercased, and found again', () => {
  store.reset();
  assert.equal(cleanUsername('  Ishar '), 'ishar');
  const a = store.open('Ishar', 'The Cannon', profile, 'pointer');
  assert.equal(a.username, 'ishar');
  assert.equal(store.find(' ISHAR').id, a.id);
  assert.equal(store.find('nobody'), null);
});

test('a new username must be well formed and free, and sample names are reserved', () => {
  store.reset();
  store.open('ishar', 'The Cannon', profile, 'pointer');
  assert.equal(store.refuse(''), 'empty');
  assert.equal(store.refuse('a'), 'shape');
  assert.equal(store.refuse('two words'), 'shape');
  assert.equal(store.refuse('Ishar'), 'taken');
  assert.equal(store.refuse('gary'), 'taken');
  assert.equal(store.refuse('new.person_2'), null);
});

test('declined attempts are counted, and the owner is told once', () => {
  store.reset();
  const a = store.open('ishar', 'The Cannon', profile, 'pointer');
  store.attempt(a, { score: 12, bowls: 1, pins: 10, likeName: 'gary', likeScore: 84 });
  store.attempt(a, { score: 40, bowls: 3, pins: 0, likeName: null, likeScore: null });
  assert.equal(a.attemptsEver, 2);
  assert.equal(a.attempts[0].likeName, 'gary');
  assert.equal(store.login(a, 1, 7, false, 91), 2);
  assert.equal(store.login(a, 1, 7, false, 88), 0);
  assert.deepEqual(a.history.map((h) => h.score), [91, 88]);
  store.attempt(a, { score: 5, bowls: 1, pins: 3, likeName: null, likeScore: null });
  assert.equal(store.login(a, 2, 9, true, 75), 1);
  assert.equal(store.ledger().logins, 3);
});

test('attempts and log-ins survive a reload', () => {
  store.reset();
  const a = store.open('ishar', 'The Cannon', profile, 'pointer');
  store.attempt(a, { score: 12, bowls: 1, pins: 10, likeName: 'gary', likeScore: 84 });
  store.reload();
  const again = store.find('ishar');
  assert.equal(again.attemptsEver, 1);
  assert.equal(store.login(again, 1, 7, false, 91), 1);
});

test('an account saved before usernames gets one from its old name', () => {
  saved.set('bowlid.v1', JSON.stringify({
    accounts: [
      { id: 'c-1', name: 'The Cannon', source: 'wii', profile, logins: 2, bowls: 3, guttersIn: 0 },
      { id: 'c-2', name: 'The Cannon', source: 'wii', profile, logins: 0, bowls: 0, guttersIn: 0 },
    ],
    serial: 69,
  }));
  store.reload();
  const [a, b] = store.accounts('wii');
  assert.equal(a.username, 'the-cannon');
  assert.equal(b.username, 'the-cannon-2');
  assert.deepEqual(a.attempts, []);
  assert.equal(store.find('the-cannon').id, 'c-1');
  assert.equal(store.refuse('the-cannon'), 'taken');
});

test('a sample customer keeps attempts in memory and out of the ledger', () => {
  store.reset();
  const margaret = store.find('margaret');
  assert.equal(margaret.sample, true);
  store.attempt(margaret, { score: 3, bowls: 1, pins: 4, likeName: 'gary', likeScore: 90 });
  assert.equal(store.login(margaret, 1, 5, false, 95), 1);
  assert.equal(store.ledger().logins, 0);
  assert.equal(JSON.parse(saved.get('bowlid.v1')).accounts.length, 0);
});
