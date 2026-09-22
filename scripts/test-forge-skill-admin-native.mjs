import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

// This proof creates and removes its own loopback-only PostgreSQL cluster.
// It accepts no database URL, production credential, RPC URL or signing key.
const args = process.argv.slice(2);
if (!args.includes('--disposable-only') || args.length < 2 || args.length > 3
  || args.some(arg => arg !== '--disposable-only' && !arg.startsWith('--postgres-bin=') && !arg.startsWith('--repository='))
  || args.filter(arg => arg.startsWith('--postgres-bin=')).length !== 1
  || args.filter(arg => arg.startsWith('--repository=')).length > 1) {
  throw Error('Pass --disposable-only --postgres-bin=/absolute/path/to/bin [--repository=/absolute/repository]');
}
const bin = args.find(arg => arg.startsWith('--postgres-bin=')).slice('--postgres-bin='.length);
const repository = args.find(arg => arg.startsWith('--repository='))?.slice('--repository='.length)
  ?? fileURLToPath(new URL('../', import.meta.url));
if (!isAbsolute(bin) || !isAbsolute(repository)) throw Error('Local paths must be absolute.');
const moduleAt = relative => import(pathToFileURL(join(repository, relative)).href);
const { createSkillAdminStore, verifySkillAdminDatabaseRole } = await moduleAt('broker/src/v4/skill-forge/skill-admin-store.mjs');
const { skillAdminFixture, ADMIN, REGISTRY, TX } = await moduleAt('tests/fixtures/skill-admin.mjs');
const { manifestHash } = await moduleAt('broker/src/v4/skill-forge/capability-resolver.mjs');
const migrations = await Promise.all([
  '20260914030000_forge_skill_admin_reviews.sql',
  '20260914033000_forge_skill_admin_nonce_recovery.sql',
].map(name => readFile(join(repository, 'database/supabase/migrations', name), 'utf8')));
const migrationHashes = migrations.map(sql => createHash('sha256').update(sql).digest('hex'));

const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'gogh-skill-admin-native-'));
const data = join(directory, 'data'), log = join(directory, 'postgres.log');
const port = await new Promise((resolvePort, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolvePort(value)); });
});
const settings = { host: '127.0.0.1', port, user: userInfo().username, database: 'gogh_skill_admin_test',
  max: 8, connectionTimeoutMillis: 5000, application_name: 'gogh-owned-skill-admin-proof' };
const command = (name, options) => run(join(resolve(bin), name), options, { timeout: 60000, maxBuffer: 100000 });
const start = () => command('pg_ctl', ['-D', data, '-l', log, '-o', `-h 127.0.0.1 -p ${port} -k ${directory} -c max_wal_size=32MB -c min_wal_size=2MB`, '-w', 'start']);
const stop = () => command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
const pools = new Set();
const makePool = (user = settings.user) => {
  const result = new pg.Pool({ ...settings, user }); result.on('error', () => {}); pools.add(result); return result;
};
const closePools = async () => { const current = [...pools]; pools.clear(); await Promise.allSettled(current.map(pool => pool.end())); };
const reviewTable = 'public.broker_forge_skill_admin_reviews';
const cancelTable = 'public.broker_forge_skill_admin_cancellations';
const eventTable = 'public.broker_forge_skill_admin_events';
const REQUEST = 'gogh_forge_skill_admin_request', BROWSER = 'gogh_skill_admin_browser';
const otherAdmin = `0x${'2'.repeat(40)}`, replacementHash = `0x${'3'.repeat(64)}`;
const freshPreparation = () => ({ ...skillAdminFixture().preparation, expiresAt: Date.now() + 120000 });
const receipt = (hash, kind = 'ORIGINAL', status = 'success') => ({ transactionHash: hash,
  blockHash: `0x${'c'.repeat(64)}`, blockNumber: '100', status, minimumConfirmations: 12, kind, valueWei: '0' });
