import { readFile } from 'node:fs/promises';
import { keccak256 } from 'viem';
import pinnedRelease from '../../../deployments/robinhood-paid-training.json' with { type: 'json' };
import training from '../../../deployments/robinhood-forge-training.json' with { type: 'json' };
import { validatePaidRelease, assertPaidSkillCoverage } from '../../../broker/src/v4/skill-forge/paid-training.mjs';
const root = new URL('../../../', import.meta.url);
const valid = (condition, code) => { if (!condition) throw Error(code); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export async function loadPaidTrainingDeployment({ allowDeployed = false } = {}) {
  const release = assertPaidSkillCoverage(validatePaidRelease(pinnedRelease), training);
  valid(allowDeployed ? release.status === 'OWNER_CANARY' : release.status === 'UNDEPLOYED', 'PAID_DEPLOYMENT_PHASE_INVALID');
  const artifact = JSON.parse(await readFile(new URL('contracts/out/GoghPaidSkillTraining.sol/GoghPaidSkillTraining.json', root)));
  valid(artifact.metadata.compiler.version === '0.8.34+commit.80d5c536' && artifact.metadata.settings.viaIR
    && artifact.metadata.settings.optimizer.runs === 500 && artifact.metadata.settings.evmVersion === 'cancun', 'PAID_BUILD_UNVERIFIED');
  for (const [path, source] of Object.entries(artifact.metadata.sources)) {
    valid(!path.includes('..') && /^(contracts\/src\/|node_modules\/@openzeppelin\/contracts\/)/.test(path), 'PAID_BUILD_PATH');
    valid(keccak256(await readFile(new URL(path, root))) === source.keccak256, 'PAID_BUILD_STALE');
  }
  const configuration = { chainId: 4663n, collection: release.collection, registry: release.registry,
    legacyProgression: release.legacyProgression, treasury: release.treasury, guardian: release.treasury,
    collectionCodeHash: release.collectionCodeHash, registryCodeHash: release.registryCodeHash,
    legacyProgressionCodeHash: release.legacyProgressionCodeHash };
  return { artifact, release, configuration };
}

export async function verifyPaidTrainingDependencies({ client, release, blockNumber }) {
  valid(await client.getChainId() === 4663, 'SETUP_WRONG_CHAIN');
  for (const key of ['collection', 'registry', 'legacyProgression']) {
    valid(keccak256(await client.getCode({ address: release[key], blockNumber }) ?? '0x') === release[`${key}CodeHash`], 'PAID_DEPENDENCY_CHANGED');
  }
  const registryArtifact = JSON.parse(await readFile(new URL('contracts/out/GoghSkillRegistry.sol/GoghSkillRegistry.json', root)));
  const read = (functionName, args = []) => client.readContract({ address: release.registry, abi: registryArtifact.abi, functionName, args, blockNumber });
  valid(await read('globallyDisabled') === false, 'PAID_REGISTRY_DISABLED');
  const disabled = await read('disabledCapabilities');
  for (const skill of release.skills) {
    const d = await read('definition', [skill.key]);
    valid(d.manifestHash === skill.manifestHash && d.instructionHash === skill.instructionHash && d.status === 4
      && !d.disabled && !d.deprecated && d.riskTier === 0 && BigInt(d.prerequisite) === 0n
      && d.capabilities > 0n && (d.capabilities & 205n) === d.capabilities && (d.capabilities & disabled) === 0n, 'PAID_SKILL_UNAVAILABLE');
  }
}

export function matchesCompiledPaidRuntime(artifact, code) {
  if (typeof code !== 'string' || !/^0x[0-9a-f]+$/i.test(code)) return false;
  const expected = Buffer.from(artifact.deployedBytecode.object.slice(2), 'hex'), actual = Buffer.from(code.slice(2), 'hex');
  if (actual.length !== expected.length) return false;
  for (const refs of Object.values(artifact.deployedBytecode.immutableReferences ?? {})) for (const { start, length } of refs) {
    if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length !== 32 || start + length > actual.length) return false;
    actual.fill(0, start, start + length); expected.fill(0, start, start + length);
  }
  return actual.equals(expected);
}

export async function verifyPaidTrainingDeployment({ client, artifact, release, address, owner, blockNumber, purchasesPaused = true }) {
  valid(await client.getChainId() === 4663, 'SETUP_WRONG_CHAIN');
  const code = await client.getCode({ address, blockNumber });
  valid(matchesCompiledPaidRuntime(artifact, code), 'PAID_RUNTIME_MISMATCH');
  const read = (functionName, args = []) => client.readContract({ address, abi: artifact.abi, functionName, args, blockNumber });
  for (const name of ['collection', 'registry', 'legacyProgression', 'treasury', 'collectionCodeHash', 'registryCodeHash', 'legacyProgressionCodeHash']) valid(same(await read(name), release[name]), 'PAID_IMMUTABLE_MISMATCH');
  valid(same(await read('owner'), owner) && await read('deploymentChainId') === 4663n
    && await read('purchasesPaused') === purchasesPaused && await read('creditPriceWei') === BigInt(release.priceWei), 'PAID_DEPLOYMENT_STATE_MISMATCH');
  for (const skill of release.skills) valid(await read('allowedSkill', [skill.key]) === true, 'PAID_ALLOWLIST_MISMATCH');
  return { address, runtimeCodeHash: keccak256(code), purchasesPaused };
}
