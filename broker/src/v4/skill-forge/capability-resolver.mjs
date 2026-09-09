import { createHash } from 'node:crypto';
import { encodeAbiParameters, getAddress, keccak256, parseAbi, parseAbiParameters } from 'viem';

export const SKILL_CAPABILITIES = Object.freeze({ CONTRACT_READ: 1n, FREE_MINT: 2n,
  MARKET_READ: 4n, RARITY_READ: 8n, LINK_REVIEW: 16n, SCHEDULED_MISSION: 32n,
  ART_CLASSIFY: 64n, SOCIAL_READ: 128n, PAID_MINT: 256n });
// These are approved tool identities, not dynamically trusted provider tool names.
const TOOLS = Object.freeze({ CONTRACT_READ: ['inspect_contract'], FREE_MINT: ['inspect_mint', 'simulate_mint', 'prepare_mint'],
  MARKET_READ: ['get_market_listings'], RARITY_READ: ['get_metadata', 'rank_trait_sample'], LINK_REVIEW: ['inspect_mint_link'],
  SCHEDULED_MISSION: ['draft_scheduled_mission'], ART_CLASSIFY: ['classify_collection'], SOCIAL_READ: ['research_project'],
  PAID_MINT: [] });
const HASH = /^0x[0-9a-f]{64}$/i;
const canonical = value => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  throw new Error('NON_CANONICAL_MANIFEST');
};
export const manifestHash = value => `0x${createHash('sha256').update(canonical(value)).digest('hex')}`;
export const instructionHash = text => `0x${createHash('sha256').update(text).digest('hex')}`;
export const skillKey = (id, version) => keccak256(encodeAbiParameters(parseAbiParameters('string,uint32,uint16'), ['GOGH_SKILL', id, version]));

const ABI = parseAbi([
  'function collection() view returns (address)', 'function registry() view returns (address)',
  'function ownerOf(uint256) view returns (address)', 'function unlockedSlots(uint256) view returns (uint8)',
  'function equipped(uint256,uint8) view returns (bytes32)', 'function learnedLevel(uint256,bytes32) view returns (uint8)',
  'function effectiveCapabilities(uint256) view returns (uint256)',
  'function available(bytes32) view returns (bool)',
  'function definition(bytes32) view returns ((bytes32 manifestHash,bytes32 instructionHash,bytes32 prerequisite,uint256 capabilities,uint32 skillId,uint16 version,uint8 riskTier,uint8 status,bool disabled,bool deprecated,bytes32 replacement,bytes32 reviewEvidenceHash))',
]);

// Configuration MUST come from a reviewed deployment, never request/AI arguments.
export function createProgressionReader({ client, chainId, collection, registry, progression,
  registryCodeHash, progressionCodeHash }) {
  if (!HASH.test(registryCodeHash) || !HASH.test(progressionCodeHash)) throw new Error('DEPLOYMENT_PINS_REQUIRED');
  collection = getAddress(collection); registry = getAddress(registry); progression = getAddress(progression);
  return async tokenId => {
    if (!/^(0|[1-9][0-9]{0,77})$/.test(String(tokenId))) throw new Error('INVALID_TOKEN_ID');
    if (await client.getChainId() !== chainId) throw new Error('WRONG_CHAIN');
    const block = await client.getBlock({ blockTag: 'latest' });
    if (typeof block.number !== 'bigint' || typeof block.timestamp !== 'bigint' || !HASH.test(block.hash)) throw new Error('INVALID_BLOCK');
    const read = (address, functionName, args = []) => client.readContract({ address, abi: ABI, functionName, args, blockNumber: block.number });
    const [collectionRead, registryRead, registryCode, progressionCode] = await Promise.all([
      read(progression, 'collection'), read(progression, 'registry'),
      client.getCode({ address: registry, blockNumber: block.number }), client.getCode({ address: progression, blockNumber: block.number }),
    ]);
    if (getAddress(collectionRead) !== collection || getAddress(registryRead) !== registry
      || keccak256(registryCode ?? '0x') !== registryCodeHash || keccak256(progressionCode ?? '0x') !== progressionCodeHash) throw new Error('DEPLOYMENT_MISMATCH');
    const [owner, slots, mask] = await Promise.all([read(collection, 'ownerOf', [BigInt(tokenId)]),
      read(progression, 'unlockedSlots', [BigInt(tokenId)]), read(progression, 'effectiveCapabilities', [BigInt(tokenId)])]);
    if (!Number.isInteger(slots) || slots < 1 || slots > 32) throw new Error('INVALID_SLOTS');
    const equipped = [];
    for (let slot = 0; slot < slots; slot++) {
      const key = await read(progression, 'equipped', [BigInt(tokenId), slot]);
      if (key === `0x${'0'.repeat(64)}`) continue;
      const [level, definition, available] = await Promise.all([read(progression, 'learnedLevel', [BigInt(tokenId), key]),
        read(registry, 'definition', [key]), read(registry, 'available', [key])]);
      equipped.push({ slot, key, level, definition, available });
    }
    // Detect reorg during the multi-read snapshot; the execution layer must still recheck.
    if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('REORG_DURING_READ');
    return { chainId, collection, tokenId: String(tokenId), owner: getAddress(owner), slots, mask: String(mask), equipped,
      blockNumber: String(block.number), blockHash: block.hash, blockTime: Number(block.timestamp) * 1000 };
  };
}

