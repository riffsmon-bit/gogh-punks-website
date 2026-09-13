import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import pg from 'pg';
const run = promisify(execFile), binaries = '/private/tmp/gogh-postgres-native/bin';

// No DSN argument, environment lookup, or connection to an existing cluster.
export async function withOwnedMarketplacePostgres(callback) {
  const directory = await mkdtemp('/private/tmp/gogh-marketplace-pg-');
  const data = join(directory, 'data'); let pool;
  try {
    const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    await run(join(binaries, 'initdb'), ['-D', data, '--auth=trust', '--no-locale', '--encoding=UTF8', '--no-sync']);
    await run(join(binaries, 'pg_ctl'), ['-D', data, '-l', join(directory, 'postgres.log'), '-o',
      `-h 127.0.0.1 -p ${port} -k ${directory} -c fsync=on -c synchronous_commit=on`, '-w', 'start']);
    await run(join(binaries, 'createdb'), ['-h', '127.0.0.1', '-p', String(port), 'gogh_marketplace_test']);
    const connectionString = `postgresql://127.0.0.1:${port}/gogh_marketplace_test`;
    pool = new pg.Pool({ connectionString, max: 2 });
    pool.on('error', () => {});
    const restart = () => run(join(binaries, 'pg_ctl'), ['-D', data, '-l', join(directory, 'postgres.log'), '-m', 'fast', '-w', 'restart']);
    return await callback({ pool, connectionString, restart });
  } finally {
    try { if (pool) await pool.end(); }
    finally {
      let running = false;
      try { running = (await stat(join(data, 'postmaster.pid'))).isFile(); } catch {}
      if (running) await run(join(binaries, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
      await rm(directory, { recursive: true, force: true });
    }
  }
}
