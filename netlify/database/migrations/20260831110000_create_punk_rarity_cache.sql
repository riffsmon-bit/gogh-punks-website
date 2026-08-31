CREATE TABLE IF NOT EXISTS broker_punk_rarity_cache (
  chain_id INTEGER NOT NULL,
  collection_address CHAR(42) NOT NULL,
  punk_token_id NUMERIC(78, 0) NOT NULL,
  rarity_rank INTEGER NOT NULL,
  rarity_tier TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address, punk_token_id),
  CONSTRAINT broker_punk_rarity_cache_chain_check CHECK (chain_id = 4663),
  CONSTRAINT broker_punk_rarity_cache_collection_check CHECK (
    collection_address = LOWER(collection_address)
  ),
  CONSTRAINT broker_punk_rarity_cache_rank_check CHECK (
    rarity_rank >= 1 AND rarity_rank <= 5016
  ),
  CONSTRAINT broker_punk_rarity_cache_tier_check CHECK (
    rarity_tier IN ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC')
  ),
  CONSTRAINT broker_punk_rarity_cache_source_check CHECK (
    source = 'OPENSEA_OPENRARITY_CURRENT'
  )
);

CREATE INDEX IF NOT EXISTS broker_punk_rarity_cache_rank_idx
  ON broker_punk_rarity_cache (rarity_rank ASC, punk_token_id ASC);