/// Packages is the reviewed, hash-pinned server catalog; never owner-submitted SKILL.md.
/// The result grants tool eligibility only. It contains NO wallet authorization.
export function resolvePunkCapabilities(state, { packages, owner, now = Date.now(), availableTools = [] }) {
  if (!state || !HASH.test(state.blockHash) || !Number.isSafeInteger(state.blockTime)
    || now < state.blockTime || now - state.blockTime > 30_000) throw new Error('STALE_PROGRESSION');
  if (!owner || getAddress(owner) !== getAddress(state.owner)) throw new Error('OWNER_CHANGED');
  if (!Array.isArray(packages) || !Array.isArray(state.equipped) || !Number.isInteger(state.slots)
    || state.slots < 1 || state.slots > 32 || !/^(0|[1-9][0-9]{0,77})$/.test(state.mask)) throw new Error('INVALID_PROGRESSION');
  const seen = new Set(); const seenSlots = new Set(); const selected = []; const tools = new Set(); const capabilities = new Set();
  for (const item of state.equipped) {
    if (seen.has(item.key) || seenSlots.has(item.slot) || !Number.isInteger(item.slot) || item.slot < 0 || item.slot >= state.slots) throw new Error('INVALID_LOADOUT');
    seen.add(item.key); seenSlots.add(item.slot);
    const definition = item.definition;
    if (!definition || item.available !== true || definition.status !== 4 || definition.disabled !== false
      || definition.deprecated !== false || !Number.isInteger(item.level) || item.level < 1 || item.level > 255) continue;
    const pack = packages.find(p => skillKey(p.manifest.skillId, p.manifest.version) === item.key);
    if (!pack || pack.status !== 'READY' || !pack.approved || typeof pack.instructions !== 'string') continue;
    if (manifestHash(pack.manifest) !== definition.manifestHash || instructionHash(pack.instructions) !== definition.instructionHash) throw new Error('PACKAGE_HASH_MISMATCH');
    if (pack.manifest.chainId !== state.chainId || !Array.isArray(pack.manifest.capabilities)) throw new Error('PACKAGE_CHAIN_OR_CAPABILITY_MISMATCH');
    let mask = 0n;
    for (const name of pack.manifest.capabilities) {
      if (!Object.hasOwn(SKILL_CAPABILITIES, name)) throw new Error('UNREVIEWED_CAPABILITY');
      mask |= SKILL_CAPABILITIES[name];
    }
    if (mask !== BigInt(definition.capabilities)) throw new Error('REGISTRY_CAPABILITY_MISMATCH');
    if ((BigInt(state.mask) & mask) !== mask) continue;
    for (const name of pack.manifest.capabilities) {
      capabilities.add(name);
      for (const tool of TOOLS[name]) if (availableTools.includes(tool)) tools.add(tool);
    }
    selected.push({ key: item.key, level: item.level, instructions: pack.instructions,
      manifestHash: definition.manifestHash, instructionHash: definition.instructionHash });
  }
  return Object.freeze({ tokenId: state.tokenId, owner: state.owner, blockHash: state.blockHash,
    effectiveProtocolCapabilities: Object.freeze([...capabilities]), effectiveMcpTools: Object.freeze([...tools]),
    instructionPackages: Object.freeze(selected), walletAuthority: 'NONE',
    requiresSeparateEconomicAuthorization: true });
}

// Both AI context and MCP tool calls resolve fresh state through the SAME gate.
// This is an additive integration seam; public V2 endpoints are not switched over yet.
export function createSkillToolGate({ readState, packages, implementations }) {
  const resolve = async ({ tokenId, owner }) => {
    const state = await readState(tokenId);
    if (String(state?.tokenId) !== String(tokenId)) throw new Error('PUNK_IDENTITY_MISMATCH');
    return resolvePunkCapabilities(state, { packages, owner, availableTools: Object.keys(implementations) });
  };
  return Object.freeze({
    resolve,
    async call({ tokenId, owner, name, arguments: args = {} }) {
      const context = await resolve({ tokenId, owner });
      if (!context.effectiveMcpTools.includes(name)) throw new Error('SKILL_TOOL_DENIED');
      if (!args || typeof args !== 'object' || Array.isArray(args)
        || args.tokenId !== undefined && String(args.tokenId) !== String(context.tokenId)
        || args.owner !== undefined && getAddress(args.owner) !== getAddress(context.owner)) throw new Error('TOOL_IDENTITY_MISMATCH');
      const result = await implementations[name]({ ...args, tokenId: context.tokenId, owner: context.owner }, context);
      // Read-only providers may take long enough for a transfer, unequip or emergency disable.
      // Never deliver their result using authority that disappeared while the call ran.
      const after = await resolve({ tokenId, owner });
      if (!after.effectiveMcpTools.includes(name)
        || canonical(after.instructionPackages) !== canonical(context.instructionPackages)) throw new Error('SKILL_CONTEXT_CHANGED');
      return result;
    },
  });
}
