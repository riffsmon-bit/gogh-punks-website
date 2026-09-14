import { createPublicClient, http } from 'viem';
import deployment from '../../../deployments/robinhood-punk-agent-account.json' with { type: 'json' };
import { readPunkAgentAccountRuntime } from '../../../broker/src/agent-account/punk-agent-account-runtime.mjs';
import { createPersistentWatchStore, assertPersistentWatchVersion, assertPersistentWatchStorageScope } from '../../../broker/src/v4/autonomy/persistent-store.mjs';
import { createPersistentWatchCoordinator } from '../../../broker/src/v4/autonomy/persistent-coordinator.mjs';
import { readPersistentOwnership, assertPersistentContinuity } from '../../../broker/src/v4/autonomy/persistent-ownership.mjs';
import { getRpcUrl } from './config.mjs';
import { createV2McpResearch } from './v2-mcp-research.mjs';

export { assertPersistentWatchVersion };
export function createPersistentWatchRuntime({ pool, environment = process.env,
  client = createPublicClient({ transport: http(getRpcUrl(), { timeout: 8000, retryCount: 0 }) }),
  now = Date.now, readSkills = createV2McpResearch({ pool, environment }).resolve,
} = {}) {
  const store = createPersistentWatchStore(pool);
  const readAuthority = (tokenId, options = {}) => readPersistentOwnership({ client, tokenId, ...options, now });
  const readContinuity = (before, after) => assertPersistentContinuity({ client, before, after, now });
  const readEconomics = async ({ tokenId, owner, anchor }) => {
    const blockNumber = BigInt(anchor.blockNumber);
    const pinned = { getChainId: () => client.getChainId(),
      readContract: query => client.readContract({ ...query, blockNumber }),
      getCode: query => client.getCode({ ...query, blockNumber }),
      getBalance: query => client.getBalance({ ...query, blockNumber }) };
    const runtime = await readPunkAgentAccountRuntime({ client: pinned, deployment, tokenId, expectedOwner: owner });
    if (!runtime.accountCreated) return { verified: false };
    let skills = null;
    try { skills = await readSkills({ tokenId, owner }); } catch { /* Unavailable is not an empty/approved loadout. */ }
    const closing = await client.getBlock({ blockNumber });
    if (closing.hash !== anchor.blockHash || now() - anchor.checkedAt > 30000) return { verified: false };
    const session = runtime.session;
    return { verified: true, balanceWei: runtime.nativeBalance.toString(), reserveWei: session.minimumNativeReserveWei.toString(),
      sessionActive: runtime.sessionActive, sessionExpiresAt: Number(session.validUntil) * 1000,
      remainingMints: Number(session.remainingMints), skillVerified: skills !== null,
      mintHunterEquipped: skills?.effectiveMcpTools?.includes('prepare_mint') === true,
      // Read-only watching is not an accounting authority. The existing execution lane must verify these per candidate.
      usageVerified: false, pendingSpendWei: null, globalExecutionPaused: true,
      utcDay: new Date(now()).toISOString().slice(0, 10) };
  };
  const implementation = createPersistentWatchCoordinator({ store, readAuthority, readContinuity, readEconomics, now });
  let ready;
  const coordinator = Object.fromEntries(Object.entries(implementation).map(([name, method]) => [name, async (...args) => {
    ready ??= assertPersistentWatchStorageScope(pool); await ready;
    if (name === 'batch') {
      const scope = await pool.query("SELECT NOT row_security_active('broker_v2_opportunities'::regclass) AND has_table_privilege(current_user,'broker_v2_opportunities','SELECT') AS complete");
      if (scope.rows[0]?.complete !== true) throw Error('WATCH_DISCOVERY_SCOPE_UNAVAILABLE');
    }
    return method(...args);
  }]));
  return { store, coordinator };
}

// Call ONCE from the existing shared discovery tick, including idle ticks. No separate schedule/process.
export async function runPersistentWatchBatch({ pool, opportunities = [], environment = process.env,
  runtime = null, limit = 25, maxDurationMs = 45000, ...options } = {}) {
  if (environment.GOGH_V2_PERSISTENT_WATCH_ENABLED !== 'true') return {
    status: 'DISABLED', executionAuthorized: false, transactionSubmitted: false };
  return (runtime ?? createPersistentWatchRuntime({ pool, environment, ...options })).coordinator.batch({ opportunities, limit, maxDurationMs });
}
