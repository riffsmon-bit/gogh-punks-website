import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAbiParameters, encodeDeployData, getContractAddress, keccak256 } from 'viem';
import { loadForgeDeploymentBuild, buildForgeDeploymentPlan, validateForgeDeploymentPlan, assertForgeRuntime,
  forgeManifestCandidates } from '../broker/src/v4/skill-forge/forge-deployment.mjs';
import { manifestHash } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import publicVerification from '../docs/review/2026-09-12/live-owner/finalized-deployment.json' with { type: 'json' };
import acceptedSetup from '../docs/review/2026-09-12/live-owner/accepted-setup-progress.json' with { type: 'json' };
import acceptedImmutableReferences from './fixtures/forge-accepted-build-immutable-references.json' with { type: 'json' };
import readDeployment from '../deployments/robinhood-skill-forge.json' with { type: 'json' };
import trainingDeployment from '../deployments/robinhood-forge-training.json' with { type: 'json' };

const build = await loadForgeDeploymentBuild();
const address = n => `0x${n.repeat(40)}`, hash = n => `0x${n.repeat(64)}`;
const inputs = { build, administrator: address('1'), nonce: '10', anchor: { number: '50', hash: hash('a'), timestamp: 1800000000 } };
const plan = () => buildForgeDeploymentPlan(inputs);

// Solidity's immutable-reference keys are compiler AST IDs. Adding unrelated
// sources can renumber them without changing this contract's compiled content.
// Ignore only those IDs when comparing builds: never flatten the groups of
// occurrences that must contain the same immutable value.
const immutableGroups = references => Object.values(references ?? {}).map(refs =>
  JSON.stringify([...refs].sort((a, b) => a.start - b.start || a.length - b.length))).sort();

function loadAcceptedBuild(currentBuild, frozen = acceptedImmutableReferences) {
  assert.equal(frozen.schema, 'GOGH_ACCEPTED_FORGE_BUILD_IMMUTABLE_REFERENCES_V1');
  assert.equal(frozen.planHash, acceptedSetup.packet.plan.planHash);
  assert.equal(frozen.buildHash, acceptedSetup.packet.plan.buildHash);
  assert.deepEqual(Object.keys(frozen.immutableReferences).sort(), Object.keys(acceptedSetup.packet.buildPins).sort());
  const artifacts = {}, pins = {};
  for (const [role, recordedPins] of Object.entries(acceptedSetup.packet.buildPins)) {
    const artifact = currentBuild.artifacts[role], references = frozen.immutableReferences[role];
    // Hash the actual current artifact again; do not trust copied build pins.
    assert.equal(keccak256(artifact.bytecode.object), recordedPins.creationCodeHash, `${role}: creation code changed`);
    assert.equal(keccak256(artifact.deployedBytecode.object), recordedPins.runtimeTemplateHash, `${role}: runtime template changed`);
    assert.equal(manifestHash(artifact.metadata), recordedPins.metadataHash, `${role}: metadata changed`);
    assert.equal(manifestHash(references), recordedPins.immutableReferencesHash, `${role}: historical references changed`);
    assert.deepEqual(immutableGroups(artifact.deployedBytecode.immutableReferences), immutableGroups(references),
      `${role}: immutable offsets or grouping changed`);
    artifacts[role] = { ...artifact, deployedBytecode: { ...artifact.deployedBytecode, immutableReferences: references } };
    pins[role] = { creationCodeHash: keccak256(artifact.bytecode.object),
      runtimeTemplateHash: keccak256(artifact.deployedBytecode.object), metadataHash: manifestHash(artifact.metadata),
      immutableReferencesHash: manifestHash(references) };
  }
  assert.deepEqual(pins, acceptedSetup.packet.buildPins);
  assert.equal(manifestHash(pins), frozen.buildHash);
  return { artifacts, pins, buildHash: manifestHash(pins) };
}

test('committed read-only addresses and training deployment identity match finalized public evidence', () => {
  const historicalBuild = loadAcceptedBuild(build);
  const candidates = forgeManifestCandidates({ plan: acceptedSetup.packet.plan, build: historicalBuild, evidence: publicVerification.evidence });
  assert.deepEqual(readDeployment, candidates.read);
  for(const key of Object.keys(candidates.training).filter(key=>!['status','allowedOwners','skills','productionTrainingAuthorized'].includes(key)))
    assert.deepEqual(trainingDeployment[key],candidates.training[key],key);
  assert.equal(trainingDeployment.status,'OWNER_CANARY');assert.equal(trainingDeployment.productionBurnAuthorized,false);
  assert.equal(publicVerification.evidence.finality, 'TWO_RPC_FINALIZED');
  assert.equal(publicVerification.publicTransactions, 0);
});

