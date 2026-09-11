import { randomUUID } from 'node:crypto';
import { serializeDurableTrainingReview, trainingDigest, assertDurableTrainingTransaction } from './durable-training-review.mjs';

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RELEASED = ['CANCELLED', 'EXPIRED'];
const STATES = ['PREPARED', 'WALLET_REQUESTED', 'SUBMISSION_UNKNOWN', 'SUBMITTED',
  'INCLUDED_SUCCESS', 'INCLUDED_REVERT', 'REORGED', ...RELEASED];
const COLUMN_LIST = `*, punk_token_id::text AS token_text, owner_nonce::text AS nonce_text,
  expires_at <= clock_timestamp() AS expired`;

function valid(condition, message = 'INVALID_TRAINING_STORE_INPUT') { if (!condition) throw Error(message); }
function canonicalToken(value) {
  valid(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n);
}
function ownerScope(owner, tokenId) {
  valid(typeof owner === 'string' && ADDRESS.test(owner)); canonicalToken(tokenId);
}
function revision(value) { valid(Number.isSafeInteger(value) && value >= 0 && value < 2_147_483_647); }
function observation(value, transactionHash) {
  const keys = ['status', 'transactionHash', 'blockNumber', 'blockHash', 'checkedHeadNumber', 'checkedHeadHash', 'evidenceHash'];
  valid(value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value')));
  valid(['INCLUDED_SUCCESS', 'INCLUDED_REVERT', 'REORGED'].includes(value.status)
    && value.transactionHash === transactionHash && typeof transactionHash === 'string' && HASH.test(transactionHash)
    && HASH.test(value.checkedHeadHash) && HASH.test(value.evidenceHash));
  canonicalToken(value.checkedHeadNumber);
  if (value.status === 'REORGED') valid(value.blockNumber === null && value.blockHash === null);
  else {
    canonicalToken(value.blockNumber);
    valid(HASH.test(value.blockHash) && BigInt(value.blockNumber) <= BigInt(value.checkedHeadNumber));
  }
  return JSON.stringify(value);
}

// SERVER-INTERNAL storage, deliberately not imported by a production function.
// No RPC, signer, auth cookie, environment lookup or authority switch lives here.
// Callers must verify current owner + transfer continuity for every owner request.
// The future trusted receipt worker may reconcile a historic owner's pending record,
// but must never return that private record to a buyer or solicit a second signature.
export function createPostgresTrainingStore({ pool, deployment }) {
  valid(pool && typeof pool.connect === 'function' && deployment
    && Reflect.ownKeys(deployment).sort().join(',') === 'chainId,collection,deploymentHash,progression'
    && [31337, 4663].includes(deployment.chainId) && ADDRESS.test(deployment.collection)
    && ADDRESS.test(deployment.progression) && HASH.test(deployment.deploymentHash));
  const binding = Object.freeze({ ...deployment });
  const matchesBinding = review => Object.entries(binding).every(([key, value]) => review[key] === value);

  function record(row) {
    if (!row) return null;
    valid(typeof row.review_json === 'string' && row.review_json.length <= 16_384, 'TRAINING_STORE_CORRUPT');
    const review = JSON.parse(row.review_json);
    valid(serializeDurableTrainingReview(review) === row.review_json
      && trainingDigest(row.review_json) === row.review_hash && matchesBinding(review)
      && review.owner === row.owner_address && review.tokenId === row.token_text
      && review.chainId === row.chain_id && review.collection === row.collection_address
      && review.progression === row.progression_address && review.deploymentHash === row.deployment_hash
      && review.transaction.nonce === row.nonce_text && UUID.test(row.intent_id)
      && Number.isInteger(row.revision) && row.revision >= 0 && STATES.includes(row.status)
      && new Date(row.expires_at).getTime() === Number(review.guard.deadline) * 1000, 'TRAINING_STORE_CORRUPT');
    const hasHash = ['SUBMITTED', 'INCLUDED_SUCCESS', 'INCLUDED_REVERT', 'REORGED'].includes(row.status);
    valid(hasHash ? typeof row.transaction_hash === 'string' && HASH.test(row.transaction_hash)
      : row.transaction_hash === null, 'TRAINING_STORE_CORRUPT');
    if (['INCLUDED_SUCCESS', 'INCLUDED_REVERT', 'REORGED'].includes(row.status)) {
      observation(row.observation, row.transaction_hash);
      valid(row.observation.status === row.status, 'TRAINING_STORE_CORRUPT');
    } else valid(row.observation === null, 'TRAINING_STORE_CORRUPT');
    return Object.freeze({ intentId: row.intent_id, requestKey: row.request_key,
      status: row.status, revision: row.revision, reviewHash: row.review_hash, review,
      transactionHash: row.transaction_hash, observation: row.observation,
      expiresAt: new Date(row.expires_at).toISOString(), expired: row.expired === true,
      holdsTraining: !RELEASED.includes(row.status), walletAuthority: 'NONE',
      productionTrainingAuthorized: false, productionBurnAuthorized: false });
  }
  async function transaction(callback) {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      const result = await callback(client);
      await client.query('COMMIT'); committed = true;
      return result; // No result (especially a claim) escapes before COMMIT succeeds.
    } catch (error) {
      if (!committed) { try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ } }
      throw error;
    } finally { client.release(); }
  }
  async function select(client, { intentId, owner, tokenId }, lock = false) {
    valid(typeof intentId === 'string' && UUID.test(intentId)); ownerScope(owner, tokenId);
    const result = await client.query(`SELECT ${COLUMN_LIST} FROM broker_forge_training_intents
      WHERE intent_id=$1 AND chain_id=$2 AND collection_address=$3 AND progression_address=$4
        AND deployment_hash=$5 AND owner_address=$6 AND punk_token_id=$7::numeric${lock ? ' FOR UPDATE' : ''}`,
    [intentId, binding.chainId, binding.collection, binding.progression, binding.deploymentHash, owner, tokenId]);
    return record(result.rows[0]);
  }
  async function write(client, current, status, transactionHash = current.transactionHash, evidence = null) {
    const result = await client.query(`UPDATE broker_forge_training_intents
      SET status=$3, revision=revision+1, transaction_hash=$4, observation=$5::jsonb
      WHERE intent_id=$1 AND revision=$2 RETURNING ${COLUMN_LIST}`,
    [current.intentId, current.revision, status, transactionHash, evidence]);
    valid(result.rows.length === 1, 'TRAINING_STORE_CONFLICT');
    return record(result.rows[0]);
  }
  async function prepare({ requestKey, review }) {
    valid(typeof requestKey === 'string' && /^[0-9a-f]{64}$/.test(requestKey));
    const serialized = serializeDurableTrainingReview(review);
    // Copy before the first await so a caller cannot mutate the review mid-transaction.
    const fixed = JSON.parse(serialized);
    valid(matchesBinding(fixed), 'TRAINING_DEPLOYMENT_MISMATCH');
    return transaction(async client => {
      // Same idempotency key serializes across processes. Unique partial indexes are
      // the final arbiter for different keys competing for a token or wallet nonce.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`forge:${binding.chainId}:${fixed.owner}:${requestKey}`]);
      const replay = await client.query(`SELECT ${COLUMN_LIST} FROM broker_forge_training_intents
        WHERE chain_id=$1 AND owner_address=$2 AND request_key=$3`, [binding.chainId, fixed.owner, requestKey]);
      if (replay.rows[0]) {
        valid(replay.rows[0].review_hash === trainingDigest(serialized), 'TRAINING_IDEMPOTENCY_CONFLICT');
        return record(replay.rows[0]); // Never renew a deadline on retry.
      }
      // ONLY reviews that have never reached the wallet may expire automatically.
      await client.query(`UPDATE broker_forge_training_intents SET status='EXPIRED', revision=revision+1
        WHERE chain_id=$1 AND status='PREPARED' AND expires_at<=clock_timestamp()
          AND ((collection_address=$2 AND punk_token_id=$3::numeric) OR (owner_address=$4 AND owner_nonce=$5::numeric))`,
      [binding.chainId, fixed.collection, fixed.tokenId, fixed.owner, fixed.transaction.nonce]);
      const inserted = await client.query(`INSERT INTO broker_forge_training_intents
        (intent_id,request_key,chain_id,collection_address,progression_address,deployment_hash,
         owner_address,punk_token_id,owner_nonce,review_json,review_hash,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10,$11,to_timestamp($12::numeric))
        RETURNING ${COLUMN_LIST}`,
      [randomUUID(), requestKey, binding.chainId, fixed.collection, fixed.progression, fixed.deploymentHash,
        fixed.owner, fixed.tokenId, fixed.transaction.nonce, serialized, trainingDigest(serialized), fixed.guard.deadline]);
      return record(inserted.rows[0]);
    });
  }
  const get = scope => transaction(client => select(client, scope));
  async function claim(scope, expectedRevision, expectedReviewHash) {
    revision(expectedRevision); valid(/^[0-9a-f]{64}$/.test(expectedReviewHash));
    return transaction(async client => {
      const current = await select(client, scope, true);
      valid(current, 'TRAINING_INTENT_NOT_FOUND');
      valid(current.reviewHash === expectedReviewHash, 'TRAINING_REVIEW_CHANGED');
      if (current.status !== 'PREPARED' || current.revision !== expectedRevision) return { claimed: false, record: current };
      if (current.expired) return { claimed: false, record: await write(client, current, 'EXPIRED') };
      return { claimed: true, record: await write(client, current, 'WALLET_REQUESTED') };
    });
  }
  async function markUnknown(scope, expectedRevision) {
    revision(expectedRevision);
    return transaction(async client => {
      const current = await select(client, scope, true);
      valid(current, 'TRAINING_INTENT_NOT_FOUND');
      if (current.status === 'SUBMISSION_UNKNOWN') return current;
      valid(current.status === 'WALLET_REQUESTED' && current.revision === expectedRevision, 'TRAINING_STORE_CONFLICT');
      // A wallet rejection/error is not proof that another tab did not submit.
      return write(client, current, 'SUBMISSION_UNKNOWN');
    });
  }
  async function cancelPrepared(scope, expectedRevision) {
    revision(expectedRevision);
    return transaction(async client => {
      const current = await select(client, scope, true);
      valid(current, 'TRAINING_INTENT_NOT_FOUND');
      if (RELEASED.includes(current.status)) return current;
      valid(current.status === 'PREPARED' && current.revision === expectedRevision, 'TRAINING_STORE_CONFLICT');
      return write(client, current, current.expired ? 'EXPIRED' : 'CANCELLED');
    });
  }
  async function bindVerifiedTransaction(scope, expectedRevision, observedTransaction) {
    revision(expectedRevision);
    // Snapshot only primitive data properties; never invoke RPC-object accessors.
    valid(observedTransaction && Object.getPrototypeOf(observedTransaction) === Object.prototype);
    const descriptors = Object.getOwnPropertyDescriptors(observedTransaction);
    valid(Reflect.ownKeys(descriptors).every(key => typeof key === 'string'
      && Object.hasOwn(descriptors[key], 'value') && ['string', 'number'].includes(typeof descriptors[key].value)));
    const observed = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
    return transaction(async client => {
      const current = await select(client, scope, true);
      valid(current, 'TRAINING_INTENT_NOT_FOUND');
      const hash = assertDurableTrainingTransaction(current.review, observed);
      if (current.transactionHash) {
        valid(current.transactionHash === hash, 'TRAINING_HASH_ALREADY_BOUND'); return current;
      }
      valid(['WALLET_REQUESTED', 'SUBMISSION_UNKNOWN'].includes(current.status)
        && current.revision === expectedRevision, 'TRAINING_STORE_CONFLICT');
      return write(client, current, 'SUBMITTED', hash);
    });
  }
  async function recordVerifiedObservation(scope, expectedRevision, receiptObservation) {
    revision(expectedRevision);
    const evidence = observation(receiptObservation, receiptObservation?.transactionHash);
    const fixed = JSON.parse(evidence);
    return transaction(async client => {
      const current = await select(client, scope, true);
      valid(current, 'TRAINING_INTENT_NOT_FOUND');
      valid(current.transactionHash === fixed.transactionHash, 'TRAINING_TRANSACTION_MISMATCH');
      if (current.observation && Object.keys(fixed).every(key => current.observation[key] === fixed[key])) return current;
      valid(current.revision === expectedRevision, 'TRAINING_STORE_CONFLICT');
      valid(fixed.status === 'REORGED' ? ['INCLUDED_SUCCESS', 'INCLUDED_REVERT'].includes(current.status)
        : ['SUBMITTED', 'REORGED'].includes(current.status), 'INVALID_TRAINING_OBSERVATION_TRANSITION');
      return write(client, current, fixed.status, current.transactionHash, evidence);
    });
  }
  async function hasUnresolvedTraining(tokenId) {
    canonicalToken(tokenId);
    return transaction(async client => {
      const result = await client.query(`SELECT EXISTS (SELECT 1 FROM broker_forge_training_intents
        WHERE chain_id=$1 AND collection_address=$2 AND punk_token_id=$3::numeric
          AND status NOT IN ('EXPIRED','CANCELLED')) AS blocked`, [binding.chainId, binding.collection, tokenId]);
      valid(typeof result.rows[0]?.blocked === 'boolean', 'TRAINING_STORE_CORRUPT');
      return result.rows[0].blocked; // No prior-owner identity, review or private payload.
    });
  }
  return Object.freeze({ prepare, get, claim, markUnknown, cancelPrepared,
    bindVerifiedTransaction, recordVerifiedObservation, hasUnresolvedTraining });
}
