import { createMarketplaceCoordinator } from '../../../broker/src/v4/marketplace/durable-coordinator.mjs';
import { currentMarketplaceRelease, validateMarketplaceRelease } from '../../../broker/src/v4/marketplace/durable-release.mjs';
import { createMarketplaceStore, verifyMarketplaceDatabaseRole } from '../../../broker/src/v4/marketplace/postgres-journal-store.mjs';
import { marketplaceAssert } from '../../../broker/src/v4/marketplace/durable-journal.mjs';

export { currentMarketplaceRelease };

// The production constructor intentionally has no database/RPC/environment switch.
// No reviewed purchase guard, signed-order source, authoritative screen, or shared
// policy/skill adapter is configured yet. Research remains available elsewhere.
export async function marketplaceRuntime() {
  const release = currentMarketplaceRelease();
  return { release, coordinator: createMarketplaceCoordinator({ release }) };
}

// Concrete server composition seam for a future reviewed release. The request
// handler never accepts these values. Paused releases retain original recovery.
export async function createReviewedMarketplaceRuntime({ release, pool, deps }) {
  const readRelease = () => validateMarketplaceRelease(typeof release === 'function' ? release() : release);
  const r = readRelease();
  marketplaceAssert(pool && deps?.client && deps.client.ccipRead === false && typeof deps.client.getTransaction === 'function'
    && typeof deps.client.getTransactionReceipt === 'function', 'MARKETPLACE_RECOVERY_DEPENDENCIES_REQUIRED');
  if (r.status === 'OWNER_ASSIST') {
    marketplaceAssert(['loadListings', 'screenCollection', 'policyEvidence'].every(key => typeof deps[key] === 'function'), 'MARKETPLACE_REVIEW_DEPENDENCIES_REQUIRED');
    if (r.purchaseGuardDeployment.environment === 'OWNED_DISPOSABLE_CHAIN') {
      marketplaceAssert(typeof deps.assertDisposable === 'function', 'DISPOSABLE_CHAIN_REQUIRED');
      await deps.assertDisposable();
    }
  }
  await verifyMarketplaceDatabaseRole(pool);
  const store = createMarketplaceStore(pool);
  return { release: r, store, coordinator: createMarketplaceCoordinator({ store, release: readRelease, deps }) };
}
