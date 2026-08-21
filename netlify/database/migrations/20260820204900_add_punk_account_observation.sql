ALTER TABLE broker_punks
  ADD COLUMN IF NOT EXISTS account_observation_source VARCHAR(32)
    CHECK (
      account_observation_source IS NULL
      OR account_observation_source IN ('ACTIVATION_EVENT', 'REGISTRY_RECONCILIATION')
    ),
  ADD COLUMN IF NOT EXISTS account_observed_block_number BIGINT
    CHECK (account_observed_block_number IS NULL OR account_observed_block_number >= 0),
  ADD COLUMN IF NOT EXISTS account_observed_block_hash CHAR(66)
    CHECK (
      account_observed_block_hash IS NULL
      OR (
        account_observed_block_hash = LOWER(account_observed_block_hash)
        AND account_observed_block_hash ~ '^0x[0-9a-f]{64}$'
      )
    ),
  ADD COLUMN IF NOT EXISTS account_activation_transaction_hash CHAR(66)
    CHECK (
      account_activation_transaction_hash IS NULL
      OR (
        account_activation_transaction_hash = LOWER(account_activation_transaction_hash)
        AND account_activation_transaction_hash ~ '^0x[0-9a-f]{64}$'
      )
    ),
  ADD COLUMN IF NOT EXISTS account_activation_log_index INTEGER
    CHECK (account_activation_log_index IS NULL OR account_activation_log_index >= 0);

CREATE INDEX IF NOT EXISTS broker_punks_account_observation_idx
  ON broker_punks (chain_id, account_observed_block_number)
  WHERE account_observed_block_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS broker_indexed_logs_account_emitter_idx
  ON broker_indexed_logs (chain_id, stream, address, block_number, log_index)
  WHERE stream = 'account_acquisitions';

COMMENT ON COLUMN broker_punks.account_observation_source IS
  'Confirmed activation-event evidence or independent facade/singleton reconciliation; cleared on affected reorg rewind.';
