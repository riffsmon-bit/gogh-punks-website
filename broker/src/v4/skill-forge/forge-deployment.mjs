// Complete Forge deployment preparation and attestation. No signer or sender.
import { readFile } from 'node:fs/promises';
import { encodeDeployData, encodeFunctionData, getAddress, getContractAddress, keccak256, zeroAddress } from 'viem';
import { manifestHash } from './capability-resolver.mjs';
import readRelease from '../../../../deployments/robinhood-skill-forge.json' with { type: 'json' };
import trainingRelease from '../../../../deployments/robinhood-forge-training.json' with { type: 'json' };

const ROOT = new URL('../../../../', import.meta.url);
const NAMES = { deployment: 'GoghForgeDeployment', registry: 'GoghSkillRegistry',
  progression: 'GoghReviewedSkillProgression', trainingSource: 'GoghReviewedBurnSource' };
const HASH = /^0x[0-9a-f]{64}$/i;
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const valid = (value, code) => { if (!value) throw Error(code); };
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value);
const word = value => BigInt(value).toString(16).padStart(64, '0');
const keyPins = ['collection', 'collectionCodeHash', 'allocationRoot', 'snapshotHash'];

export async function loadForgeDeploymentBuild({ root = ROOT } = {}) {
  const artifacts = {}, pins = {};
  for (const [role, name] of Object.entries(NAMES)) {
    const artifact = JSON.parse(await readFile(new URL(`contracts/out/${name}.sol/${name}.json`, root), 'utf8'));
    const m = artifact.metadata;
    valid(m?.compiler?.version === '0.8.34+commit.80d5c536' && m.settings?.viaIR === true
      && m.settings.optimizer?.enabled === true && m.settings.optimizer.runs === 500
      && m.settings.evmVersion === 'cancun' && m.settings.compilationTarget?.[`contracts/src/${name}.sol`] === name
      && /^0x[0-9a-f]+$/i.test(artifact.bytecode?.object ?? '')
      && /^0x[0-9a-f]+$/i.test(artifact.deployedBytecode?.object ?? '')
      && !Object.keys(artifact.bytecode.linkReferences ?? {}).length
      && (artifact.bytecode.object.length - 2) / 2 < 49152 - 6 * 32
      && (artifact.deployedBytecode.object.length - 2) / 2 < 24576, 'UNVERIFIED_FORGE_BUILD');
    for (const [path, source] of Object.entries(m.sources ?? {})) {
      valid(/^(contracts\/src\/|node_modules\/@openzeppelin\/contracts\/)[A-Za-z0-9_./]+\.sol$/.test(path)
        && !path.split('/').includes('..'), 'UNVERIFIED_FORGE_SOURCE_PATH');
      valid(keccak256(await readFile(new URL(path, root))) === source.keccak256, 'STALE_FORGE_BUILD');
    }
    artifacts[role] = artifact;
    pins[role] = { creationCodeHash: keccak256(artifact.bytecode.object), runtimeTemplateHash: keccak256(artifact.deployedBytecode.object),
      metadataHash: manifestHash(m), immutableReferencesHash: manifestHash(artifact.deployedBytecode.immutableReferences ?? {}) };
  }
  return { artifacts, pins, buildHash: manifestHash(pins) };
}

// Check every non-immutable byte and every occurrence of each immutable. The
// caller separately verifies public getters; the source's private creator must
// also equal the atomic deployment contract, not an unreviewed account.
export function assertForgeRuntime(artifact, code, expectedImmutables) {
  const template = artifact.deployedBytecode.object.toLowerCase();
  valid(typeof code === 'string' && /^0x[0-9a-f]+$/i.test(code) && code.length === template.length, 'FORGE_RUNTIME_MISMATCH');
  let normalized = code.toLowerCase();
  const observed = [];
  for (const refs of Object.values(artifact.deployedBytecode.immutableReferences ?? {})) {
    valid(refs.length > 0, 'FORGE_IMMUTABLE_MISMATCH');
    let first;
    for (const { start, length } of refs) {
      valid(length === 32 && Number.isInteger(start) && start >= 0 && 2 + (start + length) * 2 <= code.length, 'FORGE_IMMUTABLE_MISMATCH');
      const offset = 2 + start * 2, value = normalized.slice(offset, offset + 64);
      valid(first === undefined || first === value, 'FORGE_IMMUTABLE_MISMATCH'); first = value;
      normalized = `${normalized.slice(0, offset)}${'0'.repeat(64)}${normalized.slice(offset + 64)}`;
    }
    observed.push(first);
  }
  valid(normalized === template && JSON.stringify(observed.sort()) === JSON.stringify(expectedImmutables.map(word).sort()), 'FORGE_RUNTIME_MISMATCH');
  return keccak256(code);
}

