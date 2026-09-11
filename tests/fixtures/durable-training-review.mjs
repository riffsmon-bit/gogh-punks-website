import { TRAINING_REVIEW_SCHEMA } from '../../broker/src/v4/skill-forge/durable-training-review.mjs';

export const fixtureHash = digit => `0x${digit.repeat(64)}`;
export const TRAINING_STORE_BINDING = Object.freeze({ chainId: 31337,
  collection: `0x${'1'.repeat(40)}`, progression: `0x${'2'.repeat(40)}`, deploymentHash: fixtureHash('a') });
export const TRAINING_STORE_OWNER = `0x${'3'.repeat(40)}`;
export function durableReviewFixture(overrides = {}) {
  const seconds = Math.floor(Date.now() / 1000);
  return {
    schema: TRAINING_REVIEW_SCHEMA, ...TRAINING_STORE_BINDING, owner: TRAINING_STORE_OWNER, tokenId: '93',
    action: { operation: 'equip', skillKey: fixtureHash('b'), slot: 0, startingSlots: 0, rarityProof: [] },
    guard: { nonce: '2', stateHash: fixtureHash('c'), deadline: String(seconds + 55) },
    anchor: { number: '101', hash: fixtureHash('d'), timestamp: String(seconds) },
    transaction: { nonce: '8', gas: '250000', maxFeePerGas: '300000000', maxPriorityFeePerGas: '0' },
    ...overrides,
  };
}
