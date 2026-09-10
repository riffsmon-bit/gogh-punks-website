import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi } from 'viem';
import { readDurableTrainingReceipt, normalizeObservedTrainingTransaction } from '../broker/src/v4/skill-forge/training-receipt-verifier.mjs';
import { durableTrainingTransaction } from '../broker/src/v4/skill-forge/durable-training-review.mjs';
import { durableReviewFixture, fixtureHash } from './fixtures/durable-training-review.mjs';

const ABI = parseAbi([
  'event TrainingReviewApplied(uint256 indexed tokenId,uint256 indexed nonce,uint8 operation)',
  'event SkillLearned(uint256 indexed tokenId,bytes32 indexed key,uint8 level)',
  'event SlotUnlocked(uint256 indexed tokenId,uint8 totalSlots)',
  'event SkillEquipped(uint256 indexed tokenId,uint8 indexed slot,bytes32 indexed key)',
  'event SkillUnequipped(uint256 indexed tokenId,uint8 indexed slot,bytes32 indexed key)',
  'event RaritySlotsClaimed(uint256 indexed tokenId,uint8 startingSlots,bytes32 snapshotHash)',
]);
function harness(operation = 'equip') {
  const code = '0x6001600055', review = durableReviewFixture();
  review.action.operation = operation;
  if (!['learn', 'equip'].includes(operation)) review.action.skillKey = fixtureHash('0');
  if (operation === 'claim_rarity') review.action.startingSlots = 2;
  const tx = durableTrainingTransaction(review), hash = fixtureHash('e');
  const block = { number: 110n, hash: fixtureHash('1'), timestamp: BigInt(review.anchor.timestamp) + 1n };
  const head = { number: 120n, hash: fixtureHash('2'), timestamp: BigInt(review.anchor.timestamp) + 11n };
  const anchor = { number: BigInt(review.anchor.number), hash: review.anchor.hash, timestamp: BigInt(review.anchor.timestamp) };
  const transaction = { ...tx, hash, input: tx.data, nonce: Number(tx.nonce), value: 0n,
    gas: BigInt(tx.gas), maxFeePerGas: BigInt(tx.maxFeePerGas), maxPriorityFeePerGas: 0n,
    blockNumber: block.number, blockHash: block.hash };
  const receipt = { transactionHash: hash, blockNumber: block.number, blockHash: block.hash,
    from: review.owner, to: review.progression, status: 'success', gasUsed: 50000n,
    effectiveGasPrice: 100000000n, logs: [] };
  const emit = (eventName, args, dataTypes = [], dataValues = []) => ({
    address: review.progression, transactionHash: hash, blockNumber: block.number,
    blockHash: block.hash, logIndex: receipt.logs.length, removed: false,
    topics: encodeEventTopics({ abi: ABI, eventName, args }),
    data: dataTypes.length ? encodeAbiParameters(dataTypes.map(type => ({ type })), dataValues) : '0x',
  });
  const tokenId = BigInt(review.tokenId), key = fixtureHash('b'), slot = 0;
  const effects = {
    learn: () => emit('SkillLearned', { tokenId, key }, ['uint8'], [1]),
    unlock: () => emit('SlotUnlocked', { tokenId }, ['uint8'], [2]),
    equip: () => emit('SkillEquipped', { tokenId, slot, key }),
    unequip: () => emit('SkillUnequipped', { tokenId, slot, key }),
    claim_rarity: () => emit('RaritySlotsClaimed', { tokenId }, ['uint8', 'bytes32'], [2, fixtureHash('f')]),
  };
  receipt.logs.push(effects[operation]());
  receipt.logs.push(emit('TrainingReviewApplied', { tokenId, nonce: BigInt(review.guard.nonce) }, ['uint8'],
    [['learn', 'unlock', 'equip', 'unequip', 'claim_rarity'].indexOf(operation)]));
  const client = {
    getChainId: async () => review.chainId,
    getBlock: async input => structuredClone(input.blockTag === 'latest' || input.blockNumber === head.number ? head
      : input.blockNumber === anchor.number ? anchor : block),
    getTransaction: async () => structuredClone(transaction),
    getTransactionReceipt: async () => structuredClone(receipt),
    getCode: async () => code,
  };
  const args = { client, review, transactionHash: hash, expectedRuntimeHash: keccak256(code), expectedSnapshotHash: fixtureHash('f') };
  return { args, review, transaction, receipt, client, block, head, anchor, emit, run: () => readDurableTrainingReceipt(args) };
}

