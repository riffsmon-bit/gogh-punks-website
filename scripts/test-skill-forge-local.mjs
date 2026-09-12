// Self-contained local-chain integration. Never accepts a remote RPC or loads keys.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, http, keccak256 } from 'viem';
import { createProgressionReader, createSkillToolGate, manifestHash, instructionHash } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { allocationLeaf, buildAllocationTree } from '../broker/src/v4/skill-forge/rarity-allocation.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw new Error('Requires --local-only');
const artifact = async (file, name) => JSON.parse(await readFile(new URL(`../contracts/out/${file}/${name}.json`, import.meta.url), 'utf8'));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const node = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337'], { stdio: 'ignore' });
let startupError;
node.on('error', error => { startupError = error; });
const transport = http(`http://127.0.0.1:${port}`, { timeout: 1000, retryCount: 0 });
const client = createPublicClient({ transport });
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (startupError) throw startupError;
    if (node.exitCode !== null) throw new Error('LOCAL_NODE_EXITED');
    try { ready = await client.getChainId() === 31337; } catch { }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('LOCAL_NODE_UNAVAILABLE');
  const accounts = await client.request({ method: 'eth_accounts' });
  const wallet = createWalletClient({ transport, account: accounts[0] });
  const alice = accounts[0], bob = accounts[1];
  const deploy = async (a, args) => {
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, chain: null });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success'); assert.ok(receipt.contractAddress);
    return receipt.contractAddress;
  };
  const write = async (a, address, functionName, args, account = alice) => {
    const hash = await wallet.writeContract({ address, abi: a.abi, functionName, args, account, chain: null });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    return receipt;
  };
  const nftArtifact = await artifact('GoghSkillForge.t.sol', 'SkillForgeMockPunks');
  const sourceArtifact = await artifact('GoghSkillForge.t.sol', 'LocalSkillTrainingSource');
  const registryArtifact = await artifact('GoghSkillRegistry.sol', 'GoghSkillRegistry');
  const progressionArtifact = await artifact('GoghRaritySkillProgression.sol', 'GoghRaritySkillProgression');
  const collection = await deploy(nftArtifact, []);
  const registry = await deploy(registryArtifact, [alice]);
  const source = await deploy(sourceArtifact, [collection]);
  const snapshotHash = keccak256('0x1234');
  const allocation = { chainId: 31337, collection, snapshotHash, records: [{ tokenId: '93', startingSlots: 3 }, { tokenId: '812', startingSlots: 1 }] };
  const tree = buildAllocationTree(allocation);
  const progression = await deploy(progressionArtifact, [collection, registry, source, tree.root, snapshotHash]);
  await write(sourceArtifact, source, 'bind', [progression]);
  await write(nftArtifact, collection, 'mint', [alice, 93n]);
  await write(nftArtifact, collection, 'mint', [alice, 812n]);
  assert.equal(await client.readContract({ address: progression, abi: progressionArtifact.abi, functionName: 'allocationLeaf', args: [93n, 3] }), allocationLeaf({ ...allocation, tokenId: '93', startingSlots: 3 }));
  await write(progressionArtifact, progression, 'claimRaritySlots', [93n, 3, tree.proof('93')]);
  assert.equal(await client.readContract({ address: progression, abi: progressionArtifact.abi, functionName: 'unlockedSlots', args: [93n] }), 3);
  console.log('PASS JavaScript Merkle proof → Solidity claim; LOCAL fixture rarity only, no production allocation');
  const pack = { manifest: { skillId: 3, version: 1, chainId: 31337, capabilities: ['CONTRACT_READ'],
    description: 'LOCAL INTEGRATION FIXTURE — NOT A PRODUCTION SKILL' },
    instructions: 'Call only the approved read-only contract tool.', approved: true, status: 'READY' };
  await write(registryArtifact, registry, 'register', [3, 1, manifestHash(pack.manifest), instructionHash(pack.instructions), `0x${'0'.repeat(64)}`, 1n, 0]);
  const key = await client.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'skillKey', args: [3, 1] });
  await write(registryArtifact, registry, 'setStatus', [key, 3, `0x${'0'.repeat(64)}`]);
  await write(registryArtifact, registry, 'setStatus', [key, 4, keccak256('0x1234')]);
  const readState = createProgressionReader({ client, chainId: 31337, collection, registry, progression,
    registryCodeHash: keccak256(await client.getCode({ address: registry })),
    progressionCodeHash: keccak256(await client.getCode({ address: progression })) });
  let calls = 0;
  const gate = createSkillToolGate({ readState, packages: [pack], implementations: {
    inspect_contract: (_args, context) => { calls++; return { tokenId: context.tokenId, walletAuthority: context.walletAuthority }; },
  } });
  const call = (owner = alice) => gate.call({ tokenId: '93', owner, name: 'inspect_contract' });
  await assert.rejects(call(), /SKILL_TOOL_DENIED/);
  await write(nftArtifact, collection, 'approve', [source, 812n]);
  await write(sourceArtifact, source, 'sacrifice', [812n, 93n]);
  await write(progressionArtifact, progression, 'learnSkill', [93n, key]);
  await assert.rejects(call(), /SKILL_TOOL_DENIED/);
  await write(progressionArtifact, progression, 'equipSkill', [93n, 0, key]);
  assert.deepEqual(await call(), { tokenId: '93', walletAuthority: 'NONE' });
  console.log('PASS mock sacrifice → credit → learn → equip → hash-pinned tool eligibility');
  await write(nftArtifact, collection, 'transferFrom', [alice, bob, 93n]);
  await assert.rejects(call(), /OWNER_CHANGED/);
  assert.equal((await call(bob)).tokenId, '93');
  console.log('PASS transfer retains progression; old owner denied, new owner resolves same loadout');
  await write(registryArtifact, registry, 'setDisabled', [key, true]);
  await assert.rejects(call(bob), /SKILL_TOOL_DENIED/);
  console.log('PASS global skill disable denies calls without deleting loadout');
  assert.equal(calls, 2);
  console.log('PASS local integration complete — zero production transactions or registered production skills');
} finally {
  if (node.exitCode === null) node.kill('SIGTERM');
}
