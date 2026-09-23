import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionNotifications } from '../site/broker-mission-notifications.js';

const alice = `0x${'a'.repeat(40)}`, bob = `0x${'b'.repeat(40)}`, wallet = `0x${'c'.repeat(40)}`;
const initial = Date.parse('2026-09-23T15:00:00Z');
function setup(options = {}) {
  let time = initial, writes = 0;
  const data = new Map(), calls = [];
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { writes++; data.set(key, value); } };
  const settings = { storage, now: () => time, onChange: value => calls.push(value), ...options };
  return { notifications: createMissionNotifications(settings), settings, data, calls,
    advance: (amount = 1000) => { time += amount; }, now: () => time, writes: () => writes };
}
function account(now = initial, { owner = alice, tokenId = '93', sessionId = 'session-1', status = 'COMPLETED', active = false } = {}) {
  return { ok: true, owner, tokenId, receivedAt: now,
    runtime: { owner, account: wallet, sessionActive: active },
    worker: { enabled: true }, readiness: { databaseReady: true, automaticExecutionReady: active, blockers: [] },
    mission: { account: wallet, sessionId, status, completedMints: 5, totalLimit: 5,
      validAfter: new Date(now - 86400000).toISOString(), validUntil: new Date(now + 86400000).toISOString(),
      intent: { expectedOwner: owner, punkTokenId: tokenId },
      latestOperation: { state: 'CONFIRMED', transactionHash: `0x${'1'.repeat(64)}` } } };
}
const observe = (state, value, owner = alice, tokenId = '93') => state.notifications.observe({ owner, tokenId, account: value });

test('confirmed completion produces one unread badge across repeated polls and browser restart', () => {
  const s = setup(), item = observe(s, account());
  assert.equal(item.status, 'COMPLETED'); assert.equal(item.title, 'Mission completed');
  assert.equal(s.notifications.unread({ owner: alice }), 1);
  s.advance(); assert.equal(observe(s, account(s.now())), null);
  assert.equal(s.writes(), 1); assert.equal(s.calls.length, 1);
  const restored = createMissionNotifications(s.settings);
  assert.equal(restored.unread({ owner: alice }), 1);
  assert.equal(restored.markRead({ owner: alice, tokenId: '93' }), 1);
  s.advance(); assert.equal(restored.observe({ owner: alice, tokenId: '93', account: account(s.now()) }), null);
  assert.equal(createMissionNotifications(s.settings).unread({ owner: alice }), 0);
  assert.equal(s.notifications.unread({ owner: alice.toUpperCase().replace('0X', '0x') }), 1);
});

test('owner and Punk isolation includes restored history, marking read, and ownership transfer', () => {
  const s = setup();
  observe(s, account());
  observe(s, account(initial, { owner: bob, tokenId: '96' }), bob, '96');
  assert.equal(s.notifications.unread({ owner: alice, tokenId: '96' }), 0);
  assert.equal(s.notifications.unread({ owner: bob }), 1);
  assert.equal(observe(s, account(initial, { owner: alice }), bob), null);
  const transferred = account(initial, { owner: bob }); transferred.mission.intent.expectedOwner = alice;
  assert.equal(observe(s, transferred, bob), null);
  s.notifications.markRead({ owner: alice });
  assert.equal(s.notifications.unread({ owner: alice }), 0);
  assert.equal(s.notifications.unread({ owner: bob }), 1);
  assert.equal(createMissionNotifications(s.settings).list({ owner: bob })[0].tokenId, '96');
});

test('missing, stale, future, failed, mismatched, and wrong-chain responses create no notifications', () => {
  const s = setup();
  const invalid = [null, {}, { error: 'RPC unavailable' }];
  for (const mutate of [a => { a.ok = false; }, a => { a.receivedAt -= 90001; }, a => { a.receivedAt++; },
    a => { delete a.receivedAt; }, a => { a.owner = bob; }, a => { a.tokenId = '96'; },
    a => { a.runtime.sessionActive = undefined; }, a => { a.runtime.owner = bob; }, a => { a.runtime.account = bob; },
    a => { a.readiness.databaseReady = false; }, a => { a.chainId = 1; }, a => { a.mission.sessionId = ''; },
    a => { a.mission.intent.punkTokenId = '96'; }, a => { a.mission.account = {}; }]) {
    const value = account(); mutate(value); invalid.push(value);
  }
  for (const value of invalid) assert.equal(observe(s, value), null);
  assert.deepEqual(s.notifications.list({ owner: alice }), []); assert.equal(s.writes(), 0);
});

