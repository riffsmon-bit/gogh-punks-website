// Explicit opt-in. Public endpoints: reads only. Every send/impersonation/state
// override below goes solely to a newly spawned private loopback Anvil process.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, getCreate2Address, http, keccak256, parseAbi } from 'viem';
import { manifestHash } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { buildRegistryFeeReview, validateAdministratorSelection, validateRegistryFeeReview,
  assertRegistryTransactionFeeLimits } from '../broker/src/v4/skill-forge/registry-administrator-review.mjs';
import { loadRegistryCanaryInputs, prepareRegistryCanaryLive, verifyRegistryCanary } from '../broker/src/v4/skill-forge/registry-canary.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--fork-readonly') throw Error('Requires --fork-readonly; no public signing or writes');
const selection = JSON.parse(await readFile(new URL('../ops/forge-registry-admin-selection.json', import.meta.url), 'utf8'));
const { administrator } = validateAdministratorSelection(selection);
const RPC = 'https://robinhood-rpc.publicnode.com';
const publicClient = createPublicClient({ transport: http(RPC, { timeout: 12000, retryCount: 0 }), cacheTime: 0 });
const inputs = await loadRegistryCanaryInputs();
const prepared = await prepareRegistryCanaryLive({ client: publicClient, inputs, guardian: administrator });
const { proposal } = prepared;
const target = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B';
const factory = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
assert.equal(proposal.guardianContext.delegation, target);
assert.equal(proposal.guardianContext.delegationCodeHash, '0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0');
const sourceUrl = 'https://raw.githubusercontent.com/MetaMask/delegation-framework/bfbdf9795a976833ed2fa000baf42fbb83958b03/broadcast/DeployEIP7702StatelessDeleGator.s.sol/1/run-latest.json';
const sourceResponse = await fetch(sourceUrl, { signal: AbortSignal.timeout(15000), redirect: 'error' });
assert.equal(sourceResponse.status, 200);
const sourceText = await sourceResponse.text();
const sourceHash = createHash('sha256').update(sourceText).digest('hex');
assert.equal(sourceHash, '4cfa1d6e066b2f642e5bb66dc9711e637aa349899e16fb74492137fc84f8f0f1');
const published = JSON.parse(sourceText).transactions[0].transaction;
assert.equal(published.to.toLowerCase(), factory); assert.equal(published.value, '0x0');
assert.equal(getCreate2Address({ from: factory, salt: published.input.slice(0, 66), bytecode: `0x${published.input.slice(66)}` }), target);
const reservation = createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r));
const port = reservation.address().port; await new Promise(r => reservation.close(r));
const anvil = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(port), '--chain-id', '4663',
  '--fork-url', RPC, '--fork-block-number', proposal.anchor.number], { stdio: ['ignore', 'ignore', 'ignore'] });
