// Fixed SQL only, reviewed against repository migrations. This inventory is NOT
// a production clear certificate: on-chain canary refunds and bid indexing have
// separate required checks. Missing pools/tables/permissions remain UNKNOWN.
const token = source => [source.selection.sourceTokenId];
const wallets = source => [source.wallets.map(w => w.address)];
const descriptor = (name, pool, table, predicate, parameters = token) => Object.freeze({
  name, pool, table, sql: `SELECT count(*)::text AS count FROM ${table} WHERE ${predicate}`, parameters,
  remediation: name === 'REFUNDS' ? 'Recover or withdraw the unused mission funds before sacrifice.'
    : name === 'TRAINING' ? 'Finish or recover this Punk’s outstanding Forge review.'
      : 'Pause or resolve the attached activity, then recheck this Punk.',
});
export const HOLDER_DATABASE_OBLIGATION_DESCRIPTORS = Object.freeze([
  descriptor('AUTOMATION', 'application', 'broker_v2_agent_sessions', "punk_token_id=$1::numeric AND status IN ('PENDING_RECEIPT','ACTIVE','PAUSED')"),
  descriptor('AUTOMATION', 'application', 'broker_v2_strategies', "token_id=$1::numeric AND state='ACTIVE'"),
  descriptor('AUTOMATION', 'application', 'broker_automation_v3_enrollments', 'token_id=$1::numeric'),
  descriptor('AUTOMATION', 'application', 'broker_scouting_schedules', 'token_id=$1::numeric AND enabled=true'),
  descriptor('AUTOMATION', 'application', 'broker_v4_punk_policy_proposals', "punk_token_id=$1::numeric AND state IN ('OWNER_AUTHORIZED','ACTIVE')"),
  descriptor('AUTOMATION', 'application', 'broker_v2_persistent_watches', "token_id=$1 AND state='ACTIVE'"),
  descriptor('AUTOMATION', 'application', 'broker_agent_authorizations', 'lower(account_address)=ANY($1::text[]) AND active=true', wallets),
  descriptor('MISSIONS', 'application', 'broker_directed_mint_intents', 'punk_token_id=$1::numeric AND consumed_at IS NULL AND expires_at>now()'),
  descriptor('MISSIONS', 'application', 'broker_paid_mint_jobs', "punk_token_id=$1::numeric AND status IN ('RESERVED','REORGED')"),
  descriptor('TRANSACTIONS', 'application', 'broker_v2_execution_attempts', "punk_token_id=$1::numeric AND state NOT IN ('CONFIRMED','REVERTED','REJECTED','CANCELLED','EXPIRED')"),
  Object.freeze({ name: 'TRANSACTIONS', pool: 'application', table: 'broker_v2_agent_user_operations', parameters: token,
    sql: "SELECT count(*)::text AS count FROM broker_v2_agent_user_operations o JOIN broker_v2_agent_sessions s USING(session_id) WHERE s.punk_token_id=$1::numeric AND o.state NOT IN ('CONFIRMED','REVERTED','REJECTED')",
    remediation: 'Wait for the Agent wallet’s original pending operation to be reconciled.' }),
  descriptor('TRANSACTIONS', 'application', 'broker_v4_execution_attempts', "punk_token_id=$1::numeric AND state NOT IN ('CONFIRMED','SAFE_FAILURE','CANCELLED')"),
  descriptor('TRANSACTIONS', 'application', 'broker_proposals', "lower(account_address)=ANY($1::text[]) AND status IN ('PENDING','APPROVED')", wallets),
  descriptor('TRANSACTIONS', 'application', 'broker_canary_execution_reviews', 'punk_token_id=$1::numeric AND revoked_at IS NULL AND expires_at>now()'),
  descriptor('PURCHASES', 'training', 'broker_marketplace_reviews', "punk_id=$1 AND status IN ('PREPARED','WALLET_REQUESTED')"),
  descriptor('TRAINING', 'training', 'broker_forge_training_intents', "punk_token_id=$1::numeric AND status NOT IN ('SETTLED_SUCCESS','SETTLED_REVERT','EXPIRED','CANCELLED')"),
  descriptor('TRAINING', 'application', 'broker_forge_training_intents', "punk_token_id=$1::numeric AND status NOT IN ('SETTLED_SUCCESS','SETTLED_REVERT','EXPIRED','CANCELLED')"),
  descriptor('TRAINING', 'training', 'broker_selected_burn_reviews', "(review_json::jsonb#>>'{state,sourceTokenId}'=$1 OR review_json::jsonb#>>'{state,targetTokenId}'=$1) AND status IN ('PREPARED','WALLET_REQUESTED')"),
  descriptor('TRAINING', 'holder', 'broker_holder_burn_reviews', "(source_token_id=$1 OR target_token_id=$1) AND status IN ('PREPARED','WALLET_REQUESTED') AND ($2::text IS NULL OR intent_id<>$2)", source => [source.selection.sourceTokenId, source.excludeIntentId ?? null]),
  descriptor('MISSIONS', 'training', 'broker_selected_paid_reviews', "review_json::jsonb->>'tokenId'=$1 AND status IN ('PREPARED','WALLET_REQUESTED')"),
  Object.freeze({ name: 'TRANSACTIONS', pool: 'training', table: 'broker_selected_paid_executions', parameters: token,
    sql: "SELECT count(*)::text AS count FROM broker_selected_paid_executions e JOIN broker_selected_paid_reviews r USING(intent_id) WHERE r.review_json::jsonb->>'tokenId'=$1 AND e.status IN ('SIGNED','SUBMITTED')",
    remediation: 'Recover the original paid-mint transaction before considering sacrifice.' }),
  // Function must count across old owners too; owner-filtered RLS alone is not
  // enough after a transfer. Missing function is UNKNOWN, never an empty table.
  Object.freeze({ name: 'PURCHASES', pool: 'training', table: 'broker_public_paid_reviews', parameters: token,
    sql: 'SELECT broker_public_paid_pending_for_token($1::text)::text AS count',
    remediation: 'Finish, cancel or recover the public paid-mint review for this Punk.' }),
  descriptor('REFUNDS', 'legacy', 'gogh_broker_punk_agent_gas_accounts', 'punk_token_id=$1::numeric AND credited_wei>spent_wei'),
  descriptor('REFUNDS', 'legacy', 'gogh_broker_punk_agent_gas_refunds', "punk_token_id=$1::numeric AND state<>'CONFIRMED'"),
  descriptor('REFUNDS', 'legacy', 'gogh_broker_legacy_reconciliation_entries', 'punk_token_id=$1::numeric AND remaining_user_balance_wei>0'),
  descriptor('LEGACY', 'legacy', 'gogh_broker_punk_jobs', "punk_token_id=$1::numeric AND state IN ('QUEUED','LEASED','RETRY')"),
  descriptor('LEGACY', 'legacy', 'gogh_broker_punk_priority_sessions', "punk_token_id=$1::numeric AND state='ACTIVE'"),
  descriptor('LEGACY', 'legacy', 'gogh_broker_punk_state', "punk_token_id=$1::numeric AND (authorization_status='AUTHORIZED' OR worker_state IN ('QUEUED','SCANNING','VERIFYING','SIMULATING','MINTING'))"),
  // Priority attempts and reconciliation entries need their canonical receipt/
  // payout evidence before terminal rows can be waived; retain conservative hold.
  descriptor('LEGACY', 'legacy', 'gogh_broker_punk_priority_attempts', 'lower(account_address)=ANY($1::text[])', wallets),
]);

export const HOLDER_REQUIRED_EXTERNAL_OBLIGATIONS = Object.freeze([
  { name: 'BIDS', reason: 'A complete canonical pending-bid index and escrow refund observation are required; current public bids remain disabled.' },
  { name: 'REFUNDS', reason: 'Selected paid-mint vault mission/refund balances must be read at the same chain anchor; a completed database review does not prove the escrow is empty.' },
  { name: 'TRANSACTIONS', reason: 'Account EntryPoint nonce/session checks and all pending journals must remain covered after new execution features are released.' },
]);
