// Administrator preparation only. This module cannot sign, broadcast or promote server releases.
import { encodeFunctionData, getAddress, keccak256, parseAbi } from 'viem';
import { manifestHash, instructionHash, skillKey, SKILL_CAPABILITIES } from './capability-resolver.mjs';
const HASH = /^0x[0-9a-f]{64}$/i, ZERO = `0x${'0'.repeat(64)}`;
const ABI = parseAbi([
  'function owner() view returns(address)', 'function globallyDisabled() view returns(bool)',
  'function disabledCapabilities() view returns(uint256)', 'function skillCount() view returns(uint256)',
  'function keyAt(uint256) view returns(bytes32)', 'function available(bytes32) view returns(bool)',
  'function definition(bytes32) view returns((bytes32 manifestHash,bytes32 instructionHash,bytes32 prerequisite,uint256 capabilities,uint32 skillId,uint16 version,uint8 riskTier,uint8 status,bool disabled,bool deprecated,bytes32 replacement,bytes32 reviewEvidenceHash))',
  'function register(uint32,uint16,bytes32,bytes32,bytes32,uint256,uint8) returns(bytes32)',
  'function setStatus(bytes32,uint8,bytes32)',
]);
const READ_CAPABILITIES = new Set(['CONTRACT_READ', 'MARKET_READ', 'RARITY_READ', 'ART_CLASSIFY', 'SOCIAL_READ']);
const READ_TOOLS = Object.freeze({ CONTRACT_READ: ['inspect_contract'], MARKET_READ: ['get_market_listings', 'rank_observed_listings'],
  RARITY_READ: ['get_metadata', 'rank_trait_sample', 'research_collection'], ART_CLASSIFY: ['classify_collection'], SOCIAL_READ: ['research_project'] });
const fail = code => { throw Error(code); };
const hash = value => typeof value === 'string' && HASH.test(value) && value !== ZERO;
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).every(key => typeof key === 'string')
  && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => Object.hasOwn(d, 'value'));
function reviewedPackages(packages, reviewEvidence) {
  if (!Array.isArray(packages) || !packages.length || packages.length > 32 || !plain(reviewEvidence)) fail('SKILL_RELEASE_REVIEW_REQUIRED');
  const seen = new Set();
  return packages.map(pack => {
    const m = pack?.manifest;
    if (!plain(m) || !Number.isInteger(m.skillId) || m.skillId < 1 || m.skillId > 0xffffffff
      || !Number.isInteger(m.version) || m.version < 1 || m.version > 0xffff
      || m.chainId !== 4663 || m.schema !== 'GOGH_SKILL_PACKAGE_V1' || m.walletAuthority !== 'NONE'
      || m.riskTier !== 0 || !Array.isArray(m.requiredWalletCapabilities) || m.requiredWalletCapabilities.length
      || !Array.isArray(m.requiredExecutorCapabilities) || m.requiredExecutorCapabilities.length
      || !Array.isArray(m.capabilities) || !m.capabilities.length || m.capabilities.some(name => !READ_CAPABILITIES.has(name))
      || new Set(m.capabilities).size !== m.capabilities.length
      || !Array.isArray(m.requiredMcpTools) || !m.requiredMcpTools.length
      || m.requiredMcpTools.some(name => !m.capabilities.some(capability => READ_TOOLS[capability]?.includes(name)))
      || typeof m.name !== 'string' || m.name.length < 1 || m.name.length > 150
      || typeof pack.instructions !== 'string' || !pack.instructions.length
      || pack.manifestHash !== manifestHash(m) || pack.instructionHash !== instructionHash(pack.instructions)) fail('SKILL_RELEASE_READ_ONLY_PACKAGE_REQUIRED');
    const key = skillKey(m.skillId, m.version), review = reviewEvidence[key];
    if (seen.has(key) || !plain(review) || review.status !== 'APPROVED_FOR_REGISTRATION'
      || review.manifestHash !== pack.manifestHash || review.instructionHash !== pack.instructionHash
      || !hash(review.evidenceHash)) fail('SKILL_RELEASE_REVIEW_REQUIRED');
    seen.add(key);
    return Object.freeze({ key, name: m.name, skillId: m.skillId, version: m.version,
      manifestHash: pack.manifestHash, instructionHash: pack.instructionHash, prerequisite: ZERO,
      capabilities: m.capabilities.reduce((mask, name) => mask | SKILL_CAPABILITIES[name], 0n),
      riskTier: 0, evidenceHash: review.evidenceHash });
  });
}

