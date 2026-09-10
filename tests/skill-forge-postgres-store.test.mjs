import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresTrainingStore } from '../broker/src/v4/skill-forge/postgres-training-store.mjs';
import { serializeDurableTrainingReview, trainingDigest, durableTrainingTransaction } from '../broker/src/v4/skill-forge/durable-training-review.mjs';
import { durableReviewFixture, TRAINING_STORE_BINDING, fixtureHash } from './fixtures/durable-training-review.mjs';

// Protocol/failure-injection mock, NOT a SQL engine. The separate SQL suite executes
// the migration, triggers and constraints using PostgreSQL (WASM or native).
function fixture({ commitAcknowledgementLost = false, queryFailure = null, rollbackFailure = false } = {}) {
  const review = durableReviewFixture();
  const serialized = serializeDurableTrainingReview(review);
  let row = { intent_id: '11111111-1111-4111-8111-111111111111', request_key: 'a'.repeat(64),
    chain_id: review.chainId, collection_address: review.collection, progression_address: review.progression,
    deployment_hash: review.deploymentHash, owner_address: review.owner, token_text: review.tokenId,
    nonce_text: review.transaction.nonce, review_json: serialized, review_hash: trainingDigest(serialized),
    status: 'PREPARED', revision: 0, transaction_hash: null, observation: null, expired: false,
    expires_at: new Date(Number(review.guard.deadline) * 1000) };
  const calls = []; let released = 0; let committed = false; let baseline;
  const pool = { async connect() { return {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql === 'BEGIN') { baseline = structuredClone(row); committed = false; }
      if (sql === 'COMMIT') {
        committed = true;
        if (commitAcknowledgementLost) { commitAcknowledgementLost = false; throw Error('COMMIT_ACK_LOST'); }
      }
      if (sql === 'ROLLBACK') {
        if (!committed) row = baseline;
        if (rollbackFailure) throw Error('ROLLBACK_FAILED');
      }
      if (sql.startsWith('SELECT *, ')) {
        if (queryFailure) throw queryFailure;
        assert.equal(values[1], TRAINING_STORE_BINDING.chainId);
        assert.equal(values[2], TRAINING_STORE_BINDING.collection);
        assert.equal(values[3], TRAINING_STORE_BINDING.progression);
        assert.equal(values[4], TRAINING_STORE_BINDING.deploymentHash);
        if (values[5] !== row.owner_address || values[6] !== row.token_text) return { rows: [] };
        return { rows: [structuredClone(row)] };
      }
      if (sql.startsWith('UPDATE broker_forge_training_intents')) {
        assert.equal(values[0], row.intent_id); assert.equal(values[1], row.revision);
        row = { ...row, revision: row.revision + 1, status: values[2], transaction_hash: values[3],
          observation: values[4] ? JSON.parse(values[4]) : null };
        return { rows: [structuredClone(row)] };
      }
      return { rows: [] };
    }, release() { released++; },
  }; } };
  const store = createPostgresTrainingStore({ pool, deployment: TRAINING_STORE_BINDING });
  const scope = { intentId: row.intent_id, owner: review.owner, tokenId: review.tokenId };
  return { store, pool, scope, review, calls, get row() { return row; }, get released() { return released; }, get committed() { return committed; } };
}

test('claim only returns after a committed durable wallet reservation', async () => {
  const f = fixture();
  const result = await f.store.claim(f.scope, 0, f.row.review_hash);
  assert.equal(result.claimed, true); assert.equal(f.committed, true); assert.equal(f.released, 1);
  assert.equal(result.record.status, 'WALLET_REQUESTED'); assert.equal(result.record.revision, 1);
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
  assert.match(f.calls.find(c => c.sql.startsWith('SELECT *,')).sql, /FOR UPDATE$/);
  assert.equal((await f.store.claim(f.scope, 0, f.row.review_hash)).claimed, false);
  assert.equal(f.calls.filter(c => c.sql.startsWith('UPDATE')).length, 1);
});

test('lost COMMIT acknowledgement does not return a claim or permit a second request', async () => {
  const f = fixture({ commitAcknowledgementLost: true });
  await assert.rejects(() => f.store.claim(f.scope, 0, f.row.review_hash), /COMMIT_ACK_LOST/);
  assert.equal(f.row.status, 'WALLET_REQUESTED');
  const retry = await f.store.claim(f.scope, 0, f.row.review_hash);
  assert.equal(retry.claimed, false); assert.equal(retry.record.holdsTraining, true);
  assert.equal(f.calls.filter(c => c.sql.startsWith('UPDATE')).length, 1);
});

test('database and rollback failures fail closed and release the connection', async () => {
  const failure = Error('DATABASE_OFFLINE');
  const f = fixture({ queryFailure: failure, rollbackFailure: true });
  await assert.rejects(() => f.store.claim(f.scope, 0, f.row.review_hash), error => error === failure);
  assert.equal(f.released, 1); assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(f.calls.filter(c => c.sql.startsWith('UPDATE')).length, 0);
});