test('historical build verification permits only AST ID changes while fresh plans retain current build pins', () => {
  const historicalBuild = loadAcceptedBuild(build);
  validateForgeDeploymentPlan(acceptedSetup.packet.plan, historicalBuild);
  const renamed = structuredClone(build);
  for (const artifact of Object.values(renamed.artifacts)) artifact.deployedBytecode.immutableReferences =
    Object.fromEntries(Object.values(artifact.deployedBytecode.immutableReferences ?? {}).map((refs, index) => [String(900000000 + index), refs]));
  assert.equal(loadAcceptedBuild(renamed).buildHash, historicalBuild.buildHash);
  assert.equal(plan().buildHash, build.buildHash);
  validateForgeDeploymentPlan(plan(), build);
  if (build.buildHash !== historicalBuild.buildHash)
    assert.throws(() => validateForgeDeploymentPlan(acceptedSetup.packet.plan, build), /FORGE_DEPLOYMENT_PLAN_CHANGED/);
});

for (const mutation of ['offset', 'length', 'split', 'merge', 'regroup', 'duplicate']) {
  test(`historical build rejects changed immutable ${mutation} even when compiled bytecode is unchanged`, () => {
    const changed = structuredClone(build), refs = changed.artifacts.progression.deployedBytecode.immutableReferences;
    const [first, second] = Object.keys(refs);
    if (mutation === 'offset') refs[first][0].start++;
    if (mutation === 'length') refs[first][0].length--;
    if (mutation === 'split') refs['900000000'] = [refs[first].pop()];
    if (mutation === 'merge') { refs[first].push(...refs[second]); delete refs[second]; }
    if (mutation === 'regroup') [refs[first][0], refs[second][0]] = [refs[second][0], refs[first][0]];
    if (mutation === 'duplicate') refs[first].push({ ...refs[first][0] });
    assert.throws(() => loadAcceptedBuild(changed), /immutable offsets or grouping changed/);
  });
}

test('historical immutable reference IDs remain pinned in the frozen evidence', () => {
  const changed = structuredClone(acceptedImmutableReferences), refs = changed.immutableReferences.deployment;
  const key = Object.keys(refs)[0]; refs['900000000'] = refs[key]; delete refs[key];
  assert.throws(() => loadAcceptedBuild(build, changed), /historical references changed/);
});

for (const field of ['creation code', 'runtime template', 'metadata']) {
  test(`historical build rejects changed ${field} without trusting cached build hashes`, () => {
    const changed = structuredClone(build), artifact = changed.artifacts.deployment;
    if (field === 'creation code') artifact.bytecode.object += '00';
    if (field === 'runtime template') artifact.deployedBytecode.object += '00';
    if (field === 'metadata') artifact.metadata.settings.optimizer.runs++;
    assert.throws(() => loadAcceptedBuild(changed), new RegExp(`${field} changed`));
  });
}

test('one creation binds the exact chain, original NFT, guardian and frozen rarity pins', () => {
  const p = plan(), initcode = build.artifacts.deployment.bytecode.object;
  assert.equal(p.transactions.length, 2);
  assert.ok(p.transactions[0].data.startsWith(initcode));
  const decoded = decodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'bytes32' },
    { type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }], `0x${p.transactions[0].data.slice(initcode.length)}`);
  assert.deepEqual(decoded.map(String).map(s => s.toLowerCase()), [4663, p.pins.collection, p.pins.collectionCodeHash,
    inputs.administrator, p.pins.allocationRoot, p.pins.snapshotHash].map(String).map(s => s.toLowerCase()));
  assert.equal(p.addresses.deployment, getContractAddress({ from: inputs.administrator, nonce: 10n }));
  for (const [role, nonce] of [['registry', 1n], ['trainingSource', 2n], ['progression', 3n]])
    assert.equal(p.addresses[role], getContractAddress({ from: p.addresses.deployment, nonce }));
  assert.equal(p.transactions[1].data, '0x79ba5097');
  assert.equal(p.transactions[1].to, p.addresses.registry);
  assert.equal(p.transactions[1].nonce, '11');
  assert.equal(p.initialState, 'PAUSED_EMPTY_REGISTRY');
  assert.equal(p.productionBurnAuthorized, false);
  assert.equal(p.maximumTotalFeeWei, '6100000000000000');
  validateForgeDeploymentPlan(p, build);
});

