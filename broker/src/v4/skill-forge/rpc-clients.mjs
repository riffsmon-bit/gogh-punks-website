import { createPublicClient, http } from 'viem';
import { resolveRobinhoodRpcPair } from '../../infrastructure/robinhood-rpc-endpoints.mjs';

// Server configuration only. Never accept these URLs from a request or send
// them to the browser. Both independent hosts are required for receipt checks.
export function resolveForgeRpcPair(environment = process.env) {
  try {
    return resolveRobinhoodRpcPair({
      ROBINHOOD_RPC_URL: environment.ROBINHOOD_ARCHIVE_RPC_URL
        ?? environment.ROBINHOOD_RPC_URL ?? environment.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com',
      ROBINHOOD_SECONDARY_RPC_URL: environment.ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL
        ?? environment.ROBINHOOD_SECONDARY_RPC_URL ?? 'https://robinhood-rpc.publicnode.com',
    });
  } catch {
    // A malformed credential must not leak in an exception or silently fall
    // back to a provider whose historical reads have not been configured.
    throw Error('FORGE_RPC_CONFIGURATION_UNAVAILABLE');
  }
}

export function createForgeRpcClients(environment = process.env, { clientFactory = createPublicClient, transportFactory = http } = {}) {
  const pair = resolveForgeRpcPair(environment);
  // Existing coordinator code selects index 1 for authoritative state reads.
  // Preserve that contract while giving it the configured archive primary.
  return [pair.secondary, pair.primary].map(url => clientFactory({ cacheTime: 0, ccipRead: false,
    transport: transportFactory(url, { timeout: 6000, retryCount: 0, batch: { batchSize: 20, wait: 5 },
      fetchOptions: { redirect: 'error' } }),
  }));
}