for (const operation of ['learn', 'unlock', 'equip', 'unequip', 'claim_rarity']) {
  test(`verifies exact reviewed ${operation} transaction and matching receipt events`, async () => {
    const h = harness(operation), result = await h.run();
    assert.equal(result.status, 'INCLUDED_SUCCESS'); assert.equal(result.finalized, false);
    assert.equal(result.walletAuthority, 'NONE'); assert.equal(result.observation.transactionHash, h.transaction.hash);
    assert.equal(result.observation.blockHash, h.block.hash); assert.match(result.observation.evidenceHash, /^0x[0-9a-f]{64}$/);
    assert.equal(Object.hasOwn(result, 'credits'), false);
  });
}
for (const [label, change] of [
  ['wrong chain', h => { h.client.getChainId = async () => 1; }],
  ['wrong target', h => { h.transaction.to = h.review.owner; }],
  ['wrong owner', h => { h.transaction.from = h.review.progression; }],
  ['wrong nonce', h => { h.transaction.nonce++; }],
  ['nonzero value', h => { h.transaction.value = 1n; }],
  ['changed calldata', h => { h.transaction.input = '0x'; }],
  ['wallet delegation', h => { h.transaction.authorizationList = []; }],
  ['access-list substitution', h => { h.transaction.accessList = [{ address: h.review.owner, storageKeys: [] }]; }],
  ['different receipt hash', h => { h.receipt.transactionHash = fixtureHash('a'); }],
  ['different inclusion block', h => { h.transaction.blockHash = fixtureHash('a'); }],
  ['receipt above head', h => { h.receipt.blockNumber = 999n; }],
  ['wrong receipt sender', h => { h.receipt.from = h.review.progression; }],
  ['unexpected receipt status', h => { h.receipt.status = 'pending'; }],
  ['gas exceeds review', h => { h.receipt.gasUsed = 999999999n; }],
  ['price exceeds review', h => { h.receipt.effectiveGasPrice = 999999999999n; }],
  ['runtime changed', h => { h.client.getCode = async () => '0x6002600055'; }],
  ['unmined code', h => { h.client.getCode = async () => '0x'; }],
  ['removed event', h => { h.receipt.logs[0].removed = true; }],
  ['event wrong transaction', h => { h.receipt.logs[0].transactionHash = fixtureHash('a'); }],
  ['event wrong block', h => { h.receipt.logs[0].blockHash = fixtureHash('a'); }],
  ['duplicate log index', h => { h.receipt.logs[1].logIndex = 0; }],
  ['missing action event', h => { h.receipt.logs.shift(); }],
  ['missing applied event', h => { h.receipt.logs.pop(); }],
  ['wrong reviewed operation', h => { h.receipt.logs[1].data = encodeAbiParameters([{ type: 'uint8' }], [3]); }],
  ['late successful inclusion', h => { h.block.timestamp = BigInt(h.review.guard.deadline) + 1n; }],
  ['orphaned review anchor', h => { h.anchor.hash = fixtureHash('7'); }],
  ['wrong review timestamp', h => { h.anchor.timestamp++; }],
  ['wrong canonical block number', h => { h.block.number++; }],
]) test(`receipt verification rejects ${label}`, async () => {
  const h = harness(); change(h); await assert.rejects(h.run);
});

test('reverted transaction is recorded as a revert without skill or credit claims', async () => {
  const h = harness(); h.receipt.status = 'reverted'; h.receipt.logs = [];
  h.block.timestamp = BigInt(h.review.guard.deadline) + 1n;
  const result = await h.run(); assert.equal(result.status, 'INCLUDED_REVERT'); assert.equal(result.finalized, false);
  h.receipt.logs = [h.emit('TrainingReviewApplied', { tokenId: 93n, nonce: 2n }, ['uint8'], [2])];
  await assert.rejects(h.run);
});

test('missing receipt is pending, not successful and not proof of a reorg', async () => {
  const h = harness();
  h.client.getTransactionReceipt = async () => { throw Object.assign(Error('not found'), { name: 'TransactionReceiptNotFoundError' }); };
  let result = await h.run(); assert.equal(result.status, 'SUBMITTED'); assert.equal(result.observation, null);
  h.args.previousObservation = { status: 'INCLUDED_SUCCESS', transactionHash: h.transaction.hash,
    blockNumber: h.block.number.toString(), blockHash: h.block.hash };
  result = await h.run(); assert.equal(result.status, 'SUBMITTED'); assert.equal(result.observation, null);
  h.client.getTransactionReceipt = async () => { throw Error('RPC outage'); };
  await assert.rejects(h.run, /RPC outage/);
});

test('reorg requires a changed canonical block and retains transaction binding', async () => {
  const h = harness(); const before = (await h.run()).observation;
  h.args.previousObservation = before; h.block.hash = fixtureHash('9');
  const result = await h.run(); assert.equal(result.status, 'REORGED');
  assert.equal(result.observation.blockHash, null); assert.equal(result.observation.transactionHash, h.transaction.hash);
  assert.equal(result.finalized, false);
});

test('head or inclusion block change during attestation fails closed', async () => {
  for (const changeHead of [true, false]) {
    const h = harness(); let blockReads = 0;
    h.client.getBlock = async input => {
      if (input.blockTag === 'latest') return h.head;
      if (input.blockNumber === h.head.number) return changeHead ? { ...h.head, hash: fixtureHash('8') } : h.head;
      if (input.blockNumber === h.anchor.number) return h.anchor;
      blockReads++; return !changeHead && blockReads > 1 ? { ...h.block, hash: fixtureHash('8') } : h.block;
    };
    await assert.rejects(h.run, /UNVERIFIED/);
  }
});

test('unsafe JavaScript nonce or non-integer RPC value cannot be normalized', () => {
  const h = harness(); h.transaction.nonce = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => normalizeObservedTrainingTransaction(h.transaction), /UNVERIFIED/);
});
