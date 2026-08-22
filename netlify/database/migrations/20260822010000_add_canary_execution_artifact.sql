ALTER TABLE broker_canary_execution_reviews
  ADD COLUMN IF NOT EXISTS execution_artifact_json TEXT;

ALTER TABLE broker_canary_execution_reviews
  DROP CONSTRAINT IF EXISTS broker_canary_execution_artifact_size;

ALTER TABLE broker_canary_execution_reviews
  ADD CONSTRAINT broker_canary_execution_artifact_size
  CHECK (
    execution_artifact_json IS NULL
    OR (
      OCTET_LENGTH(execution_artifact_json) > 0
      AND OCTET_LENGTH(execution_artifact_json) <= 2000000
    )
  );

-- The artifact contains only public, short-lived, zero-value transaction review evidence.
-- It contains no signature, private key, bearer token, mnemonic, or RPC credential.
