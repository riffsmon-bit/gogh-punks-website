// A clock deadline cannot release a claimed transaction. Only a fresh, matching
// durable record can prove this review never reached the wallet.
export function originalPracticeReviewState(review, record, localHash = null) {
  const invalid = () => { throw Error('PRACTICE_REVIEW_UNAVAILABLE'); };
  if (!review || !record || !['TRAINING', 'BURN'].includes(review.kind)) invalid();
  const id = review.kind === 'TRAINING' ? record.intentId : record.review?.intentId;
  const states = review.kind === 'TRAINING'
    ? ['PREPARED', 'EXPIRED', 'CANCELLED', 'WALLET_REQUESTED', 'SUBMISSION_UNKNOWN', 'SUBMITTED', 'INCLUDED_SUCCESS', 'INCLUDED_REVERT', 'REORGED', 'SETTLED_SUCCESS', 'SETTLED_REVERT', 'NONCE_CONSUMED', 'REVIEW_EXPIRED']
    : ['PREPARED', 'CANCELLED', 'DECLINED', 'WALLET_REQUESTED', 'CONFIRMED', 'REVERTED'];
  if (typeof id !== 'string' || !id || id !== review.id || !/^[0-9a-f]{64}$/.test(record.reviewHash ?? '')
    || record.reviewHash !== review.prepared?.record?.reviewHash || !states.includes(record.status)
    || !Number.isSafeInteger(record.revision) || record.revision < 0) invalid();
  const storedHash = review.kind === 'TRAINING' ? record.transactionHash : record.reportedHash;
  const hash = value => value === null || typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
  if (!hash(storedHash) || !hash(localHash) || storedHash && localHash && storedHash.toLowerCase() !== localHash.toLowerCase()) invalid();
  const unsent = record.status === 'PREPARED' || review.kind === 'TRAINING' && record.status === 'EXPIRED';
  if (unsent && (storedHash !== null || localHash !== null || record.observation != null
    || record.settlement != null || record.receipt != null)) invalid();
  if (record.status === 'EXPIRED' && (review.kind !== 'TRAINING' || record.holdsTraining !== false || record.expired !== true)) invalid();
  return { status: record.status, canDiscardUnsent: unsent, transactionHash: localHash ?? storedHash };
}
