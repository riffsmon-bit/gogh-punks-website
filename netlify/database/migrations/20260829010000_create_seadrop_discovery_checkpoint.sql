CREATE TABLE IF NOT EXISTS broker_seadrop_discovery_state (
  chain_id INTEGER PRIMARY KEY,
  indexed_through_block NUMERIC(78, 0) NOT NULL CHECK (indexed_through_block >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broker_seadrop_public_drops (
  chain_id INTEGER NOT NULL,
  collection_address TEXT NOT NULL,
  mint_price_wei NUMERIC(78, 0) NOT NULL CHECK (mint_price_wei >= 0),
  start_time NUMERIC(78, 0) NOT NULL CHECK (start_time >= 0),
  end_time NUMERIC(78, 0) NOT NULL CHECK (end_time >= 0),
  max_total_mintable_by_wallet INTEGER NOT NULL CHECK (max_total_mintable_by_wallet >= 0),
  update_block_number NUMERIC(78, 0) NOT NULL CHECK (update_block_number >= 0),
  update_block_hash TEXT NOT NULL,
  update_transaction_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address),
  CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
  CHECK (update_block_hash ~ '^0x[0-9a-f]{64}$'),
  CHECK (update_transaction_hash ~ '^0x[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS broker_seadrop_public_drops_active_idx
  ON broker_seadrop_public_drops (chain_id, mint_price_wei, end_time, update_block_number DESC);
