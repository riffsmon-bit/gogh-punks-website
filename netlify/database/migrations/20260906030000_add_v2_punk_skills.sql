-- Owner-taught V2 skills are declarative, read-only routines. They never store code, calldata,
-- credentials, signatures, transaction authority, or policy overrides.

ALTER TABLE broker_v2_model_registry
  DROP CONSTRAINT IF EXISTS broker_v2_model_registry_provider_check;
ALTER TABLE broker_v2_model_registry
  ADD CONSTRAINT broker_v2_model_registry_provider_check
  CHECK (provider IN ('GEMINI', 'OPENAI', 'ANTHROPIC', 'XAI', 'BANKR'));

ALTER TABLE broker_v2_provider_usage
  DROP CONSTRAINT IF EXISTS broker_v2_provider_usage_provider_check;
ALTER TABLE broker_v2_provider_usage
  ADD CONSTRAINT broker_v2_provider_usage_provider_check
  CHECK (provider IN ('GEMINI', 'OPENAI', 'ANTHROPIC', 'XAI', 'BANKR'));

CREATE TABLE IF NOT EXISTS broker_v2_punk_skills (
  skill_id TEXT PRIMARY KEY CHECK (skill_id ~ '^skill_[0-9a-f]{24}$'),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  token_id NUMERIC(78, 0) NOT NULL CHECK (token_id >= 0),
  schema_name TEXT NOT NULL CHECK (schema_name = 'GOGH_PUNK_SKILL_V1'),
  schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
  name VARCHAR(72) NOT NULL CHECK (length(name) BETWEEN 1 AND 72),
  description VARCHAR(480) NOT NULL CHECK (length(description) BETWEEN 1 AND 480),
  capabilities JSONB NOT NULL CHECK (jsonb_typeof(capabilities) = 'array'),
  authority TEXT NOT NULL CHECK (authority = 'READ_ONLY'),
  policy_effect TEXT NOT NULL CHECK (policy_effect = 'NONE'),
  state TEXT NOT NULL CHECK (state IN ('DRAFT', 'ACTIVE', 'PAUSED', 'SUPERSEDED')),
  configured_by CHAR(42) NOT NULL CHECK (configured_by = LOWER(configured_by)),
  ownership_block BIGINT NOT NULL CHECK (ownership_block >= 0),
  owner_confirmation_hash CHAR(66)
    CHECK (owner_confirmation_hash IS NULL OR owner_confirmation_hash ~ '^0x[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (chain_id, collection_address, token_id)
    REFERENCES broker_punks (chain_id, collection_address, token_id),
  CHECK (state <> 'ACTIVE' OR (owner_confirmation_hash IS NOT NULL AND activated_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS broker_v2_punk_skills_active_idx
  ON broker_v2_punk_skills (chain_id, collection_address, token_id, state, updated_at DESC);
