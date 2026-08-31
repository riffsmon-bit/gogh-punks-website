-- Per-Punk prepaid hosted-agent gas accounting. The hosted EOA remains the on-chain gas payer;
-- these rows reserve deposited value for exactly one authorized Punk and never grant authority.

ALTER TABLE gogh_broker_punk_jobs
  ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 0
    CHECK (priority BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS gogh_broker_punk_jobs_priority_due_idx
  ON gogh_broker_punk_jobs (priority DESC, available_at, created_at, punk_token_id)
  WHERE state IN ('QUEUED', 'RETRY');

CREATE TABLE IF NOT EXISTS gogh_broker_punk_agent_gas_accounts (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address TEXT NOT NULL CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  owner_snapshot TEXT NOT NULL CHECK (owner_snapshot ~ '^0x[0-9a-f]{40}$'),
  credited_wei NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (credited_wei >= 0),
  spent_wei NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (spent_wei >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address, punk_token_id),
  CHECK (spent_wei <= credited_wei)
);

CREATE TABLE IF NOT EXISTS gogh_broker_punk_agent_gas_deposits (
  transaction_hash TEXT PRIMARY KEY CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address TEXT NOT NULL CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  owner_address TEXT NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  agent_address TEXT NOT NULL CHECK (agent_address ~ '^0x[0-9a-f]{40}$'),
  amount_wei NUMERIC(78, 0) NOT NULL CHECK (amount_wei > 0),
  block_number BIGINT NOT NULL CHECK (block_number >= 0),
  confirmed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gogh_broker_punk_agent_gas_deposits_punk_idx
  ON gogh_broker_punk_agent_gas_deposits
    (chain_id, collection_address, punk_token_id, confirmed_at DESC);

-- Re-crediting the same transaction is impossible: only a newly inserted deposit updates balance
-- and creates its single immediate priority job.
CREATE OR REPLACE FUNCTION gogh_broker_credit_punk_agent_gas(
  requested_transaction_hash TEXT,
  requested_punk_token_id NUMERIC,
  requested_owner_address TEXT,
  requested_agent_address TEXT,
  requested_amount_wei NUMERIC,
  requested_block_number BIGINT,
  requested_confirmed_at TIMESTAMPTZ,
  requested_release TEXT
)
RETURNS TABLE(credited BOOLEAN, available_wei NUMERIC, job_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER;
  selected_job_id UUID;
BEGIN
  IF requested_transaction_hash !~ '^0x[0-9a-f]{64}$'
     OR requested_owner_address !~ '^0x[0-9a-f]{40}$'
     OR requested_agent_address !~ '^0x[0-9a-f]{40}$'
     OR requested_punk_token_id < 0
     OR requested_amount_wei <= 0
     OR requested_block_number < 0
     OR requested_release !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'invalid Punk agent gas credit evidence';
  END IF;

  INSERT INTO gogh_broker_punk_agent_gas_deposits
    (transaction_hash, chain_id, collection_address, punk_token_id, owner_address,
     agent_address, amount_wei, block_number, confirmed_at)
  VALUES
    (requested_transaction_hash, 4663, '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6',
     requested_punk_token_id, requested_owner_address, requested_agent_address,
     requested_amount_wei, requested_block_number, requested_confirmed_at)
  ON CONFLICT (transaction_hash) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 1 THEN
    INSERT INTO gogh_broker_punk_agent_gas_accounts
      (chain_id, collection_address, punk_token_id, owner_snapshot, credited_wei, updated_at)
    VALUES
      (4663, '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6',
       requested_punk_token_id, requested_owner_address, requested_amount_wei, NOW())
    ON CONFLICT (chain_id, collection_address, punk_token_id) DO UPDATE SET
      owner_snapshot = EXCLUDED.owner_snapshot,
      credited_wei = gogh_broker_punk_agent_gas_accounts.credited_wei
        + EXCLUDED.credited_wei,
      updated_at = NOW();

    INSERT INTO gogh_broker_punk_jobs
      (idempotency_key, chain_id, collection_address, punk_token_id, job_kind, state,
       priority, available_at, source, source_release, updated_at)
    VALUES
      ('prepaid:' || requested_transaction_hash,
       4663, '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6',
       requested_punk_token_id, 'SCOUT', 'QUEUED', 100, NOW(), 'USER',
       requested_release, NOW())
    ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
    RETURNING gogh_broker_punk_jobs.job_id INTO selected_job_id;

    INSERT INTO gogh_broker_punk_state
      (chain_id, collection_address, punk_token_id, owner_snapshot,
       authorization_status, worker_state, current_job_id, last_scan_requested_at,
       source_release, observed_at, updated_at)
    VALUES
      (4663, '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6',
       requested_punk_token_id, requested_owner_address, 'AUTHORIZED', 'QUEUED',
       selected_job_id, NOW(), requested_release, NOW(), NOW())
    ON CONFLICT (chain_id, collection_address, punk_token_id) DO UPDATE SET
      owner_snapshot = EXCLUDED.owner_snapshot,
      authorization_status = 'AUTHORIZED', worker_state = 'QUEUED',
      current_job_id = EXCLUDED.current_job_id,
      last_scan_requested_at = EXCLUDED.last_scan_requested_at,
      source_release = EXCLUDED.source_release,
      observed_at = EXCLUDED.observed_at, updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN QUERY
    SELECT inserted_count = 1,
      account.credited_wei - account.spent_wei,
      selected_job_id
    FROM gogh_broker_punk_agent_gas_accounts AS account
    WHERE account.chain_id = 4663
      AND account.collection_address = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6'
      AND account.punk_token_id = requested_punk_token_id;
END;
$$;

-- Priority affects ordering only after a job is independently due; row leases and skip-locked
-- isolation remain unchanged.
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
     ORDER BY priority DESC, available_at, created_at, punk_token_id
     FOR UPDATE SKIP LOCKED
     LIMIT requested_limit
  )
  UPDATE gogh_broker_punk_jobs AS job
     SET state = 'LEASED', lease_owner = requested_worker,
         lease_until = NOW() + (requested_lease_seconds * INTERVAL '1 second'),
         attempts = job.attempts + 1,
         started_at = COALESCE(job.started_at, NOW()), updated_at = NOW()
    FROM due
   WHERE job.job_id = due.job_id
  RETURNING job.*;
END;
$$;

ALTER TABLE gogh_broker_punk_agent_gas_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gogh_broker_punk_agent_gas_deposits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION gogh_broker_credit_punk_agent_gas(
  TEXT, NUMERIC, TEXT, TEXT, NUMERIC, BIGINT, TIMESTAMPTZ, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gogh_broker_credit_punk_agent_gas(
  TEXT, NUMERIC, TEXT, TEXT, NUMERIC, BIGINT, TIMESTAMPTZ, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION gogh_broker_claim_punk_jobs(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gogh_broker_claim_punk_jobs(TEXT, INTEGER, INTEGER) TO service_role;