export function buildForgeDeploymentPlan({ build, administrator, nonce, anchor, chainId = 4663, pins = readRelease,
  localFixture = false, gasLimits = ['6000000', '100000'], maxFeePerGas = '1000000000' }) {
  administrator = getAddress(administrator);
  valid(administrator !== zeroAddress && chainId === (localFixture ? 31337 : 4663)
    && uint(nonce) && BigInt(nonce) < BigInt(Number.MAX_SAFE_INTEGER - 2)
    && anchor && uint(anchor.number) && HASH.test(anchor.hash) && Number.isSafeInteger(anchor.timestamp)
    && anchor.timestamp > 0, 'INVALID_FORGE_DEPLOYMENT_PLAN');
  valid(keyPins.every(key => typeof pins[key] === 'string') && getAddress(pins.collection) !== zeroAddress
    && keyPins.slice(1).every(key => HASH.test(pins[key]) && BigInt(pins[key]) !== 0n)
    && (localFixture || keyPins.every(key => pins[key] === readRelease[key])), 'INVALID_FORGE_DEPLOYMENT_PINS');
  valid(Array.isArray(gasLimits) && gasLimits.length === 2 && gasLimits.every(uint)
    && BigInt(gasLimits[0]) > 0n && BigInt(gasLimits[0]) <= 8000000n
    && BigInt(gasLimits[1]) > 0n && BigInt(gasLimits[1]) <= 100000n
    && uint(maxFeePerGas) && BigInt(maxFeePerGas) > 0n && BigInt(maxFeePerGas) <= 10000000000n, 'INVALID_FORGE_DEPLOYMENT_FEES');
  const addresses = { deployment: getContractAddress({ from: administrator, nonce: BigInt(nonce) }) };
  addresses.registry = getContractAddress({ from: addresses.deployment, nonce: 1n });
  addresses.trainingSource = getContractAddress({ from: addresses.deployment, nonce: 2n });
  addresses.progression = getContractAddress({ from: addresses.deployment, nonce: 3n });
  const transactions = [
    { label: 'DEPLOY_PAUSED_FORGE', from: administrator, to: null, chainId, nonce, value: '0',
      data: encodeDeployData({ abi: build.artifacts.deployment.abi, bytecode: build.artifacts.deployment.bytecode.object,
        args: [BigInt(chainId), pins.collection, pins.collectionCodeHash, administrator, pins.allocationRoot, pins.snapshotHash] }) },
    { label: 'ACCEPT_REGISTRY_OWNERSHIP', from: administrator, to: addresses.registry, chainId, nonce: String(BigInt(nonce) + 1n), value: '0',
      data: encodeFunctionData({ abi: build.artifacts.registry.abi, functionName: 'acceptOwnership' }) },
  ];
  const body = { schema: 'GOGH_ATOMIC_FORGE_DEPLOYMENT_V1', chainId, administrator, addresses,
    pins: Object.fromEntries(keyPins.map(key => [key, pins[key]])), buildHash: build.buildHash,
    anchor, expiresAt: anchor.timestamp + 600, localFixture, transactions, gasLimits, maxFeePerGas,
    maximumTotalFeeWei: String(gasLimits.reduce((sum, gas) => sum + BigInt(gas) * BigInt(maxFeePerGas), 0n)), initialState: 'PAUSED_EMPTY_REGISTRY',
    productionTrainingAuthorized: false, productionBurnAuthorized: false };
  return { ...body, planHash: manifestHash(body) };
}

export function validateForgeDeploymentPlan(plan, build, { localFixture = false } = {}) {
  valid(plan?.localFixture === localFixture, 'FORGE_DEPLOYMENT_ENVIRONMENT_MISMATCH');
  const expected = buildForgeDeploymentPlan({ build, administrator: plan.administrator, nonce: plan.transactions?.[0]?.nonce,
    anchor: plan.anchor, chainId: plan.chainId, pins: plan.pins, localFixture, gasLimits: plan.gasLimits, maxFeePerGas: plan.maxFeePerGas });
  valid(manifestHash(expected) === manifestHash(plan), 'FORGE_DEPLOYMENT_PLAN_CHANGED');
  return plan;
}

