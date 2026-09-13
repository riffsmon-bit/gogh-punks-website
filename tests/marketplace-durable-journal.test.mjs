import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMarketplaceCoordinator, assertMarketplaceOriginalTransaction } from '../broker/src/v4/marketplace/durable-coordinator.mjs';
import { currentMarketplaceRelease } from '../broker/src/v4/marketplace/durable-release.mjs';
import { marketplaceInput, marketplaceTransactionCommitment } from '../broker/src/v4/marketplace/durable-journal.mjs';
import { marketplaceFixture, memoryMarketplaceStore, cas, address, hash } from './fixtures/marketplace-durable.mjs';

function setup(options = {}) {
  const f = marketplaceFixture(), store = memoryMarketplaceStore(); let clock = Date.now(), builds = 0, claims = 0, reconciles = 0;
  const dependencies = { store, release: () => f.release, deps: { client: f.client }, now: () => clock,
    reviewBuilder: async () => { builds++; return structuredClone(f.review); },
    claimValidator: async () => { claims++; },
    receiptReconciler: async (review, request) => { reconciles++;
      assert.deepEqual(review.transaction, f.review.transaction); assert.equal(request.transactionHash, f.transactionHash);
      assert.equal(request.minConfirmations, 12); return structuredClone(f.receipt); }, ...options };
  const coordinator = createMarketplaceCoordinator(dependencies);
  return { ...f, f, store, coordinator, dependencies, expire: () => { clock = f.review.expiresAt + 1; },
    counts: () => ({ builds, claims, reconciles }), prepare: () => coordinator.prepare({ owner: f.owner, punkId: f.punkId, input: f.input }) };
}

test('production release is blocked before RPC, journal, policy, or transaction work', async () => {
  const coordinator = createMarketplaceCoordinator({ deps: new Proxy({}, { get() { throw Error('NO_DEPENDENCY_READ'); } }) });
  const f = marketplaceFixture();
  for (const result of [await coordinator.get(f), await coordinator.prepare(f)]) {
    assert.equal(result.availability, 'RELEASE_BLOCKED'); assert.equal(result.transaction, null);
    assert.equal(result.walletClaimed, false); assert.equal(result.owner, f.owner); assert.equal(result.punkId, '93');
    assert.equal(result.chainId, 4663); assert.ok(result.blockers.includes('PURCHASE_POSTCONDITION_GUARD_NOT_DEPLOYED'));
  }
  assert.equal(currentMarketplaceRelease().purchaseGuardDeployment, null);
});

test('persisted review and commitment precede the single winning concurrent claim', async () => {
  const f = setup(), prepared = await f.prepare();
  assert.equal(prepared.transaction, null); assert.equal(prepared.entry.review.transaction, null);
  assert.deepEqual(prepared.entry.review.transactionCommitment, marketplaceTransactionCommitment(f.review.transaction));
  assert.match(prepared.entry.reviewHash, /^[0-9a-f]{64}$/);
  const results = await Promise.all(Array.from({ length: 12 }, () => f.coordinator.claim(cas(f, prepared))));
  assert.equal(results.filter(result => result.walletClaimed).length, 1);
  assert.equal(results.filter(result => result.transaction).length, 1);
  const current = await f.coordinator.get(f);
  assert.equal(current.entry.status, 'WALLET_REQUESTED'); assert.equal(current.entry.revision, 1);
  assert.equal(current.transaction, null); assert.equal((await f.prepare()).transaction, null);
});

test('lost commit acknowledgement cannot return or repeat the wallet request', async () => {
  const f = setup(), prepared = await f.prepare(), write = f.store.update;
  f.store.update = async (...args) => { await write(...args); throw Error('COMMIT_ACK_LOST'); };
  await assert.rejects(() => f.coordinator.claim(cas(f, prepared)), /COMMIT_ACK_LOST/);
  f.store.update = write;
  const retry = await f.coordinator.claim(cas(f, prepared));
  assert.equal(retry.walletClaimed, false); assert.equal(retry.transaction, null); assert.equal(retry.entry.status, 'WALLET_REQUESTED');
});

test('durable request key retains original bytes on retries and rejects input replacement', async () => {
  const f = setup();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.prepare()));
  assert.equal(new Set(results.map(result => result.entry.reviewHash)).size, 1); assert.equal(f.store.rows.size, 1);
  const retry = await f.prepare(); assert.equal(retry.entry.intentId, results[0].entry.intentId);
  const changed = structuredClone(f.input); changed.budget.maxTotalPriceWei = '200';
  await assert.rejects(() => f.coordinator.prepare({ ...f, input: changed }), /IDEMPOTENCY_CONFLICT/);
  changed.requestId = randomUUID();
  await assert.rejects(() => f.coordinator.prepare({ ...f, input: changed }), /UNRESOLVED_PURCHASE/);
});

