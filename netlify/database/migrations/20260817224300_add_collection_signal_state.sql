ALTER TABLE broker_indexed_logs
  ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ;

ALTER TABLE broker_opportunities
  ADD COLUMN IF NOT EXISTS source_block_timestamp TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS broker_opportunities_activity_window_idx
  ON broker_opportunities
  (chain_id, collection_address, source_block_timestamp DESC)
  WHERE canonical = TRUE
    AND source = 'ROBINHOOD_SEAPORT_ACTIVITY'
    AND source_block_timestamp IS NOT NULL;

CREATE TABLE IF NOT EXISTS broker_collection_signal_snapshots (
  chain_id BIGINT NOT NULL,
  collection_address CHAR(42) NOT NULL
    CHECK (collection_address = LOWER(collection_address)),
  analysis_block_number BIGINT NOT NULL CHECK (analysis_block_number >= 0),
  analysis_block_hash CHAR(66) NOT NULL
    CHECK (analysis_block_hash = LOWER(analysis_block_hash)),
  analysis_block_timestamp TIMESTAMPTZ NOT NULL,
  analyzer_version VARCHAR(64) NOT NULL,
  source_min_block BIGINT CHECK (source_min_block IS NULL OR source_min_block >= 0),
  source_max_block BIGINT CHECK (source_max_block IS NULL OR source_max_block >= 0),
  signals JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (
    chain_id,
    collection_address,
    analysis_block_number,
    analyzer_version
  ),
  FOREIGN KEY (chain_id, collection_address)
    REFERENCES broker_collections (chain_id, collection_address)
);

CREATE INDEX IF NOT EXISTS broker_collection_signal_snapshots_recent_idx
  ON broker_collection_signal_snapshots
  (chain_id, collection_address, captured_at DESC);

COMMENT ON COLUMN broker_opportunities.source_block_timestamp IS
  'Timestamp from the canonical source block. Never substitute index insertion time for market-window calculations.';

COMMENT ON COLUMN broker_collection_signal_snapshots.analysis_block_timestamp IS
  'Canonical timestamp for the confirmed analysis block; distinct from worker capture time.';

COMMENT ON TABLE broker_collection_signal_snapshots IS
  'Read-only, block-qualified collection intelligence. It cannot authorize execution or represent a live quote.';
