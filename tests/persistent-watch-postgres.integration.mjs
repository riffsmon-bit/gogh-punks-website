// Explicit disposable PostgreSQL only. Production DDL and real concurrent pooled transactions.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';
import { createPersistentWatchStore, assertPersistentWatchStorageScope } from '../broker/src/v4/autonomy/persistent-store.mjs';
import { createPersistentWatchCoordinator } from '../broker/src/v4/autonomy/persistent-coordinator.mjs';
import { PersistentWatchError, evaluatePersistentOpportunity, persistentObservationKey } from '../broker/src/v4/autonomy/persistent-domain.mjs';
import { OWNER, OTHER, hash, watchConfig, anchor, economics, opportunity } from './helpers/persistent-watch-fixture.mjs';
if (process.argv.length !== 4 || process.argv[2] !== '--disposable-only' || !process.argv[3].startsWith('--postgres-bin=/'))
  throw Error('Explicit disposable-only local PostgreSQL binaries are required.');
const bin = process.argv[3].slice('--postgres-bin='.length), base = await mkdtemp(path.join(tmpdir(), 'gogh-watch-sql-'));
const data = path.join(base, 'data'), listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const command = (name, args) => execFileSync(path.join(bin, name), args, { stdio: 'pipe', timeout: 30000 });
const config = { host: '127.0.0.1', port, database: 'postgres', max: 4, connectionTimeoutMillis: 3000, idleTimeoutMillis: 1000 };
let running = false, pool, browser, limited, boundedPool, assertions = 0;
const check = (value, label) => { assert.ok(value, label); assertions++; };
const rejects = async (action, matcher) => { await assert.rejects(action, matcher); assertions++; };
const readMigration = name => readFile(new URL(`../netlify/database/migrations/${name}`, import.meta.url), 'utf8');
try {
  command('initdb', ['-D', data, '-A', 'trust', '-U', 'gogh_watch_admin', '--no-locale']);
  command('pg_ctl', ['-D', data, '-l', path.join(base, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${base} -c shared_buffers=16MB`, '-w', 'start']); running = true;
  pool = new pg.Pool({ ...config, user: 'gogh_watch_admin' });
  await pool.query(await readMigration('20260914050000_add_persistent_watch.sql'));
  const ddl = await readMigration('20260906010000_create_art_broker_v2.sql');
  const start = ddl.indexOf('CREATE TABLE IF NOT EXISTS broker_v2_opportunities ('), end = ddl.indexOf('\n);', start);
  assert.ok(start >= 0 && end > start); await pool.query(ddl.slice(start, end + 3));
  await assertPersistentWatchStorageScope(pool); assertions++;
  const store = createPersistentWatchStore(pool);
  let owner = OWNER, transfers = false, permission = {}, outage = false, at = Date.now();
  const context = () => economics({ sessionExpiresAt: at + 60000, utcDay: new Date(at).toISOString().slice(0, 10), ...permission });
  const readAuthority = async (tokenId, options = {}) => {
    if (outage) throw new PersistentWatchError('WATCH_OWNERSHIP_UNAVAILABLE', 'History unavailable.', 503);
    if (options.expectedOwner && options.expectedOwner !== owner) throw new PersistentWatchError('NOT_CURRENT_OWNER', 'Wrong owner.', 403);
    return anchor({ tokenId, owner, checkedAt: at });
  };
  const readContinuity = async (before, after) => {
    if (transfers || before.owner !== after.owner) throw new PersistentWatchError('WATCH_OWNER_CHANGED', 'Review new ownership.');
    return after;
  };
  const make = useStore => createPersistentWatchCoordinator({ store: useStore ?? store, readAuthority, readContinuity, readEconomics: async () => context(), now: () => at });
  const coordinator = make();
  const prepare = (version, configOverride = {}, punk = '93') => coordinator.prepare({ tokenId: punk, owner, config: watchConfig(configOverride), expectedVersion: version });
  const confirm = draft => coordinator.confirm({ tokenId: draft.tokenId, owner, draftId: draft.draftId });
  const draft = await prepare(0);
  check(await store.get('93') === null, 'Draft/conversational taste does not activate');
  const confirmed = await Promise.all([confirm(draft), confirm(draft)]);
  check(confirmed.filter(x => x.applied).length === 1 && (await store.get('93')).version === 1, 'Concurrent confirmation creates one generation');
  const repeated = await confirm(draft); check(!repeated.applied && repeated.watch.version === 1, 'Original activation retry is idempotent');
  const original = await store.get('93');
  const review = await prepare(1, { likes: ['generative'] });
  check((await store.get('93')).config.likes[0] === 'pixel', 'Taste edits remain unchanged until reviewed confirmation');
  const paused = await coordinator.pause({ tokenId: '93', owner, expectedVersion: 1 });
  check(paused.version === 2 && paused.state === 'PAUSED', 'Pause increments generation');
  await rejects(confirm(review), { code: 'WATCH_VERSION_CHANGED' });
  await rejects(confirm(draft), { code: 'WATCH_DRAFT_EXPIRED' });
  check((await store.get('93')).state === 'PAUSED', 'Superseded used review cannot reactivate paused watch');
  check(await store.claim(original, 'opportunity_123', 'a'.repeat(64), new Date(at).toISOString().slice(0, 10)) === false, 'Snapshot before pause cannot claim afterward');
  const resumed = await confirm(await prepare(2)); check(resumed.watch.version === 3, 'Explicit reactivation creates fresh version');
  const insertOpportunity = async o => pool.query(`INSERT INTO broker_v2_opportunities
    (opportunity_id,dedupe_key,chain_id,collection_contract,mint_contract,adapter_address,mint_stage,normalized,screening_status,simulation_status,risk_score,first_seen_at)
    VALUES($1,$2,4663,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [o.opportunityId, o.dedupeKey, o.collectionContract, o.mintContract, o.adapter, o.mintStage, o, o.screeningStatus, o.simulationStatus, o.riskScore]);
  const first = opportunity(); await insertOpportunity(first);
  const beforeBatch = await store.get('93');
  const batches = await Promise.all([coordinator.batch({ opportunities: [{ opportunityId: first.opportunityId, eligible: false }] }), coordinator.batch({ opportunities: [{ opportunityId: first.opportunityId }] })]);
  check(batches.reduce((sum, x) => sum + x.decisions, 0) === 1, 'Concurrent scheduled ticks finalize only one observation');
  check((await store.summary('93', new Date(at).toISOString().slice(0, 10))).reviewed === 1, 'Summary counts one durable observation');
  check((await make(createPersistentWatchStore(pool)).batch()).decisions === 0, 'Restart and idle tick use shared data without duplicate observation');
  const second = opportunity({ opportunityId: 'opportunity_future', mintStage: 'SECOND', collectionName: 'Future Pixel' });
  await insertOpportunity(second);
  check((await coordinator.batch({ opportunities: [{ opportunityId: second.opportunityId }] })).decisions === 1, 'Active Punk automatically receives future shared opportunity');
  const history = await store.history('93');
  check(history.every(x => x.result.executionAuthorized === false && x.result.transactionSubmitted === false), 'Real stored records never grant economic authority');
  permission = { remainingMints: 0 };
  const empty = await coordinator.current('93', owner);
  check(empty.status.watching && empty.status.state === 'OWNER_ACTION_REQUIRED' && (await store.get('93')).state === 'ACTIVE', 'Finished mint session leaves logical watch active without renewing permission');
  permission = { balanceWei: '1000' };
  check((await coordinator.current('93', owner)).status.state === 'RESERVE_REACHED', 'Reserve exhaustion keeps research available');
  permission = {};
  const pauseDuring = make({ ...store, claim: async (...args) => {
    const claimed = await store.claim(...args); if (claimed) await store.pause('93', owner, args[0].version); return claimed;
  } });
  const third = opportunity({ opportunityId: 'opportunity_pause', mintStage: 'THIRD' }); await insertOpportunity(third);
  check((await pauseDuring.batch({ opportunities: [{ opportunityId: third.opportunityId }] })).decisions === 0, 'Pause between claim and finish suppresses a stale result');
  const cancelled = await pool.query("SELECT status FROM broker_v2_persistent_watch_decisions WHERE opportunity_id=$1", [third.opportunityId]);
  check(cancelled.rows[0].status === 'CANCELLED', 'Interrupted read claim is durably cancelled');
  let live = await store.get('93'); await confirm(await prepare(live.version));
  const transferReview = await prepare((await store.get('93')).version);
  transfers = true;
  await rejects(confirm(transferReview), { code: 'WATCH_OWNER_CHANGED' });
  check((await coordinator.batch()).pausedForTransfer === 1, 'Same-owner away/back continuity event pauses watch');
  check((await store.get('93')).state === 'OWNER_ACTION_REQUIRED', 'Transfer requires explicit reactivation');
  owner = OTHER; transfers = false;
  await rejects(coordinator.pause({ tokenId: '93', owner: OWNER, expectedVersion: (await store.get('93')).version }), { code: 'NOT_CURRENT_OWNER' });
  const inherited = await coordinator.current('93', owner);
  check(inherited.watch.config.likes[0] === 'pixel' && !inherited.status.watching, 'New owner inherits taste but not activation');
  const newOwner = await confirm(await prepare(inherited.watch.version, { likes: ['generative'] }));
  check(newOwner.watch.owner === OTHER && newOwner.watch.config.likes[0] === 'generative', 'New current owner confirms new taste and activation');
  outage = true;
  const failed = await coordinator.batch(); check(failed.unavailable === 1 && failed.decisions === 0, 'RPC outage cannot produce authority or observations'); outage = false;
  await store.assertVersion({ tokenId: '93', owner, watchVersion: newOwner.watch.version }); assertions++;
  await rejects(store.assertVersion({ tokenId: '93', owner: OWNER, watchVersion: newOwner.watch.version }), { code: 'WATCH_VERSION_CHANGED' });
  const key = 'f'.repeat(64), utcDay = new Date(at).toISOString().slice(0, 10);
  await store.claim(newOwner.watch, first.opportunityId, key, utcDay);
  const result = evaluatePersistentOpportunity({ watch: newOwner.watch, opportunity: first, economics: context(), now: at });
  await rejects(pool.query(`UPDATE broker_v2_persistent_watch_decisions SET status='DONE',result=$1 WHERE observation_key=$2`, [{ ...result, executionAuthorized: true }, key]), { code: '23514' });
  await rejects(pool.query(`UPDATE broker_v2_persistent_watch_decisions SET status='DONE',result='{}' WHERE observation_key=$1`, [key]), { code: '23514' });
  await rejects(pool.query(`UPDATE broker_v2_persistent_watch_decisions SET status='DONE',result=$1 WHERE observation_key=$2`, [{ ...result, transactionSubmitted: 'false' }, key]), { code: '23514' });
  await pool.query(`CREATE ROLE watch_browser LOGIN; CREATE ROLE watch_limited LOGIN;
    GRANT USAGE ON SCHEMA public TO watch_browser,watch_limited;
    GRANT SELECT ON broker_v2_persistent_watches,broker_v2_persistent_watch_drafts,broker_v2_persistent_watch_decisions TO watch_limited`);
  browser = new pg.Pool({ ...config, user: 'watch_browser' }); limited = new pg.Pool({ ...config, user: 'watch_limited' });
  await rejects(browser.query('SELECT * FROM broker_v2_persistent_watches'), { code: '42501' });
  await rejects(assertPersistentWatchStorageScope(limited), { code: 'WATCH_STORAGE_UNAVAILABLE' });
  for (const table of ['broker_v2_persistent_watches', 'broker_v2_persistent_watch_drafts', 'broker_v2_persistent_watch_decisions'])
    check((await limited.query(`SELECT * FROM ${table}`)).rows.length === 0, `${table} denies rows even if SELECT is accidentally granted without RLS policy`);
  // Actual expiry is enforced inside the same SQL transaction as claim/finish.
  await pool.query("UPDATE broker_v2_persistent_watches SET config=jsonb_set(config,'{expiresAt}',to_jsonb((now()-interval '1 second')::text)) WHERE token_id='93'");
  check(await store.claim(newOwner.watch, first.opportunityId, 'e'.repeat(64), utcDay) === false, 'Expired watch cannot claim even from a pre-expiry worker snapshot');
  check(!await store.finish(newOwner.watch, key, result), 'Expired watch cannot finalize an existing claim');
  await rejects(store.assertVersion({ tokenId: '93', owner, watchVersion: newOwner.watch.version }), { code: 'WATCH_VERSION_CHANGED' });
  at = Date.now();
  const expiry = await coordinator.current('93', owner); check(!expiry.status.watching && expiry.watch.config.likes[0] === 'generative', 'Expiration preserves inherited taste');
  const expiredHistory = await store.history('93');
  check((await store.active()).length === 0, 'Duration-expired ACTIVE rows are excluded by the database clock');
  const expiredSnapshot = await store.get('93');
  check(expiredSnapshot.state === 'ACTIVE' && expiredSnapshot.version === newOwner.watch.version,
    'Selection does not silently mutate or reactivate the expired watch');
  const indexes = await pool.query("SELECT indexname FROM pg_indexes WHERE tablename='broker_v2_persistent_watches'");
  check(indexes.rows.some(x => x.indexname === 'broker_v2_persistent_active'), 'Bounded fair active index is installed');
  const usedDraft = await prepare(0, {}, '94'), usedWatch = await confirm(usedDraft);
  await coordinator.pause({ tokenId: '94', owner, expectedVersion: usedWatch.watch.version });
  const usedReplay = await confirm(usedDraft);
  check(!usedReplay.applied && usedReplay.watch.state === 'PAUSED', 'An unsuperseded used draft replay returns paused state without activating');
  // Older expired rows must be filtered before LIMIT, so all five worker slots remain useful.
  for (let token = 100; token < 106; token++) await confirm(await prepare(0,
    token === 105 ? { expiresAt: new Date(at + 60000).toISOString() } : {}, String(token)));
  await pool.query(`UPDATE broker_v2_persistent_watches SET last_checked_at=now()
    WHERE token_id::integer BETWEEN 100 AND 105`);
  await pool.query(`INSERT INTO broker_v2_persistent_watches
    (token_id,owner_snapshot,version,state,config,checkpoint_block,checkpoint_hash)
    SELECT n::text,owner_snapshot,version,state,config,checkpoint_block,checkpoint_hash
    FROM broker_v2_persistent_watches CROSS JOIN generate_series(200,204) n WHERE token_id='93'`);
  const selected = await store.active(5);
  check(selected.map(w => w.tokenId).join(',') === '100,101,102,103,104',
    'Expired rows with older NULL checked timestamps consume none of the five slots');
  const ownerReads = [];
  const selectionBatch = createPersistentWatchCoordinator({ store,
    // A skewed worker clock cannot make database-expired configurations eligible again.
    now: () => at - 60000,
    readAuthority: async (...args) => { ownerReads.push(args[0]); return readAuthority(...args); },
    readContinuity, readEconomics: async () => context() });
  check((await selectionBatch.batch({ limit: 5 })).checked === 5, 'Five eligible watches are processed');
  check(ownerReads.join(',') === '100,101,102,103,104', 'No ownership RPC is spent on expired watches');
  check((await store.active(5))[0].tokenId === '105', 'The sixth active watch rotates ahead on the next bounded page');
  const expiredAfter = await coordinator.current('93', owner);
  check(!expiredAfter.status.watching && expiredAfter.watch.version === expiredSnapshot.version
    && expiredAfter.watch.state === expiredSnapshot.state
    && JSON.stringify(expiredAfter.watch.config) === JSON.stringify(expiredSnapshot.config)
    && JSON.stringify(expiredAfter.history) === JSON.stringify(expiredHistory),
  'Excluded expired watch remains visible with its exact saved config, version and history');

  // Use one known pooled backend, so both successful and timed-out transactions prove settings restoration.
  boundedPool = new pg.Pool({ ...config, user: 'gogh_watch_admin', max: 1 });
  const boundedStore = createPersistentWatchStore(boundedPool), timeoutWatch = await store.get('100');
  const settings = async () => (await boundedPool.query(`SELECT pg_backend_pid() AS pid,
    current_setting('statement_timeout') AS statement_timeout,current_setting('lock_timeout') AS lock_timeout`)).rows[0];
  const defaults = await settings();
  await boundedStore.active(5);
  check(JSON.stringify(await settings()) === JSON.stringify(defaults), 'Successful bounded SQL restores the same pooled connection defaults');
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT token_id FROM broker_v2_persistent_watches WHERE token_id='100' FOR UPDATE");
    await rejects(boundedStore.touch(timeoutWatch), { code: '55P03' });
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  check(JSON.stringify(await settings()) === JSON.stringify(defaults), 'Lock timeout rolls back before release without leaking settings or an aborted transaction');
  await boundedStore.touch(timeoutWatch);
  check(Boolean((await store.get('100')).lastCheckedAt), 'The timed-out pooled connection can complete subsequent watch work');
  await pool.query(`CREATE FUNCTION watch_test_slow_touch() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(4); RETURN NEW; END $$;
    CREATE TRIGGER watch_test_slow_touch BEFORE UPDATE ON broker_v2_persistent_watches
    FOR EACH ROW WHEN (OLD.token_id='100') EXECUTE FUNCTION watch_test_slow_touch()`);
  const beforeTimeout = await store.get('100');
  try { await rejects(boundedStore.touch(timeoutWatch), { code: '57014' }); }
  finally { await pool.query('DROP TRIGGER watch_test_slow_touch ON broker_v2_persistent_watches; DROP FUNCTION watch_test_slow_touch()'); }
  check(JSON.stringify(await settings()) === JSON.stringify(defaults), 'Statement timeout restores defaults on the same pooled connection');
  check((await store.get('100')).lastCheckedAt === beforeTimeout.lastCheckedAt, 'Timed-out statement leaves no background or partial touch mutation');
  await boundedStore.touch(timeoutWatch);
  check(JSON.stringify(await settings()) === JSON.stringify(defaults), 'Connection remains usable after the timed-out statement is fully rolled back');
  console.log(JSON.stringify({ status: 'PASS', assertions, engine: 'native PostgreSQL', productionQueries: 0, transactionsSubmitted: 0,
    coverage: ['draft-confirm', 'CAS', 'parallel-retry', 'pause-claim-finish', 'restart', 'future-shared-opportunity', 'transfer-reactivation', 'reserve', 'expiry', 'expired-selection', 'fair-rotation', 'local-SQL-timeouts', 'RLS', 'no-economic-authority'] }));
} finally {
  await Promise.allSettled([pool?.end(), browser?.end(), limited?.end(), boundedPool?.end()]);
  if (running) command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
  await rm(base, { recursive: true, force: true });
}
