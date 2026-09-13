// Run explicitly with --disposable-only --postgres-bin=/path/to/local/bin.
// This harness creates its own loopback PostgreSQL cluster. No .env or remote DB.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';
import { readV2AiDatabasePrivileges } from "../netlify/functions/broker-v2-ai-check.mjs";
import { createDatabaseBackedGoghIntelligence } from '../netlify/functions/_shared/v2-ai-runtime.mjs';

if (process.argv.length !== 4 || process.argv[2] !== '--disposable-only'
  || !process.argv[3].startsWith('--postgres-bin=/')) throw Error('Explicit disposable-only local PostgreSQL binaries are required.');
const bin = process.argv[3].slice('--postgres-bin='.length);
const base = await mkdtemp(path.join(tmpdir(), 'gogh-ai-quota-'));
const data = path.join(base, 'data');
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const command = (name, args) => execFileSync(path.join(bin, name), args, { stdio: 'pipe', timeout: 30_000 });
const start = () => command('pg_ctl', ['-D', data, '-l', path.join(base, 'postgres.log'),
  '-o', `-h 127.0.0.1 -p ${port} -k ${base}`, '-w', 'start']);
const stop = () => command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
let running = false, admin, pool;
const config = { host: '127.0.0.1', port, database: 'postgres', user: 'gogh_ai_test',
  max: 16, connectionTimeoutMillis: 3_000, idleTimeoutMillis: 1_000 };
const environment = { GOGH_OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'local-mock-no-provider-key',
  GOGH_BANKR_MODEL: 'test-route', BANKR_API_KEY: 'local-mock-no-gateway-key' };
