// Production read model, real local contracts; no public transactions or credentials.
import assert from 'node:assert/strict';
import { startEpochWorld } from './dev/epoch/local-world.mjs';
import { epochFixtureDeployment } from './dev/epoch/fixture-deployment.mjs';
import { readEpochRoster, readEpochPunkProfile, describeEpochEnrollment } from '../broker/src/agent-account/punk-epoch-profile.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw Error('Requires --local-only');
const world = await startEpochWorld();
try {
  const deployment = await epochFixtureDeployment(world);
  const roster = (owner, client = world.client) => readEpochRoster({ client, deployment, owner });
  const profile = (owner = world.alice, client = world.client) => readEpochPunkProfile({ client, deployment, tokenId: '93', expectedOwner: owner });
  assert.deepEqual((await roster(world.alice)).tokenIds, []);
  const before = await profile(); assert.equal(before.accountCreated, false);
  assert.equal(before.legacyWalletOwnerAccess, true); assert.equal(before.training.credits, '3');
  for (const action of ['wrap', 'create', 'learn', 'equip', 'authorize']) await world.action(action);
  const active = await profile(); assert.equal(active.sessionActive, true); assert.equal(active.legacyWalletOwnerAccess, false);
  assert.deepEqual((await roster(world.alice)).tokenIds, ['93']); assert.equal(active.training.learned.length, 2);
  await world.action('transfer');
  assert.deepEqual((await roster(world.alice)).tokenIds, []); assert.deepEqual((await roster(world.bob)).tokenIds, ['93']);
  await assert.rejects(profile(), /NOT_CURRENT_OWNER/);
  const bob = await profile(world.bob); assert.deepEqual(bob.training, active.training); assert.equal(bob.sessionActive, false);
  assert.equal(bob.agentAccount, active.agentAccount); assert.notEqual(bob.authorityEpoch, active.authorityEpoch);
  await world.action('transfer');
  const returned = await profile(); assert.equal(returned.sessionActive, false); assert.notEqual(returned.authorityEpoch, active.authorityEpoch);
  assert.deepEqual(returned.training, active.training);
  await world.action('unwrap'); assert.deepEqual((await roster(world.alice)).tokenIds, []);
  const unwrapped = await profile(); assert.equal(unwrapped.legacyWalletOwnerAccess, true);
  assert.deepEqual(unwrapped.training, active.training); assert.equal(unwrapped.sessionActive, false);
  await world.action('wrap');
  const faults = [
    [{ getChainId: async () => 1 }, /WRONG_CHAIN/],
    [{ getCode: async () => '0x6000' }, /EPOCH_RUNTIME_MISMATCH/],
    [{ readContract: args => args.functionName === 'implementation' ? world.alice : world.client.readContract(args) }, /EPOCH_BINDING_MISMATCH/],
    [{ readContract: args => args.functionName === 'balanceOf' ? 5017n : world.client.readContract(args) }, /EPOCH_ROSTER_BOUND/],
    [{ readContract: args => args.functionName === 'balanceOf' ? 2n : args.functionName === 'tokenOfOwnerByIndex' ? 93n : world.client.readContract(args) }, /EPOCH_ROSTER_MISMATCH/],
    [{ readContract: args => args.functionName === 'ownerOf' && args.address === deployment.canonicalCollection ? world.alice : world.client.readContract(args) }, /EPOCH_ROSTER_MISMATCH/],
    [{ getBlock: async args => { const b = await world.client.getBlock(args); return args.blockNumber === undefined ? b : { ...b, hash: `0x${'f'.repeat(64)}` }; } }, /EPOCH_SNAPSHOT_CHANGED/],
  ];
  for (const [overrides, error] of faults) await assert.rejects(roster(world.alice, { ...world.client, ...overrides }), error);
  for (const [name, value] of [['unlockedSlots', undefined], ['slotCap', 8], ['learnedCount', 257n], ['trainingCredits', -1n]]) {
    await assert.rejects(profile(world.alice, { ...world.client,
      readContract: args => args.functionName === name ? value : world.client.readContract(args) }), /INVALID_PROGRESSION/);
  }
  const reorgClient = { ...world.client, getBlock: async args => {
    const result = await world.client.getBlock(args);
    if (args.blockTag === 'latest') await world.client.request({ method: 'evm_mine', params: [] });
    return result;
  } };
  assert.deepEqual((await roster(world.alice, reorgClient)).tokenIds, ['93'], 'ordinary block advancement must not fail read-only views');
  const enrollment = describeEpochEnrollment(await profile());
  assert.equal(enrollment.canSubmit, false); assert.equal(enrollment.productionTransactionsEnabled, false);
  console.log(JSON.stringify({ result: 'PASS', scope: 'LOCAL_REAL_CONTRACT_READ_MODEL',
    transferPersistence: true, oldOwnerRejected: true, roundTripSessionInactive: true,
    malformedSnapshotsRejected: faults.length + 4, normalBlockAdvancement: true,
    productionEnrollmentLocked: true, productionTransactions: 0 }, null, 2));
} finally { await world.close(); }
