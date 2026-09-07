-- Punk Agent Account mission sessions and ERC-4337 UserOperation reconciliation.
-- Session private keys are deliberately excluded. Only the owner-approved public address,
-- on-chain limits, hashes, and receipt evidence may be persisted.

CREATE TABLE IF NOT EXISTS broker_v2_agent_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  punk_account CHAR(42) NOT NULL CHECK (punk_account = LOWER(punk_account)),
  owner_snapshot CHAR(42) NOT NULL CHECK (owner_snapshot = LOWER(owner_snapshot)),
  strategy_version BIGINT NOT NULL CHECK (strategy_version > 0),
  strategy_hash CHAR(66) NOT NULL CHECK (strategy_hash ~ '^0x[0-9a-f]{64}$'),
  session_key CHAR(42) NOT NULL CHECK (session_key = LOWER(session_key)),
  session_generation BIGINT NOT NULL CHECK (session_generation > 0),
  adapter_address CHAR(42) NOT NULL CHECK (adapter_address = LOWER(adapter_address)),
  venue_address CHAR(42) NOT NULL CHECK (venue_address = LOWER(venue_address)),
  adapter_code_hash CHAR(66) NOT NULL CHECK (adapter_code_hash ~ '^0x[0-9a-f]{64}$'),
  target_collection CHAR(42) NOT NULL CHECK (target_collection = LOWER(target_collection)),
  max_mints_per_day INTEGER NOT NULL CHECK (max_mints_per_day BETWEEN 1 AND 100),
  max_mints_total INTEGER NOT NULL CHECK (max_mints_total BETWEEN 1 AND 100),
  max_gas_cost_wei NUMERIC(78, 0) NOT NULL CHECK (max_gas_cost_wei > 0),
  minimum_native_reserve_wei NUMERIC(78, 0) NOT NULL
    CHECK (minimum_native_reserve_wei >= 0),
  valid_after TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN
    ('PENDING_RECEIPT', 'ACTIVE', 'COMPLETED', 'REVOKED', 'EXPIRED', 'OWNER_CHANGED', 'PAUSED')),
  setup_artifact_hash CHAR(66) NOT NULL CHECK (setup_artifact_hash ~ '^0x[0-9a-f]{64}$'),
  authorization_transaction_hash CHAR(66) UNIQUE
    CHECK (authorization_transaction_hash IS NULL
      OR authorization_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (chain_id, collection_address, punk_token_id)
    REFERENCES broker_punks (chain_id, collection_address, token_id),
  FOREIGN KEY (chain_id, collection_address, punk_token_id, strategy_version)
    REFERENCES broker_v2_strategies (chain_id, collection_address, token_id, version),
  CHECK (valid_until > valid_after),
  CHECK (max_mints_per_day <= max_mints_total),
  CHECK (status <> 'ACTIVE' OR
    (authorization_transaction_hash IS NOT NULL AND activated_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS broker_v2_agent_sessions_one_open_uidx
  ON broker_v2_agent_sessions (chain_id, punk_token_id)
  WHERE status IN ('PENDING_RECEIPT', 'ACTIVE', 'PAUSED');

CREATE INDEX IF NOT EXISTS broker_v2_agent_sessions_worker_idx
  ON broker_v2_agent_sessions (status, valid_until, updated_at, punk_token_id);

CREATE TABLE IF NOT EXISTS broker_v2_agent_user_operations (
  operation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES broker_v2_agent_sessions(session_id),
  attempt_id UUID NOT NULL UNIQUE REFERENCES broker_v2_execution_attempts(attempt_id),
  user_operation_hash CHAR(66) UNIQUE
    CHECK (user_operation_hash IS NULL OR user_operation_hash ~ '^0x[0-9a-f]{64}$'),
  opportunity_id TEXT NOT NULL REFERENCES broker_v2_opportunities(opportunity_id),
  opportunity_hash CHAR(66) NOT NULL CHECK (opportunity_hash ~ '^0x[0-9a-f]{64}$'),
  account_nonce NUMERIC(78, 0) NOT NULL CHECK (account_nonce >= 0),
  session_generation BIGINT NOT NULL CHECK (session_generation > 0),
  call_data_hash CHAR(66) NOT NULL CHECK (call_data_hash ~ '^0x[0-9a-f]{64}$'),
  maximum_gas_cost_wei NUMERIC(78, 0) NOT NULL CHECK (maximum_gas_cost_wei > 0),
  screening_input_hash TEXT NOT NULL CHECK (length(screening_input_hash) BETWEEN 1 AND 256),
  simulation_input_hash TEXT NOT NULL CHECK (length(simulation_input_hash) BETWEEN 1 AND 256),
  expected_collection CHAR(42) NOT NULL CHECK (expected_collection = LOWER(expected_collection)),
  expected_token_id NUMERIC(78, 0) NOT NULL CHECK (expected_token_id >= 0),
  state TEXT NOT NULL CHECK (state IN
    ('RESERVED', 'SIGNED', 'SUBMITTED', 'CONFIRMED', 'REVERTED',
     'RECONCILIATION_REQUIRED', 'REJECTED')),
  transaction_hash CHAR(66) UNIQUE
    CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  actual_gas_cost_wei NUMERIC(78, 0) CHECK (actual_gas_cost_wei >= 0),
  rejection_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (state NOT IN ('SIGNED', 'SUBMITTED', 'CONFIRMED', 'REVERTED',
    'RECONCILIATION_REQUIRED') OR (user_operation_hash IS NOT NULL AND signed_at IS NOT NULL)),
  CHECK (state NOT IN ('SUBMITTED', 'CONFIRMED', 'REVERTED',
    'RECONCILIATION_REQUIRED') OR submitted_at IS NOT NULL),
  CHECK (state <> 'CONFIRMED' OR
    (transaction_hash IS NOT NULL AND confirmed_at IS NOT NULL AND actual_gas_cost_wei IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS broker_v2_agent_operations_reconcile_idx
  ON broker_v2_agent_user_operations (state, submitted_at, updated_at)
  WHERE state IN ('SUBMITTED', 'RECONCILIATION_REQUIRED');

CREATE INDEX IF NOT EXISTS broker_v2_agent_operations_session_idx
  ON broker_v2_agent_user_operations (session_id, created_at DESC);
