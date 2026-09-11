// Offline artifact/source review only. No public RPC, keys, signer or deployment.
import { readFile } from 'node:fs/promises';
import { keccak256 } from 'viem';
import { loadRegistryCanaryInputs } from '../broker/src/v4/skill-forge/registry-canary.mjs';
import { manifestHash } from '../broker/src/v4/skill-forge/capability-resolver.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--review-only') throw Error('Requires --review-only');
const root = new URL('../', import.meta.url);
const deployment = JSON.parse(await readFile(new URL('deployments/robinhood-skill-forge.json', root), 'utf8'));
if (deployment.status !== 'UNDEPLOYED' || deployment.registry !== null || deployment.progression !== null
  || deployment.trainingSource !== null || deployment.productionTrainingAuthorized !== false
  || deployment.productionBurnAuthorized !== false) throw Error('REVIEW_BASELINE_CHANGED');
const registry = await loadRegistryCanaryInputs();
const contracts = [];
for (const name of ['GoghSkillRegistry', 'GoghReviewedSkillProgression', 'GoghRaritySkillProgression',
  'GoghSkillProgression', 'GoghForgeSupplyPolicy']) {
  const path = `contracts/out/${name}.sol/${name}.json`;
  const artifact = JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const metadata = artifact.metadata;
  if (metadata?.compiler?.version !== '0.8.34+commit.80d5c536'
    || metadata.settings?.viaIR !== true || metadata.settings.optimizer?.enabled !== true
    || metadata.settings.optimizer.runs !== 500 || metadata.settings.evmVersion !== 'cancun'
    || metadata.settings.compilationTarget?.[`contracts/src/${name}.sol`] !== name
    || Object.keys(artifact.bytecode?.linkReferences ?? {}).length
    || Object.keys(artifact.deployedBytecode?.linkReferences ?? {}).length
    || !/^0x(?:[a-f0-9]{2})+$/i.test(artifact.bytecode?.object ?? '')
    || !/^0x(?:[a-f0-9]{2})+$/i.test(artifact.deployedBytecode?.object ?? '')) throw Error('UNVERIFIED_FORGE_BUILD');
  const runtimeBytes = (artifact.deployedBytecode.object.length - 2) / 2;
  if (runtimeBytes > 24576) throw Error('CONTRACT_SIZE_LIMIT');
  const sources = {};
  for (const [source, pin] of Object.entries(metadata.sources ?? {})) {
    if ((!source.startsWith('contracts/src/') && !source.startsWith('node_modules/@openzeppelin/contracts/'))
      || source.includes('..') || !/^[A-Za-z0-9_@./-]+$/.test(source)) throw Error('UNEXPECTED_SOURCE_PATH');
    const actual = keccak256(await readFile(new URL(source, root)));
    if (actual !== pin.keccak256) throw Error('STALE_FORGE_ARTIFACT');
    sources[source] = actual;
  }
  if (!sources[`contracts/src/${name}.sol`]) throw Error('MISSING_CONTRACT_SOURCE');
  const separateDeployment = ['GoghSkillRegistry', 'GoghReviewedSkillProgression'].includes(name);
  contracts.push({ name, status: separateDeployment ? 'COMPILED_REVIEW_ONLY' : 'INHERITED_OR_INTERNAL_LIBRARY_NO_SEPARATE_DEPLOYMENT',
    artifact: path, runtimeBytes, compiler: metadata.compiler.version, settings: metadata.settings,
    sourceHashes: sources, metadataHash: manifestHash(metadata), creationBytecodeHash: keccak256(artifact.bytecode.object),
    runtimeTemplateHash: keccak256(artifact.deployedBytecode.object),
    runtimeHashRequiresConstructorImmutables: Object.keys(artifact.deployedBytecode.immutableReferences ?? {}).length > 0,
    constructorInputs: artifact.abi.find(entry => entry.type === 'constructor')?.inputs ?? [],
    separateDeployment, canBroadcast: false });
}
console.log(JSON.stringify({ schemaVersion: 'GOGH_FORGE_BUILD_REVIEW_V1', status: 'PREPARED_WITH_BLOCKERS',
  chainId: 4663, originalCollection: deployment.collection, ownership: 'ORIGINAL_NFT', contracts,
  registryPins: registry.pins,
  progressionConstructorPlan: { collection_: deployment.collection,
    registry_: { status: 'REQUIRES_VERIFIED_PUBLIC_REGISTRY_ADDRESS' },
    trainingSource_: { status: 'BLOCKED_PRODUCTION_SOURCE_UNIMPLEMENTED_AND_UNREVIEWED' },
    root_: deployment.allocationRoot, snapshotHash_: deployment.snapshotHash },
  productionTrainingSource: { status: 'UNIMPLEMENTED', artifact: null, address: null,
    requiredProperties: ['Verify current control of sacrifice and target original Punks.',
      'Resolve asset recovery for every persistent account before parent burn.',
      'Enforce the 1111 circulating-supply floor around the atomic sacrifice.',
      'Issue exactly one credit once, only after the same atomic operation burns the sacrifice.',
      'Reject pending obligations, incomplete evidence, duplicate sacrifice and reentrancy.'] },
  omittedDeployments: { wrapperAndEpochContracts: 'Superseded by the original-NFT ownership decision.',
    baseProgressionContracts: 'Inherited into GoghReviewedSkillProgression; do not deploy three competing progression stores.',
    supplyPolicy: 'Internal library only; its presence does not implement a production burn source.' },
  productionTrainingAuthorized: false, productionBurnAuthorized: false, canBroadcast: false,
  note: 'Build/source pins and constructor plan only. Unknown dependencies have no encoded deployment transaction or placeholder address. Runtime templates with immutables are not deployed runtime hashes.' }, null, 2));
