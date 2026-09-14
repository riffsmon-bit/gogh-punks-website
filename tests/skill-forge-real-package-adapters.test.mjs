import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { encodeFunctionResult, keccak256, parseAbi, toFunctionSelector, decodeFunctionData } from 'viem';
import { loadResearchSkillCatalog, createResearchSkillRuntime } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { skillKey, SKILL_CAPABILITIES } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import { defaultAskIntent, punkCollectingIntentHash } from '../broker/src/v4/collecting-intent.mjs';
import { V2_SEADROP, V2_SEADROP_ADAPTER, V2_SEADROP_ADAPTER_CODE_HASH } from '../broker/src/v4/discovery/seadrop-ingestor.mjs';
import compressed from './fixtures/fixed-source-link-runtimes.json' with { type: 'json' };
import compressedAdapter from './fixtures/mint-hunter-adapter-runtime.json' with { type: 'json' };

const OWNER = `0x${'1'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`, WALLET = `0x${'3'.repeat(40)}`;
const HASH = `0x${'4'.repeat(64)}`, ZERO = `0x${'0'.repeat(40)}`;
const GOGH = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
const COLLECTION = '0xb73f1d1aee57410d537d87b656e98b9d3df5b213';
const CODE = Object.fromEntries(Object.entries(compressed).map(([name, data]) => [name, `0x${gunzipSync(Buffer.from(data, 'base64')).toString('hex')}`]));
const ADAPTER_CODE = `0x${gunzipSync(Buffer.from(compressedAdapter.gzipBase64, 'base64')).toString('hex')}`;
const ROOT = new URL('../', import.meta.url);
const load = async (slug, version = 1) => (await loadResearchSkillCatalog({ selection: [{ slug, version }] }))
  .map(p => ({ ...p, status: 'READY', approved: true })); // fixture approval only
function progression(packages) {
  return { tokenId: '93', owner: OWNER, chainId: 4663, blockHash: HASH, blockTime: Date.now(), slots: 8,
    mask: packages.reduce((mask, p) => mask | p.manifest.capabilities.reduce((m, c) => m | SKILL_CAPABILITIES[c], 0n), 0n).toString(),
    equipped: packages.map((p, slot) => ({ key: skillKey(p.manifest.skillId, p.manifest.version), slot, level: 1, available: true,
      definition: { status: 4, disabled: false, deprecated: false, manifestHash: p.manifestHash,
        instructionHash: p.instructionHash, capabilities: p.manifest.capabilities.reduce((m, c) => m | SKILL_CAPABILITIES[c], 0n).toString() } })) };
}
function runtime(packages, options = {}) {
  let state = progression(packages);
  const instance = createResearchSkillRuntime({ readState: async () => ({ ...state, blockTime: Date.now() }), packages, ...options });
  return { runtime: instance, setState: value => { state = value; }, getState: () => state,
    call: (name, args = {}) => instance.call({ tokenId: '93', owner: OWNER, name, arguments: args }) };
}

test('default catalog remains three v1 packages and every explicit package is unapproved TESTING', async () => {
  const defaults = await loadResearchSkillCatalog();
  assert.deepEqual(defaults.map(p => [p.slug, p.manifest.version]), [['contract-detective', 1], ['rarity-eye', 1], ['market-scout', 1]]);
  for (const [slug, version] of [['market-scout', 2], ['mint-hunter', 1], ['link-sniper', 1]]) {
    const [pack] = await loadResearchSkillCatalog({ selection: [{ slug, version }] });
    assert.equal(pack.approved, false); assert.equal(pack.status, 'TESTING'); assert.equal(pack.manifest.walletAuthority, 'NONE');
    assert.deepEqual(pack.manifest.requiredWalletCapabilities, []);
  }
});

test('explicit version selection rejects unknown, duplicate and filesystem-injection identities', async () => {
  for (const selection of [[], [{ slug: '../rarity-eye', version: 1 }], [{ slug: 'rarity-eye', version: 2 }],
    [{ slug: 'market-scout', version: 1 }, { slug: 'market-scout', version: 1 }], [{ slug: 'mint-hunter', version: 1, root: '/tmp' }]]) {
    await assert.rejects(loadResearchSkillCatalog({ selection }), /INVALID_SKILL_SELECTION|UNREVIEWED_SKILL_VERSION/);
  }
});

