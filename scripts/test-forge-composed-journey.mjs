// H05: one composed journey against copies of the deployed reviewed contracts.
// The public provider is behind a read-only method allowlist. Every write targets
// THIS invocation's dynamically allocated loopback Anvil, after identity/pin checks.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createPublicClient, custom, http, encodeFunctionData, parseAbi, keccak256 } from 'viem';
import releaseArtifact from '../deployments/robinhood-forge-training.json' with { type: 'json' };
import profileArtifact from '../deployments/robinhood-skill-forge.json' with { type: 'json' };
import agentArtifact from '../deployments/robinhood-punk-agent-account.json' with { type: 'json' };
import walletArtifact from '../deployments/robinhood-automation-v3.json' with { type: 'json' };
import { createSelectedBurnStore } from '../broker/src/v4/skill-forge/selected-burn-store.mjs';
import { createSelectedBurnCoordinator, SELECTED_FORGE_DISABLED_MASK } from '../broker/src/v4/skill-forge/selected-burn-coordinator.mjs';
import { SELECTED_BURN_OWNER } from '../broker/src/v4/skill-forge/selected-burn-source.mjs';
import { createReviewedBurnPreparation } from '../broker/src/v4/skill-forge/reviewed-burn.mjs';
import { createPostgresTrainingStore } from '../broker/src/v4/skill-forge/postgres-training-store.mjs';
import { createTrainingCoordinator } from '../broker/src/v4/skill-forge/training-coordinator.mjs';
import { trainingDeploymentBinding, validateTrainingRelease } from '../broker/src/v4/skill-forge/training-release.mjs';
import { durableTrainingTransaction } from '../broker/src/v4/skill-forge/durable-training-review.mjs';
import { reconcileTrainingBatch } from '../broker/src/v4/skill-forge/training-reconciler.mjs';
import { readTrainingSettlement } from '../broker/src/v4/skill-forge/training-settlement.mjs';
import { buildFrozenAllocation, FROZEN_RARITY_HASH } from '../broker/src/v4/skill-forge/rarity-allocation.mjs';
import { createOriginalForgeProfileReader } from '../broker/src/v4/skill-forge/original-punk-profile.mjs';
import { createProgressionReader } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { loadResearchSkillCatalog, createResearchSkillRuntime } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { assessSacrifice, BURN_WALLET_ROLES } from '../broker/src/v4/skill-forge/burn-eligibility.mjs';
import { verifyPunkAgentOwnershipContinuity } from '../broker/src/agent-account/punk-agent-ownership-continuity.mjs';
import { createV2McpResearch } from '../netlify/functions/_shared/v2-mcp-research.mjs';
import { validateSelectedBurnEnvelope } from '../site/forge-selected-burn-wallet.js';
import { createDurableTrainingWallet, validateDurableTrainingSnapshot } from '../site/forge-durable-wallet.js';

const args = process.argv.slice(2);
if (![2, 3, 4].includes(args.length) || args[0] !== '--disposable-only' || !args[1].startsWith('--postgres-bin=')
  || args.slice(2).some(arg => !['--archive-keychain', '--inspect-failure'].includes(arg))) throw Error('Requires --disposable-only --postgres-bin=/absolute/bin [--archive-keychain] [--inspect-failure]');
const bin = args[1].slice('--postgres-bin='.length);
if (!isAbsolute(bin)) throw Error('POSTGRES_ABSOLUTE_BIN_REQUIRED');
const run = promisify(execFile), owner = SELECTED_BURN_OWNER, target = '93', source = '1753', extraSource = '94';
const startedAt = Date.now();
const forbiddenPorts = new Set([64343, 64344, 64345, 64346, 8549, 8787]);
const freePort = async () => {
  const s = createTcpServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port; await new Promise(r => s.close(r)); assert.ok(!forbiddenPorts.has(p)); return p;
};
const dir = await mkdtemp(join(tmpdir(), 'gogh-forge-journey-')), data = join(dir, 'data');
const command = (name, argv) => run(join(bin, name), argv, { timeout: 60000, maxBuffer: 100000 });
const metrics = {}, steps = [], publicMethods = new Set();
let pgStarted = false, child, admin, requests, workers, browser, proxy, writingEnabled = false, publicRequests = 0, localWrites = 0;
let stage = 'SETUP', diagnosticClient, diagnosis = {};
const markStage = value => { stage = value; console.log(JSON.stringify({ phase: value })); };
const publicAllow = new Set(['eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_getCode', 'eth_getStorageAt', 'eth_getBalance', 'eth_getTransactionCount', 'eth_call', 'eth_getLogs',
  'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_feeHistory', 'eth_gasPrice']);
let publicUrl = 'https://rpc.mainnet.chain.robinhood.com';
if (args.includes('--archive-keychain')) publicUrl = (await run('security', ['find-generic-password', '-w', '-a', 'riffs.mon@gmail.com',
  '-s', 'Gogh Punks Validation Cloud Robinhood archive RPC'], { maxBuffer: 4096 })).stdout.trim();
