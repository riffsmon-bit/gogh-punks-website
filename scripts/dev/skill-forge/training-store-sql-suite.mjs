import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPostgresTrainingStore } from '../../../broker/src/v4/skill-forge/postgres-training-store.mjs';
import { durableTrainingTransaction, serializeDurableTrainingReview, trainingDigest } from '../../../broker/src/v4/skill-forge/durable-training-review.mjs';
import { durableReviewFixture, TRAINING_STORE_BINDING, TRAINING_STORE_OWNER, fixtureHash } from '../../../tests/fixtures/durable-training-review.mjs';

const migration = new URL('../../../netlify/database/migrations/20260910180000_stage_forge_training_intents.sql', import.meta.url);
const requestKey = () => randomBytes(32).toString('hex');
const scope = record => ({ intentId: record.intentId, owner: record.review.owner, tokenId: record.review.tokenId });

// Disposable SQL database only. No chain or wallet transaction is ever made here.
// The caller owns setup/teardown and reports whether the engine is native or WASM.
export async function runTrainingStoreSqlSuite({ pool, exec, query }) {
  await exec(await readFile(migration, 'utf8'));
  let assertions = 0;
  const check = (value, message) => { assert.ok(value, message); assertions++; };
  const rejects = async (call, pattern) => { await assert.rejects(call, pattern); assertions++; };
  const store = createPostgresTrainingStore({ pool, deployment: TRAINING_STORE_BINDING });
  const secondWorker = createPostgresTrainingStore({ pool, deployment: TRAINING_STORE_BINDING });
  let serial = 100;
  const fixture = () => {
    const next = durableReviewFixture({ tokenId: String(++serial) }); next.transaction.nonce = String(serial);
    return { requestKey: requestKey(), review: next };
  };
  const draft = fixture();
  const [one, replay] = await Promise.all([store.prepare(draft), secondWorker.prepare(draft)]);
  check(one.intentId === replay.intentId && one.revision === 0, 'same-key retry creates only one review');
  check(one.status === 'PREPARED' && one.walletAuthority === 'NONE' && !one.productionTrainingAuthorized,
    'storage returns no production authority');
  const changed = structuredClone(draft); changed.review.action.slot = 1;
  await rejects(() => secondWorker.prepare(changed), /IDEMPOTENCY_CONFLICT/);
  const otherOwner = `0x${'4'.repeat(40)}`;
  check(await store.get({ ...scope(one), owner: otherOwner }) === null, 'review contents are owner isolated');
  check(await store.get({ ...scope(one), tokenId: '999999' }) === null, 'review contents are token isolated');
  const newDeployment = { ...TRAINING_STORE_BINDING, progression: `0x${'5'.repeat(40)}`, deploymentHash: fixtureHash('f') };
  const nextStore = createPostgresTrainingStore({ pool, deployment: newDeployment });
  check(await nextStore.get(scope(one)) === null, 'different deployment cannot read private review');
  check(await nextStore.hasUnresolvedTraining(one.review.tokenId), 'different deployment still sees unresolved hold');
  const newOwnerReview = { ...draft.review, owner: otherOwner, ...newDeployment };
  await rejects(() => nextStore.prepare({ requestKey: requestKey(), review: newOwnerReview }), /duplicate key/);
  check((await store.get(scope(one))).revision === 0, 'failed takeover rolls back original record');
  const nonceCollision = fixture(); nonceCollision.review.transaction.nonce = one.review.transaction.nonce;
  await rejects(() => store.prepare(nonceCollision), /duplicate key/);

  const claims = await Promise.all([
    store.claim(scope(one), 0, one.reviewHash), secondWorker.claim(scope(one), 0, one.reviewHash),
  ]);
  check(claims.filter(x => x.claimed).length === 1, 'one committed wallet claim across worker instances');
  const requested = claims.find(x => x.claimed).record;
  check(requested.status === 'WALLET_REQUESTED', 'wallet reservation persists before response');
  await rejects(() => store.cancelPrepared(scope(one), requested.revision), /CONFLICT/);
  await rejects(() => store.claim(scope(one), requested.revision, 'e'.repeat(64)), /REVIEW_CHANGED/);
  const unknown = await store.markUnknown(scope(one), requested.revision);
  check(unknown.status === 'SUBMISSION_UNKNOWN' && unknown.holdsTraining, 'ambiguous broadcast remains blocking');
  check(!(await secondWorker.claim(scope(one), unknown.revision, one.reviewHash)).claimed,
    'restart cannot reopen ambiguous review');
  await rejects(() => store.cancelPrepared(scope(one), unknown.revision), /CONFLICT/);
  check(await nextStore.hasUnresolvedTraining(one.review.tokenId), 'seller ambiguity also blocks buyer');
  const observed = { ...durableTrainingTransaction(one.review), hash: fixtureHash('e') };
  await rejects(() => store.bindVerifiedTransaction(scope(one), unknown.revision, { ...observed, nonce: '999' }), /MISMATCH/);
  await rejects(() => store.bindVerifiedTransaction(scope(one), unknown.revision, { ...observed, value: '1' }), /MISMATCH/);
  const submitted = await secondWorker.bindVerifiedTransaction(scope(one), unknown.revision, observed);
  check(submitted.status === 'SUBMITTED' && submitted.transactionHash === observed.hash,
    'exact observed transaction recovers without sending');
  check((await store.bindVerifiedTransaction(scope(one), 0, observed)).revision === submitted.revision,
    'same hash replay creates no second event');
  await rejects(() => store.bindVerifiedTransaction(scope(one), submitted.revision, { ...observed, hash: fixtureHash('f') }), /ALREADY_BOUND/);

  const receipt = { status: 'INCLUDED_SUCCESS', transactionHash: observed.hash, blockNumber: '110',
    blockHash: fixtureHash('6'), checkedHeadNumber: '122', checkedHeadHash: fixtureHash('7'), evidenceHash: fixtureHash('8') };
  const included = await store.recordVerifiedObservation(scope(one), submitted.revision, receipt);
  check(included.status === 'INCLUDED_SUCCESS' && included.holdsTraining,
    'L2 inclusion does not masquerade as finality or release a hold');
  check((await store.recordVerifiedObservation(scope(one), 0, { ...receipt })).revision === included.revision,
    'JSONB key reordering does not break idempotent receipt retry');
  const removed = { ...receipt, status: 'REORGED', blockNumber: null, blockHash: null,
    checkedHeadNumber: '123', checkedHeadHash: fixtureHash('9') };
  const reorged = await store.recordVerifiedObservation(scope(one), included.revision, removed);
  check(reorged.status === 'REORGED' && reorged.holdsTraining && reorged.transactionHash === observed.hash,
    'reorg preserves hash and blocks another transaction');
  const reincluded = await secondWorker.recordVerifiedObservation(scope(one), reorged.revision,
    { ...receipt, blockNumber: '124', blockHash: fixtureHash('a'), checkedHeadNumber: '136' });
  check(reincluded.status === 'INCLUDED_SUCCESS', 'same transaction may be re-observed on the canonical chain');
  const history = await query('SELECT * FROM broker_forge_training_intent_events WHERE intent_id=$1 ORDER BY revision', [one.intentId]);
  check(history.rows.length === reincluded.revision + 1, 'exactly one audit event per revision');
  check(history.rows.some(x => x.status === 'REORGED') && history.rows.filter(x => x.status === 'INCLUDED_SUCCESS').length === 2,
    'receipt provenance survives reorg and reinclusion');

  const cancellable = await store.prepare(fixture());
  const cancelled = await store.cancelPrepared(scope(cancellable), 0);
  check(cancelled.status === 'CANCELLED' && !cancelled.holdsTraining, 'only unsent review can be cancelled');
  check(!(await store.hasUnresolvedTraining(cancellable.review.tokenId)), 'cancel releases token reservation');
  const replacement = await store.prepare({ requestKey: requestKey(), review: cancellable.review });
  check(replacement.intentId !== cancelled.intentId, 'new explicit review after cancellation');
  check(!(await store.claim(scope(cancelled), 0, cancelled.reviewHash)).claimed, 'cancelled review never resurrects');

  const past = fixture(); past.review.guard.deadline = String(Math.floor(Date.now() / 1000) - 1);
  past.review.anchor.timestamp = String(BigInt(past.review.guard.deadline) - 10n);
  await rejects(() => store.prepare(past), /check constraint/);
  const soon = fixture(); soon.review.guard.deadline = String(Math.floor(Date.now() / 1000) + 2);
  const expiring = await store.prepare(soon);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(soon.review.guard.deadline) * 1000 - Date.now()) + 50));
  const expired = await store.claim(scope(expiring), 0, expiring.reviewHash);
  check(!expired.claimed && expired.record.status === 'EXPIRED', 'database time expires an unsent review');
  check(!(await store.hasUnresolvedTraining(expiring.review.tokenId)), 'unsent expiry releases token hold');
  const expiringReplay = await store.prepare(soon);
  check(expiringReplay.status === 'EXPIRED' && expiringReplay.expiresAt === expiring.expiresAt,
    'idempotent retry never extends expiry');

  // Corruption / bypass attempts go directly to SQL to exercise database defenses.
  await rejects(() => query('UPDATE broker_forge_training_intents SET review_json=$2, revision=revision+1 WHERE intent_id=$1',
    [replacement.intentId, '{}']), /IMMUTABLE/);
  await rejects(() => query("UPDATE broker_forge_training_intents SET status='PREPARED', revision=revision+1 WHERE intent_id=$1", [one.intentId]), /INVALID_TRANSITION/);
  await rejects(() => query('UPDATE broker_forge_training_intents SET transaction_hash=$2, revision=revision+1 WHERE intent_id=$1',
    [one.intentId, fixtureHash('f')]), /IMMUTABLE/);
  await rejects(() => query("UPDATE broker_forge_training_intents SET status='CANCELLED', revision=revision+2 WHERE intent_id=$1", [replacement.intentId]), /IMMUTABLE/);
  const protectedTables = await query(`SELECT relname, relrowsecurity, relacl FROM pg_class
    WHERE relname IN ('broker_forge_training_intents','broker_forge_training_intent_events') AND relnamespace=current_schema()::regnamespace`);
  check(protectedTables.rows.length === 2 && protectedTables.rows.every(x => x.relrowsecurity), 'both tables enable RLS');
  const publicGrants = await query(`SELECT p.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) p
    WHERE c.relname IN ('broker_forge_training_intents','broker_forge_training_intent_events')
    AND c.relnamespace=current_schema()::regnamespace AND p.grantee=0`);
  check(publicGrants.rows.length === 0, 'PUBLIC has no table privileges');
  const integrity = await query('SELECT review_json,review_hash FROM broker_forge_training_intents WHERE intent_id=$1', [one.intentId]);
  check(integrity.rows[0].review_hash === trainingDigest(serializeDurableTrainingReview(one.review)),
    'PostgreSQL SHA-256 agrees with canonical review hash');
  check(TRAINING_STORE_OWNER === one.review.owner, 'fixture authority unchanged');
  return { assertions, productionDatabaseAccessed: false, walletTransactions: 0,
    creditsGranted: 0, productionTrainingAuthorized: false, productionBurnAuthorized: false };
}
