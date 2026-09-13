import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem';
import { buildGuardDeploymentProposal } from '../scripts/prepare-marketplace-guard-deployment.mjs';

const proposal = JSON.parse(await readFile(new URL('../docs/v2-marketplace/eth-guard-deployment-proposal.json', import.meta.url)));
const source = await readFile(new URL('../contracts/src/GoghPunkMarketplaceGuard.sol', import.meta.url), 'utf8');
const copiedEvidence = JSON.parse(await readFile(new URL('../docs/v2-marketplace/disposable-repair-evidence.json', import.meta.url)));
const constructorArguments = encodeAbiParameters(parseAbiParameters('address'), [proposal.expectedDependencies.registry.address]);

// The committed review contains the real pinned compiler output, not invented
// executable fixtures. Reconstruct its build envelope to make this test portable
// without depending on another worktree's temporary artifacts.
function fixture() {
  return {
    source,
    artifact: {
      abi: structuredClone(proposal.build.abi),
      bytecode: { object: proposal.exactCreateTransaction.data.slice(0, -64), linkReferences: {} },
      deployedBytecode: {
        object: proposal.build.runtimeTemplate,
        immutableReferences: structuredClone(proposal.build.immutableReferences),
        linkReferences: {},
      },
      metadata: {
        compiler: { version: proposal.build.compilerVersion },
        language: 'Solidity',
        settings: structuredClone(proposal.build.settings),
        sources: { [proposal.build.source]: { keccak256: proposal.build.sourceKeccak256 } },
      },
    },
  };
}

test('committed proposal exactly reproduces pinned source, compiler output and owner/registry initcode', () => {
  const actual = buildGuardDeploymentProposal(fixture());
  const expected = structuredClone(proposal);
  delete expected.build.inputArtifactSha256;
  assert.deepEqual(actual, expected);
  assert.equal(actual.exactCreateTransaction.data,
    `${fixture().artifact.bytecode.object}${constructorArguments.slice(2)}`);
  assert.equal(keccak256(actual.exactCreateTransaction.data), actual.transactionDataHash);
  assert.equal(actual.exactCreateTransaction.data.length,
    2 + actual.build.creationBytecodeBytes * 2 + 64, 'one address constructor, no appended calls');
  assert.equal(actual.payer.address, '0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6');
  assert.equal(actual.exactCreateTransaction.chainId, '0x1237');
  assert.equal(actual.expectedDependencies.registry.address, '0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844');
});

test('proposal never invents a live quote, deployed address, runtime pin or production authority', () => {
  const actual = buildGuardDeploymentProposal(fixture());
  assert.equal(actual.broadcastReady, false);
  assert.equal(actual.productionAuthority, false);
  assert.equal(actual.maximumNetworkFeeWei, null);
  assert.equal(actual.liveAnchor, null);
  assert.equal(actual.deploymentAddress, null);
  assert.equal(actual.deploymentTransactionHash, null);
  assert.equal(actual.publicTransactions, 0);
  assert.equal(actual.postedOrders, 0);
  assert.equal(actual.payer.contractAdmin, false);
  assert.equal(actual.exactCreateTransaction.value, '0x0');
  assert.deepEqual(Object.keys(actual.exactCreateTransaction).sort(), ['chainId', 'data', 'from', 'value']);
  assert.equal(actual.build.deployedRuntimeHash, undefined);
  assert.match(actual.build.runtimeTemplateWarning, /NOT a deployed runtime code hash/);
  const publicFunctions = actual.build.abi.filter(item => item.type === 'function');
  assert.ok(publicFunctions.every(item => item.stateMutability === 'view'));
  assert.deepEqual(publicFunctions.map(item => item.name).sort(), ['PUNKS', 'assertPurchase', 'registry', 'registryCodeHash']);
});