let calls = 0;
const mockFetch = async url => {
  calls++;
  assert.equal(url, 'https://api.openai.com/v1/responses');
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message',
    content: [{ type: 'output_text', text: 'Complete test reply.' }] }], usage: { input_tokens: 2, output_tokens: 4 } }));
};
let assertions = 0;
const check = (value, label) => { assert.ok(value, label); assertions++; };
const count = async where => (await pool.query(`SELECT COUNT(*)::integer AS count FROM broker_v2_provider_usage ${where ?? ''}`)).rows[0].count;
try {
  command('initdb', ['-D', data, '-A', 'trust', '-U', 'gogh_ai_test', '--no-locale']);
  start(); running = true;
  admin = new pg.Pool(config);
  const original = await readFile(new URL('../netlify/database/migrations/20260906010000_create_art_broker_v2.sql', import.meta.url), 'utf8');
  await admin.query(original.slice(original.indexOf('CREATE TABLE IF NOT EXISTS broker_v2_model_registry'),
    original.indexOf('CREATE TABLE IF NOT EXISTS broker_v2_legacy_links')));
  const added = await readFile(new URL('../netlify/database/migrations/20260906030000_add_v2_punk_skills.sql', import.meta.url), 'utf8');
  await admin.query(added.slice(0, added.indexOf('CREATE TABLE IF NOT EXISTS broker_v2_punk_skills')));
  await admin.query('CREATE ROLE ai_request_role LOGIN');
  await admin.query('GRANT CONNECT ON DATABASE postgres TO ai_request_role');
  await admin.query('GRANT USAGE ON SCHEMA public TO ai_request_role');
  await admin.query('GRANT SELECT, INSERT, UPDATE ON broker_v2_model_registry, broker_v2_provider_usage TO ai_request_role');
  pool = new pg.Pool({ ...config, user: 'ai_request_role' });
  check(Object.values(await readV2AiDatabasePrivileges(pool)).every(x => x === true), "Actual request connection verifies all required SQL grants");
  const runtimes = Array.from({ length: 8 }, () => createDatabaseBackedGoghIntelligence(pool, environment, mockFetch));
  const run = (owner, punk, i) => runtimes[i % runtimes.length].router.run('CHAT', { prompt: 'Local fixture.' },
    { ownerFingerprint: owner, punkTokenId: String(punk), preference: 'OPENAI' });
  const started = performance.now();
  const one = await Promise.allSettled(Array.from({ length: 60 }, (_, i) => run('same-owner', 93, i)));
  check(one.filter(x => x.status === 'fulfilled').length === 25, 'Exactly 25 same-Punk attempts across concurrent runtimes');
  check(one.filter(x => x.status === 'rejected').every(x => x.reason.code === 'AI_QUOTA_EXCEEDED'), 'All denied attempts report quota');
  check(calls === 25 && await count() === 25, 'No provider call before committed allowance and exactly one row per attempt');
  const many = await Promise.allSettled(Array.from({ length: 120 }, (_, i) => run('same-owner', 100 + Math.floor(i / 20), i)));
  check(many.filter(x => x.status === 'fulfilled').length === 75, 'Owner limit is 100 across multiple Punks');
  check(calls === 100 && await count() === 100, 'Fallback-independent owner cap is durable');
  check((await run('another-owner', 93, 0)).provider === 'OPENAI', 'Different current owner has an independent quota');
  check(await count("WHERE input_tokens = 2 AND output_tokens = 4 AND result_code = 'OK' AND estimated_cost_microusd IS NULL") === 101,
    'Exact token usage and unknown price preserved without duplicate usage inserts');
  const context = { task: 'CHAT', registryKey: 'openai:auto', provider: 'OPENAI', ownerFingerprint: 'crash-owner', punkTokenId: '94' };
  const quota = runtimes[0].router.quota;
  const reservation = await quota.consume(context);
  check(typeof reservation === 'string' && await count("WHERE result_code = 'RESERVED' AND input_tokens IS NULL AND estimated_cost_microusd IS NULL") === 1,
    'Crash before or during network remains an uncertain reserved attempt with unknown usage');
  await pool.end(); pool = null; await admin.end(); admin = null;
  stop(); running = false; start(); running = true;
  admin = new pg.Pool(config); pool = new pg.Pool({ ...config, user: 'ai_request_role' });
  check(await count("WHERE result_code = 'RESERVED'") === 1, 'Reservation survives a real database disk restart');
  const resumed = createDatabaseBackedGoghIntelligence(pool, environment, mockFetch);
  const finish = { ...context, reservationId: reservation, resultCode: 'PROVIDER_TIMEOUT' };
  await resumed.router.usage.record(finish);
  check(await count("WHERE result_code = 'PROVIDER_TIMEOUT'") === 1, 'Restart reconciles the same reservation without inserting another row');
  await assert.rejects(resumed.router.usage.record(finish), { code: 'AI_USAGE_RESERVATION_MISMATCH' }); assertions++;
  const next = await resumed.router.quota.consume(context);
  await assert.rejects(resumed.router.usage.record({ ...finish, reservationId: next, ownerFingerprint: 'different-owner' }),
    { code: 'AI_USAGE_RESERVATION_MISMATCH' }); assertions++;
  check(await count("WHERE result_code = 'RESERVED'") === 1, 'Wrong owner cannot finalize another reservation');
  const before = calls;
  await assert.rejects(resumed.router.run('CHAT', { prompt: 'Invalid.' }, { punkTokenId: '93' })); assertions++;
  check(calls === before, 'Malformed quota identity cannot call a provider');
  await admin.query("UPDATE broker_v2_provider_usage SET occurred_at = NOW() - INTERVAL '25 hours' WHERE result_code = 'OK'");
  check((await resumed.router.run('CHAT', { prompt: 'After window.' },
    { ownerFingerprint: 'same-owner', punkTokenId: '93', preference: 'OPENAI' })).provider === 'OPENAI', 'Rolling 24-hour window expires historic attempts');
  const fallbackCalls = [];
  const fallback = createDatabaseBackedGoghIntelligence(pool, environment, async url => {
    fallbackCalls.push(url);
    if (url.includes('openai.com')) return new Response('busy', { status: 503 });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Fallback reply.' } }] }));
  });
  const baseline = await count();
  await fallback.router.run('CHAT', { prompt: 'Fallback.' }, { ownerFingerprint: 'fallback-owner', punkTokenId: '95' });
  check(fallbackCalls.length === 2 && await count() === baseline + 2, 'Failed attempt and fallback each reserve and retain one quota row');
  check(await count("WHERE result_code = 'PROVIDER_REQUEST_FAILED' AND input_tokens IS NULL") === 1, 'Failed generation is counted without fabricating zero-token cost');
  await admin.query('REVOKE UPDATE ON broker_v2_provider_usage FROM ai_request_role');
  const reducedPrivileges = await readV2AiDatabasePrivileges(pool);
  check(reducedPrivileges.usageUpdate === false && reducedPrivileges.usageSelect === true && reducedPrivileges.usageInsert === true, "Actual pool privilege probe detects revoked UPDATE without granting access");
  const deniedCalls = [];
  const noUpdate = createDatabaseBackedGoghIntelligence(pool, environment, async url => { deniedCalls.push(url); return mockFetch(url); });
  await assert.rejects(noUpdate.router.run('CHAT', { prompt: 'Role proof.' }, { ownerFingerprint: 'restricted-owner', punkTokenId: '96' })); assertions++;
  check(deniedCalls.length === 1, 'Usage UPDATE privilege failure does not generate another paid answer');
  await admin.query('REVOKE INSERT ON broker_v2_provider_usage FROM ai_request_role');
  await assert.rejects(noUpdate.router.run('CHAT', { prompt: 'Role proof.' }, { ownerFingerprint: 'restricted-owner', punkTokenId: '96' })); assertions++;
  check(deniedCalls.length === 1, 'Reservation INSERT privilege failure blocks network entirely');
  console.log(JSON.stringify({ schema: 'GOGH_AI_QUOTA_DISPOSABLE_POSTGRES_V1', ok: true, assertions,
    concurrentSamePunkRequests: 60, samePunkAccepted: 25, additionalOwnerRequests: 120, additionalOwnerAccepted: 75,
    elapsedMs: Math.round(performance.now() - started), nativeMultiSession: true, durableDiskRestart: true,
    limitedRoleTested: true, productionDatabaseUsed: false, liveProviderCalls: 0 }, null, 2));
} finally {
  await pool?.end(); await admin?.end();
  if (running) stop();
  await rm(base, { recursive: true, force: true });
}
