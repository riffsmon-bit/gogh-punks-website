// Production EntryPoint bytecode is READ from Public Node at one pinned block.
// Every write/signature/credit/mint below uses our disposable, loopback-only Anvil world.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPublicClient, http, keccak256, parseAbi } from 'viem';
import { startEpochWorld } from './dev/epoch/local-world.mjs';
import { createPunkAgentDirectRelay, DIRECT_RELAY_ENTRY_POINT_ABI } from '../broker/src/agent-account/punk-agent-direct-relay.mjs';
import { readPunkAgentAccountRuntime } from '../broker/src/agent-account/punk-agent-account-runtime.mjs';
import { verifyPunkAgentOwnershipContinuity } from '../broker/src/agent-account/punk-agent-ownership-continuity.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--read-only-infrastructure') throw Error('Requires --read-only-infrastructure');
const entry = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const remote = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 15_000, retryCount: 0 }) });
assert.equal(await remote.getChainId(), 4663);
const block = await remote.getBlock();
const code = await remote.getCode({ address: entry, blockNumber: block.number });
assert.ok(code && code.length > 1000, 'REAL_ENTRYPOINT_CODE_REQUIRED');
const creator = await remote.readContract({ address: entry, abi: parseAbi(['function senderCreator() view returns (address)']),
  functionName: 'senderCreator', blockNumber: block.number });
