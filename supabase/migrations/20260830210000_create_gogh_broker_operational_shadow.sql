-- Gogh Punks Art Broker operational shadow. Robinhood Chain remains authoritative.
-- This schema stores sanitized operational evidence only. It never stores signer material,
-- wallet signatures, raw calldata, RPC credentials, or Supabase credentials.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS gogh_broker_punk_state (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address TEXT NOT NULL CHECK (
    collection_address ~ '^0x[0-9a-f]{40}$'
  ),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  account_address TEXT CHECK (account_address IS NULL OR account_address ~ '^0x[0-9a-f]{40}$'),
  owner_snapshot TEXT CHECK (owner_snapshot IS NULL OR owner_snapshot ~ '^0x[0-9a-f]{40}$'),
  authorization_status TEXT NOT NULL CHECK (authorization_status IN (
    'NOT_ACTIVATED', 'AUTHORIZED', 'PAUSED', 'EXPIRED', 'REVOKED', 'OWNER_CHANGED'
  )),
  worker_state TEXT NOT NULL CHECK (worker_state IN (
    'WAITING', 'QUEUED', 'SCANNING', 'VERIFYING', 'SIMULATING',
    'MINTING', 'MINTED', 'ERROR'
  )),
  current_job_id UUID,
  last_scan_requested_at TIMESTAMPTZ,
  last_worker_pickup_at TIMESTAMPTZ,
  last_scan_started_at TIMESTAMPTZ,
  last_scan_completed_at TIMESTAMPTZ,
  last_result TEXT CHECK (last_result IS NULL OR last_result ~ '^[A-Z0-9_]{3,128}$'),
  last_successful_mint TEXT CHECK (
    last_successful_mint IS NULL OR last_successful_mint ~ '^0x[0-9a-f]{64}$'
  ),
  next_eligible_scan_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  source_release TEXT CHECK (source_release IS NULL OR source_release ~ '^[0-9a-f]{40}$'),
  observed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address, punk_token_id)
);

CREATE TABLE IF NOT EXISTS gogh_broker_punk_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 12 AND 200),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address TEXT NOT NULL CHECK (
    collection_address ~ '^0x[0-9a-f]{40}$'
  ),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  job_kind TEXT NOT NULL CHECK (job_kind IN ('SCOUT', 'DIRECTED_MINT_RECHECK')),
  state TEXT NOT NULL CHECK (state IN (
    'QUEUED', 'LEASED', 'SUCCEEDED', 'RETRY', 'FAILED', 'CANCELLED', 'SHADOWED'
  )),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 8 AND 160),
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  last_failure_code TEXT CHECK (
    last_failure_code IS NULL OR last_failure_code ~ '^[A-Z0-9_]{3,128}$'
  ),
  source TEXT NOT NULL CHECK (source IN ('LEGACY_SHADOW', 'SCHEDULER', 'USER', 'CONNECTOR')),
  source_release TEXT CHECK (source_release IS NULL OR source_release ~ '^[0-9a-f]{40}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((state = 'LEASED') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (completed_at IS NULL OR state IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'SHADOWED'))
);

CREATE INDEX IF NOT EXISTS gogh_broker_punk_jobs_due_idx
  ON gogh_broker_punk_jobs (available_at, created_at, punk_token_id)
  WHERE state IN ('QUEUED', 'RETRY');

