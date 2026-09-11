// Runtime verification complements the migration's default-deny RLS. Request and
// reconciliation credentials must be separately provisioned restricted server roles.
export async function verifyTrainingDatabaseRole(pool, role) {
  if (!['request','worker'].includes(role)) throw Error('FORGE_TRAINING_DATABASE_ROLE_INVALID');
  const result = await pool.query(`SELECT r.rolsuper,r.rolbypassrls,
    pg_has_role(current_user,c.relowner,'USAGE') AS owns_intents,
    c.relrowsecurity AS intents_rls,
    has_table_privilege(current_user,c.oid,'SELECT') AS reads_intents,
    has_table_privilege(current_user,c.oid,'INSERT') AS inserts_intents,
    has_column_privilege(current_user,c.oid,'status','UPDATE') AS writes_status,
    has_column_privilege(current_user,c.oid,'settlement','UPDATE') AS writes_settlement,
    has_table_privilege(current_user,c.oid,'DELETE') AS deletes_intents,
    has_table_privilege(current_user,e.oid,'INSERT,UPDATE,DELETE,TRUNCATE') AS writes_audit,
    pg_has_role(current_user,e.relowner,'USAGE') AS owns_audit,
    e.relrowsecurity AS audit_rls,j.relrowsecurity AS jobs_rls,
    has_table_privilege(current_user,j.oid,'SELECT') AS reads_jobs,
    has_table_privilege(current_user,j.oid,'UPDATE') AS writes_jobs,
    pg_has_role(current_user,j.relowner,'USAGE') AS owns_jobs
    FROM pg_roles r,pg_class c,pg_class e,pg_class j
    WHERE r.rolname=current_user AND c.oid='public.broker_forge_training_intents'::regclass
      AND e.oid='public.broker_forge_training_intent_events'::regclass
      AND j.oid='public.broker_forge_training_reconciliation_jobs'::regclass`);
  const state = result.rows[0];
  if (result.rows.length !== 1 || !state || state.rolsuper !== false || state.rolbypassrls !== false
    || state.owns_intents !== false || state.owns_audit !== false || state.owns_jobs !== false
    || state.intents_rls !== true || state.audit_rls !== true || state.jobs_rls !== true
    || state.reads_intents !== true || state.writes_status !== true || state.deletes_intents !== false
    || state.writes_audit !== false || state.inserts_intents !== (role === 'request')
    || state.writes_settlement !== (role === 'worker') || state.reads_jobs !== (role === 'worker')
    || state.writes_jobs !== (role === 'worker')) throw Error('FORGE_TRAINING_DATABASE_ROLE_INVALID');
  return true;
}
