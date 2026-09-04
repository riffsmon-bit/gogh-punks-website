-- Convergent Art Broker V1 retirement. Historical rows remain immutable; only live queue/session
-- state is quiesced. Transactions submitted before the cutoff remain explicitly reconcilable.

CREATE TABLE IF NOT EXISTS gogh_broker_v1_retirement (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  shutdown_at TIMESTAMPTZ NOT NULL
    DEFAULT '2026-09-04T22:00:00Z'::TIMESTAMPTZ
    CHECK (shutdown_at = '2026-09-04T22:00:00Z'::TIMESTAMPTZ),
  state TEXT NOT NULL DEFAULT 'V1_SUNSET_PENDING' CHECK (state IN (
    'V1_SUNSET_PENDING', 'V1_SHUTDOWN_EXECUTING',
    'REQUIRES_RECEIPT_RECONCILIATION', 'V1_RETIRED'
  )),
  jobs_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (jobs_cancelled >= 0),
  sessions_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (sessions_cancelled >= 0),
  attempts_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (attempts_cancelled >= 0),
  attempts_requiring_reconciliation INTEGER NOT NULL DEFAULT 0
    CHECK (attempts_requiring_reconciliation >= 0),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO gogh_broker_v1_retirement (singleton_id)
VALUES (1)
ON CONFLICT (singleton_id) DO NOTHING;

ALTER TABLE gogh_broker_v1_retirement ENABLE ROW LEVEL SECURITY;

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
  canonical_shutdown CONSTANT TIMESTAMPTZ := '2026-09-04T22:00:00Z'::TIMESTAMPTZ;
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

REVOKE ALL ON TABLE gogh_broker_v1_retirement FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION gogh_broker_finalize_v1_retirement() FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE gogh_broker_v1_retirement TO service_role;
GRANT EXECUTE ON FUNCTION gogh_broker_finalize_v1_retirement() TO service_role;

COMMENT ON TABLE gogh_broker_v1_retirement IS
  'Immutable-cutoff V1 retirement progress. Does not alter Punk ownership or wallet authority.';
COMMENT ON FUNCTION gogh_broker_finalize_v1_retirement() IS
  'Idempotently cancels unsubmitted V1 queue work after the canonical cutoff while preserving submitted attempts for receipt reconciliation.';
