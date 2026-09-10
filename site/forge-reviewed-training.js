// Explicit new-deployment adapter. Never inferred from a query flag or used as a
// fallback for legacy transactions. No wallet connection or production authority.
import { encodeReviewedTrainingCall } from './forge-reviewed-calldata.js';
import { trainingCalldata, validateTrainingReview } from './forge-training-transaction.js';
import { validateTrainingSnapshot } from './forge-training.js';
export const REVIEW_PROTOCOL = 'GOGH_ORIGINAL_PUNK_TRAINING_REVIEW_V1';
const HASH = /^0x[0-9a-f]{64}$/i;
const uint = value => typeof value === 'string' && /^(0|[1-9]\d{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
function validateGuard(guard) {
  if (!guard || Object.keys(guard).sort().join(',') !== 'blockTimestamp,nonce,protocol,stateHash'
    || guard.protocol !== REVIEW_PROTOCOL || !uint(guard.nonce) || !HASH.test(guard.stateHash)
    || /^0x0{64}$/.test(guard.stateHash) || !/^\d{1,12}$/.test(guard.blockTimestamp)) throw Error('Unverified on-chain training guard');
}
export function validateReviewedTrainingSnapshot(state, tokenId) {
  validateGuard(state?.trainingGuard);
  if (!Array.isArray(state.history)) throw Error('Unverified reviewed training history');
  const reviewEvents = ['TrainingReviewApplied', 'TrainingReviewsInvalidated', 'RaritySlotsClaimed'];
  for (const event of state.history.filter(e => reviewEvents.includes(e.name))) {
    if (!HASH.test(event.transactionHash) || !uint(event.blockNumber) || BigInt(event.blockNumber) > BigInt(state.blockNumber)
      || String(event.args?.tokenId) !== String(tokenId)
      || (event.name === 'RaritySlotsClaimed'
        ? !Number.isInteger(event.args.startingSlots) || event.args.startingSlots < 1 || event.args.startingSlots > 3 || !HASH.test(event.args.snapshotHash)
        : !uint(event.args?.nonce))
      || (event.name === 'TrainingReviewApplied' && (!Number.isInteger(event.args.operation) || event.args.operation < 0 || event.args.operation > 4))) throw Error('Unverified reviewed training event');
  }
  validateTrainingSnapshot({ ...state, history: state.history.filter(e => !reviewEvents.includes(e.name)) }, tokenId);
  return state;
}
export function validateReviewedTrainingReview(review, state, action, now = Date.now()) {
  validateGuard(state?.trainingGuard);
  const guard = review?.trainingGuard;
  if (!guard || Object.keys(guard).sort().join(',') !== 'deadline,nonce,protocol,stateHash'
    || guard.protocol !== REVIEW_PROTOCOL || guard.nonce !== state.trainingGuard.nonce
    || guard.stateHash !== state.trainingGuard.stateHash || !/^\d{1,12}$/.test(guard.deadline)
    || !Number.isSafeInteger(review.expiresAt) || BigInt(guard.deadline) * 1000n !== BigInt(review.expiresAt)
    || BigInt(guard.deadline) < BigInt(state.trainingGuard.blockTimestamp)
    || BigInt(guard.deadline) > BigInt(state.trainingGuard.blockTimestamp) + 60n) throw Error('Unverified on-chain training review');
  const expected = encodeReviewedTrainingCall({ tokenId: state.tokenId, operation: action.operation,
    ...(action.key !== undefined ? { skillKey: action.key } : {}), ...(action.slot !== undefined ? { slot: action.slot } : {}),
    nonce: guard.nonce, stateHash: guard.stateHash, deadline: guard.deadline });
  if (review.transaction?.data !== expected) throw Error('Unverified guarded training calldata');
  // Reuse only the common exact sender/target/gas/nonce/value/cost/expiry envelope.
  // The REAL calldata was independently reconstructed and checked above; it is
  // never replaced for submission. Legacy validation must reject guarded state.
  const { trainingGuard: _guard, ...envelope } = review;
  const { trainingGuard: _stateGuard, ...legacyState } = state;
  validateTrainingReview({ ...envelope, transaction: { ...review.transaction,
    data: trainingCalldata({ tokenId: state.tokenId, ...action }) } }, legacyState, action, now);
  return review;
}
