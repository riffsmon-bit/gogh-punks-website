-- Art Broker V2 additive product schema. Public product V2 is internally separated from the
-- retired repository's older V2/V3 hosted automation implementations.
-- This migration stores no private keys, provider credentials, seed phrases, or arbitrary calldata.

CREATE TABLE IF NOT EXISTS broker_v2_profiles (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  token_id NUMERIC(78, 0) NOT NULL CHECK (token_id >= 0),
  display_name VARCHAR(96),
  broker_level INTEGER NOT NULL DEFAULT 0 CHECK (broker_level >= 0),
  active_strategy_version BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address, token_id),
  FOREIGN KEY (chain_id, collection_address, token_id)
    REFERENCES broker_punks (chain_id, collection_address, token_id)
);

CREATE TABLE IF NOT EXISTS broker_v2_auth_challenges (
  challenge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address CHAR(42) NOT NULL CHECK (wallet_address = LOWER(wallet_address)),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 12000),
  purpose TEXT NOT NULL CHECK (purpose IN ('SESSION', 'STRATEGY_ACTIVATION')),
  intent_hash CHAR(66) CHECK (intent_hash IS NULL OR intent_hash ~ '^0x[0-9a-f]{64}$'),
  punk_token_id NUMERIC(78, 0) CHECK (punk_token_id IS NULL OR punk_token_id >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (purpose <> 'STRATEGY_ACTIVATION' OR (intent_hash IS NOT NULL AND punk_token_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS broker_v2_sessions (
  session_hash CHAR(64) PRIMARY KEY CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  wallet_address CHAR(42) NOT NULL CHECK (wallet_address = LOWER(wallet_address)),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS broker_v2_sessions_wallet_idx
  ON broker_v2_sessions (wallet_address, expires_at DESC);

CREATE TABLE IF NOT EXISTS broker_v2_strategies (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  token_id NUMERIC(78, 0) NOT NULL CHECK (token_id >= 0),
  version BIGINT NOT NULL CHECK (version > 0),
  schema_name TEXT NOT NULL CHECK (schema_name = 'PUNK_COLLECTING_INTENT_V1'),
  intent_hash CHAR(66) NOT NULL CHECK (intent_hash ~ '^0x[0-9a-f]{64}$'),
  intent JSONB NOT NULL CHECK (jsonb_typeof(intent) = 'object'),
  state TEXT NOT NULL CHECK (state IN ('DRAFT', 'PENDING_OWNER_CONFIRMATION', 'ACTIVE', 'PAUSED', 'EXPIRED', 'SUPERSEDED')),
  configured_by CHAR(42) NOT NULL CHECK (configured_by = LOWER(configured_by)),
  ownership_block BIGINT NOT NULL CHECK (ownership_block >= 0),
  owner_confirmation_hash CHAR(66)
    CHECK (owner_confirmation_hash IS NULL OR owner_confirmation_hash ~ '^0x[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  PRIMARY KEY (chain_id, collection_address, token_id, version),
  UNIQUE (intent_hash),
  FOREIGN KEY (chain_id, collection_address, token_id)
    REFERENCES broker_punks (chain_id, collection_address, token_id),
  CHECK (state <> 'ACTIVE' OR (owner_confirmation_hash IS NOT NULL AND activated_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS broker_v2_strategies_active_idx
  ON broker_v2_strategies (chain_id, state, expires_at, token_id);

CREATE TABLE IF NOT EXISTS broker_v2_preferences (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  token_id NUMERIC(78, 0) NOT NULL CHECK (token_id >= 0),
  version BIGINT NOT NULL CHECK (version > 0),
  preferences JSONB NOT NULL CHECK (jsonb_typeof(preferences) = 'object'),
  source TEXT NOT NULL CHECK (source IN ('STRATEGY', 'LOVE_IT', 'MORE_LIKE_THIS', 'NOT_FOR_ME', 'NEVER_COLLECTION', 'LESS_LIKE_THIS')),
  configured_by CHAR(42) NOT NULL CHECK (configured_by = LOWER(configured_by)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address, token_id, version)
);

CREATE TABLE IF NOT EXISTS broker_v2_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  token_id NUMERIC(78, 0) NOT NULL CHECK (token_id >= 0),
  owner_snapshot CHAR(42) NOT NULL CHECK (owner_snapshot = LOWER(owner_snapshot)),
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'ARCHIVED', 'OWNER_CHANGED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (chain_id, collection_address, token_id)
    REFERENCES broker_punks (chain_id, collection_address, token_id)
);

CREATE TABLE IF NOT EXISTS broker_v2_conversation_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES broker_v2_conversations(conversation_id),
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'PUNK', 'SYSTEM')),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 12000),
  provider TEXT CHECK (provider IS NULL OR provider ~ '^[A-Z0-9_]{2,32}$'),
  model_registry_key TEXT,
  structured_output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (structured_output IS NULL OR jsonb_typeof(structured_output) = 'object')
);

CREATE INDEX IF NOT EXISTS broker_v2_messages_conversation_idx
  ON broker_v2_conversation_messages (conversation_id, created_at, message_id);

CREATE TABLE IF NOT EXISTS broker_v2_opportunities (
  opportunity_id TEXT PRIMARY KEY CHECK (length(opportunity_id) BETWEEN 8 AND 256),
  dedupe_key CHAR(64) NOT NULL UNIQUE CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  schema_version SMALLINT NOT NULL DEFAULT 2 CHECK (schema_version = 2),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_contract CHAR(42) NOT NULL CHECK (collection_contract = LOWER(collection_contract)),
  mint_contract CHAR(42) NOT NULL CHECK (mint_contract = LOWER(mint_contract)),
  adapter_address CHAR(42) NOT NULL CHECK (adapter_address = LOWER(adapter_address)),
  mint_stage VARCHAR(96) NOT NULL,
  normalized JSONB NOT NULL CHECK (jsonb_typeof(normalized) = 'object'),
  screening_status TEXT NOT NULL CHECK (screening_status IN ('PENDING', 'PASSED', 'BLOCKED', 'NEEDS_REVIEW')),
  simulation_status TEXT NOT NULL CHECK (simulation_status IN ('PENDING', 'PASSED', 'FAILED', 'UNAVAILABLE')),
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  first_seen_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS broker_v2_opportunities_eligible_idx
  ON broker_v2_opportunities (chain_id, screening_status, simulation_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS broker_v2_opportunity_sources (
  opportunity_id TEXT NOT NULL REFERENCES broker_v2_opportunities(opportunity_id),
  source_kind VARCHAR(48) NOT NULL,
  source_identity TEXT NOT NULL CHECK (length(source_identity) BETWEEN 1 AND 512),
  source_url TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  discovered_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (opportunity_id, source_kind, source_identity)
);

CREATE TABLE IF NOT EXISTS broker_v2_opportunity_analysis (
  opportunity_id TEXT NOT NULL REFERENCES broker_v2_opportunities(opportunity_id),
  analysis_version BIGINT NOT NULL CHECK (analysis_version > 0),
  art_styles JSONB NOT NULL CHECK (jsonb_typeof(art_styles) = 'array'),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 4000),
  provider TEXT NOT NULL CHECK (provider ~ '^[A-Z0-9_]{2,32}$'),
  model_registry_key TEXT NOT NULL,
  input_hash CHAR(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (opportunity_id, analysis_version),
  UNIQUE (input_hash)
);

CREATE TABLE IF NOT EXISTS broker_v2_security_screenings (
  screening_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT NOT NULL REFERENCES broker_v2_opportunities(opportunity_id),
  input_hash CHAR(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('PASSED', 'BLOCKED', 'NEEDS_REVIEW')),
  reasons JSONB NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  contract_code_hash CHAR(66) NOT NULL CHECK (contract_code_hash ~ '^0x[0-9a-f]{64}$'),
  adapter_code_hash CHAR(66) NOT NULL CHECK (adapter_code_hash ~ '^0x[0-9a-f]{64}$'),
  checked_at TIMESTAMPTZ NOT NULL,
  UNIQUE (opportunity_id, input_hash)
);

CREATE TABLE IF NOT EXISTS broker_v2_simulations (
  simulation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT NOT NULL REFERENCES broker_v2_opportunities(opportunity_id),
  punk_account CHAR(42) NOT NULL CHECK (punk_account = LOWER(punk_account)),
  input_hash CHAR(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  pinned_block BIGINT NOT NULL CHECK (pinned_block >= 0),
  status TEXT NOT NULL CHECK (status IN ('PASSED', 'FAILED', 'UNAVAILABLE')),
  gas_estimate NUMERIC(78, 0),
  expected_receiver CHAR(42),
  effects JSONB NOT NULL CHECK (jsonb_typeof(effects) = 'object'),
  simulated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (opportunity_id, punk_account, input_hash)
);

CREATE TABLE IF NOT EXISTS broker_v2_execution_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key CHAR(64) NOT NULL UNIQUE CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  punk_account CHAR(42) NOT NULL CHECK (punk_account = LOWER(punk_account)),
  owner_snapshot CHAR(42) NOT NULL CHECK (owner_snapshot = LOWER(owner_snapshot)),
  opportunity_id TEXT NOT NULL REFERENCES broker_v2_opportunities(opportunity_id),
  strategy_version BIGINT NOT NULL CHECK (strategy_version > 0),
  strategy_hash CHAR(66) NOT NULL CHECK (strategy_hash ~ '^0x[0-9a-f]{64}$'),
  account_nonce NUMERIC(78, 0) NOT NULL CHECK (account_nonce >= 0),
  operating_mode TEXT NOT NULL CHECK (operating_mode IN ('ASK', 'ASSIST', 'AUTONOMOUS')),
  state TEXT NOT NULL CHECK (state IN ('RESERVED', 'SIMULATED', 'OWNER_APPROVAL_PENDING', 'OWNER_APPROVED', 'SUBMISSION_RESERVED', 'SUBMITTED', 'CONFIRMED', 'REVERTED', 'RECONCILIATION_REQUIRED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  transaction_envelope_hash CHAR(64),
  transaction_hash CHAR(66) UNIQUE,
  rejection_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  CHECK (state NOT IN ('SUBMISSION_RESERVED', 'SUBMITTED', 'CONFIRMED') OR transaction_envelope_hash IS NOT NULL),
  CHECK (state NOT IN ('SUBMITTED', 'CONFIRMED') OR (transaction_hash IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK (state <> 'CONFIRMED' OR confirmed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS broker_v2_attempts_punk_idx
  ON broker_v2_execution_attempts (chain_id, punk_token_id, created_at DESC);

CREATE TABLE IF NOT EXISTS broker_v2_activity (
  activity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  activity_type VARCHAR(64) NOT NULL,
  opportunity_id TEXT,
  attempt_id UUID,
  public_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES broker_v2_execution_attempts(attempt_id)
);

CREATE INDEX IF NOT EXISTS broker_v2_activity_punk_idx
  ON broker_v2_activity (chain_id, punk_token_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS broker_v2_model_registry (
  registry_key TEXT PRIMARY KEY CHECK (registry_key ~ '^[a-z0-9:_-]{3,128}$'),
  provider TEXT NOT NULL CHECK (provider IN ('OPENAI', 'ANTHROPIC', 'XAI', 'BANKR')),
  model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 160),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  capabilities JSONB NOT NULL CHECK (jsonb_typeof(capabilities) = 'object'),
  cost_tier SMALLINT NOT NULL CHECK (cost_tier BETWEEN 1 AND 5),
  speed_tier SMALLINT NOT NULL CHECK (speed_tier BETWEEN 1 AND 5),
  input_cost_microusd_per_million_tokens BIGINT
    CHECK (input_cost_microusd_per_million_tokens >= 0),
  output_cost_microusd_per_million_tokens BIGINT
    CHECK (output_cost_microusd_per_million_tokens >= 0),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_priority SMALLINT NOT NULL CHECK (fallback_priority BETWEEN 1 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, model_id)
);

CREATE TABLE IF NOT EXISTS broker_v2_provider_usage (
  usage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_fingerprint CHAR(16) NOT NULL CHECK (owner_fingerprint ~ '^[0-9a-f]{16}$'),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  provider TEXT NOT NULL CHECK (provider IN ('OPENAI', 'ANTHROPIC', 'XAI', 'BANKR')),
  model_registry_key TEXT NOT NULL REFERENCES broker_v2_model_registry(registry_key),
  task TEXT NOT NULL CHECK (task ~ '^[A-Z0-9_]{3,64}$'),
  request_count SMALLINT NOT NULL DEFAULT 1 CHECK (request_count = 1),
  input_tokens BIGINT CHECK (input_tokens >= 0),
  output_tokens BIGINT CHECK (output_tokens >= 0),
  estimated_cost_microusd BIGINT CHECK (estimated_cost_microusd >= 0),
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms INTEGER CHECK (latency_ms >= 0),
  result_code TEXT NOT NULL CHECK (result_code ~ '^[A-Z0-9_]{2,64}$'),
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS broker_v2_provider_usage_recent_idx
  ON broker_v2_provider_usage (occurred_at DESC, provider, task);

CREATE TABLE IF NOT EXISTS broker_v2_legacy_links (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  legacy_kind TEXT NOT NULL CHECK (legacy_kind IN ('V1_ACTIVITY', 'V1_ACQUISITION', 'V1_FUNDING', 'V1_REFUND')),
  legacy_identity TEXT NOT NULL CHECK (length(legacy_identity) BETWEEN 1 AND 256),
  v2_activity_id UUID REFERENCES broker_v2_activity(activity_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, punk_token_id, legacy_kind, legacy_identity)
);
