#!/usr/bin/env node
// Offline review only: no RPC client, signer, credential read, or broadcast path.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { encodeDeployData, keccak256, pad, toHex } from 'viem';
import { MARKETPLACE_PINS } from '../broker/src/v4/marketplace/contracts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'contracts/src/GoghPunkMarketplaceGuard.sol';
const OWNER = '0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6';
const REVIEW = Object.freeze({
  source: '0x4cff37068d0341a50fe2427c09e38464889f1937ee4927394874ef5ca18b2ce3',
  creation: '0xddd3c2b98dc8fc16f23bf50c4334245fcbdf0b01028d4411379f4182eefddf2b',
  runtimeTemplate: '0xbc2dc251a0ec38831293e419aec60017ad1f5c244cd830b5415990fb16340861',
  abi: '0x3708466f85163cc5fcce5a5efac227666ad1c6081c9ecf5ce8edef43eb79ac2a',
  compiler: '0.8.34+commit.80d5c536',
  immutableOffsets: [966, 1066, 1099, 1192, 1295],
  registry: '0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844',
  registryCodeHash: '0x5a1001edb812b6ec2e233cbba6db4b7c680d0832453927696cf1ef623fff8e22',
  constructorRuntime: '0xf5a63f3ae0c40cb8c9f85b44aeab36d24b6a8f23da0b7df84fb70df4d813f9e7',
});
const sha256 = value => createHash('sha256').update(value).digest('hex');
const requireReview = (condition, code) => { if (!condition) throw new Error(code); };
const isCode = value => typeof value === 'string' && /^0x(?:[a-f0-9]{2})+$/i.test(value);

