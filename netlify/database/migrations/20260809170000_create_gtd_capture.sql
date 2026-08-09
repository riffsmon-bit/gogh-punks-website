CREATE TABLE IF NOT EXISTS gtd_verification_sessions (
  session_hash CHAR(64) PRIMARY KEY,
  discord_user_id VARCHAR(20) NOT NULL,
  discord_username VARCHAR(80) NOT NULL,
  discord_display_name VARCHAR(80),
  wallet_address CHAR(42),
  siwe_nonce VARCHAR(96),
  siwe_message TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'DISCORD_AUTHENTICATED'
    CHECK (status IN (
      'DISCORD_AUTHENTICATED',
      'PREPARED',
      'VERIFIED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED'
    )),
  failed_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gtd_sessions_discord_user_idx
  ON gtd_verification_sessions (discord_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gtd_sessions_expiry_idx
  ON gtd_verification_sessions (expires_at);

CREATE TABLE IF NOT EXISTS gtd_wallet_links (
  wallet_address CHAR(42) PRIMARY KEY
    CHECK (wallet_address = LOWER(wallet_address)),
  discord_user_id VARCHAR(20) NOT NULL UNIQUE,
  discord_username VARCHAR(80) NOT NULL,
  discord_display_name VARCHAR(80),
  allocation_limit SMALLINT NOT NULL DEFAULT 3 CHECK (allocation_limit = 3),
  price_eth NUMERIC(18, 18) NOT NULL DEFAULT 0 CHECK (price_eth = 0),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  role_sync_state VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (role_sync_state IN ('PENDING', 'SYNCED', 'ERROR', 'NOT_MEMBER')),
  role_synced_at TIMESTAMPTZ,
  last_role_sync_attempt_at TIMESTAMPTZ,
  role_sync_attempts INTEGER NOT NULL DEFAULT 0 CHECK (role_sync_attempts >= 0),
  role_sync_error VARCHAR(180)
);

CREATE INDEX IF NOT EXISTS gtd_wallet_role_sync_idx
  ON gtd_wallet_links (role_sync_state, role_synced_at NULLS FIRST);

CREATE TABLE IF NOT EXISTS gtd_audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(48) NOT NULL,
  discord_user_id VARCHAR(20),
  wallet_abbreviated VARCHAR(20),
  detail JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gtd_audit_created_idx
  ON gtd_audit_events (created_at DESC);

COMMENT ON TABLE gtd_wallet_links IS
  'At most 200 rows are admitted by an advisory-locked application transaction.';
