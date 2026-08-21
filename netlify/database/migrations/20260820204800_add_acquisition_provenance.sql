ALTER TABLE broker_acquisitions
  ADD COLUMN IF NOT EXISTS opportunity_id CHAR(66)
    CHECK (
      opportunity_id IS NULL
      OR (
        opportunity_id = LOWER(opportunity_id)
        AND opportunity_id ~ '^0x[0-9a-f]{64}$'
        AND opportunity_id <> '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
    ),
  ADD COLUMN IF NOT EXISTS opportunity_type VARCHAR(32)
    CHECK (
      opportunity_type IS NULL
      OR opportunity_type IN (
        'MINT', 'SECONDARY_BUY', 'FREE_MINT', 'EDITION', 'ONE_OF_ONE',
        'AUCTION', 'ALLOWLIST_MINT', 'COLLECTION_DROP'
      )
    ),
  ADD COLUMN IF NOT EXISTS asset_standard VARCHAR(16)
    CHECK (asset_standard IS NULL OR asset_standard IN ('ERC721', 'ERC1155')),
  ADD COLUMN IF NOT EXISTS adapter_address CHAR(42)
    CHECK (
      adapter_address IS NULL
      OR (
        adapter_address = LOWER(adapter_address)
        AND adapter_address ~ '^0x[0-9a-f]{40}$'
      )
    ),
  ADD COLUMN IF NOT EXISTS executor_address CHAR(42)
    CHECK (
      executor_address IS NULL
      OR (
        executor_address = LOWER(executor_address)
        AND executor_address ~ '^0x[0-9a-f]{40}$'
      )
    ),
  ADD COLUMN IF NOT EXISTS owner_approved BOOLEAN,
  ADD COLUMN IF NOT EXISTS acquisition_nonce NUMERIC(78, 0)
    CHECK (acquisition_nonce IS NULL OR acquisition_nonce >= 0),
  ADD COLUMN IF NOT EXISTS state_sequence NUMERIC(78, 0)
    CHECK (state_sequence IS NULL OR state_sequence >= 0);

CREATE INDEX IF NOT EXISTS broker_acquisitions_punk_time_idx
  ON broker_acquisitions
  (chain_id, punk_collection_address, punk_token_id, acquired_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS broker_punks_chain_account_identity_idx
  ON broker_punks (chain_id, account_address)
  WHERE account_address IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'broker_acquisitions_reasoning_hash_nonzero'
       AND conrelid = 'broker_acquisitions'::regclass
  ) THEN
    ALTER TABLE broker_acquisitions
      ADD CONSTRAINT broker_acquisitions_reasoning_hash_nonzero
      CHECK (
        reasoning_hash <>
          '0x0000000000000000000000000000000000000000000000000000000000000000'
      );
  END IF;
END
$$;

COMMENT ON COLUMN broker_acquisitions.opportunity_id IS
  'Exact bytes32 opportunity identifier emitted by the canonical Punk Account.';

COMMENT ON COLUMN broker_acquisitions.adapter_address IS
  'Exact policy-approved adapter emitted by the canonical Punk Account.';

COMMENT ON COLUMN broker_acquisitions.executor_address IS
  'Transaction caller recorded by AcquisitionExecuted; agent_address is populated only for autonomous execution.';