export async function inspectForgeStack({ client, plan, build, blockNumber, pendingGuardian = false }) {
  const { addresses: a, pins: p } = plan;
  valid(await client.getChainId() === plan.chainId, 'FORGE_DEPLOYMENT_WRONG_CHAIN');
  const read = (role, functionName, args = []) => client.readContract({ address: a[role], abi: build.artifacts[role].abi, functionName, args, blockNumber });
  const code = await client.getCode({ address: p.collection, blockNumber });
  valid(code && keccak256(code) === p.collectionCodeHash, 'FORGE_COLLECTION_CHANGED');
  const expected = { deployment: [a.registry, a.progression, a.trainingSource], registry: [],
    trainingSource: [p.collection, p.collectionCodeHash, a.deployment],
    progression: [p.collection, a.registry, a.trainingSource, 1, 7, p.allocationRoot, p.snapshotHash, plan.chainId] };
  const codeHashes = Object.fromEntries(await Promise.all(Object.keys(NAMES).map(async role =>
    [`${role}CodeHash`, assertForgeRuntime(build.artifacts[role],
      await client.getCode({ address: a[role], blockNumber }), expected[role])])));
  const checks = [
    ['deployment', 'registry', a.registry], ['deployment', 'progression', a.progression], ['deployment', 'trainingSource', a.trainingSource],
    ['registry', 'owner', pendingGuardian ? a.deployment : plan.administrator],
    ['registry', 'pendingOwner', pendingGuardian ? plan.administrator : zeroAddress], ['registry', 'globallyDisabled', true],
    ['registry', 'disabledCapabilities', (1n << 256n) - 1n], ['registry', 'skillCount', 0n],
    ['trainingSource', 'collection', p.collection], ['trainingSource', 'collectionCodeHash', p.collectionCodeHash],
    ['trainingSource', 'progression', a.progression], ['trainingSource', 'progressionCodeHash', codeHashes.progressionCodeHash],
    ['trainingSource', 'registryCodeHash', codeHashes.registryCodeHash],
    ['progression', 'collection', p.collection], ['progression', 'registry', a.registry], ['progression', 'trainingSource', a.trainingSource],
    ['progression', 'baseSlots', 1], ['progression', 'slotCap', 7], ['progression', 'allocationChainId', BigInt(plan.chainId)],
    ['progression', 'allocationRoot', p.allocationRoot], ['progression', 'snapshotHash', p.snapshotHash],
  ];
  await Promise.all(checks.map(async ([role, name, expectedValue]) => {
    const actual = await read(role, name);
    valid(typeof expectedValue === 'string' ? same(actual, expectedValue) : actual === expectedValue, 'FORGE_DEPLOYMENT_STATE_MISMATCH');
  }));
  return codeHashes;
}

export function buildForgeAcceptanceReview({ plan, nonce, anchor, gasLimit = '100000', maxFeePerGas = plan.maxFeePerGas }) {
  valid(uint(nonce) && BigInt(nonce) > BigInt(plan.transactions[0].nonce) && BigInt(nonce) < BigInt(Number.MAX_SAFE_INTEGER)
    && anchor && uint(anchor.number) && BigInt(anchor.number) > BigInt(plan.anchor.number) && HASH.test(anchor.hash)
    && Number.isSafeInteger(anchor.timestamp) && anchor.timestamp >= plan.anchor.timestamp
    && uint(gasLimit) && BigInt(gasLimit) > 0n && BigInt(gasLimit) <= 100000n
    && uint(maxFeePerGas) && BigInt(maxFeePerGas) > 0n && BigInt(maxFeePerGas) <= 10000000000n, 'INVALID_FORGE_ACCEPTANCE_REVIEW');
  const body = { schema: 'GOGH_FORGE_ACCEPTANCE_REVIEW_V1', planHash: plan.planHash, anchor,
    expiresAt: anchor.timestamp + 600, gasLimit, maxFeePerGas,
    transaction: { ...plan.transactions[1], nonce }, maximumFeeWei: String(BigInt(gasLimit) * BigInt(maxFeePerGas)) };
  return { ...body, reviewHash: manifestHash(body) };
}

export function validateForgeAcceptanceReview(review, plan) {
  const expected = buildForgeAcceptanceReview({ plan, nonce: review?.transaction?.nonce, anchor: review?.anchor,
    gasLimit: review?.gasLimit, maxFeePerGas: review?.maxFeePerGas });
  valid(manifestHash(expected) === manifestHash(review), 'FORGE_ACCEPTANCE_REVIEW_CHANGED');
  return review;
}

