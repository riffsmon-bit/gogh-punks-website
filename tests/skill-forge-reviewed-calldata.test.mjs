import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionData, parseAbi } from 'viem';
import { readFile } from 'node:fs/promises';
import { encodeReviewedTrainingCall, encodeTrainingReviewCancellation } from '../site/forge-reviewed-calldata.js';
const ABI = parseAbi([
  'function applyTrainingReview((uint256 tokenId,uint8 operation,bytes32 skillKey,uint8 slot,uint8 startingSlots,bytes32[] rarityProof,uint256 nonce,bytes32 stateHash,uint64 deadline) review)',
  'function invalidateTrainingReviews(uint256 tokenId)',
]);
const ZERO = `0x${'0'.repeat(64)}`, HASH = `0x${'1'.repeat(64)}`;
const fixture = () => ({ tokenId: '44', operation: 'learn', skillKey: HASH, slot: 0, startingSlots: 0,
  rarityProof: [], nonce: '0', stateHash: HASH, deadline: '1800000060' });
const operations = ['learn', 'unlock', 'equip', 'unequip', 'claim-rarity'];
for (const operation of operations) test(`${operation} encoding matches independently generated ABI exactly`, () => {
  const input = { ...fixture(), operation, skillKey: ['learn', 'equip'].includes(operation) ? HASH : ZERO,
    slot: ['equip', 'unequip'].includes(operation) ? 6 : 0,
    startingSlots: operation === 'claim-rarity' ? 3 : 0, rarityProof: operation === 'claim-rarity' ? [HASH, ZERO] : [] };
  const tuple = { ...input, tokenId: 44n, operation: operations.indexOf(operation), nonce: 0n, deadline: 1800000060n };
  const encoded = encodeReviewedTrainingCall(input);
  assert.equal(encoded, encodeFunctionData({ abi: ABI, functionName: 'applyTrainingReview', args: [tuple] }));
  assert.deepEqual(decodeFunctionData({ abi: ABI, data: encoded }).args[0], tuple);
});
test('maximum-width nonce and deadline are preserved without floating point rounding', () => {
  const input = { ...fixture(), nonce: String(2n ** 256n - 1n), deadline: String(2n ** 64n - 1n) };
  const decoded = decodeFunctionData({ abi: ABI, data: encodeReviewedTrainingCall(input) }).args[0];
  assert.equal(String(decoded.nonce), input.nonce); assert.equal(String(decoded.deadline), input.deadline);
});
test('review cancellation is an exact current-token call, not an asset or session operation', () => {
  assert.equal(encodeTrainingReviewCancellation('44'), encodeFunctionData({ abi: ABI, functionName: 'invalidateTrainingReviews', args: [44n] }));
});
test('unknown operations, hidden arguments, invalid offsets and noncanonical integers are rejected', () => {
  const input = fixture();
  for (const patch of [{ operation: 'burn' }, { operation: 'execute' }, { to: HASH }, { value: '1' }, { tokenId: '10000' },
    { tokenId: '-1' }, { tokenId: '044' }, { tokenId: 1.1 }, { nonce: -1n }, { nonce: Number.MAX_SAFE_INTEGER + 1 },
    { nonce: String(2n ** 256n) }, { deadline: String(2n ** 64n) }, { deadline: 0 }, { slot: 7 }, { slot: 1 },
    { startingSlots: 1 }, { rarityProof: [HASH] }, { rarityProof: Array(33).fill(HASH) },
    { stateHash: ZERO }, { skillKey: ZERO }, { skillKey: '0x1234' }]) {
    assert.throws(() => encodeReviewedTrainingCall({ ...input, ...patch }), /INVALID/);
  }
  const getter = { ...input }; Object.defineProperty(getter, 'nonce', { get() { throw Error('Do not invoke accessor'); } });
  assert.throws(() => encodeReviewedTrainingCall(getter), /INVALID_TRAINING_REVIEW/);
});
test('claim-rarity requires a valid starting allocation and supports a bounded proof', () => {
  const input = { ...fixture(), operation: 'claim-rarity', skillKey: ZERO, startingSlots: 1, rarityProof: Array(32).fill(HASH) };
  assert.equal(decodeFunctionData({ abi: ABI, data: encodeReviewedTrainingCall(input) }).args[0].rarityProof.length, 32);
  for (const patch of [{ startingSlots: 0 }, { startingSlots: 4 }, { rarityProof: ['bad'] }, { skillKey: HASH }]) {
    assert.throws(() => encodeReviewedTrainingCall({ ...input, ...patch }));
  }
});
test('browser encoder has no provider, signing, send, RPC or arbitrary call authority', async () => {
  const source = await readFile(new URL('../site/forge-reviewed-calldata.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /eth_sendTransaction|personal_sign|eth_sign|fetch\(|\.request\(|window\.ethereum/);
});
