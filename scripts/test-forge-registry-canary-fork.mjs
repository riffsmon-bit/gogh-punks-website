// PublicNode is read only. All deployment/configuration writes go exclusively to
// this process's private disposable Anvil fork. No real keys, NFT or ETH are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, http } from 'viem';
import { loadRegistryCanaryInputs, prepareRegistryCanaryLive, verifyRegistryCanary } from '../broker/src/v4/skill-forge/registry-canary.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--fork-readonly') throw Error('Requires --fork-readonly; writes only to a disposable fork');
const reservation = createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r));
const port = reservation.address().port; await new Promise(r => reservation.close(r));
const anvil = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(port), '--chain-id', '4663',
  '--fork-url', 'https://robinhood-rpc.publicnode.com'], { stdio: ['ignore', 'ignore', 'ignore'] });
let startupError; anvil.on('error', e => { startupError = e; });
try {
  const transport = http(`http://127.0.0.1:${port}`, { timeout: 12000, retryCount: 0 });
  const client = createPublicClient({ transport, cacheTime: 0 });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError || anvil.exitCode !== null) throw Error('DISPOSABLE_FORK_START_FAILED');
    try { ready = await client.getChainId() === 4663; } catch { }
    if (ready) break; await new Promise(r => setTimeout(r, 250));
  }
  if (!ready || !/anvil/i.test(await client.request({ method: 'web3_clientVersion' }))) throw Error('OWNED_ANVIL_REQUIRED');
  const [guardian, outsider] = await client.request({ method: 'eth_accounts' });
  const wallet = createWalletClient({ transport, account: guardian });
  const inputs = await loadRegistryCanaryInputs();
  const { proposal } = await prepareRegistryCanaryLive({ client, inputs, guardian });
  const hashes = [];
  for (const step of proposal.transactions) {
    // Never accept a transaction path from the network or the production packet.
    assert.equal(step.from.toLowerCase(), guardian.toLowerCase()); assert.equal(step.chainId, 4663); assert.equal(step.value, '0');
    const tx = await wallet.sendTransaction({ account: guardian, chain: null, ...(step.to ? { to: step.to } : {}),
      data: step.data, value: 0n, nonce: Number(step.nonce), gas: 2_000_000n });
    assert.equal((await client.waitForTransactionReceipt({ hash: tx })).status, 'success'); hashes.push(tx);
  }
  await assert.rejects(verifyRegistryCanary({ client, inputs, proposal, transactionHashes: hashes }), /UNVERIFIED_CANARY_TRANSACTION/);
  await client.request({ method: 'anvil_mine', params: ['0xc'] });
  const report = await verifyRegistryCanary({ client, inputs, proposal, transactionHashes: hashes });
  assert.equal(report.readySkills, 0); assert.equal(report.productionBurnAuthorized, false);
  await assert.rejects(client.simulateContract({ address: proposal.registryPredicted, abi: inputs.artifact.abi,
    functionName: 'setEmergencyControls', args: [false, 0n], account: outsider }));
  // Receipt corruption must never be adopted as a successful canary, even when
  // the actual contract is correct and the transaction hash exists.
  const corruptions = ['value', 'nonce', 'chain', 'target', 'calldata', 'type', 'authorization', 'receipt', 'code', 'guardianCode', 'governance', 'definition'];
  for (const name of corruptions) {
    const altered = { ...client,
      getTransaction: async args => { const tx = await client.getTransaction(args);
        if (name === 'value') return { ...tx, value: 1n };
        if (name === 'nonce') return { ...tx, nonce: tx.nonce + 1 };
        if (name === 'chain') return { ...tx, chainId: 1 };
        if (name === 'target') return { ...tx, to: guardian };
        if (name === 'calldata') return { ...tx, input: '0x1234' };
        if (name === 'type') return { ...tx, type: 'eip7702' };
        if (name === 'authorization') return { ...tx, authorizationList: [{ address: guardian }] };
        return tx; },
      getTransactionReceipt: async args => { const r = await client.getTransactionReceipt(args); return name === 'receipt' ? { ...r, status: 'reverted' } : r; },
      getCode: args => name === 'code' || name === 'guardianCode' && args.address.toLowerCase() === guardian.toLowerCase()
        ? Promise.resolve('0x6000') : client.getCode(args),
      readContract: async args => {
        if (name === 'governance' && args.functionName === 'globallyDisabled') return false;
        const value = await client.readContract(args);
        if (name === 'definition' && args.functionName === 'definition') return { ...value, status: 4 };
        return value;
      } };
    await assert.rejects(verifyRegistryCanary({ client: altered, inputs, proposal, transactionHashes: hashes }));
  }
  console.log(JSON.stringify({ result: 'PASS', environment: 'DISPOSABLE_ANVIL_FORK_NOT_PUBLIC_CHAIN',
    forkBlock: proposal.anchor.number, registryRuntimeHash: inputs.pins.runtimeCodeHash, proposalHash: proposal.proposalHash,
    localTransactions: 8, confirmedReceiptDepth: proposal.requiredConfirmations, exactPackageHashes: true,
    emergencyDisabled: true, unauthorizedGuardianRejected: true, corruptionCasesRejected: corruptions.length,
    readySkills: 0, realCreditsCreated: 0, productionTransactions: 0, realPunksBurned: 0,
    observedLocalExecutionFeesWei: report.observedExecutionFeesWei }, null, 2));
} finally { if (anvil.exitCode === null) anvil.kill('SIGTERM'); }
