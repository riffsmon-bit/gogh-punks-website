CREATE TABLE IF NOT EXISTS broker_automation_v3_enrollments (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  token_id NUMERIC(78, 0) NOT NULL CHECK (token_id >= 0),
  account_address CHAR(42) NOT NULL CHECK (account_address = LOWER(account_address)),
  owner_snapshot CHAR(42) NOT NULL CHECK (owner_snapshot = LOWER(owner_snapshot)),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address, token_id)
);

CREATE INDEX IF NOT EXISTS broker_automation_v3_enrollments_requested_idx
  ON broker_automation_v3_enrollments (last_requested_at DESC);