export function forgeDeploymentStep(plan, index, acceptanceReview = null) {
  valid(index === 0 || index === 1, 'INVALID_FORGE_DEPLOYMENT_STEP');
  if (index === 1 && acceptanceReview) {
    validateForgeAcceptanceReview(acceptanceReview, plan);
    return { transaction: acceptanceReview.transaction, gasLimit: acceptanceReview.gasLimit,
      maxFeePerGas: acceptanceReview.maxFeePerGas, anchor: acceptanceReview.anchor, expiresAt: acceptanceReview.expiresAt };
  }
  return { transaction: plan.transactions[index], gasLimit: plan.gasLimits[index], maxFeePerGas: plan.maxFeePerGas,
    anchor: plan.anchor, expiresAt: plan.expiresAt };
}

export function assertForgeDeploymentTransaction({ plan, index, transaction: tx, acceptanceReview = null }) {
  const step = forgeDeploymentStep(plan, index, acceptanceReview), expected = step.transaction;
  valid(same(tx.from, expected.from) && (index === 0 ? tx.to === null : same(tx.to, expected.to))
    && tx.input === expected.data && tx.value === 0n && tx.chainId === plan.chainId && String(tx.nonce) === expected.nonce
    && tx.type === 'eip1559' && !tx.authorizationList?.length && tx.gas > 0n && tx.gas <= BigInt(step.gasLimit)
    && tx.maxFeePerGas > 0n && tx.maxFeePerGas <= BigInt(step.maxFeePerGas) && tx.maxPriorityFeePerGas === 0n,
  'FORGE_DEPLOYMENT_TRANSACTION_MISMATCH');
  return step;
}

