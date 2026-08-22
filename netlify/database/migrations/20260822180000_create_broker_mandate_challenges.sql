CREATE TABLE IF NOT EXISTS broker_mandate_challenges (
  id UUID PRIMARY KEY,
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  token_id NUMERIC(78, 0) NOT NULL CHECK (token_id >= 0),
  wallet_address CHAR(42) NOT NULL CHECK (wallet_address = LOWER(wallet_address)),
  message TEXT NOT NULL CHECK (OCTET_LENGTH(message) BETWEEN 1 AND 12000),
  mandate_sha256 CHAR(66) NOT NULL CHECK (mandate_sha256 = LOWER(mandate_sha256)),
  mandate_json JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS broker_mandate_challenges_expiry_idx
  ON broker_mandate_challenges (expires_at);