test('new adapter and dependency bytes must agree with selected package pins', async () => {
  const directory = await mkdtemp(`${tmpdir()}/gogh-skill-pins-`);
  try {
    const [pack] = await loadResearchSkillCatalog({ selection: [{ slug: 'link-sniper', version: 1 }] });
    const paths = ['broker/skills/link-sniper/v1/manifest.json', 'broker/skills/link-sniper/v1/SKILL.md',
      pack.manifest.implementation, ...Object.keys(pack.manifest.dependenciesSha256)];
    for (const path of paths) { await mkdir(`${directory}/${path.substring(0, path.lastIndexOf('/'))}`, { recursive: true }); await writeFile(`${directory}/${path}`, await readFile(new URL(path, ROOT))); }
    const root = pathToFileURL(`${directory}/`), selection = [{ slug: 'link-sniper', version: 1 }];
    assert.equal((await loadResearchSkillCatalog({ root, selection })).length, 1);
    await writeFile(`${directory}/broker/src/v4/link-scanner.mjs`, '// tampered dependency');
    await assert.rejects(loadResearchSkillCatalog({ root, selection }), /DEPENDENCY_HASH_MISMATCH/);
    await writeFile(`${directory}/${pack.manifest.implementation}`, '// tampered adapter');
    await assert.rejects(loadResearchSkillCatalog({ root, selection }), /IMPLEMENTATION_HASH_MISMATCH/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function marketFetch(calls) {
  const end = String(Math.floor(Date.now() / 1000) + 3600), start = String(Math.floor(Date.now() / 1000) - 30);
  return async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.includes('/collections/') ? { name: 'Fixture', contracts: [{ chain: 'robinhood', address: COLLECTION }] }
      : { listings: [{ chain: 'robinhood', order_hash: HASH, protocol_address: '0x0000000000000068f116a894984e2db1123eb395',
        status: 'ACTIVE', asset: { contract: COLLECTION, identifier: '1599' }, remaining_quantity: 1,
        price: { current: { value: '900719925474099300001', decimals: 18, currency: 'ETH' } },
        protocol_data: { signature: 'PRIVATE_PROVIDER_SIGNATURE', parameters: {
          offer: [{ itemType: 2, token: COLLECTION, identifierOrCriteria: '1599', startAmount: '1', endAmount: '1' }],
          consideration: [{ itemType: 0, token: ZERO, identifierOrCriteria: '0', startAmount: '900719925474099300001', endAmount: '900719925474099300001', recipient: OTHER }],
          totalOriginalConsiderationItems: 1, offerer: OTHER, zone: ZERO, startTime: start, endTime: end, orderType: 0,
        } } }], next: null });
  };
}

test('equipped Market Scout v2 invokes the actual v2 reader while v1 retains its old response', async () => {
  for (const version of [1, 2]) {
    const calls = [], f = runtime(await load('market-scout', version), { apiKey: 'FIXTURE_ONLY', fetchImpl: marketFetch(calls) });
    const result = await f.call('get_market_listings', { slug: 'peppies', contract: COLLECTION, limit: 1 });
    assert.equal(result.listings.length, 1); assert.equal(calls.length, 2);
    if (version === 2) {
      assert.equal(result.schema, 'GOGH_MARKET_LISTING_OBSERVATIONS_V2');
      assert.equal(result.listings[0].asset.tokenId, '1599');
      assert.equal(result.listings[0].price.totalAmount, '900719925474099300001');
      assert.equal(result.coverage.collectionFloorVerified, false);
    } else assert.notEqual(result.schema, 'GOGH_MARKET_LISTING_OBSERVATIONS_V2');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_SIGNATURE|FIXTURE_ONLY|protocol_data/);
    f.setState({ ...f.getState(), equipped: [] });
    await assert.rejects(f.call('get_market_listings', { slug: 'peppies', contract: COLLECTION }), /SKILL_TOOL_DENIED/);
    assert.equal(calls.length, 2);
  }
});

test('two equipped versions cannot silently pick a reader and missing API configuration exposes no market tool', async () => {
  const packages = [...await load('market-scout'), ...await load('market-scout', 2)];
  const f = runtime(packages, { apiKey: 'FIXTURE_ONLY', fetchImpl: async () => { throw Error('MUST_NOT_FETCH'); } });
  await assert.rejects(f.call('get_market_listings', { slug: 'peppies', contract: COLLECTION }), /AMBIGUOUS_SKILL_VERSION/);
  await assert.rejects(runtime(packages).call('get_market_listings', { slug: 'peppies', contract: COLLECTION }), /SKILL_TOOL_DENIED/);
});

const LINK_ABI = parseAbi(['function supportsInterface(bytes4) view returns(bool)',
  'function getPublicDrop(address) view returns((uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))',
  'function getMintStats(address) view returns(uint256,uint256,uint256)', 'function getFeeRecipientIsAllowed(address,address) view returns(bool)']);
const SELECTORS = new Map(LINK_ABI.map(item => [toFunctionSelector(item), item.name]));
const LINK_TIME = Date.parse('2026-09-13T12:00:00Z');
const linkNow = () => new Date(LINK_TIME);
function linkFetch(calls, afterRead) {
  // Every response describing block 100 must retain its original timestamp.
  // Recomputing Date.now() per RPC accidentally simulates a reorg whenever
  // the initial and canonical reads straddle a wall-clock second.
  const seconds = BigInt(LINK_TIME / 1000);
  return async (url, options) => {
    const { id, method, params } = JSON.parse(options.body); calls.push({ url, options, method });
    let result;
    if (method === 'eth_chainId') result = '0x1237';
    else if (method === 'eth_getBlockByNumber') result = { number: '0x64', hash: HASH, timestamp: `0x${seconds.toString(16)}`, transactions: [] };
    else if (method === 'eth_getCode') result = params[0].toLowerCase() === V2_SEADROP ? CODE.seaDrop : CODE.peppies;
    else if (method === 'eth_getStorageAt') result = `0x${'0'.repeat(64)}`;
    else if (method === 'eth_call') {
      const functionName = SELECTORS.get(params[0].data.slice(0, 10));
      const resultValue = functionName === 'supportsInterface' ? true : functionName === 'getMintStats' ? [0n, 1599n, 2222n]
        : functionName === 'getFeeRecipientIsAllowed' ? true : { mintPrice: 0n, startTime: seconds - 60n, endTime: seconds + 3600n,
          maxTotalMintableByWallet: 2, feeBps: 0, restrictFeeRecipients: false };
      result = encodeFunctionResult({ abi: LINK_ABI, functionName, result: resultValue });
    } else throw Error(`UNEXPECTED_METHOD_${method}`);
    afterRead?.(); return Response.json({ jsonrpc: '2.0', id, result });
  };
}

test('equipped Link Sniper resolves real pinned contract/mint evidence without transaction authority', async () => {
  const calls = [], f = runtime(await load('link-sniper'), { fetchImpl: linkFetch(calls), now: linkNow, environment: {} });
  const result = await f.call('inspect_mint_link', { url: `https://robinhoodchain.blockscout.com/address/${COLLECTION}` });
  assert.equal(result.reason, 'SEADROP_STATE_OBSERVED'); assert.equal(result.evidence.mint.priceWei, '0');
  assert.equal(result.evidence.anchor.canonicalRechecked, true);
  assert.equal(result.transactionPrepared, false); assert.equal(result.transactionSubmitted, false);
  assert.equal(result.walletAuthority, 'NONE'); assert.equal(result.evidence.simulationStatus, 'UNAVAILABLE');
  assert.ok(calls.length > 5 && calls.length <= 20);
  assert.ok(calls.every(c => c.url === 'https://rpc.mainnet.chain.robinhood.com' && c.options.redirect === 'error'));
});

test('Link Sniper keeps one canonical fixture block while observation time crosses seconds', async () => {
  const calls = []; let observedAt = LINK_TIME;
  const f = runtime(await load('link-sniper'), { fetchImpl: linkFetch(calls, () => { observedAt += 1100; }),
    now: () => new Date(observedAt), environment: {} });
  const result = await f.call('inspect_mint_link', { url: `https://robinhoodchain.blockscout.com/address/${COLLECTION}` });
  assert.equal(result.reason, 'SEADROP_STATE_OBSERVED');
  assert.equal(result.evidence.anchor.blockTimestamp, String(LINK_TIME / 1000));
  assert.equal(result.evidence.anchor.canonicalRechecked, true);
  assert.ok(observedAt - LINK_TIME > 1000); assert.ok(calls.length > 5 && calls.length <= 20);
});

test('Link Sniper still rejects a genuinely changed canonical block timestamp', async () => {
  const calls = [], source = linkFetch(calls);
  const fetchImpl = async (url, options) => {
    const response = await source(url, options), { method, params } = JSON.parse(options.body);
    if (method !== 'eth_getBlockByNumber' || params[0] === 'latest') return response;
    const payload = await response.json(); payload.result.timestamp = `0x${(BigInt(payload.result.timestamp) + 1n).toString(16)}`;
    return Response.json(payload);
  };
  const f = runtime(await load('link-sniper'), { fetchImpl, now: linkNow, environment: {} });
  const result = await f.call('inspect_mint_link', { url: `https://robinhoodchain.blockscout.com/address/${COLLECTION}` });
  assert.equal(result.reason, 'INSPECTION_UNAVAILABLE'); assert.equal(result.evidence.anchor, null);
  assert.equal(result.transactionPrepared, false); assert.equal(result.transactionSubmitted, false);
});

for (const event of ['unequip', 'oldOwner', 'hashMismatch', 'unlearned']) test(`Link Sniper denies ${event} before external reads`, async () => {
  let reads = 0; const packages = await load('link-sniper'), f = runtime(packages, { fetchImpl: async () => { reads++; throw Error('MUST_NOT_FETCH'); } });
  const state = f.getState();
  if (event === 'unequip') state.equipped = [];
  else if (event === 'oldOwner') state.owner = OTHER;
  else if (event === 'unlearned') state.equipped[0].level = 0;
  else state.equipped[0].definition.manifestHash = `0x${'a'.repeat(64)}`;
  await assert.rejects(f.call('inspect_mint_link', { url: `https://robinhoodchain.blockscout.com/address/${COLLECTION}` }), /SKILL_TOOL_DENIED|OWNER_CHANGED|PACKAGE_HASH_MISMATCH/);
  assert.equal(reads, 0);
});

test('Link Sniper withholds a result if the Punk transfers during its provider call', async () => {
  const calls = []; let f;
  f = runtime(await load('link-sniper'), { fetchImpl: linkFetch(calls, () => { f.getState().owner = OTHER; }), now: linkNow, environment: {} });
  await assert.rejects(f.call('inspect_mint_link', { url: `https://robinhoodchain.blockscout.com/address/${COLLECTION}` }), /OWNER_CHANGED/);
});

test('Link Sniper rejects endpoint/calldata/identity injection and unresolved websites stay unresolved', async () => {
  const calls = [], f = runtime(await load('link-sniper'), { fetchImpl: linkFetch(calls), now: linkNow, environment: {} });
  for (const extra of [{ rpcUrl: 'https://attacker.example' }, { calldata: '0x1234' }, { owner: OTHER }, { tokenId: '94' }]) {
    await assert.rejects(f.call('inspect_mint_link', { url: 'https://example.com', ...extra }), /INVALID_RESEARCH_ARGUMENTS|TOOL_IDENTITY_MISMATCH/);
  }
  const result = await f.call('inspect_mint_link', { url: 'https://example.com' });
  assert.equal(result.reason, 'NO_TRUSTED_RESOLVER'); assert.equal(result.executable, false); assert.equal(calls.length, 0);
});

function mintFixture({ mode = 'ASSIST', alterContext, alterClient, afterCall } = {}) {
  const now = new Date(), seconds = BigInt(Math.floor(now.getTime() / 1000)), calls = [];
  const intent = { ...defaultAskIntent({ punkTokenId: '93', expectedOwner: OWNER, punkWallet: WALLET }, now),
    operatingMode: mode, maxGasPerMintWei: '100000', minimumReserveWei: '1000', dailyMintLimit: 3, totalMintLimit: 10 };
  let contextReads = 0;
  const ctx = { intent, strategyHash: punkCollectingIntentHash(intent, now), strategyVersion: 1,
    authority: { chainId: 4663, collection: GOGH, tokenId: '93', owner: OWNER, punkWallet: WALLET,
      activated: true, nativeBalanceWei: '1000000', blockNumber: '100', blockHash: HASH, blockTime: now.getTime() },
    usage: { dailyMints: 0, totalMints: 0, opportunityMints: 0 },
    opportunity: { schema: 'GOGH_NORMALIZED_OPPORTUNITY_V2', version: 2, opportunityId: 'seadrop:fixture:public',
      chainId: 4663, collectionContract: COLLECTION, mintContract: V2_SEADROP, adapter: V2_SEADROP_ADAPTER,
      mintStage: 'PUBLIC', mintMethod: 'mintPublic(address,address,address,uint256)', priceWei: '0',
      estimatedGasCostWei: '500', supply: 2222, walletLimit: 2, startTime: null, endTime: null, website: null,
      socialUrls: { x: null, discord: null, farcaster: null }, sourceUrls: [`https://robinhoodchain.blockscout.com/address/${COLLECTION}`],
      artStyles: [], imageReference: null, collectionName: 'Fixture', contractCodeHash: keccak256(CODE.peppies),
      adapterCodeHash: V2_SEADROP_ADAPTER_CODE_HASH, screeningStatus: 'PASSED', simulationStatus: 'PENDING',
      riskLevel: 'LOW', riskScore: 5, expectedNftReceiver: null, unexpectedApprovals: false, unexpectedTransfers: false,
      createdAt: now.toISOString(), updatedAt: now.toISOString() } };
  const client = {
    getChainId: async () => 4663,
    getBlockNumber: async () => 100n,
    getBlock: async () => ({ number: 100n, hash: HASH, timestamp: seconds }),
    getCode: async ({ address }) => address === V2_SEADROP ? CODE.seaDrop : address === V2_SEADROP_ADAPTER ? ADAPTER_CODE : CODE.peppies,
    readContract: async ({ functionName }) => functionName === 'getPublicDrop' ? {
      mintPrice: 0n, startTime: seconds - 60n, endTime: seconds + 3600n, maxTotalMintableByWallet: 2n, restrictFeeRecipients: false,
    } : functionName === 'getMintStats' ? [0n, 1599n, 2222n] : true,
    call: async request => { calls.push(request); afterCall?.(ctx); return { data: '0x' }; },
    estimateGas: async () => 100n, getGasPrice: async () => 2n,
  };
  alterClient?.(client);
  return { ctx, calls, client, now: () => now, mintContextReader: async identity => {
    assert.deepEqual(identity, { tokenId: '93', owner: OWNER, opportunityId: ctx.opportunity.opportunityId });
    contextReads++; alterContext?.(ctx, contextReads); return ctx;
  } };
}
const mintArgs = { opportunityId: 'seadrop:fixture:public' };

test('Mint Hunter calls the actual fixed SeaDrop simulator, enforces policy and returns review without signing bytes', async () => {
  assert.equal(keccak256(ADAPTER_CODE), V2_SEADROP_ADAPTER_CODE_HASH);
  const fixture = mintFixture(), f = runtime(await load('mint-hunter'), fixture);
  const inspected = await f.call('inspect_mint', mintArgs);
  assert.equal(inspected.status, 'INSPECTED'); assert.equal(inspected.simulation.status, 'NOT_RUN'); assert.equal(fixture.calls.length, 0);
  for (const name of ['simulate_mint', 'prepare_mint']) {
    const result = await f.call(name, mintArgs);
    assert.equal(result.status, name === 'prepare_mint' ? 'OWNER_REVIEW_REQUIRED' : 'SIMULATED');
    assert.equal(result.policy.matched, true); assert.equal(result.simulation.estimatedGasWei, '200');
    assert.equal(result.simulation.effectTraceAvailable, false); assert.equal(result.transaction, null);
    assert.equal(result.executionReservationRequired, true); assert.equal(result.transactionSubmitted, false);
    assert.doesNotMatch(JSON.stringify(result), /"data"|"calldata"|signature|authorizationList/);
  }
  assert.equal(fixture.calls.length, 2);
  const request = fixture.calls[0]; assert.equal(request.account, OWNER); assert.equal(request.to, WALLET); assert.equal(request.value, 0n);
  const outer = decodeFunctionData({ abi: parseAbi(['function execute(address,uint256,bytes,uint8)']), data: request.data });
  assert.equal(outer.args[0].toLowerCase(), V2_SEADROP); assert.equal(outer.args[1], 0n); assert.equal(outer.args[3], 0);
});

for (const [name, mutation, expected] of [
  ['owner', c => { c.authority.owner = OTHER; }, 'MINT_CONTEXT_MISMATCH'],
  ['wrongWallet', c => { c.authority.punkWallet = OTHER; }, 'MINT_CONTEXT_MISMATCH'],
  ['wrongChain', c => { c.authority.chainId = 1; }, 'MINT_CONTEXT_MISMATCH'],
  ['paid', c => { c.opportunity.priceWei = '1'; }, 'MINT_CONTEXT_MISMATCH'],
  ['stale', c => { c.authority.blockTime -= 31000; }, 'MINT_CONTEXT_MISMATCH'],
  ['usage', c => { delete c.usage.dailyMints; }, 'MINT_USAGE_UNAVAILABLE'],
  ['strategyHash', c => { c.strategyHash = HASH; }, 'MINT_CONTEXT_MISMATCH'],
]) test(`Mint Hunter rejects ${name} before simulation`, async () => {
  const fixture = mintFixture({ alterContext: mutation }), f = runtime(await load('mint-hunter'), fixture);
  await assert.rejects(f.call('prepare_mint', mintArgs), new RegExp(expected)); assert.equal(fixture.calls.length, 0);
});

for (const [name, mutation, reason] of [
  ['funds', c => { c.authority.nativeBalanceWei = '0'; }, 'MINIMUM_RESERVE_VIOLATION'],
  ['pendingLimit', c => { c.usage.dailyMints = 3; }, 'DAILY_LIMIT_REACHED'],
  ['blockedContract', c => { c.intent.blockedContracts = [COLLECTION]; c.strategyHash = punkCollectingIntentHash(c.intent); }, 'CONTRACT_BLOCKED'],
]) test(`Mint Hunter explains ${name} policy failure without simulation`, async () => {
  const fixture = mintFixture({ alterContext: mutation }), f = runtime(await load('mint-hunter'), fixture);
  const result = await f.call('prepare_mint', mintArgs);
  assert.equal(result.status, 'POLICY_BLOCKED'); assert.ok(result.policy.reasons.includes(reason)); assert.equal(fixture.calls.length, 0);
});

test('Mint Hunter rereads strategy, balance and canonical chain after simulation', async () => {
  for (const [afterCall, expected] of [
    [c => { c.strategyVersion++; }, /MINT_CONTEXT_CHANGED/],
    [c => { c.authority.owner = OTHER; }, /MINT_CONTEXT_MISMATCH/],
  ]) {
    const fixture = mintFixture({ afterCall }), f = runtime(await load('mint-hunter'), fixture);
    await assert.rejects(f.call('prepare_mint', mintArgs), expected); assert.equal(fixture.calls.length, 1);
  }
  const fixture = mintFixture({ afterCall: c => { c.authority.nativeBalanceWei = '100'; } }), f = runtime(await load('mint-hunter'), fixture);
  const result = await f.call('prepare_mint', mintArgs);
  assert.equal(result.status, 'POLICY_BLOCKED'); assert.ok(result.policy.reasons.includes('MINIMUM_RESERVE_VIOLATION'));
});

test('Mint Hunter fails on wrong simulator chain, reorg, code changes, paid repricing and exact-call reverts', async () => {
  for (const alterClient of [
    c => { c.getChainId = async () => 1; },
    c => { c.getBlock = async () => ({ number: 100n, hash: `0x${'9'.repeat(64)}`, timestamp: 1n }); },
    c => { c.getCode = async () => '0x6000'; },
    c => { c.readContract = async ({ functionName }) => functionName === 'getPublicDrop' ? { mintPrice: 1n, startTime: 0n, endTime: 2n, maxTotalMintableByWallet: 2n } : [0n, 0n, 2n]; },
    c => { c.call = async () => { throw Error('EXACT_CALL_REVERT'); }; },
  ]) {
    const fixture = mintFixture({ alterClient }), f = runtime(await load('mint-hunter'), fixture);
    await assert.rejects(f.call('prepare_mint', mintArgs));
  }
});

test('Mint Hunter prep requires ASSIST and absent context service never advertises working tools', async () => {
  const packages = await load('mint-hunter'), fixture = mintFixture({ mode: 'ASK' }), f = runtime(packages, fixture);
  await assert.rejects(f.call('prepare_mint', mintArgs), /MINT_ASSIST_REQUIRED/);
  await assert.rejects(runtime(packages, { client: {} }).call('prepare_mint', mintArgs), /SKILL_TOOL_DENIED/);
  for (const injected of [{ intent: fixture.ctx.intent }, { transaction: {} }, { value: '0' }, { url: 'https://example.com' }]) {
    await assert.rejects(f.call('inspect_mint', { ...mintArgs, ...injected }), /INVALID_RESEARCH_ARGUMENTS/);
  }
});

test('Mint Hunter and Market Scout deny unequipped, old-owner and changed pins before provider work', async () => {
  for (const slug of ['mint-hunter', 'market-scout']) for (const change of ['unequip', 'owner', 'pins']) {
    const packages = await load(slug, slug === 'market-scout' ? 2 : 1);
    let touched = false;
    const f = runtime(packages, { client: {}, mintContextReader: async () => { touched = true; throw Error('MUST_NOT_READ'); },
      apiKey: 'FIXTURE_ONLY', fetchImpl: async () => { touched = true; throw Error('MUST_NOT_FETCH'); } });
    if (change === 'unequip') f.getState().equipped = [];
    if (change === 'owner') f.getState().owner = OTHER;
    if (change === 'pins') f.getState().equipped[0].definition.instructionHash = `0x${'e'.repeat(64)}`;
    await assert.rejects(f.call(slug === 'mint-hunter' ? 'prepare_mint' : 'get_market_listings', slug === 'mint-hunter' ? mintArgs : { slug: 'peppies', contract: COLLECTION }),
      /SKILL_TOOL_DENIED|OWNER_CHANGED|PACKAGE_HASH_MISMATCH/);
    assert.equal(touched, false);
  }
});

test('registration proposal encodes exact versioned definitions without READY or a broadcast envelope', async () => {
  const { buildResearchRegistrationProposal } = await import('../broker/src/v4/skill-forge/research-registration-proposal.mjs');
  const proposal = await buildResearchRegistrationProposal();
  assert.equal(proposal.transactionSubmitted, false); assert.equal(proposal.productionAuthorized, false);
  assert.equal(proposal.definitions.length, 3);
  for (const definition of proposal.definitions) {
    const decoded = decodeFunctionData({ abi: parseAbi(['function register(uint32,uint16,bytes32,bytes32,bytes32,uint256,uint8) returns(bytes32)']), data: definition.reviewOnlyRegisterCalldata });
    assert.equal(decoded.functionName, 'register'); assert.equal(decoded.args[0], definition.skillId);
    assert.equal(decoded.args[1], definition.version); assert.equal(decoded.args[2], definition.manifestHash);
    assert.equal(decoded.args[3], definition.instructionHash); assert.equal(String(decoded.args[5]), definition.capabilities);
    assert.equal(definition.readyTransitionIncluded, false); assert.equal(definition.runtimeApproved, false);
    assert.equal(definition.initialRegistryStatus, 'DISCOVERED');
    assert.ok(!Object.hasOwn(definition, 'to') && !Object.hasOwn(definition, 'from'));
  }
});

test('Mint Hunter bounds unavailable context and rejects stale simulation heads', async () => {
  const { createMintHunterV1 } = await import('../broker/src/v4/skill-forge/mint-hunter-v1.mjs');
  const hunter = createMintHunterV1({ client: {}, readContext: () => new Promise(() => {}), timeoutMs: 10 });
  await assert.rejects(hunter.inspectMint({ tokenId: '93', owner: OWNER, ...mintArgs }), /MINT_RESEARCH_TIMEOUT/);
  const fixture = mintFixture({ alterClient: c => {
    c.getBlock = async () => ({ number: 100n, hash: HASH, timestamp: BigInt(Math.floor(Date.now() / 1000)) - 35n });
  } });
  const f = runtime(await load('mint-hunter'), fixture);
  await assert.rejects(f.call('prepare_mint', mintArgs), /MINT_ANCHOR_CHANGED/);
});