const creatorCode = await remote.getCode({ address: creator, blockNumber: block.number });
assert.ok(creatorCode && creatorCode.length > 2);
const world = await startEpochWorld();
try {
  await world.client.request({ method: 'anvil_setCode', params: [entry, code] });
  await world.client.request({ method: 'anvil_setCode', params: [creator, creatorCode] });
  // In-memory fixture evidence only. This is never written to a deployment manifest.
  const deployment = JSON.parse(await readFile(new URL('../deployments/robinhood-epoch-proposal.json', import.meta.url), 'utf8'));
  const record = async (a, label) => {
    const h = world.history.find(x => x.label === `Deploy ${label}`); assert.ok(h);
    return { address: a.address, deploymentTransaction: h.hash, deploymentBlock: Number(h.block),
      runtimeBytecodeHash: keccak256(await world.client.getCode({ address: a.address })), verificationStatus: 'VERIFIED' };
  };
  deployment.status = 'DEPLOYED';
  deployment.contracts.GoghPunkAgentAccount = await record(world.implementation, 'GoghEpochAgentAccount');
  deployment.contracts.GoghPunkAgentAccountRegistry = await record(world.factory, 'GoghEpochAccountRegistry');
  deployment.epochAuthority = { wrapper: await record(world.wrapper, 'GoghPunkSessionWrapper'),
    epochs: await record(world.epochs, 'GoghPunkSessionWrapper'), progression: await record(world.progression, 'GoghEpochSkillProgression') };
  deployment.reusedContracts = { ArtAdapterRegistry: world.adapters.address,
    AutomatedSeaDropStudioFreeMintAdapter: world.adapter.address, SeaDrop: world.venue.address };
  for (const key of Object.keys(deployment.configuration)) deployment.configuration[key] = true;
  deployment.authorization = { deploymentAuthorized: true, automaticSubmissionEnabled: true };
  deployment.notes = 'IN-MEMORY DISPOSABLE FIXTURE; NOT PRODUCTION VERIFICATION OR AUTHORIZATION';
  for (const name of ['wrap', 'create', 'learn', 'equip', 'authorize']) await world.action(name);
  const funded = await world.wallet.sendTransaction({ to: world.account.address, value: 10n ** 16n, chain: null });
  assert.equal((await world.client.waitForTransactionReceipt({ hash: funded })).status, 'success');
  const runtime = () => readPunkAgentAccountRuntime({ client: world.client, deployment, tokenId: '93',
    expectedOwner: world.alice, expectedSessionKey: world.signer });
  const mission = async () => ({ tokenId: '93', account: world.account.address, owner: world.alice,
    sessionGeneration: String(await world.read(world.account, 'sessionGeneration')),
    authorizationTransactionHash: world.history.filter(h => h.label === 'configureAutonomousSession').at(-1).hash });
  const authorizedMission = await mission();
  assert.equal((await verifyPunkAgentOwnershipContinuity({ client: world.client, deployment,
    mission: authorizedMission, runtime: await runtime() })).verified, true);

  // The production relay receives ONLY local clients and an unlocked Anvil fixture account.
  const relay = createPunkAgentDirectRelay({ url: 'https://unused-local-fixture.invalid',
    publicClient: world.client, walletClient: { sendTransaction: args => world.wallet.sendTransaction({ ...args, chain: null }) },
    account: { address: world.alice, type: 'json-rpc' }, expectedAddress: world.alice });
  const operation = async () => {
    const { op } = await world.operation();
    op.accountGasLimits = `0x${((400000n << 128n) | 400000n).toString(16).padStart(64, '0')}`;
    op.preVerificationGas = 100000n;
    const hash = await world.client.readContract({ address: entry, abi: DIRECT_RELAY_ENTRY_POINT_ABI, functionName: 'getUserOpHash', args: [op] });
    op.signature = await world.wallet.signMessage({ account: world.signer, message: { raw: hash } });
    return { sender: op.sender, nonce: op.nonce, callData: op.callData, signature: op.signature,
      verificationGasLimit: 400000n, callGasLimit: 400000n, preVerificationGas: op.preVerificationGas,
      maxPriorityFeePerGas: 0n, maxFeePerGas: 1000000000n };
  };
  const estimate = op => relay.request({ method: 'eth_estimateUserOperationGas', params: [op, entry] });
  const submit = async op => {
    await estimate(op);
    const hash = await relay.request({ method: 'eth_sendUserOperation', params: [op, entry] });
    let receipt;
    for (let i = 0; i < 100; ++i) {
      receipt = await relay.request({ method: 'eth_getUserOperationReceipt', params: [hash] });
      if (receipt) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(receipt?.receipt.status, 'success');
    assert.equal(receipt?.success, true, 'REAL_ENTRYPOINT_USEROP_MUST_SUCCEED');
    assert.ok(receipt.actualGasCost > 0n, 'PUNK_MUST_PAY_GAS');
    assert.equal(receipt.sender, world.account.address.toLowerCase());
    return receipt;
  };
  const stale = await operation();
  await estimate(stale);
  await world.action('transfer'); await world.action('transfer');
  await assert.rejects(verifyPunkAgentOwnershipContinuity({ client: world.client, deployment,
    mission: authorizedMission, runtime: await runtime() }), /OWNERSHIP_CHANGED_SINCE_AUTHORIZATION/);
  await assert.rejects(estimate(stale));
  await world.action('authorize'); await assert.rejects(estimate(stale));
  // EntryPoint v0.8 treats validAfter as exclusive. Mine beyond it, without
  // changing the owner's signed window or weakening any production time check.
  await world.client.request({ method: 'evm_increaseTime', params: [1] });
  await world.client.request({ method: 'evm_mine', params: [] });
  const freshMission = await mission();
  assert.equal((await verifyPunkAgentOwnershipContinuity({ client: world.client, deployment,
    mission: freshMission, runtime: await runtime() })).verified, true);
  const firstOp = await operation(), first = await submit(firstOp);
  await assert.rejects(estimate(firstOp));
  assert.equal((await world.read(world.art, 'ownerOf', [700n])).toLowerCase(), world.account.address.toLowerCase());
  await world.action('unequip'); await assert.rejects(estimate(await operation()));
  await world.action('equip');
  const second = await submit(await operation());
  assert.equal((await world.read(world.art, 'ownerOf', [701n])).toLowerCase(), world.account.address.toLowerCase());
  assert.equal(await world.read(world.account, 'acquisitionNonce'), 2n);
  const final = await runtime();
  const gasPaid = first.actualGasCost + second.actualGasCost;
  assert.equal(final.nativeBalance + final.entryPointDeposit + gasPaid, 10n ** 16n);
  assert.equal((await remote.getBlock({ blockNumber: block.number })).hash, block.hash);
  console.log(JSON.stringify({ result: 'PASS', scope: 'DISPOSABLE_LOCAL_CHAIN_WITH_PINNED_ENTRYPOINT_RUNTIME',
    sourceBlock: String(block.number), sourceBlockHash: block.hash, entryPoint: entry,
    entryPointCodeHash: keccak256(code), senderCreator: creator, senderCreatorCodeHash: keccak256(creatorCode),
    confirmedUserOperations: 2, punkGasPaidWei: String(gasPaid), productionTransactions: 0,
    checks: ['actual runtime reader', 'actual authorization receipt and epoch guard', 'direct relay estimate, submit and receipt',
      'real EntryPoint hash/signature/nonce/handleOps', 'round-trip old session rejected', 'old generation and duplicate replay rejected',
      'unequipped mint rejected', 'ERC721 ownership postconditions', 'Punk native+deposit gas reconciliation'],
    notProven: ['third-party public bundler mempool acceptance', 'live chain fee quote', 'production training or adapters'] }, null, 2));
} finally { await world.close(); }