test('active wallet permission and pending receipts never produce a completed badge', () => {
  for (const change of [a => { a.runtime.sessionActive = true; }, a => { a.mission.latestOperation.state = 'SUBMITTED'; },
    a => { a.mission.latestOperation.state = 'PENDING_RECEIPT'; }, a => { a.mission.latestOperation.state = 'SIGNED'; }]) {
    const s = setup(), value = account(); change(value);
    const item = observe(s, value);
    assert.equal(item.status, 'REQUIRES_ATTENTION'); assert.equal(item.reason, 'CHECK_MISSION_RESULT');
    assert.notEqual(item.title, 'Mission completed');
    s.advance(); observe(s, account(s.now()));
    assert.equal(s.notifications.list({ owner: alice })[0].status, 'COMPLETED');
    assert.equal(s.notifications.unread({ owner: alice }), 1);
  }
});

test('expiry must be expired, failures are explicit, and normal active work does not create alerts', () => {
  const s = setup();
  assert.equal(observe(s, account(initial, { status: 'ACTIVE', active: true })), null);
  s.advance(); assert.equal(observe(s, account(s.now(), { status: 'EXPIRED' })), null);
  s.advance(); const expired = account(s.now(), { status: 'EXPIRED' });
  expired.mission.validUntil = new Date(initial - 1).toISOString();
  assert.equal(observe(s, expired).status, 'EXPIRED');
  s.advance(); assert.equal(observe(s, account(s.now(), { status: 'FAILED', sessionId: 'session-2' })).status, 'FAILED');
});

test('gas and worker attention are deduplicated by session and do not re-alert after being read', () => {
  const s = setup(), value = account(initial, { status: 'ACTIVE', active: true });
  value.readiness.blockers = ['AGENT_GAS_UNFUNDED'];
  assert.equal(observe(s, value).reason, 'NEEDS_GAS');
  s.notifications.markRead({ owner: alice, tokenId: '93' });
  s.advance(); value.receivedAt = s.now(); value.readiness.blockers = []; value.worker.enabled = false;
  assert.equal(observe(s, value), null); assert.equal(s.notifications.unread({ owner: alice }), 0);
  s.advance(); value.receivedAt = s.now(); value.mission.sessionId = 'session-2';
  assert.equal(observe(s, value).reason, 'WORKER_PAUSED');
  assert.equal(s.notifications.unread({ owner: alice }), 1);
});

test('out-of-order responses cannot introduce old terminal state after a newer mission response', () => {
  const s = setup();
  const previous = account(); s.advance();
  assert.equal(observe(s, account(s.now(), { status: 'ACTIVE', active: true, sessionId: 'session-2' })), null);
  assert.equal(observe(s, previous), null);
  const restored = createMissionNotifications(s.settings);
  assert.equal(restored.observe({ owner: alice, tokenId: '93', account: previous }), null);
  assert.equal(restored.unread({ owner: alice }), 0);
});

test('unavailable storage and throwing display listeners do not block status observation', () => {
  const s = setup({ storage: { getItem() { throw Error('denied'); }, setItem() { throw Error('disk full'); } },
    onChange() { throw Error('render failed'); } });
  assert.equal(observe(s, account()).status, 'COMPLETED');
  s.advance(); assert.equal(observe(s, account(s.now())), null);
  assert.equal(s.notifications.markRead({ owner: alice }), 1);
  assert.equal(s.notifications.unread({ owner: alice }), 0);
});

test('bounded persistence stores only notification metadata, strips unknown fields, and survives corrupt JSON', () => {
  const s = setup();
  for (let i = 0; i < 105; i++) {
    s.advance(); const value = account(s.now(), { sessionId: `session-${i}` });
    value.signer = { secret: 'DO_NOT_STORE' }; value.mission.intent.secret = 'DO_NOT_STORE'; observe(s, value);
  }
  assert.equal(s.notifications.list({ owner: alice }).length, 100);
  const [key, text] = [...s.data.entries()][0];
  assert.doesNotMatch(text, /DO_NOT_STORE|transactionHash|intent|sessionKey|runtime|signer/);
  const stored = JSON.parse(text); stored.items[0].unexpected = 'DO_NOT_RETURN';
  s.data.set(key, JSON.stringify(stored));
  assert.equal(createMissionNotifications(s.settings).list({ owner: alice })[0].unexpected, undefined);
  s.data.set(key, '{'); assert.deepEqual(createMissionNotifications(s.settings).list({ owner: alice }), []);
});
