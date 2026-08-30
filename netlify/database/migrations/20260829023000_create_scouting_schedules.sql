CREATE TABLE IF NOT EXISTS broker_scouting_schedule_challenges (
  id UUID PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  collection_address TEXT NOT NULL,
  token_id NUMERIC(78, 0) NOT NULL,
  wallet_address TEXT NOT NULL,
  message TEXT NOT NULL,
  schedule_json JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS broker_scouting_schedule_challenges_expiry_idx
  ON broker_scouting_schedule_challenges (expires_at);

CREATE TABLE IF NOT EXISTS broker_scouting_schedules (
  chain_id INTEGER NOT NULL,
  collection_address TEXT NOT NULL,
  token_id NUMERIC(78, 0) NOT NULL,
  owner_snapshot TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL CHECK (timezone = 'UTC'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address, token_id)
);

CREATE INDEX IF NOT EXISTS broker_scouting_schedules_window_idx
  ON broker_scouting_schedules (chain_id, collection_address, enabled, start_at, end_at);
