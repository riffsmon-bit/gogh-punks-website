// New contract and unsigned review pipeline on a fresh loopback Anvil only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, http, keccak256, zeroAddress } from 'viem';
import { createReviewedBurnPreparation } from '../broker/src/v4/skill-forge/reviewed-burn.mjs';
import { encodeBurnReviewCancellation } from '../site/forge-burn-calldata.js';

if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw Error('Requires --local-only');
const artifact = async (file, name) => JSON.parse(await readFile(new URL(`../contracts/out/${file}/${name}.json`, import.meta.url), 'utf8'));
const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const child = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337'], { stdio: 'ignore' });
let startupError; child.on('error', error => { startupError = error; });
const transport = http(`http://127.0.0.1:${port}`, { timeout: 1000, retryCount: 0 });
const client = createPublicClient({ transport, cacheTime: 0 });
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw Error('DISPOSABLE_CHAIN_EXITED');
    try { ready = await client.getChainId() === 31337; } catch { }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready || !/anvil/i.test(await client.request({ method: 'web3_clientVersion' }))) throw Error('DISPOSABLE_ANVIL_REQUIRED');
  const [owner, buyer] = await client.request({ method: 'eth_accounts' });
  const wallet = createWalletClient({ transport, account: owner });
  const receipt = async hash => { const result = await client.waitForTransactionReceipt({ hash }); assert.equal(result.status, 'success'); return result; };
  const deploy = async (a, args) => (await receipt(await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, chain: null }))).contractAddress;
  const write = async (a, address, functionName, args, account = owner) => receipt(await wallet.writeContract({ abi: a.abi, address, functionName, args, account, chain: null }));
  const nft = await artifact('LocalReviewedBurn.sol', 'LocalBurnPunks');
  const sourceArtifact = await artifact('GoghReviewedBurnSource.sol', 'GoghReviewedBurnSource');
  const reg = await artifact('GoghSkillRegistry.sol', 'GoghSkillRegistry');
  const prog = await artifact('GoghReviewedSkillProgression.sol', 'GoghReviewedSkillProgression');
  const collection = await deploy(nft, []), burnSource = await deploy(sourceArtifact, [collection]), registry = await deploy(reg, [owner]);
  const progression = await deploy(prog, [collection, registry, burnSource, keccak256('0x1234'), keccak256('0x5678')]);
  await write(sourceArtifact, burnSource, 'bindProgression', [progression]);
  for (let first = 1; first < 1121; first += 100) await write(nft, collection, 'mintReserve', [owner, BigInt(first), BigInt(Math.min(100, 1121 - first))]);
  const deployment = { chainId: 31337, collection, burnSource, registry, progression, feeCeilingWei: '1000000000000000' };
  for (const role of ['collection', 'burnSource', 'registry', 'progression']) deployment[`${role}CodeHash`] = keccak256(await client.getCode({ address: deployment[role] }));
  let receiptMode = 'valid';
  const reviewedClient = { ...client, getTransactionReceipt: async args => {
    if (receiptMode === 'missing') throw Error('FIXTURE_RECEIPT_DELAY');
    const result = await client.getTransactionReceipt(args);
    if (receiptMode === 'wrong-event') return { ...result, logs: result.logs.filter(log => log.address.toLowerCase() !== burnSource.toLowerCase()) };
    if (receiptMode === 'wrong-block') return { ...result, blockHash: keccak256('0xdead') };
    return result;
  } };
  const preparation = createReviewedBurnPreparation({ client: reviewedClient, deployment });
  const pair = { owner, sourceTokenId: '7', targetTokenId: '44' };
  const prepare = action => preparation.prepare({ ...pair, action });
  const send = async review => {
    await preparation.recheck(review);
    // Only this disposable test owns a sender. The production preparation library has none.
    const hash = await client.request({ method: 'eth_sendTransaction', params: [{ ...review.transaction }] });
    await receipt(hash); return hash;
  };
  await assert.rejects(prepare('BURN'), /TOKEN_SPECIFIC_APPROVAL_REQUIRED/);
  const before = await client.getTransactionCount({ address: owner });
  const approval = await prepare('APPROVE');
  assert.equal(await client.getTransactionCount({ address: owner }), before, 'preparation is read-only');
  assert.equal(approval.productionAuthority, false); assert.equal(approval.walletInventoryReviewed, false);
  assert.match(approval.approvalWarning, /no on-chain expiry/);
  const approvedHash = await send(approval);
  assert.equal((await preparation.verifyReceipt(approval, approvedHash)).creditGain, 0);
  assert.equal(await client.readContract({ address: progression, abi: prog.abi, functionName: 'trainingCredits', args: [44n] }), 0n);
  let burn = await prepare('BURN');
  await assert.rejects(preparation.recheck({ ...burn, transaction: { ...burn.transaction, value: '0x1' } }), /BURN_REVIEW_TAMPERED/);

  // Original collection compatibility: the source does not require an ownershipEpoch method.
  // A recipient round trip leaves contract state identical, so the RPC Transfer guard is essential.
  await write(nft, collection, 'transferFrom', [owner, buyer, 44n]);
  await write(nft, collection, 'transferFrom', [buyer, owner, 44n], buyer);
  await assert.rejects(preparation.recheck(burn), /PUNK_TRANSFERRED_SINCE_REVIEW/);
  burn = await prepare('BURN');
  await write(nft, collection, 'transferFrom', [owner, buyer, 7n]);
  await write(nft, collection, 'transferFrom', [buyer, owner, 7n], buyer);
  await write(nft, collection, 'approve', [burnSource, 7n]);
  await assert.rejects(preparation.recheck(burn), /PUNK_TRANSFERRED_SINCE_REVIEW/);

  burn = await prepare('BURN');
  await write(nft, collection, 'setApprovalForAll', [burnSource, true]);
  await assert.rejects(preparation.recheck(burn), /REVOKE_OPERATOR_WIDE_APPROVAL_FIRST/);
  await write(nft, collection, 'setApprovalForAll', [burnSource, false]);
  burn = await prepare('BURN');
  await receipt(await wallet.sendTransaction({ to: burnSource, data: encodeBurnReviewCancellation('7'), value: 0n, chain: null }));
  await assert.rejects(preparation.recheck(burn), /BURN_REVIEW_STATE_CHANGED/);

  burn = await prepare('BURN');
  await write(reg, registry, 'setEmergencyControls', [true, 0n]);
  await assert.rejects(preparation.recheck(burn), /TRAINING_PAUSED/);
  await write(reg, registry, 'setEmergencyControls', [false, 0n]);
  burn = await prepare('BURN');
  const burnedHash = await send(burn);
  receiptMode = 'missing'; assert.equal((await preparation.verifyReceipt(burn, burnedHash)).status, 'PENDING');
  receiptMode = 'wrong-block'; await assert.rejects(preparation.verifyReceipt(burn, burnedHash), /BURN_RECEIPT_MISMATCH/);
  receiptMode = 'wrong-event'; await assert.rejects(preparation.verifyReceipt(burn, burnedHash), /BURN_CREDIT_EVENT_MISMATCH/);
  receiptMode = 'valid'; const verified = await preparation.verifyReceipt(burn, burnedHash); assert.equal(verified.creditGain, 1);
  assert.equal(await client.readContract({ address: progression, abi: prog.abi, functionName: 'trainingCredits', args: [44n] }), 1n);
  await assert.rejects(client.readContract({ address: collection, abi: nft.abi, functionName: 'ownerOf', args: [7n] }));
  assert.notEqual(await client.readContract({ address: collection, abi: nft.abi, functionName: 'ownerOf', args: [44n] }), zeroAddress);
  const evidence = { status: 'PASS', environment: 'NEW_DISPOSABLE_ANVIL', productionTransactions: 0,
    sourceTokenId: '7', targetTokenId: '44', contract: 'GoghReviewedBurnSource', approvalTransaction: approvedHash,
    burnTransaction: burnedHash, tokenSpecificApproval: true, approvalDoesNotCredit: true, exactBrowserEncoding: true,
    sourceAndTargetRoundTripRejected: true, operatorApprovalRejected: true, cancellationInvalidates: true,
    globalPauseChecked: true, alteredReceiptRejected: true, missingReceiptPending: true, exactCreditEvents: true,
    previousPracticeReset: false, productionAuthority: false, walletInventoryReviewed: false };
  const folder = new URL('../docs/review/2026-09-12/reviewed-burn/', import.meta.url);
  await mkdir(folder, { recursive: true }); await writeFile(new URL('local-chain.json', folder), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { if (child.exitCode === null && !child.killed) child.kill('SIGTERM'); }
