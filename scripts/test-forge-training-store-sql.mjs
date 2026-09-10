import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runTrainingStoreSqlSuite } from './dev/skill-forge/training-store-sql-suite.mjs';

async function main() {
  if (process.argv.length !== 3 || !['--pglite-memory', '--local-postgres'].includes(process.argv[2])) {
    throw Error('Choose --pglite-memory or --local-postgres. No production-database mode exists.');
  }
  if (process.argv[2] === '--pglite-memory') {
    const { createPinnedMemoryPostgres, PGLITE_TEST_VERSION } = await import('./dev/skill-forge/pinned-pglite-memory.mjs');
    const database = await createPinnedMemoryPostgres();
    try {
      const result = await runTrainingStoreSqlSuite(database);
      console.log(JSON.stringify({ engine: `PostgreSQL WASM / PGlite ${PGLITE_TEST_VERSION}`,
        nativeMultiSessionTested: false, durableDiskRestartTested: false, ...result }, null, 2));
    } finally { await database.close(); }
    return;
  }
  // No implicit .env or Netlify secret loading, no default connection, no public host.
  const connectionString = process.env.FORGE_TEST_DATABASE_URL;
  if (!connectionString) throw Error('FORGE_TEST_DATABASE_URL must identify a disposable local test database.');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.pathname !== '/gogh_forge_test' || url.search) throw Error('Only loopback /gogh_forge_test without URL options is accepted.');
  const schema = `forge_test_${randomBytes(12).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000,
    application_name: 'gogh-forge-disposable-sql-test', options: `-c search_path=${schema},public` });
  let created = false;
  try {
    const identity = await pool.query('SELECT current_database() AS name, inet_server_addr()::text AS address');
    if (identity.rows[0]?.name !== 'gogh_forge_test' || !['127.0.0.1/32', '127.0.0.1', '::1/128', '::1'].includes(identity.rows[0]?.address)) {
      throw Error('Disposable local database identity check failed.');
    }
    await pool.query(`CREATE SCHEMA ${schema}`); created = true;
    const result = await runTrainingStoreSqlSuite({ pool, exec: sql => pool.query(sql), query: (sql, values) => pool.query(sql, values) });
    console.log(JSON.stringify({ engine: 'native PostgreSQL', nativeMultiSessionTested: true,
      durableDiskRestartTested: false, ...result }, null, 2));
  } finally {
    // This exact randomly generated schema contains only this run's disposable data.
    try { if (created) await pool.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await pool.end(); }
  }
}

main().catch(error => {
  // Avoid printing connection details or SQL parameter dumps from a database driver.
  console.error(`Forge SQL test failed: ${error.code ?? 'TEST_ERROR'}: ${String(error.message).slice(0, 400)}`);
  process.exitCode = 1;
});
