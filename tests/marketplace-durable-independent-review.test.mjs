import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import pg from 'pg';

// Independent review checkout override; never read by production code.
const ROOT = process.env.GOGH_MARKETPLACE_REVIEW_ROOT
  ? resolve(process.env.GOGH_MARKETPLACE_REVIEW_ROOT) : fileURLToPath(new URL('../', import.meta.url));
const moduleAt = path => import(pathToFileURL(join(ROOT, path)).href);
const { createMarketplaceCoordinator } = await moduleAt('broker/src/v4/marketplace/durable-coordinator.mjs');
const { reconcileMarketplaceReview } = await moduleAt('broker/src/v4/marketplace/reconcile.mjs');
const { createMarketplaceStore, verifyMarketplaceDatabaseRole } = await moduleAt('broker/src/v4/marketplace/postgres-journal-store.mjs');
const { marketplaceFixture, memoryMarketplaceStore, cas } = await moduleAt('tests/fixtures/marketplace-durable.mjs');
const fixtureCoordinator = (f, store, release = () => f.release) => createMarketplaceCoordinator({ store, release,
  deps: { client: f.client }, reviewBuilder: async () => structuredClone(f.review),
  claimValidator: async () => {}, receiptReconciler: async () => structuredClone(f.receipt) });
const prepare = (coordinator, f) => coordinator.prepare({ owner: f.owner, punkId: f.punkId, input: f.input });
const noPayload = response => {
  assert.equal(response.transaction, null); assert.equal(response.walletClaimed, false);
  assert.equal(response.entry.review.transaction, null);
  assert.doesNotMatch(JSON.stringify(response), /12345678/, 'raw original calldata stays redacted');
};

test('independent: release pause after the committed claim keeps its hold and withholds calldata', async () => {
  const f = marketplaceFixture(), store = memoryMarketplaceStore(), write = store.update;
  const coordinator = fixtureCoordinator(f, store), prepared = await prepare(coordinator, f);
  store.update = async (...args) => {
    const value = await write(...args);
    f.release = { ...f.release, status: 'PAUSED', blockers: ['MARKETPLACE_RELEASE_PAUSED'] };
    return value;
  };
  const claimed = await coordinator.claim(cas(f, prepared));
  noPayload(claimed); assert.equal(claimed.entry.status, 'WALLET_REQUESTED'); assert.equal(claimed.entry.holdsPurchase, true);
  const paused = await coordinator.claim(cas(f, claimed)); noPayload(paused);
  assert.equal(paused.entry.revision, 1);
});

test('independent: lost preparation acknowledgement preserves the original review and blocks a new request ID', async () => {
  const f = marketplaceFixture(), store = memoryMarketplaceStore(), save = store.save;
  const coordinator = fixtureCoordinator(f, store);
  store.save = async record => { await save(record); throw Error('PREPARE_COMMIT_ACK_LOST'); };
  await assert.rejects(() => prepare(coordinator, f), /PREPARE_COMMIT_ACK_LOST/);
  store.save = save;
  const recovered = await prepare(coordinator, f); noPayload(recovered);
  assert.equal(recovered.entry.revision, 0); assert.equal(store.rows.size, 1);
  f.input.requestId = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee';
  await assert.rejects(() => prepare(coordinator, f), /UNRESOLVED_PURCHASE/);
  assert.equal(store.rows.size, 1);
});

test('independent: an unobserved hash cannot poison later recovery of the actual original', async () => {
  const f = marketplaceFixture(), store = memoryMarketplaceStore(), coordinator = fixtureCoordinator(f, store);
  const prepared = await prepare(coordinator, f), claimed = await coordinator.claim(cas(f, prepared));
  const read = f.client.getTransaction;
  f.client.getTransaction = async () => { throw Error('PROVIDER_TIMEOUT_SECRET'); };
  const unknown = await coordinator.recover({ ...cas(f, claimed), transactionHash: `0x${'e'.repeat(64)}` });
  noPayload(unknown); assert.equal(unknown.entry.reportedHash, null);
  assert.doesNotMatch(JSON.stringify(unknown), /PROVIDER_TIMEOUT_SECRET/);
  f.client.getTransaction = read;
  const completed = await coordinator.recover({ ...cas(f, unknown), transactionHash: f.transactionHash });
  noPayload(completed); assert.equal(completed.entry.status, 'COMPLETED'); assert.equal(completed.entry.reportedHash, f.transactionHash);
  assert.equal(completed.entry.revision, 3);
});

