import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, parseAbi } from 'viem';
import { encodeReviewedBurnCall, encodePunkBurnApproval, encodeBurnReviewCancellation } from '../site/forge-burn-calldata.js';

const source = `0x${'a'.repeat(40)}`;
const review = () => ({ sourceTokenId: '7', targetTokenId: '44', nonce: '12', stateHash: `0x${'b'.repeat(64)}`, deadline: '1800000060' });
const abi = parseAbi(['function applyBurnReview((uint256 sourceTokenId,uint256 targetTokenId,uint256 nonce,bytes32 stateHash,uint64 deadline) review)',
  'function approve(address,uint256)', 'function invalidateBurnReviews(uint256)']);
test('browser burn tuple and exact NFT approval match independent ABI encoding', () => {
  const r = review();
  assert.equal(encodeReviewedBurnCall(r), encodeFunctionData({ abi, functionName: 'applyBurnReview', args: [{ ...r,
    sourceTokenId: 7n, targetTokenId: 44n, nonce: 12n, deadline: 1800000060n }] }));
  assert.equal(encodePunkBurnApproval(source, '7'), encodeFunctionData({ abi, functionName: 'approve', args: [source, 7n] }));
  assert.equal(encodeBurnReviewCancellation('7'), encodeFunctionData({ abi, functionName: 'invalidateBurnReviews', args: [7n] }));
});
for (const [field, value] of [['sourceTokenId', '44'], ['sourceTokenId', '10000'], ['targetTokenId', '-1'],
  ['nonce', '01'], ['nonce', (1n << 256n).toString()], ['deadline', '0'], ['deadline', (1n << 64n).toString()],
  ['stateHash', `0x${'0'.repeat(64)}`], ['stateHash', '0x1234'], ['sourceTokenId', Number.MAX_SAFE_INTEGER + 1]]) {
  test(`burn encoder rejects invalid ${field}: ${String(value).slice(0,20)}`, () => {
    assert.throws(() => encodeReviewedBurnCall({ ...review(), [field]: value }));
  });
}
test('burn encoder rejects hidden transaction fields, missing fields and accessor side effects', () => {
  assert.throws(() => encodeReviewedBurnCall({ ...review(), value: '1' }));
  const missing = review(); delete missing.nonce; assert.throws(() => encodeReviewedBurnCall(missing));
  let reads = 0; const accessor = review(); Object.defineProperty(accessor, 'stateHash', { get() { reads++; return `0x${'b'.repeat(64)}`; } });
  assert.throws(() => encodeReviewedBurnCall(accessor)); assert.equal(reads, 0);
  assert.throws(() => encodePunkBurnApproval(`0x${'0'.repeat(40)}`, '7'));
});
