ALTER TABLE broker_automation_v3_worker_state
  ADD COLUMN IF NOT EXISTS discovery_summary JSONB;

ALTER TABLE broker_automation_v3_worker_runs
  ADD COLUMN IF NOT EXISTS discovery_summary JSONB;

ALTER TABLE broker_automation_v3_worker_state
  DROP CONSTRAINT IF EXISTS broker_automation_v3_worker_state_discovery_summary_size;
ALTER TABLE broker_automation_v3_worker_state
  ADD CONSTRAINT broker_automation_v3_worker_state_discovery_summary_size
  CHECK (discovery_summary IS NULL OR OCTET_LENGTH(discovery_summary::text) <= 16384);

ALTER TABLE broker_automation_v3_worker_runs
  DROP CONSTRAINT IF EXISTS broker_automation_v3_worker_runs_discovery_summary_size;
ALTER TABLE broker_automation_v3_worker_runs
  ADD CONSTRAINT broker_automation_v3_worker_runs_discovery_summary_size
  CHECK (discovery_summary IS NULL OR OCTET_LENGTH(discovery_summary::text) <= 16384);

COMMENT ON COLUMN broker_automation_v3_worker_state.discovery_summary IS
  'Bounded public discovery counts and advisory project links; never execution authority.';
COMMENT ON COLUMN broker_automation_v3_worker_runs.discovery_summary IS
  'Bounded public discovery counts and advisory project links; never execution authority.';
