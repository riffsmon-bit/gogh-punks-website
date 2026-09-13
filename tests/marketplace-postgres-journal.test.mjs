import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createMarketplaceStore, verifyMarketplaceDatabaseRole } from '../broker/src/v4/marketplace/postgres-journal-store.mjs';
import { createMarketplaceCoordinator } from '../broker/src/v4/marketplace/durable-coordinator.mjs';
import { marketplaceFixture, cas, address, hash } from './fixtures/marketplace-durable.mjs';

const connectionString = process.env.MARKETPLACE_TEST_DATABASE_URL;
test('native PostgreSQL journals races, immutable originals, scope holds, restart recovery and narrow roles', { skip: !connectionString }, async () => {
  const url = new URL(connectionString);
  assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/gogh_marketplace_test'); assert.equal(url.search, '');
  const pool = new pg.Pool({ connectionString, max: 16 });
  const make = (f, store = createMarketplaceStore(pool)) => createMarketplaceCoordinator({ store, release: f.release,
    deps: { client: f.client }, reviewBuilder: async () => structuredClone(f.review), claimValidator: async () => {},
    receiptReconciler: async () => f.receipt });
  const prepare = (coordinator, f) => coordinator.prepare({ owner: f.owner, punkId: f.punkId, input: f.input });
  try {
    const identity = (await pool.query('SELECT current_database() AS name,inet_server_addr()::text AS host')).rows[0];
    assert.equal(identity.name, 'gogh_marketplace_test'); assert.ok(identity.host.startsWith('127.0.0.1'));
    await pool.query(await readFile(new URL('../netlify/database/migrations/20260913210000_stage_marketplace_reviews.sql', import.meta.url), 'utf8'));
    const f = marketplaceFixture(), coordinator = make(f);
    const prepares = await Promise.all(Array.from({ length: 8 }, () => prepare(coordinator, f)));
    assert.equal(new Set(prepares.map(p => p.entry.reviewHash)).size, 1);
    const p = prepares[0];
    const claims = await Promise.all(Array.from({ length: 12 }, () => coordinator.claim(cas(f, p))));
    assert.equal(claims.filter(c => c.walletClaimed).length, 1);
    const c = claims.find(result => result.walletClaimed);
    const store = createMarketplaceStore(pool), stored = await store.get(cas(f, c));
    assert.equal(stored.status, 'WALLET_REQUESTED'); assert.equal(stored.revision, 1);
    await assert.rejects(() => store.update(cas(f, c), { status: 'CANCELLED' }), /MARKETPLACE_INVALID_TRANSITION/);
    await assert.rejects(() => pool.query('DELETE FROM broker_marketplace_reviews WHERE intent_id=$1', [p.entry.intentId]), /DELETE_FORBIDDEN/);
    await assert.rejects(() => pool.query('UPDATE broker_marketplace_reviews SET review_json=review_json||$1,revision=revision+1 WHERE intent_id=$2', [' ', p.entry.intentId]), /IMMUTABLE_REVIEW/);
    assert.equal(await store.get({ ...cas(f, c), owner: address('9') }), null);
    assert.equal(await store.get({ ...cas(f, c), punkId: '94' }), null);

    for (const other of [marketplaceFixture({ owner: address('8') }), marketplaceFixture({ punkId: '94' })]) {
      await assert.rejects(() => prepare(make(other), other), /UNRESOLVED_PURCHASE/);
    }
    // A separate coordinator and database connection pool emulate server-process restart.
    const restartPool = new pg.Pool({ connectionString, max: 8 });
    try {
      const restarted = make(f, createMarketplaceStore(restartPool));
      const results = await Promise.all(Array.from({ length: 8 }, () => restarted.recover({ ...cas(f, c), transactionHash: f.transactionHash })));
      assert.ok(results.every(result => result.transaction === null));
      const completed = await restarted.get(f); assert.equal(completed.entry.status, 'COMPLETED'); assert.equal(completed.entry.revision, 3);
      assert.equal((await restarted.recover({ ...cas(f, completed), transactionHash: f.transactionHash })).entry.revision, 3);
      await assert.rejects(() => store.update(cas(f, completed), { status: 'COMPLETED', reportedHash: hash('e'), receipt: f.receipt }), /INVALID_TRANSITION|HASH_IMMUTABLE/);
      assert.deepEqual((await pool.query('SELECT revision,status FROM broker_marketplace_events WHERE intent_id=$1 ORDER BY revision', [p.entry.intentId])).rows,
        [{ revision: 0, status: 'PREPARED' }, { revision: 1, status: 'WALLET_REQUESTED' }, { revision: 2, status: 'WALLET_REQUESTED' }, { revision: 3, status: 'COMPLETED' }]);
    } finally { await restartPool.end(); }

    // Unknown hashes and alleged rejection remain reserved in SQL, including time expiry.
    const g = marketplaceFixture({ owner: address('8'), punkId: '94' }), cg = make(g), gp = await prepare(cg, g);
    const gc = await cg.claim(cas(g, gp)), gd = await cg.decline(cas(g, gc));
    assert.equal(gd.entry.holdsPurchase, true);
    await assert.rejects(() => cg.cancel(cas(g, gd)), /RESERVED/);
    assert.equal((await cg.recover(cas(g, gd))).entry.reportedHash, null);
    const bound = await store.update(cas(g, gd), { status: 'WALLET_REQUESTED', reportedHash: hash('a') });
    await assert.rejects(() => store.update({ ...cas(g, gd), revision: bound.revision }, { status: 'WALLET_REQUESTED', reportedHash: hash('e') }), /HASH_IMMUTABLE/);

    // DB clock rejects claim even when a server's injected clock is behind.
    const e = marketplaceFixture({ owner: address('7'), punkId: '95', now: Date.now() - 58_500 }), ce = make(e), ep = await prepare(ce, e);
    await new Promise(resolve => setTimeout(resolve, Math.max(1, e.review.expiresAt - Date.now() + 20)));
    await assert.rejects(() => store.update(cas(e, ep), { status: 'WALLET_REQUESTED' }), /REVIEW_EXPIRED/);
    const cancelled = await ce.cancel(cas(e, ep)); assert.equal(cancelled.entry.status, 'CANCELLED');
    e.input.requestId = randomUUID(); e.review.anchor.timestamp = String(Math.floor(Date.now() / 1000));
    e.review.expiresAt = (Number(e.review.anchor.timestamp) + 60) * 1000;
    const newPrepared = await prepare(ce, e); assert.equal(newPrepared.entry.status, 'PREPARED');

    // Migration ships no grants. Only this disposable role gets reviewed test grants.
    await pool.query(`CREATE ROLE marketplace_request_test NOLOGIN;
      GRANT USAGE ON SCHEMA public TO marketplace_request_test;
      GRANT SELECT,INSERT ON broker_marketplace_reviews TO marketplace_request_test;
      GRANT UPDATE(revision,status,reported_hash,receipt,reason) ON broker_marketplace_reviews TO marketplace_request_test;
      CREATE POLICY marketplace_request_test_policy ON broker_marketplace_reviews TO marketplace_request_test USING(true) WITH CHECK(true)`);
    await assert.rejects(() => verifyMarketplaceDatabaseRole(pool), /ROLE_INVALID/);
    const session = await pool.connect();
    try {
      await session.query('SET ROLE marketplace_request_test');
      await verifyMarketplaceDatabaseRole(session);
      await assert.rejects(() => session.query('DELETE FROM broker_marketplace_reviews'), /permission denied/);
      await assert.rejects(() => session.query('TRUNCATE broker_marketplace_reviews'), /permission denied/);
      await assert.rejects(() => session.query('UPDATE broker_marketplace_reviews SET review_json=review_json'), /permission denied/);
      await assert.rejects(() => session.query('INSERT INTO broker_marketplace_events(intent_id,revision,status) VALUES($1,99,$2)', [p.entry.intentId, 'COMPLETED']), /permission denied/);
      assert.equal((await session.query('SELECT count(*)::int AS n FROM broker_marketplace_reviews')).rows[0].n, 4);
      await session.query('CREATE TEMP TABLE broker_marketplace_reviews (LIKE public.broker_marketplace_reviews)');
      await session.query('CREATE TEMP TABLE broker_marketplace_events (intent_id text,revision integer,status text,reported_hash text,receipt jsonb,reason text)');
      // Explicit checked-out-session adapter for this trusted test only. Production
      // supplies a pool so each write owns its full connection/transaction lifetime.
      const scopedStore = createMarketplaceStore({ query: session.query.bind(session),
        connect: async () => ({ query: session.query.bind(session), release() {} }) });
      assert.equal((await scopedStore.get(cas(e, newPrepared))).status, 'PREPARED');
      await scopedStore.update(cas(e, newPrepared), { status: 'CANCELLED', reason: 'OWNER_CANCELLED_UNCLAIMED' });
      assert.equal((await session.query('SELECT count(*)::int AS n FROM pg_temp.broker_marketplace_events')).rows[0].n, 0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.broker_marketplace_events WHERE intent_id=$1', [newPrepared.entry.intentId])).rows[0].n, 2);
    } finally { await session.query('RESET ROLE'); session.release(); }
  } finally { await pool.end(); }
});
