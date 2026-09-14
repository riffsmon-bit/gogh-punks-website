import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketplaceStore } from '../broker/src/v4/marketplace/postgres-journal-store.mjs';
import { marketplaceIntentId } from '../broker/src/v4/marketplace/durable-journal.mjs';
import { createMarketplaceCoordinator } from '../broker/src/v4/marketplace/durable-coordinator.mjs';
import { marketplaceFixture, cas } from './fixtures/marketplace-durable.mjs';

// SQL protocol fault injection complements the real restricted-role PostgreSQL
// tests: transport can lose a COMMIT acknowledgement after the server commits.
function connectionFixture(options = {}) {
  let persisted = null, pending = null, sync = 'off', checks = 0;
  const events = [], releases = [];
  const pool = {
    query: async sql => {
      assert.match(sql, /^SELECT \* FROM public\.broker_marketplace_reviews/);
      return { rows: persisted ? [structuredClone(persisted)] : [] };
    },
    connect: async () => ({
      async query(sql, params) {
        const command = sql.split(/\s+/)[0]; events.push(command);
        if (sql === 'BEGIN') { pending = structuredClone(persisted); checks = 0; }
        else if (sql === 'SET LOCAL synchronous_commit=on') sync = 'on';
        else if (sql.startsWith('SELECT current_setting')) {
          checks++;
          return { rows: [{ synchronous_commit: sync, fsync: 'on', full_page_writes: 'on', permanent_tables: true,
            ...options.settings?.(checks) }] };
        } else if (command === 'INSERT') {
          assert.equal(sync, 'on', 'actual insert must run with synchronous commit enabled');
          pending = { intent_id: params[0], owner_address: params[1], punk_id: params[2], chain_id: params[3],
            expires_at_ms: params[4], review_json: params[5], review_hash: params[6], revision: 0,
            status: 'PREPARED', reported_hash: null, receipt: null, reason: null };
          return { rows: [{ ...pending, ...options.corruptRow }] };
        } else if (command === 'UPDATE') {
          assert.equal(sync, 'on', 'actual CAS must run with synchronous commit enabled');
          if (!pending || pending.revision !== params[4]) return { rows: [] };
          pending = { ...pending, revision: pending.revision + 1, status: params[6], reported_hash: params[7],
            receipt: params[8], reason: params[9] };
          return { rows: [structuredClone(pending)] };
        } else if (sql === 'COMMIT') {
          await options.beforeCommit?.(pending);
          persisted = pending; pending = null; sync = 'off';
          if (options.loseAcknowledgement?.(persisted)) throw Error('COMMIT_ACKNOWLEDGEMENT_LOST');
        } else if (sql === 'ROLLBACK') {
          pending = null; sync = 'off';
          if (options.rollbackError) throw Error('ROLLBACK_FAILED');
        } else throw Error(`Unexpected test SQL: ${command}`);
        return { rows: [] };
      },
      release() { releases.push(sync); events.push('RELEASE'); },
    }),
  };
  const f = marketplaceFixture();
  const record = { intentId: marketplaceIntentId(f, f.input), releaseHash: 'f'.repeat(64), input: f.input, review: f.review };
  return { pool, f, record, events, releases, read: () => persisted };
}

test('insert and CAS own one connection, force LOCAL on, and restore inherited session settings', async () => {
  const h = connectionFixture(), store = createMarketplaceStore(h.pool);
  const prepared = await store.save(h.record);
  const claimed = await store.update({ ...h.f, intentId: h.record.intentId, reviewHash: prepared.reviewHash, revision: 0 }, { status: 'WALLET_REQUESTED' });
  assert.equal(claimed.status, 'WALLET_REQUESTED');
  assert.deepEqual(h.events, ['BEGIN', 'SET', 'SELECT', 'INSERT', 'SELECT', 'COMMIT', 'RELEASE',
    'BEGIN', 'SET', 'SELECT', 'UPDATE', 'SELECT', 'COMMIT', 'RELEASE']);
  assert.deepEqual(h.releases, ['off', 'off']);
});