export function createReadOnlySkillReleaseReview({ client, deployment, packages, reviewEvidence,
  maximumFeeWei = 100_000_000_000_000n, now = Date.now } = {}) {
  if (!client || deployment?.chainId !== 4663 || !hash(deployment.registryCodeHash)
    || typeof maximumFeeWei !== 'bigint' || maximumFeeWei <= 0n || maximumFeeWei > 100_000_000_000_000n
    || typeof now !== 'function') fail('SKILL_RELEASE_CONFIGURATION_INVALID');
  const registry = getAddress(deployment.registry), expectedCodeHash = deployment.registryCodeHash;
  // Copy definitions so later mutation of configuration cannot replace the reviewed bytes.
  const definitions = reviewedPackages(packages, reviewEvidence);
  const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15 - 60_000;
  const safe = async operation => {
    try { return await operation(); }
    catch (error) {
      if (/^SKILL_RELEASE_[A-Z_]+$/.test(error?.message ?? '')) throw error;
      // Provider errors can embed authenticated URLs and request/response bodies.
      throw Error('SKILL_RELEASE_CHAIN_UNAVAILABLE');
    }
  };
  async function readState() {
    if (await client.getChainId() !== 4663) fail('SKILL_RELEASE_WRONG_CHAIN');
    const block = await client.getBlock({ blockTag: 'latest' });
    if (typeof block.number !== 'bigint' || typeof block.timestamp !== 'bigint' || !hash(block.hash)
      || !validTime(now()) || Math.abs(now() - Number(block.timestamp) * 1000) > 30_000) fail('SKILL_RELEASE_STALE_CHAIN');
    const read = (functionName, args = []) => client.readContract({ address: registry, abi: ABI, functionName, args, blockNumber: block.number });
    const [code, owner, globallyDisabled, disabledCapabilities, count] = await Promise.all([
      client.getCode({ address: registry, blockNumber: block.number }), read('owner'), read('globallyDisabled'),
      read('disabledCapabilities'), read('skillCount'),
    ]);
    if (keccak256(code ?? '0x') !== expectedCodeHash) fail('SKILL_RELEASE_DEPLOYMENT_MISMATCH');
    if (typeof count !== 'bigint' || count < 0n || count > 128n) fail('SKILL_RELEASE_REGISTRY_BOUNDS');
    const keys = [];
    for (let start = 0n; start < count; start += 4n) {
      const batch = []; for (let i = start; i < count && i < start + 4n; i++) batch.push(read('keyAt', [i]));
      keys.push(...await Promise.all(batch));
    }
    if (keys.some(key => !hash(key)) || new Set(keys).size !== keys.length) fail('SKILL_RELEASE_REGISTRY_INVALID');
    const skills = [];
    for (const expected of definitions) {
      const existing = keys.includes(expected.key) ? await read('definition', [expected.key]) : null;
      const available = existing ? await read('available', [expected.key]) : false;
      if (existing && ['skillId', 'version', 'manifestHash', 'instructionHash', 'prerequisite', 'capabilities', 'riskTier']
        .some(name => existing[name] !== expected[name])) fail('SKILL_RELEASE_EXISTING_DEFINITION_MISMATCH');
      if (existing && ![0, 1, 2, 3, 4, 5, 6].includes(existing.status)) fail('SKILL_RELEASE_REGISTRY_INVALID');
      // Inspection also serves saved-transaction recovery. A governance block
      // removes preparation authority for this version, not visibility of the
      // current administrator or another version's already-sent transaction.
      const reviewBlocked = existing && (existing.disabled || existing.deprecated || [5, 6].includes(existing.status));
      const blocked = globallyDisabled || (BigInt(disabledCapabilities) & expected.capabilities) !== 0n;
      const action = reviewBlocked ? 'REVIEW_BLOCKED' : blocked ? 'EMERGENCY_DISABLED' : !existing ? 'REGISTER' : existing.status === 4 ? 'REGISTERED_READY'
        : existing.status === 3 ? 'MARK_READY' : 'MARK_TESTING';
      const args = action === 'REGISTER' ? [expected.skillId, expected.version, expected.manifestHash,
        expected.instructionHash, expected.prerequisite, expected.capabilities, expected.riskTier]
        : ['MARK_TESTING', 'MARK_READY'].includes(action) ? [expected.key, action === 'MARK_TESTING' ? 3 : 4, expected.evidenceHash] : null;
      skills.push({ ...expected, capabilities: String(expected.capabilities), action, available,
        registeredStatus: existing?.status ?? null, existingReviewEvidenceHash: existing?.reviewEvidenceHash ?? null,
        nextCalldata: args ? encodeFunctionData({ abi: ABI, functionName: action === 'REGISTER' ? 'register' : 'setStatus', args }) : null });
    }
    const closing = await client.getBlock({ blockNumber: block.number });
    if (closing.hash !== block.hash || await client.getChainId() !== 4663) fail('SKILL_RELEASE_CHAIN_CHANGED');
    return { schema: 'GOGH_READ_ONLY_SKILL_RELEASE_STATE_V1', chainId: 4663, registry, registryCodeHash: expectedCodeHash,
      administrator: getAddress(owner), anchor: { number: String(block.number), hash: block.hash, timestamp: String(block.timestamp) },
      skills, publicTransactions: 0, serverReleaseActivated: false };
  }
  return Object.freeze({
    inspect: () => safe(readState),
    async prepareNext({ key, administrator } = {}) {
      return safe(async () => {
      if (!definitions.some(item => item.key === key)) fail('SKILL_RELEASE_KEY_NOT_REVIEWED');
      const state = await readState();
      if (getAddress(administrator) !== state.administrator) fail('SKILL_RELEASE_ADMINISTRATOR_CHANGED');
      const step = state.skills.find(item => item.key === key);
      if (!step.nextCalldata) fail(step.action === 'REGISTERED_READY' ? 'SKILL_RELEASE_ALREADY_READY'
        : step.action === 'REVIEW_BLOCKED' ? 'SKILL_RELEASE_REVIEW_BLOCKED' : 'SKILL_RELEASE_EMERGENCY_DISABLED');
      const transaction = { account: state.administrator, to: registry, data: step.nextCalldata, value: 0n };
      await client.call({ ...transaction, blockNumber: BigInt(state.anchor.number) });
      const [estimate, gasPrice, latest, pending] = await Promise.all([client.estimateGas(transaction), client.getGasPrice(),
        client.getTransactionCount({ address: state.administrator, blockTag: 'latest' }),
        client.getTransactionCount({ address: state.administrator, blockTag: 'pending' })]);
      if (latest !== pending || !Number.isSafeInteger(latest) || latest < 0) fail('SKILL_RELEASE_PENDING_ADMIN_TRANSACTION');
      if (typeof estimate !== 'bigint' || estimate <= 0n || estimate > 500_000n
        || typeof gasPrice !== 'bigint' || gasPrice <= 0n) fail('SKILL_RELEASE_FEE_UNAVAILABLE');
      const gas = (estimate * 6n + 4n) / 5n, price = (gasPrice * 11n + 9n) / 10n, fee = gas * price;
      if (fee > maximumFeeWei) fail('SKILL_RELEASE_FEE_CEILING');
      const checked = await readState(), timestamp = now();
      if (checked.administrator !== state.administrator
        || checked.skills.find(item => item.key === key)?.nextCalldata !== step.nextCalldata
        || !validTime(timestamp)) fail('SKILL_RELEASE_STATE_CHANGED');
      const [closingLatest, closingPending, balance] = await Promise.all([
        client.getTransactionCount({ address: state.administrator, blockTag: 'latest' }),
        client.getTransactionCount({ address: state.administrator, blockTag: 'pending' }),
        client.getBalance({ address: state.administrator, blockTag: 'pending' }),
      ]);
      if (closingLatest !== latest || closingPending !== latest) fail('SKILL_RELEASE_PENDING_ADMIN_TRANSACTION');
      if (typeof balance !== 'bigint' || balance < fee) fail('SKILL_RELEASE_ADMIN_GAS_REQUIRED');
      const hex = value => `0x${BigInt(value).toString(16)}`;
      return { schema: 'GOGH_READ_ONLY_SKILL_RELEASE_PREPARATION_V1', key, name: step.name, action: step.action,
        reviewEvidenceHash: step.evidenceHash, manifestHash: step.manifestHash, instructionHash: step.instructionHash,
        chainId: 4663, anchor: checked.anchor, expiresAt: timestamp + 60_000, maximumNetworkFeeWei: String(fee),
        transaction: { from: state.administrator, to: registry, data: step.nextCalldata, value: '0x0', chainId: '0x1237',
          nonce: hex(latest), gas: hex(gas), gasPrice: hex(price) },
        walletConfirmationRequired: true, publicTransactions: 0, serverReleaseActivated: false,
        instructions: 'Confirm this exact registry step in your administrator wallet. Verify its receipt, then prepare the next step. Registration does not teach or equip a holder skill.' };
      });
    },
  });
}
