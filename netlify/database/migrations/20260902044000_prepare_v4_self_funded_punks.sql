-- V4 preparation: shared executable opportunities, owner-authorized Punk policy proposals and
-- durable execution identities. No V4 executor is enabled by this migration.

CREATE TABLE IF NOT EXISTS broker_v4_punk_policy_proposals (
  policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  punk_collection_address CHAR(42) NOT NULL,
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  punk_account_address CHAR(42) NOT NULL,
  owner_snapshot CHAR(42) NOT NULL,
  policy_version BIGINT NOT NULL CHECK (policy_version > 0),
  policy_hash CHAR(66) NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT', 'OWNER_AUTHORIZED', 'ACTIVE', 'REVOKED', 'EXPIRED')),
  automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mint_type VARCHAR(24) NOT NULL CHECK (mint_type IN ('FREE_ONLY', 'PAID_UP_TO_LIMIT')),
  maximum_mint_price_wei NUMERIC(78, 0) NOT NULL CHECK (maximum_mint_price_wei >= 0),
  maximum_gas_per_mint_wei NUMERIC(78, 0) NOT NULL CHECK (maximum_gas_per_mint_wei > 0),
  daily_mint_limit INTEGER NOT NULL CHECK (daily_mint_limit > 0 AND daily_mint_limit <= 100),
  total_remaining_mint_limit INTEGER NOT NULL
    CHECK (total_remaining_mint_limit >= 0 AND total_remaining_mint_limit <= 10000),
  minimum_native_reserve_wei NUMERIC(78, 0) NOT NULL CHECK (minimum_native_reserve_wei >= 0),
  allowed_adapters JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocked_contracts JSONB NOT NULL DEFAULT '[]'::jsonb,
  maximum_risk_score INTEGER CHECK (maximum_risk_score IS NULL
    OR maximum_risk_score BETWEEN 0 AND 100),
  expires_at TIMESTAMPTZ NOT NULL,
  owner_authorization_hash CHAR(66),
  activation_transaction_hash CHAR(66),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, punk_collection_address, punk_token_id, policy_version),
  UNIQUE (policy_hash),
  CHECK (jsonb_typeof(allowed_adapters) = 'array'),
  CHECK (jsonb_typeof(blocked_contracts) = 'array'),
  CHECK (state NOT IN ('OWNER_AUTHORIZED', 'ACTIVE') OR owner_authorization_hash IS NOT NULL),
  CHECK (state <> 'ACTIVE' OR activation_transaction_hash IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS broker_v4_punk_policy_one_active_idx
  ON broker_v4_punk_policy_proposals (chain_id, punk_collection_address, punk_token_id)
  WHERE state = 'ACTIVE';

CREATE TABLE IF NOT EXISTS broker_v4_executable_opportunities (
  opportunity_id TEXT PRIMARY KEY REFERENCES broker_opportunities(id),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL,
  adapter_address CHAR(42) NOT NULL,
  venue_address CHAR(42) NOT NULL,
  mint_selector CHAR(10) NOT NULL,
  calldata_template_hash CHAR(66) NOT NULL,
  adapter_runtime_code_hash CHAR(66) NOT NULL,
  collection_runtime_code_hash CHAR(66) NOT NULL,
  price_wei NUMERIC(78, 0) NOT NULL CHECK (price_wei >= 0),
  maximum_per_wallet INTEGER CHECK (maximum_per_wallet IS NULL OR maximum_per_wallet > 0),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  source VARCHAR(64) NOT NULL,
  source_evidence JSONB NOT NULL,
  screening_state VARCHAR(24) NOT NULL
    CHECK (screening_state IN ('PENDING', 'PASSED', 'FAILED', 'STALE')),
  simulation_state VARCHAR(24) NOT NULL
    CHECK (simulation_state IN ('PENDING', 'PASSED', 'FAILED', 'STALE')),
  screened_at TIMESTAMPTZ,
  simulated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS broker_v4_execution_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key CHAR(64) NOT NULL UNIQUE,
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  punk_collection_address CHAR(42) NOT NULL,
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  punk_account_address CHAR(42) NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES broker_v4_executable_opportunities(opportunity_id),
  policy_id UUID NOT NULL REFERENCES broker_v4_punk_policy_proposals(policy_id),
  state VARCHAR(32) NOT NULL DEFAULT 'QUEUED' CHECK (state IN (
    'QUEUED', 'CLAIMED', 'SIMULATED', 'SUBMISSION_RESERVED', 'SUBMITTED',
    'CONFIRMED', 'SAFE_FAILURE', 'CANCELLED', 'RECONCILIATION_REQUIRED'
  )),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  account_nonce NUMERIC(78, 0) CHECK (account_nonce IS NULL OR account_nonce >= 0),
  transaction_value_wei NUMERIC(78, 0)
    CHECK (transaction_value_wei IS NULL OR transaction_value_wei >= 0),
  transaction_calldata_hash CHAR(66),
  submission_identity_hash CHAR(66) UNIQUE,
  transaction_hash CHAR(66) UNIQUE,
  result_code VARCHAR(128),
  reserved_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, punk_collection_address, punk_token_id, opportunity_id),
  UNIQUE (punk_account_address, account_nonce),
  CHECK (state NOT IN ('CLAIMED', 'SIMULATED') OR (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (state NOT IN ('SUBMISSION_RESERVED', 'SUBMITTED', 'CONFIRMED',
    'RECONCILIATION_REQUIRED') OR (
      account_nonce IS NOT NULL AND transaction_value_wei IS NOT NULL
      AND transaction_calldata_hash IS NOT NULL AND submission_identity_hash IS NOT NULL
      AND reserved_at IS NOT NULL
    )),
  CHECK (state NOT IN ('SUBMITTED', 'CONFIRMED') OR (
    transaction_hash IS NOT NULL AND submitted_at IS NOT NULL
  )),
  CHECK (state <> 'CONFIRMED' OR confirmed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS broker_v4_execution_queue_idx
  ON broker_v4_execution_attempts (created_at, attempt_id)
  WHERE state = 'QUEUED';
