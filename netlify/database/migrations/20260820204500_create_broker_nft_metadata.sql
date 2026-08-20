-- Sanitized display metadata only. OpenSea responses remain untrusted and raw
-- provider payloads/API credentials must never be stored in this table.
CREATE TABLE IF NOT EXISTS broker_nft_metadata (
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address CHAR(42) NOT NULL CHECK (collection_address = LOWER(collection_address)),
  token_id NUMERIC(78, 0) NOT NULL CHECK (token_id >= 0),
  source VARCHAR(32) NOT NULL CHECK (source IN ('OPENSEA_V2')),
  metadata_status VARCHAR(24) NOT NULL
    CHECK (metadata_status IN ('AVAILABLE', 'NOT_FOUND', 'ERROR')),
  name TEXT,
  description TEXT,
  display_image_url TEXT
    CHECK (display_image_url IS NULL OR display_image_url LIKE 'https://i.seadn.io/%'),
  collection_slug TEXT,
  token_standard VARCHAR(16)
    CHECK (token_standard IS NULL OR token_standard IN ('ERC721', 'ERC1155', 'UNKNOWN')),
  traits JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(traits) = 'array'),
  opensea_url TEXT NOT NULL CHECK (opensea_url LIKE 'https://opensea.io/assets/robinhood/%'),
  source_payload_hash CHAR(66)
    CHECK (source_payload_hash IS NULL OR source_payload_hash = LOWER(source_payload_hash)),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_error_code VARCHAR(64),
  fetched_at TIMESTAMPTZ NOT NULL,
  refresh_after TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, collection_address, token_id)
);

CREATE INDEX IF NOT EXISTS broker_nft_metadata_refresh_idx
  ON broker_nft_metadata (refresh_after, metadata_status);

COMMENT ON TABLE broker_nft_metadata IS
  'Sanitized OpenSea display enrichment. Never authoritative for ownership, execution, price, or safety.';
