CREATE TABLE IF NOT EXISTS broker_automation_v3_worker_state (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  release_commit CHAR(40) NOT NULL CHECK (release_commit = LOWER(release_commit)),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL CHECK (completed_at >= started_at),
  status TEXT NOT NULL CHECK (status IN (
    'NO_AUTONOMOUS_MANDATES',
    'NO_ANALYZED_ACTIVE_TARGETS',
    'NO_ELIGIBLE_TARGETS',
    'MINT_CONFIRMED',
    'FAILED'
  )),
  submitted SMALLINT NOT NULL CHECK (submitted BETWEEN 0 AND 1),
  punk_token_id NUMERIC(78, 0),
  account_address CHAR(42),
  collection_address CHAR(42),
  transaction_hash CHAR(66),
  failure_code TEXT,
  CHECK (account_address IS NULL OR account_address = LOWER(account_address)),
  CHECK (collection_address IS NULL OR collection_address = LOWER(collection_address)),
  CHECK (transaction_hash IS NULL OR transaction_hash = LOWER(transaction_hash)),
  CHECK (failure_code IS NULL OR OCTET_LENGTH(failure_code) BETWEEN 1 AND 128),
  CHECK ((status = 'FAILED' AND failure_code IS NOT NULL)
    OR (status <> 'FAILED' AND failure_code IS NULL)),
  CHECK (
    (status = 'MINT_CONFIRMED' AND submitted = 1 AND punk_token_id IS NOT NULL
      AND account_address IS NOT NULL AND collection_address IS NOT NULL
      AND transaction_hash IS NOT NULL AND failure_code IS NULL)
    OR
    (status <> 'MINT_CONFIRMED' AND submitted = 0 AND transaction_hash IS NULL)
  )
);
