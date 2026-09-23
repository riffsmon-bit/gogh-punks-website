import test from 'node:test';
import assert from 'node:assert/strict';
import { punkActivationStatus } from '../site/broker-activation-status.js';

const owner = `0x${'a'.repeat(40)}`, other = `0x${'b'.repeat(40)}`, wallet = `0x${'c'.repeat(40)}`;
const now = Date.parse('2026-09-23T18:00:00Z');
const identity = { owner, chainId: 4663, tokenId: '93', now };
const strategy = { expectedOwner: owner, punkTokenId: '93', minimumReserveWei: '100000000000000' };
function account() {
  return { ok: true, owner, tokenId: '93', receivedAt: now,
    runtime: { account: wallet, accountCreated: true, owner, sessionActive: true,
      nativeBalance: '1000000000000000', entryPointDeposit: '0', session: { minimumNativeReserveWei: strategy.minimumReserveWei } },
    readiness: { databaseReady: true, setupAvailable: true, automaticExecutionReady: true, blockers: [] },
    worker: { enabled: true },
    mission: { status: 'ACTIVE', account: wallet, intent: { ...strategy },
      validAfter: new Date(now - 60000).toISOString(), validUntil: new Date(now + 86400000).toISOString(),
      lastCheckedAt: new Date(now - 30000).toISOString(), lastFailedAt: null, latestOperation: null } };
}
const view = value => punkActivationStatus({ ...identity, account: value, strategy });
const step = (result, id) => result.steps.find(item => item.id === id);

test('fresh current-owner account, gas, permission and worker produce a complete activation checklist', () => {
  const result = view(account());
  assert.equal(result.status, 'ACTIVE'); assert.equal(result.label, 'LOOKING FOR MINTS');
  assert.deepEqual(result.steps.map(item => item.id), ['CHECK', 'SETUP', 'FUND', 'MISSION', 'WORKER']);
  assert.equal(result.steps.every(item => item.status === 'COMPLETE'), true);
  assert.equal(result.balances.availableNativeWei, '900000000000000');
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.steps[0]), true);
});

test('missing, stale, failed, future, wrong-owner and wrong-chain reads never mean not activated', () => {
  for (const input of [undefined, null, {}, { error: 'timeout' }]) assert.equal(view(input).status, 'UNKNOWN');
  for (const mutate of [a => { a.ok = false; }, a => { a.receivedAt -= 90001; }, a => { a.receivedAt++; },
    a => { delete a.receivedAt; }, a => { a.owner = other; }, a => { a.tokenId = '96'; },
    a => { a.runtime.owner = other; }, a => { delete a.runtime.owner; }, a => { a.runtime.account = null; },
    a => { delete a.runtime.accountCreated; }, a => { a.chainId = 1; }, a => { a.readiness.databaseReady = false; }]) {
    const value = account(); mutate(value);
    const result = view(value); assert.equal(result.status, 'UNKNOWN'); assert.notEqual(result.label, 'AGENT NOT ACTIVATED');
  }
  assert.equal(punkActivationStatus({ ...identity, chainId: 1, account: account() }).status, 'UNKNOWN');
  assert.equal(punkActivationStatus({ ...identity, owner: other, account: account() }).status, 'UNKNOWN');
});

test('only an explicit fresh undeployed account offers the combined wallet and mission setup', () => {
  const value = account();
  value.runtime = { account: wallet, accountCreated: false, sessionActive: false };
  value.mission = null; value.readiness.automaticExecutionReady = false;
  let result = view(value);
  assert.equal(result.status, 'SETUP_REQUIRED'); assert.equal(step(result, 'CHECK').status, 'COMPLETE');
  assert.equal(step(result, 'SETUP').action, 'SETUP');
  assert.match(step(result, 'SETUP').detail, /wallet.*mission permission.*two wallet confirmations/);
  assert.equal(step(result, 'FUND').status, 'PENDING');
  value.readiness.setupAvailable = false; result = view(value);
  assert.equal(result.status, 'SETUP_BLOCKED'); assert.equal(result.label, 'AGENT NOT ACTIVATED');
  assert.equal(step(result, 'SETUP').status, 'BLOCKED');
  assert.equal(step(result, 'SETUP').action, 'CHECK'); assert.match(result.detail, /adding funds cannot fix/);
  value.runtime.sessionActive = true; assert.equal(view(value).status, 'UNKNOWN');
});

test('already-authorized empty Agent wallet requests gas without looping through authorization', () => {
  const value = account(); value.runtime.nativeBalance = '0';
  const result = view(value);
  assert.equal(result.status, 'GAS_REQUIRED'); assert.equal(result.balances.totalGasWei, '0');
  assert.equal(step(result, 'SETUP').status, 'COMPLETE');
  assert.equal(step(result, 'MISSION').status, 'COMPLETE');
  assert.equal(step(result, 'FUND').status, 'CURRENT'); assert.equal(step(result, 'FUND').action, 'FUND');
  assert.match(result.detail, /permission is already confirmed/);
});