const denied = call => assert.rejects(call, error => error.code === '42501');
const rejected = call => assert.rejects(call, error => ['23514', 'P0001', '22P02'].includes(error.code));
const insertRaw = async (pool, preparation, administrator = ADMIN) => pool.query(`INSERT INTO ${reviewTable}
  (id,administrator,chain_id,registry,skill_key,action,request_key,preparation,review_hash,status)
  VALUES($1,$2,4663,$3,$4,$5,$6,$7,$8,'PREPARED') RETURNING *`,
  [randomUUID(), administrator, REGISTRY, preparation.key ?? skillAdminFixture().preparation.key,
    preparation.action ?? 'REGISTER', randomUUID(), preparation, manifestHash(preparation)]);
let started = false, pool, requestPool, browserPool, interrupted;
let negativeEnvelopeChecks = 0;
try {
  const version = (await command('postgres', ['--version'])).stdout.trim();
  await command('initdb', ['-D', data, '--no-locale', '-E', 'UTF8', '--auth=trust', '--wal-segsize=1']);
  await start(); started = true;
  const bootstrap = new pg.Client({ ...settings, database: 'postgres' });
  await bootstrap.connect();
  try { await bootstrap.query('CREATE DATABASE gogh_skill_admin_test'); } finally { await bootstrap.end(); }
  pool = makePool();
  for (const sql of migrations) await pool.query(sql);
  // These login grants and the unrelated table exist only in this owned test cluster.
  await pool.query(`ALTER ROLE ${REQUEST} LOGIN; CREATE ROLE ${BROWSER} LOGIN;
    CREATE TABLE public.unrelated_holder_data (id integer PRIMARY KEY); REVOKE ALL ON public.unrelated_holder_data FROM PUBLIC;`);
  requestPool = makePool(REQUEST); browserPool = makePool(BROWSER);
  await verifySkillAdminDatabaseRole(requestPool);
  await assert.rejects(() => verifySkillAdminDatabaseRole(pool), /SKILL_ADMIN_DATABASE_ROLE_UNSAFE/);
  await assert.rejects(() => verifySkillAdminDatabaseRole(browserPool), /SKILL_ADMIN_DATABASE_ROLE_UNSAFE|permission denied/);
  const sessions = await Promise.all([requestPool.connect(), requestPool.connect()]);
  try {
    const pids = await Promise.all(sessions.map(client => client.query('SELECT pg_backend_pid() AS pid')));
    assert.notEqual(pids[0].rows[0].pid, pids[1].rows[0].pid);
  } finally { sessions.forEach(client => client.release()); }

  for (const table of [reviewTable, cancelTable, eventTable]) {
    await denied(() => browserPool.query(`SELECT * FROM ${table}`));
    await denied(() => browserPool.query(`DELETE FROM ${table}`));
    await denied(() => requestPool.query(`DELETE FROM ${table}`));
    await denied(() => requestPool.query(`TRUNCATE ${table}`));
  }
  await denied(() => requestPool.query('INSERT INTO public.unrelated_holder_data VALUES(1)'));
  await denied(() => requestPool.query(`INSERT INTO ${eventTable}(parent_id,administrator,revision,status) VALUES($1,$2,0,'PREPARED')`, [randomUUID(), ADMIN]));
  await denied(() => requestPool.query(`UPDATE ${eventTable} SET status='CONFIRMED'`));
  await denied(() => requestPool.query('SELECT public.audit_forge_skill_admin_transition()'));
  await pool.query(`GRANT INSERT ON public.unrelated_holder_data TO ${REQUEST}`);
  await assert.rejects(() => verifySkillAdminDatabaseRole(requestPool), /SKILL_ADMIN_DATABASE_ROLE_UNSAFE/);
  await pool.query(`REVOKE INSERT ON public.unrelated_holder_data FROM ${REQUEST}`);
  await pool.query(`ALTER ROLE ${REQUEST} BYPASSRLS`);
  await assert.rejects(() => verifySkillAdminDatabaseRole(requestPool), /SKILL_ADMIN_DATABASE_ROLE_UNSAFE/);
  await pool.query(`ALTER ROLE ${REQUEST} NOBYPASSRLS`);
  await verifySkillAdminDatabaseRole(requestPool);

  // PostgreSQL JSON NULL and missing-key semantics must not bypass validation.
  for (const key of ['schema', 'key', 'action', 'name', 'chainId', 'expiresAt', 'maximumNetworkFeeWei',
    'walletConfirmationRequired', 'publicTransactions', 'serverReleaseActivated', 'manifestHash', 'instructionHash', 'reviewEvidenceHash', 'transaction']) {
    for (const missing of [false, true]) {
      const invalid = freshPreparation(); if (missing) delete invalid[key]; else invalid[key] = null;
      await rejected(() => insertRaw(requestPool, invalid)); negativeEnvelopeChecks++;
    }
  }
  for (const key of ['from', 'to', 'value', 'data', 'chainId', 'nonce', 'gas', 'gasPrice']) {
    const invalid = freshPreparation(); delete invalid.transaction[key];
    await rejected(() => insertRaw(requestPool, invalid)); negativeEnvelopeChecks++;
  }
  for (const patch of [{ authorizationList: [] }, { to: otherAdmin }, { from: otherAdmin }, { value: '0x1' }, { chainId: '0x1' }]) {
    const invalid = freshPreparation(); Object.assign(invalid.transaction, patch);
    await rejected(() => insertRaw(requestPool, invalid)); negativeEnvelopeChecks++;
  }
  const expired = freshPreparation(); expired.expiresAt = Date.now() - 1000;
  const expiredRow = (await insertRaw(requestPool, expired)).rows[0];
  const store = createSkillAdminStore({ pool: requestPool, registry: REGISTRY });
  await assert.rejects(() => store.update(ADMIN, expiredRow.id, 0, ['PREPARED'], 'WALLET_REQUESTED'), /SKILL_ADMIN_REVIEW_EXPIRED/);
  await store.update(ADMIN, expiredRow.id, 0, ['PREPARED'], 'CANCELLED');

  const preparation = freshPreparation();
  const candidates = await Promise.all(Array.from({ length: 12 }, () => store.prepare(ADMIN, randomUUID(), preparation, manifestHash(preparation))));
  assert.equal(new Set(candidates.map(row => row.id)).size, 1, 'Concurrent preparations must share one open review.');
  const row = candidates[0];
  const claims = await Promise.allSettled(Array.from({ length: 12 }, () => store.update(ADMIN, row.id, row.revision, ['PREPARED'], 'WALLET_REQUESTED')));
  assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of claims.filter(result => result.status === 'rejected')) assert.match(result.reason.message, /SKILL_ADMIN_REVIEW_CONFLICT/);
  const claimed = claims.find(result => result.status === 'fulfilled').value;
  assert.equal(await store.get(otherAdmin, row.id), null);
  await assert.rejects(() => store.update(otherAdmin, row.id, claimed.revision, ['WALLET_REQUESTED'], 'SUBMITTED', { transactionHash: TX }), /SKILL_ADMIN_REVIEW_CONFLICT/);
  await denied(() => requestPool.query(`UPDATE ${reviewTable} SET preparation='{}' WHERE id=$1`, [row.id]));
  await denied(() => requestPool.query(`UPDATE ${reviewTable} SET review_hash=$2 WHERE id=$1`, [row.id, replacementHash]));
  await rejected(() => requestPool.query(`UPDATE ${reviewTable} SET status='CANCELLED',revision=revision+1 WHERE id=$1`, [row.id]));

  const cancellation = { schema: 'GOGH_SKILL_ADMIN_NONCE_CANCELLATION_V1', parentId: row.id, administrator: ADMIN,
    chainId: 4663, registry: REGISTRY, originalNonce: preparation.transaction.nonce, expiresAt: Date.now() + 120000,
    replacementBaseGasPrice: preparation.transaction.gasPrice, accountCode: '0x',
    maximumNetworkFeeWei: '2520000', walletConfirmationRequired: true, registryActionRepeated: false, assetValueWei: '0',
    transaction: { from: ADMIN, to: ADMIN, value: '0x0', data: '0x', chainId: '0x1237', nonce: preparation.transaction.nonce, gas: '0x6270', gasPrice: '0x64' } };
  for (const change of [value => { delete value.originalNonce; }, value => { value.originalNonce = '0x8'; },
    value => { value.transaction.to = REGISTRY; }, value => { value.transaction.value = '0x1'; },
    value => { value.transaction.nonce = '0x8'; }, value => { value.transaction.data = preparation.transaction.data; }]) {
    const invalid = structuredClone(cancellation); change(invalid);
    await rejected(() => store.prepareCancellation(ADMIN, row.id, randomUUID(), invalid, manifestHash(invalid)));
  }
  const cancellationKey = randomUUID();
  const cancellationCandidates = await Promise.all(Array.from({ length: 12 }, () => store.prepareCancellation(ADMIN,
    row.id, cancellationKey, cancellation, manifestHash(cancellation))));
  assert.equal(new Set(cancellationCandidates.map(candidate => candidate.id)).size, 1);
  const cancellationId = cancellationCandidates[0].id;
  const cancelClaims = await Promise.allSettled(Array.from({ length: 12 }, () => store.claimCancellation(ADMIN, row.id, cancellationId, 0)));
  assert.equal(cancelClaims.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of cancelClaims.filter(result => result.status === 'rejected')) assert.match(result.reason.message, /SKILL_ADMIN_REVIEW_CONFLICT/);
  assert.equal(await store.getCancellation(otherAdmin, row.id, cancellationId), null);
  await denied(() => requestPool.query(`UPDATE ${cancelTable} SET preparation='{}' WHERE id=$1`, [cancellationId]));
  await rejected(() => requestPool.query(`UPDATE ${cancelTable} SET status='PREPARED',revision=revision+1 WHERE id=$1`, [cancellationId]));

  // WALLET_REQUESTED is committed before a wallet may open. A crash must not release it.
  // An uncommitted recovery hash must disappear, while both committed claims remain.
  interrupted = await requestPool.connect(); interrupted.on('error', () => {});
  await interrupted.query('BEGIN');
  await interrupted.query(`UPDATE ${reviewTable} SET recovery_hash=$2,revision=revision+1 WHERE id=$1`, [row.id, replacementHash]);
  await stop(); started = false;
  interrupted.release(true); interrupted = null;
  await closePools();
  await start(); started = true;
  pool = makePool(); requestPool = makePool(REQUEST); browserPool = makePool(BROWSER);
  await verifySkillAdminDatabaseRole(requestPool);
  const restarted = createSkillAdminStore({ pool: requestPool, registry: REGISTRY });
  const recovered = await restarted.get(ADMIN, row.id);
  assert.equal(recovered.status, 'WALLET_REQUESTED'); assert.equal(recovered.revision, claimed.revision);
  assert.equal((await requestPool.query(`SELECT recovery_hash FROM ${reviewTable} WHERE id=$1`, [row.id])).rows[0].recovery_hash, null);
  assert.equal((await requestPool.query(`SELECT status FROM ${cancelTable} WHERE id=$1`, [cancellationId])).rows[0].status, 'WALLET_REQUESTED');
  await assert.rejects(() => restarted.update(ADMIN, row.id, row.revision, ['PREPARED'], 'WALLET_REQUESTED'), /SKILL_ADMIN_REVIEW_CONFLICT/);
  const audit = (await requestPool.query(`SELECT status FROM ${eventTable} WHERE parent_id=$1 AND cancellation_id IS NULL ORDER BY event_id`, [row.id])).rows;
  assert.deepEqual(audit.map(event => event.status), ['PREPARED', 'WALLET_REQUESTED']);
  assert.match(await readFile(log, 'utf8'), /database system was interrupted|database system was not properly shut down/);

  // Release an unknown request only with a persisted canonical replacement proof.
  await rejected(() => requestPool.query(`UPDATE ${reviewTable} SET status='REPLACED',recovery_hash=$2,receipt='{}',revision=revision+1 WHERE id=$1`, [row.id, replacementHash]));
  const replacementProof = receipt(replacementHash, 'REPLACEMENT');
  const replacements = await Promise.all(Array.from({ length: 12 }, () => requestPool.query(`UPDATE ${reviewTable}
    SET status='REPLACED',recovery_hash=$2,receipt=$3,revision=revision+1
    WHERE id=$1 AND revision=$4 AND status='WALLET_REQUESTED' RETURNING id`, [row.id, replacementHash, replacementProof, recovered.revision])));
  assert.equal(replacements.reduce((count, result) => count + result.rowCount, 0), 1);
  await rejected(() => requestPool.query(`UPDATE ${reviewTable} SET status='PREPARED',revision=revision+1 WHERE id=$1`, [row.id]));
  assert.equal((await requestPool.query(`SELECT count(*)::int AS n FROM ${eventTable} WHERE parent_id=$1 AND status='REPLACED'`, [row.id])).rows[0].n, 1);

  const nextPreparation = freshPreparation(), next = await restarted.prepare(ADMIN, randomUUID(), nextPreparation, manifestHash(nextPreparation));
  assert.notEqual(next.id, row.id);
  const nextClaim = await restarted.update(ADMIN, next.id, 0, ['PREPARED'], 'WALLET_REQUESTED');
  const submitted = await restarted.update(ADMIN, next.id, nextClaim.revision, ['WALLET_REQUESTED'], 'SUBMITTED', { transactionHash: TX });
  await rejected(() => requestPool.query(`UPDATE ${reviewTable} SET transaction_hash=$2,revision=revision+1 WHERE id=$1`, [next.id, replacementHash]));
  for (const key of ['transactionHash', 'blockHash', 'blockNumber', 'status', 'minimumConfirmations', 'kind', 'valueWei']) {
    const invalid = receipt(TX); delete invalid[key];
    await rejected(() => restarted.update(ADMIN, next.id, submitted.revision, ['SUBMITTED'], 'CONFIRMED', { receipt: invalid }));
  }
  await rejected(() => restarted.update(ADMIN, next.id, submitted.revision, ['SUBMITTED'], 'CONFIRMED', { receipt: receipt(replacementHash) }));
  await rejected(() => restarted.update(ADMIN, next.id, submitted.revision, ['SUBMITTED'], 'CONFIRMED', { receipt: receipt(TX, 'ORIGINAL', 'reverted') }));
  const settlements = await Promise.allSettled(Array.from({ length: 12 }, () => restarted.update(ADMIN, next.id, submitted.revision,
    ['SUBMITTED'], 'CONFIRMED', { receipt: receipt(TX) })));
  assert.equal(settlements.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of settlements.filter(result => result.status === 'rejected')) assert.match(result.reason.message, /SKILL_ADMIN_REVIEW_CONFLICT/);
  assert.equal((await requestPool.query(`SELECT count(*)::int AS n FROM ${eventTable} WHERE parent_id=$1 AND status='CONFIRMED'`, [next.id])).rows[0].n, 1);
  const terminal = await restarted.get(ADMIN, next.id);
  await assert.rejects(() => restarted.update(ADMIN, next.id, terminal.revision, ['CONFIRMED'], 'PREPARED'), /SKILL_ADMIN_INVALID_TRANSITION/);
  // A wallet speed-up keeps the first hash immutable but records the canonical exact-call hash.
  const speedPreparation = freshPreparation(), speed = await restarted.prepare(ADMIN, randomUUID(), speedPreparation, manifestHash(speedPreparation));
  const speedClaim = await restarted.update(ADMIN, speed.id, 0, ['PREPARED'], 'WALLET_REQUESTED');
  const speedSubmitted = await restarted.update(ADMIN, speed.id, speedClaim.revision, ['WALLET_REQUESTED'], 'SUBMITTED', { transactionHash: TX });
  const speedCandidate = await restarted.update(ADMIN, speed.id, speedSubmitted.revision, ['SUBMITTED'], 'SUBMITTED', { recoveryHash: replacementHash });
  const speedConfirmed = await restarted.update(ADMIN, speed.id, speedCandidate.revision, ['SUBMITTED'], 'CONFIRMED', { receipt: receipt(replacementHash) });
  assert.equal(speedConfirmed.transactionHash, TX); assert.equal(speedConfirmed.recoveryHash, replacementHash);
  assert.equal(speedConfirmed.receipt.transactionHash, replacementHash);
  // A cancellation claim waiting on the parent lock must observe a concurrently
  // confirmed parent, then reject; an old snapshot must not open another wallet request.
  const lockPreparation = freshPreparation(), lockRow = await restarted.prepare(ADMIN, randomUUID(), lockPreparation, manifestHash(lockPreparation));
  await restarted.update(ADMIN, lockRow.id, 0, ['PREPARED'], 'WALLET_REQUESTED');
  const lockCancelPreparation = { ...structuredClone(cancellation), parentId: lockRow.id, expiresAt: Date.now() + 120000 };
  const lockCancel = await restarted.prepareCancellation(ADMIN, lockRow.id, randomUUID(), lockCancelPreparation, manifestHash(lockCancelPreparation));
  const settlementConnection = await requestPool.connect(), cancellationConnection = await requestPool.connect();
  try {
    await settlementConnection.query('BEGIN');
    await settlementConnection.query(`UPDATE ${reviewTable} SET status='REPLACED',recovery_hash=$2,receipt=$3,revision=revision+1 WHERE id=$1`,
      [lockRow.id, replacementHash, receipt(replacementHash, 'REPLACEMENT')]);
    const cancellationPid = (await cancellationConnection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pendingClaim = cancellationConnection.query(`UPDATE ${cancelTable} SET status='WALLET_REQUESTED',revision=revision+1 WHERE id=$1`, [lockCancel.id])
      .then(() => ({ accepted: true }), error => ({ accepted: false, error }));
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = (await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [cancellationPid])).rows[0];
      if (state?.wait_event_type === 'Lock') { waiting = true; break; }
      await new Promise(resolveWait => setTimeout(resolveWait, 10));
    }
    assert.equal(waiting, true, 'Cancellation claim must serialize on the parent row.');
    await settlementConnection.query('COMMIT');
    const claimResult = await pendingClaim;
    assert.equal(claimResult.accepted, false); assert.match(claimResult.error.message, /SKILL_ADMIN_CANCELLATION_INVALID/);
  } finally {
    await settlementConnection.query('ROLLBACK').catch(() => {});
    settlementConnection.release(); cancellationConnection.release();
  }
  console.log(JSON.stringify({ result: 'PASS', engine: version, migrationSha256: migrationHashes, nativeMultipleConnections: true,
    concurrentPreparations: 12, concurrentOriginalClaims: 12, concurrentCancellationClaims: 12,
    concurrentReplacementSettlements: 12, concurrentOriginalSettlements: 12,
    negativeEnvelopeChecks, browserAccessDenied: true, requestRoleCannotRewriteReviewOrAudit: true,
    unrelatedTableWritesDenied: true, immediateCrashRecovered: true, uncommittedRecoveryHashRolledBack: true,
    originalAndCancellationClaimsDurable: true, noSecondWalletClaim: true, canonicalReceiptStructureEnforced: true,
    exactCallSpeedUpKeepsOriginalHash: true,
    cancellationWaitsForConcurrentParentSettlement: true,
    productionDatabaseAccessed: false, publicChainTransactions: 0,
    limitation: 'Native journal durability and authorization proof; synthetic chain proofs do not validate a live registry transaction.' }, null, 2));
} finally {
  interrupted?.release(true);
  await closePools();
  if (started) await stop();
  await rm(directory, { recursive: true, force: true });
}
