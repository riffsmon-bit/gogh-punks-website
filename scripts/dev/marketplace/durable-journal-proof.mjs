import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { withOwnedMarketplacePostgres } from './owned-postgres.mjs';
import { createReviewedMarketplaceRuntime } from '../../../netlify/functions/_shared/marketplace-runtime.mjs';

// Called only by the fixed --durable-journal-test branch of the disposable harness.
// Its existing test collection screen/policy fixture is not production evidence.
export async function proveDurableMarketplace({ client, owner, wallet, collection, deps, budget, makeListing,
  sendReview, assertDisposable, local, output }) {
  await assertDisposable();
  const stage = phase => console.log(JSON.stringify({ phase }));
  return withOwnedMarketplacePostgres(async ({ pool, connectionString, restart }) => {
    stage('DURABLE_OWNED_POSTGRES_READY');
    await pool.query(await readFile(new URL('../../../netlify/database/migrations/20260913210000_stage_marketplace_reviews.sql', import.meta.url), 'utf8'));
    await pool.query(`CREATE ROLE marketplace_disposable_request LOGIN;
      GRANT USAGE ON SCHEMA public TO marketplace_disposable_request;
      GRANT SELECT,INSERT ON broker_marketplace_reviews TO marketplace_disposable_request;
      GRANT UPDATE(revision,status,reported_hash,receipt,reason) ON broker_marketplace_reviews TO marketplace_disposable_request;
      CREATE POLICY marketplace_disposable_policy ON broker_marketplace_reviews TO marketplace_disposable_request USING(true) WITH CHECK(true)`);
    const url = new URL(connectionString); url.username = 'marketplace_disposable_request';
    let requestPool = new pg.Pool({ connectionString: url.href, max: 4 }); requestPool.on('error', () => {});
    const evidenceHash = label => createHash('sha256').update(`OWNED_DISPOSABLE_FIXTURE:${label}`).digest('hex');
    const release = { schema: 'GOGH_MARKETPLACE_RELEASE_V1', status: 'OWNER_ASSIST', chainId: 4663, action: 'BUY_LISTINGS',
      purchaseGuardDeployment: deps.purchaseGuardDeployment, evidence: Object.fromEntries(['selection', 'screening', 'policySkills', 'database'].map(key => [key, evidenceHash(key)])), blockers: [] };
    const scope = { owner, punkId: '93' };
    const cas = response => ({ ...scope, intentId: response.entry.intentId, revision: response.entry.revision, reviewHash: response.entry.reviewHash });
    try {
      const listings = [await makeListing(8101n), await makeListing(8102n)];
      deps.loadListings = async ({ collection: requested, orderHashes }) => {
        assert.equal(requested, collection);
        return listings.filter(listing => orderHashes.includes(listing.order_hash));
      };
      let runtime = await createReviewedMarketplaceRuntime({ release: () => release, pool: requestPool, deps });
      const input = { requestId: randomUUID(), action: 'BUY_LISTINGS', selection: { collection, orderHashes: listings.map(listing => listing.order_hash) }, budget };
      const prepared = await runtime.coordinator.prepare({ ...scope, input });
      stage('DURABLE_EXACT_REVIEW_PERSISTED');
      assert.equal(prepared.availability, 'OWNER_REVIEW_READY'); assert.equal(prepared.transaction, null);
      assert.equal(prepared.entry.review.transaction, null);
      const repeated = await runtime.coordinator.prepare({ ...scope, input });
      assert.equal(repeated.entry.reviewHash, prepared.entry.reviewHash);
      const claims = await Promise.all([runtime.coordinator.claim(cas(prepared)), runtime.coordinator.claim(cas(prepared))]);
      assert.equal(claims.filter(result => result.walletClaimed).length, 1);
      const claimed = claims.find(result => result.walletClaimed);
      stage('DURABLE_SINGLE_WALLET_CLAIM_COMMITTED');
      const stored = await runtime.store.get(cas(claimed));
      assert.equal(stored.status, 'WALLET_REQUESTED'); assert.deepEqual(stored.record.review.transaction, claimed.transaction);
      // The only purchase submission is this test owner wallet on the owned node.
      const receipt = await sendReview({ ...stored.record.review, transaction: claimed.transaction });
      stage('DURABLE_OWNED_PURCHASE_MINED');
      const pending = await runtime.coordinator.recover({ ...cas(claimed), transactionHash: receipt.transactionHash });
      assert.equal(pending.entry.status, 'WALLET_REQUESTED'); assert.equal(pending.entry.reportedHash, receipt.transactionHash);
      await assert.rejects(() => runtime.coordinator.cancel(cas(pending)), /RESERVED/);
      await local('anvil_mine', ['0xc']);
      // Restart both the native database and the server coordinator with the original
      // persisted bytes; a paused release does not prevent receipt recovery.
      await requestPool.end(); requestPool = null;
      await restart();
      stage('DURABLE_POSTGRES_RESTARTED');
      release.status = 'PAUSED'; release.blockers = ['MARKETPLACE_RELEASE_PAUSED'];
      requestPool = new pg.Pool({ connectionString: url.href, max: 4 }); requestPool.on('error', () => {});
      runtime = await createReviewedMarketplaceRuntime({ release: () => release, pool: requestPool, deps });
      const resumed = await runtime.coordinator.get({ ...scope, intentId: prepared.entry.intentId });
      const completed = await runtime.coordinator.recover(cas(resumed));
      assert.equal(completed.entry.status, 'COMPLETED'); assert.equal(completed.entry.receipt.items.length, 2);
      assert.equal(completed.entry.reportedHash, receipt.transactionHash); assert.equal(completed.transaction, null);
      assert.equal((await runtime.coordinator.recover(cas(completed))).entry.revision, completed.entry.revision);
      assert.equal((await runtime.coordinator.claim(cas(completed))).transaction, null);
      const audit = (await pool.query('SELECT revision,status FROM broker_marketplace_events ORDER BY revision')).rows;
      assert.deepEqual(audit.map(row => row.status), ['PREPARED', 'WALLET_REQUESTED', 'WALLET_REQUESTED', 'COMPLETED']);
      const evidence = { schema: 'GOGH_DURABLE_MARKETPLACE_DISPOSABLE_PROOF_V1', status: 'PASS_CONTROLLED_ONLY', checkedAt: new Date().toISOString(),
        chainId: await client.getChainId(), owner, punkId: '93', wallet, collection, publicTransactions: 0, publicOrdersPosted: 0,
        walletClaims: 1, purchaseTransactions: 1, nativePostgres: true, narrowRoleVerified: true, databaseRestarted: true,
        coordinatorRestarted: true, releasePausedAtRecovery: true, reviewHash: prepared.entry.reviewHash,
        receipt: completed.entry.receipt, audit,
        limitations: ['DISPOSABLE_COLLECTION_SCREEN_AND_POLICY_FIXTURES', 'NO_PUBLIC_GUARD_DEPLOYED', 'NO_PUBLIC_RELEASE_AUTHORIZATION',
          'NO_LIVE_OPENSEA_SIGNED_ORDER_ADAPTER', 'TEST_OWNER_IMPERSONATION_ONLY', 'NO_BROWSER_WALLET_TEST_IN_THIS_PROOF'] };
      if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(JSON.stringify(evidence, null, 2));
      return evidence;
    } finally { if (requestPool) await requestPool.end(); }
  });
}
