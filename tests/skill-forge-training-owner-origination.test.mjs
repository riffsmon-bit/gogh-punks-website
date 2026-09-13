import assert from 'node:assert/strict';
import test from 'node:test';
import { keccak256, stringToHex } from 'viem';
import { readTrainingOwnerOrigination } from '../broker/src/v4/skill-forge/training-owner-origination.mjs';
import { readReviewedTrainingState, assertTrainingOwnerContinuity } from '../broker/src/v4/skill-forge/training-state.mjs';
import released from '../deployments/robinhood-forge-training.json' with { type: 'json' };

const owner = `0x${'11'.repeat(20)}`, delegate = `0x${'22'.repeat(20)}`, other = `0x${'33'.repeat(20)}`;
const designation = `0xef0100${delegate.slice(2)}`, otherDesignation = `0xef0100${other.slice(2)}`;
const code = '0x60006000', hash = `0x${'ab'.repeat(32)}`, now = 1700000002000;
function fixture({ before = designation, after = before, beforeTarget = code, afterTarget = beforeTarget, latestOwner = owner } = {}) {
  const reads = [];
  const release = { ...released, allowedOwners: [owner] };
  for (const name of ['collection', 'registry', 'progression', 'trainingSource']) release[`${name}CodeHash`] = keccak256(code);
  const anchor = { number: '100', hash, timestamp: '1700000000' };
  const client = {
    getChainId: async () => 4663,
    getBlock: async ({ blockNumber } = {}) => ({ number: blockNumber ?? 101n, hash, timestamp: 1700000000n }),
    getCode: async ({ address, blockNumber }) => {
      reads.push({ address, blockNumber });
      if (address.toLowerCase() === owner) return blockNumber === 100n ? before : after;
      if ([delegate, other].includes(address.toLowerCase())) return blockNumber === 100n ? beforeTarget : afterTarget;
      return code;
    },
    getLogs: async () => [],
    readContract: async ({ functionName, args }) => {
      const constants = { collection: release.collection, registry: release.registry, trainingSource: release.trainingSource,
        REVIEW_DOMAIN: keccak256(stringToHex('GOGH_ORIGINAL_PUNK_TRAINING_REVIEW_V1')), MAX_REVIEW_LIFETIME: 60n,
        allocationRoot: release.allocationRoot, snapshotHash: release.snapshotHash, allocationChainId: 4663n,
        baseSlots: 1, slotCap: 7, ownerOf: latestOwner, trainingCredits: 1n, trainingReviewNonce: 0n,
        trainingReviewStateHash: hash, unlockedSlots: 1, claimedStartingSlots: 0, equipped: `0x${'0'.repeat(64)}`,
        learnedLevel: 0, available: true };
      if (functionName === 'definition') return { ...release.skills.find(s => s.key === args[0]), status: 4, disabled: false, deprecated: false };
      assert.ok(Object.hasOwn(constants, functionName), functionName); return constants[functionName];
    },
  };
  return { client, release, owner, tokenId: '93', anchor, now: () => now, reads };
}

test('actual training state accepts an existing exact delegated EOA designation with live target code', async () => {
  const f = fixture(), state = await readReviewedTrainingState(f);
  assert.equal(state.owner, owner); assert.equal(state.credits, '1'); assert.equal(state.skills[0].available, true);
  assert.ok(f.reads.some(r => r.address === delegate && r.blockNumber === 101n));
  assert.equal(Object.hasOwn(state, 'authorizationList'), false);
});

test('EOA training state remains supported without target-code reads', async () => {
  for (const value of [undefined, '0x']) {
    const f = fixture({ before: value, after: value });
    // Explicit undefined represents viem's empty-account return, not the fixture default.
    f.client.getCode = async ({ address }) => address === owner ? value : code;
    assert.equal((await readReviewedTrainingState(f)).credits, '1');
  }
});

for (const [name, ownerCode, targetCode] of [
  ['arbitrary contract owner', '0x60006000', code],
  ['truncated designation', designation.slice(0, -2), code],
  ['oversized designation', `${designation}00`, code],
  ['zero target', `0xef0100${'00'.repeat(20)}`, code],
  ['self target', `0xef0100${owner.slice(2)}`, code],
  ['empty delegate', designation, '0x'],
  ['missing delegate', designation, undefined],
  ['nested delegate', designation, otherDesignation],
  ['malformed delegate', designation, '0x6'],
  ['unknown owner runtime', null, code],
]) test(`training rejects ${name}`, async () => {
  const f = fixture({ before: ownerCode, after: ownerCode, beforeTarget: targetCode, afterTarget: targetCode });
  if (targetCode === undefined) f.client.getCode = async ({ address }) => address === owner ? ownerCode : address === delegate ? undefined : code;
  await assert.rejects(readReviewedTrainingState(f), /FORGE_TRAINING_STATE_UNVERIFIED/);
});

test('one-block reviews reuse their owner observation without duplicate target reads', async () => {
  const f = fixture(); f.client.getBlock = async () => ({ number: 100n, hash, timestamp: 1700000000n });
  await assertTrainingOwnerContinuity(f);
  assert.equal(f.reads.filter(r => r.address === owner).length, 1);
  assert.equal(f.reads.filter(r => r.address === delegate).length, 1);
});

test('unchanged delegation and code remain bound across the original review anchor and current head', async () => {
  const f = fixture(); assert.equal((await assertTrainingOwnerContinuity(f)).number, '101');
  for (const blockNumber of [100n, 101n]) assert.ok(f.reads.some(r => r.address === delegate && r.blockNumber === blockNumber));
});

for (const [name, changes] of [
  ['designation replaced', { after: otherDesignation }],
  ['delegation removed', { after: '0x' }],
  ['delegation introduced after EOA review', { before: '0x', after: designation }],
  ['target runtime changed', { afterTarget: '0x60016000' }],
  ['owner transferred', { latestOwner: other }],
]) test(`claim continuity rejects ${name}`, async () => {
  await assert.rejects(assertTrainingOwnerContinuity(fixture(changes)), /FORGE_TRAINING_STATE_UNVERIFIED/);
});

test('delegate read failures fail closed and do not become an EOA observation', async () => {
  const f = fixture(); f.client.getCode = async ({ address }) => { if (address === delegate) throw Error('READ_UNAVAILABLE'); return designation; };
  await assert.rejects(readTrainingOwnerOrigination({ client: f.client, owner, blockNumber: 100n }), /READ_UNAVAILABLE/);
});
