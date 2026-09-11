-- REVIEWED PROVISIONING TEMPLATE, NOT AN AUTOMATIC MIGRATION.
-- Apply only after the two training-intent migrations, as the migration owner.
-- These restricted group roles cannot log in. Provision separate server-only
-- login principals with INHERIT membership in exactly one of these roles.
-- Do not give browser, public/anon, broad app, or migration credentials membership.
-- No passwords or connection strings belong in this file.

CREATE ROLE forge_request NOLOGIN;
CREATE ROLE forge_worker NOLOGIN;
GRANT USAGE ON SCHEMA public TO forge_request,forge_worker;
GRANT SELECT,INSERT ON broker_forge_training_intents TO forge_request;
GRANT UPDATE(status,revision,transaction_hash,observation) ON broker_forge_training_intents TO forge_request;
GRANT SELECT,UPDATE ON broker_forge_training_intents TO forge_worker;
GRANT SELECT,UPDATE ON broker_forge_training_reconciliation_jobs TO forge_worker;
CREATE POLICY request_read ON broker_forge_training_intents FOR SELECT TO forge_request USING (true);
CREATE POLICY request_insert ON broker_forge_training_intents FOR INSERT TO forge_request WITH CHECK (status='PREPARED');
CREATE POLICY request_update ON broker_forge_training_intents FOR UPDATE TO forge_request
  USING (status IN ('PREPARED','WALLET_REQUESTED','SUBMISSION_UNKNOWN','SUBMITTED'))
  WITH CHECK (status IN ('WALLET_REQUESTED','SUBMISSION_UNKNOWN','SUBMITTED','EXPIRED','CANCELLED'));
CREATE POLICY worker_intents ON broker_forge_training_intents FOR ALL TO forge_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_jobs ON broker_forge_training_reconciliation_jobs FOR ALL TO forge_worker USING (true) WITH CHECK (true);
