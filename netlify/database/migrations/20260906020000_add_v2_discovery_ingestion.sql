CREATE TABLE IF NOT EXISTS broker_v2_discovery_checkpoints (
  source_key VARCHAR(96) NOT NULL,
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  indexed_through_block NUMERIC(78, 0) NOT NULL CHECK (indexed_through_block >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_key, chain_id)
);

ALTER TABLE broker_v2_security_screenings
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE broker_v2_security_screenings
  DROP CONSTRAINT IF EXISTS broker_v2_security_screenings_evidence_object;

ALTER TABLE broker_v2_security_screenings
  ADD CONSTRAINT broker_v2_security_screenings_evidence_object
  CHECK (jsonb_typeof(evidence) = 'object');
