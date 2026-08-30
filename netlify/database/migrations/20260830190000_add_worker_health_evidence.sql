ALTER TABLE broker_automation_v3_worker_state
  ADD COLUMN IF NOT EXISTS last_successful_release_commit CHAR(40),
  ADD COLUMN IF NOT EXISTS last_successful_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_successful_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_successful_status TEXT,
  ADD COLUMN IF NOT EXISTS consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_reason TEXT;

ALTER TABLE broker_automation_v3_worker_state
  DROP CONSTRAINT IF EXISTS broker_automation_v3_worker_state_success_release_check,
  ADD CONSTRAINT broker_automation_v3_worker_state_success_release_check CHECK (
    last_successful_release_commit IS NULL
    OR last_successful_release_commit = LOWER(last_successful_release_commit)
  ),
  DROP CONSTRAINT IF EXISTS broker_automation_v3_worker_state_success_status_check,
  ADD CONSTRAINT broker_automation_v3_worker_state_success_status_check CHECK (
    last_successful_status IS NULL OR last_successful_status IN (
      'NO_AUTONOMOUS_MANDATES',
      'NO_ANALYZED_ACTIVE_TARGETS',
      'NO_ELIGIBLE_TARGETS',
      'MINT_CONFIRMED'
    )
  ),
  DROP CONSTRAINT IF EXISTS broker_automation_v3_worker_state_success_time_check,
  ADD CONSTRAINT broker_automation_v3_worker_state_success_time_check CHECK (
    last_successful_started_at IS NULL OR last_successful_completed_at >= last_successful_started_at
  ),
  DROP CONSTRAINT IF EXISTS broker_automation_v3_worker_state_failure_count_check,
  ADD CONSTRAINT broker_automation_v3_worker_state_failure_count_check CHECK (
    consecutive_failure_count >= 0
  );

WITH latest_success AS (
  SELECT DISTINCT ON (release_commit)
         release_commit, started_at, completed_at, status
    FROM broker_automation_v3_worker_runs
   WHERE status <> 'FAILED'
   ORDER BY release_commit, completed_at DESC
)
UPDATE broker_automation_v3_worker_state AS state
   SET last_successful_release_commit = success.release_commit,
       last_successful_started_at = success.started_at,
       last_successful_completed_at = success.completed_at,
       last_successful_status = success.status,
       consecutive_failure_count = CASE WHEN state.status = 'FAILED' THEN 1 ELSE 0 END,
       last_failure_reason = CASE WHEN state.status = 'FAILED' THEN state.failure_code ELSE NULL END
  FROM latest_success AS success
 WHERE state.singleton_id = 1
   AND success.release_commit = state.release_commit
   AND state.last_successful_completed_at IS NULL;
