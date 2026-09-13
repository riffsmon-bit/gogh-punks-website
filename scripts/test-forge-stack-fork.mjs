// Rehearsal against COPIES of original NFTs in an owned, private Anvil fork.
// Public clients only read. All impersonation and writes use the new loopback URL.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi } from 'viem';
import { loadForgeDeploymentBuild, buildForgeDeploymentPlan, inspectForgeStack, validateForgeDeploymentPlan } from '../broker/src/v4/skill-forge/forge-deployment.mjs';
import { validateBurnTestSelection } from '../broker/src/v4/skill-forge/live-burn-pair.mjs';
import { createReviewedBurnPreparation } from '../broker/src/v4/skill-forge/reviewed-burn.mjs';
import { encodeReviewedTrainingCall } from '../site/forge-reviewed-calldata.js';
import { createOriginalForgeProfileReader } from '../broker/src/v4/skill-forge/original-punk-profile.mjs';
import { loadRegistryCanaryInputs } from '../broker/src/v4/skill-forge/registry-canary.mjs';
import { createProgressionReader } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { loadResearchSkillCatalog, createResearchSkillRuntime } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import manifest from '../deployments/robinhood-skill-forge.json' with { type: 'json' };

if (process.argv.length !== 3 || !['--fork-readonly','--fork-deployed-selection','--fork-rarity-eye-selection'].includes(process.argv[2])) throw Error('Requires --fork-readonly or --fork-deployed-selection; all transactions use an owned disposable fork');
const rarityEye = process.argv[2] === '--fork-rarity-eye-selection';
const existing = rarityEye || process.argv[2] === '--fork-deployed-selection';
const pair = existing ? validateBurnTestSelection(JSON.parse(await readFile(new URL('../ops/forge-burn-test-selection.json', import.meta.url), 'utf8'))) : null;
const sourceTokenId=pair?.sourceTokenId??'93', targetTokenId=pair?.targetTokenId??'94';
const rpc = existing ? 'https://rpc.mainnet.chain.robinhood.com' : 'https://robinhood-rpc.publicnode.com';
const publicClient = createPublicClient({ transport: http(rpc, { timeout: 15000, retryCount: 0 }), cacheTime: 0 });
assert.equal(await publicClient.getChainId(), 4663);
const publicHead = await publicClient.getBlock();
const selection = JSON.parse(await readFile(new URL('../ops/forge-registry-admin-selection.json', import.meta.url), 'utf8'));
const owner = selection.administrator;
if(pair)assert.equal(pair.owner.toLowerCase(),owner.toLowerCase());
const nftAbi = parseAbi(['function ownerOf(uint256) view returns(address)', 'function totalSupply() view returns(uint256)']);
const publicRead = (functionName, args = []) => publicClient.readContract({ address: manifest.collection, abi: nftAbi, functionName, args, blockNumber: publicHead.number });
for (const id of [sourceTokenId, targetTokenId]) assert.equal((await publicRead('ownerOf', [BigInt(id)])).toLowerCase(), owner.toLowerCase());
const publicSupply = await publicRead('totalSupply');
const reservation = createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r));
const port = reservation.address().port; await new Promise(r => reservation.close(r));
const child = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(port), '--chain-id', '4663',
  '--fork-url', rpc, '--fork-block-number', String(publicHead.number)], { stdio: 'ignore' });
