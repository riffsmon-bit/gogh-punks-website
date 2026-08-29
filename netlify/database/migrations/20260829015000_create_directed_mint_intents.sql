CREATE TABLE IF NOT EXISTS broker_directed_mint_intents (
  intent_id text PRIMARY KEY CHECK (intent_id ~ '^dmi_[0-9a-f-]{36}$'),
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  punk_token_id numeric(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  source_url text NOT NULL CHECK (length(source_url) <= 2048),
  review_id text NOT NULL CHECK (review_id ~ '^osr_[0-9a-f]{64}$'),
  review_sha256 text NOT NULL CHECK (review_sha256 ~ '^[0-9a-f]{64}$'),
  review_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX IF NOT EXISTS broker_directed_mint_intents_expiry_idx
  ON broker_directed_mint_intents (expires_at)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE broker_directed_mint_intents IS
  'Short-lived, single-use server reviews. Rows contain no signature, key, or arbitrary execution authority.';
