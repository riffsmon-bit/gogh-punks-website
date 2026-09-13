-- Apply explicitly in the existing training database after the burn migration.
-- The authenticated request server verifies both public providers before receipt updates.
GRANT SELECT,INSERT ON broker_selected_burn_reviews TO forge_request;
GRANT UPDATE(revision,status,reported_hash,receipt) ON broker_selected_burn_reviews TO forge_request;
CREATE POLICY selected_burn_read ON broker_selected_burn_reviews FOR SELECT TO forge_request USING (true);
CREATE POLICY selected_burn_insert ON broker_selected_burn_reviews FOR INSERT TO forge_request WITH CHECK (status='PREPARED');
CREATE POLICY selected_burn_update ON broker_selected_burn_reviews FOR UPDATE TO forge_request
  USING (status IN ('PREPARED','WALLET_REQUESTED')) WITH CHECK (true);
REVOKE ALL ON broker_selected_burn_reviews,broker_selected_burn_events FROM anon,authenticated,service_role;

-- Return only counts for the fixed source Punk, including legacy operational
-- queues and prepaid-gas obligations in this database. No arbitrary SQL/input.
CREATE FUNCTION broker_selected_burn_obligations() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE counts jsonb := '{}'::jsonb; item record; n bigint;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('broker_forge_training_intents','punk_token_id'),
    ('gogh_broker_agent_activity','punk_token_id'),('gogh_broker_diagnostics','punk_token_id'),
    ('gogh_broker_legacy_reconciliation_entries','punk_token_id'),('gogh_broker_punk_agent_gas_accounts','punk_token_id'),
    ('gogh_broker_punk_agent_gas_deposits','punk_token_id'),('gogh_broker_punk_agent_gas_refunds','punk_token_id'),
    ('gogh_broker_punk_agent_gas_usage','punk_token_id'),('gogh_broker_punk_jobs','punk_token_id'),
    ('gogh_broker_punk_priority_sessions','punk_token_id'),('gogh_broker_punk_state','punk_token_id')
  ) AS checks(tab,col) LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text=$1',item.tab,item.col) INTO n USING '1753';
    counts := counts || jsonb_build_object(item.tab,n);
  END LOOP;
  SELECT count(*) INTO n FROM gogh_broker_punk_priority_attempts WHERE lower(account_address)=ANY(ARRAY[
    '0x0533a1172567e0e28a443f32db78fa990371f6be','0xa50ee88b8f1bfa8a08a7ecfe743930a5cf4dec96',
    '0xc735bbaaf79295a27cb66ac84bdc926a125602e2','0x56df53299941890500d44aba31dcb376b92e1b65']);
  RETURN counts || jsonb_build_object('gogh_broker_punk_priority_attempts',n);
END $$;
REVOKE ALL ON FUNCTION broker_selected_burn_obligations() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION broker_selected_burn_obligations() TO forge_request;