for (const kind of ['stable', 'hash_changed', 'number_changed', 'header_unavailable', 'pending_finality']) {
  test(`independent: terminal revert recovery ${kind} preserves exact receipt and hold semantics`, async () => {
    const f = marketplaceFixture(), store = memoryMarketplaceStore();
    let afterHead = false, reads = 0;
    const blockHash = `0x${'b'.repeat(64)}`;
    f.client.getTransaction = async () => ({ ...f.actual, blockNumber: 12n, blockHash });
    f.client.getTransactionReceipt = async () => ({ transactionHash: f.transactionHash, from: f.owner, to: f.review.wallet,
      blockNumber: 12n, blockHash, status: 'reverted', gasUsed: 21000n, effectiveGasPrice: 10n });
    f.client.getBlock = async () => {
      reads++;
      if (afterHead && kind === 'header_unavailable') throw Error('SECOND_HEADER_UNAVAILABLE_SECRET');
      return { number: afterHead && kind === 'number_changed' ? 13n : 12n,
        hash: afterHead && kind === 'hash_changed' ? `0x${'c'.repeat(64)}` : blockHash };
    };
    f.client.getBlockNumber = async () => { afterHead = true; return kind === 'pending_finality' ? 12n : 23n; };
    const coordinator = createMarketplaceCoordinator({ store, release: f.release, deps: { client: f.client },
      reviewBuilder: async () => structuredClone(f.review), claimValidator: async () => {}, receiptReconciler: reconcileMarketplaceReview });
    const prepared = await prepare(coordinator, f), claimed = await coordinator.claim(cas(f, prepared));
    const recovered = await coordinator.recover({ ...cas(f, claimed), transactionHash: f.transactionHash });
    noPayload(recovered);
    assert.equal(recovered.entry.reportedHash, f.transactionHash);
    assert.equal(recovered.entry.status, kind === 'stable' ? 'REVERTED' : 'WALLET_REQUESTED');
    assert.equal(recovered.entry.holdsPurchase, kind !== 'stable');
    assert.ok(reads >= (kind === 'pending_finality' ? 1 : 2), 'terminal receipt interpretation rechecks the canonical header after finality reads');
    assert.doesNotMatch(JSON.stringify(recovered), /SECOND_HEADER_UNAVAILABLE_SECRET/);
    if (kind !== 'stable') {
      assert.equal(recovered.entry.receipt, null);
      assert.ok(recovered.blockers.includes(kind === 'pending_finality'
        ? 'MARKETPLACE_PENDING_FINALITY' : 'MARKETPLACE_ORIGINAL_RECEIPT_UNVERIFIED'));
    } else {
      assert.equal(recovered.entry.receipt.blockHash, blockHash);
      assert.equal(recovered.entry.receipt.blockNumber, '12');
    }
  });
}

