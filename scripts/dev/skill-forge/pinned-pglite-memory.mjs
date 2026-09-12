import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { registerHooks } from 'node:module';

// DEV TEST ONLY. A pinned PostgreSQL/WASM engine, not an application dependency.
// Download, verify and load entirely in memory. No npm scripts, disk installation,
// production credentials, RPC, persistent database or wallet are involved.
export const PGLITE_TEST_VERSION = '0.5.8';
export const PGLITE_TEST_INTEGRITY = 'n9tsbUOhwx2epK1V0ZG9Ar4SHWUju04dhmzZXiSBXwBoleOvIfals33NAaWgagQVAL4Rbvx/Ptsu3P+pA09f6Q==';

export async function createPinnedMemoryPostgres() {
  const response = await fetch('https://registry.npmjs.org/@electric-sql/pglite/-/pglite-0.5.8.tgz',
    { signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (!response.ok || Number(response.headers.get('content-length')) > 12_000_000) throw Error('PGLITE_TEST_DOWNLOAD_FAILED');
  const compressed = Buffer.from(await response.arrayBuffer());
  if (compressed.length > 12_000_000
    || createHash('sha512').update(compressed).digest('base64') !== PGLITE_TEST_INTEGRITY) throw Error('PGLITE_TEST_INTEGRITY_FAILED');
  const tar = gunzipSync(compressed, { maxOutputLength: 32_000_000 });
  const files = new Map();
  for (let offset = 0; offset < tar.length && tar[offset];) {
    const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/s, '');
    const size = Number.parseInt(tar.subarray(offset + 124, offset + 136).toString(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw Error('PGLITE_TEST_ARCHIVE_INVALID');
    if (/^package\/dist\/[A-Za-z0-9_-]+\.(js|wasm|data)$/.test(name)) {
      if (files.has(name)) throw Error('PGLITE_TEST_ARCHIVE_DUPLICATE');
      files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const required = name => {
    const value = files.get(`package/dist/${name}`);
    if (!value) throw Error('PGLITE_TEST_ARTIFACT_MISSING'); return value;
  };
  // file: identity satisfies upstream createRequire(import.meta.url); the hooks serve
  // only integrity-verified JavaScript. Nothing is written at this virtual pathname.
  const base = 'file:///__gogh_pglite_memory_0_5_8__/dist/';
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith(base) || (context.parentURL?.startsWith(base) && specifier.startsWith('.'))) {
        const url = new URL(specifier, context.parentURL ?? base).href;
        if (!url.startsWith(base) || !files.has(`package/dist/${url.slice(base.length)}`)) throw Error('PGLITE_TEST_IMPORT_REJECTED');
        return { url, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith(base)) return { format: 'module', source: required(url.slice(base.length)), shortCircuit: true };
      return nextLoad(url, context);
    },
  });
  try {
    const { PGlite } = await import(`${base}index.js`);
    const db = await PGlite.create({ dataDir: 'memory://',
      pgliteWasmModule: await WebAssembly.compile(required('pglite.wasm')),
      initdbWasmModule: await WebAssembly.compile(required('initdb.wasm')),
      fsBundle: new Blob([required('pglite.data')]),
    });
    // PGlite has one exclusive connection. This mutex models pg.Pool checkout for
    // SQL/state-machine tests; it is NOT evidence of native multi-session locking.
    let tail = Promise.resolve();
    const pool = {
      async connect() {
        const previous = tail; let release;
        tail = new Promise(resolve => { release = resolve; });
        await previous;
        return { query: (sql, values) => db.query(sql, values), release };
      },
    };
    return { pool, exec: sql => db.exec(sql), query: (sql, values) => db.query(sql, values),
      async close() { await tail; await db.close(); hooks.deregister(); } };
  } catch (error) { hooks.deregister(); throw error; }
}
