-- Production retained the global V3 heartbeat but was missing the per-lane state relation.
-- Recreate only the additive observability surface; execution and policy tables are unchanged.

ALTER TABLE broker_automation_v3_worker_runs
  ADD COLUMN IF NOT EXISTS lane_id SMALLINT;

ALTER TABLE broker_automation_v3_worker_runs
  DROP CONSTRAINT IF EXISTS broker_automation_v3_worker_runs_lane_id_check,
  ADD CONSTRAINT broker_automation_v3_worker_runs_lane_id_check
    CHECK (lane_id IS NULL OR lane_id BETWEEN 1 AND 6);

CREATE INDEX IF NOT EXISTS broker_automation_v3_worker_runs_lane_completed_idx
  ON broker_automation_v3_worker_runs (lane_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS broker_automation_v3_worker_lane_state (
  lane_id SMALLINT PRIMARY KEY CHECK (lane_id BETWEEN 1 AND 6),
  release_commit CHAR(40) NOT NULL CHECK (release_commit = LOWER(release_commit)),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL CHECK (completed_at >= started_at),
  status TEXT NOT NULL CHECK (status IN (
    'NO_AUTONOMOUS_MANDATES', 'NO_ANALYZED_ACTIVE_TARGETS', 'NO_ELIGIBLE_TARGETS',
    'MINT_CONFIRMED', 'FAILED'
  )),
  submitted SMALLINT NOT NULL CHECK (submitted BETWEEN 0 AND 1),
  punk_token_id NUMERIC(78, 0),
  account_address CHAR(42),
  collection_address CHAR(42),
  transaction_hash CHAR(66),
  failure_code TEXT,
  discovery_summary JSONB,
  last_successful_release_commit CHAR(40),
  last_successful_started_at TIMESTAMPTZ,
  last_successful_completed_at TIMESTAMPTZ,
  last_successful_status TEXT,
  consecutive_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failure_count >= 0),
  last_failure_reason TEXT,
  CHECK (account_address IS NULL OR account_address = LOWER(account_address)),
  CHECK (collection_address IS NULL OR collection_address = LOWER(collection_address)),
  CHECK (transaction_hash IS NULL OR transaction_hash = LOWER(transaction_hash)),
  CHECK (failure_code IS NULL OR OCTET_LENGTH(failure_code) BETWEEN 1 AND 128),
  CHECK ((status = 'FAILED' AND failure_code IS NOT NULL)
    OR (status <> 'FAILED' AND failure_code IS NULL)),
  CHECK ((status = 'MINT_CONFIRMED' AND submitted = 1 AND punk_token_id IS NOT NULL
      AND account_address IS NOT NULL AND collection_address IS NOT NULL
      AND transaction_hash IS NOT NULL AND failure_code IS NULL)
    OR (status <> 'MINT_CONFIRMED' AND submitted = 0 AND transaction_hash IS NULL)),
  CHECK (last_successful_release_commit IS NULL
    OR last_successful_release_commit = LOWER(last_successful_release_commit)),
  CHECK (last_successful_status IS NULL OR last_successful_status IN (
    'NO_AUTONOMOUS_MANDATES', 'NO_ANALYZED_ACTIVE_TARGETS', 'NO_ELIGIBLE_TARGETS',
    'MINT_CONFIRMED'
  )),
  CHECK (last_successful_started_at IS NULL
    OR last_successful_completed_at >= last_successful_started_at),
  CHECK (discovery_summary IS NULL OR OCTET_LENGTH(discovery_summary::text) <= 32768)
);

COMMENT ON TABLE broker_automation_v3_worker_lane_state IS
  'Latest non-secret readiness evidence per autonomous worker lane; lane 6 is priority.';
