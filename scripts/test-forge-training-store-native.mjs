import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { resolve, join, isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runTrainingStoreSqlSuite } from './dev/skill-forge/training-store-sql-suite.mjs';
import { createPostgresTrainingStore } from '../broker/src/v4/skill-forge/postgres-training-store.mjs';
import { durableReviewFixture, TRAINING_STORE_BINDING } from '../tests/fixtures/durable-training-review.mjs';
import { settlementFixture } from '../tests/fixtures/training-settlement.mjs';
import { verifyTrainingDatabaseRole } from '../broker/src/v4/skill-forge/training-database-role.mjs';

// Owns a NEW private, loopback-only cluster. No environment/database defaults,
// production secrets, existing cluster, or public RPC connection are accepted.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--disposable-only' || !args[1].startsWith('--postgres-bin=')) {
  throw Error('Pass --disposable-only --postgres-bin=/absolute/path/to/bin');
}
const bin = args[1].slice('--postgres-bin='.length);
if (!isAbsolute(bin)) throw Error('PostgreSQL binary path must be absolute.');
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'gogh-forge-native-'));
const data = join(directory, 'data');
const log = join(directory, 'postgres.log');
const port = await new Promise((resolvePort, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolvePort(value)); });
});
const admin = userInfo().username;
const settings = { host: '127.0.0.1', port, user: admin, database: 'gogh_forge_test',
  max: 6, connectionTimeoutMillis: 5000, application_name: 'gogh-forge-owned-native-test' };
