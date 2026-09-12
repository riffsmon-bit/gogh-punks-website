import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import deployment from '../deployments/robinhood-skill-forge.json' with { type: 'json' };
import { createOriginalForgeProfileReader, validateOriginalForgeDeployment, lockedOriginalForgeProfile } from '../broker/src/v4/skill-forge/original-punk-profile.mjs';
import { manifestHash, instructionHash, skillKey } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { validateForgeProfile, forgeSlotView } from '../site/forge-profile-view.js';
const ALICE = `0x${'1'.repeat(40)}`, BOB = `0x${'2'.repeat(40)}`, HASH = `0x${'a'.repeat(64)}`, ZERO = `0x${'0'.repeat(64)}`;
const KEY = skillKey(3, 1);
const undeployed = { ...deployment, status: 'UNDEPLOYED', registry: null, registryCodeHash: null,
  progression: null, progressionCodeHash: null, trainingSource: null, trainingSourceCodeHash: null };
function fixture() {
  const pack = { slug: 'contract-detective', manifest: { skillId: 3, version: 1, name: 'Contract Detective',
    chainId: 4663, capabilities: ['CONTRACT_READ'] }, instructions: 'Read only.', status: 'TESTING', approved: false };
  const config = { ...deployment, status: 'READ_ONLY_CANARY', collectionCodeHash: keccak256('0x01'),
    registry: `0x${'3'.repeat(40)}`, progression: `0x${'4'.repeat(40)}`, trainingSource: `0x${'5'.repeat(40)}`,
    registryCodeHash: keccak256('0x02'), progressionCodeHash: keccak256('0x03'), trainingSourceCodeHash: keccak256('0x04') };
  const definition = { skillId: 3, version: 1, manifestHash: manifestHash(pack.manifest),
    instructionHash: instructionHash(pack.instructions), capabilities: 1n, prerequisite: ZERO,
    status: 4, disabled: false, deprecated: false, replacement: ZERO, reviewEvidenceHash: HASH, riskTier: 0 };
  const values = { collection: config.collection, registry: config.registry, ownerOf: ALICE, unlockedSlots: 1,
    effectiveCapabilities: 1n, equipped: KEY, learnedLevel: 1, definition, available: true,
    trainingSource: config.trainingSource, baseSlots: 1, slotCap: 7, trainingCredits: 2n, learnedCount: 1n,
    claimedStartingSlots: 1, allocationRoot: config.allocationRoot, snapshotHash: config.snapshotHash,
    allocationChainId: 4663n, learnedKeyAt: KEY };
  const block = { number: 100n, timestamp: BigInt(Math.floor(Date.now() / 1000)), hash: HASH };
  const code = { [config.collection]: '0x01', [config.registry]: '0x02', [config.progression]: '0x03', [config.trainingSource]: '0x04' };
  const client = { getChainId: async () => 4663, getBlock: async () => block,
    getCode: async ({ address, blockNumber }) => { assert.equal(blockNumber, 100n); return code[address.toLowerCase()]; },
    readContract: async ({ functionName, blockNumber }) => { assert.equal(blockNumber, 100n); assert.ok(Object.hasOwn(values, functionName), functionName); return values[functionName]; } };
  return { config, pack, values, block, code, client, read: () => createOriginalForgeProfileReader({ client, deployment: config, packages: [pack] }) };
}
test('committed read release keeps writes locked, and undeployed profiles never fabricate progress', async () => {
  validateOriginalForgeDeployment(deployment);
  assert.equal(deployment.status, 'READ_ONLY_CANARY');
  assert.equal(deployment.productionTrainingAuthorized, false); assert.equal(deployment.productionBurnAuthorized, false);
  const profile = await createOriginalForgeProfileReader({ deployment: undeployed, client: new Proxy({}, { get() { throw Error('No RPC expected'); } }) })({ tokenId: '93', owner: ALICE });
  assert.deepEqual(profile, lockedOriginalForgeProfile()); assert.equal(profile.trainingCredits, null);
  assert.equal(forgeSlotView(validateForgeProfile(profile, { tokenId: '93', owner: ALICE })).filter(s => s.state === 'UNKNOWN').length, 7);
});
test('same original token keeps credits, learned levels and equipped slots when current owner changes', async () => {
  const f = fixture(); const read = f.read(), a = await read({ tokenId: '93', owner: ALICE });
  assert.equal(a.trainingCredits, '2'); assert.equal(a.learnedSkills[0].slug, 'contract-detective');
  validateForgeProfile(a, { tokenId: '93', owner: ALICE });
  assert.equal(forgeSlotView(a)[0].title, 'Contract Detective');
  assert.equal(forgeSlotView(a)[1].state, 'LOCKED');
  f.values.ownerOf = BOB;
  await assert.rejects(read({ tokenId: '93', owner: ALICE }), /OWNER_CHANGED/);
  const b = await read({ tokenId: '93', owner: BOB });
  for (const key of ['trainingCredits', 'learnedSkills', 'equippedSkills', 'unlockedSlots']) assert.deepEqual(a[key], b[key]);
  assert.equal(b.owner, BOB); assert.deepEqual(b.effectiveMcpTools, []);
  assert.equal(b.canBurn, false); assert.equal(b.canEquip, false); assert.equal(b.canLearn, false);
});
test('unknown or disabled versions retain history without claiming a working tool or safe package', async () => {
  const f = fixture(); f.values.available = false; f.values.definition.deprecated = true;
  f.values.definition.manifestHash = HASH;
  const p = await f.read()({ tokenId: '93', owner: ALICE });
  assert.equal(p.learnedSkills[0].level, 1); assert.equal(p.learnedSkills[0].packageVerified, false);
  assert.match(forgeSlotView(p)[0].detail, /DISABLED/); assert.deepEqual(p.effectiveMcpTools, []);
});
for (const [name, change] of Object.entries({
  chain: f => { f.client.getChainId = async () => 1; },
  owner: f => { f.values.ownerOf = BOB; },
  collectionBinding: f => { f.values.collection = BOB; },
  registryBinding: f => { f.values.registry = BOB; },
  collectionCode: f => { f.code[f.config.collection] = '0x'; },
  registryCode: f => { f.code[f.config.registry] = '0x'; },
  progressionCode: f => { f.code[f.config.progression] = '0x'; },
  sourceCode: f => { f.code[f.config.trainingSource] = '0x'; },
  sourceBinding: f => { f.values.trainingSource = BOB; },
  cap: f => { f.values.slotCap = 10; },
  allocation: f => { f.values.allocationRoot = HASH; },
  snapshot: f => { f.values.snapshotHash = HASH; },
  claim: f => { f.values.claimedStartingSlots = 4; },
  negativeCredits: f => { f.values.trainingCredits = -1n; },
  missingLearned: f => { f.values.learnedCount = 0n; },
  excessiveCatalog: f => { f.values.learnedCount = 129n; },
  duplicateLearned: f => { f.values.learnedCount = 2n; },
  wrongSkillKey: f => { f.values.definition.skillId = 8; },
  staleBlock: f => { f.block.timestamp -= 60n; },
  reorg: f => { let reads = 0; f.client.getBlock = async () => ({ ...f.block, hash: ++reads > 2 ? ZERO : HASH }); },
})) test(`profile rejects ${name} without substituting a zero state`, async () => {
  const f = fixture(); change(f); await assert.rejects(f.read()({ tokenId: '93', owner: ALICE }));
});
test('no runtime flag, wrapper, partial pins, or write manifest can enable original Forge reads', () => {
  for (const patch of [{ status: 'LIVE' }, { ownership: 'WRAPPED_NFT' }, { epochAuthority: {} },
    { registry: ALICE }, { productionBurnAuthorized: true }, { productionTrainingAuthorized: true },
    { slotCap: 10 }, { forgeSupplyFloor: 1000 }, { status: 'READ_ONLY_CANARY' }]) {
    assert.throws(() => validateOriginalForgeDeployment({ ...undeployed, ...patch }));
  }
});
test('frontend rejects foreign, stale, contradictory and unlearned loadouts', async () => {
  const f = fixture(), p = await f.read()({ tokenId: '93', owner: ALICE });
  for (const patch of [{ owner: BOB }, { tokenId: '94' }, { collection: BOB }, { blockTime: Date.now() - 60_000 },
    { canBurn: true }, { canLearn: true }, { effectiveMcpTools: ['send'] }, { learnedSkills: [] },
    { unlockedSlots: 8 }, { equippedSkills: [...p.equippedSkills, ...p.equippedSkills] },
    { equippedSkills: [{ ...p.equippedSkills[0], slot: 6 }] }]) {
    assert.throws(() => validateForgeProfile({ ...p, ...patch }, { tokenId: '93', owner: ALICE }));
  }
  assert.throws(() => validateForgeProfile({ ...lockedOriginalForgeProfile(), trainingCredits: '0' }, { tokenId: '93', owner: ALICE }));
});
