// Disposable Anvil only. Chain ID/address match is a fixture, NOT a public deployment.
// No wrapper, external RPC, credentials, environment signer or real wallet is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, http, keccak256 } from 'viem';
import deployment from '../deployments/robinhood-skill-forge.json' with { type: 'json' };
import { createOriginalForgeProfileReader } from '../broker/src/v4/skill-forge/original-punk-profile.mjs';
import { manifestHash, instructionHash, skillKey } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { buildAllocationTree } from '../broker/src/v4/skill-forge/rarity-allocation.mjs';
import { validateForgeProfile, forgeSlotView } from '../site/forge-profile-view.js';
if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw Error('Requires --local-only');
const artifact = async (file, name) => JSON.parse(await readFile(new URL(`../contracts/out/${file}/${name}.json`, import.meta.url), 'utf8'));
const reservation = createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r));
const port = reservation.address().port; await new Promise(r => reservation.close(r));
const node = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(port), '--chain-id', '4663'], { stdio: 'ignore' });
let startupError; node.on('error', e => { startupError = e; });
const transport = http(`http://127.0.0.1:${port}`, { timeout: 1000, retryCount: 0 });
const client = createPublicClient({ transport, cacheTime: 0 });
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (startupError) throw startupError;
    if (node.exitCode !== null) throw Error('LOCAL_NODE_EXITED');
    try { ready = await client.getChainId() === 4663; } catch { }
    if (ready) break;
    await new Promise(r => setTimeout(r, 250));
  }
  if (!ready || !(await client.request({ method: 'web3_clientVersion' })).toLowerCase().includes('anvil')) throw Error('DISPOSABLE_ANVIL_REQUIRED');
  const [alice, bob] = await client.request({ method: 'eth_accounts' });
  const wallet = createWalletClient({ transport, account: alice });
  const receipt = async hash => { const r = await client.waitForTransactionReceipt({ hash }); assert.equal(r.status, 'success'); return r; };
  const deploy = async (a, args = []) => (await receipt(await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, chain: null }))).contractAddress;
  const write = async (a, address, functionName, args, account = alice) => receipt(await wallet.writeContract({ abi: a.abi, address, functionName, args, account, chain: null }));
  const nft = await artifact('GoghEpochAccount.t.sol', 'EpochFixturePunks');
  const credit = await artifact('GoghEpochAccount.t.sol', 'EpochFixtureCredits');
  const reg = await artifact('GoghSkillRegistry.sol', 'GoghSkillRegistry');
  const prog = await artifact('GoghRaritySkillProgression.sol', 'GoghRaritySkillProgression');
  // Same disposable fixture classes used in original-NFT inheritance tests, not epoch contracts.
  const collection = deployment.collection;
  await client.request({ method: 'anvil_setCode', params: [collection, nft.deployedBytecode.object] });
  const registry = await deploy(reg, [alice]), source = await deploy(credit);
  const snapshotHash = keccak256('0x1234');
  const allocation = buildAllocationTree({ chainId: 4663, collection, snapshotHash, records: [{ tokenId: '93', startingSlots: 2 }] });
  const progression = await deploy(prog, [collection, registry, source, allocation.root, snapshotHash]);
  for (const id of [93n, 812n, 813n]) await write(nft, collection, 'mint', [alice, id]);
  for (const id of [812n, 813n]) {
    await write(nft, collection, 'approve', [source, id]);
    await write(credit, source, 'award', [progression, id, 93n]);
  }
  const pack = { slug: 'contract-detective', manifest: { name: 'Contract Detective', skillId: 3, version: 1,
    chainId: 4663, capabilities: ['CONTRACT_READ'], fixtureOnly: true }, instructions: 'Disposable test only.', approved: false, status: 'TESTING' };
  const key = skillKey(3, 1);
  await write(reg, registry, 'register', [3, 1, manifestHash(pack.manifest), instructionHash(pack.instructions), `0x${'0'.repeat(64)}`, 1n, 0]);
  await write(reg, registry, 'setStatus', [key, 3, `0x${'0'.repeat(64)}`]);
  await write(reg, registry, 'setStatus', [key, 4, keccak256('0x1234')]);
  await write(prog, progression, 'claimRaritySlots', [93n, 2, allocation.proof('93')]);
  const pins = { ...deployment, status: 'READ_ONLY_CANARY', registry, progression, trainingSource: source,
    snapshotHash, allocationRoot: allocation.root,
    collectionCodeHash: keccak256(await client.getCode({ address: collection })),
    registryCodeHash: keccak256(await client.getCode({ address: registry })),
    progressionCodeHash: keccak256(await client.getCode({ address: progression })),
    trainingSourceCodeHash: keccak256(await client.getCode({ address: source })) };
  const read = createOriginalForgeProfileReader({ client, deployment: pins, packages: [pack] });
  let profile = await read({ tokenId: '93', owner: alice });
  assert.equal(profile.trainingCredits, '2'); assert.equal(profile.learnedSkills.length, 0);
  await write(prog, progression, 'learnSkill', [93n, key]);
  profile = await read({ tokenId: '93', owner: alice });
  assert.equal(profile.learnedSkills.length, 1); assert.equal(profile.equippedSkills.length, 0);
  await write(prog, progression, 'equipSkill', [93n, 0, key]);
  const before = validateForgeProfile(await read({ tokenId: '93', owner: alice }), { tokenId: '93', owner: alice });
  assert.equal(forgeSlotView(before)[0].title, 'Contract Detective');
  await write(nft, collection, 'safeTransferFrom', [alice, bob, 93n]);
  await assert.rejects(read({ tokenId: '93', owner: alice }), /OWNER_CHANGED/);
  const after = validateForgeProfile(await read({ tokenId: '93', owner: bob }), { tokenId: '93', owner: bob });
  for (const name of ['trainingCredits', 'learnedSkills', 'unlockedSlots', 'equippedSkills']) assert.deepEqual(before[name], after[name]);
  // Buyer has not made a setup, claim or equip transaction to inherit the loadout.
  await write(reg, registry, 'setDisabled', [key, true]);
  profile = await read({ tokenId: '93', owner: bob });
  assert.equal(profile.learnedSkills.length, 1); assert.match(forgeSlotView(profile)[0].detail, /DISABLED/);
  assert.deepEqual(profile.effectiveMcpTools, []);
  console.log(JSON.stringify({ result: 'PASS', environment: 'DISPOSABLE_ANVIL_NOT_ROBINHOOD',
    contractBackedProfile: true, learnedNotEquipped: true, originalTransferRetainsLoadout: true,
    sellerDenied: true, buyerSetupTransactions: 0, disablePreservesHistory: true,
    publicTransactions: 0, productionReadyRegistrations: 0 }, null, 2));
} finally { if (node.exitCode === null) node.kill('SIGTERM'); }
