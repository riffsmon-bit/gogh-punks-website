import { createHash } from 'node:crypto';
import { encodeFunctionData, parseAbi } from 'viem';

export const TRAINING_REVIEW_SCHEMA = 'GOGH_DURABLE_TRAINING_REVIEW_V1';
const ZERO = `0x${'0'.repeat(64)}`;
const ABI = parseAbi([
  'function applyTrainingReview((uint256 tokenId,uint8 operation,bytes32 skillKey,uint8 slot,uint8 startingSlots,bytes32[] rarityProof,uint256 nonce,bytes32 stateHash,uint64 deadline) review)',
]);
const OPERATIONS = ['learn', 'unlock', 'equip', 'unequip', 'claim_rarity'];
export const trainingDigest = value => createHash('sha256').update(value).digest('hex');

function requireValue(condition) { if (!condition) throw Error('INVALID_DURABLE_TRAINING_REVIEW'); }
function object(value, keys) {
  requireValue(value && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
}
function uint(value, bits = 256) {
  requireValue(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value)
    && BigInt(value) < 2n ** BigInt(bits));
}
function hash(value) { requireValue(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && value !== ZERO); }
function address(value) { requireValue(typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && value !== `0x${'0'.repeat(40)}`); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// Persistence validation only. This does NOT verify a deployment, ownership, a skill,
// simulation or a release authorization. The trusted coordinator performs those checks.
export function serializeDurableTrainingReview(review) {
  object(review, ['schema', 'chainId', 'collection', 'progression', 'deploymentHash', 'owner',
    'tokenId', 'action', 'guard', 'anchor', 'transaction']);
  requireValue(review.schema === TRAINING_REVIEW_SCHEMA && [31337, 4663].includes(review.chainId));
  address(review.collection); address(review.progression); address(review.owner);
  hash(review.deploymentHash); uint(review.tokenId);
  const { action, guard, anchor, transaction } = review;
  object(action, ['operation', 'skillKey', 'slot', 'startingSlots', 'rarityProof']);
  requireValue(OPERATIONS.includes(action.operation));
  const needsKey = ['learn', 'equip'].includes(action.operation);
  const needsSlot = ['equip', 'unequip'].includes(action.operation);
  const claim = action.operation === 'claim_rarity';
  if (needsKey) hash(action.skillKey); else requireValue(action.skillKey === ZERO);
  requireValue(Number.isInteger(action.slot) && action.slot >= 0 && action.slot < 7
    && (needsSlot || action.slot === 0));
  requireValue(Number.isInteger(action.startingSlots) && (claim
    ? action.startingSlots >= 1 && action.startingSlots <= 3 : action.startingSlots === 0));
  requireValue(Array.isArray(action.rarityProof) && Object.getPrototypeOf(action.rarityProof) === Array.prototype
    && action.rarityProof.length <= 32
    && (claim || action.rarityProof.length === 0)
    && Reflect.ownKeys(action.rarityProof).length === action.rarityProof.length + 1);
  for (let i = 0; i < action.rarityProof.length; i++) {
    requireValue(Object.hasOwn(Object.getOwnPropertyDescriptor(action.rarityProof, String(i)) ?? {}, 'value'));
    hash(action.rarityProof[i]);
  }
  object(guard, ['nonce', 'stateHash', 'deadline']);
  uint(guard.nonce); hash(guard.stateHash); uint(guard.deadline, 64);
  object(anchor, ['number', 'hash', 'timestamp']);
  uint(anchor.number, 64); hash(anchor.hash); uint(anchor.timestamp, 64);
  requireValue(BigInt(guard.deadline) > BigInt(anchor.timestamp)
    && BigInt(guard.deadline) <= BigInt(anchor.timestamp) + 60n
    && BigInt(guard.deadline) < 10_000_000_000n);
  object(transaction, ['nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas']);
  uint(transaction.nonce, 64); uint(transaction.gas, 64);
  uint(transaction.maxFeePerGas); uint(transaction.maxPriorityFeePerGas);
  requireValue(BigInt(transaction.gas) > 0n && BigInt(transaction.gas) <= 2_000_000n
    && BigInt(transaction.maxFeePerGas) > 0n
    && BigInt(transaction.maxPriorityFeePerGas) <= BigInt(transaction.maxFeePerGas));
  const serialized = stable(review);
  requireValue(Buffer.byteLength(serialized) <= 16_384);
  return serialized;
}

export function durableTrainingTransaction(review) {
  serializeDurableTrainingReview(review);
  return {
    chainId: review.chainId, type: 'eip1559', from: review.owner, to: review.progression,
    value: '0', ...review.transaction,
    data: encodeFunctionData({ abi: ABI, functionName: 'applyTrainingReview', args: [{
      tokenId: BigInt(review.tokenId), operation: OPERATIONS.indexOf(review.action.operation),
      skillKey: review.action.skillKey, slot: review.action.slot,
      startingSlots: review.action.startingSlots, rarityProof: review.action.rarityProof,
      nonce: BigInt(review.guard.nonce), stateHash: review.guard.stateHash,
      deadline: BigInt(review.guard.deadline),
    }] }),
  };
}

// The caller must supply data read from its pinned RPC, never a browser assertion.
// Chain existence/canonicality and receipt events are separate attestor duties.
export function assertDurableTrainingTransaction(review, observed) {
  const expected = durableTrainingTransaction(review);
  object(observed, [...Object.keys(expected), 'hash']);
  hash(observed.hash);
  for (const key of Object.keys(expected)) {
    if (observed[key] !== expected[key]) throw Error('TRAINING_TRANSACTION_MISMATCH');
  }
  return observed.hash;
}
