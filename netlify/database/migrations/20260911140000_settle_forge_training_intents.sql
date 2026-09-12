-- Server-internal settlement. No browser grants, credit minting or wallet authority.
ALTER TABLE broker_forge_training_intents ADD COLUMN settlement jsonb;
ALTER TABLE broker_forge_training_intent_events ADD COLUMN settlement jsonb;

-- Replace only the three status-dependent checks from the staged initial migration.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT conname FROM pg_constraint
    WHERE conrelid='broker_forge_training_intents'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP EXECUTE format('ALTER TABLE broker_forge_training_intents DROP CONSTRAINT %I', item.conname); END LOOP;
END $$;

ALTER TABLE broker_forge_training_intents
  ADD CONSTRAINT forge_training_valid_status CHECK (status IN ('PREPARED','WALLET_REQUESTED',
    'SUBMISSION_UNKNOWN','SUBMITTED','INCLUDED_SUCCESS','INCLUDED_REVERT','REORGED','EXPIRED','CANCELLED',
    'SETTLED_SUCCESS','SETTLED_REVERT','NONCE_CONSUMED','REVIEW_EXPIRED')),
  ADD CONSTRAINT forge_training_hash_state CHECK (
    CASE WHEN status IN ('SUBMITTED','INCLUDED_SUCCESS','INCLUDED_REVERT','REORGED','SETTLED_SUCCESS','SETTLED_REVERT')
      THEN transaction_hash IS NOT NULL
      WHEN status IN ('NONCE_CONSUMED','REVIEW_EXPIRED') THEN true ELSE transaction_hash IS NULL END),
  ADD CONSTRAINT forge_training_observation_state CHECK (
    CASE WHEN status IN ('INCLUDED_SUCCESS','INCLUDED_REVERT','REORGED') THEN observation IS NOT NULL
      WHEN status IN ('SETTLED_SUCCESS','SETTLED_REVERT','NONCE_CONSUMED','REVIEW_EXPIRED') THEN true ELSE observation IS NULL END),
  ADD CONSTRAINT forge_training_settlement_state CHECK (
    (status IN ('SETTLED_SUCCESS','SETTLED_REVERT','NONCE_CONSUMED','REVIEW_EXPIRED')) = (settlement IS NOT NULL)),
  ADD CONSTRAINT forge_training_settlement_binding CHECK (settlement IS NULL OR (
    jsonb_typeof(settlement)='object'
    AND settlement->>'schema'='GOGH_TRAINING_SETTLEMENT_V1'
    AND settlement->>'policy'='RPC_FINALIZED_QUORUM_V1'
    AND settlement->>'status'=status AND settlement->>'reviewHash'=review_hash
    AND (settlement->>'transactionHash') IS NOT DISTINCT FROM transaction_hash
    AND settlement->>'finalizedBlockNumber' ~ '^(0|[1-9][0-9]{0,19})$'
    AND settlement->>'finalizedBlockHash' ~ '^0x[0-9a-f]{64}$'
    AND settlement->>'finalizedTimestamp' ~ '^(0|[1-9][0-9]{0,19})$'
    AND settlement->>'ownerNonce' ~ '^(0|[1-9][0-9]{0,19})$'
    AND CASE WHEN status='REVIEW_EXPIRED' THEN (settlement->>'ownerNonce')::numeric <= owner_nonce
      ELSE (settlement->>'ownerNonce')::numeric > owner_nonce END
    AND (settlement->>'ownerNonce')::numeric < power(2::numeric,64)
    AND settlement->'sources'='["PUBLICNODE","ROBINHOOD"]'::jsonb
    AND settlement->>'evidenceHash' ~ '^0x[0-9a-f]{64}$'
    AND CASE WHEN status IN ('NONCE_CONSUMED','REVIEW_EXPIRED') THEN
      (settlement->>'finalizedTimestamp')::numeric > EXTRACT(EPOCH FROM expires_at)
      AND (settlement->>'finalizedBlockNumber')::numeric >= (review_json::jsonb #>> '{anchor,number}')::numeric
      AND settlement->'receiptBlockNumber'='null'::jsonb AND settlement->'receiptBlockHash'='null'::jsonb
    ELSE settlement->>'receiptBlockNumber' ~ '^(0|[1-9][0-9]{0,19})$'
      AND settlement->>'receiptBlockHash' ~ '^0x[0-9a-f]{64}$'
      AND (settlement->>'receiptBlockNumber')::numeric >= (review_json::jsonb #>> '{anchor,number}')::numeric
      AND (settlement->>'receiptBlockNumber')::numeric <= (settlement->>'finalizedBlockNumber')::numeric END
  ) IS TRUE);

DROP INDEX broker_forge_training_token_hold;
DROP INDEX broker_forge_training_nonce_hold;
CREATE UNIQUE INDEX broker_forge_training_token_hold ON broker_forge_training_intents
  (chain_id,collection_address,punk_token_id)
  WHERE status NOT IN ('EXPIRED','CANCELLED','SETTLED_SUCCESS','SETTLED_REVERT','NONCE_CONSUMED','REVIEW_EXPIRED');
CREATE UNIQUE INDEX broker_forge_training_nonce_hold ON broker_forge_training_intents
  (chain_id,owner_address,owner_nonce)
  WHERE status NOT IN ('EXPIRED','CANCELLED','SETTLED_SUCCESS','SETTLED_REVERT','NONCE_CONSUMED','REVIEW_EXPIRED');
CREATE INDEX broker_forge_training_reconciliation ON broker_forge_training_intents
  (updated_at,intent_id) WHERE status IN ('WALLET_REQUESTED','SUBMISSION_UNKNOWN','SUBMITTED',
    'INCLUDED_SUCCESS','INCLUDED_REVERT','REORGED');

CREATE TABLE broker_forge_training_reconciliation_jobs (
  intent_id uuid PRIMARY KEY REFERENCES broker_forge_training_intents(intent_id),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  last_result text CHECK (last_result ~ '^[A-Z_0-9]{1,80}$'),
  CHECK ((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX broker_forge_training_due_jobs ON broker_forge_training_reconciliation_jobs (next_attempt_at,intent_id);
ALTER TABLE broker_forge_training_reconciliation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON broker_forge_training_reconciliation_jobs FROM PUBLIC;
INSERT INTO broker_forge_training_reconciliation_jobs (intent_id)
  SELECT intent_id FROM broker_forge_training_intents WHERE status IN ('WALLET_REQUESTED','SUBMISSION_UNKNOWN',
    'SUBMITTED','INCLUDED_SUCCESS','INCLUDED_REVERT','REORGED');

CREATE OR REPLACE FUNCTION broker_forge_training_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PREPARED' OR NEW.revision<>0 OR NEW.settlement IS NOT NULL THEN
      RAISE EXCEPTION 'FORGE_INVALID_INITIAL_STATE';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['status','revision','transaction_hash','observation','settlement','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','transaction_hash','observation','settlement','updated_at'])
      OR NEW.revision<>OLD.revision+1
      OR (OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash) THEN
      RAISE EXCEPTION 'FORGE_IMMUTABLE_INTENT';
    END IF;
    IF NOT (
      (OLD.status='PREPARED' AND NEW.status IN ('WALLET_REQUESTED','EXPIRED','CANCELLED')) OR
      (OLD.status='WALLET_REQUESTED' AND NEW.status IN ('SUBMISSION_UNKNOWN','SUBMITTED','NONCE_CONSUMED','REVIEW_EXPIRED')) OR
      (OLD.status='SUBMISSION_UNKNOWN' AND NEW.status IN ('SUBMITTED','NONCE_CONSUMED','REVIEW_EXPIRED')) OR
      (OLD.status IN ('SUBMITTED','REORGED') AND NEW.status IN ('INCLUDED_SUCCESS','INCLUDED_REVERT',
        'SETTLED_SUCCESS','SETTLED_REVERT','NONCE_CONSUMED','REVIEW_EXPIRED')) OR
      (OLD.status='INCLUDED_SUCCESS' AND NEW.status IN ('REORGED','SETTLED_SUCCESS','NONCE_CONSUMED','REVIEW_EXPIRED')) OR
      (OLD.status='INCLUDED_REVERT' AND NEW.status IN ('REORGED','SETTLED_REVERT','NONCE_CONSUMED','REVIEW_EXPIRED'))
    ) THEN RAISE EXCEPTION 'FORGE_INVALID_TRANSITION'; END IF;
    IF NEW.status IN ('SETTLED_SUCCESS','SETTLED_REVERT','NONCE_CONSUMED','REVIEW_EXPIRED') THEN
      IF NEW.observation IS DISTINCT FROM OLD.observation THEN RAISE EXCEPTION 'FORGE_OBSERVATION_REWRITE'; END IF;
    ELSIF NEW.settlement IS NOT NULL THEN RAISE EXCEPTION 'FORGE_PREMATURE_SETTLEMENT'; END IF;
    IF OLD.status='PREPARED' AND NEW.status='WALLET_REQUESTED' AND NEW.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'FORGE_REVIEW_EXPIRED';
    END IF;
    IF NEW.status='EXPIRED' AND NEW.expires_at>clock_timestamp() THEN RAISE EXCEPTION 'FORGE_REVIEW_NOT_EXPIRED'; END IF;
  END IF;
  NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;

-- A narrow API role need not have direct INSERT/UPDATE/DELETE on audit history.
-- Resolve the target from the triggering table, not a caller-controlled search_path.
CREATE OR REPLACE FUNCTION broker_forge_training_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  EXECUTE format('INSERT INTO %I.broker_forge_training_intent_events
    (intent_id,revision,status,transaction_hash,observation,settlement) VALUES ($1,$2,$3,$4,$5,$6)', TG_TABLE_SCHEMA)
    USING NEW.intent_id,NEW.revision,NEW.status,NEW.transaction_hash,NEW.observation,NEW.settlement;
  IF NEW.status IN ('WALLET_REQUESTED','SUBMISSION_UNKNOWN','SUBMITTED','INCLUDED_SUCCESS','INCLUDED_REVERT','REORGED') THEN
    EXECUTE format('INSERT INTO %I.broker_forge_training_reconciliation_jobs (intent_id)
      VALUES ($1) ON CONFLICT (intent_id) DO NOTHING', TG_TABLE_SCHEMA) USING NEW.intent_id;
  ELSE
    EXECUTE format('DELETE FROM %I.broker_forge_training_reconciliation_jobs WHERE intent_id=$1',TG_TABLE_SCHEMA) USING NEW.intent_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION broker_forge_training_guard(),broker_forge_training_audit() FROM PUBLIC;
-- RLS and the initial PUBLIC revocations remain. Server roles require explicit,
-- reviewed grants/policies; the request-serving role must not UPDATE settlement.
