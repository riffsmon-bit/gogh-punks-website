// Every state-changing request is constrained to this invocation's owned Anvil.
// Public fork provider and OpenSea are accessed through read-only allowlists.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as tcpServer } from 'node:net';
import { createServer } from 'node:http';
import { createPublicClient, custom, http, encodeFunctionData, parseAbi, keccak256 } from 'viem';
import release from '../deployments/robinhood-forge-training.json' with { type: 'json' };
import walletDeployment from '../deployments/robinhood-punk-agent-account.json' with { type: 'json' };
import { loadResearchSkillCatalog, createResearchSkillRuntime } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { createProgressionReader, SKILL_CAPABILITIES, skillKey, manifestHash } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { createReviewedBurnPreparation } from '../broker/src/v4/skill-forge/reviewed-burn.mjs';
import { defaultAskIntent, punkCollectingIntentHash } from '../broker/src/v4/collecting-intent.mjs';
import { V2_SEADROP, V2_SEADROP_ADAPTER, V2_SEADROP_ADAPTER_CODE_HASH } from '../broker/src/v4/discovery/seadrop-ingestor.mjs';

const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--disposable-only' || !args.includes('--archive-keychain') || !args.includes('--opensea-keychain')) {
  throw Error('Requires --disposable-only --archive-keychain --opensea-keychain');
}
const run = promisify(execFile);
const owner = '0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6', tokenId = '93';
const sources = ['1753', '94', '95', '96'];
const PEPPies = '0xb73f1d1aee57410d537d87b656e98b9d3df5b213';
const ZERO = `0x${'0'.repeat(64)}`;
const publicUrl = (await run('security', ['find-generic-password', '-w', '-a', 'riffs.mon@gmail.com', '-s',
  'Gogh Punks Validation Cloud Robinhood archive RPC'], { maxBuffer: 4096 })).stdout.trim();
const apiKey = (await run('security', ['find-generic-password', '-w', '-a', 'gogh-punks', '-s',
  'Gogh Punks OpenSea API Key'], { maxBuffer: 4096 })).stdout.trim();
const publicMethods = new Set(), publicAllow = new Set(['eth_chainId', 'net_version', 'eth_blockNumber',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getCode', 'eth_getStorageAt', 'eth_getBalance',
  'eth_getTransactionCount', 'eth_call', 'eth_getLogs', 'eth_getTransactionReceipt', 'eth_getTransactionByHash',
  'eth_feeHistory', 'eth_gasPrice']);
