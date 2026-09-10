import { getAddress, keccak256, parseAbi } from 'viem';
import { createProgressionReader, resolvePunkCapabilities, skillKey, manifestHash, instructionHash } from './capability-resolver.mjs';

const ADDRESS = /^0x[0-9a-f]{40}$/i, HASH = /^0x[0-9a-f]{64}$/i;
const ZERO = `0x${'0'.repeat(64)}`;
const COLLECTION = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
const STATUS = ['DISCOVERED', 'UNDER_REVIEW', 'ADAPTING', 'TESTING', 'READY', 'BLOCKED', 'REJECTED'];
const ABI = parseAbi([
  'function trainingSource() view returns (address)', 'function baseSlots() view returns (uint8)',
  'function slotCap() view returns (uint8)', 'function trainingCredits(uint256) view returns (uint256)',
  'function learnedCount(uint256) view returns (uint256)', 'function learnedKeyAt(uint256,uint256) view returns (bytes32)',
  'function learnedLevel(uint256,bytes32) view returns (uint8)', 'function available(bytes32) view returns (bool)',
  'function claimedStartingSlots(uint256) view returns (uint8)', 'function allocationRoot() view returns (bytes32)',
  'function snapshotHash() view returns (bytes32)', 'function allocationChainId() view returns (uint256)',
  'function definition(bytes32) view returns ((bytes32 manifestHash,bytes32 instructionHash,bytes32 prerequisite,uint256 capabilities,uint32 skillId,uint16 version,uint8 riskTier,uint8 status,bool disabled,bool deprecated,bytes32 replacement,bytes32 reviewEvidenceHash))',
]);

// A release-reviewed file, never URL parameters, browser input, or an environment switch.
export function validateOriginalForgeDeployment(config) {
  if (!config || config.schemaVersion !== 'GOGH_ORIGINAL_PUNK_FORGE_READ_V1'
    || config.chainId !== 4663 || config.collection?.toLowerCase() !== COLLECTION
    || config.ownership !== 'ORIGINAL_NFT' || config.epochAuthority != null
    || config.slotCap !== 7 || config.forgeSupplyFloor !== 1111
    || !HASH.test(config.collectionCodeHash) || !HASH.test(config.allocationRoot) || !HASH.test(config.snapshotHash)
    || config.productionTrainingAuthorized !== false || config.productionBurnAuthorized !== false
    || !['UNDEPLOYED', 'READ_ONLY_CANARY'].includes(config.status)) throw Error('FORGE_DEPLOYMENT_INVALID');
  for (const name of ['registry', 'progression', 'trainingSource']) {
    if (config.status === 'UNDEPLOYED') {
      if (config[name] !== null || config[`${name}CodeHash`] !== null) throw Error('FORGE_DEPLOYMENT_INVALID');
    } else if (!ADDRESS.test(config[name]) || /^0x0{40}$/i.test(config[name])
      || !HASH.test(config[`${name}CodeHash`]) || config[`${name}CodeHash`] === ZERO) throw Error('FORGE_DEPLOYMENT_PINS_REQUIRED');
  }
  return Object.freeze({ ...config });
}

export const lockedOriginalForgeProfile = () => ({ status: 'NOT_DEPLOYED', ownership: 'ORIGINAL_NFT',
  verified: false, trainingCredits: null, learnedSkills: null, equippedSkills: null,
  unlockedSlots: null, claimedStartingSlots: null, slotCap: 7, effectiveMcpTools: [],
  walletAuthority: 'NONE', canLearn: false, canEquip: false, canBurn: false,
  note: 'Permanent training contracts are not deployed. Unknown progression is not a zero balance.' });

