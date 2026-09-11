import { keccak256, toHex } from 'viem';
import { serializeDurableTrainingReview, trainingDigest } from './durable-training-review.mjs';
import { readDurableTrainingReceipt } from './training-receipt-verifier.mjs';

export const TRAINING_SETTLED_STATES = Object.freeze(['SETTLED_SUCCESS', 'SETTLED_REVERT', 'NONCE_CONSUMED', 'REVIEW_EXPIRED']);
const SCHEMA = 'GOGH_TRAINING_SETTLEMENT_V1';
const POLICY = 'RPC_FINALIZED_QUORUM_V1';
const SOURCES = ['PUBLICNODE', 'ROBINHOOD'];
const KEYS = ['schema', 'policy', 'status', 'reviewHash', 'transactionHash', 'finalizedBlockNumber',
  'finalizedBlockHash', 'finalizedTimestamp', 'receiptBlockNumber', 'receiptBlockHash', 'ownerNonce', 'sources', 'evidenceHash'];
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value);
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) < 2n ** 64n;
function requireFact(value) { if (!value) throw Error('UNVERIFIED_TRAINING_SETTLEMENT'); }
function plain(value, keys) {
  requireFact(value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value')));
}
function bodyOf(value) { return Object.fromEntries(KEYS.filter(key => key !== 'evidenceHash').map(key => [key, value[key]])); }

// Structural/binding checks only. Evidence hashes are not signatures. Only the
// trusted reconciler supplies this proof; an HTTP body must never reach this API.
export function serializeTrainingSettlement(value, review) {
  const reviewHash = trainingDigest(serializeDurableTrainingReview(review));
  plain(value, KEYS);
  requireFact(value.schema === SCHEMA && value.policy === POLICY && TRAINING_SETTLED_STATES.includes(value.status)
    && value.reviewHash === reviewHash && (value.transactionHash === null || hash(value.transactionHash))
    && uint(value.finalizedBlockNumber) && hash(value.finalizedBlockHash) && uint(value.finalizedTimestamp)
    && uint(value.ownerNonce) && (value.status==='REVIEW_EXPIRED'
      ? BigInt(value.ownerNonce)<=BigInt(review.transaction.nonce) : BigInt(value.ownerNonce)>BigInt(review.transaction.nonce))
    && Array.isArray(value.sources) && Object.getPrototypeOf(value.sources) === Array.prototype
    && Reflect.ownKeys(value.sources).length === 3
    && SOURCES.every((source, index) => Object.getOwnPropertyDescriptor(value.sources, String(index))?.value === source));
  if (['NONCE_CONSUMED','REVIEW_EXPIRED'].includes(value.status)) {
    requireFact(value.receiptBlockNumber === null && value.receiptBlockHash === null
      && BigInt(value.finalizedTimestamp) > BigInt(review.guard.deadline)
      && BigInt(value.finalizedBlockNumber) >= BigInt(review.anchor.number));
  } else {
    requireFact(hash(value.transactionHash) && uint(value.receiptBlockNumber) && hash(value.receiptBlockHash)
      && BigInt(value.receiptBlockNumber) >= BigInt(review.anchor.number)
      && BigInt(value.receiptBlockNumber) <= BigInt(value.finalizedBlockNumber));
  }
  const body = bodyOf(value);
  requireFact(value.evidenceHash === `0x${trainingDigest(JSON.stringify(body))}`);
  return JSON.stringify({ ...body, evidenceHash: value.evidenceHash });
}

function checkedBlock(block) {
  requireFact(block && typeof block.number === 'bigint' && block.number >= 0n && block.number < 2n ** 64n
    && hash(block.hash) && typeof block.timestamp === 'bigint' && block.timestamp >= 0n);
  return { number: block.number, hash: block.hash, timestamp: block.timestamp };
}
const sameBlock = (one, two) => one.number === two.number && one.hash === two.hash && one.timestamp === two.timestamp;
const missingTransaction = error => error?.name === 'TransactionNotFoundError';

// Both clients are fixed server dependencies, in PUBLICNODE / ROBINHOOD order.
// This follows the providers' finalized tags, not an independent L1 proof. There
// is no fallback to latest/safe, elapsed time or a fixed L2 confirmation count.
export async function readTrainingSettlement({ clients, review, transactionHash = null,
  expectedRuntimeHash, expectedSnapshotHash, now = Date.now }) {
  review = JSON.parse(serializeDurableTrainingReview(review));
  requireFact(Array.isArray(clients) && clients.length === 2 && clients[0] !== clients[1]
    && clients.every(client => client && typeof client.getBlock === 'function' && typeof client.request === 'function')
    && (transactionHash === null || hash(transactionHash)));
  const chains = await Promise.all(clients.map(client => client.getChainId()));
  requireFact(chains.every(chain => chain === review.chainId));
  const heads = (await Promise.all(clients.map(client => client.getBlock({ blockTag: 'latest' })))).map(checkedBlock);
  const finalHeads = (await Promise.all(clients.map(client => client.getBlock({ blockTag: 'finalized' })))).map(checkedBlock);
  const timestamp = Math.floor(now() / 1000);
  requireFact(Number.isSafeInteger(timestamp) && heads.every((head, i) => head.timestamp <= BigInt(timestamp + 5)
    && head.timestamp >= BigInt(timestamp - 120) && finalHeads[i].number <= head.number
    && finalHeads[i].timestamp <= head.timestamp && finalHeads[i].timestamp >= BigInt(timestamp - 7200)));
  const height = finalHeads[0].number < finalHeads[1].number ? finalHeads[0].number : finalHeads[1].number;
  const common = (await Promise.all(clients.map(client => client.getBlock({ blockNumber: height })))).map(checkedBlock);
  requireFact(common.every(block => block.number === height) && sameBlock(common[0], common[1])
    && finalHeads.every((head, i) => head.number !== height || sameBlock(head, common[i])));
  const block = common[0];
  const rawNonces = await Promise.all(clients.map(client => client.request({
    method: 'eth_getTransactionCount', params: [review.owner, toHex(height)],
  })));
  requireFact(rawNonces.every(nonce => typeof nonce === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(nonce)
    && BigInt(nonce) < 2n ** 64n) && BigInt(rawNonces[0]) === BigInt(rawNonces[1]));
  const nonce = BigInt(rawNonces[0]);
  const unusedNonce = nonce <= BigInt(review.transaction.nonce);
  if (unusedNonce && block.timestamp <= BigInt(review.guard.deadline)) return { settlement: null, reason: 'WAITING_FOR_FINALIZED_NONCE' };
  if (unusedNonce) {
    // The only reviewed call is applyTrainingReview with an on-chain deadline.
    // Verify that exact immutable runtime at the finalized height on BOTH RPCs.
    // After this timestamp the old call cannot train, even if a delayed signature
    // is broadcast later. A pending transaction may still consume its reviewed gas;
    // the next review separately refuses a pending/mismatched wallet nonce.
    requireFact(hash(expectedRuntimeHash) && height >= BigInt(review.anchor.number));
    const codes=await Promise.all(clients.map(client=>client.getCode({address:review.progression,blockNumber:height})));
    requireFact(codes.every(code=>typeof code==='string' && code!=='0x' && keccak256(code)===expectedRuntimeHash));
  }

  let status = unusedNonce ? 'REVIEW_EXPIRED' : 'NONCE_CONSUMED', receiptBlockNumber = null, receiptBlockHash = null;
  if (transactionHash && !unusedNonce) {
    const receipts = await Promise.all(clients.map(async client => {
      try { return await readDurableTrainingReceipt({ client, review, transactionHash, expectedRuntimeHash, expectedSnapshotHash }); }
      catch (error) { if (missingTransaction(error)) return null; throw error; }
    }));
    requireFact(Boolean(receipts[0]) === Boolean(receipts[1]));
    if (receipts[0]) {
      requireFact(receipts[0].status === receipts[1].status);
      const observations = receipts.map(receipt => receipt.observation);
      if (observations[0]) {
        requireFact(observations[0].blockNumber === observations[1]?.blockNumber
          && observations[0].blockHash === observations[1]?.blockHash
          && ['INCLUDED_SUCCESS', 'INCLUDED_REVERT'].includes(observations[0].status));
        if (BigInt(observations[0].blockNumber) > height) return { settlement: null, reason: 'WAITING_FOR_FINALIZED_RECEIPT' };
        status = observations[0].status === 'INCLUDED_SUCCESS' ? 'SETTLED_SUCCESS' : 'SETTLED_REVERT';
        receiptBlockNumber = observations[0].blockNumber; receiptBlockHash = observations[0].blockHash;
      }
    }
  }
  if (status === 'NONCE_CONSUMED' && block.timestamp <= BigInt(review.guard.deadline)) {
    return { settlement: null, reason: 'WAITING_FOR_FINALIZED_REVIEW_EXPIRY' };
  }
  // Recheck the exact canonical anchor, both chain identities and monotonic
  // finalized tags after receipt/nonce work, before emitting a release proof.
  const rechecked = await Promise.all(clients.map(async (client,index) => {
    const canonical = checkedBlock(await client.getBlock({ blockNumber: height }));
    const finalized = checkedBlock(await client.getBlock({ blockTag: 'finalized' }));
    requireFact(await client.getChainId() === review.chainId && sameBlock(canonical, block)
      && finalized.number >= finalHeads[index].number && (finalized.number !== height || sameBlock(finalized, block)));
    return canonical;
  }));
  requireFact(rechecked.every(canonical => sameBlock(canonical, block)));
  const body = { schema: SCHEMA, policy: POLICY, status,
    reviewHash: trainingDigest(serializeDurableTrainingReview(review)), transactionHash,
    finalizedBlockNumber: height.toString(), finalizedBlockHash: block.hash, finalizedTimestamp: block.timestamp.toString(),
    receiptBlockNumber, receiptBlockHash, ownerNonce: nonce.toString(), sources: [...SOURCES] };
  const settlement = { ...body, evidenceHash: `0x${trainingDigest(JSON.stringify(body))}` };
  return { settlement: JSON.parse(serializeTrainingSettlement(settlement, review)), reason: null };
}
