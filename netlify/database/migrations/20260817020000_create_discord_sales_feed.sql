CREATE TABLE IF NOT EXISTS discord_sales_feed_state (
  feed_key TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL,
  last_scanned_block BIGINT NOT NULL CHECK (last_scanned_block >= 0),
  last_scanned_block_hash CHAR(66) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discord_sales_events (
  event_id CHAR(64) PRIMARY KEY,
  chain_id INTEGER NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL,
  transaction_hash CHAR(66) NOT NULL,
  block_number BIGINT NOT NULL CHECK (block_number >= 0),
  block_hash CHAR(66) NOT NULL,
  order_log_index INTEGER NOT NULL CHECK (order_log_index >= 0),
  transfer_log_index INTEGER NOT NULL CHECK (transfer_log_index >= 0),
  order_hash CHAR(66) NOT NULL,
  token_id TEXT NOT NULL,
  seller CHAR(42) NOT NULL,
  buyer CHAR(42) NOT NULL,
  amount_wei NUMERIC(78, 0) NOT NULL CHECK (amount_wei > 0),
  discord_message_id VARCHAR(20),
  post_attempts INTEGER NOT NULL DEFAULT 0 CHECK (post_attempts >= 0),
  last_post_error TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  UNIQUE (chain_id, transaction_hash, order_log_index, collection_address)
);

CREATE INDEX IF NOT EXISTS discord_sales_events_pending_idx
  ON discord_sales_events (block_number, order_log_index)
  WHERE discord_message_id IS NULL;
