ALTER TABLE broker_collections
  ADD COLUMN IF NOT EXISTS analysis_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS analysis_failure JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS analysis_block_number BIGINT
    CHECK (analysis_block_number IS NULL OR analysis_block_number >= 0),
  ADD COLUMN IF NOT EXISTS analysis_block_hash CHAR(66)
    CHECK (analysis_block_hash IS NULL OR analysis_block_hash = LOWER(analysis_block_hash));

CREATE INDEX IF NOT EXISTS broker_collections_analysis_queue_idx
  ON broker_collections (chain_id, analysis_attempted_at, analyzed_at)
  WHERE first_seen_block IS NOT NULL;

COMMENT ON COLUMN broker_collections.analysis_failure IS
  'Sanitized retry evidence only. Never store provider secrets, raw headers, or stack traces.';

COMMENT ON COLUMN broker_collections.analysis_block_hash IS
  'Canonical block hash that all RPC evidence in the current collection analysis is pinned to.';