test('owner/Punk scope, stale revision and wrong review digest never expose calldata', async () => {
  const f = setup(), prepared = await f.prepare();
  for (const changed of [{ owner: address('9') }, { punkId: '94' }]) {
    await assert.rejects(() => f.coordinator.claim({ ...cas(f, prepared), ...changed }), /NOT_FOUND/);
    assert.equal((await f.coordinator.get({ ...f, ...changed, intentId: prepared.entry.intentId })).entry, null);
  }
  for (const changed of [{ revision: 4 }, { reviewHash: 'e'.repeat(64) }]) {
    const result = await f.coordinator.claim({ ...cas(f, prepared), ...changed });
    assert.equal(result.transaction, null); assert.equal(result.entry.status, 'PREPARED');
  }
});

test('only provably unclaimed purchases cancel; unknown wallet responses remain reserved after expiry', async () => {
  const f = setup(), prepared = await f.prepare(); f.expire();
  await assert.rejects(() => f.coordinator.claim(cas(f, prepared)), /EXPIRED/);
  assert.equal((await f.coordinator.cancel(cas(f, prepared))).entry.status, 'CANCELLED');
  const g = setup(), p = await g.prepare(), claimed = await g.coordinator.claim(cas(g, p)); g.expire();
  const declined = await g.coordinator.decline(cas(g, claimed));
  assert.equal(declined.entry.status, 'WALLET_REQUESTED'); assert.equal(declined.entry.holdsPurchase, true);
  assert.equal(declined.entry.reason, 'WALLET_DECLINED_UNVERIFIED');
  await assert.rejects(() => g.coordinator.cancel(cas(g, declined)), /RESERVED/);
  const recovered = await g.coordinator.recover(cas(g, declined));
  assert.ok(recovered.blockers.includes('MARKETPLACE_ORIGINAL_HASH_REQUIRED')); assert.equal(recovered.transaction, null);
  assert.equal((await g.coordinator.claim(cas(g, declined))).walletClaimed, false);
});

test('claim/cancel race cannot release an already claimed purchase', async () => {
  for (let i = 0; i < 5; i++) {
    const f = setup(), prepared = await f.prepare();
    const results = await Promise.allSettled([f.coordinator.claim(cas(f, prepared)), f.coordinator.cancel(cas(f, prepared))]);
    const sent = results.some(result => result.status === 'fulfilled' && result.value.walletClaimed);
    assert.equal((await f.coordinator.get(f)).entry.status, sent ? 'WALLET_REQUESTED' : 'CANCELLED');
  }
});

test('fresh verification failure and release change do not claim the wallet', async () => {
  const f = setup({ claimValidator: async () => { throw Error('OWNER_OR_SKILLS_CHANGED'); } }), prepared = await f.prepare();
  await assert.rejects(() => f.coordinator.claim(cas(f, prepared)), /OWNER_OR_SKILLS_CHANGED/);
  assert.equal((await f.coordinator.get(f)).entry.status, 'PREPARED');
  const g = setup(), p = await g.prepare();
  g.f.release = { ...g.release, evidence: { ...g.release.evidence, policySkills: 'e'.repeat(64) } };
  await assert.rejects(() => g.coordinator.claim(cas(g, p)), /RELEASE_CHANGED/);
});

test('client-level CCIP must be explicitly disabled for prepare, claim, and recovery', async () => {
  for (const setting of [undefined, true]) {
    const f = setup(); f.client.ccipRead = setting;
    await assert.rejects(() => f.prepare(), /FIXED_RPC_REQUIRED/);
    f.client.ccipRead = false; const p = await f.prepare(); f.client.ccipRead = setting;
    await assert.rejects(() => f.coordinator.claim(cas(f, p)), /FIXED_RPC_REQUIRED/);
    f.client.ccipRead = false; const c = await f.coordinator.claim(cas(f, p)); f.client.ccipRead = setting;
    await assert.rejects(() => f.coordinator.recover({ ...cas(f, c), transactionHash: f.transactionHash }), /FIXED_RPC_REQUIRED/);
  }
});