CREATE INDEX IF NOT EXISTS gogh_broker_punk_jobs_punk_idx
  ON gogh_broker_punk_jobs (chain_id, collection_address, punk_token_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gogh_broker_worker_runs (
  run_id UUID PRIMARY KEY,
  release_commit TEXT NOT NULL CHECK (release_commit ~ '^[0-9a-f]{40}$'),
  mode TEXT NOT NULL CHECK (mode IN ('SHADOW', 'CANARY', 'ACTIVE')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL CHECK (completed_at >= started_at),
  status TEXT NOT NULL CHECK (status ~ '^[A-Z0-9_]{3,128}$'),
  scheduled_punks INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_punks >= 0),
  successful_punks INTEGER NOT NULL DEFAULT 0 CHECK (successful_punks >= 0),
  failed_punks INTEGER NOT NULL DEFAULT 0 CHECK (failed_punks >= 0),
  submitted SMALLINT NOT NULL DEFAULT 0 CHECK (submitted BETWEEN 0 AND 1),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{3,128}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gogh_broker_worker_runs_completed_idx
  ON gogh_broker_worker_runs (completed_at DESC);

CREATE TABLE IF NOT EXISTS gogh_broker_agent_activity (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) BETWEEN 16 AND 160),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  job_id UUID,
  worker_state TEXT NOT NULL CHECK (worker_state IN (
    'WAITING', 'QUEUED', 'SCANNING', 'VERIFYING', 'SIMULATING',
    'MINTING', 'MINTED', 'ERROR'
  )),
  result_code TEXT CHECK (result_code IS NULL OR result_code ~ '^[A-Z0-9_]{3,128}$'),
  transaction_hash TEXT CHECK (
    transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'
  ),
  source TEXT NOT NULL CHECK (source IN ('LEGACY_SHADOW', 'QUEUE', 'USER', 'CONNECTOR')),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gogh_broker_agent_activity_timeline_idx
  ON gogh_broker_agent_activity (chain_id, punk_token_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS gogh_broker_ownership_projection (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address TEXT NOT NULL CHECK (
    collection_address ~ '^0x[0-9a-f]{40}$'
  ),
  owner_address TEXT NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  token_ids NUMERIC(78, 0)[] NOT NULL DEFAULT '{}',
  canonical_balance INTEGER NOT NULL CHECK (canonical_balance >= 0),
  verified_block BIGINT NOT NULL CHECK (verified_block >= 0),
  rpc_source TEXT NOT NULL CHECK (length(rpc_source) BETWEEN 1 AND 80),
  verified_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (cardinality(token_ids) = canonical_balance),
  PRIMARY KEY (chain_id, collection_address, owner_address)
);

CREATE TABLE IF NOT EXISTS gogh_broker_diagnostics (
  diagnostic_id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL CHECK (category ~ '^[A-Z0-9_]{3,128}$'),
  punk_token_id NUMERIC(78, 0),
  owner_fingerprint TEXT CHECK (
    owner_fingerprint IS NULL OR owner_fingerprint ~ '^[0-9a-f]{16}$'
  ),
  result_code TEXT CHECK (result_code IS NULL OR result_code ~ '^[A-Z0-9_]{3,128}$'),
  source_release TEXT CHECK (source_release IS NULL OR source_release ~ '^[0-9a-f]{40}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gogh_broker_diagnostics_recent_idx
  ON gogh_broker_diagnostics (occurred_at DESC);

-- A claim locks only the selected rows. A failed Punk can be retried independently and cannot
-- roll back or poison a different Punk's job.
CREATE OR REPLACE FUNCTION gogh_broker_claim_punk_jobs(
  requested_worker TEXT,
  requested_limit INTEGER,
  requested_lease_seconds INTEGER
)
RETURNS SETOF gogh_broker_punk_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF requested_worker !~ '^[A-Za-z0-9:_-]{8,160}$'
     OR requested_limit < 1 OR requested_limit > 16
     OR requested_lease_seconds < 30 OR requested_lease_seconds > 600 THEN
    RAISE EXCEPTION 'invalid queue claim';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT job_id
      FROM gogh_broker_punk_jobs
     WHERE (state IN ('QUEUED', 'RETRY') AND available_at <= NOW())
        OR (state = 'LEASED' AND lease_until <= NOW())
     ORDER BY available_at, created_at, punk_token_id
     FOR UPDATE SKIP LOCKED
     LIMIT requested_limit
  )
  UPDATE gogh_broker_punk_jobs AS job
     SET state = 'LEASED',
         lease_owner = requested_worker,
         lease_until = NOW() + (requested_lease_seconds * INTERVAL '1 second'),
         attempts = job.attempts + 1,
         started_at = COALESCE(job.started_at, NOW()),
         updated_at = NOW()
    FROM due
   WHERE job.job_id = due.job_id
  RETURNING job.*;
END;
$$;

ALTER TABLE gogh_broker_punk_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE gogh_broker_punk_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gogh_broker_worker_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gogh_broker_agent_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE gogh_broker_ownership_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE gogh_broker_diagnostics ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION gogh_broker_claim_punk_jobs(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gogh_broker_claim_punk_jobs(TEXT, INTEGER, INTEGER) TO service_role;
