// New reviewed progression + independent browser calldata, on a PRIVATE disposable
// Anvil only. No RPC override, wallet credentials, production contracts or MetaMask.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, http, keccak256 } from 'viem';
import { encodeReviewedTrainingCall, encodeTrainingReviewCancellation } from '../site/forge-reviewed-calldata.js';
import { buildAllocationTree } from '../broker/src/v4/skill-forge/rarity-allocation.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw Error('Requires --local-only');
const artifact = async (file, name) => JSON.parse(await readFile(new URL(`../contracts/out/${file}/${name}.json`, import.meta.url), 'utf8'));
const reservation = createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r));
const port = reservation.address().port; await new Promise(r => reservation.close(r));
const node = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337'], { stdio: 'ignore' });
let startupError; node.on('error', e => { startupError = e; });
const transport = http(`http://127.0.0.1:${port}`, { timeout: 1000, retryCount: 0 });
const client = createPublicClient({ transport, cacheTime: 0 });
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (startupError) throw startupError;
    if (node.exitCode !== null) throw Error('LOCAL_NODE_EXITED');
    try { ready = await client.getChainId() === 31337; } catch { }
    if (ready) break;
    await new Promise(r => setTimeout(r, 250));
  }
  if (!ready || !(await client.request({ method: 'web3_clientVersion' })).toLowerCase().includes('anvil')) throw Error('DISPOSABLE_ANVIL_REQUIRED');
  const [alice, bob] = await client.request({ method: 'eth_accounts' });
  const wallet = createWalletClient({ transport, account: alice });
  const receipt = async (hash, status = 'success') => { const r = await client.waitForTransactionReceipt({ hash }); assert.equal(r.status, status); return r; };
  const deploy = async (a, args = []) => (await receipt(await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, chain: null }))).contractAddress;
  const write = async (a, address, functionName, args, account = alice) => receipt(await wallet.writeContract({ abi: a.abi, address, functionName, args, account, chain: null }));
  const nft = await artifact('GoghSkillForge.t.sol', 'SkillForgeMockPunks');
  const training = await artifact('GoghSkillForge.t.sol', 'LocalSkillTrainingSource');
  const reg = await artifact('GoghSkillRegistry.sol', 'GoghSkillRegistry');
  const prog = await artifact('GoghReviewedSkillProgression.sol', 'GoghReviewedSkillProgression');
  const collection = await deploy(nft), registry = await deploy(reg, [alice]), source = await deploy(training, [collection]);
  const snapshot = keccak256('0x1234');
  const tree = buildAllocationTree({ chainId: 31337, collection, snapshotHash: snapshot, records: [{ tokenId: '44', startingSlots: 1 }] });
  const progression = await deploy(prog, [collection, registry, source, tree.root, snapshot]);
  await write(training, source, 'bind', [progression]);
  for (const id of [44n, 1001n]) await write(nft, collection, 'mint', [alice, id]);
  await write(nft, collection, 'approve', [source, 1001n]);
  await write(training, source, 'sacrifice', [1001n, 44n]);
  const zero = `0x${'0'.repeat(64)}`, hash = keccak256('0x1234');
  await write(reg, registry, 'register', [3, 1, hash, hash, zero, 1n, 0]);
  const key = await client.readContract({ address: registry, abi: reg.abi, functionName: 'skillKey', args: [3, 1] });
  await write(reg, registry, 'setStatus', [key, 3, zero]);
  await write(reg, registry, 'setStatus', [key, 4, hash]);
  const read = (functionName, args = [44n]) => client.readContract({ address: progression, abi: prog.abi, functionName, args });
  const review = async operation => ({ tokenId: '44', operation, skillKey: ['learn', 'equip'].includes(operation) ? key : zero,
    slot: 0, nonce: String(await read('trainingReviewNonce')), stateHash: await read('trainingReviewStateHash'),
    deadline: String((await client.getBlock()).timestamp + 60n) });
  const send = async (data, account = alice, expected = 'success') => receipt(await wallet.sendTransaction({
    account, to: progression, data, value: 0n, gas: 500_000n, chain: null }), expected);
  const expired = encodeReviewedTrainingCall(await review('learn'));
  await client.request({ method: 'evm_increaseTime', params: [61] });
  await client.request({ method: 'evm_mine', params: [] });
  await send(expired, alice, 'reverted');
  assert.equal(await read('trainingReviewNonce'), 0n); assert.equal(await read('trainingCredits'), 1n);
  const learned = encodeReviewedTrainingCall(await review('learn'));
  await client.call({ account: alice, to: progression, data: learned });
  await send(learned); await send(learned, alice, 'reverted');
  assert.equal(await read('learnedCount'), 1n); assert.equal(await read('trainingCredits'), 0n);
  assert.equal(await read('effectiveCapabilities'), 0n);
  const canceled = encodeReviewedTrainingCall(await review('equip'));
  await send(encodeTrainingReviewCancellation('44')); await send(canceled, alice, 'reverted');
  assert.equal(await read('equipped', [44n, 0]), zero);
  await send(encodeReviewedTrainingCall(await review('equip')));
  assert.equal(await read('effectiveCapabilities'), 1n);
  const seller = encodeReviewedTrainingCall(await review('unequip'));
  await write(nft, collection, 'safeTransferFrom', [alice, bob, 44n]);
  // No claim, equip, setup or training call from the buyer to inherit the skill.
  assert.equal(await read('equipped', [44n, 0]), key); assert.equal(await read('learnedLevel', [44n, key]), 1);
  await send(seller, alice, 'reverted');
  await send(encodeReviewedTrainingCall(await review('unequip')), bob);
  assert.equal(await read('equipped', [44n, 0]), zero); assert.equal(await read('learnedCount'), 1n);
  const logs = await client.getContractEvents({ address: progression, abi: prog.abi, eventName: 'SkillLearned', fromBlock: 0n });
  assert.equal(logs.length, 1);
  console.log(JSON.stringify({ result: 'PASS', chain: 'PRIVATE_DISPOSABLE_31337', browserEncodingOnChain: true,
    expiredTransactionReverted: true, replayReverted: true, cancellationRevertedStaleReview: true,
    confirmedLearningEvents: logs.length, learnedNotEquipped: true, sellerDenied: true,
    buyerInheritedBeforeAnySetup: true, buyerCanChangeLoadout: true, productionTransactions: 0 }, null, 2));
} finally { if (node.exitCode === null) node.kill('SIGTERM'); }
