import { createForgeRpcClients } from '../../../broker/src/v4/skill-forge/rpc-clients.mjs';
import { createHolderBurnCoordinator } from '../../../broker/src/v4/skill-forge/holder-coordinator.mjs';
import { createHolderBurnStore, createHolderHistoryStore } from '../../../broker/src/v4/skill-forge/holder-store.mjs';
import { createHolderHistoryScanner } from '../../../broker/src/v4/skill-forge/holder-history.mjs';
import { holderBurnSelection } from '../../../broker/src/v4/skill-forge/holder-source.mjs';

// Parent release composition supplies reviewed immutable pins, restricted pool,
// fixed positive control and authoritative application/legacy readers. Never
// fall back to the broad application database credential for this journal.
export function createHolderBurnRuntimeFactory({ releaseReader, journalPool, checkObligations, positiveControl,
  clientsFactory = createForgeRpcClients }) {
  return async ({ owner, sourceTokenId, targetTokenId }) => {
    const selection = holderBurnSelection(owner, sourceTokenId, targetTokenId), release = releaseReader();
    if (!release || !['TESTING', 'LIVE', 'PAUSED'].includes(release.status)) throw Error('HOLDER_BURN_NOT_RELEASED');
    const pool = await journalPool();
    const row = (await pool.query(`SELECT
      (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS privileged,
      (SELECT count(*) FROM pg_class WHERE oid=ANY(ARRAY['broker_holder_burn_reviews'::regclass,
        'broker_holder_burn_events'::regclass,'broker_holder_asset_history'::regclass,'broker_holder_history_resets'::regclass]) AND relrowsecurity) AS protected,
      (SELECT bool_or(pg_has_role(current_user,relowner,'USAGE')) FROM pg_class WHERE oid=ANY(ARRAY[
        'broker_holder_burn_reviews'::regclass,'broker_holder_burn_events'::regclass,'broker_holder_asset_history'::regclass,
        'broker_holder_history_resets'::regclass])) AS owns,
      has_table_privilege(current_user,'broker_holder_burn_reviews','DELETE') OR
        has_table_privilege(current_user,'broker_holder_asset_history','DELETE') AS deletes,
      has_table_privilege(current_user,'broker_holder_burn_events','INSERT,UPDATE,DELETE') OR
        has_table_privilege(current_user,'broker_holder_history_resets','INSERT,UPDATE,DELETE') AS audit_writes,
      current_setting('synchronous_commit') AS synchronous_commit`)).rows[0];
    if (!row || row.privileged !== false || String(row.protected) !== '4' || row.owns !== false || row.deletes !== false || row.audit_writes !== false
      || row.synchronous_commit !== 'on') throw Error('HOLDER_BURN_DATABASE_ROLE_INVALID');
    const clients = clientsFactory(), store = createHolderBurnStore(pool, selection);
    const historyScanner = createHolderHistoryScanner({ clients, store: createHolderHistoryStore(pool), positiveControl });
    return createHolderBurnCoordinator({ clients, release, store, selection, historyScanner, checkObligations });
  };
}
