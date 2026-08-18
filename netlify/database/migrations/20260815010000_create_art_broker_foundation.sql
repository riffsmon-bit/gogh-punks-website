CREATE TABLE IF NOT EXISTS broker_punks (
  chain_id BIGINT NOT NULL,
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  token_id NUMERIC(78, 0) NOT NULL CHECK (token_id >= 0),
  account_address CHAR(42) CHECK (account_address = LOWER(account_address)),
  account_version INTEGER,
  owner_snapshot CHAR(42) CHECK (owner_snapshot = LOWER(owner_snapshot)),
  owner_snapshot_block BIGINT CHECK (owner_snapshot_block >= 0),
  persona_key VARCHAR(64),
  indexed_through_block BIGINT CHECK (indexed_through_block >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address, token_id),
  UNIQUE (chain_id, account_address)
);

CREATE TABLE IF NOT EXISTS broker_taste_profiles (
  chain_id BIGINT NOT NULL,
  collection_address CHAR(42) NOT NULL,
  token_id NUMERIC(78, 0) NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  dimensions JSONB NOT NULL,
  public BOOLEAN NOT NULL DEFAULT TRUE,
  configured_by CHAR(42) NOT NULL CHECK (configured_by = LOWER(configured_by)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address, token_id, version),
  FOREIGN KEY (chain_id, collection_address, token_id)
    REFERENCES broker_punks (chain_id, collection_address, token_id)
);

CREATE TABLE IF NOT EXISTS broker_art_mandates (
  chain_id BIGINT NOT NULL,
  collection_address CHAR(42) NOT NULL,
  token_id NUMERIC(78, 0) NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  mode VARCHAR(24) NOT NULL
    CHECK (mode IN ('DISABLED', 'SCOUT', 'APPROVAL_REQUIRED', 'AUTONOMOUS')),
  economic_settings JSONB NOT NULL DEFAULT '{}',
  risk_settings JSONB NOT NULL DEFAULT '{}',
  artistic_preferences JSONB NOT NULL DEFAULT '{}',
  marketplace_permissions JSONB NOT NULL DEFAULT '{}',
  configured_by CHAR(42) NOT NULL CHECK (configured_by = LOWER(configured_by)),
  onchain_policy_version BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address, token_id, version),
  FOREIGN KEY (chain_id, collection_address, token_id)
    REFERENCES broker_punks (chain_id, collection_address, token_id)
);

CREATE TABLE IF NOT EXISTS broker_agents (
  chain_id BIGINT NOT NULL,
  agent_address CHAR(42) NOT NULL CHECK (agent_address = LOWER(agent_address)),
  version_hash CHAR(66) NOT NULL CHECK (version_hash = LOWER(version_hash)),
  metadata JSONB NOT NULL DEFAULT '{}',
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  valid_after TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  PRIMARY KEY (chain_id, agent_address, version_hash)
);

