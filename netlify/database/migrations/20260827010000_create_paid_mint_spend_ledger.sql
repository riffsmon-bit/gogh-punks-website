-- Local V2 schema preparation only. Production paid execution remains disabled.
CREATE TABLE IF NOT EXISTS broker_paid_mint_jobs (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  punk_token_id NUMERIC(78, 0) NOT NULL,
  utc_day DATE NOT NULL,
  job_id TEXT PRIMARY KEY CHECK (length(job_id) BETWEEN 8 AND 160),
  status TEXT NOT NULL CHECK (status IN ('RESERVED', 'CONFIRMED', 'RELEASED', 'REORGED')),
  amount_wei NUMERIC(78, 0) NOT NULL CHECK (amount_wei > 0),
  mint_contract TEXT NOT NULL CHECK (mint_contract ~ '^0x[0-9a-f]{40}$'),
  collection_address TEXT NOT NULL CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
  received_token_id NUMERIC(78, 0),
  transaction_hash TEXT UNIQUE CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  block_number BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS broker_paid_mint_jobs_punk_day
  ON broker_paid_mint_jobs (chain_id, punk_token_id, utc_day, status);