let publicRequests = 0, localWrites = 0, externalMarketRequests = 0, child, proxy, enabled = false, stage = 'START';
const startedAt = Date.now(), steps = [], directory = await mkdtemp(join(tmpdir(), 'gogh-real-skill-journey-'));
const mark = name => { stage = name; console.log(JSON.stringify({ phase: stage })); };
const publicRead = async ({ method, params = [] }) => {
  assert.ok(publicAllow.has(method), 'PUBLIC_WRITE_DENIED'); publicMethods.add(method); publicRequests++;
  const response = await fetch(publicUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Error('PUBLIC_READ_UNAVAILABLE');
  const data = await response.json(); if (data.error || !Object.hasOwn(data, 'result')) throw Error('PUBLIC_READ_REJECTED');
  return data.result;
};
const publicClient = createPublicClient({ cacheTime: 0, transport: custom({ request: publicRead }, { retryCount: 0 }) });
const ABI = parseAbi(['function owner() view returns(address)', 'function ownerOf(uint256) view returns(address)',
  'function totalSupply() view returns(uint256)', 'function account(uint256) view returns(address)',
  'function setEmergencyControls(bool,uint256)', 'function available(bytes32) view returns(bool)',
  'function register(uint32,uint16,bytes32,bytes32,bytes32,uint256,uint8) returns(bytes32)',
  'function setStatus(bytes32,uint8,bytes32)', 'function trainingCredits(uint256) view returns(uint256)',
  'function learnedLevel(uint256,bytes32) view returns(uint8)', 'function equipped(uint256,uint8) view returns(bytes32)',
  'function unlockedSlots(uint256) view returns(uint8)', 'function trainingReviewNonce(uint256) view returns(uint256)',
  'function trainingReviewStateHash(uint256) view returns(bytes32)',
  'function applyTrainingReview((uint256 tokenId,uint8 operation,bytes32 skillKey,uint8 slot,uint8 startingSlots,bytes32[] rarityProof,uint256 nonce,bytes32 stateHash,uint64 deadline))',
  'function transferFrom(address,address,uint256)',
  'function getPublicDrop(address) view returns((uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))',
  'function updatePublicDrop(address,(uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))']);
try {
  mark('VERIFY_PUBLIC_READ_ONLY_ANCHOR');
  assert.equal(await publicClient.getChainId(), 4663);
  const anchor = await publicClient.getBlock();
  const publicBefore = {};
  for (const id of [tokenId, ...sources]) {
    publicBefore[id] = (await publicClient.readContract({ address: release.collection, abi: ABI, functionName: 'ownerOf', args: [BigInt(id)], blockNumber: anchor.number })).toLowerCase();
    assert.equal(publicBefore[id], owner);
  }
  proxy = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) throw Error('TOO_LARGE'); }
      const input = JSON.parse(body), result = await publicRead(input);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
    } catch { res.writeHead(502); res.end('{"error":"READ_ONLY_SOURCE_UNAVAILABLE"}'); }
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const reservation = tcpServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  assert.ok(![62764, 64343, 64344, 64345, 64346, 8549, 8787].includes(port));
  const localUrl = `http://127.0.0.1:${port}`;
  child = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(port), '--chain-id', '4663',
    '--mnemonic-random', '--prune-history', '10000', '--cache-path', join(directory, 'cache'),
    '--fork-url', `http://127.0.0.1:${proxy.address().port}`, '--fork-block-number', String(anchor.number)], { stdio: 'ignore' });
  let startupError; child.once('error', error => { startupError = error; });
  const client = createPublicClient({ cacheTime: 0, transport: http(localUrl, { timeout: 45_000, retryCount: 0 }) });
  for (let i = 0; i < 100; i++) {
    if (startupError || child.exitCode !== null) throw Error('OWNED_ANVIL_START_FAILED');
    try { if (await client.getChainId() === 4663) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.match(await client.request({ method: 'web3_clientVersion' }), /anvil/i);
  assert.equal((await client.getBlock({ blockNumber: anchor.number })).hash, anchor.hash);
  for (const role of ['collection', 'registry', 'progression', 'trainingSource']) {
    assert.equal(keccak256(await client.getCode({ address: release[role] })), release[`${role}CodeHash`]);
  }
  enabled = true;
  const local = async (method, params = []) => {
    assert.ok(enabled && child.pid > 0 && child.exitCode === null, 'OWNED_NODE_REQUIRED');
    if (method === 'eth_sendTransaction') localWrites++;
    return client.request({ method, params });
  };
  const read = (address, functionName, values = [], blockNumber) => client.readContract({ address, abi: ABI, functionName, args: values, blockNumber });
  const progress = (name, values = [93n]) => read(release.progression, name, values);
  const send = async transaction => {
    const hash = await local('eth_sendTransaction', [transaction]);
    const receipt = await client.waitForTransactionReceipt({ hash }); assert.equal(receipt.status, 'success');
    return hash;
  };
  const write = async (address, functionName, values, from = owner) => {
    const data = encodeFunctionData({ abi: ABI, functionName, args: values });
    const estimate = await client.estimateGas({ account: from, to: address, data, value: 0n });
    assert.ok(estimate > 0n && estimate < 3_000_000n);
    return send({ from, to: address, data, value: '0x0', gas: `0x${((estimate * 125n + 99n) / 100n).toString(16)}` });
  };
  const fresh = async () => {
    const block = await client.getBlock();
    while (Number(block.timestamp) >= Math.floor(Date.now() / 1000)) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await local('evm_setNextBlockTimestamp', [Math.floor(Date.now() / 1000)]);
    await local('evm_mine');
  };
  const accounts = (await client.request({ method: 'eth_accounts' })).map(value => value.toLowerCase()), buyer = accounts[1];
  assert.ok(buyer !== owner && (await client.getCode({ address: buyer }) ?? '0x') === '0x');
  await local('anvil_impersonateAccount', [owner]); await local('anvil_setBalance', [owner, '0x56bc75e2d63100000']);
  assert.equal((await read(release.registry, 'owner')).toLowerCase(), owner);
  await write(release.registry, 'setEmergencyControls', [false, (2n ** 256n - 1n) ^ 31n]);
  const selection = [{ slug: 'contract-detective', version: 1 }, { slug: 'market-scout', version: 2 },
    { slug: 'link-sniper', version: 1 }, { slug: 'mint-hunter', version: 1 }];
  const packages = (await loadResearchSkillCatalog({ selection })).map(pack => ({ ...pack, status: 'READY', approved: true }));
  const keys = packages.map(pack => skillKey(pack.manifest.skillId, pack.manifest.version));
  mark('REGISTER_EXACT_PACKAGES_ON_COPY');
  for (const [index, pack] of packages.entries()) {
    const m = pack.manifest, mask = m.capabilities.reduce((value, name) => value | SKILL_CAPABILITIES[name], 0n), key = keys[index];
    const tx = await write(release.registry, 'register', [m.skillId, m.version, pack.manifestHash, pack.instructionHash, ZERO, mask, m.riskTier]);
    assert.equal(await read(release.registry, 'available', [key]), false);
    const evidenceHash = manifestHash({ scope: 'OWNED_DISPOSABLE_NODE_ONLY', key, manifestHash: pack.manifestHash, implementationSha256: m.implementationSha256 });
    await write(release.registry, 'setStatus', [key, 3, evidenceHash]);
    await write(release.registry, 'setStatus', [key, 4, evidenceHash]);
    assert.equal(await read(release.registry, 'available', [key]), true);
    steps.push({ action: 'REGISTER_TESTING_READY_COPY', skill: m.name, version: m.version, key, transactionHash: tx });
  }
  mark('BURN_COPIES_FOR_FOUR_CREDITS');
  const creditBefore = await progress('trainingCredits'), supplyBefore = await read(release.collection, 'totalSupply');
  const burn = createReviewedBurnPreparation({ client, deployment: { ...release, burnSource: release.trainingSource, burnSourceCodeHash: release.trainingSourceCodeHash } });
  for (const id of sources) for (const action of ['APPROVE', 'BURN']) {
    await fresh();
    const review = await burn.prepare({ owner, sourceTokenId: id, targetTokenId: tokenId, action });
    assert.equal(review.productionAuthority, false); await burn.recheck(review);
    const hash = await send(review.transaction), confirmed = await burn.verifyReceipt(review, hash);
    assert.equal(confirmed.creditGain, action === 'BURN' ? 1 : 0);
    if (action === 'BURN') await assert.rejects(client.call({ account: owner, to: review.transaction.to, data: review.transaction.data, value: 0n }));
    steps.push({ action: `${action}_COPY`, sourceTokenId: id, targetTokenId: tokenId, transactionHash: hash });
  }
  assert.equal(await progress('trainingCredits'), creditBefore + 4n);
  assert.equal(await read(release.collection, 'totalSupply'), supplyBefore - 4n);
  const train = async (operation, key = ZERO, actor = owner) => {
    await fresh(); const block = await client.getBlock();
    const review = { tokenId: 93n, operation, skillKey: key, slot: 0, startingSlots: 0, rarityProof: [],
      nonce: await progress('trainingReviewNonce'), stateHash: await progress('trainingReviewStateHash'), deadline: block.timestamp + 45n };
    const hash = await write(release.progression, 'applyTrainingReview', [review], actor);
    await assert.rejects(client.call({ account: actor, to: release.progression, data: encodeFunctionData({ abi: ABI, functionName: 'applyTrainingReview', args: [review] }), value: 0n }));
    return hash;
  };
  mark('PREPARE_COPIED_FREE_DROP_AND_FIXED_RUNTIME');
  const peppiesOwner = (await read(PEPPies, 'owner')).toLowerCase();
  await local('anvil_impersonateAccount', [peppiesOwner]); await local('anvil_setBalance', [peppiesOwner, '0x56bc75e2d63100000']);
  await fresh(); const dropBlock = await client.getBlock();
  const publicDropBefore = await read(V2_SEADROP, 'getPublicDrop', [PEPPies]);
  await write(PEPPies, 'updatePublicDrop', [V2_SEADROP, { ...publicDropBefore, mintPrice: 0n,
    startTime: dropBlock.timestamp - 1n, endTime: dropBlock.timestamp + 3600n, maxTotalMintableByWallet: 50, restrictFeeRecipients: false }], peppiesOwner);
  assert.equal((await read(V2_SEADROP, 'getPublicDrop', [PEPPies])).mintPrice, 0n);
  const wallet = (await read(walletDeployment.contracts.GoghPunkAgentAccountRegistry.address, 'account', [93n])).toLowerCase();
  assert.equal(wallet, '0xcadcfd37e715bc031cf0cec7fa2335091c878c83');
  assert.equal(keccak256(await client.getCode({ address: walletDeployment.contracts.GoghPunkAgentAccountRegistry.address })), walletDeployment.contracts.GoghPunkAgentAccountRegistry.runtimeBytecodeHash);
  assert.equal(keccak256(await client.getCode({ address: walletDeployment.contracts.GoghPunkAgentAccount.address })), walletDeployment.contracts.GoghPunkAgentAccount.runtimeBytecodeHash);
  assert.equal((await read(wallet, 'owner')).toLowerCase(), owner);
  // Fund only the disposable account for this funded-wallet journey. No transfer is sent.
  const copiedAgentBalanceBefore = String(await client.getBalance({ address: wallet }));
  await local('anvil_setBalance', [wallet, '0xde0b6b3a7640000']);
  const reviewedCollectionCodeHash = keccak256(await client.getCode({ address: PEPPies }));
  assert.equal(keccak256(await client.getCode({ address: V2_SEADROP_ADAPTER })), V2_SEADROP_ADAPTER_CODE_HASH);
  const createdAt = new Date().toISOString();
  const opportunity = { schema: 'GOGH_NORMALIZED_OPPORTUNITY_V2', version: 2, opportunityId: 'seadrop:real-skill-copy:public',
    chainId: 4663, collectionContract: PEPPies, mintContract: V2_SEADROP, adapter: V2_SEADROP_ADAPTER,
    mintStage: 'PUBLIC', mintMethod: 'mintPublic(address,address,address,uint256)', priceWei: '0',
    estimatedGasCostWei: '1000000000000', supply: 2222, walletLimit: 50, startTime: null, endTime: null, website: null,
    socialUrls: { x: null, discord: null, farcaster: null }, sourceUrls: [`https://robinhoodchain.blockscout.com/address/${PEPPies}`],
    artStyles: [], imageReference: null, collectionName: 'Copied Peppies free-drop test', contractCodeHash: reviewedCollectionCodeHash,
    adapterCodeHash: V2_SEADROP_ADAPTER_CODE_HASH, screeningStatus: 'PASSED', simulationStatus: 'PENDING', riskLevel: 'LOW', riskScore: 5,
    expectedNftReceiver: null, unexpectedApprovals: false, unexpectedTransfers: false, createdAt, updatedAt: createdAt };
  let confirmedOwner = owner;
  const intentFor = actor => ({ ...defaultAskIntent({ punkTokenId: tokenId, expectedOwner: actor, punkWallet: wallet }), operatingMode: 'ASSIST',
    dailyMintLimit: 3, totalMintLimit: 10, maxGasPerMintWei: '10000000000000000', minimumReserveWei: '0' });
  let confirmedIntent = intentFor(owner);
  const contextReader = async ({ tokenId: requested, owner: actor, opportunityId }) => {
    assert.equal(requested, tokenId); assert.equal(opportunityId, opportunity.opportunityId); assert.equal(actor.toLowerCase(), confirmedOwner);
    const block = await client.getBlock(), actual = (await read(release.collection, 'ownerOf', [93n], block.number)).toLowerCase();
    return { intent: confirmedIntent, strategyVersion: 1, strategyHash: punkCollectingIntentHash(confirmedIntent), opportunity,
      authority: { chainId: 4663, collection: release.collection, tokenId, owner: actual, punkWallet: wallet,
        activated: true, nativeBalanceWei: String(await client.getBalance({ address: wallet, blockNumber: block.number })),
        blockNumber: String(block.number), blockHash: block.hash, blockTime: Number(block.timestamp) * 1000 },
      usage: { dailyMints: 0, totalMints: 0, opportunityMints: 0 } };
  };
  const fetchImpl = async (url, options) => {
    if (String(url).startsWith('https://api.opensea.io/api/v2/')) {
      assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); externalMarketRequests++;
      return fetch(url, options);
    }
    assert.equal(url, 'https://rpc.mainnet.chain.robinhood.com');
    const input = JSON.parse(options.body); assert.ok(publicAllow.has(input.method));
    const result = await client.request({ method: input.method, params: input.params });
    return Response.json({ jsonrpc: '2.0', id: input.id, result });
  };
  const readState = createProgressionReader({ client, ...release });
  const research = createResearchSkillRuntime({ client, packages, readState, apiKey, fetchImpl, environment: {}, mintContextReader: contextReader });
  const operations = [
    ['inspect_contract', { contract: release.collection }],
    ['get_market_listings', { slug: 'gogh-punks-255843210', contract: release.collection, limit: 2 }],
    ['inspect_mint_link', { url: `https://robinhoodchain.blockscout.com/address/${PEPPies}` }],
    ['prepare_mint', { opportunityId: opportunity.opportunityId }],
  ];
  const results = [];
  mark('LEARN_EQUIP_ACTUAL_TOOLS_UNEQUIP_DENIAL');
  for (const [index, pack] of packages.entries()) {
    const [name, arguments_] = operations[index], key = keys[index];
    await train(0, key); assert.equal(await progress('learnedLevel', [93n, key]), 1);
    await fresh(); await assert.rejects(research.call({ tokenId, owner, name, arguments: arguments_ }), /SKILL_TOOL_DENIED/);
    await train(2, key); await fresh();
    const result = await research.call({ tokenId, owner, name, arguments: arguments_ });
    assert.equal((await research.resolve({ tokenId, owner })).walletAuthority, 'NONE');
    if (name === 'inspect_contract') assert.equal(result.securityVerdict, 'NOT_A_SECURITY_CLEARANCE');
    if (name === 'get_market_listings') { assert.equal(result.schema, 'GOGH_MARKET_LISTING_OBSERVATIONS_V2'); assert.equal(result.coverage.status, 'BOUNDED_SAMPLE'); assert.ok(result.listings.length > 0); }
    if (name === 'inspect_mint_link') { assert.equal(result.reason, 'SEADROP_STATE_OBSERVED'); assert.equal(result.evidence.mint.priceWei, '0'); }
    if (name === 'prepare_mint') { console.log(JSON.stringify({ phase: stage, mintStatus: result.status, policy: result.policy, simulation: result.simulation })); assert.equal(result.status, 'OWNER_REVIEW_REQUIRED'); assert.equal(result.simulation.status, 'PASSED'); assert.equal(result.transaction, null); }
    results.push({ skill: pack.manifest.name, version: pack.manifest.version, key, tool: name, status: 'PASS',
      resultSchema: result.schema ?? null, listings: result.listings?.length ?? null,
      simulation: result.simulation?.status ?? result.evidence?.simulationStatus ?? null });
    await train(3); await fresh();
    await assert.rejects(research.call({ tokenId, owner, name, arguments: arguments_ }), /SKILL_TOOL_DENIED/);
    steps.push({ action: 'LEARN_EQUIP_TOOL_UNEQUIP_DENIED', skill: pack.manifest.name, key });
  }
  assert.equal(await progress('trainingCredits'), creditBefore);
  mark('TRANSFER_PERSISTENCE_AND_NEW_OWNER_AUTHORITY');
  await train(2, keys[0]); await fresh();
  const slots = await progress('unlockedSlots'), beforeWallet = wallet;
  const transfer = await write(release.collection, 'transferFrom', [owner, buyer, 93n]);
  await fresh();
  for (const key of keys) assert.equal(await progress('learnedLevel', [93n, key]), 1);
  assert.equal(await progress('unlockedSlots'), slots); assert.equal(await progress('equipped', [93n, 0]), keys[0]);
  assert.equal((await read(walletDeployment.contracts.GoghPunkAgentAccountRegistry.address, 'account', [93n])).toLowerCase(), beforeWallet);
  await assert.rejects(research.call({ tokenId, owner, name: operations[0][0], arguments: operations[0][1] }), /OWNER_CHANGED/);
  const buyerResult = await research.call({ tokenId, owner: buyer, name: operations[0][0], arguments: operations[0][1] });
  assert.equal(buyerResult.securityVerdict, 'NOT_A_SECURITY_CLEARANCE');
  await assert.rejects(train(3, ZERO, owner));
  await train(3, ZERO, buyer); await train(2, keys[3], buyer); await fresh();
  await assert.rejects(research.call({ tokenId, owner: buyer, name: 'prepare_mint', arguments: operations[3][1] }));
  // A separate fixture action represents the buyer explicitly confirming new rules.
  confirmedOwner = buyer; confirmedIntent = intentFor(buyer); await fresh();
  const buyerMint = await research.call({ tokenId, owner: buyer, name: 'prepare_mint', arguments: operations[3][1] });
  assert.equal(buyerMint.status, 'OWNER_REVIEW_REQUIRED'); assert.equal(buyerMint.transaction, null);
  mark('VERIFY_PUBLIC_ORIGINALS_UNCHANGED');
  for (const id of [tokenId, ...sources]) assert.equal((await publicClient.readContract({ address: release.collection,
    abi: ABI, functionName: 'ownerOf', args: [BigInt(id)] })).toLowerCase(), publicBefore[id]);
  const result = { schema: 'GOGH_REAL_SKILL_COMPOSED_JOURNEY_V1', status: 'PASS', checkedAt: new Date().toISOString(),
    sourceCommit: (await run('git', ['rev-parse', 'HEAD'])).stdout.trim(),
    forkAnchor: { number: String(anchor.number), hash: anchor.hash }, copiedDeploymentPinsVerified: true,
    targetTokenId: tokenId, canonicalWalletRole: 'AGENT', canonicalAgentWallet: wallet, agentRegistryAndImplementationPinsVerified: true, copiedAgentBalanceBefore, copiedAgentBalanceFixtureWei: '1000000000000000000', copiedSacrifices: sources, copiedCreditGain: 4, creditsSpentLearning: 4,
    duplicateBurnAndTrainingReplayRejected: true, learnedWithoutEquippedDenied: true, unequippedDenied: true,
    results, transfer: { transactionHash: transfer, allLearnedSkillsPersist: true, slotsPersist: true,
      loadoutPersists: true, walletPersists: true, oldOwnerDenied: true, newOwnerResearchWorks: true,
      inheritedStrategyDenied: true, buyerExplicitNewRulesRequired: true },
    externalMarketRequests, publicRequests, publicMethods: [...publicMethods].sort(), localTransactions: localWrites,
    publicTransactions: 0, productionDatabaseAccessed: false, productionManifestsChanged: false, publicOriginalsUnchanged: true,
    sourceInventoryFixtureOnly: true, productionBurnAuthorized: false, durationMs: Date.now() - startedAt,
    limitations: ['Copied-chain fixture administration only; no public skill registration or READY transition.',
      'Burn source inventory is not reviewed by this skill-specific harness; use the separate burn safety journey.',
      'The copied Peppies administrator temporarily sets a free public drop on this owned chain only.',
      'The copied Agent balance is set to 1 ETH as a funded-wallet fixture; no public funding or transfer occurs.',
      'Mint strategy and usage are server-owned fixture records; production DB adapter must be reviewed separately.',
      'Marketplace listings use real read-only OpenSea; link and mint calls use the copied fixed contract stack.',
      'Simulation does not expose a full effect trace and no mint transaction is submitted.',
      'Original token transfer continuity and broad autonomous execution retain their separate restrictions.'], steps };
  await writeFile(new URL('../docs/v2-hardening/real-skill-composed-evidence.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', phase: stage, type: error.name, code: error.code ?? null,
    actual: typeof error.actual === 'string' ? error.actual.slice(0, 150) : error.actual?.message?.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 250),
    message: String(error.shortMessage ?? error.message).split('\n')[0].replace(/https?:\/\/\S+/g, '[URL]').slice(0, 280),
    frames: error.stack?.split('\n').filter(line => line.includes('test-real-skill') || line.includes('skill-forge')).slice(0, 4) }));
  process.exitCode = 1;
} finally {
  enabled = false;
  if (child?.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 2000).unref(); }); }
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
  await rm(directory, { recursive: true, force: true });
}
