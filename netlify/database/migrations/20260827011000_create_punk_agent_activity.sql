-- Local V2 schema preparation only. It stores sanitized public state, never signer material.
CREATE TABLE IF NOT EXISTS broker_punk_agent_heartbeats (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  punk_token_id NUMERIC(78, 0) NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'IDLE', 'QUEUED', 'SCANNING', 'CANDIDATE_FOUND', 'VERIFYING_CONTRACT',
    'CHECKING_PRICE', 'CHECKING_ELIGIBILITY', 'CHECKING_LIMITS', 'SIMULATING',
    'READY', 'SUBMITTING', 'CONFIRMING', 'MINTED', 'SKIPPED', 'PAUSED', 'ERROR'
  )),
  current_job_id TEXT CHECK (current_job_id IS NULL OR length(current_job_id) BETWEEN 8 AND 160),
  last_scheduled_scan TIMESTAMPTZ,
  last_actual_scan TIMESTAMPTZ,
  last_successful_mint TEXT CHECK (last_successful_mint IS NULL OR last_successful_mint ~ '^0x[0-9a-f]{64}$'),
  last_failed_candidate TEXT CHECK (last_failed_candidate IS NULL OR length(last_failed_candidate) <= 160),
  next_scan_estimate TIMESTAMPTZ,
  reason TEXT CHECK (reason IS NULL OR reason ~ '^[A-Z0-9_]{3,64}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, punk_token_id)
);

CREATE TABLE IF NOT EXISTS broker_punk_agent_activity (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  punk_token_id NUMERIC(78, 0) NOT NULL,
  event_id TEXT PRIMARY KEY CHECK (length(event_id) BETWEEN 8 AND 160),
  job_id TEXT CHECK (job_id IS NULL OR length(job_id) BETWEEN 8 AND 160),
  state TEXT NOT NULL,
  reason TEXT,
  collection_address TEXT CHECK (collection_address IS NULL OR collection_address ~ '^0x[0-9a-f]{40}$'),
  transaction_hash TEXT UNIQUE CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS broker_punk_agent_activity_timeline
  ON broker_punk_agent_activity (chain_id, punk_token_id, occurred_at DESC);