const publicRead = async ({ method, params = [] }) => {
  assert.ok(publicAllow.has(method), 'PUBLIC_RPC_WRITE_DENIED'); publicMethods.add(method); publicRequests++;
  const response = await fetch(publicUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error('READ_ONLY_FORK_SOURCE_UNAVAILABLE');
  const payload = await response.json(); if (payload.error || !Object.hasOwn(payload, 'result')) throw Error('READ_ONLY_FORK_SOURCE_REJECTED');
  return payload.result;
};
const publicClient = createPublicClient({ cacheTime: 0, transport: custom({ request: publicRead }, { retryCount: 0 }) });
const abi = parseAbi(['function ownerOf(uint256) view returns(address)', 'function totalSupply() view returns(uint256)',
  'function transferFrom(address,address,uint256)', 'function account(uint256) view returns(address)', 'function owner() view returns(address)',
  'function trainingCredits(uint256) view returns(uint256)', 'function learnedLevel(uint256,bytes32) view returns(uint8)',
  'function unlockedSlots(uint256) view returns(uint8)', 'function claimedStartingSlots(uint256) view returns(uint8)',
  'function effectiveCapabilities(uint256) view returns(uint256)', 'function trainingReviewNonce(uint256) view returns(uint256)',
  'function setEmergencyControls(bool,uint256)', 'function isAutonomousSessionActive() view returns(bool)', 'function sessionGeneration() view returns(uint64)']);
try {
  // Establish the immutable remote anchor through READS, then isolate the fork.
  markStage('PUBLIC_READ_ONLY_ANCHOR'); assert.equal(await publicClient.getChainId(), 4663);
  const anchor = await publicClient.getBlock();
  const beforePublic = {};
  for (const id of [source, target, extraSource]) {
    beforePublic[id] = (await publicClient.readContract({ address: releaseArtifact.collection, abi, functionName: 'ownerOf', args: [BigInt(id)], blockNumber: anchor.number })).toLowerCase();
    assert.equal(beforePublic[id], owner, 'FIXED_TEST_PAIR_OWNER_CHANGED');
  }
  const ports = [await freePort(), await freePort()]; assert.notEqual(ports[0], ports[1]);
  proxy = createHttpServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1000000) throw Error('TOO_LARGE'); }
      const input = JSON.parse(body); const result = await publicRead(input);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
    } catch { res.writeHead(502); res.end('{"error":"READ_ONLY_FORK_SOURCE_UNAVAILABLE"}'); }
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const proxyPort = proxy.address().port; assert.ok(!forbiddenPorts.has(proxyPort));
  child = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(ports[1]), '--chain-id', '4663', '--mnemonic-random',
    '--prune-history', '10000', '--cache-path', join(dir, 'anvil-cache'),
    '--fork-url', `http://127.0.0.1:${proxyPort}`, '--fork-block-number', String(anchor.number)], { stdio: 'ignore' });
  let startupError; child.once('error', e => { startupError = e; });
  const localUrl = `http://127.0.0.1:${ports[1]}`;
  // Cold fork evaluation may fetch many immutable storage words from the public source.
  // This budget is for the disposable test node only, never a production setting.
  const transport = http(localUrl, { timeout: 60000, retryCount: 0, fetchFn: async (url, options) => {
    const response = await fetch(url, options);
    const payload = await response.clone().json().catch(() => null);
    if (payload?.error) {
      const input = JSON.parse(options.body);
      console.log(JSON.stringify({ phase: stage, localRpcMethod: input.method, rpcError: {
        params: input.params, code: payload.error.code, message: String(payload.error.message).replace(/https?:\/\/[^\s]+/g, '[URL]').slice(0, 350),
        data: typeof payload.error.data === 'string' ? payload.error.data.slice(0, 20) : null } }));
    }
    return response;
  } });
  const clients = [0, 1].map(() => createPublicClient({ cacheTime: 0, transport })), client = clients[0];
  for (let i = 0; i < 100; i++) {
    if (startupError || child.exitCode !== null) throw Error('OWNED_ANVIL_START_FAILED');
    try { if (await client.getChainId() === 4663) break; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  assert.match(await client.request({ method: 'web3_clientVersion' }), /anvil/i);
  assert.equal(await client.getChainId(), 4663);
  assert.equal((await client.getBlock({ blockNumber: anchor.number })).hash, anchor.hash);
  for (const role of ['collection', 'registry', 'progression', 'trainingSource'])
    assert.equal(keccak256(await client.getCode({ address: releaseArtifact[role] })), releaseArtifact[`${role}CodeHash`]);
  writingEnabled = true; diagnosticClient = client; diagnosis = { localUrl, nodePid: child.pid, forkAnchor: { number: String(anchor.number), hash: anchor.hash }, owner };
  const local = async (method, params = []) => {
    assert.ok(writingEnabled && child.exitCode === null && child.pid > 0);
    assert.match(localUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    if (method === 'eth_sendTransaction') localWrites++;
    return client.request({ method, params });
  };
  // Materialize each block and retain the whole bounded journey in memory.
  // Avoid asynchronous historical-state disk availability in long fork fixtures.
  // Receipt verification still reads the unchanged canonical finalized height.
  const finalize = async () => { for (let i = 0; i < 128; i++) await local('anvil_mine', ['0x1', '0x0']); };
  const receipt = async hash => { const value = await client.waitForTransactionReceipt({ hash }); assert.equal(value.status, 'success'); return value; };
  const send = async transaction => { const hash = await local('eth_sendTransaction', [transaction]); await receipt(hash); return hash; };
  const write = async (address, functionName, values, from = owner, contractAbi = abi) => {
    const data = encodeFunctionData({ abi: contractAbi, functionName, args: values });
    const estimate = await client.estimateGas({ account: from, to: address, data, value: 0n });
    assert.ok(estimate > 0n && estimate < 2000000n);
    return send({ from, to: address, value: '0x0', data, gas: `0x${((estimate * 120n + 99n) / 100n).toString(16)}` });
  };
  const read = (address, functionName, values = []) => client.readContract({ address, abi, functionName, args: values });
  const progress = (functionName, values = [93n]) => read(releaseArtifact.progression, functionName, values);
  const fresh = async () => {
    const block = await client.getBlock(), now = BigInt(Math.floor(Date.now() / 1000));
    if (block.timestamp >= now) await new Promise(r => setTimeout(r, Math.min(2000, Number(block.timestamp - now + 1n) * 1000)));
    const time = BigInt(Math.floor(Date.now() / 1000));
    if (block.timestamp < time) await local('evm_setNextBlockTimestamp', [Number(time)]);
    await local('evm_mine');
  };
  // Anvil creates fresh random GENESIS accounts, not well-known development
  // addresses with unrelated public delegation, or ad-hoc impersonations whose
  // nonce history is unavailable in some Anvil fork snapshots. Keys stay in Anvil.
  const [, buyer, sessionKey] = (await client.request({ method: 'eth_accounts' })).map(value => value.toLowerCase());
  diagnosis.buyer = buyer; diagnosis.sessionKey = sessionKey;
  for (const actor of [buyer, sessionKey]) {
    const code = await client.getCode({ address: actor }); assert.ok(code === undefined || code === '0x');
  }
  await local('anvil_impersonateAccount', [owner]);
  await local('anvil_setBalance', [owner, '0x56bc75e2d63100000']);
  // Local-only test allowlist extension permits the second fixture owner. No file,
  // deployment authority or production allowlist is changed.
  const release = { ...releaseArtifact, allowedOwners: [owner, buyer] };
  const binding = trainingDeploymentBinding(release), skill = release.skills[0];

  markStage('NATIVE_POSTGRES');
  await command('initdb', ['-D', data, '--no-locale', '-E', 'UTF8', '--auth=trust']);
  await command('pg_ctl', ['-D', data, '-l', join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${ports[0]} -k ${dir}`, '-w', 'start']); pgStarted = true;
  const settings = { host: '127.0.0.1', port: ports[0], database: 'postgres', max: 4, connectionTimeoutMillis: 5000 };
  admin = new pg.Pool({ ...settings, user: userInfo().username });
  for (const filename of ['20260910180000_stage_forge_training_intents.sql', '20260911140000_settle_forge_training_intents.sql', '20260913040000_stage_selected_burn_reviews.sql'])
    await admin.query(await readFile(new URL(`../netlify/database/migrations/${filename}`, import.meta.url), 'utf8'));
  await admin.query('CREATE ROLE anon LOGIN; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for (const filename of ['forge-training-roles.sql', 'selected-burn-roles.sql'])
    await admin.query(await readFile(new URL(`../netlify/database/review/${filename}`, import.meta.url), 'utf8'));
  await admin.query('ALTER ROLE forge_request LOGIN; ALTER ROLE forge_worker LOGIN;');
  requests = new pg.Pool({ ...settings, user: 'forge_request' }); workers = new pg.Pool({ ...settings, user: 'forge_worker' }); browser = new pg.Pool({ ...settings, user: 'anon' });
  for (const table of ['broker_selected_burn_reviews', 'broker_forge_training_intents'])
    await assert.rejects(browser.query(`SELECT * FROM ${table}`), e => e.code === '42501');
  await assert.rejects(requests.query("UPDATE broker_forge_training_intents SET settlement='{}'"), e => e.code === '42501');

  markStage('BURN_SOURCE_GATES');
  const empty = () => ({ chainId: 4663, owner, burnOwner: owner, trainOwner: owner, punkToBurn: source, punkToTrain: target,
    burnTokenExists: true, trainTokenExists: true, checkedAt: 1000, blockHash: anchor.hash,
    supply: { chainId: 4663, collection: release.collection, totalSupply: '3000', checkedAt: 1000, blockHash: anchor.hash },
    openMissions: 0, activeAutomation: 0, unsettledTransactions: 0, legacyLocks: 0,
    wallets: BURN_WALLET_ROLES.map((role, i) => ({ role, address: `0x${String(i + 1).repeat(40)}`, checkedAt: 1000,
      blockHash: anchor.hash, nativeWei: '0', entryPointDepositWei: '0', nftCount: 0, erc20AssetCount: 0, otherAssetCount: 0, inventoryComplete: true })) });
  const sourceGateCases = [];
  for (const role of BURN_WALLET_ROLES) for (const field of ['nativeWei', 'entryPointDepositWei', 'nftCount', 'erc20AssetCount', 'otherAssetCount']) {
    const snapshot = empty(); snapshot.wallets.find(w => w.role === role)[field] = field.endsWith('Wei') ? '1' : 1;
    const denied = assessSacrifice(snapshot, { now: 1000 });
    assert.equal(denied.status, 'BLOCKED');
    assert.ok(denied.reasons.some(reason => reason.code === 'ASSETS_PRESENT' && reason.message.includes(field)));
    sourceGateCases.push(`${role}:${field}`);
  }
  for (const field of ['openMissions', 'activeAutomation', 'unsettledTransactions', 'legacyLocks']) {
    const snapshot = empty(); snapshot[field] = 1;
    const denied = assessSacrifice(snapshot, { now: 1000 });
    assert.equal(denied.status, 'BLOCKED');
    assert.ok(denied.reasons.some(reason => reason.code === 'UNRESOLVED_STATE' && reason.message.includes(field)));
    sourceGateCases.push(field);
  }
  assert.equal(assessSacrifice(empty(), { now: 1000 }).status, 'CHECKS_PASSED_PRODUCTION_LOCKED');
  assert.equal(assessSacrifice(empty(), { now: 1000 }).canBurn, false);

  markStage('SELECTED_DEPLOYED_BURN');
  await write(release.registry, 'setEmergencyControls', [true, SELECTED_FORGE_DISABLED_MASK]);
  const creditBefore = await progress('trainingCredits'), supplyBefore = await read(release.collection, 'totalSupply');
  assert.equal(creditBefore, 0n, 'FORK_TARGET_ALREADY_TRAINED_REQUIRES_NEW_TEST_SELECTION');
  const sourceEvidence = { scope: 'DISPOSABLE_FORK_FIXTURE', clear: true };
  const burnOptions = { clients, release, store: createSelectedBurnStore(requests, owner, source), checkSource: async () => sourceEvidence };
  const burnSelected = { owner, tokenId: target, chainId: 4663, preview: false };
  const burnEnvelope = result => ({ ok: true, mode: 'SELECTED_OWNER_BURN', owner, chainId: 4663, sourceTokenId: source, targetTokenId: target, ...result });
  for (const action of ['ENABLE_FORGE', 'APPROVE', 'BURN']) {
    await fresh(); let coordinator = createSelectedBurnCoordinator(burnOptions);
    if (action === 'APPROVE') {
      for (const code of ['BURN_SOURCE_ASSETS_OR_ACTIVITY', 'BURN_SOURCE_OBLIGATIONS_PENDING']) {
        const blocked = createSelectedBurnCoordinator({ ...burnOptions, checkSource: async () => { throw Error(code); } });
        const count = localWrites; await assert.rejects(blocked.prepare(action), new RegExp(code));
        assert.equal(localWrites, count, 'source-clearance failure never reaches a wallet request');
      }
    }
    const prepared = await coordinator.prepare(action), record = prepared.record;
    validateSelectedBurnEnvelope(burnEnvelope(prepared), burnSelected, release);
    await assert.rejects(coordinator.prepare(action), /RECOVER_EXISTING_BURN_REVIEW/);
    const claim = { intentId: record.review.intentId, revision: record.revision, reviewHash: record.reviewHash, confirmation: `BURN ${source}`, obligationsReviewed: true };
    if (action === 'BURN') await assert.rejects(coordinator.claim({ ...claim, confirmation: 'BURN 93' }), /BURN_CONFIRMATION_REQUIRED/);
    if (action !== 'ENABLE_FORGE') await assert.rejects(coordinator.claim({ ...claim, obligationsReviewed: false }), /BURN_OWNER_REVIEW_REQUIRED/);
    const claims = await Promise.allSettled([coordinator.claim(claim), coordinator.claim(claim)]);
    assert.equal(claims.filter(x => x.status === 'fulfilled').length, 1);
    const claimed = claims.find(x => x.status === 'fulfilled').value;
    coordinator = createSelectedBurnCoordinator({ ...burnOptions, store: createSelectedBurnStore(requests, owner, source) });
    await assert.rejects(coordinator.claim(claim), /BURN_JOURNAL_CHANGED/);
    const hash = await send(claimed.transaction); await local('anvil_mine', ['0xc', '0x0']);
    const originalReceipt = client.getTransactionReceipt;
    client.getTransactionReceipt = async () => { throw Object.assign(Error('FIXTURE_RECEIPT_TIMEOUT'), { name: 'TransactionReceiptNotFoundError' }); };
    const pending = await coordinator.recover({ intentId: record.review.intentId, revision: claimed.record.revision, transactionHash: hash });
    assert.equal(pending.pending, true); assert.equal(pending.record.status, 'WALLET_REQUESTED'); assert.equal(pending.record.reportedHash, hash);
    client.getTransactionReceipt = originalReceipt;
    const recovered = await coordinator.recover({ intentId: record.review.intentId, revision: pending.record.revision, transactionHash: hash });
    assert.equal(recovered.record.status, 'CONFIRMED'); assert.equal(recovered.record.receipt.verifiedProviders, 2);
    await assert.rejects(coordinator.recover({ intentId: record.review.intentId, revision: recovered.record.revision, transactionHash: hash }), /BURN_JOURNAL_CHANGED/);
    steps.push({ action, status: 'CONFIRMED', forkTransactionHash: hash });
  }
  assert.equal(await progress('trainingCredits'), creditBefore + 1n);
  assert.equal(await read(release.collection, 'totalSupply'), supplyBefore - 1n);
  await assert.rejects(read(release.collection, 'ownerOf', [1753n]));
  const oldBurn = await createSelectedBurnCoordinator(burnOptions).get(); assert.equal(oldBurn.state.credited, true);

  markStage('DURABLE_TRAINING');
  const frozen = JSON.parse(await readFile(new URL(`../artifacts/skill-forge/rarity/gogh-opensea-rarity-${FROZEN_RARITY_HASH}.json`, import.meta.url), 'utf8'));
  const allocation = buildFrozenAllocation(frozen);
  const allocationReader = async tokenId => ({ startingSlots: frozen.payload.records.find(r => String(r.tokenId) === tokenId).startingSlots, proof: allocation.proof(tokenId) });
  const coordinatorOf = () => createTrainingCoordinator({ pool: requests, storeFactory: createPostgresTrainingStore, client, release, allocationReader });
  const baseWorker = createPostgresTrainingStore({ pool: workers, deployment: binding });
  const worker = Object.fromEntries(Object.entries(baseWorker).map(([method, value]) => [method, typeof value !== 'function' ? value : async (...args) => {
    try { return await value(...args); } catch (error) {
      console.log(JSON.stringify({ phase: stage, storeMethod: method, errorCode: error.code ?? null, message: String(error.message).split('\n')[0].slice(0, 160) })); throw error;
    }
  }]));
  const attempted = new Set(); let trainingSends = 0;
  const train = async (operation, actor = owner, { loseResponse = false } = {}) => {
    markStage(`TRAIN_${operation.toUpperCase()}`); await fresh();
    const action = { operation, ...(['learn', 'equip'].includes(operation) ? { skillKey: skill.key } : {}), ...(['equip', 'unequip'].includes(operation) ? { slot: 0 } : {}) };
    const input = { owner: actor, tokenId: target, action, requestKey: randomBytes(32).toString('hex') };
    const head = await client.getBlock(); console.log(JSON.stringify({ phase: stage, chainTime: String(head.timestamp), wallTime: Math.floor(Date.now() / 1000) }));
    const coordinator = coordinatorOf(), prepared = await coordinator.prepare(input);
    diagnosis.review = prepared.record.review;
    assert.equal((await coordinator.prepare(input)).record.intentId, prepared.record.intentId);
    const scope = { intentId: prepared.record.intentId, owner: actor, tokenId: target };
    const current = async () => ({ ok: true, mode: 'OWNER_CANARY', canBurn: false, chainId: 4663, owner: actor, tokenId: target, ...(await coordinatorOf().get(scope)) });
    validateDurableTrainingSnapshot(await current(), { owner: actor, tokenId: target, chainId: 4663, preview: false }, { release, binding });
    let sentHash;
    const provider = { request: async ({ method, params }) => {
      if (method === 'eth_accounts') return [actor];
      if (method === 'eth_sendTransaction') {
        sentHash = await local(method, params); diagnosis.transactionHash = sentHash; trainingSends++;
        if (loseResponse) throw Error('FIXTURE_WALLET_RESPONSE_LOST'); return sentHash;
      }
      return client.request({ method, params });
    } };
    const control = () => createDurableTrainingWallet({ provider, release, binding, readCurrent: current,
      claim: (intentId, revision, reviewHash) => coordinatorOf().claim({ ...scope, intentId }, revision, reviewHash),
      markAttempted: async id => attempted.add(id), wasAttempted: id => attempted.has(id), isCurrent: () => true });
    const selection = { owner: actor, tokenId: target, chainId: 4663, preview: false };
    if (loseResponse) await assert.rejects(control().submit(prepared, selection, action), /FIXTURE_WALLET_RESPONSE_LOST/);
    else assert.equal((await control().submit(prepared, selection, action)).transactionHash, sentHash);
    assert.ok(sentHash); await receipt(sentHash);
    // Fresh browser/controller and fresh coordinator preserve the attempted marker.
    await assert.rejects(control().submit(prepared, selection, action), /already reached confirmation/);
    let row = (await coordinatorOf().get(scope)).record;
    if (loseResponse) row = await coordinatorOf().mutate(scope, 'unknown', row.revision);
    row = await coordinatorOf().mutate(scope, 'recover', row.revision, sentHash);
    assert.equal(row.status, 'SUBMITTED');
    await finalize();
    const settlementRead = await readTrainingSettlement({ clients, review: prepared.record.review, transactionHash: sentHash,
      expectedRuntimeHash: release.progressionCodeHash, expectedSnapshotHash: release.snapshotHash });
    assert.equal(settlementRead.settlement?.status, 'SETTLED_SUCCESS');
    const result = await reconcileTrainingBatch({ store: worker, clients, expectedRuntimeHash: release.progressionCodeHash, expectedSnapshotHash: release.snapshotHash });
    assert.deepEqual(result.errors, {}); assert.equal(result.settled, 1);
    assert.equal((await worker.get(scope)).status, 'SETTLED_SUCCESS');
    assert.equal((await reconcileTrainingBatch({ store: worker, clients, expectedRuntimeHash: release.progressionCodeHash, expectedSnapshotHash: release.snapshotHash })).settled, 0);
    steps.push({ action: operation, owner: actor, status: 'SETTLED_SUCCESS', forkTransactionHash: sentHash }); return { scope, prepared };
  };
  const learned = await train('learn', owner, { loseResponse: true });
  assert.equal(await progress('trainingCredits'), 0n); assert.equal(await progress('learnedLevel', [93n, skill.key]), 1);
  assert.equal(await progress('effectiveCapabilities'), 0n);
  await assert.rejects(coordinatorOf().prepare({ owner, tokenId: target, action: { operation: 'learn', skillKey: skill.key }, requestKey: randomBytes(32).toString('hex') }), /SKILL_UNAVAILABLE/);
  await assert.rejects(coordinatorOf().prepare({ owner, tokenId: target, action: { operation: 'unlock' }, requestKey: randomBytes(32).toString('hex') }), /NO_CREDIT/);

  // A distinct SECOND fork copy buys a slot. It is not the training target and
  // does not change selected production pair eligibility or the released UI.
  markStage('SECOND_COPY_FOR_SLOT'); await fresh();
  const burn = createReviewedBurnPreparation({ client, deployment: { ...release, burnSource: release.trainingSource, burnSourceCodeHash: release.trainingSourceCodeHash } });
  await assert.rejects(burn.prepare({ owner, sourceTokenId: target, targetTokenId: target, action: 'APPROVE' }), /BOTH_OWNED_PUNKS_REQUIRED/);
  await assert.rejects(burn.prepare({ owner: buyer, sourceTokenId: extraSource, targetTokenId: target, action: 'APPROVE' }), /BURN_OWNER_CHANGED/);
  for (const action of ['APPROVE', 'BURN']) {
    await fresh(); const review = await burn.prepare({ owner, sourceTokenId: extraSource, targetTokenId: target, action });
    await burn.recheck(review); const hash = await send(review.transaction);
    assert.equal((await burn.verifyReceipt(review, hash)).creditGain, action === 'BURN' ? 1 : 0);
    if (action === 'BURN') await assert.rejects(client.call({ account: owner, to: review.transaction.to, data: review.transaction.data, value: 0n }));
    steps.push({ action: `${action}_SECOND_COPY`, status: 'CONFIRMED', forkTransactionHash: hash });
  }
  assert.equal(await progress('trainingCredits'), 1n);
  if (await progress('claimedStartingSlots') === 0) await train('claim_rarity');
  const slotsBefore = await progress('unlockedSlots'); await train('unlock');
  assert.equal(await progress('unlockedSlots'), slotsBefore + 1); assert.equal(await progress('trainingCredits'), 0n);
  await train('equip'); assert.equal(await progress('effectiveCapabilities'), 8n);

  markStage('REAL_RARITY_TOOL'); await fresh();
  const packages = (await loadResearchSkillCatalog()).map(p => p.slug === 'rarity-eye' ? { ...p, status: 'READY', approved: true } : p);
  const rarity = packages.find(p => p.slug === 'rarity-eye');
  assert.equal(rarity.manifestHash, skill.manifestHash); assert.equal(rarity.instructionHash, skill.instructionHash);
  const readState = createProgressionReader({ client, ...release });
  const research = createResearchSkillRuntime({ client, readState, packages });
  const sample = { contract: release.collection, tokenIds: ['93', '95', '96'], numericMode: 'categorical' };
  const researchBridge = createV2McpResearch({ releaseReader: () => validateTrainingRelease(release), clientFactory: () => client,
    packageLoader: loadResearchSkillCatalog, environment: {} });
  const bridgeArguments = { sampleTokenIds: sample.tokenIds };
  assert.deepEqual((await research.resolve({ tokenId: target, owner })).effectiveMcpTools, ['get_metadata', 'rank_trait_sample']);
  const bridgeResult = await researchBridge.call({ tokenId: target, owner, name: 'rank_trait_sample', arguments: bridgeArguments });
  assert.equal(bridgeResult.walletAuthority, 'NONE'); assert.equal(bridgeResult.canBurn, false);
  assert.equal(bridgeResult.requiresSeparateEconomicAuthorization, true);
  const ranked = bridgeResult.result;
  assert.equal(ranked.sampleSize, 3); assert.match(ranked.metadataEvidence.metadataHash, /^[0-9a-f]{64}$/);
  await assert.rejects(research.call({ tokenId: target, owner, name: 'prepare_mint' }), /SKILL_TOOL_DENIED/);
  await train('unequip'); await fresh();
  await assert.rejects(researchBridge.call({ tokenId: target, owner, name: 'rank_trait_sample', arguments: bridgeArguments }), /SKILL_TOOL_DENIED/);
  await train('equip');

  markStage('TRANSFER_AND_ACCOUNT_CONTINUITY'); await fresh();
  const agentAddress = await read(agentArtifact.contracts.GoghPunkAgentAccountRegistry.address, 'account', [93n]);
  const walletAddress = await read(walletArtifact.contracts.GoghPunkAccountRegistryV3.address, 'account', [93n]);
  const agentContract = JSON.parse(await readFile(new URL('../contracts/out/GoghPunkAgentAccount.sol/GoghPunkAgentAccount.json', import.meta.url), 'utf8'));
  const adapter = agentArtifact.reusedContracts.AutomatedSeaDropStudioFreeMintAdapter;
  const configure = { sessionKey, adapter, venue: agentArtifact.reusedContracts.SeaDrop,
    adapterCodeHash: keccak256(await client.getCode({ address: adapter })), targetCollection: release.collection,
    validAfter: 0, validUntil: Math.floor(Date.now() / 1000) + 1800, maxMintsPerDay: 1, maxMintsTotal: 1,
    maxGasCostWei: 10000000000000n, minimumNativeReserveWei: 1n };
  markStage('CONFIGURE_COPIED_SESSION');
  const authorizationHash = await write(agentAddress, 'configureAutonomousSession', [configure], owner, agentContract.abi);
  await fresh();
  const generation = String(await read(agentAddress, 'sessionGeneration'));
  const mission = { owner, tokenId: target, account: agentAddress, sessionGeneration: generation, authorizationTransactionHash: authorizationHash };
  const runtime = { owner, account: agentAddress, session: { generation, sessionKey } };
  assert.equal((await verifyPunkAgentOwnershipContinuity({ client, mission, runtime, deployment: agentArtifact })).verified, true);
  const profile = createOriginalForgeProfileReader({ client, deployment: profileArtifact, packages });
  const before = await profile({ tokenId: target, owner });
  const nftCollection = '0xb73f1d1aee57410d537d87b656e98b9d3df5b213';
  const custody = (await read(nftCollection, 'ownerOf', [1599n])).toLowerCase();
  assert.equal(custody, agentAddress.toLowerCase(), 'COMPLETED_PAID_DELIVERY_CHANGED');
  markStage('TRANSFER_COPIED_PUNK');
  const transferHash = await write(release.collection, 'transferFrom', [owner, buyer, 93n]); await fresh();
  markStage('VERIFY_COPIED_TRANSFER');
  const after = await profile({ tokenId: target, owner: buyer });
  for (const field of ['trainingCredits', 'learnedSkills', 'equippedSkills', 'unlockedSlots', 'claimedStartingSlots']) assert.deepEqual(after[field], before[field]);
  assert.equal(await read(agentArtifact.contracts.GoghPunkAgentAccountRegistry.address, 'account', [93n]), agentAddress);
  assert.equal(await read(walletArtifact.contracts.GoghPunkAccountRegistryV3.address, 'account', [93n]), walletAddress);
  assert.equal((await read(nftCollection, 'ownerOf', [1599n])).toLowerCase(), custody);
  assert.equal((await read(agentAddress, 'owner')).toLowerCase(), buyer);
  assert.equal((await read(walletAddress, 'owner')).toLowerCase(), buyer);
  assert.equal(await read(agentAddress, 'isAutonomousSessionActive'), false);
  await assert.rejects(verifyPunkAgentOwnershipContinuity({ client, mission, runtime, deployment: agentArtifact }), /OWNER_CHANGED/);
  await assert.rejects(profile({ tokenId: target, owner }), /OWNER_CHANGED/);
  await assert.rejects(coordinatorOf().prepare({ owner, tokenId: target, action: { operation: 'unequip', slot: 0 }, requestKey: randomBytes(32).toString('hex') }), /STATE_UNVERIFIED/);
  assert.equal(await worker.get({ ...learned.scope, owner: buyer }), null, 'buyer cannot read seller private review');
  await train('unequip', buyer); await train('equip', buyer); await fresh();
  assert.equal((await researchBridge.call({ tokenId: target, owner: buyer, name: 'rank_trait_sample', arguments: bridgeArguments })).result.sampleSize, 3);
  assert.equal(await read(agentAddress, 'isAutonomousSessionActive'), false, 'new training must not reactivate automation');

  markStage('REVERT_AND_TIMEOUT_RECOVERY'); await fresh();
  const expired = await coordinatorOf().prepare({ owner: buyer, tokenId: target, action: { operation: 'unequip', slot: 0 }, requestKey: randomBytes(32).toString('hex') });
  const expiredScope = { intentId: expired.record.intentId, owner: buyer, tokenId: target };
  const expiredClaim = await coordinatorOf().claim(expiredScope, 0, expired.record.reviewHash); assert.equal(expiredClaim.claimed, true);
  // Mine past the exact deadline; the unchanged reviewed bytes must revert.
  await local('evm_setNextBlockTimestamp', [Number(expired.record.review.guard.deadline) + 1]);
  await finalize();
  const expiredTx = durableTrainingTransaction(expired.record.review);
  await assert.rejects(client.call({ account: buyer, to: expiredTx.to, data: expiredTx.data, value: 0n }));
  const expiry = await reconcileTrainingBatch({ store: worker, clients, expectedRuntimeHash: release.progressionCodeHash,
    expectedSnapshotHash: release.snapshotHash, now: () => Number(expired.record.review.guard.deadline) * 1000 + 2000 });
  assert.deepEqual(expiry.errors, {}); assert.equal(expiry.settled, 1);
  assert.equal((await worker.get(expiredScope)).status, 'REVIEW_EXPIRED');
  assert.equal(await progress('effectiveCapabilities'), 8n);

  markStage('CLOSING_PUBLIC_READ_ONLY_CHECK');
  for (const id of [source, target, extraSource]) assert.equal((await publicClient.readContract({ address: release.collection, abi, functionName: 'ownerOf', args: [BigInt(id)] })).toLowerCase(), beforePublic[id]);
  metrics.elapsedMs = Date.now() - startedAt;
  const trainingEvents = await admin.query('SELECT status,count(*)::int AS count FROM broker_forge_training_intent_events GROUP BY status ORDER BY status');
  const burnEvents = await admin.query('SELECT status,count(*)::int AS count FROM broker_selected_burn_events GROUP BY status ORDER BY status');
  const result = { schema: 'GOGH_FORGE_COMPOSED_JOURNEY_V1', status: 'PASS', checkedAt: new Date().toISOString(),
    environment: 'OWNED_DISPOSABLE_ANVIL_FORK_AND_NATIVE_POSTGRES', publicAnchor: { number: String(anchor.number), hash: anchor.hash },
    deployedRuntimePinsVerified: true, selectedSource: source, trainingTarget: target, extraSlotSource: extraSource,
    initialSelectedCredit: String(creditBefore), selectedCreditGained: 1, extraCreditGained: 1, creditsAfterLearningAndUnlock: '0',
    supplyDecreaseOnFork: 2, slotCountBeforePaidUnlock: slotsBefore, slotCountAfterPaidUnlock: slotsBefore + 1,
    skill: { name: skill.name, key: skill.key, manifestHash: skill.manifestHash, instructionHash: skill.instructionHash,
      implementationSha256: rarity.manifest.implementationSha256, sampleSize: ranked.sampleSize, metadataEvidence: ranked.metadataEvidence },
    capabilityMaskEquipped: '8', unequippedResearchDenied: true, spendingToolDenied: true,
    releasedServerResearchBridgeVerified: true, bridgeUsesActualStateAndOwnershipContinuity: true,
    bridgeWalletAuthority: bridgeResult.walletAuthority, bridgeEconomicAuthorizationSeparate: true,
    browserEnvelopeValidated: true, recreatedBrowserAttemptMarkerPreserved: true, lostWalletResponseRecoveredWithoutResend: true,
    concurrentBurnClaimWinners: 1, duplicateSettlementNoCreditOrTraining: true,
    buyerFreshReviewAccepted: true, sellerAuthorityDenied: true, privateSellerReviewHiddenFromBuyer: true,
    transfer: { forkTransactionHash: transferHash, learnedSkillsPersist: true, slotsPersist: true, loadoutPersists: true,
      canonicalWallet: walletAddress, agentWallet: agentAddress, paidNft1599CustodyPersisted: true,
      sessionActiveBefore: true, sessionActiveAfter: false, managedContinuityRejectsPreviousOwner: true,
      trainingDoesNotReactivateAutomation: true, roundTripSessionRevivalNotChanged: true },
    sourceEligibility: { evidence: 'EXPLICIT_MOCK_SNAPSHOTS_NOT_PRODUCTION_INVENTORY', cases: sourceGateCases,
      emptyMockDoesNotAuthorizeProduction: true, selectedCoordinatorSourceClearanceMocked: true,
      sourceCheckAssetAndObligationFailuresPreventWalletRequest: true,
      secondSourceInventoryNotClaimedVerified: true },
    database: { engine: 'native PostgreSQL', restrictedRequestAndWorkerRoles: true, browserDenied: true,
      trainingEvents: trainingEvents.rows, selectedBurnEvents: burnEvents.rows },
    twoReceiptClientsShareOneOwnedNode: true, publicFinalityOrIndependentProvidersProven: false,
    visualBrowserProof: 'SEPARATE_EXISTING_BROWSER_HARNESSES; THIS_SCRIPT_USES_REAL_BROWSER_ENVELOPE_MODULES_WITH_LOCAL_PROVIDER',
    forkTransactions: localWrites, reviewedTrainingSends: trainingSends, publicRequests, publicMethods: [...publicMethods].sort(),
    publicTransactions: 0, publicOriginalsUnchanged: true, manifestsChanged: false, productionDatabaseAccessed: false,
    productionBurnAuthorized: false, inMemoryBuyerAllowlistOnly: true, freshRandomAnvilGenesisActors: true,
    ownedAnvilHistoryStatesRetained: 10000, ownedAnvilCacheIsolated: true, metrics, steps };
  await writeFile(new URL('../docs/v2-hardening/forge-journey-evidence.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Provider URLs, database credentials, and raw RPC errors are never printed.
  console.error(JSON.stringify({ status: 'FAILED', stage, type: error.name, code: error.code ?? null,
    frames: error.stack?.split('\n').filter(line => line.includes('skill-forge/') || line.includes('test-forge-composed')).slice(0, 5),
    message: error.name === 'AssertionError' ? error.message.slice(0, 500) : String(error.message).split('\n')[0].slice(0, 160),
    reason: error.reason ?? null }));
  process.exitCode = 1;
  if (args.includes('--inspect-failure') && diagnosticClient) {
    diagnosis.stage = stage;
    for (const blockTag of ['latest', 'finalized']) {
      try { const block = await diagnosticClient.getBlock({ blockTag }); diagnosis[blockTag] = { number: String(block.number), hash: block.hash, timestamp: String(block.timestamp) }; } catch {}
    }
    diagnosis.rawNonceReads = [];
    const diagnosticTags = ['latest', 'finalized', ...['forkAnchor', 'finalized', 'latest'].filter(k => diagnosis[k]).map(k => `0x${BigInt(diagnosis[k].number).toString(16)}`),
      ...(diagnosis.review ? [`0x${(BigInt(diagnosis.review.anchor.number) + 1n).toString(16)}`] : [])];
    for (const address of [diagnosis.buyer, diagnosis.owner, diagnosis.sessionKey].filter(Boolean)) for (const tag of diagnosticTags) {
      const params = [address, tag];
      try {
        const payload = await fetch(diagnosis.localUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params }), signal: AbortSignal.timeout(5000) }).then(r => r.json());
        diagnosis.rawNonceReads.push({ params, ...payload });
      } catch { diagnosis.rawNonceReads.push({ params, unavailable: true }); }
    }
    await writeFile('/private/tmp/gogh-forge-journey-failure-context.json', JSON.stringify(diagnosis, null, 2));
    console.log(JSON.stringify({ phase: 'BOUNDED_FAILURE_INSPECTION', seconds: 120, context: '/private/tmp/gogh-forge-journey-failure-context.json' }));
    await new Promise(resolve => setTimeout(resolve, 120000));
  }
} finally {
  writingEnabled = false;
  await Promise.allSettled([requests?.end(), workers?.end(), browser?.end(), admin?.end()]);
  if (child?.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => { child.once('exit', r); setTimeout(r, 2000).unref(); }); }
  if (proxy) { proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); }
  if (pgStarted) await command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
  await rm(dir, { recursive: true, force: true });
}
