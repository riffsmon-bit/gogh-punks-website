import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeEventTopics, parseAbiItem } from 'viem';
import { normalizePersistentConfig, persistentStatus, evaluatePersistentOpportunity, persistentObservationKey } from '../broker/src/v4/autonomy/persistent-domain.mjs';
import { readPersistentOwnership, assertPersistentContinuity } from '../broker/src/v4/autonomy/persistent-ownership.mjs';
import { createPersistentWatchController, persistentEthToWei, persistentWeiToEth } from '../site/broker-persistent-watch.js';
import { handleV2PersistentWatch } from '../netlify/functions/broker-v2-persistent-watch.mjs';
import { createPersistentWatchRuntime, runPersistentWatchBatch } from '../netlify/functions/_shared/v2-persistent-watch-runtime.mjs';
import { PublicError } from '../netlify/functions/_shared/http.mjs';
import { mintResearchFixture } from './helpers/mint-research-context-fixture.mjs';
import { OWNER, OTHER, COLLECTION, NOW, hash, watchConfig, anchor, watch, economics, opportunity, browserIdentity } from './helpers/persistent-watch-fixture.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('Persistent config is exact, bounded and keeps taste apart from wallet authority', () => {
  assert.deepEqual(normalizePersistentConfig(watchConfig({ likes: ['Pixel', 'pixel', 'Generative'] }), NOW).likes, ['generative', 'pixel']);
  for (const patch of [{ signAnything: true }, { likes: ['pixel'], dislikes: ['pixel'] }, { freeOnly: true, maxMintPriceWei: '1' },
    { dailyCollectionLimit: 0 }, { dailyCollectionLimit: 21 }, { maxGasWei: '-1' }, { reserveWei: 100 }, { maximumSupply: -1 },
    { expiresAt: new Date(NOW - 1).toISOString() }, { expiresAt: new Date(NOW + 367 * 86400000).toISOString() }])
    assert.throws(() => normalizePersistentConfig(watchConfig(patch), NOW));
  assert.equal(normalizePersistentConfig(watchConfig(), NOW).expiresAt, null);
});
test('Finite permission exhaustion preserves logical watching and never renews authority', () => {
  for (const e of [{ sessionActive: false }, { remainingMints: 0 }, { remainingMints: undefined },
    { sessionExpiresAt: NOW }, { sessionExpiresAt: undefined }]) {
    const s = persistentStatus(watch(), economics(e), NOW);
    assert.equal(s.watching, true); assert.equal(s.state, 'OWNER_ACTION_REQUIRED'); assert.equal(s.executionAuthorized, false);
  }
  assert.equal(persistentStatus(watch(), economics(), NOW).state, 'WATCHING');
  assert.equal(persistentStatus(watch(), economics({ collectedToday: 3 }), NOW).state, 'BUDGET_EXHAUSTED');
  assert.equal(persistentStatus(watch(), economics({ balanceWei: '1000' }), NOW).state, 'RESERVE_REACHED');
  assert.equal(persistentStatus(watch(), {}, NOW).state, 'SAFETY_BLOCKED');
  assert.equal(persistentStatus(watch({ state: 'PAUSED' }), economics(), NOW).watching, false);
  assert.equal(persistentStatus(watch({ config: watchConfig({ expiresAt: new Date(NOW - 1).toISOString() }) }), economics(), NOW).watching, false);
});
test('Candidate observations enforce research limits and never substitute for screening/simulation/execution', () => {
  const decide = (o = {}, e = {}, w = {}) => evaluatePersistentOpportunity({ watch: watch(w), opportunity: opportunity(o), economics: economics(e), now: NOW });
  assert.equal(decide().result, 'CANDIDATE');
  for (const [o, e, reason] of [[{ artStyles: ['anime'] }, {}, 'EXCLUDED_STYLE'], [{ supply: 3000 }, {}, 'SUPPLY_OUTSIDE_RULES'],
    [{ priceWei: '1' }, {}, 'MINT_PRICE_LIMIT'], [{ website: null }, {}, 'WEBSITE_REQUIRED'],
    [{ estimatedGasCostWei: '0' }, {}, 'GAS_REVIEW_REQUIRED'], [{ riskLevel: 'HIGH' }, {}, 'SECURITY_SCREEN_REQUIRED'],
    [{ unexpectedApprovals: true }, {}, 'SECURITY_SCREEN_REQUIRED'], [{ screeningStatus: 'BLOCKED' }, {}, 'SECURITY_SCREEN_REQUIRED'],
    [{ simulationStatus: 'FAILED' }, {}, 'SIMULATION_FAILED'], [{}, { mintHunterEquipped: false }, 'EQUIPPED_MINT_HUNTER_REQUIRED'],
    [{}, { collectedToday: 3 }, 'DAILY_COLLECTION_LIMIT'], [{}, { collectedToday: -1 }, 'DAILY_COLLECTION_LIMIT'],
    [{}, { spentTodayWei: '999' }, 'DAILY_SPEND_LIMIT'], [{}, { utcDay: '2026-09-13' }, 'DAILY_USAGE_UNVERIFIED'],
    [{}, { pendingSpendWei: '9999' }, 'AVAILABLE_BUDGET_LIMIT'], [{}, { globalExecutionPaused: true }, 'EXECUTION_RELEASE_BLOCKED'],
    [{}, { verified: false }, 'WATCH_PERMISSION_UNVERIFIED']]) {
    const result = decide(o, e); assert.ok(result.reasons.includes(reason), reason);
    assert.equal(result.executionAuthorized, false); assert.equal(result.transactionPrepared, false); assert.equal(result.transactionSubmitted, false);
  }
  assert.ok(decide({}, {}, { state: 'PAUSED' }).reasons.includes('WATCH_PAUSED'));
  assert.ok(decide({ priceWei: '1' }, {}, { config: watchConfig({ freeOnly: false, maxMintPriceWei: '10' }) }).reasons.includes('EQUIPPED_PAID_MINT_LICENSE_REQUIRED'));
});
test('Observation idempotency changes only for meaningful research/day/window/strategy changes', () => {
  const w = watch(), o = opportunity(), key = persistentObservationKey(w, o, NOW);
  assert.equal(key, persistentObservationKey(w, opportunity({ updatedAt: new Date(NOW + 1000).toISOString() }), NOW + 1000));
  assert.notEqual(key, persistentObservationKey(watch({ version: 2 }), o, NOW));
  assert.notEqual(key, persistentObservationKey(w, o, NOW + 86400000));
  assert.notEqual(key, persistentObservationKey(w, opportunity({ priceWei: '1' }), NOW));
  const opening = opportunity({ startTime: new Date(NOW + 1000).toISOString() });
  assert.notEqual(persistentObservationKey(w, opening, NOW), persistentObservationKey(w, opening, NOW + 1001));
});
function chain(overrides = {}) {
  return { getChainId: async () => 4663, getBlock: async ({ blockNumber = 101n }) => ({ number: blockNumber, hash: hash(blockNumber), timestamp: BigInt(NOW / 1000) }),
    readContract: async () => OWNER, request: async () => [], ...overrides };
}
test('Fresh ownerOf uses one pinned block and rejects wrong chain/current owner/stale block', async () => {
  let pinned;
  const actual = await readPersistentOwnership({ client: chain({ readContract: async query => { pinned = query.blockNumber; return OWNER; } }), tokenId: '93', expectedOwner: OWNER, now: () => NOW });
  assert.equal(pinned, 101n); assert.equal(actual.blockNumber, '101');
  await assert.rejects(readPersistentOwnership({ client: chain(), tokenId: '93', expectedOwner: OTHER, now: () => NOW }), { code: 'NOT_CURRENT_OWNER' });
  for (const client of [chain({ getChainId: async () => 1 }), chain({ getBlock: async () => ({ number: 101n, hash: hash(101), timestamp: 1n }) })])
    await assert.rejects(readPersistentOwnership({ client, tokenId: '93', now: () => NOW }), { code: 'WATCH_OWNERSHIP_UNAVAILABLE' });
});
test('Logical continuity rejects self-transfer and same-transaction away/back even with identical current owner', async () => {
  const abi = [parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)')];
  const log = to => ({ address: COLLECTION, removed: false, blockNumber: '0x65', blockHash: hash(101), data: '0x',
    topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: OWNER, to, tokenId: 93n } }) });
  const before = anchor(), after = anchor({ blockNumber: '101', blockHash: hash(101) });
  assert.equal(await assertPersistentContinuity({ client: chain(), before, after, now: () => NOW }), after);
  for (const logs of [[log(OWNER)], [log(OTHER), log(OWNER)]]) await assert.rejects(assertPersistentContinuity({ client: chain({ request: async () => logs }), before, after, now: () => NOW }), { code: 'WATCH_OWNER_CHANGED' });
  await assert.rejects(assertPersistentContinuity({ client: chain(), before, after: { ...after, owner: OTHER }, now: () => NOW }), { code: 'WATCH_OWNER_CHANGED' });
});
test('History never accepts unavailable, malformed, stale, truncated or reorg evidence as empty', async () => {
  const before = anchor(), after = anchor({ blockNumber: '101', blockHash: hash(101) });
  for (const logs of [null, {}, [null], new Array(1), Object.assign([], { incomplete: true })])
    await assert.rejects(assertPersistentContinuity({ client: chain({ request: async () => logs }), before, after, now: () => NOW }), { code: 'WATCH_OWNERSHIP_UNAVAILABLE' });
  for (const badAfter of [{ ...after, checkedAt: undefined }, { ...after, checkedAt: NOW - 31000 }, { ...after, blockNumber: '50000' }])
    await assert.rejects(assertPersistentContinuity({ client: chain(), before, after: badAfter, now: () => NOW }), { code: 'WATCH_OWNERSHIP_UNAVAILABLE' });
  await assert.rejects(assertPersistentContinuity({ client: chain({ getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: hash(999) }) }), before, after, now: () => NOW }), { code: 'WATCH_OWNERSHIP_UNAVAILABLE' });
});
test('Browser ignores stale A→B→A responses, chain switch and destroyed callbacks', async () => {
  const pending = deferred(), controller = createPersistentWatchController({ request: async () => pending.promise });
  controller.setIdentity(browserIdentity()); const old = controller.refresh();
  controller.setIdentity(browserIdentity({ tokenId: '94' })); controller.setIdentity(browserIdentity());
  pending.resolve({ ok: true, tokenId: '93', watch: watch() }); await old;
  assert.equal(controller.getState().data, null);
  controller.setIdentity(browserIdentity({ chainId: 1 })); assert.equal(await controller.refresh(), false);
  controller.destroy(); assert.equal(await controller.refresh(), false);
});
test('Browser requires explicit confirmation, suppresses double request and clears draft on wallet switch', async () => {
  const calls = [], pending = deferred();
  const controller = createPersistentWatchController({ request: async (_, { body }) => {
    calls.push(body); if (!body) return { ok: true, tokenId: '93', watch: watch() };
    if (body.action === 'prepare') return { ok: true, tokenId: '93', draft: { draftId: 'review', config: body.config } };
    return pending.promise;
  } });
  controller.setIdentity(browserIdentity()); await controller.refresh(); await controller.prepare(watchConfig());
  assert.equal(calls.length, 2); assert.equal(calls[1].expectedVersion, 1);
  const confirming = controller.confirm(); assert.equal(await controller.confirm(), false);
  controller.setIdentity(browserIdentity({ owner: OTHER, sessionVersion: 2 }));
  pending.resolve({ ok: true, tokenId: '93', watch: watch() }); await confirming;
  assert.equal(controller.getState().draft, null); assert.equal(controller.getState().data, null);
});
test('ETH input preserves exact decimals and rejects exponent/negative/rounding', () => {
  assert.equal(persistentEthToWei('0.000000000000000001'), '1'); assert.equal(persistentWeiToEth('1000000000000000001'), '1.000000000000000001');
  for (const value of ['1e-3', '-1', '.1', '0.0000000000000000001', 'Infinity']) assert.throws(() => persistentEthToWei(value));
});
test('Authenticated endpoint requires explicit feature flag, origin and exact request shapes', async t => {
  const previousSite = process.env.SITE_URL; process.env.SITE_URL = 'https://goghpunks.xyz';
  t.after(() => { if (previousSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previousSite; });
  let calls = 0;
  const options = { pool: {}, environment: { GOGH_V2_PERSISTENT_WATCH_ENABLED: 'true' }, requireSession: async () => ({ walletAddress: OWNER }),
    runtime: { coordinator: { current: async () => { calls++; return { watch: watch() }; }, prepare: async () => { calls++; return {}; } } } };
  const req = (body, origin = 'https://goghpunks.xyz') => new Request('https://goghpunks.xyz/api/v2/punks/93/persistent-watch', {
    method: body === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await handleV2PersistentWatch(req(), options)).status, 200);
  assert.equal((await handleV2PersistentWatch(req(), { ...options, environment: {} })).status, 503);
  assert.equal((await handleV2PersistentWatch(req(), { ...options, requireSession: async () => { throw new PublicError(401, 'UNAUTHORIZED', 'Connect your wallet.'); } })).status, 401);
  for (const body of [null, [], { action: 'prepare', config: watchConfig(), expectedVersion: 0, rawCall: '0x' }, { action: 'confirm', draftId: 'invalid' }, { action: 'pause', expectedVersion: 0 }])
    assert.equal((await handleV2PersistentWatch(req(body), options)).status, 400);
  assert.equal((await handleV2PersistentWatch(req({ action: 'prepare', config: watchConfig(), expectedVersion: 0 }, 'https://evil.example'), options)).status, 403);
  assert.equal(calls, 1);
});
test('Shared watch integration remains disabled unless explicitly configured', async () => {
  let called = false;
  const runtime = { coordinator: { batch: async input => { called = true; return input; } } };
  assert.equal((await runPersistentWatchBatch({ runtime, environment: {} })).status, 'DISABLED'); assert.equal(called, false);
  const summaries = [{ opportunityId: 'opportunity_123', eligible: false }];
  assert.deepEqual((await runPersistentWatchBatch({ runtime, opportunities: summaries, environment: { GOGH_V2_PERSISTENT_WATCH_ENABLED: 'true' } })).opportunities, summaries);
});

test('Runtime verifies exact deployed Agent code and pins balance/session reads without extending permissions', async () => {
  const f = mintResearchFixture(), at = +f.time;
  const pool = { query: async sql => sql.includes('row_security_active') ? { rows: [{ tables: 3, complete: true }] }
    : sql.includes('FROM broker_v2_persistent_watches') ? { rows: [] } : Promise.reject(Error('unexpected SQL')) };
  const runtime = createPersistentWatchRuntime({ pool, client: f.client, now: () => at, readSkills: async () => null });
  const result = await runtime.coordinator.current('93', f.owner);
  assert.equal(result.permission.verified, true); assert.equal(result.permission.sessionActive, false);
  assert.equal(result.permission.executionAuthorized, false);
  assert.ok(f.calls.filter(([type]) => ['read', 'balance', 'code'].includes(type)).every(([, query]) => query.blockNumber === 100n));
  f.code.implementation = '0x6000';
  assert.equal((await runtime.coordinator.current('93', f.owner)).permission.verified, false);
});
test('Runtime refuses RLS-filtered storage and late skill responses instead of assuming empty/verified state', async () => {
  const f = mintResearchFixture(); let at = +f.time;
  const filtered = createPersistentWatchRuntime({ pool: { query: async () => ({ rows: [{ tables: 3, complete: false }] }) },
    client: f.client, now: () => at, readSkills: async () => null });
  await assert.rejects(filtered.coordinator.current('93', f.owner), { code: 'WATCH_STORAGE_UNAVAILABLE' });
  const pool = { query: async sql => sql.includes('row_security_active') ? { rows: [{ tables: 3, complete: true }] } : { rows: [] } };
  const delayed = createPersistentWatchRuntime({ pool, client: f.client, now: () => at,
    readSkills: async () => { at += 31000; return { effectiveMcpTools: ['prepare_mint'] }; } });
  assert.equal((await delayed.coordinator.current('93', f.owner)).permission.verified, false);
});

test('Shared research skips malformed feed rows and stops before new work when its batch budget expires', async () => {
  const { createPersistentWatchCoordinator } = await import('../broker/src/v4/autonomy/persistent-coordinator.mjs');
  let at = NOW, claims = 0;
  const store = { opportunities: async () => [{ malformed: true }, opportunity()], active: async () => [watch()],
    checkpoint: async w => w, claim: async () => { claims++; return true; } };
  const coordinator = createPersistentWatchCoordinator({ store, now: () => at,
    readAuthority: async () => { at += 1100; return anchor(); }, readContinuity: async () => {}, readEconomics: async () => economics() });
  const result = await coordinator.batch({ maxDurationMs: 1000 });
  assert.equal(result.invalidOpportunities, 1); assert.equal(result.opportunities, 1);
  assert.equal(result.status, 'PARTIAL'); assert.equal(claims, 0); assert.equal(result.transactionSubmitted, false);
});
test('A missing economics/AI dependency still permits research but cannot broaden authority', async () => {
  const { createPersistentWatchCoordinator } = await import('../broker/src/v4/autonomy/persistent-coordinator.mjs');
  let saved;
  const store = { opportunities: async () => [opportunity()], active: async () => [watch()], checkpoint: async w => w,
    claim: async () => true, finish: async (_, __, result) => { saved = result; return true; } };
  const coordinator = createPersistentWatchCoordinator({ store, now: () => NOW, readAuthority: async () => anchor(),
    readContinuity: async () => {}, readEconomics: async () => { throw Error('provider unavailable'); } });
  assert.equal((await coordinator.batch()).decisions, 1);
  assert.ok(saved.reasons.includes('WATCH_PERMISSION_UNVERIFIED')); assert.ok(saved.reasons.includes('EXECUTION_RELEASE_BLOCKED'));
  assert.equal(saved.executionAuthorized, false); assert.equal(saved.transactionPrepared, false);
});

test('A history outage preserves a current holder recovery path without claiming the watch is continuous', async () => {
  const { createPersistentWatchCoordinator } = await import('../broker/src/v4/autonomy/persistent-coordinator.mjs');
  const store = { get: async () => watch(), history: async () => [], summary: async () => ({ reviewed: 0, matched: 0, passed: 0 }) };
  const coordinator = createPersistentWatchCoordinator({ store, now: () => NOW, readAuthority: async () => anchor(),
    readContinuity: async () => { throw Error('unavailable'); }, readEconomics: async () => economics() });
  const current = await coordinator.current('93', OWNER);
  assert.equal(current.watch.version, 1); assert.deepEqual(current.watch.config.likes, ['pixel']);
  assert.equal(current.status.watching, false); assert.equal(current.status.state, 'SAFETY_BLOCKED');
  assert.equal(current.status.action, 'REVIEW'); assert.equal(current.status.executionAuthorized, false);
});
