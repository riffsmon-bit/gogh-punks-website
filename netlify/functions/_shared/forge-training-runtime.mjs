import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, http } from 'viem';
import releaseArtifact from '../../../deployments/robinhood-forge-training.json' with { type: 'json' };
import { validateTrainingRelease, trainingDeploymentBinding } from '../../../broker/src/v4/skill-forge/training-release.mjs';
import { verifyTrainingDatabaseRole } from '../../../broker/src/v4/skill-forge/training-database-role.mjs';
import { createPostgresTrainingStore } from '../../../broker/src/v4/skill-forge/postgres-training-store.mjs';
import { createTrainingCoordinator } from '../../../broker/src/v4/skill-forge/training-coordinator.mjs';
import { buildFrozenAllocation, FROZEN_RARITY_HASH } from '../../../broker/src/v4/skill-forge/rarity-allocation.mjs';

const pools = new Map(); let frozen;
export const currentTrainingRelease = () => validateTrainingRelease(releaseArtifact);
async function allocationReader(tokenId) {
  if (!frozen) {
    const envelope = JSON.parse(await readFile(resolve(process.cwd(),
      `artifacts/skill-forge/rarity/gogh-opensea-rarity-${FROZEN_RARITY_HASH}.json`),'utf8'));
    frozen = { tree: buildFrozenAllocation(envelope), records: envelope.payload.records };
  }
  const item = frozen.records.find(record => String(record.tokenId) === tokenId);
  if (!item) throw Error('FORGE_TRAINING_RARITY_UNAVAILABLE');
  return { startingSlots: item.startingSlots, proof: frozen.tree.proof(tokenId) };
}

// No fallback to the broad application credential. Neither connection string is
// logged or returned; the release file must already authorize the owner canary.
export async function forgeTrainingRuntime(role, environment = process.env) {
  const release = currentTrainingRelease();
  if (release.status !== 'OWNER_CANARY' && !(role==='worker' && release.status==='PAUSED')) throw Error('FORGE_TRAINING_NOT_RELEASED');
  if (!['request','worker'].includes(role)) throw Error('FORGE_TRAINING_DATABASE_ROLE_INVALID');
  const key = role === 'request' ? 'FORGE_TRAINING_REQUEST_DATABASE_URL' : 'FORGE_TRAINING_WORKER_DATABASE_URL';
  const connectionString = environment[key];
  if (typeof connectionString !== 'string' || !connectionString) throw Error('FORGE_TRAINING_DATABASE_UNAVAILABLE');
  const address = new URL(connectionString);
  if (!['postgres:','postgresql:'].includes(address.protocol) || !address.hostname || !address.username || !address.password
    || ['localhost','127.0.0.1','[::1]'].includes(address.hostname)) throw Error('FORGE_TRAINING_DATABASE_UNAVAILABLE');
  let pool = pools.get(role);
  if (!pool) {
    // Parse connection identity explicitly so URI query parameters cannot weaken TLS or set a search_path.
    if (address.search) throw Error('FORGE_TRAINING_DATABASE_URL_OPTIONS_UNSUPPORTED');
    pool = new pg.Pool({ host: address.hostname, port: Number(address.port || 5432),
      database: decodeURIComponent(address.pathname.slice(1)), user: decodeURIComponent(address.username),
      password: decodeURIComponent(address.password), ssl: { rejectUnauthorized: true }, max: 2,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
      options: '-c search_path=public -c statement_timeout=10000 -c lock_timeout=3000',
      application_name: `gogh-forge-${role}` });
    pool.on('error', () => {}); pools.set(role,pool);
  }
  await verifyTrainingDatabaseRole(pool,role);
  const clients = ['https://robinhood-rpc.publicnode.com','https://rpc.mainnet.chain.robinhood.com'].map(url =>
    createPublicClient({ transport: http(url,{ timeout: 5000,retryCount: 0 }), cacheTime: 0 }));
  const store = createPostgresTrainingStore({ pool, deployment: trainingDeploymentBinding(release) });
  return { release,clients,store, ...(role === 'request' ? {
    coordinator: createTrainingCoordinator({ pool, storeFactory: createPostgresTrainingStore,
      client: clients[1],release,allocationReader }),
  } : {}) };
}