const command = (name, options) => run(join(resolve(bin), name), options, { timeout: 60000, maxBuffer: 100_000 });
const start = () => command('pg_ctl', ['-D', data, '-l', log, '-o', `-h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start']);
const stop = () => command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
const scopeOf = record => ({ intentId: record.intentId, owner: record.review.owner, tokenId: record.review.tokenId });
const makePool = (user = admin) => { const value = new pg.Pool({ ...settings, user }); value.on('error', () => {}); return value; };
let started = false, pool, requestPool, workerPool, browserPool, interrupted;
try {
  const version = (await command('postgres', ['--version'])).stdout.trim();
  await command('initdb', ['-D', data, '--no-locale', '-E', 'UTF8', '--auth=trust']);
  await start(); started = true;
  const bootstrap = new pg.Client({ ...settings, database: 'postgres' });
  await bootstrap.connect();
  try { await bootstrap.query('CREATE DATABASE gogh_forge_test'); } finally { await bootstrap.end(); }
  pool = makePool();
  const sessions = await Promise.all([pool.connect(), pool.connect()]);
  try {
    const identities = await Promise.all(sessions.map(client => client.query('SELECT pg_backend_pid() AS pid')));
    assert.notEqual(identities[0].rows[0].pid, identities[1].rows[0].pid);
  } finally { sessions.forEach(client => client.release()); }
  const suite = await runTrainingStoreSqlSuite({ pool, exec: sql => pool.query(sql), query: (sql, values) => pool.query(sql, values) });

  // Test least-privilege server roles and a denied browser role on native PG.
  // These roles exist solely inside this disposable cluster; this is NOT a grant migration.
  await pool.query(await readFile(new URL('../netlify/database/review/forge-training-roles.sql',import.meta.url),'utf8'));
  await pool.query('ALTER ROLE forge_request LOGIN; ALTER ROLE forge_worker LOGIN; CREATE ROLE forge_browser LOGIN;');
  requestPool = makePool('forge_request'); workerPool = makePool('forge_worker'); browserPool = makePool('forge_browser');
  assert.equal(await verifyTrainingDatabaseRole(requestPool,'request'),true);
  assert.equal(await verifyTrainingDatabaseRole(workerPool,'worker'),true);
  await assert.rejects(() => verifyTrainingDatabaseRole(pool,'request'),/DATABASE_ROLE_INVALID/);
  await assert.rejects(() => verifyTrainingDatabaseRole(requestPool,'worker'),/DATABASE_ROLE_INVALID/);
  await assert.rejects(() => verifyTrainingDatabaseRole(browserPool,'request'),/DATABASE_ROLE_INVALID/);
  const denied = call => assert.rejects(call, error => error.code === '42501');
  for (const table of ['broker_forge_training_intents','broker_forge_training_intent_events','broker_forge_training_reconciliation_jobs']) {
    await denied(() => browserPool.query(`SELECT * FROM ${table}`));
  }
  const requestStore = createPostgresTrainingStore({ pool: requestPool, deployment: TRAINING_STORE_BINDING });
  const review = durableReviewFixture({ tokenId: '900' }); review.transaction.nonce = '900';
  const prepared = await requestStore.prepare({ requestKey: randomBytes(32).toString('hex'), review });
  const scope = scopeOf(prepared);
  const requested = await requestStore.claim(scope, prepared.revision, prepared.reviewHash);
  assert.equal(requested.claimed, true);
  await denied(() => requestPool.query('UPDATE broker_forge_training_intents SET settlement=$2 WHERE intent_id=$1', [prepared.intentId, '{}']));
  await denied(() => requestPool.query('DELETE FROM broker_forge_training_intent_events WHERE intent_id=$1', [prepared.intentId]));
  await denied(() => requestPool.query('UPDATE broker_forge_training_intent_events SET status=$2 WHERE intent_id=$1', [prepared.intentId, 'SETTLED_SUCCESS']));
  await denied(() => requestPool.query("UPDATE broker_forge_training_intents SET status='NONCE_CONSUMED',revision=revision+1 WHERE intent_id=$1", [prepared.intentId]));

  // A committed wallet claim and lease must survive an immediate database crash.
  // An uncommitted state change must NOT survive the same crash.
  const worker = createPostgresTrainingStore({ pool: workerPool, deployment: TRAINING_STORE_BINDING });
  const lease = await worker.claimPendingReconciliation({ limit: 20 });
  assert.ok(lease.records.some(record => record.intentId === prepared.intentId));
  interrupted = await pool.connect(); interrupted.on('error', () => {});
  await interrupted.query('BEGIN');
  await interrupted.query("UPDATE broker_forge_training_intents SET status='SUBMISSION_UNKNOWN',revision=revision+1 WHERE intent_id=$1", [prepared.intentId]);
  await stop(); started = false;
  interrupted.release(true); interrupted = null;
  await Promise.all([pool.end(), requestPool.end(), workerPool.end(), browserPool.end()]);
  pool = requestPool = workerPool = browserPool = null;
  await start(); started = true;
  pool = makePool();
  const restarted = createPostgresTrainingStore({ pool, deployment: TRAINING_STORE_BINDING });
  const recovered = await restarted.get(scope);
  assert.equal(recovered.status, 'WALLET_REQUESTED'); assert.equal(recovered.revision, requested.record.revision);
  assert.equal((await restarted.claim(scope, 0, prepared.reviewHash)).claimed, false);
  const persistedLease = await pool.query('SELECT lease_token FROM broker_forge_training_reconciliation_jobs WHERE intent_id=$1', [prepared.intentId]);
  assert.equal(persistedLease.rows[0].lease_token, lease.leaseToken);
  const history = await pool.query('SELECT status FROM broker_forge_training_intent_events WHERE intent_id=$1 ORDER BY revision', [prepared.intentId]);
  assert.deepEqual(history.rows.map(row => row.status), ['PREPARED','WALLET_REQUESTED']);
  assert.match(await readFile(log, 'utf8'), /database system was interrupted|database system was not properly shut down/);

  workerPool = makePool('forge_worker');
  const restartedWorker = createPostgresTrainingStore({ pool: workerPool, deployment: TRAINING_STORE_BINDING });
  const settled = await restartedWorker.recordVerifiedSettlement(scope, recovered.revision,
    settlementFixture(review, { status: 'NONCE_CONSUMED', transactionHash: null }));
  assert.equal(settled.holdsTraining, false);
  assert.equal((await pool.query('SELECT * FROM broker_forge_training_reconciliation_jobs WHERE intent_id=$1', [prepared.intentId])).rows.length, 0);
  console.log(JSON.stringify({ result: 'PASS', engine: version, sqlAssertions: suite.assertions,
    nativeMultiSessionTested: true, concurrentClaimAndLeaseTested: true, durableDiskRestartTested: true,
    immediateCrashRecovered: true, uncommittedChangeRolledBack: true, noSecondWalletClaim: true,
    browserAccessDenied: true, requestRoleCannotSettleOrRewriteAudit: true, workerRoleCanSettle: true,
    publicChainTransactions: 0, productionDatabaseAccessed: false, productionTrainingAuthorized: false }, null, 2));
} finally {
  interrupted?.release(true);
  await Promise.allSettled([pool?.end(), requestPool?.end(), workerPool?.end(), browserPool?.end()]);
  if (started) await stop();
  // This exact mkdtemp directory belongs to this test invocation only.
  await rm(directory, { recursive: true, force: true });
}