test('no persistence result or connection release precedes acknowledged COMMIT', async () => {
  let unblock, reachedCommit;
  const gate = new Promise(resolve => { unblock = resolve; });
  const reached = new Promise(resolve => { reachedCommit = resolve; });
  const h = connectionFixture({ beforeCommit: async () => { reachedCommit(); await gate; } });
  let returned = false;
  const saving = createMarketplaceStore(h.pool).save(h.record).then(value => { returned = true; return value; });
  await reached;
  assert.equal(returned, false); assert.equal(h.read(), null); assert.equal(h.releases.length, 0);
  unblock(); assert.equal((await saving).status, 'PREPARED'); assert.equal(h.releases.length, 1);
});

test('lost claim COMMIT acknowledgement withholds wallet payload and retry preserves reservation', async () => {
  const h = connectionFixture({ loseAcknowledgement: row => row?.status === 'WALLET_REQUESTED', rollbackError: true });
  const coordinator = createMarketplaceCoordinator({ store: createMarketplaceStore(h.pool), release: h.f.release,
    deps: { client: h.f.client }, reviewBuilder: async () => structuredClone(h.f.review), claimValidator: async () => {} });
  const prepared = await coordinator.prepare({ ...h.f, input: h.f.input });
  await assert.rejects(() => coordinator.claim(cas(h.f, prepared)), /COMMIT_ACKNOWLEDGEMENT_LOST/);
  assert.equal(h.read().status, 'WALLET_REQUESTED'); assert.equal(h.read().revision, 1);
  const repeated = await coordinator.claim(cas(h.f, prepared));
  assert.equal(repeated.walletClaimed, false); assert.equal(repeated.transaction, null);
  assert.equal(repeated.entry.holdsPurchase, true); assert.equal(repeated.entry.reportedHash, null);
  assert.equal(h.events.filter(event => event === 'UPDATE').length, 1);
  assert.deepEqual(h.releases, ['off', 'off']);
});

for (const [name, settings] of Object.entries({ fsync: { fsync: 'off' }, fullPageWrites: { full_page_writes: 'off' },
  transientRelation: { permanent_tables: false }, ignoredLocalSetting: { synchronous_commit: 'off' } })) {
  test(`unsafe ${name} fails before any mutation`, async () => {
    const h = connectionFixture({ settings: () => settings });
    await assert.rejects(() => createMarketplaceStore(h.pool).save(h.record), /MARKETPLACE_DATABASE_DURABILITY_REQUIRED/);
    assert.equal(h.read(), null); assert.equal(h.events.includes('INSERT'), false);
    assert.deepEqual(h.events.slice(-2), ['ROLLBACK', 'RELEASE']);
  });
}

test('durability lost after insert is rejected and rolled back before commit', async () => {
  const h = connectionFixture({ settings: count => count === 2 ? { permanent_tables: false } : {} });
  await assert.rejects(() => createMarketplaceStore(h.pool).save(h.record), /MARKETPLACE_DATABASE_DURABILITY_REQUIRED/);
  assert.equal(h.read(), null); assert.equal(h.events.includes('INSERT'), true); assert.equal(h.events.includes('COMMIT'), false);
  assert.deepEqual(h.events.slice(-2), ['ROLLBACK', 'RELEASE']);
});

test('corrupt returned journal bytes are rejected before commit', async () => {
  const h = connectionFixture({ corruptRow: { review_hash: '0'.repeat(64) } });
  await assert.rejects(() => createMarketplaceStore(h.pool).save(h.record), /MARKETPLACE_JOURNAL_CORRUPT/);
  assert.equal(h.read(), null); assert.equal(h.events.includes('COMMIT'), false);
  assert.deepEqual(h.events.slice(-2), ['ROLLBACK', 'RELEASE']);
});

test('writes require explicit connection acquisition rather than pool.query transactions', async () => {
  const h = connectionFixture();
  await assert.rejects(() => createMarketplaceStore({ query: h.pool.query }).save(h.record), /MARKETPLACE_DATABASE_POOL_REQUIRED/);
  assert.equal(h.read(), null); assert.deepEqual(h.events, []);
});
