// Registry-only REVIEW tooling. No signer, transaction sender, credit source or
// production activation. A valid packet is NOT deployment authorization.
import { readFile } from 'node:fs/promises';
import { encodeDeployData, encodeFunctionData, getAddress, getContractAddress, keccak256, parseAbi } from 'viem';
import { manifestHash, instructionHash, skillKey } from './capability-resolver.mjs';
import { loadResearchSkillCatalog } from './research-runtime.mjs';
import deployment from '../../../../deployments/robinhood-skill-forge.json' with { type: 'json' };
const ROOT = new URL('../../../../', import.meta.url);
const ZERO = `0x${'0'.repeat(64)}`, NONE = `0x${'0'.repeat(40)}`;
const MASK = (2n ** 256n - 1n).toString();
const SCHEMA = 'GOGH_REGISTRY_ONLY_CANARY_PROPOSAL_V1';
export const EMPTY_GUARDIAN_CONTEXT = Object.freeze({ kind: 'EOA', codeHash: keccak256('0x'), delegation: null, delegationCodeHash: null });
const READS = parseAbi(['function owner() view returns(address)', 'function pendingOwner() view returns(address)',
  'function skillCount() view returns(uint256)', 'function globallyDisabled() view returns(bool)',
  'function disabledCapabilities() view returns(uint256)', 'function available(bytes32) view returns(bool)',
  'function definition(bytes32) view returns((bytes32 manifestHash,bytes32 instructionHash,bytes32 prerequisite,uint256 capabilities,uint32 skillId,uint16 version,uint8 riskTier,uint8 status,bool disabled,bool deprecated,bytes32 replacement,bytes32 reviewEvidenceHash))']);
