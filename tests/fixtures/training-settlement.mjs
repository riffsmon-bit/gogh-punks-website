import { serializeDurableTrainingReview, trainingDigest } from '../../broker/src/v4/skill-forge/durable-training-review.mjs';
import { fixtureHash } from './durable-training-review.mjs';

// Storage-test evidence only, not a real chain observation or release approval.
export function settlementFixture(review, { status = 'SETTLED_SUCCESS', transactionHash = fixtureHash('e'), ...fields } = {}) {
  const body = { schema: 'GOGH_TRAINING_SETTLEMENT_V1', policy: 'RPC_FINALIZED_QUORUM_V1', status,
    reviewHash: trainingDigest(serializeDurableTrainingReview(review)), transactionHash,
    finalizedBlockNumber: '150', finalizedBlockHash: fixtureHash('a'),
    finalizedTimestamp: String(BigInt(review.guard.deadline) + 1n),
    receiptBlockNumber: ['NONCE_CONSUMED','REVIEW_EXPIRED'].includes(status) ? null : '124',
    receiptBlockHash: ['NONCE_CONSUMED','REVIEW_EXPIRED'].includes(status) ? null : fixtureHash('b'),
    ownerNonce: String(BigInt(review.transaction.nonce) + (status==='REVIEW_EXPIRED'?0n:1n)), sources: ['PUBLICNODE','ROBINHOOD'], ...fields };
  return { ...body, evidenceHash: `0x${trainingDigest(JSON.stringify(body))}` };
}