let startupError; anvil.on('error', e => { startupError = e; });
try {
  const transport = http(`http://127.0.0.1:${port}`, { timeout: 12000, retryCount: 0 });
  const local = createPublicClient({ transport, cacheTime: 0 });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError || anvil.exitCode !== null) throw Error('OWNED_FORK_START_FAILED');
    try { ready = await local.getChainId() === 4663; } catch { }
    if (ready) break; await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(ready && /anvil/i.test(await local.request({ method: 'web3_clientVersion' })));
  assert.equal((await local.getBlock({ blockNumber: BigInt(proposal.anchor.number) })).hash, proposal.anchor.hash);
  const [disposable] = await local.request({ method: 'eth_accounts' });
  const wallet = createWalletClient({ transport });
  assert.equal(keccak256(await local.getCode({ address: factory })), '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989');
  // Reproduce the published constructor at its exact CREATE2 address on chain 4663.
  // This clears ONLY the disposable fork's copy, not any public deployment.
  await local.request({ method: 'anvil_setCode', params: [target, '0x'] });
  await local.request({ method: 'anvil_setNonce', params: [target, '0x0'] });
  const recreation = await wallet.sendTransaction({ account: disposable, chain: null, to: factory,
    data: published.input, value: 0n, gas: 5_000_000n });
  assert.equal((await local.waitForTransactionReceipt({ hash: recreation })).status, 'success');
  assert.equal(keccak256(await local.getCode({ address: target })), proposal.guardianContext.delegationCodeHash);
  await local.request({ method: 'anvil_impersonateAccount', params: [administrator] });
  const hashes = [], observations = [];
  const parentAbi = parseAbi(['function gasEstimateL1Component(address to,bool contractCreation,bytes data) returns (uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)']);
  for (const [i, step] of proposal.transactions.entries()) {
    const args = { account: administrator, ...(step.to ? { to: step.to } : {}), data: step.data, value: 0n, nonce: Number(step.nonce) };
    const localGas = await local.estimateGas(args);
    const [parentGas] = await publicClient.readContract({ address: '0x00000000000000000000000000000000000000C8',
      abi: parentAbi, functionName: 'gasEstimateL1Component', account: administrator,
      args: [step.to ?? '0x0000000000000000000000000000000000000000', step.to === null, step.data], blockNumber: BigInt(proposal.anchor.number) });
    observations.push({ nonce: step.nonce, dataHash: manifestHash(step), localGasEstimate: String(localGas),
      parentGasEstimate: String(parentGas), publicCreationGasEstimate: i === 0 ? prepared.estimate.gas : '0' });
    const composed = localGas + parentGas;
    const estimated = i === 0 && BigInt(prepared.estimate.gas) > composed ? BigInt(prepared.estimate.gas) : composed;
    const gas = (estimated * 3n + 1n) / 2n;
    assert.ok(gas <= 2_000_000n);
    const tx = await wallet.sendTransaction({ ...args, chain: null, type: 'eip1559', gas,
      maxFeePerGas: BigInt(prepared.estimate.observedGasPriceWei) * 2n, maxPriorityFeePerGas: 0n });
    assert.equal((await local.waitForTransactionReceipt({ hash: tx })).status, 'success'); hashes.push(tx);
  }
  await local.request({ method: 'anvil_mine', params: ['0xc'] });
  const verified = await verifyRegistryCanary({ client: local, inputs, proposal, transactionHashes: hashes });
  const abi = parseAbi(['function execute((address target,uint256 value,bytes callData) execution) payable', 'error NotEntryPointOrSelf()']);
  await assert.rejects(local.simulateContract({ address: administrator, abi, functionName: 'execute', account: disposable,
    args: [{ target: proposal.registryPredicted, value: 0n, callData: proposal.transactions[1].data }] }),
  error => error.walk?.(e => e.data?.errorName === 'NotEntryPointOrSelf')?.data?.errorName === 'NotEntryPointOrSelf');
  // Ensure the actual public account stayed at the reviewed nonce and code throughout the rehearsal.
  const closing = await prepareRegistryCanaryLive({ client: publicClient, inputs, guardian: administrator });
  assert.equal(closing.proposal.transactions[0].nonce, proposal.transactions[0].nonce);
  assert.equal(manifestHash(closing.proposal.guardianContext), manifestHash(proposal.guardianContext));
  assert.equal((await publicClient.getBlock({ blockNumber: BigInt(proposal.anchor.number) })).hash, proposal.anchor.hash);
  const feeReview = buildRegistryFeeReview({ inputs, proposal, selection, observations,
    observedGasPriceWei: String(BigInt(prepared.estimate.observedGasPriceWei) > BigInt(closing.estimate.observedGasPriceWei)
      ? BigInt(prepared.estimate.observedGasPriceWei) : BigInt(closing.estimate.observedGasPriceWei)) });
  validateRegistryFeeReview({ inputs, proposal, selection, feeReview });
  for (const [i, hash] of hashes.entries()) assertRegistryTransactionFeeLimits(await local.getTransaction({ hash }), feeReview.steps[i]);
  console.log(JSON.stringify({ status: 'LIMITED_REVIEW_PASSED_NOT_AUTHORIZED', environment: 'DISPOSABLE_ANVIL_FORK_NOT_PUBLIC_CHAIN',
    administrator, selectionHash: manifestHash(selection),
    publicRpc: RPC, anchor: proposal.anchor, closingAnchor: closing.proposal.anchor,
    guardianContext: proposal.guardianContext, sourceUrl, sourceHash, publishedInitCodeReproduced: true,
    independentSourceCompilation: false, outsiderDelegateExecutionRejected: true, existingSignedDelegationsEnumerated: false,
    cappedLocalRegistryTransactionsVerified: true,
    publicBalanceWei: String(await publicClient.getBalance({ address: administrator, blockNumber: BigInt(closing.proposal.anchor.number) })),
    proposal, verifiedLocalRegistry: verified, feeReview, publicTransactions: 0, realBurns: 0,
    securityReviewComplete: false, productionTrainingAuthorized: false, productionBurnAuthorized: false }, null, 2));
} finally { if (anvil.exitCode === null) anvil.kill('SIGTERM'); }