// Opt-in because this test owns a real native PostgreSQL cluster. The helper has
// no external DSN mode and removes only the fresh directory it created.
test('independent native: actual journal writes force durable commits and reject unsafe engine/storage settings',
  { skip: process.env.GOGH_MARKETPLACE_INDEPENDENT_NATIVE !== '1' }, async () => {
    const { withOwnedMarketplacePostgres } = await moduleAt('scripts/dev/marketplace/owned-postgres.mjs');
    await withOwnedMarketplacePostgres(async ({ pool: admin, connectionString }) => {
      await admin.query(await readFile(join(ROOT, 'netlify/database/migrations/20260913210000_stage_marketplace_reviews.sql'), 'utf8'));
      await admin.query(`CREATE ROLE independent_market_request LOGIN;
        GRANT USAGE ON SCHEMA public TO independent_market_request;
        GRANT SELECT,INSERT ON public.broker_marketplace_reviews TO independent_market_request;
        GRANT UPDATE(revision,status,reported_hash,receipt,reason) ON public.broker_marketplace_reviews TO independent_market_request;
        CREATE POLICY independent_market_request_policy ON public.broker_marketplace_reviews TO independent_market_request USING(true) WITH CHECK(true);
        CREATE TABLE public.independent_sync_observations(status text, setting text);
        CREATE FUNCTION public.independent_sync_probe() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
          BEGIN INSERT INTO public.independent_sync_observations VALUES(NEW.status,current_setting('synchronous_commit')); RETURN NEW; END $$;
        CREATE TRIGGER independent_sync_probe AFTER INSERT OR UPDATE ON public.broker_marketplace_reviews
          FOR EACH ROW EXECUTE FUNCTION public.independent_sync_probe();`);
      const credentials = new URL(connectionString); credentials.username = 'independent_market_request';
      let pool = new pg.Pool({ connectionString: credentials.href, max: 1 });
      // The owned-cluster restart replaces only this test pool; each mutation still
      // checks out and validates its one real connection through the same store.
      const requestPool = { query: (...args) => pool.query(...args), connect: () => pool.connect() };
      const store = createMarketplaceStore(requestPool), f = marketplaceFixture(), coordinator = fixtureCoordinator(f, store);
      const data = (await admin.query('SHOW data_directory')).rows[0].data_directory;
      assert.match(data, /^\/private\/tmp\/gogh-marketplace-pg-[A-Za-z0-9]+\/data$/);
      const engine = { fsync: 'on', full_page_writes: 'on' };
      const execute = promisify(execFile);
      try {
        await verifyMarketplaceDatabaseRole(pool);
        // Change configuration AFTER verification. A startup-only check cannot protect this write.
        await pool.query('SET synchronous_commit=off');
        const prepared = await prepare(coordinator, f);
        assert.equal((await pool.query('SHOW synchronous_commit')).rows[0].synchronous_commit, 'off', 'LOCAL enforcement must not leak session state');
        const claimed = await coordinator.claim(cas(f, prepared));
        assert.equal(claimed.walletClaimed, true);
        assert.deepEqual((await admin.query('SELECT status,setting FROM public.independent_sync_observations ORDER BY ctid')).rows,
          [{ status: 'PREPARED', setting: 'on' }, { status: 'WALLET_REQUESTED', setting: 'on' }]);
        assert.equal((await pool.query('SHOW synchronous_commit')).rows[0].synchronous_commit, 'off');
        const count = async () => (await admin.query('SELECT count(*)::int AS n FROM public.broker_marketplace_events')).rows[0].n;
        const revision = claimed.entry.revision;
        const unsafeMutation = () => store.update(cas(f, claimed), { status: 'WALLET_REQUESTED', reason: 'INDEPENDENT_UNSAFE_ATTEMPT' });
        async function engineSetting(name, value) {
          assert.ok(['fsync', 'full_page_writes'].includes(name)); assert.ok(['on', 'off'].includes(value));
          // The helper starts with explicit command-line settings, which override
          // ALTER SYSTEM. Restart only this helper-owned cluster with the requested
          // settings; never address any existing database or practice process.
          engine[name] = value;
          await pool.end();
          await execute('/private/tmp/gogh-postgres-native/bin/pg_ctl', ['-D', data,
            '-l', join(dirname(data), 'postgres.log'), '-m', 'fast', '-w', '-o',
            `-h 127.0.0.1 -p ${credentials.port} -k ${dirname(data)} -c synchronous_commit=on -c fsync=${engine.fsync} -c full_page_writes=${engine.full_page_writes}`,
            'restart']);
          pool = new pg.Pool({ connectionString: credentials.href, max: 1 });
          await pool.query('SET synchronous_commit=off');
          assert.equal((await pool.query(`SHOW ${name}`)).rows[0][name], value);

        }
        for (const name of ['fsync', 'full_page_writes']) {
          await engineSetting(name, 'off');
          try {
            await assert.rejects(unsafeMutation, /MARKETPLACE_.*(DURAB|STOR|DATABASE)/);
            assert.equal((await store.get(cas(f, claimed))).revision, revision);
            assert.equal(await count(), 2);
          } finally { await engineSetting(name, 'on'); }
        }
        await admin.query('ALTER TABLE public.broker_marketplace_events SET UNLOGGED');
        try {
          await assert.rejects(unsafeMutation, /MARKETPLACE_.*(DURAB|STOR|DATABASE)/);
          assert.equal((await store.get(cas(f, claimed))).revision, revision);
          assert.equal(await count(), 2);
        } finally { await admin.query('ALTER TABLE public.broker_marketplace_events SET LOGGED'); }
        const completed = await coordinator.recover({ ...cas(f, claimed), transactionHash: f.transactionHash });
        noPayload(completed); assert.equal(completed.entry.status, 'COMPLETED');
        assert.equal((await pool.query('SHOW synchronous_commit')).rows[0].synchronous_commit, 'off');
      } finally { await pool.end(); }
    });
  });
