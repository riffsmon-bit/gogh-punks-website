-- Storage only. No live endpoint, credit issuer, skill grant, wallet or burn authority.
CREATE TABLE broker_forge_training_intents (
  intent_id uuid PRIMARY KEY,
  request_key text NOT NULL CHECK (request_key ~ '^[0-9a-f]{64}$'),
  chain_id integer NOT NULL CHECK (chain_id IN (31337, 4663)),
  collection_address text NOT NULL CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
  progression_address text NOT NULL CHECK (progression_address ~ '^0x[0-9a-f]{40}$'),
  deployment_hash text NOT NULL CHECK (deployment_hash ~ '^0x[0-9a-f]{64}$'),
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  punk_token_id numeric(78,0) NOT NULL CHECK (punk_token_id >= 0 AND punk_token_id < power(2::numeric,256)),
  owner_nonce numeric(20,0) NOT NULL CHECK (owner_nonce >= 0 AND owner_nonce < power(2::numeric,64)),
  review_json text NOT NULL CHECK (octet_length(review_json) <= 16384 AND jsonb_typeof(review_json::jsonb) = 'object'),
  review_hash text NOT NULL CHECK (review_hash = encode(sha256(convert_to(review_json, 'UTF8')), 'hex')),
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED', 'WALLET_REQUESTED',
    'SUBMISSION_UNKNOWN', 'SUBMITTED', 'INCLUDED_SUCCESS', 'INCLUDED_REVERT', 'REORGED', 'EXPIRED', 'CANCELLED')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  transaction_hash text CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  observation jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (chain_id, owner_address, request_key),
  UNIQUE (chain_id, transaction_hash),
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '60 seconds'),
  CHECK (((review_json::jsonb ->> 'chainId')::integer = chain_id
    AND review_json::jsonb ->> 'collection' = collection_address
    AND review_json::jsonb ->> 'progression' = progression_address
    AND review_json::jsonb ->> 'deploymentHash' = deployment_hash
    AND review_json::jsonb ->> 'owner' = owner_address
    AND review_json::jsonb ->> 'tokenId' = punk_token_id::text
    AND review_json::jsonb #>> '{transaction,nonce}' = owner_nonce::text
    AND (review_json::jsonb #>> '{guard,deadline}')::numeric = EXTRACT(EPOCH FROM expires_at)) IS TRUE),
  CHECK ((status IN ('SUBMITTED', 'INCLUDED_SUCCESS', 'INCLUDED_REVERT', 'REORGED')) = (transaction_hash IS NOT NULL)),
  CHECK ((status IN ('INCLUDED_SUCCESS', 'INCLUDED_REVERT', 'REORGED')) = (observation IS NOT NULL))
);

-- Scope intentionally excludes owner AND deployment: transfer/redeployment must not
-- bypass an unresolved old intent. Inclusion is not finality and retains both locks.
CREATE UNIQUE INDEX broker_forge_training_token_hold ON broker_forge_training_intents
  (chain_id, collection_address, punk_token_id) WHERE status NOT IN ('EXPIRED', 'CANCELLED');
CREATE UNIQUE INDEX broker_forge_training_nonce_hold ON broker_forge_training_intents
  (chain_id, owner_address, owner_nonce) WHERE status NOT IN ('EXPIRED', 'CANCELLED');
CREATE INDEX broker_forge_training_owner_lookup ON broker_forge_training_intents
  (chain_id, owner_address, created_at DESC);

CREATE TABLE broker_forge_training_intent_events (
  intent_id uuid NOT NULL REFERENCES broker_forge_training_intents(intent_id),
  revision integer NOT NULL,
  status text NOT NULL,
  transaction_hash text,
  observation jsonb,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (intent_id, revision)
);

CREATE FUNCTION broker_forge_training_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PREPARED' OR NEW.revision <> 0 THEN
      RAISE EXCEPTION 'FORGE_INVALID_INITIAL_STATE';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['status','revision','transaction_hash','observation','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','revision','transaction_hash','observation','updated_at'])
      OR NEW.revision <> OLD.revision + 1
      OR (OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash) THEN
      RAISE EXCEPTION 'FORGE_IMMUTABLE_INTENT';
    END IF;
    IF NOT (
      (OLD.status = 'PREPARED' AND NEW.status IN ('WALLET_REQUESTED','EXPIRED','CANCELLED')) OR
      (OLD.status = 'WALLET_REQUESTED' AND NEW.status IN ('SUBMISSION_UNKNOWN','SUBMITTED')) OR
      (OLD.status = 'SUBMISSION_UNKNOWN' AND NEW.status = 'SUBMITTED') OR
      (OLD.status IN ('SUBMITTED','REORGED') AND NEW.status IN ('INCLUDED_SUCCESS','INCLUDED_REVERT')) OR
      (OLD.status IN ('INCLUDED_SUCCESS','INCLUDED_REVERT') AND NEW.status = 'REORGED')
    ) THEN RAISE EXCEPTION 'FORGE_INVALID_TRANSITION'; END IF;
    IF OLD.status = 'PREPARED' AND NEW.status = 'WALLET_REQUESTED' AND NEW.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'FORGE_REVIEW_EXPIRED';
    END IF;
    IF NEW.status = 'EXPIRED' AND NEW.expires_at > clock_timestamp() THEN
      RAISE EXCEPTION 'FORGE_REVIEW_NOT_EXPIRED';
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER broker_forge_training_guard_trigger BEFORE INSERT OR UPDATE
  ON broker_forge_training_intents FOR EACH ROW EXECUTE FUNCTION broker_forge_training_guard();

CREATE FUNCTION broker_forge_training_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO broker_forge_training_intent_events (intent_id, revision, status, transaction_hash, observation)
    VALUES (NEW.intent_id, NEW.revision, NEW.status, NEW.transaction_hash, NEW.observation);
  RETURN NEW;
END $$;
CREATE TRIGGER broker_forge_training_audit_trigger AFTER INSERT OR UPDATE
  ON broker_forge_training_intents FOR EACH ROW EXECUTE FUNCTION broker_forge_training_audit();

ALTER TABLE broker_forge_training_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_forge_training_intent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON broker_forge_training_intents, broker_forge_training_intent_events FROM PUBLIC;
REVOKE ALL ON FUNCTION broker_forge_training_guard(), broker_forge_training_audit() FROM PUBLIC;
-- No browser-role policy or grant. A future reviewed server role must be provisioned
-- separately. The table owner is trusted; hashes are corruption checks, not signatures.