const eq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hash = value => /^0x[0-9a-f]{64}$/i.test(value ?? '') && !eq(value, ZERO);
const uint = value => typeof value === 'string' && /^(0|[1-9]\d{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const PACKS = [{ slug: 'contract-detective', id: 3, capability: 'CONTRACT_READ', mask: '1', tools: ['inspect_contract'] },
  { slug: 'rarity-eye', id: 4, capability: 'RARITY_READ', mask: '8', tools: ['get_metadata', 'rank_trait_sample'] },
  { slug: 'market-scout', id: 8, capability: 'MARKET_READ', mask: '4', tools: ['get_market_listings'] }];

export async function loadRegistryCanaryInputs({ root = ROOT } = {}) {
  const artifact = JSON.parse(await readFile(new URL('contracts/out/GoghSkillRegistry.sol/GoghSkillRegistry.json', root), 'utf8'));
  const meta = artifact.metadata;
  if (meta?.compiler?.version !== '0.8.34+commit.80d5c536' || meta.settings?.viaIR !== true
    || meta.settings.optimizer?.enabled !== true || meta.settings.optimizer.runs !== 500 || meta.settings.evmVersion !== 'cancun'
    || meta.settings.compilationTarget?.['contracts/src/GoghSkillRegistry.sol'] !== 'GoghSkillRegistry'
    || Object.keys(artifact.bytecode?.linkReferences ?? {}).length || Object.keys(artifact.deployedBytecode?.immutableReferences ?? {}).length
    || !/^0x[0-9a-f]+$/i.test(artifact.bytecode?.object ?? '') || !/^0x[0-9a-f]+$/i.test(artifact.deployedBytecode?.object ?? '')
    || (artifact.deployedBytecode.object.length - 2) / 2 > 24576) throw Error('UNVERIFIED_REGISTRY_BUILD');
  const paths = Object.keys(meta.sources ?? {});
  if (paths.length !== 4 || !paths.includes('contracts/src/GoghSkillRegistry.sol')) throw Error('UNVERIFIED_REGISTRY_SOURCES');
  for (const path of paths) {
    if (path !== 'contracts/src/GoghSkillRegistry.sol' && ![
      'node_modules/@openzeppelin/contracts/access/Ownable.sol',
      'node_modules/@openzeppelin/contracts/access/Ownable2Step.sol',
      'node_modules/@openzeppelin/contracts/utils/Context.sol'].includes(path)) throw Error('UNVERIFIED_REGISTRY_SOURCE_PATH');
    if (keccak256(await readFile(new URL(path, root))) !== meta.sources[path].keccak256) throw Error('STALE_REGISTRY_ARTIFACT');
  }
  const packages = await loadResearchSkillCatalog({ root });
  const definitions = PACKS.map(expected => {
    const pack = packages.find(p => p.slug === expected.slug), m = pack?.manifest;
    if (!m || m.skillId !== expected.id || m.version !== 1 || m.chainId !== 4663 || m.riskTier !== 0
      || m.walletAuthority !== 'NONE' || m.requiredWalletCapabilities?.length !== 0 || m.requiredExecutorCapabilities?.length !== 0
      || JSON.stringify(m.capabilities) !== JSON.stringify([expected.capability])
      || JSON.stringify(m.requiredMcpTools) !== JSON.stringify(expected.tools) || pack.status !== 'TESTING' || pack.approved !== false) throw Error('UNAPPROVED_CANARY_PACKAGE');
    return { slug: pack.slug, skillId: m.skillId, version: m.version, key: skillKey(m.skillId, m.version),
      manifestHash: manifestHash(m), instructionHash: instructionHash(pack.instructions), implementationHash: `0x${m.implementationSha256}`,
      capabilities: expected.mask, riskTier: 0, status: 'TESTING', walletAuthority: 'NONE' };
  });
  const pins = { compiler: meta.compiler.version, metadataHash: manifestHash(meta),
    creationCodeHash: keccak256(artifact.bytecode.object), runtimeCodeHash: keccak256(artifact.deployedBytecode.object),
    definitions };
  return { artifact, pins, inputHash: manifestHash(pins) };
}

function validateGuardianContext(context, guardian) {
  if (!context || Object.keys(context).sort().join(',') !== 'codeHash,delegation,delegationCodeHash,kind') throw Error('INVALID_GUARDIAN_CONTEXT');
  if (context.kind === 'EOA') {
    if (manifestHash(context) !== manifestHash(EMPTY_GUARDIAN_CONTEXT)) throw Error('INVALID_GUARDIAN_CONTEXT');
  } else if (context.kind === 'EIP7702_DELEGATED_EOA') {
    const target = getAddress(context.delegation);
    if (eq(target, NONE) || eq(target, guardian) || !hash(context.delegationCodeHash)
      || context.codeHash !== keccak256(`0xef0100${target.slice(2).toLowerCase()}`)) throw Error('INVALID_GUARDIAN_CONTEXT');
  } else throw Error('UNSUPPORTED_GUARDIAN_FLOW');
}
async function observeGuardian(client, guardian, blockNumber) {
  const code = await client.getCode({ address: guardian, blockNumber });
  if (!code || code === '0x') return EMPTY_GUARDIAN_CONTEXT;
  // EIP-7702 permits origination for this exact 23-byte indicator. The packet
  // contains no authorization list or delegation call. Observation is NOT an
  // audit of the wallet delegate and does not authorize changing its code.
  if (!/^0xef0100[0-9a-f]{40}$/i.test(code)) throw Error('UNSUPPORTED_GUARDIAN_FLOW');
  const target = getAddress(`0x${code.slice(8)}`);
  const targetCode = await client.getCode({ address: target, blockNumber });
  if (!targetCode || targetCode === '0x' || /^0xef0100/i.test(targetCode)) throw Error('UNVERIFIED_GUARDIAN_DELEGATION');
  const context = { kind: 'EIP7702_DELEGATED_EOA', codeHash: keccak256(code), delegation: target, delegationCodeHash: keccak256(targetCode) };
  validateGuardianContext(context, guardian); return context;
}
export function buildRegistryCanaryProposal({ inputs, guardian, guardianContext, nonce, anchor }) {
  guardian = getAddress(guardian);
  validateGuardianContext(guardianContext, guardian);
  if (eq(guardian, NONE) || !uint(nonce) || BigInt(nonce) > BigInt(Number.MAX_SAFE_INTEGER - 8)
    || !anchor || !uint(anchor.number) || !hash(anchor.hash) || !Number.isSafeInteger(anchor.timestamp)
    || anchor.timestamp <= 0 || anchor.timestamp > 1e12) throw Error('INVALID_CANARY_PROPOSAL_INPUT');
  const registry = getContractAddress({ from: guardian, nonce: BigInt(nonce) });
  const steps = [];
  const add = (label, to, data) => steps.push({ label, from: guardian, to, data, value: '0',
    chainId: 4663, nonce: String(BigInt(nonce) + BigInt(steps.length)) });
  add('DEPLOY_REGISTRY', null, encodeDeployData({ abi: inputs.artifact.abi, bytecode: inputs.artifact.bytecode.object, args: [guardian] }));
  const call = (label, functionName, args) => add(label, registry, encodeFunctionData({ abi: inputs.artifact.abi, functionName, args }));
  call('DISABLE_ALL_CAPABILITIES', 'setEmergencyControls', [true, BigInt(MASK)]);
  for (const d of inputs.pins.definitions) {
    call(`REGISTER_${d.skillId}`, 'register', [d.skillId, d.version, d.manifestHash, d.instructionHash, ZERO, BigInt(d.capabilities), 0]);
    call(`STAGE_TESTING_${d.skillId}`, 'setStatus', [d.key, 3, ZERO]);
  }
  const body = { schemaVersion: SCHEMA, status: 'REVIEW_REQUIRED_NOT_AUTHORIZED', stage: 'REGISTRY_ONLY', chainId: 4663,
    collection: deployment.collection, collectionCodeHash: deployment.collectionCodeHash,
    ownership: 'ORIGINAL_NFT', guardianProposal: guardian, guardianContext, registryPredicted: registry,
    trainingSource: null, progression: null, canBroadcast: false, productionTrainingAuthorized: false, productionBurnAuthorized: false,
    readySkills: 0, creditsIssued: 0, walletAuthority: 'NONE', inputHash: inputs.inputHash, pins: inputs.pins,
    anchor, expiresAt: anchor.timestamp + 600, requiredConfirmations: 12, transactions: steps,
    blockers: ['GUARDIAN_AND_DEPLOYMENT_NOT_AUTHORIZED', 'FEE_BUDGET_NOT_AUTHORIZED', 'PRODUCTION_TRAINING_SOURCE_UNREVIEWED',
      'PARENT_BURN_ASSET_SAFETY_UNRESOLVED', 'PRODUCTION_INTENT_AND_RECEIPT_SERVICE_NOT_CONNECTED', 'SKILLS_NOT_PRODUCTION_READY',
      ...(guardianContext.kind === 'EIP7702_DELEGATED_EOA' ? ['EXISTING_GUARDIAN_DELEGATION_REVIEW_REQUIRED'] : [])] };
  return { ...body, proposalHash: manifestHash(body) };
}

export function validateRegistryCanaryProposal(proposal, inputs) {
  if (!proposal || !Array.isArray(proposal.transactions) || proposal.transactions.length !== 8) throw Error('INVALID_CANARY_PROPOSAL');
  const expected = buildRegistryCanaryProposal({ inputs, guardian: proposal.guardianProposal,
    guardianContext: proposal.guardianContext, nonce: proposal.transactions[0]?.nonce, anchor: proposal.anchor });
  if (manifestHash(expected) !== manifestHash(proposal)) throw Error('CANARY_PROPOSAL_MISMATCH');
  return proposal;
}

export async function prepareRegistryCanaryLive({ client, inputs, guardian, now }) {
  if (await client.getChainId() !== 4663) throw Error('WRONG_CANARY_CHAIN');
  guardian = getAddress(guardian);
  const block = await client.getBlock({ blockTag: 'latest' });
  // Measure after the RPC completes: a newly mined block may be newer than the
  // instant this function was entered. Explicit test clocks remain deterministic.
  const observedNow = now ?? Date.now();
  if (!Number.isSafeInteger(observedNow) || observedNow < Number(block.timestamp) * 1000 || observedNow - Number(block.timestamp) * 1000 > 60000) throw Error('STALE_CANARY_HEAD');
  const [code, guardianContext, nonce] = await Promise.all([
    client.getCode({ address: deployment.collection, blockNumber: block.number }),
    observeGuardian(client, guardian, block.number), client.getTransactionCount({ address: guardian, blockTag: 'pending' })]);
  if (!code || keccak256(code) !== deployment.collectionCodeHash) throw Error('COLLECTION_CODE_CHANGED');
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw Error('UNVERIFIED_GUARDIAN_NONCE');
  const proposal = buildRegistryCanaryProposal({ inputs, guardian, guardianContext, nonce: String(nonce),
    anchor: { number: String(block.number), hash: block.hash, timestamp: Number(block.timestamp) } });
  const existing = await client.getCode({ address: proposal.registryPredicted, blockNumber: block.number });
  if (existing && existing !== '0x') throw Error('PREDICTED_REGISTRY_ALREADY_HAS_CODE');
  const creationGas = await client.estimateGas({ account: guardian, data: proposal.transactions[0].data, value: 0n });
  const gasPrice = await client.getGasPrice();
  if (creationGas <= 0n || gasPrice <= 0n || creationGas > 2_000_000n) throw Error('INVALID_CANARY_GAS_ESTIMATE');
  if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash
    || await client.getTransactionCount({ address: guardian, blockTag: 'pending' }) !== nonce) throw Error('CANARY_STATE_CHANGED');
  return { proposal, estimate: { scope: 'REGISTRY_CREATION_ONLY_NOT_TOTAL_BUDGET',
    gas: String(creationGas), observedGasPriceWei: String(gasPrice), estimatedExecutionFeeWei: String(creationGas * gasPrice),
    includesConfigurationTransactions: false, guaranteedFinalFee: false, broadcastAuthorized: false } };
}

export async function verifyRegistryCanary({ client, inputs, proposal, transactionHashes }) {
  validateRegistryCanaryProposal(proposal, inputs);
  if (await client.getChainId() !== 4663 || !Array.isArray(transactionHashes) || transactionHashes.length !== 8
    || transactionHashes.some(h => !hash(h)) || new Set(transactionHashes.map(h => h.toLowerCase())).size !== 8) throw Error('INVALID_CANARY_RECEIPT_SET');
  const head = await client.getBlock({ blockTag: 'latest' });
  const anchor = await client.getBlock({ blockNumber: BigInt(proposal.anchor.number) });
  if (anchor.hash !== proposal.anchor.hash) throw Error('CANARY_ANCHOR_REORG');
  if (anchor.number !== BigInt(proposal.anchor.number) || anchor.timestamp !== BigInt(proposal.anchor.timestamp)
    || head.number < anchor.number || head.timestamp < anchor.timestamp) throw Error('CANARY_ANCHOR_MISMATCH');
  let priorBlock = BigInt(proposal.anchor.number), priorIndex = -1;
  const costs = [];
  for (let i = 0; i < transactionHashes.length; i++) {
    const txHash = transactionHashes[i], expected = proposal.transactions[i];
    const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash: txHash }), client.getTransaction({ hash: txHash })]);
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (receipt.status !== 'success' || !eq(receipt.transactionHash, txHash) || !eq(tx.hash, txHash)
      || !eq(receipt.blockHash, block.hash) || !eq(tx.blockHash, receipt.blockHash) || tx.blockNumber !== receipt.blockNumber
      || receipt.blockNumber <= anchor.number || receipt.blockNumber < priorBlock
      || receipt.blockNumber === priorBlock && receipt.transactionIndex <= priorIndex
      || head.number < receipt.blockNumber + BigInt(proposal.requiredConfirmations)
      || block.timestamp > BigInt(proposal.expiresAt) || !eq(tx.from, expected.from)
      || (expected.to === null ? tx.to !== null || !eq(receipt.contractAddress, proposal.registryPredicted) : !eq(tx.to, expected.to))
      || String(tx.nonce) !== expected.nonce || tx.chainId !== 4663 || tx.value !== 0n || tx.input !== expected.data
      || !['legacy', 'eip1559'].includes(tx.type) || tx.authorizationList?.length
      || !Number.isSafeInteger(receipt.transactionIndex) || receipt.transactionIndex < 0 || tx.transactionIndex !== receipt.transactionIndex
      || typeof receipt.gasUsed !== 'bigint' || typeof receipt.effectiveGasPrice !== 'bigint'
      || receipt.gasUsed <= 0n || receipt.effectiveGasPrice <= 0n) throw Error('UNVERIFIED_CANARY_TRANSACTION');
    priorBlock = receipt.blockNumber; priorIndex = receipt.transactionIndex;
    costs.push(String(receipt.gasUsed * receipt.effectiveGasPrice));
  }
  const code = await client.getCode({ address: proposal.registryPredicted, blockNumber: head.number });
  const collectionCode = await client.getCode({ address: deployment.collection, blockNumber: head.number });
  if (!code || keccak256(code) !== inputs.pins.runtimeCodeHash || !collectionCode
    || keccak256(collectionCode) !== proposal.collectionCodeHash) throw Error('CANARY_CODE_MISMATCH');
  if (manifestHash(await observeGuardian(client, proposal.guardianProposal, head.number)) !== manifestHash(proposal.guardianContext)) throw Error('CANARY_GUARDIAN_CODE_CHANGED');
  const read = (functionName, args = []) => client.readContract({ address: proposal.registryPredicted, abi: READS, functionName, args, blockNumber: head.number });
  const [owner, pendingOwner, count, disabled, mask] = await Promise.all([
    read('owner'), read('pendingOwner'), read('skillCount'), read('globallyDisabled'), read('disabledCapabilities')]);
  if (!eq(owner, proposal.guardianProposal) || !eq(pendingOwner, NONE) || count !== 3n || disabled !== true || String(mask) !== MASK) throw Error('CANARY_GOVERNANCE_MISMATCH');
  for (const expected of inputs.pins.definitions) {
    const d = await read('definition', [expected.key]);
    if (d.manifestHash !== expected.manifestHash || d.instructionHash !== expected.instructionHash || d.prerequisite !== ZERO
      || String(d.capabilities) !== expected.capabilities || d.skillId !== expected.skillId || d.version !== 1 || d.riskTier !== 0
      || d.status !== 3 || d.disabled !== false || d.deprecated !== false || d.replacement !== ZERO || d.reviewEvidenceHash !== ZERO
      || await read('available', [expected.key]) !== false) throw Error('CANARY_DEFINITION_MISMATCH');
  }
  if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash) throw Error('CANARY_FINAL_REORG');
  return { status: 'VERIFIED_REGISTRY_ONLY_EVIDENCE', proposalHash: proposal.proposalHash, chainId: 4663,
    registry: proposal.registryPredicted, blockNumber: String(head.number), blockHash: head.hash,
    transactionHashes, observedExecutionFeesWei: costs, productionTrainingAuthorized: false, productionBurnAuthorized: false,
    readySkills: 0, walletAuthority: 'NONE', note: 'Receipt/code evidence only. No deployment permission, progression, credits, or burn approval is created.' };
}