test('expected constructor runtime binds both immutables and matches recorded actual copied deployment', () => {
  const runtime = Buffer.from(proposal.build.runtimeTemplate.slice(2), 'hex');
  for (const binding of proposal.build.immutableBindings) {
    for (const offset of binding.offsets) Buffer.from(binding.value.slice(2), 'hex').copy(runtime, offset);
  }
  const result = keccak256(`0x${runtime.toString('hex')}`);
  assert.equal(result, proposal.build.expectedConstructorRuntimeHash);
  assert.equal(result, copiedEvidence.localContracts.guardCodeHash);
  assert.notEqual(result, proposal.build.runtimeTemplateHash);
  assert.equal(copiedEvidence.sourcePins.registry, proposal.expectedDependencies.registry.address);
  assert.equal(copiedEvidence.sourcePins.registryCodeHash, proposal.expectedDependencies.registry.runtimeCodeHash);
  assert.equal(copiedEvidence.publicTransactions, 0);
  assert.match(proposal.build.expectedRuntimeEvidence, /No public deployment is implied/);
});

for (const [name, mutate, expected] of [
  ['source substitution', f => { f.source += '\n// unreviewed'; }, /SOURCE_NOT_REVIEWED/],
  ['creation substitution', f => { f.artifact.bytecode.object += '00'; }, /CREATION_NOT_REVIEWED/],
  ['creation malformed hex', f => { f.artifact.bytecode.object += 'z'; }, /CREATION_NOT_REVIEWED/],
  ['runtime substitution', f => { f.artifact.deployedBytecode.object += '00'; }, /RUNTIME_TEMPLATE_NOT_REVIEWED/],
  ['constructor change', f => { f.artifact.abi[0].inputs.push({ name: 'admin', type: 'address' }); }, /ABI_NOT_REVIEWED/],
  ['new authority function', f => { f.artifact.abi.push({ type: 'function', name: 'execute', inputs: [], outputs: [], stateMutability: 'nonpayable' }); }, /ABI_NOT_REVIEWED/],
  ['compiler change', f => { f.artifact.metadata.compiler.version = '0.8.35'; }, /BUILD_NOT_REVIEWED/],
  ['optimizer change', f => { f.artifact.metadata.settings.optimizer.runs = 200; }, /BUILD_NOT_REVIEWED/],
  ['IR change', f => { f.artifact.metadata.settings.viaIR = false; }, /BUILD_NOT_REVIEWED/],
  ['EVM target change', f => { f.artifact.metadata.settings.evmVersion = 'paris'; }, /BUILD_NOT_REVIEWED/],
  ['metadata source mismatch', f => { f.artifact.metadata.sources[proposal.build.source].keccak256 = `0x${'1'.repeat(64)}`; }, /BUILD_NOT_REVIEWED/],
  ['additional source', f => { f.artifact.metadata.sources['Unreviewed.sol'] = {}; }, /BUILD_NOT_REVIEWED/],
  ['compilation target mismatch', f => { f.artifact.metadata.settings.compilationTarget[proposal.build.source] = 'Other'; }, /BUILD_NOT_REVIEWED/],
  ['library link', f => { f.artifact.bytecode.linkReferences['Other.sol'] = { Other: [] }; }, /LINKS_NOT_REVIEWED/],
  ['missing immutable locations', f => { f.artifact.deployedBytecode.immutableReferences = {}; }, /IMMUTABLES_NOT_REVIEWED/],
  ['substituted immutable location', f => { Object.values(f.artifact.deployedBytecode.immutableReferences)[0][0].start += 1; }, /IMMUTABLES_NOT_REVIEWED/],
  ['shortened immutable', f => { Object.values(f.artifact.deployedBytecode.immutableReferences)[0][0].length = 20; }, /IMMUTABLES_NOT_REVIEWED/],
]) {
  test(`unreviewed build cannot become a deployment proposal: ${name}`, () => {
    const f = fixture(); mutate(f);
    assert.throws(() => buildGuardDeploymentProposal(f), expected);
  });
}

test('proposal generation is offline even when network access is forbidden', () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('NO_NETWORK_ALLOWED'); };
  try { assert.equal(buildGuardDeploymentProposal(fixture()).broadcastReady, false); }
  finally { globalThis.fetch = previous; }
});