export function createOriginalForgeProfileReader({ client, deployment, packages = [] }) {
  const config = validateOriginalForgeDeployment(deployment);
  const readState = config.status === 'READ_ONLY_CANARY' ? createProgressionReader({ client,
    chainId: config.chainId, collection: config.collection, registry: config.registry, progression: config.progression,
    registryCodeHash: config.registryCodeHash, progressionCodeHash: config.progressionCodeHash }) : null;
  return async ({ tokenId, owner }) => {
    if (!/^(0|[1-9]\d{0,3})$/.test(tokenId) || !ADDRESS.test(owner) || /^0x0{40}$/i.test(owner)) throw Error('FORGE_IDENTITY_REQUIRED');
    if (!readState) return lockedOriginalForgeProfile();
    const state = await readState(tokenId);
    const blockNumber = BigInt(state.blockNumber), args = [BigInt(tokenId)];
    const read = (address, functionName, values = []) => client.readContract({ address, abi: ABI, functionName, args: values, blockNumber });
    const progress = (name, values = []) => read(config.progression, name, values);
    const [collectionCode, sourceCode, source, base, cap, credits, count, claimed, root, snapshot, allocationChainId] = await Promise.all([
      client.getCode({ address: config.collection, blockNumber }), client.getCode({ address: config.trainingSource, blockNumber }),
      progress('trainingSource'), progress('baseSlots'), progress('slotCap'), progress('trainingCredits', args),
      progress('learnedCount', args), progress('claimedStartingSlots', args), progress('allocationRoot'),
      progress('snapshotHash'), progress('allocationChainId'),
    ]);
    if (keccak256(collectionCode ?? '0x') !== config.collectionCodeHash || keccak256(sourceCode ?? '0x') !== config.trainingSourceCodeHash
      || getAddress(source) !== getAddress(config.trainingSource) || base !== 1 || cap !== config.slotCap
      || state.slots > cap || !Number.isInteger(claimed) || claimed < 0 || claimed > 3
      || state.slots < (claimed || 1) || root !== config.allocationRoot || snapshot !== config.snapshotHash
      || allocationChainId !== BigInt(config.chainId)) throw Error('FORGE_DEPLOYMENT_MISMATCH');
    // Bounded reader: a future expanded catalog needs a deliberate release, not unbounded RPC fan-out.
    if (typeof credits !== 'bigint' || credits < 0n || typeof count !== 'bigint' || count < 0n || count > 128n) throw Error('FORGE_PROGRESSION_INVALID');
    const learned = [], seen = new Set();
    for (let i = 0n; i < count; i++) {
      const key = await progress('learnedKeyAt', [...args, i]);
      if (!HASH.test(key) || key === ZERO || seen.has(key)) throw Error('FORGE_PROGRESSION_INVALID');
      seen.add(key);
      const [level, definition, available] = await Promise.all([progress('learnedLevel', [...args, key]),
        read(config.registry, 'definition', [key]), read(config.registry, 'available', [key])]);
      if (!Number.isInteger(level) || level < 1 || level > 255 || !definition
        || skillKey(definition.skillId, definition.version) !== key || !STATUS[definition.status]
        || typeof available !== 'boolean') throw Error('FORGE_PROGRESSION_INVALID');
      const pack = packages.find(p => skillKey(p.manifest.skillId, p.manifest.version) === key);
      const known = pack && manifestHash(pack.manifest) === definition.manifestHash
        && instructionHash(pack.instructions) === definition.instructionHash;
      learned.push({ key, skillId: definition.skillId, version: definition.version, level,
        name: known ? pack.manifest.name : `Skill ${definition.skillId} · version ${definition.version}`,
        slug: known ? (pack.slug ?? null) : null, packageVerified: Boolean(known),
        status: STATUS[definition.status], available, disabled: definition.disabled,
        deprecated: definition.deprecated, manifestHash: definition.manifestHash,
        instructionHash: definition.instructionHash });
    }
    for (const item of state.equipped) {
      if (!learned.some(s => s.key === item.key && s.level === item.level)) throw Error('FORGE_PROGRESSION_INVALID');
    }
    // The canonical resolver, not the displayed registry status, decides tool eligibility.
    const context = resolvePunkCapabilities(state, { packages, owner, availableTools: [] });
    if ((await client.getBlock({ blockNumber })).hash !== state.blockHash) throw Error('FORGE_REORG_DURING_READ');
    return { status: 'VERIFIED_READ_ONLY', ownership: 'ORIGINAL_NFT', verified: true,
      tokenId, owner: state.owner, collection: config.collection, registry: config.registry, progression: config.progression,
      trainingCredits: String(credits), learnedSkills: learned,
      equippedSkills: state.equipped.map(({ slot, key, level }) => ({ slot, key, level })),
      unlockedSlots: state.slots, claimedStartingSlots: claimed, slotCap: cap,
      blockNumber: state.blockNumber, blockHash: state.blockHash, blockTime: state.blockTime,
      // No production tool route or economic authorization is installed by a profile GET.
      effectiveMcpTools: context.effectiveMcpTools, walletAuthority: 'NONE',
      canLearn: false, canEquip: false, canBurn: false,
      note: 'Confirmed token-bound progression. Read-only canary; training transactions and burns are locked.' };
  };
}
