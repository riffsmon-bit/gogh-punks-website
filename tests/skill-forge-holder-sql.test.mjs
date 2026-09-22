import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHolderBurnStore, createHolderHistoryStore } from '../broker/src/v4/skill-forge/holder-store.mjs';
import { holderBurnSelection } from '../broker/src/v4/skill-forge/holder-source.mjs';
import { createHolderHistoryScanner } from '../broker/src/v4/skill-forge/holder-history.mjs';

const address = n => `0x${n.toString(16).padStart(40, '0')}`, hash = n => `0x${n.toString(16).padStart(64, '0')}`;
test('holder journal SQL enforces scope, transitions, immutable audit and contiguous history against real PostgreSQL WASM', { timeout: 30000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../netlify/database/review/holder-burn-journal.sql', import.meta.url), 'utf8'));
    const selection = holderBurnSelection(address(1), '812', '119'), store = createHolderBurnStore(db, selection);
    let next = 0;
    const review = (s = selection) => ({ schema: 'GOGH_ORIGINAL_PUNK_BURN_PREPARATION_V1', chainId: 4663,
      intentId: (++next).toString(16).padStart(64, '0'), action: 'APPROVE',
      state: { owner: s.owner, sourceTokenId: s.sourceTokenId, targetTokenId: s.targetTokenId }, expiresAt: Date.now() + 60000,
      maximumNetworkFeeWei: '1000000', sourceEvidence: {}, transaction: { from: s.owner, to: s.collection, chainId: '0x1237',
        value: '0x0', nonce: '0x0', gas: '0x186a0', gasPrice: '0xa', data: '0x095ea7b3' } });
    // PostgreSQL CHECK(NULL) is not false. Exercise missing and JSON-null fields
    // directly at the store boundary, not only through HTTP validation.
    for (const field of ['schema', 'action', 'expiresAt', 'transaction', 'sourceEvidence', 'chainId']) {
      for (const value of ['omit', 'null']) {
        const malformed = review(); if (value === 'omit') delete malformed[field]; else malformed[field] = null;
        await assert.rejects(store.save(malformed), /check constraint|EXPIRED|invalid input/i);
      }
    }
    for (const field of ['to', 'nonce', 'gas', 'gasPrice', 'data', 'chainId']) {
      const malformed = review(); malformed.transaction[field] = null;
      await assert.rejects(store.save(malformed), /check constraint/);
    }
    const prepared = await store.save(review()); assert.equal(prepared.status, 'PREPARED');
    assert.equal(await createHolderBurnStore(db, { ...selection, owner: address(2) }).get(prepared.review.intentId), null);
    assert.equal(await createHolderBurnStore(db, { ...selection, targetTokenId: '120' }).get(prepared.review.intentId), null);
    for (const changed of [{ ...selection, owner: address(2) }, { ...selection, sourceTokenId: '813' }, { ...selection, targetTokenId: '120' }]) {
      await assert.rejects(createHolderBurnStore(db, changed).save(review(changed)), /duplicate key/);
    }
    const claims = await Promise.allSettled(Array.from({ length: 4 }, () => store.update(prepared.review.intentId, 0, 'WALLET_REQUESTED', null)));
    assert.equal(claims.filter(r => r.status === 'fulfilled').length, 1);
    const claimed = await store.current(); assert.equal(claimed.revision, 1);
    await assert.rejects(store.update(claimed.review.intentId, 1, 'CANCELLED', null), /TRANSITION/);
    await assert.rejects(db.query('DELETE FROM broker_holder_burn_reviews WHERE intent_id=$1', [claimed.review.intentId]), /DELETE_FORBIDDEN/);
    await assert.rejects(db.query('UPDATE broker_holder_burn_reviews SET review_json=review_json||$2,revision=revision+1 WHERE intent_id=$1', [claimed.review.intentId, ' ']), /IMMUTABLE/);
    const bound = await store.update(claimed.review.intentId, 1, 'WALLET_REQUESTED', hash(100));
    await assert.rejects(store.update(bound.review.intentId, 2, 'WALLET_REQUESTED', hash(101)), /ORIGINAL_HASH/);
    await assert.rejects(store.update(bound.review.intentId, 2, 'CONFIRMED', hash(100), { status: 'CONFIRMED', transactionHash: hash(101) }), /RECEIPT_REQUIRED/);
    const settled = await store.update(bound.review.intentId, 2, 'CONFIRMED', hash(100), { status: 'CONFIRMED', transactionHash: hash(100) });
    assert.equal(settled.revision, 3);
    await assert.rejects(store.update(settled.review.intentId, 3, 'WALLET_REQUESTED', hash(100)), /TRANSITION/);
    assert.deepEqual((await db.query('SELECT revision,status FROM broker_holder_burn_events ORDER BY revision')).rows,
      [{ revision: 0, status: 'PREPARED' }, { revision: 1, status: 'WALLET_REQUESTED' }, { revision: 2, status: 'WALLET_REQUESTED' }, { revision: 3, status: 'CONFIRMED' }]);
    const expired = review(); expired.expiresAt = Date.now() - 1; await assert.rejects(store.save(expired), /EXPIRED/);
    const another = await store.save(review()); assert.equal(another.status, 'PREPARED');

    // PostgreSQL JSONB reorders object keys. Restarted scan identity/dedupe must
    // compare semantic fields, not JSON serialization order.
    const source = { selection, wallets: [10, 11, 12, 13].map(n => ({ address: address(n) })), anchor: { number: '5', hash: hash(5) } };
    const client = () => ({ getChainId: async () => 4663, getBlock: async ({ blockNumber }) => ({ hash: hash(blockNumber) }),
      request: async ({ params: [q] }) => q.address ? [{ transactionHash: hash(100), blockHash: hash(100) }] : [] });
    const options = { clients: [client(), client()], positiveControl: { filter: { address: address(100) }, transactionHash: hash(100), blockHash: hash(100) },
      rangeBlocks: 2, maxRanges: 1 };
    let scanner = createHolderHistoryScanner({ ...options, store: createHolderHistoryStore(db) });
    const first = await scanner.advance(source); assert.equal(first.cursor, '1');
    scanner = createHolderHistoryScanner({ ...options, store: createHolderHistoryStore(db) });
    const second = await scanner.advance(source); assert.equal(second.cursor, '3');
    assert.equal((await scanner.advance(source)).complete, true);
    await assert.rejects(db.query('UPDATE broker_holder_asset_history SET cursor_block=0,revision=revision+1 WHERE history_key=$1', [first.identity.key]), /CURSOR_INVALID/);
    await assert.rejects(db.query('DELETE FROM broker_holder_asset_history WHERE history_key=$1', [first.identity.key]), /DELETE_FORBIDDEN/);
    const historyStore = createHolderHistoryStore(db), historic = await historyStore.load(first.identity.key);
    await assert.rejects(historyStore.reset(first.identity.key, historic.revision, { reason: 'CANONICAL_REORG', oldCursor: '5', oldHash: hash(5), replacementHash: hash(5) }), /RESET_INVALID/);
    const reset = await historyStore.reset(first.identity.key, historic.revision, { reason: 'CANONICAL_REORG', oldCursor: '5', oldHash: hash(5), replacementHash: hash(6) });
    assert.equal(reset.cursor, '-1'); assert.equal(reset.generation, 1); assert.deepEqual(reset.assets, []);
    const audit = (await db.query('SELECT generation,prior_cursor,prior_hash FROM broker_holder_history_resets')).rows[0];
    assert.equal(audit.generation, 1); assert.equal(String(audit.prior_cursor), '5'); assert.equal(audit.prior_hash, hash(5));
    assert.equal((await scanner.advance(source)).cursor, '1');

    // No public grants or database-owner impersonation are shipped.
    await db.exec('CREATE ROLE holder_untrusted NOLOGIN; SET ROLE holder_untrusted');
    await assert.rejects(db.query('SELECT * FROM broker_holder_burn_reviews'), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM broker_holder_burn_events'), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM broker_holder_asset_history'), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM broker_holder_history_resets'), /permission denied/);
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});
