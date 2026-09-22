import { createForgeRpcClients } from '../../../broker/src/v4/skill-forge/rpc-clients.mjs';
import { createHolderInspection } from '../../../broker/src/v4/skill-forge/holder-inspection.mjs';

// Public endpoint has no journal, approval or burn mutation implementation.
export async function holderBurnRuntime(selection) {
  return createHolderInspection({ selection, clients: createForgeRpcClients() });
}
