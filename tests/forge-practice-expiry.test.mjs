import test from 'node:test';
import assert from 'node:assert/strict';
import { originalPracticeReviewState } from '../scripts/dev/skill-forge/original-practice-review.mjs';
const tx = '0x' + 'b'.repeat(64), digest = 'a'.repeat(64);
const review = kind => ({ id: 'matching-intent', kind, prepared: { record: { reviewHash: digest } } });
const row = (status, kind = 'TRAINING') => ({ intentId: 'matching-intent', review: { intentId: 'matching-intent' },
  reviewHash: digest, revision: 4, status, ...(kind === 'TRAINING' ? { transactionHash: null } : { reportedHash: null }),
  holdsTraining: status !== 'EXPIRED', expired: true, observation: null, settlement: null, receipt: null });
test('holder expired starting-slot review becomes explicitly discardable from its durable never-claimed record', () => {
  assert.deepEqual(originalPracticeReviewState(review('TRAINING'), row('EXPIRED')),
    { status: 'EXPIRED', canDiscardUnsent: true, transactionHash: null });
});
for (const kind of ['TRAINING', 'BURN']) test(`${kind} freshly persisted PREPARED permits cancellation at its current revision`, () => {
  assert.equal(originalPracticeReviewState(review(kind), row('PREPARED', kind)).canDiscardUnsent, true);
});
for (const status of ['WALLET_REQUESTED', 'SUBMISSION_UNKNOWN', 'SUBMITTED', 'INCLUDED_SUCCESS', 'INCLUDED_REVERT', 'REORGED', 'REVIEW_EXPIRED', 'NONCE_CONSUMED', 'SETTLED_REVERT']) {
  test(`elapsed deadline does not release ${status}, even when no local hash was returned`, () => {
    assert.equal(originalPracticeReviewState(review('TRAINING'), row(status)).canDiscardUnsent, false);
  });
}
test('burn claim remains reserved after deadline without a returned transaction hash', () => {
  assert.equal(originalPracticeReviewState(review('BURN'), row('WALLET_REQUESTED', 'BURN')).canDiscardUnsent, false);
});
for (const change of [r => r.transactionHash = tx, r => r.observation = {}, r => r.settlement = {}, r => r.holdsTraining = true, r => r.expired = false]) {
  test('inconsistent expired-record evidence cannot permit discard', () => {
    const record = row('EXPIRED'); change(record);
    assert.throws(() => originalPracticeReviewState(review('TRAINING'), record), /PRACTICE_REVIEW_UNAVAILABLE/);
  });
}
test('a saved local hash cannot be discarded using a conflicting unsent database row', () => {
  for (const kind of ['TRAINING', 'BURN']) assert.throws(() => originalPracticeReviewState(review(kind), row('PREPARED', kind), tx), /PRACTICE_REVIEW_UNAVAILABLE/);
});
test('missing, mismatched and malformed records fail closed', () => {
  for (const record of [null, {}, { ...row('EXPIRED'), intentId: 'another' }, { ...row('EXPIRED'), reviewHash: undefined },
    { ...row('EXPIRED'), status: 'UNKNOWN' }, { ...row('EXPIRED'), revision: -1 }, { ...row('EXPIRED'), transactionHash: undefined }]) {
    assert.throws(() => originalPracticeReviewState(review('TRAINING'), record), /PRACTICE_REVIEW_UNAVAILABLE/);
  }
  assert.throws(() => originalPracticeReviewState({ ...review('TRAINING'), prepared: {} }, row('EXPIRED')), /PRACTICE_REVIEW_UNAVAILABLE/);
  assert.throws(() => originalPracticeReviewState(review('BURN'), row('EXPIRED', 'BURN')), /PRACTICE_REVIEW_UNAVAILABLE/);
});
test('known submitted transaction is retained and substitution rejected', () => {
  const record = { ...row('SUBMITTED'), transactionHash: tx };
  assert.equal(originalPracticeReviewState(review('TRAINING'), record, tx).transactionHash, tx);
  assert.throws(() => originalPracticeReviewState(review('TRAINING'), record, '0x' + 'c'.repeat(64)), /PRACTICE_REVIEW_UNAVAILABLE/);
});
