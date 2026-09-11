import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { readEpochOwnership } from '../broker/src/v4/skill-forge/epoch-ownership.mjs';
import { readFile } from 'node:fs/promises';
import { normalizePunkAgentAccountDeployment, punkAgentAccountReadiness, PUNK_AGENT_ACCOUNT_DEPLOYMENT_SCHEMA }
  from '../broker/src/agent-account/punk-agent-account-manifest.mjs';
const address = n => `0x${String(n).repeat(40)}`;
const wrapper = address(1), epochs = address(2), collection = address(3), progression = address(4), alice = address(5);
function fixture() {
  const values = { COLLECTION: collection, CHAIN_ID: 4663n, epochs, wrapper, resolveOwner: alice,
    isWrapped: true, epoch: 1n, securityGeneration: 0n, executionPaused: false };
  const config = { wrapper, epochs, wrapperCodeHash: keccak256('0x1234'), epochsCodeHash: keccak256('0x5678') };
  const reads = [];
  const client = {
    getCode: async a => { reads.push(a); return a.address === wrapper ? '0x1234' : '0x5678'; },
    readContract: async a => { reads.push(a); if (a.functionName === 'ownerOf') return a.address === collection ? wrapper : alice; return values[a.functionName]; },
  };
  return { values, config, reads, client, read: () => readEpochOwnership({ client, blockNumber: 123n, chainId: 4663, collection, progression, tokenId: '93', config }) };
}
test('pinned epoch snapshot verifies custody, receipt owner and immutable links at one block', async () => {
  const f = fixture(); const result = await f.read();
  assert.equal(result.owner, alice); assert.equal(result.authorityEpoch, `${wrapper}:1:0`);
  assert.ok(f.reads.every(a => a.blockNumber === 123n));
});
for (const failure of ['hash', 'chain', 'collection', 'writer', 'epochZero', 'missingOwner', 'custody', 'rpc']) {
  test(`epoch ownership rejects ${failure}`, async () => {
    const f = fixture();
    if (failure === 'hash') f.config.wrapperCodeHash = keccak256('0x9999');
    if (failure === 'chain') f.values.CHAIN_ID = 1n;
    if (failure === 'collection') f.values.COLLECTION = alice;
    if (failure === 'writer') f.values.wrapper = alice;
    if (failure === 'epochZero') f.values.epoch = 0n;
    if (failure === 'missingOwner') f.values.resolveOwner = address(0);
    if (failure === 'custody') f.values.isWrapped = false;
    if (failure === 'rpc') f.client.getCode = async () => { throw Error('RPC_UNAVAILABLE'); };
    await assert.rejects(f.read());
  });
}
test('pins are required and cannot be replaced by self-advertised capability', async () => {
  const f = fixture(); delete f.config.epochsCodeHash;
  await assert.rejects(f.read(), /PINS_REQUIRED/);
});

const proposal = JSON.parse(await readFile(new URL('../deployments/robinhood-epoch-proposal.json', import.meta.url), 'utf8'));
test('checked-in epoch proposal cannot activate setup or submission', () => {
  const manifest = normalizePunkAgentAccountDeployment(proposal);
  const result = punkAgentAccountReadiness(manifest);
  assert.equal(result.ready, false); assert.equal(result.ownerSetupReady, false);
  assert.equal(result.requiresWrapping, true); assert.equal(result.maximumOwnerTransactions, 4);
  for (const gate of ['WRAPPER_OPERATOR_REGISTRATION_CONFIRMED', 'WRAPPED_OWNER_INTEGRATION_READY', 'LEGACY_ENROLLMENT_REVIEWED']) {
    assert.ok(result.setupBlockers.includes(gate));
  }
  assert.ok(Object.values(manifest.epochAuthority).every(v => v === null));
});
for (const failure of ['missingPins', 'partialEvidence', 'undeployedAuthority', 'extraAuthority', 'legacyInjection']) {
  test(`deployment schema rejects ${failure}`, () => {
    const input = structuredClone(proposal);
    if (failure === 'missingPins') delete input.epochAuthority;
    if (failure === 'partialEvidence') input.epochAuthority.wrapper = { address: wrapper };
    if (failure === 'undeployedAuthority') input.authorization.automaticSubmissionEnabled = true;
    if (failure === 'extraAuthority') input.epochAuthority.walletSigner = alice;
    if (failure === 'legacyInjection') input.schema = PUNK_AGENT_ACCOUNT_DEPLOYMENT_SCHEMA;
    assert.throws(() => normalizePunkAgentAccountDeployment(input), e => e.code === 'INVALID_MANIFEST');
  });
}
test('deployed code alone cannot unlock enrollment before collection, owner UI and migration review', () => {
  const input = structuredClone(proposal);
  const record = { address: wrapper, deploymentTransaction: `0x${'a'.repeat(64)}`, deploymentBlock: 1,
    runtimeBytecodeHash: keccak256('0x1234'), verificationStatus: 'VERIFIED' };
  input.status = 'DEPLOYED'; input.authorization.deploymentAuthorized = true;
  input.authorization.automaticSubmissionEnabled = true;
  for (const key of Object.keys(input.contracts)) input.contracts[key] = record;
  for (const key of Object.keys(input.epochAuthority)) input.epochAuthority[key] = record;
  for (const key of Object.keys(input.configuration)) input.configuration[key] = true;
  for (const gate of ['wrapperOperatorRegistrationConfirmed', 'wrappedOwnerIntegrationReady', 'legacyEnrollmentReviewed']) {
    input.configuration[gate] = false;
    assert.equal(punkAgentAccountReadiness(input).ownerSetupReady, false);
    assert.equal(punkAgentAccountReadiness(input).ready, false);
    input.configuration[gate] = true;
  }
  assert.equal(punkAgentAccountReadiness(input).ready, true);
});
