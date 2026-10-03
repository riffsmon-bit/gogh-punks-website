-- Durable server-owned ownership history evidence for legacy Punk Agent sessions.
-- Each row is bound to one exact authorization and can only move forward.
ALTER TABLE broker_v2_agent_sessions
  ADD CONSTRAINT broker_v2_agent_sessions_checkpoint_binding_uniq
  UNIQUE (session_id, authorization_transaction_hash, session_generation);

CREATE TABLE broker_v2_agent_ownership_checkpoints (
  session_id UUID PRIMARY KEY,
  authorization_transaction_hash CHAR(66) NOT NULL
    CHECK (authorization_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  session_generation BIGINT NOT NULL CHECK (session_generation > 0),
  verified_block_number NUMERIC(78, 0) NOT NULL CHECK (verified_block_number >= 0),
  verified_block_hash CHAR(66) NOT NULL
    CHECK (verified_block_hash ~ '^0x[0-9a-f]{64}$'),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (session_id, authorization_transaction_hash, session_generation)
    REFERENCES broker_v2_agent_sessions
      (session_id, authorization_transaction_hash, session_generation)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE FUNCTION broker_v2_agent_ownership_checkpoint_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OWNERSHIP_CHECKPOINT_DELETE_FORBIDDEN';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.session_id IS DISTINCT FROM OLD.session_id
      OR NEW.authorization_transaction_hash IS DISTINCT FROM OLD.authorization_transaction_hash
      OR NEW.session_generation IS DISTINCT FROM OLD.session_generation THEN
      RAISE EXCEPTION 'OWNERSHIP_CHECKPOINT_BINDING_IMMUTABLE';
    END IF;
    IF NEW.verified_block_number < OLD.verified_block_number THEN
      RAISE EXCEPTION 'OWNERSHIP_CHECKPOINT_ROLLBACK_FORBIDDEN';
    END IF;
    IF NEW.verified_block_number = OLD.verified_block_number
      AND NEW.verified_block_hash IS DISTINCT FROM OLD.verified_block_hash THEN
      RAISE EXCEPTION 'OWNERSHIP_CHECKPOINT_HASH_CHANGE_FORBIDDEN';
    END IF;
    NEW.verified_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER broker_v2_agent_ownership_checkpoint_guard_trigger
  BEFORE UPDATE OR DELETE ON broker_v2_agent_ownership_checkpoints
  FOR EACH ROW EXECUTE FUNCTION broker_v2_agent_ownership_checkpoint_guard();

ALTER TABLE broker_v2_agent_ownership_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON broker_v2_agent_ownership_checkpoints FROM PUBLIC;
