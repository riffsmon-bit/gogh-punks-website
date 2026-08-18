ALTER TABLE broker_opportunities
  ADD COLUMN IF NOT EXISTS source_block_number BIGINT
    CHECK (source_block_number IS NULL OR source_block_number >= 0),
  ADD COLUMN IF NOT EXISTS source_block_hash CHAR(66)
    CHECK (source_block_hash IS NULL OR source_block_hash = LOWER(source_block_hash)),
  ADD COLUMN IF NOT EXISTS source_transaction_hash CHAR(66)
    CHECK (
      source_transaction_hash IS NULL
      OR source_transaction_hash = LOWER(source_transaction_hash)
    ),
  ADD COLUMN IF NOT EXISTS source_log_index INTEGER
    CHECK (source_log_index IS NULL OR source_log_index >= 0),
  ADD COLUMN IF NOT EXISTS canonical BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS broker_opportunities_source_block_idx
  ON broker_opportunities (chain_id, source, source_block_number)
  WHERE source_block_number IS NOT NULL;

COMMENT ON COLUMN broker_opportunities.canonical IS
  'False when a projected source event was removed by a detected chain reorganization.';

COMMENT ON COLUMN broker_opportunities.expected_price IS
  'Executable quote only. Historical Scout sale observations must store zero here and keep the observed amount in metadata.';
