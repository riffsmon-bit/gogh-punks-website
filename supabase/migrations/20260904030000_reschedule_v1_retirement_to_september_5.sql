-- The owner clarified that V1 retires September 5 at 6:00 PM EDT. Keep the original
-- migration immutable and move the singleton cutoff forward additively before it executes.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM gogh_broker_v1_retirement
     WHERE singleton_id = 1 AND started_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'V1 retirement already started; refusing to reschedule';
  END IF;
END;
$$;

ALTER TABLE gogh_broker_v1_retirement
  DROP CONSTRAINT IF EXISTS gogh_broker_v1_retirement_shutdown_at_check;

ALTER TABLE gogh_broker_v1_retirement
  ALTER COLUMN shutdown_at SET DEFAULT '2026-09-05T22:00:00Z'::TIMESTAMPTZ;

UPDATE gogh_broker_v1_retirement
   SET shutdown_at = '2026-09-05T22:00:00Z'::TIMESTAMPTZ,
       updated_at = NOW()
 WHERE singleton_id = 1;

ALTER TABLE gogh_broker_v1_retirement
  ADD CONSTRAINT gogh_broker_v1_retirement_shutdown_at_check
  CHECK (shutdown_at = '2026-09-05T22:00:00Z'::TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION gogh_broker_finalize_v1_retirement()
RETURNS TABLE(
  retirement_state TEXT,
  jobs_cancelled INTEGER,
  sessions_cancelled INTEGER,
  attempts_cancelled INTEGER,
  attempts_requiring_reconciliation INTEGER,
  shutdown_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  canonical_shutdown CONSTANT TIMESTAMPTZ := '2026-09-05T22:00:00Z'::TIMESTAMPTZ;
  cancelled_jobs INTEGER := 0;
  cancelled_sessions INTEGER := 0;
  cancelled_attempts INTEGER := 0;
  reconciliation_attempts INTEGER := 0;
  resolved_state TEXT;
  resolved_completed_at TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(46630009);

  IF NOW() < canonical_shutdown THEN
    RETURN QUERY
    SELECT retirement.state, retirement.jobs_cancelled, retirement.sessions_cancelled,
           retirement.attempts_cancelled, retirement.attempts_requiring_reconciliation,
           retirement.shutdown_at, retirement.completed_at
      FROM gogh_broker_v1_retirement AS retirement
     WHERE retirement.singleton_id = 1;
    RETURN;
  END IF;

  UPDATE gogh_broker_v1_retirement AS retirement
     SET state = 'V1_SHUTDOWN_EXECUTING',
         started_at = COALESCE(retirement.started_at, NOW()),
         updated_at = NOW()
   WHERE retirement.singleton_id = 1;

  UPDATE gogh_broker_punk_jobs AS job
     SET state = 'CANCELLED', lease_owner = NULL, lease_until = NULL,
         last_failure_code = 'V1_RETIRED', completed_at = COALESCE(job.completed_at, NOW()),
         updated_at = NOW()
   WHERE job.state IN ('QUEUED', 'RETRY', 'LEASED');
  GET DIAGNOSTICS cancelled_jobs = ROW_COUNT;

  UPDATE gogh_broker_punk_priority_attempts AS attempt
     SET state = 'RECORDED', result_status = 'V1_RETIRED', submitted = FALSE,
         minted = FALSE, terminal_state = 'CANCELLED', recorded_at = NOW(), updated_at = NOW()
   WHERE attempt.state = 'CLAIMED';
  GET DIAGNOSTICS cancelled_attempts = ROW_COUNT;

  UPDATE gogh_broker_punk_priority_sessions AS session
     SET state = 'CANCELLED', updated_at = NOW()
   WHERE session.state = 'ACTIVE'
     AND NOT EXISTS (
       SELECT 1
         FROM gogh_broker_punk_priority_attempts AS attempt
        WHERE attempt.session_id = session.session_id
          AND attempt.state IN ('SUBMISSION_RESERVED', 'SUBMITTED')
     );
  GET DIAGNOSTICS cancelled_sessions = ROW_COUNT;

  SELECT COUNT(*)::INTEGER INTO reconciliation_attempts
    FROM gogh_broker_punk_priority_attempts AS attempt
   WHERE attempt.state IN ('SUBMISSION_RESERVED', 'SUBMITTED');

  UPDATE gogh_broker_punk_state AS punk
     SET worker_state = 'WAITING', current_job_id = NULL, next_eligible_scan_at = NULL,
         last_result = 'V1_RETIRED', updated_at = NOW()
   WHERE punk.worker_state <> 'WAITING'
      OR punk.current_job_id IS NOT NULL
      OR punk.next_eligible_scan_at IS NOT NULL
      OR punk.last_result IS DISTINCT FROM 'V1_RETIRED';

  resolved_state := CASE WHEN reconciliation_attempts > 0
    THEN 'REQUIRES_RECEIPT_RECONCILIATION' ELSE 'V1_RETIRED' END;
  resolved_completed_at := CASE WHEN reconciliation_attempts = 0 THEN NOW() ELSE NULL END;

  UPDATE gogh_broker_v1_retirement AS retirement
     SET state = resolved_state,
         jobs_cancelled = retirement.jobs_cancelled + cancelled_jobs,
         sessions_cancelled = retirement.sessions_cancelled + cancelled_sessions,
         attempts_cancelled = retirement.attempts_cancelled + cancelled_attempts,
         attempts_requiring_reconciliation = reconciliation_attempts,
         completed_at = COALESCE(retirement.completed_at, resolved_completed_at),
         updated_at = NOW()
   WHERE retirement.singleton_id = 1;

  RETURN QUERY
  SELECT retirement.state, retirement.jobs_cancelled, retirement.sessions_cancelled,
         retirement.attempts_cancelled, retirement.attempts_requiring_reconciliation,
         retirement.shutdown_at, retirement.completed_at
    FROM gogh_broker_v1_retirement AS retirement
   WHERE retirement.singleton_id = 1;
END;
$$;

REVOKE ALL ON FUNCTION gogh_broker_finalize_v1_retirement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gogh_broker_finalize_v1_retirement() TO service_role;

COMMENT ON FUNCTION gogh_broker_finalize_v1_retirement() IS
  'Idempotently cancels unsubmitted V1 work after September 5 at 6 PM EDT while preserving submitted attempts for receipt reconciliation.';
