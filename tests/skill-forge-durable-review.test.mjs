import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData, parseAbi } from 'viem';
import { serializeDurableTrainingReview, trainingDigest, durableTrainingTransaction,
  assertDurableTrainingTransaction } from '../broker/src/v4/skill-forge/durable-training-review.mjs';
import { durableReviewFixture, fixtureHash } from './fixtures/durable-training-review.mjs';

test('durable review is canonical, hashable and restricted to the reviewed contract entry point', () => {
  const review = durableReviewFixture();
  const reordered = Object.fromEntries(Object.entries(review).reverse());
  reordered.action = Object.fromEntries(Object.entries(review.action).reverse());
  assert.equal(serializeDurableTrainingReview(review), serializeDurableTrainingReview(reordered));
  assert.equal(trainingDigest(serializeDurableTrainingReview(review)).length, 64);
  const transaction = durableTrainingTransaction(review);
  assert.equal(transaction.value, '0'); assert.equal(transaction.to, review.progression);
  assert.equal(transaction.from, review.owner); assert.equal(transaction.type, 'eip1559');
  const decoded = decodeFunctionData({ abi: parseAbi([
    'function applyTrainingReview((uint256 tokenId,uint8 operation,bytes32 skillKey,uint8 slot,uint8 startingSlots,bytes32[] rarityProof,uint256 nonce,bytes32 stateHash,uint64 deadline) review)',
  ]), data: transaction.data });
  assert.equal(decoded.functionName, 'applyTrainingReview');
  assert.equal(decoded.args[0].tokenId, 93n); assert.equal(decoded.args[0].operation, 2);
  assert.equal(decoded.args[0].nonce, 2n);
});

for (const [label, alter] of [
  ['arbitrary calldata', r => { r.transaction.data = '0x'; }],
  ['value', r => { r.transaction.value = '1'; }],
  ['alternate target', r => { r.transaction.to = r.owner; }],
  ['signing authority', r => { r.transaction.authorizationList = []; }],
  ['burn', r => { r.action.operation = 'burn'; }],
  ['trading', r => { r.action.operation = 'purchase'; }],
  ['chain', r => { r.chainId = 1; }],
  ['numeric token', r => { r.tokenId = 93; }],
  ['oversized token', r => { r.tokenId = (2n ** 256n).toString(); }],
  ['noncanonical token', r => { r.tokenId = '093'; }],
  ['zero owner', r => { r.owner = `0x${'0'.repeat(40)}`; }],
  ['locked slot', r => { r.action.slot = 7; }],
  ['extra action fields', r => { r.action.policy = 'unsafe'; }],
  ['no skill key', r => { r.action.skillKey = fixtureHash('0'); }],
  ['incorrect starting slots', r => { r.action.startingSlots = 3; }],
  ['unexpected rarity proof', r => { r.action.rarityProof = [fixtureHash('f')]; }],
  ['zero state hash', r => { r.guard.stateHash = fixtureHash('0'); }],
  ['deadline too late', r => { r.guard.deadline = String(BigInt(r.anchor.timestamp) + 61n); }],
  ['deadline not after anchor', r => { r.guard.deadline = r.anchor.timestamp; }],
  ['zero gas', r => { r.transaction.gas = '0'; }],
  ['unbounded gas', r => { r.transaction.gas = '2000001'; }],
  ['negative fee', r => { r.transaction.maxFeePerGas = '-1'; }],
  ['priority exceeds fee', r => { r.transaction.maxPriorityFeePerGas = '999999999999'; }],
  ['bigint field', r => { r.transaction.nonce = 8n; }],
]) test(`durable review rejects ${label}`, () => {
  const review = durableReviewFixture(); alter(review);
  assert.throws(() => serializeDurableTrainingReview(review), /INVALID_DURABLE/);
});

test('review never executes getters, accepts inherited fields or sparse/prototyped proofs', () => {
  const review = durableReviewFixture(); let invoked = false;
  Object.defineProperty(review, 'owner', { enumerable: true, get() { invoked = true; throw Error('getter'); } });
  assert.throws(() => serializeDurableTrainingReview(review), /INVALID_DURABLE/); assert.equal(invoked, false);
  const inherited = Object.create(durableReviewFixture());
  assert.throws(() => serializeDurableTrainingReview(inherited), /INVALID_DURABLE/);
  const sparse = durableReviewFixture(); sparse.action.operation = 'claim_rarity';
  sparse.action.skillKey = fixtureHash('0'); sparse.action.startingSlots = 1; sparse.action.rarityProof = new Array(2);
  assert.throws(() => serializeDurableTrainingReview(sparse), /INVALID_DURABLE/);
  const prototyped = durableReviewFixture();
  Object.setPrototypeOf(prototyped.action.rarityProof, { map() { invoked = true; return []; } });
  assert.throws(() => serializeDurableTrainingReview(prototyped), /INVALID_DURABLE/); assert.equal(invoked, false);
});

test('all five non-burn operations have explicit argument shapes', () => {
  for (const operation of ['learn', 'unlock', 'equip', 'unequip', 'claim_rarity']) {
    const review = durableReviewFixture(); review.action.operation = operation;
    if (!['learn', 'equip'].includes(operation)) review.action.skillKey = fixtureHash('0');
    if (operation === 'claim_rarity') { review.action.startingSlots = 2; review.action.rarityProof = [fixtureHash('e')]; }
    assert.ok(durableTrainingTransaction(review).data.startsWith('0x'));
  }
});

test('transaction binding rejects substitution, nonce reuse, fee changes and delegated authorization', () => {
  const review = durableReviewFixture();
  const observed = { ...durableTrainingTransaction(review), hash: fixtureHash('e') };
  assert.equal(assertDurableTrainingTransaction(review, observed), observed.hash);
  for (const [key, value] of Object.entries({ chainId: 4663, type: 'legacy', from: review.progression,
    to: review.owner, value: '1', nonce: '9', gas: '249999', maxFeePerGas: '299999999',
    maxPriorityFeePerGas: '1', data: '0x' })) {
    assert.throws(() => assertDurableTrainingTransaction(review, { ...observed, [key]: value }), /MISMATCH/);
  }
  assert.throws(() => assertDurableTrainingTransaction(review, { ...observed, authorizationList: [] }), /INVALID_DURABLE/);
  assert.throws(() => assertDurableTrainingTransaction(review, { ...observed, hash: fixtureHash('0') }), /INVALID_DURABLE/);
});