CREATE TABLE IF NOT EXISTS broker_agent_authorizations (
  chain_id BIGINT NOT NULL,
  account_address CHAR(42) NOT NULL CHECK (account_address = LOWER(account_address)),
  agent_address CHAR(42) NOT NULL CHECK (agent_address = LOWER(agent_address)),
  authorizing_owner CHAR(42) NOT NULL CHECK (authorizing_owner = LOWER(authorizing_owner)),
  authorization_generation BIGINT NOT NULL CHECK (authorization_generation >= 0),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  valid_until TIMESTAMPTZ NOT NULL,
  observed_block BIGINT NOT NULL CHECK (observed_block >= 0),
  transaction_hash CHAR(66) NOT NULL CHECK (transaction_hash = LOWER(transaction_hash)),
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  PRIMARY KEY (chain_id, transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS broker_agent_authorizations_account_idx
  ON broker_agent_authorizations (chain_id, account_address, observed_block DESC);

CREATE TABLE IF NOT EXISTS broker_collections (
  chain_id BIGINT NOT NULL,
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  standard VARCHAR(16) CHECK (standard IN ('ERC721', 'ERC1155', 'UNKNOWN')),
  name TEXT,
  symbol TEXT,
  creator_address CHAR(42) CHECK (creator_address = LOWER(creator_address)),
  source_verified BOOLEAN NOT NULL DEFAULT FALSE,
  proxy_status VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
  risk_label VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (risk_label IN ('LOWER_RISK', 'MEDIUM_RISK', 'HIGHER_RISK', 'UNKNOWN')),
  risk_score NUMERIC(5, 2) CHECK (risk_score BETWEEN 0 AND 100),
  evidence JSONB NOT NULL DEFAULT '{}',
  first_seen_block BIGINT,
  analyzed_at TIMESTAMPTZ,
  PRIMARY KEY (chain_id, collection_address)
);

CREATE TABLE IF NOT EXISTS broker_artists (
  chain_id BIGINT NOT NULL,
  artist_key TEXT NOT NULL,
  creator_address CHAR(42) CHECK (creator_address = LOWER(creator_address)),
  public_metadata JSONB NOT NULL DEFAULT '{}',
  heuristic_evidence JSONB NOT NULL DEFAULT '{}',
  creator_score NUMERIC(5, 2) CHECK (creator_score BETWEEN 0 AND 100),
  confidence NUMERIC(5, 2) CHECK (confidence BETWEEN 0 AND 100),
  PRIMARY KEY (chain_id, artist_key)
);

CREATE TABLE IF NOT EXISTS broker_opportunities (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  token_id NUMERIC(78, 0) NOT NULL CHECK (token_id >= 0),
  source VARCHAR(80) NOT NULL,
  opportunity_type VARCHAR(32) NOT NULL,
  creator_address CHAR(42) CHECK (creator_address = LOWER(creator_address)),
  marketplace_address CHAR(42) CHECK (marketplace_address = LOWER(marketplace_address)),
  currency_address CHAR(42) NOT NULL CHECK (currency_address = LOWER(currency_address)),
  expected_price NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (expected_price >= 0),
  maximum_price NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (maximum_price >= 0),
  supply JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  scores JSONB NOT NULL DEFAULT '{}',
  risk_label VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
  confidence NUMERIC(5, 2) CHECK (confidence BETWEEN 0 AND 100),
  scoutable BOOLEAN NOT NULL DEFAULT TRUE,
  autonomous_execution_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  discovered_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (chain_id, collection_address)
    REFERENCES broker_collections (chain_id, collection_address)
);

CREATE INDEX IF NOT EXISTS broker_opportunities_discovered_idx
  ON broker_opportunities (chain_id, discovered_at DESC);

CREATE TABLE IF NOT EXISTS broker_recommendations (
  id UUID PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES broker_opportunities (id),
  punk_chain_id BIGINT NOT NULL,
  punk_collection_address CHAR(42) NOT NULL,
  punk_token_id NUMERIC(78, 0) NOT NULL,
  recommendation VARCHAR(24) NOT NULL
    CHECK (recommendation IN ('IGNORE', 'WATCH', 'RESEARCH', 'RECOMMEND', 'COLLECT')),
  scores JSONB NOT NULL,
  explanation TEXT NOT NULL,
  reasoning_hash CHAR(66) NOT NULL CHECK (reasoning_hash = LOWER(reasoning_hash)),
  agent_version_hash CHAR(66) NOT NULL CHECK (agent_version_hash = LOWER(agent_version_hash)),
  policy_version BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (punk_chain_id, punk_collection_address, punk_token_id)
    REFERENCES broker_punks (chain_id, collection_address, token_id)
);

CREATE TABLE IF NOT EXISTS broker_proposals (
  id UUID PRIMARY KEY,
  recommendation_id UUID REFERENCES broker_recommendations (id),
  account_address CHAR(42) NOT NULL CHECK (account_address = LOWER(account_address)),
  expected_owner CHAR(42) NOT NULL CHECK (expected_owner = LOWER(expected_owner)),
  intent_hash CHAR(66) NOT NULL UNIQUE CHECK (intent_hash = LOWER(intent_hash)),
  nonce NUMERIC(78, 0) NOT NULL,
  policy_version BIGINT NOT NULL,
  typed_intent JSONB NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'EXECUTED', 'EXPIRED', 'CANCELLED', 'REJECTED')),
  expires_at TIMESTAMPTZ NOT NULL,
  transaction_hash CHAR(66),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broker_acquisitions (
  chain_id BIGINT NOT NULL,
  transaction_hash CHAR(66) NOT NULL CHECK (transaction_hash = LOWER(transaction_hash)),
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  punk_collection_address CHAR(42) NOT NULL,
  punk_token_id NUMERIC(78, 0) NOT NULL,
  punk_account_address CHAR(42) NOT NULL CHECK (punk_account_address = LOWER(punk_account_address)),
  nft_collection_address CHAR(42) NOT NULL CHECK (nft_collection_address = LOWER(nft_collection_address)),
  nft_token_id NUMERIC(78, 0) NOT NULL,
  asset_amount NUMERIC(78, 0) NOT NULL DEFAULT 1,
  creator_address CHAR(42),
  currency_address CHAR(42) NOT NULL,
  price NUMERIC(78, 0) NOT NULL,
  marketplace_address CHAR(42) NOT NULL,
  acquisition_mode VARCHAR(24) NOT NULL,
  agent_address CHAR(42),
  policy_version BIGINT NOT NULL,
  scores JSONB NOT NULL DEFAULT '{}',
  reasoning_hash CHAR(66) NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash CHAR(66) NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, transaction_hash, log_index),
  FOREIGN KEY (chain_id, punk_collection_address, punk_token_id)
    REFERENCES broker_punks (chain_id, collection_address, token_id)
);

