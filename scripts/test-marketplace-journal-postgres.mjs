// Owns a fresh local cluster; never reads .env, a hosted DSN, or a running practice server.
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { withOwnedMarketplacePostgres } from './dev/marketplace/owned-postgres.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--owned-local-only') throw Error('Requires --owned-local-only; no external database mode exists.');
await withOwnedMarketplacePostgres(async ({ connectionString }) => {
  const child = spawn(process.execPath, ['--test', resolve('tests/marketplace-postgres-journal.test.mjs')], {
    stdio: 'inherit', env: { ...process.env, MARKETPLACE_TEST_DATABASE_URL: connectionString } });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) process.exitCode = 1;
});