test('database time wins over a client clock and expired reviews are not claimed', async () => {
  const f = fixture(); f.row.expired = true;
  const result = await f.store.claim(f.scope, 0, f.row.review_hash);
  assert.equal(result.claimed, false); assert.equal(result.record.status, 'EXPIRED');
  assert.equal(result.record.holdsTraining, false);
});

test('owner/token isolation and deployment binding are present on every read', async () => {
  const f = fixture();
  assert.equal(await f.store.get({ ...f.scope, owner: `0x${'4'.repeat(40)}` }), null);
  assert.equal(await f.store.get({ ...f.scope, tokenId: '94' }), null);
  await assert.rejects(() => f.store.claim({ ...f.scope, owner: `0x${'4'.repeat(40)}` }, 0, f.row.review_hash), /NOT_FOUND/);
  const invalid = { ...f.scope, intentId: "' OR TRUE; --" };
  const before = f.calls.filter(c => c.sql.startsWith('SELECT')).length;
  await assert.rejects(() => f.store.get(invalid), /INVALID_TRAINING_STORE_INPUT/);
  assert.equal(f.calls.filter(c => c.sql.startsWith('SELECT')).length, before);
});

test('corrupted review bytes, identity and phase metadata are rejected on load', async () => {
  for (const change of [
    row => { row.review_hash = 'a'.repeat(64); },
    row => { row.token_text = '94'; },
    row => { row.nonce_text = '9'; },
    row => { row.deployment_hash = fixtureHash('e'); },
    row => { row.status = 'READY'; },
    row => { row.status = 'SUBMITTED'; },
    row => { row.transaction_hash = fixtureHash('e'); },
    row => { row.observation = {}; },
    row => { row.expires_at = new Date(0); },
  ]) {
    const f = fixture(); change(f.row);
    f.scope.tokenId = f.row.token_text; // Address the damaged indexed row, not a different token.
    await assert.rejects(() => f.store.get(f.scope), /CORRUPT/);
  }
});

test('stale revision and incorrect review hash cannot claim or rewrite an intent', async () => {
  const f = fixture();
  assert.equal((await f.store.claim(f.scope, 2, f.row.review_hash)).claimed, false);
  await assert.rejects(() => f.store.claim(f.scope, 0, 'e'.repeat(64)), /REVIEW_CHANGED/);
  assert.equal(f.calls.filter(c => c.sql.startsWith('UPDATE')).length, 0);
});

test('wallet ambiguity cannot be cancelled, expired by the client or reclaimed', async () => {
  const f = fixture();
  await f.store.claim(f.scope, 0, f.row.review_hash);
  const unknown = await f.store.markUnknown(f.scope, 1);
  assert.equal(unknown.status, 'SUBMISSION_UNKNOWN');
  f.row.expired = true;
  assert.equal((await f.store.claim(f.scope, 2, f.row.review_hash)).claimed, false);
  await assert.rejects(() => f.store.cancelPrepared(f.scope, 2), /CONFLICT/);
  assert.equal((await f.store.markUnknown(f.scope, 2)).revision, 2);
});

test('observed transactions are copied without invoking accessors', async () => {
  const f = fixture(); let invoked = false;
  const observed = { ...durableTrainingTransaction(f.review), hash: fixtureHash('e') };
  Object.defineProperty(observed, 'hash', { enumerable: true, get() { invoked = true; return fixtureHash('e'); } });
  await assert.rejects(() => f.store.bindVerifiedTransaction(f.scope, 0, observed), /INVALID/);
  assert.equal(invoked, false); assert.equal(f.calls.length, 0);
});

test('inclusion and reorg never grant credits or clear unresolved training', async () => {
  const f = fixture(); await f.store.claim(f.scope, 0, f.row.review_hash);
  const observed = { ...durableTrainingTransaction(f.review), hash: fixtureHash('e') };
  const bound = await f.store.bindVerifiedTransaction(f.scope, 1, observed);
  const evidence = { status: 'INCLUDED_REVERT', transactionHash: observed.hash, blockNumber: '111',
    blockHash: fixtureHash('b'), checkedHeadNumber: '122', checkedHeadHash: fixtureHash('c'), evidenceHash: fixtureHash('d') };
  const reverted = await f.store.recordVerifiedObservation(f.scope, bound.revision, evidence);
  assert.equal(reverted.holdsTraining, true); assert.equal(reverted.walletAuthority, 'NONE');
  const reorg = await f.store.recordVerifiedObservation(f.scope, reverted.revision,
    { ...evidence, status: 'REORGED', blockNumber: null, blockHash: null });
  assert.equal(reorg.holdsTraining, true);
  assert.equal(Object.hasOwn(reorg, 'credits'), false);
  assert.equal(f.calls.some(c => /trainingCredits|learnedSkills|training_credits/.test(c.sql)), false);
});