CREATE TABLE IF NOT EXISTS broker_adapter_snapshots (
  chain_id BIGINT NOT NULL,
  adapter_address CHAR(42) NOT NULL,
  adapter_kind VARCHAR(24) NOT NULL CHECK (adapter_kind IN ('MARKETPLACE', 'MINT')),
  venue_address CHAR(42) NOT NULL,
  version_hash CHAR(66) NOT NULL,
  adapter_code_hash CHAR(66) NOT NULL,
  venue_code_hash CHAR(66) NOT NULL,
  active BOOLEAN NOT NULL,
  observed_block BIGINT NOT NULL,
  PRIMARY KEY (chain_id, adapter_address, observed_block)
);

CREATE TABLE IF NOT EXISTS broker_portfolio_snapshots (
  chain_id BIGINT NOT NULL,
  account_address CHAR(42) NOT NULL,
  snapshot_block BIGINT NOT NULL,
  native_balance NUMERIC(78, 0) NOT NULL,
  nft_count INTEGER NOT NULL CHECK (nft_count >= 0),
  estimated_value JSONB NOT NULL DEFAULT '{}',
  captured_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, account_address, snapshot_block)
);

CREATE TABLE IF NOT EXISTS broker_curator_reputation_snapshots (
  chain_id BIGINT NOT NULL,
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  token_id NUMERIC(78, 0) NOT NULL CHECK (token_id >= 0),
  snapshot_block BIGINT NOT NULL CHECK (snapshot_block >= 0),
  metrics JSONB NOT NULL,
  formula_version VARCHAR(32) NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, collection_address, token_id, snapshot_block),
  FOREIGN KEY (chain_id, collection_address, token_id)
    REFERENCES broker_punks (chain_id, collection_address, token_id)
);

CREATE TABLE IF NOT EXISTS broker_price_snapshots (
  chain_id BIGINT NOT NULL,
  collection_address CHAR(42) NOT NULL,
  token_id NUMERIC(78, 0) NOT NULL,
  source VARCHAR(80) NOT NULL,
  currency_address CHAR(42) NOT NULL,
  estimated_value NUMERIC(78, 0) NOT NULL,
  confidence NUMERIC(5, 2) NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  captured_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, collection_address, token_id, source, captured_at)
);

CREATE TABLE IF NOT EXISTS broker_decision_logs (
  id UUID PRIMARY KEY,
  punk_chain_id BIGINT NOT NULL,
  punk_collection_address CHAR(42) NOT NULL,
  punk_token_id NUMERIC(78, 0) NOT NULL,
  event_type VARCHAR(48) NOT NULL,
  opportunity_id TEXT,
  recommendation_id UUID,
  public_detail JSONB NOT NULL DEFAULT '{}',
  reasoning_hash CHAR(66),
  block_number BIGINT,
  transaction_hash CHAR(66),
  occurred_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (punk_chain_id, punk_collection_address, punk_token_id)
    REFERENCES broker_punks (chain_id, collection_address, token_id)
);

CREATE INDEX IF NOT EXISTS broker_decision_logs_punk_idx
  ON broker_decision_logs
  (punk_chain_id, punk_collection_address, punk_token_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS broker_owner_private_settings (
  owner_wallet CHAR(42) PRIMARY KEY CHECK (owner_wallet = LOWER(owner_wallet)),
  encrypted_payload BYTEA NOT NULL,
  encryption_key_version INTEGER NOT NULL CHECK (encryption_key_version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE broker_owner_private_settings IS
  'Owner-scoped encrypted notification settings. Never attach private data to a transferable Punk.';

CREATE TABLE IF NOT EXISTS broker_notifications (
  id UUID PRIMARY KEY,
  owner_wallet CHAR(42) NOT NULL,
  punk_chain_id BIGINT NOT NULL,
  punk_collection_address CHAR(42) NOT NULL,
  punk_token_id NUMERIC(78, 0) NOT NULL,
  notification_type VARCHAR(48) NOT NULL,
  adapter VARCHAR(24) NOT NULL,
  public_payload JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broker_indexer_checkpoints (
  chain_id BIGINT NOT NULL,
  stream VARCHAR(80) NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash CHAR(66) NOT NULL CHECK (block_hash = LOWER(block_hash)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, stream)
);

CREATE TABLE IF NOT EXISTS broker_indexed_logs (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  stream VARCHAR(80) NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash CHAR(66) NOT NULL,
  transaction_hash CHAR(66) NOT NULL,
  log_index INTEGER NOT NULL,
  address CHAR(42) NOT NULL,
  topics JSONB NOT NULL,
  data TEXT NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, stream, transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS broker_indexed_logs_block_idx
  ON broker_indexed_logs (chain_id, stream, block_number);
