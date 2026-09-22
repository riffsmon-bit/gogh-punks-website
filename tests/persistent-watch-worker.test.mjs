import test from 'node:test';
import assert from 'node:assert/strict';
import { runScheduledV2Discovery } from '../netlify/functions/broker-v2-discovery-worker.mjs';

const enabled = { GOGH_V2_DISCOVERY_INGEST_ENABLED: 'true', GOGH_V2_PERSISTENT_WATCH_ENABLED: 'true' };
function fixture({ elapsed = 0, results = [], watchError = null } = {}) {
  let time = 0, pools = 0;
  const pool = {}, calls = [], discovery = { status: 'COMPLETE', discoveredCount: results.length, results };
  const options = { environment: enabled, now: () => time, poolFactory: () => { pools++; return pool; },
    report: () => {}, run: async input => { calls.push(['discover', input]); time = elapsed; return discovery; },
    runWatch: async input => { calls.push(['watch', input]); if (watchError) throw watchError;
      return { status: 'COMPLETE', checked: 1, executionAuthorized: false, transactionSubmitted: false }; } };
  return { options, calls, pool, discovery, pools: () => pools };
}
test('watch is off by default; disabled discovery and global/preview RPC gates perform no watch/database work', async () => {
  for (const environment of [{}, { ...enabled, PAUSE_BACKGROUND_RPC: 'true' },
    { ...enabled, CONTEXT: 'deploy-preview' }, { ...enabled, BACKGROUND_RPC_ALLOWED_TASKS: 'OTHER' }]) {
    const f = fixture(); await runScheduledV2Discovery({ ...f.options, environment });
    assert.equal(f.calls.length, 0); assert.equal(f.pools(), 0);
  }
  const f = fixture(); const result = await runScheduledV2Discovery({ ...f.options,
    environment: { GOGH_V2_DISCOVERY_INGEST_ENABLED: 'true' } });
  assert.equal(result, f.discovery); assert.equal(f.calls.length, 1); assert.equal(f.pools(), 0);
});
for (const results of [[], [{ opportunityId: 'shared_opportunity', screeningStatus: 'PASSED' }]]) {
  test(`one shared watch pass follows ${results.length ? 'active' : 'idle'} discovery using the same pool`, async () => {
    const f = fixture({ results }); const result = await runScheduledV2Discovery(f.options);
    assert.equal(f.pools(), 1); assert.deepEqual(f.calls.map(x => x[0]), ['discover', 'watch']);
    const [discovery, watch] = f.calls.map(x => x[1]);
    assert.equal(discovery.pool, f.pool); assert.equal(watch.pool, f.pool);
    assert.deepEqual(watch.opportunities, results); assert.equal(watch.limit, 5); assert.equal(watch.maxDurationMs, 15000);
    assert.equal(result.persistentWatch.executionAuthorized, false); assert.equal(result.persistentWatch.transactionSubmitted, false);
  });
}
test('a large shared discovery result supplies only a bounded set of watch IDs', async () => {
  const results = Array.from({ length: 150 }, (_value, i) => ({ opportunityId: `shared_opportunity_${i}` }));
  const f = fixture({ results }); await runScheduledV2Discovery(f.options);
  assert.equal(f.calls[1][1].opportunities.length, 100); assert.equal(results.length, 150);
});
test('slow discovery reduces the watch budget and skips when no useful time remains', async () => {
  const short = fixture({ elapsed: 38500 }); await runScheduledV2Discovery(short.options);
  assert.equal(short.calls[1][1].maxDurationMs, 1500);
  for (const elapsed of [39501, 50000]) {
    const f = fixture({ elapsed }); const result = await runScheduledV2Discovery(f.options);
    assert.equal(f.calls.length, 1); assert.equal(result.persistentWatch.status, 'TIME_BUDGET_EXHAUSTED');
  }
});
test('watch failure preserves committed discovery, sanitizes errors and never repeats the batch', async () => {
  const f = fixture({ watchError: Error('PRIVATE_PROVIDER_URL') }); const result = await runScheduledV2Discovery(f.options);
  assert.equal(result.status, 'COMPLETE'); assert.equal(f.calls.length, 2);
  assert.deepEqual(result.persistentWatch, { status: 'UNAVAILABLE', executionAuthorized: false, transactionSubmitted: false });
  assert.ok(!JSON.stringify(result).includes('PRIVATE_PROVIDER_URL'));
});
test('failed discovery cannot start the follow-on watch pass', async () => {
  const f = fixture(); await assert.rejects(runScheduledV2Discovery({ ...f.options,
    run: async () => { throw Error('SOURCE_UNAVAILABLE'); } }), /SOURCE_UNAVAILABLE/);
  assert.equal(f.calls.length, 0);
});