let startupError; child.on('error', error => { startupError = error; });
try {
  const transport = http(`http://127.0.0.1:${port}`, { timeout: 20000, retryCount: 0 });
  const client = createPublicClient({ transport, cacheTime: 0 });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError || child.exitCode !== null) throw Error('OWNED_FORK_START_FAILED');
    try { ready = await client.getChainId() === 4663; } catch { }
    if (ready) break; await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(ready && /anvil/i.test(await client.request({ method: 'web3_clientVersion' })));
  assert.equal((await client.getBlock({ blockNumber: publicHead.number })).hash, publicHead.hash);
  assert.equal(keccak256(await client.getCode({ address: manifest.collection })), manifest.collectionCodeHash);
  await client.request({ method: 'anvil_impersonateAccount', params: [owner] });
  const wallet = createWalletClient({ transport, account: owner });
  const receipt = async hash => { const r = await client.waitForTransactionReceipt({ hash }); assert.equal(r.status, 'success'); return r; };
  const freshClock = async () => {
    const head = await client.getBlock(), now = BigInt(Math.floor(Date.now() / 1000));
    if (head.timestamp < now) { await client.request({ method: 'evm_setNextBlockTimestamp', params: [Number(now)] }); await client.request({ method: 'evm_mine' }); }
  };
  await freshClock();
  const build = await loadForgeDeploymentBuild(), anchor = await client.getBlock();
  const accepted = existing ? JSON.parse(await readFile(new URL('../docs/review/2026-09-12/live-owner/accepted-setup-progress.json', import.meta.url), 'utf8')) : null;
  const plan = existing ? validateForgeDeploymentPlan(accepted.packet.plan,build) : buildForgeDeploymentPlan({ build, administrator: owner, nonce: String(await client.getTransactionCount({ address: owner })),
    anchor: { number: String(anchor.number), hash: anchor.hash, timestamp: Number(anchor.timestamp) } });
  const deploymentHashes = [];
  if(existing)assert.ok(accepted.steps.every(step=>step.status==='INCLUDED'&&step.transactionHash));
  for (const [i, tx] of (existing?[]:plan.transactions).entries()) {
    const hash = await wallet.sendTransaction({ account: owner, chain: null, ...(tx.to ? { to: tx.to } : {}),
      data: tx.data, value: 0n, nonce: Number(tx.nonce), type: 'eip1559', gas: BigInt(plan.gasLimits[i]),
      maxFeePerGas: BigInt(plan.maxFeePerGas), maxPriorityFeePerGas: 0n });
    await receipt(hash); deploymentHashes.push(hash);
  }
  const codeHashes = await inspectForgeStack({ client, plan, build, blockNumber: (await client.getBlock()).number });
  const { registry, progression, trainingSource } = plan.addresses;
  const write = (role, functionName, args) => wallet.writeContract({ address: plan.addresses[role], abi: build.artifacts[role].abi, functionName, args, chain: null }).then(receipt);
  const deployment = { chainId: 4663, collection: manifest.collection, collectionCodeHash: manifest.collectionCodeHash,
    registry, registryCodeHash: codeHashes.registryCodeHash, progression, progressionCodeHash: codeHashes.progressionCodeHash,
    burnSource: trainingSource, burnSourceCodeHash: codeHashes.trainingSourceCodeHash, feeCeilingWei: '1000000000000000' };
  const reviewed = createReviewedBurnPreparation({ client, deployment });
  const prepare = async action => { await freshClock(); return reviewed.prepare({ owner, sourceTokenId, targetTokenId, action }); };
  await assert.rejects(prepare('APPROVE'), /TRAINING_PAUSED/);
  await write('registry', 'setEmergencyControls', [false, 0n]);
  const send = async review => {
    await reviewed.recheck(review);
    const hash = await client.request({ method: 'eth_sendTransaction', params: [review.transaction] });
    await receipt(hash); return { hash, verified: await reviewed.verifyReceipt(review, hash) };
  };
  const approved = await send(await prepare('APPROVE')); assert.equal(approved.verified.creditGain, 0);
  const burned = await send(await prepare('BURN')); assert.equal(burned.verified.creditGain, 1);
  const zero = `0x${'0'.repeat(64)}`, pack = keccak256('0x1234');
  const rarity = rarityEye ? (await loadRegistryCanaryInputs()).pins.definitions.find(d => d.slug === 'rarity-eye') : null;
  const capability = rarityEye ? 8n : 1n;
  await write('registry', 'register', [rarity?.skillId ?? 3, 1, rarity?.manifestHash ?? pack, rarity?.instructionHash ?? pack, zero, capability, 0]);
  const key = await client.readContract({ address: registry, abi: build.artifacts.registry.abi, functionName: 'skillKey', args: [rarity?.skillId ?? 3, 1] });
  await write('registry', 'setStatus', [key, 3, zero]);
  await write('registry', 'setStatus', [key, 4, pack]);
  const read = (functionName, args = [BigInt(targetTokenId)]) => client.readContract({ address: progression, abi: build.artifacts.progression.abi, functionName, args });
  const train = async operation => {
    await freshClock();
    const review = { tokenId: targetTokenId, operation, skillKey: ['learn', 'equip'].includes(operation) ? key : zero, slot: 0,
      nonce: String(await read('trainingReviewNonce')), stateHash: await read('trainingReviewStateHash'), deadline: String((await client.getBlock()).timestamp + 60n) };
    return receipt(await wallet.sendTransaction({ to: progression, data: encodeReviewedTrainingCall(review), value: 0n, chain: null }));
  };
  await train('learn'); assert.equal(await read('trainingCredits'), 0n); assert.equal(await read('effectiveCapabilities'), 0n);
  await train('equip'); assert.equal(await read('effectiveCapabilities'), capability);
  let rarityResult;
  if (rarityEye) {
    const packages = (await loadResearchSkillCatalog()).map(p => p.slug === 'rarity-eye' ? { ...p, status: 'READY', approved: true } : p);
    const readState = createProgressionReader({ client, chainId: 4663, collection: manifest.collection, registry, progression, registryCodeHash: codeHashes.registryCodeHash, progressionCodeHash: codeHashes.progressionCodeHash });
    const runtime = createResearchSkillRuntime({ client, readState, packages });
    const context = await runtime.resolve({ tokenId: targetTokenId, owner });
    assert.deepEqual(context.effectiveMcpTools, ['get_metadata', 'rank_trait_sample']);
    assert.equal(context.walletAuthority, 'NONE');
    rarityResult = await runtime.call({ tokenId: targetTokenId, owner, name: 'rank_trait_sample', arguments: { contract: manifest.collection, tokenIds: ['93','94','95'], numericMode: 'categorical' } });
    assert.equal(rarityResult.sampleSize, 3);
    await assert.rejects(runtime.call({ tokenId: targetTokenId, owner, name: 'prepare_mint' }), /SKILL_TOOL_DENIED/);
    await train('unequip');
    await assert.rejects(runtime.call({ tokenId: targetTokenId, owner, name: 'rank_trait_sample', arguments: { contract: manifest.collection, tokenIds: ['93','94','95'], numericMode: 'categorical' } }), /SKILL_TOOL_DENIED/);
    await train('equip');
  }
  // Exercise the actual production profile reader with fixture bindings held only
  // in this process. No fork address is written into a deployment manifest.
  const fixtureRead = { ...manifest, status: 'READ_ONLY_CANARY', registry, progression, trainingSource,
    registryCodeHash: codeHashes.registryCodeHash, progressionCodeHash: codeHashes.progressionCodeHash, trainingSourceCodeHash: codeHashes.trainingSourceCodeHash };
  await freshClock();
  const profile = await createOriginalForgeProfileReader({ client, deployment: fixtureRead })({ tokenId: targetTokenId, owner });
  assert.equal(profile.verified, true); assert.equal(profile.learnedSkills.length, 1);
  await train('unequip'); assert.equal(await read('effectiveCapabilities'), 0n); assert.equal(await read('learnedCount'), 1n);
  // Closing PUBLIC reads prove these fixture IDs still exist at their real owners.
  const closingOwners = await Promise.all([sourceTokenId, targetTokenId].map(id => publicClient.readContract({ address: manifest.collection, abi: nftAbi, functionName: 'ownerOf', args: [BigInt(id)] })));
  assert.ok(closingOwners.every(value => value.toLowerCase() === owner.toLowerCase()));
  const evidence = { status: 'PASS', environment: 'NEW_DISPOSABLE_FORK_NOT_PUBLIC_CHAIN', chainId: 4663,
    publicAnchor: { number: String(publicHead.number), hash: publicHead.hash }, copiedCollectionCodeHash: manifest.collectionCodeHash,
    copiedSourceTokenId: sourceTokenId, copiedRecipientTokenId: targetTokenId, copySupplyBefore: String(publicSupply),
    copiedExistingPublicDeployment: existing, addresses: plan.addresses,
    connectedStackRuntimeVerified: true, startsPaused: true, atomicDeploymentHashesOnFork: deploymentHashes,
    approvalHashOnFork: approved.hash, burnHashOnFork: burned.hash, approvalDoesNotCredit: true, exactlyOneCredit: true,
    burnLearnEquipUnequip: true, actualProductionProfileReader: true, publicOriginalsStillOwned: true,
    ...(rarityEye ? { selectedSkill: rarity, raritySample: rarityResult, spendingToolsDenied: true, unequippedToolDenied: true, packageReadinessFixtureOnly: true } : {}),
    publicTransactions: 0, manifestsWritten: false, previousPracticeReset: false,
    note: 'This fork does not exercise production asset recovery or lifecycle cleanup. The public source NFT was not burned. Fork receipts cannot establish a public deployment.' };
  const output = new URL('../docs/review/2026-09-12/atomic-forge/', import.meta.url);
  await mkdir(output, { recursive: true }); await writeFile(new URL(rarityEye?'rarity-eye-selected-pair-fork.json':existing?'selected-pair-fork.json':'original-collection-fork.json', output), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { if (child.exitCode === null) child.kill('SIGTERM'); }