for (const field of ['data', 'to', 'value', 'nonce', 'chainId', 'from']) {
  test(`altered deployment transaction ${field} invalidates the complete plan`, () => {
    const p = plan(); p.transactions[0][field] = field === 'chainId' ? 1 : '0x1234';
    assert.throws(() => validateForgeDeploymentPlan(p, build), /FORGE_DEPLOYMENT_/);
  });
}
test('runtime verification checks all occurrences of an immutable and every other byte', () => {
  const template = `0x60${'0'.repeat(64)}61${'0'.repeat(64)}00`;
  const a = { deployedBytecode: { object: template, immutableReferences: { 1: [{ start: 1, length: 32 }, { start: 34, length: 32 }] } } };
  const value = '1'.padStart(64, '0'), code = `0x60${value}61${value}00`;
  assert.equal(assertForgeRuntime(a, code, [1]), keccak256(code));
  assert.throws(() => assertForgeRuntime(a, `0x60${value}61${'2'.padStart(64, '0')}00`, [1]), /FORGE_IMMUTABLE_MISMATCH/);
  assert.throws(() => assertForgeRuntime(a, `0x60${value}61${value}01`, [1]), /FORGE_RUNTIME_MISMATCH/);
  assert.throws(() => assertForgeRuntime(a, code, [2]), /FORGE_RUNTIME_MISMATCH/);
  assert.throws(() => assertForgeRuntime(a, code, []), /FORGE_RUNTIME_MISMATCH/);
});
test('local chain and fixture pins need the explicit local option and cannot be adopted publicly', () => {
  assert.throws(() => buildForgeDeploymentPlan({ ...inputs, chainId: 31337 }), /INVALID_FORGE_DEPLOYMENT_PLAN/);
  const p = buildForgeDeploymentPlan({ ...inputs, chainId: 31337, localFixture: true,
    pins: { collection: address('2'), collectionCodeHash: hash('3'), allocationRoot: hash('4'), snapshotHash: hash('5') } });
  validateForgeDeploymentPlan(p, build, { localFixture: true });
  assert.throws(() => validateForgeDeploymentPlan(p, build), /FORGE_DEPLOYMENT_ENVIRONMENT_MISMATCH/);
  assert.throws(() => forgeManifestCandidates({ plan: p, build, evidence: {} }), /FORGE_DEPLOYMENT_ENVIRONMENT_MISMATCH/);
});
test('production collection and rarity pins cannot be selected by a caller', () => {
  const original = plan();
  for (const field of ['collection', 'collectionCodeHash', 'allocationRoot', 'snapshotHash']) {
    assert.throws(() => buildForgeDeploymentPlan({ ...inputs, pins: { ...original.pins,
      [field]: field === 'collection' ? address('2') : hash('3') } }), /INVALID_FORGE_DEPLOYMENT_PINS/);
  }
});
test('nonces and fee caps have exact bounded values', () => {
  for (const nonce of ['-1', '01', '9007199254740991', '1e2']) assert.throws(() => buildForgeDeploymentPlan({ ...inputs, nonce }), /INVALID_FORGE_DEPLOYMENT_PLAN/);
  for (const gasLimits of [['8000001', '100000'], ['0', '100000'], ['6000000', '100001'], ['6000000']])
    assert.throws(() => buildForgeDeploymentPlan({ ...inputs, gasLimits }), /INVALID_FORGE_DEPLOYMENT_FEES/);
  for (const maxFeePerGas of ['0', '10000000001', '01'])
    assert.throws(() => buildForgeDeploymentPlan({ ...inputs, maxFeePerGas }), /INVALID_FORGE_DEPLOYMENT_FEES/);
});
test('build pin and expiry changes cannot silently authorize different deployments', () => {
  const p = plan(); p.buildHash = hash('c');
  assert.throws(() => validateForgeDeploymentPlan(p, build), /FORGE_DEPLOYMENT_PLAN_CHANGED/);
  const expired = plan(); expired.expiresAt++;
  assert.throws(() => validateForgeDeploymentPlan(expired, build), /FORGE_DEPLOYMENT_PLAN_CHANGED/);
});
test('a guessed deployment address or unverified receipt cannot produce manifest candidates', () => {
  assert.throws(() => forgeManifestCandidates({ plan: plan(), build, evidence: { status: 'VERIFIED_PAUSED_FORGE' } }), /FORGE_PUBLIC_ATTESTATION_REQUIRED/);
});
test('creation calldata is independently reproducible and fits the initcode limit', () => {
  const p = plan();
  assert.equal(p.transactions[0].data, encodeDeployData({ abi: build.artifacts.deployment.abi,
    bytecode: build.artifacts.deployment.bytecode.object, args: [4663n, p.pins.collection,
      p.pins.collectionCodeHash, p.administrator, p.pins.allocationRoot, p.pins.snapshotHash] }));
  assert.ok((p.transactions[0].data.length - 2) / 2 < 49152);
});
