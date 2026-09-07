-- Owner-assisted V2 mint reservations and receipt reconciliation.
-- The server never signs or submits these transactions; it only binds a short-lived review
-- artifact to one attempt and records a mint after exact on-chain receipt verification.

ALTER TABLE broker_v2_execution_attempts
  ADD COLUMN IF NOT EXISTS approval_expires_at TIMESTAMPTZ;

UPDATE broker_v2_execution_attempts
SET state = 'EXPIRED', updated_at = NOW()
WHERE state = 'OWNER_APPROVAL_PENDING' AND approval_expires_at IS NULL;

ALTER TABLE broker_v2_execution_attempts
  DROP CONSTRAINT IF EXISTS broker_v2_execution_attempts_envelope_hash_format;

ALTER TABLE broker_v2_execution_attempts
  ADD CONSTRAINT broker_v2_execution_attempts_envelope_hash_format
  CHECK (transaction_envelope_hash IS NULL OR transaction_envelope_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE broker_v2_execution_attempts
  DROP CONSTRAINT IF EXISTS broker_v2_execution_attempts_approval_expiry;

ALTER TABLE broker_v2_execution_attempts
  ADD CONSTRAINT broker_v2_execution_attempts_approval_expiry
  CHECK (state <> 'OWNER_APPROVAL_PENDING' OR approval_expires_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS broker_v2_attempts_pending_limits_idx
  ON broker_v2_execution_attempts (chain_id, punk_token_id, state, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS broker_v2_activity_collected_attempt_uidx
  ON broker_v2_activity (attempt_id)
  WHERE attempt_id IS NOT NULL AND activity_type = 'COLLECTED';