test('hash hints must be observed and match exact original transaction before durable binding', async () => {
  const f = setup(), p = await f.prepare(), c = await f.coordinator.claim(cas(f, p));
  f.client.getTransaction = async () => { throw Object.assign(Error('not found'), { name: 'TransactionNotFoundError' }); };
  const missing = await f.coordinator.recover({ ...cas(f, c), transactionHash: f.transactionHash });
  assert.equal(missing.entry.reportedHash, null); assert.equal(missing.entry.status, 'WALLET_REQUESTED');
  f.client.getTransaction = async () => ({ ...f.actual, input: '0xdeadbeef' });
  await assert.rejects(() => f.coordinator.recover({ ...cas(f, missing), transactionHash: f.transactionHash }), /ORIGINAL_TRANSACTION_MISMATCH/);
  assert.equal((await f.coordinator.get(f)).entry.reportedHash, null);
});

test('recovery after process restart, release pause, expiry and ownership change uses original bytes', async () => {
  const f = setup(), p = await f.prepare(), c = await f.coordinator.claim(cas(f, p)); f.expire();
  f.f.release = { ...f.release, status: 'PAUSED', blockers: ['MARKETPLACE_RELEASE_PAUSED'] };
  const restarted = createMarketplaceCoordinator({ ...f.dependencies, reviewBuilder: async () => { throw Error('NO_REBUILD'); },
    claimValidator: async () => { throw Error('NO_OWNER_CHECK_FOR_RECOVERY'); } });
  const results = await Promise.all(Array.from({ length: 8 }, () => restarted.recover({ ...cas(f, c), transactionHash: f.transactionHash })));
  const completed = await restarted.get(f);
  assert.equal(completed.entry.status, 'COMPLETED'); assert.equal(completed.entry.revision, 3);
  assert.equal(completed.entry.reportedHash, f.transactionHash); assert.equal(completed.entry.holdsPurchase, false);
  assert.ok(results.every(result => result.transaction === null));
  assert.equal((await restarted.recover({ ...cas(f, completed), transactionHash: f.transactionHash })).entry.revision, 3);
  await assert.rejects(() => restarted.recover({ ...cas(f, completed), transactionHash: hash('e') }), /HASH_IMMUTABLE/);
  await assert.rejects(() => restarted.recover({ ...cas(f, completed), owner: address('9') }), /NOT_FOUND/);
});

test('receipt failure or pending finality retains observed original hash and holds the purchase', async () => {
  for (const fail of [true, false]) {
    const f = setup({ receiptReconciler: async () => { if (fail) throw Error('RPC_TIMEOUT');
      return { status: 'PENDING_FINALITY', transactionHash: hash('a') }; } });
    const p = await f.prepare(), c = await f.coordinator.claim(cas(f, p));
    const result = await f.coordinator.recover({ ...cas(f, c), transactionHash: f.transactionHash });
    assert.equal(result.entry.status, 'WALLET_REQUESTED'); assert.equal(result.entry.reportedHash, f.transactionHash);
    assert.equal(result.entry.revision, 2); assert.equal(result.entry.receipt, null); assert.equal(result.transaction, null);
  }
});

for (const [name, mutate] of [
  ['wrong sender', tx => { tx.from = address('8'); }], ['wrong chain', tx => { tx.chainId = 1; }],
  ['wrong nonce', tx => { tx.nonce++; }], ['value', tx => { tx.value = 1n; }],
  ['fee bump', tx => { tx.gasPrice = 11n; }], ['gas bump', tx => { tx.gas++; }],
  ['eip1559', tx => { tx.type = 'eip1559'; }], ['authorization', tx => { tx.authorizationList = [{}]; }],
  ['hidden cap', tx => { tx.maxFeePerGas = 1n; }],
]) test(`original transaction rejects ${name}`, async () => {
  const f = marketplaceFixture(); mutate(f.actual);
  await assert.rejects(() => assertMarketplaceOriginalTransaction(f.review, f.client, f.transactionHash), /ORIGINAL_TRANSACTION_MISMATCH/);
});

test('narrow input rejects authority injection, imprecise values, duplicate listings, and getters', () => {
  const f = marketplaceFixture();
  for (const field of ['owner', 'rpcUrl', 'review', 'policyEvidence', 'purchaseGuardDeployment', 'calldata', 'walletRole']) {
    assert.throws(() => marketplaceInput({ ...f.input, [field]: 'attacker' }));
  }
  const duplicate = structuredClone(f.input); duplicate.selection.orderHashes.push(duplicate.selection.orderHashes[0]);
  assert.throws(() => marketplaceInput(duplicate));
  assert.throws(() => marketplaceInput({ ...f.input, budget: { ...f.input.budget, maxTotalPriceWei: 100 } }));
  assert.throws(() => marketplaceInput({ ...f.input, action: 'CREATE_WETH_BID' }));
  let invoked = false;
  assert.throws(() => marketplaceInput({ ...f.input, get action() { invoked = true; return 'BUY_LISTINGS'; } }));
  assert.equal(invoked, false);
});