export function buildGuardDeploymentProposal({ artifact, source }) {
  requireReview(typeof source === 'string' && keccak256(toHex(source)) === REVIEW.source, 'GUARD_SOURCE_NOT_REVIEWED');
  requireReview(isCode(artifact?.bytecode?.object)
    && keccak256(artifact.bytecode.object) === REVIEW.creation, 'GUARD_CREATION_NOT_REVIEWED');
  requireReview(isCode(artifact?.deployedBytecode?.object)
    && keccak256(artifact.deployedBytecode.object) === REVIEW.runtimeTemplate, 'GUARD_RUNTIME_TEMPLATE_NOT_REVIEWED');
  requireReview(Array.isArray(artifact?.abi)
    && keccak256(toHex(JSON.stringify(artifact.abi))) === REVIEW.abi, 'GUARD_ABI_NOT_REVIEWED');
  const metadata = artifact.metadata;
  requireReview(metadata?.compiler?.version === REVIEW.compiler && metadata?.language === 'Solidity'
    && metadata?.sources?.[SOURCE]?.keccak256 === REVIEW.source
    && Object.keys(metadata.sources).length === 1
    && metadata?.settings?.compilationTarget?.[SOURCE] === 'GoghPunkMarketplaceGuard'
    && Object.keys(metadata.settings.compilationTarget).length === 1
    && metadata.settings.optimizer?.enabled === true && metadata.settings.optimizer?.runs === 500
    && metadata.settings.viaIR === true && metadata.settings.evmVersion === 'cancun'
    && metadata.settings.metadata?.bytecodeHash === 'none'
    && Object.keys(metadata.settings.libraries ?? {}).length === 0, 'GUARD_BUILD_NOT_REVIEWED');
  requireReview(Object.keys(artifact.bytecode.linkReferences ?? {}).length === 0
    && Object.keys(artifact.deployedBytecode.linkReferences ?? {}).length === 0, 'GUARD_LINKS_NOT_REVIEWED');
  const references = Object.values(artifact.deployedBytecode.immutableReferences ?? {}).flat();
  requireReview(references.length === 5 && references.every(ref => ref.length === 32)
    && JSON.stringify(references.map(ref => ref.start).sort((a, b) => a - b)) === JSON.stringify(REVIEW.immutableOffsets)
    && references.every(ref => artifact.deployedBytecode.object.slice(2 + ref.start * 2, 2 + (ref.start + 32) * 2) === '0'.repeat(64)),
  'GUARD_IMMUTABLES_NOT_REVIEWED');
  requireReview(MARKETPLACE_PINS.chainId === 4663 && MARKETPLACE_PINS.registry === REVIEW.registry
    && MARKETPLACE_PINS.registryCodeHash === REVIEW.registryCodeHash, 'GUARD_DEPENDENCY_NOT_REVIEWED');
  // Fixed offsets belong only to the exact bytecode pinned above. Compiler AST
  // IDs can vary across build graphs. The resulting hash also matches the prior
  // actual constructor result in disposable-repair-evidence.json.
  const immutableBindings = [
    { name: 'registry', offsets: [966, 1099, 1192], value: pad(REVIEW.registry) },
    { name: 'registryCodeHash', offsets: [1066, 1295], value: REVIEW.registryCodeHash },
  ];
  let expectedRuntime = artifact.deployedBytecode.object;
  for (const binding of immutableBindings) for (const offset of binding.offsets) {
    expectedRuntime = `${expectedRuntime.slice(0, 2 + offset * 2)}${binding.value.slice(2)}${expectedRuntime.slice(2 + (offset + 32) * 2)}`;
  }
  requireReview(keccak256(expectedRuntime) === REVIEW.constructorRuntime, 'GUARD_CONSTRUCTOR_RUNTIME_NOT_REVIEWED');
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [REVIEW.registry] });
  return {
    schema: 'GOGH_MARKETPLACE_GUARD_DEPLOYMENT_PROPOSAL_V1',
    action: 'DEPLOY_PURCHASE_POSTCONDITION_GUARD',
    status: 'OFFLINE_PROPOSAL_REQUIRES_FRESH_OWNER_REVIEW',
    chainId: 4663,
    productionAuthority: false,
    broadcastReady: false,
    deploymentAddress: null,
    deploymentTransactionHash: null,
    publicTransactions: 0,
    postedOrders: 0,
    purpose: 'Final check in an owner-confirmed, exact ETH listing purchase batch. No custody or spending authority.',
    payer: { address: OWNER, role: 'PROPOSED_DEPLOYMENT_FEE_PAYER_ONLY', contractAdmin: false },
    constructor: { signature: 'constructor(address registry_)', arguments: [REVIEW.registry] },
    exactCreateTransaction: { from: OWNER, chainId: '0x1237', value: '0x0', data },
    transactionDataHash: keccak256(data),
    pendingTransactionFields: ['nonce', 'gas', 'gasPrice or EIP-1559 fee caps'],
    maximumNetworkFeeWei: null,
    liveAnchor: null,
    build: {
      contract: 'GoghPunkMarketplaceGuard',
      source: SOURCE,
      sourceSha256: sha256(source),
      sourceKeccak256: REVIEW.source,
      compilerVersion: REVIEW.compiler,
      settings: metadata.settings,
      abi: artifact.abi,
      abiHash: REVIEW.abi,
      creationBytecodeHash: REVIEW.creation,
      creationBytecodeBytes: (artifact.bytecode.object.length - 2) / 2,
      runtimeTemplateHash: REVIEW.runtimeTemplate,
      runtimeTemplate: artifact.deployedBytecode.object,
      immutableReferences: artifact.deployedBytecode.immutableReferences,
      immutableBindings,
      expectedConstructorRuntimeHash: REVIEW.constructorRuntime,
      expectedRuntimeEvidence: 'Offline immutable substitution; matches the prior owned-fork constructor result in docs/v2-marketplace/disposable-repair-evidence.json. No public deployment is implied.',
      runtimeTemplateWarning: 'This zero-immutable template hash is NOT a deployed runtime code hash. The constructor embeds registry address and its code hash.',
    },
    expectedDependencies: {
      registry: { address: REVIEW.registry, runtimeCodeHash: REVIEW.registryCodeHash },
      punkCollection: MARKETPLACE_PINS.collection,
      agentImplementation: { address: MARKETPLACE_PINS.implementation, runtimeCodeHash: MARKETPLACE_PINS.implementationCodeHash },
      seaport: { address: MARKETPLACE_PINS.seaport, runtimeCodeHash: MARKETPLACE_PINS.seaportCodeHash },
    },
    requiredBeforeWalletConfirmation: [
      'Re-read chain 4663 and the registry runtime pin at one fresh canonical anchor.',
      'Simulate this exact contract creation with the current registry code; capture the constructor-populated runtime.',
      'Bind the intended payer, fresh pending nonce, gas estimate, maximum fee and review expiry.',
      'Present the complete fee-bounded transaction for explicit owner approval.',
    ],
    requiredBeforePurchaseExposure: [
      'Verify the exact creation receipt and canonical finality; runtime must match expectedConstructorRuntimeHash, and registry() and registryCodeHash() must match these pins.',
      'Independently review and pin the observed deployed guard runtime; never use runtimeTemplateHash as the deployment pin.',
      'Verify the current owner, canonical Agent, listing, skill, budget, reserve, simulation and durable review-journal gates.',
    ],
    exclusions: ['WETH bid deployment', 'order publication', 'NFT transfer', 'Punk burn', 'refund', 'wallet module installation', 'autonomous execution enablement'],
  };
}

export async function prepareGuardDeploymentProposal({ artifacts, output }) {
  const artifactPath = resolve(artifacts, 'GoghPunkMarketplaceGuard.sol/GoghPunkMarketplaceGuard.json');
  const [raw, source] = await Promise.all([readFile(artifactPath), readFile(resolve(ROOT, SOURCE), 'utf8')]);
  const proposal = buildGuardDeploymentProposal({ artifact: JSON.parse(raw), source });
  proposal.build.inputArtifactSha256 = sha256(raw);
  const text = `${JSON.stringify(proposal, null, 2)}\n`;
  if (output) await writeFile(resolve(output), text, { mode: 0o644 });
  return text;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    requireReview((key === '--artifacts' || key === '--output') && process.argv[i + 1]
      && !process.argv[i + 1].startsWith('--') && options[key.slice(2)] === undefined, 'USAGE: --artifacts BUILD_DIRECTORY [--output PROPOSAL_FILE]');
    options[key.slice(2)] = process.argv[i + 1];
  }
  requireReview(options.artifacts, 'ARTIFACT_DIRECTORY_REQUIRED');
  const result = await prepareGuardDeploymentProposal(options);
  if (!options.output) process.stdout.write(result);
  else process.stdout.write('Offline guard proposal written. No chain requests or transactions were made.\n');
}