export async function verifyForgeDeployment({ clients, stateClients = clients, plan, build, transactionHashes, localFixture = false, acceptanceReview = null }) {
  validateForgeDeploymentPlan(plan, build, { localFixture });
  valid(Array.isArray(clients) && clients.length === (localFixture ? 1 : 2)
    && Array.isArray(stateClients) && stateClients.length === clients.length
    && Array.isArray(transactionHashes) && transactionHashes.length === 2
    && transactionHashes.every(h => HASH.test(h)) && !same(...transactionHashes), 'INVALID_FORGE_DEPLOYMENT_RECEIPTS');
  const heads = await Promise.all(clients.map(client => client.getBlock({ blockTag: localFixture ? 'latest' : 'finalized' })));
  const final = heads.reduce((a, b) => a.number < b.number ? a : b);
  const observations = [];
  for (const [providerIndex, client] of clients.entries()) {
    valid(await client.getChainId() === plan.chainId, 'FORGE_DEPLOYMENT_WRONG_CHAIN');
    const anchor = await client.getBlock({ blockNumber: BigInt(plan.anchor.number) });
    valid(same(anchor.hash, plan.anchor.hash) && Number(anchor.timestamp) === plan.anchor.timestamp, 'FORGE_DEPLOYMENT_ANCHOR_CHANGED');
    const block = await client.getBlock({ blockNumber: final.number });
    valid(same(block.hash, final.hash) && block.timestamp === final.timestamp, 'FORGE_FINALIZED_PROVIDERS_DISAGREE');
    let previousBlock = anchor.number, previousIndex = -1;
    const fees = [];
    for (const [index, hash] of transactionHashes.entries()) {
      const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })]);
      const step = assertForgeDeploymentTransaction({ plan, index, transaction: tx, acceptanceReview });
      const expected = step.transaction, mined = await client.getBlock({ blockNumber: receipt.blockNumber });
      const reviewAnchor = await client.getBlock({ blockNumber: BigInt(step.anchor.number) });
      valid(same(reviewAnchor.hash, step.anchor.hash), 'FORGE_DEPLOYMENT_ANCHOR_CHANGED');
      valid(receipt.status === 'success' && same(receipt.transactionHash, hash) && same(tx.hash, hash)
        && same(receipt.blockHash, mined.hash) && same(tx.blockHash, mined.hash) && tx.blockNumber === receipt.blockNumber
        && receipt.blockNumber > reviewAnchor.number
        && (receipt.blockNumber > previousBlock || receipt.blockNumber === previousBlock && receipt.transactionIndex > previousIndex)
        && same(tx.from, expected.from) && same(receipt.from, expected.from)
        && (index === 0 ? tx.to === null && same(receipt.contractAddress, plan.addresses.deployment) : same(tx.to, expected.to))
        && tx.input === expected.data && tx.value === 0n && tx.chainId === plan.chainId && String(tx.nonce) === expected.nonce
        && tx.type === 'eip1559' && !tx.authorizationList?.length
        && tx.gas > 0n && tx.gas <= BigInt(step.gasLimit) && tx.maxFeePerGas > 0n
        && tx.maxFeePerGas <= BigInt(step.maxFeePerGas) && tx.maxPriorityFeePerGas === 0n
        && receipt.gasUsed <= tx.gas && receipt.effectiveGasPrice <= tx.maxFeePerGas
        && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0 && tx.transactionIndex === receipt.transactionIndex
        && receipt.gasUsed > 0n && receipt.effectiveGasPrice > 0n, 'FORGE_DEPLOYMENT_RECEIPT_MISMATCH');
      valid(receipt.blockNumber <= final.number, 'FORGE_DEPLOYMENT_FINALITY_PENDING');
      previousBlock = receipt.blockNumber; previousIndex = receipt.transactionIndex;
      fees.push(String(receipt.gasUsed * receipt.effectiveGasPrice));
    }
    // Receipt/header providers may prune state. An independent pair of state
    // providers must read this same finalized block, never latest or a fallback.
    const stateClient = stateClients[providerIndex];
    const stateBlock = await stateClient.getBlock({ blockNumber: final.number });
    valid(stateBlock.number === final.number && same(stateBlock.hash, final.hash)
      && stateBlock.timestamp === final.timestamp, 'FORGE_FINALIZED_PROVIDERS_DISAGREE');
    const codeHashes = await inspectForgeStack({ client: stateClient, plan, build, blockNumber: final.number });
    valid(same((await stateClient.getBlock({ blockNumber: final.number })).hash, final.hash), 'FORGE_DEPLOYMENT_REORG');
    valid(same((await client.getBlock({ blockNumber: final.number })).hash, final.hash), 'FORGE_DEPLOYMENT_REORG');
    observations.push({ codeHashes, fees });
  }
  valid(observations.every(value => manifestHash(value) === manifestHash(observations[0])), 'FORGE_FINALIZED_PROVIDERS_DISAGREE');
  const body = { schema: 'GOGH_ATOMIC_FORGE_DEPLOYMENT_EVIDENCE_V1', status: 'VERIFIED_PAUSED_FORGE',
    planHash: plan.planHash, chainId: plan.chainId, localFixture, blockNumber: String(final.number), blockHash: final.hash,
    addresses: plan.addresses, codeHashes: observations[0].codeHashes, transactionHashes, observedFeesWei: observations[0].fees,
    finality: localFixture ? 'DISPOSABLE_CHAIN_ONLY' : 'TWO_RPC_FINALIZED', productionTrainingAuthorized: false, productionBurnAuthorized: false };
  // Deployment and acceptOwnership have no on-chain expiry. Freshness is enforced
  // before each wallet request; a late exact receipt must remain recoverable.
  if (acceptanceReview) body.acceptanceReviewHash = acceptanceReview.reviewHash;
  return { ...body, evidenceHash: manifestHash(body) };
}

// Returns file contents for review; never overwrites the deployment manifests.
export function forgeManifestCandidates({ plan, evidence, build }) {
  validateForgeDeploymentPlan(plan, build);
  const { evidenceHash, ...body } = evidence ?? {};
  valid(evidenceHash === manifestHash(body) && body.status === 'VERIFIED_PAUSED_FORGE' && body.planHash === plan.planHash
    && body.localFixture === false && body.chainId === 4663 && body.finality === 'TWO_RPC_FINALIZED'
    && manifestHash(body.addresses) === manifestHash(plan.addresses), 'FORGE_PUBLIC_ATTESTATION_REQUIRED');
  const binding = Object.fromEntries(['registry', 'progression', 'trainingSource'].flatMap(role =>
    [[role, plan.addresses[role].toLowerCase()], [`${role}CodeHash`, body.codeHashes[`${role}CodeHash`]]]));
  valid(Object.values(binding).every(v => typeof v === 'string') && ['registry', 'progression', 'trainingSource'].every(role => HASH.test(binding[`${role}CodeHash`])), 'FORGE_PUBLIC_ATTESTATION_REQUIRED');
  return { read: { ...readRelease, ...binding, status: 'READ_ONLY_CANARY', note: 'Verified connected Forge stack. Registry paused; training and burns await integration acceptance.' },
    training: { ...trainingRelease, ...binding, status: 'PAUSED', allowedOwners: [], skills: [] },
    evidenceHash, productionTrainingAuthorized: false, productionBurnAuthorized: false };
}
