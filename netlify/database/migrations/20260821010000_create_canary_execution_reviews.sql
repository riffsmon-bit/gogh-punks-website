CREATE TABLE IF NOT EXISTS broker_canary_execution_reviews (
  artifact_sha256 CHAR(66) PRIMARY KEY
    CHECK (artifact_sha256 = LOWER(artifact_sha256)),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  expected_owner CHAR(42) NOT NULL CHECK (expected_owner = LOWER(expected_owner)),
  account_address CHAR(42) NOT NULL CHECK (account_address = LOWER(account_address)),
  policy_module CHAR(42) NOT NULL CHECK (policy_module = LOWER(policy_module)),
  punk_collection CHAR(42) NOT NULL CHECK (punk_collection = LOWER(punk_collection)),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id = 1797),
  adapter_address CHAR(42) NOT NULL CHECK (adapter_address = LOWER(adapter_address)),
  venue_address CHAR(42) NOT NULL CHECK (venue_address = LOWER(venue_address)),
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  output_token_id NUMERIC(78, 0) NOT NULL CHECK (output_token_id >= 0),
  function_selector CHAR(10) NOT NULL CHECK (function_selector = LOWER(function_selector)),
  mint_selector CHAR(10) NOT NULL CHECK (mint_selector = LOWER(mint_selector)),
  transaction_value NUMERIC(78, 0) NOT NULL CHECK (transaction_value = 0),
  data_keccak256 CHAR(66) NOT NULL CHECK (data_keccak256 = LOWER(data_keccak256)),
  intent_digest CHAR(66) NOT NULL CHECK (intent_digest = LOWER(intent_digest)),
  account_runtime_code_hash CHAR(66) NOT NULL
    CHECK (account_runtime_code_hash = LOWER(account_runtime_code_hash)),
  adapter_runtime_code_hash CHAR(66) NOT NULL
    CHECK (adapter_runtime_code_hash = LOWER(adapter_runtime_code_hash)),
  art_runtime_code_hash CHAR(66) NOT NULL
    CHECK (art_runtime_code_hash = LOWER(art_runtime_code_hash)),
  core_manifest_sha256 CHAR(66) NOT NULL CHECK (core_manifest_sha256 = LOWER(core_manifest_sha256)),
  canary_manifest_sha256 CHAR(66) NOT NULL
    CHECK (canary_manifest_sha256 = LOWER(canary_manifest_sha256)),
  acquisition_nonce NUMERIC(78, 0) NOT NULL CHECK (acquisition_nonce = 0),
  policy_version BIGINT NOT NULL CHECK (policy_version = 11),
  expires_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > reviewed_at),
  CHECK (revoked_at IS NULL OR revoked_at >= reviewed_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS broker_canary_execution_one_active_idx
  ON broker_canary_execution_reviews ((chain_id))
  WHERE revoked_at IS NULL;

-- This table stores only short-lived public review hashes and decoded public bindings.
-- It never stores calldata, signatures, wallet keys, passwords, bearer tokens, or RPC credentials.