test('reserve is enforced exactly and prepaid deposits cannot hide the worker native-balance check', () => {
  const value = account(); value.runtime.nativeBalance = strategy.minimumReserveWei;
  value.runtime.entryPointDeposit = '900719925474099300000';
  let result = view(value);
  assert.equal(result.status, 'RESERVE_REACHED');
  assert.equal(result.balances.totalGasWei, '900720025474099300000');
  assert.equal(result.balances.availableNativeWei, '0');
  assert.match(result.detail, /prepaid gas alone does not satisfy/);
  value.runtime.nativeBalance = '100000000000001'; result = view(value);
  assert.equal(result.status, 'ACTIVE'); assert.equal(result.balances.availableNativeWei, '1');
  value.runtime.nativeBalance = '0'; value.runtime.session.minimumNativeReserveWei = '0';
  value.mission.intent.minimumReserveWei = '0';
  assert.equal(view(value).status, 'RESERVE_REACHED');
});

test('active on-chain and mission reserves cannot be lowered by an unrelated saved draft', () => {
  const value = account(); value.runtime.nativeBalance = '200';
  value.runtime.session.minimumNativeReserveWei = '300'; value.mission.intent.minimumReserveWei = '100';
  const result = punkActivationStatus({ ...identity, account: value, strategy: { ...strategy, minimumReserveWei: '0' } });
  assert.equal(result.status, 'RESERVE_REACHED'); assert.equal(result.balances.reserveWei, '300');
  value.mission.intent.minimumReserveWei = '400'; assert.equal(view(value).balances.reserveWei, '400');
  delete value.runtime.session.minimumNativeReserveWei;
  assert.equal(view(value).status, 'GAS_UNVERIFIED');
});

test('invalid or missing balances never look empty and deposit-only funding remains accurately distinguished', () => {
  for (const invalid of [null, undefined, '-1', '1.5', '0x10', 1000, 'secret', (2n ** 256n).toString()]) {
    const value = account(); value.runtime.nativeBalance = invalid;
    const result = view(value); assert.equal(result.status, 'GAS_UNVERIFIED');
    assert.equal(step(result, 'FUND').action, 'CHECK'); assert.equal(result.balances, null);
  }
  const value = account(); value.runtime.sessionActive = false; value.runtime.nativeBalance = '0';
  value.runtime.entryPointDeposit = '500'; value.mission = null;
  const result = punkActivationStatus({ ...identity, account: value });
  assert.equal(result.status, 'NATIVE_GAS_REQUIRED'); assert.equal(result.balances.totalGasWei, '500');
});

test('funded inactive and transferred Punks request their current owner’s new permission', () => {
  const value = account(); value.runtime.sessionActive = false; value.mission.status = 'COMPLETED';
  let result = view(value);
  assert.equal(result.status, 'MISSION_REQUIRED'); assert.equal(step(result, 'MISSION').status, 'CURRENT');
  assert.match(result.detail, /last mission completed/);
  value.mission.intent.expectedOwner = other; result = view(value);
  assert.equal(result.status, 'MISSION_REQUIRED'); assert.match(result.detail, /previous owner/);
  value.readiness.setupAvailable = false; result = view(value);
  assert.equal(result.status, 'MISSION_BLOCKED'); assert.equal(step(result, 'MISSION').action, 'CHECK');
});

test('active permission with missing, stale-owner or expired mission must be checked, not replaced', () => {
  for (const mutate of [a => { a.mission = null; }, a => { a.mission.status = 'COMPLETED'; },
    a => { a.mission.intent.expectedOwner = other; }, a => { a.mission.account = other; },
    a => { a.mission.validUntil = new Date(now).toISOString(); }, a => { a.mission.validAfter = 'invalid'; }]) {
    const value = account(); mutate(value); const result = view(value);
    assert.equal(result.status, 'PERMISSION_UNVERIFIED'); assert.equal(step(result, 'MISSION').action, 'CHECK');
    assert.equal(step(result, 'MISSION').status, 'BLOCKED');
  }
});

test('pending receipts and reconciliation do not claim hunting or request duplicate authorization', () => {
  for (const state of ['SIGNED', 'SUBMITTED', 'PENDING_RECEIPT', 'RECONCILIATION_REQUIRED']) {
    const value = account(); value.mission.latestOperation = { state };
    const result = view(value); assert.equal(result.status, 'MINT_PENDING');
    assert.equal(step(result, 'WORKER').action, 'STATUS'); assert.notEqual(step(result, 'WORKER').status, 'COMPLETE');
    assert.match(result.detail, /do not restart/);
  }
});

test('worker disabled, failed checks, inconsistent readiness, future starts and stale checks stay honest', () => {
  const cases = [
    [a => { a.worker.enabled = false; }, 'WORKER_PAUSED'],
    [a => { a.readiness.automaticExecutionReady = false; }, 'NEEDS_ATTENTION'],
    [a => { a.readiness.blockers = ['SESSION_KEY_MISMATCH']; }, 'NEEDS_ATTENTION'],
    [a => { a.mission.lastFailedAt = new Date(now).toISOString(); }, 'NEEDS_ATTENTION'],
    [a => { a.mission.lastCheckedAt = new Date(now - 180001).toISOString(); }, 'CHECK_OVERDUE'],
    [a => { a.mission.lastCheckedAt = new Date(now + 1).toISOString(); }, 'CHECK_OVERDUE'],
    [a => { a.mission.lastCheckedAt = null; }, 'WAITING_FOR_FIRST_CHECK'],
    [a => { a.mission.validAfter = new Date(now + 60000).toISOString(); }, 'WAITING_FOR_START'],
  ];
  for (const [mutate, expected] of cases) {
    const value = account(); mutate(value); assert.equal(view(value).status, expected);
    assert.notEqual(step(view(value), 'WORKER').status, 'COMPLETE');
  }
});
