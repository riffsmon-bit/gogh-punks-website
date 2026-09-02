-- Repair priority result persistence and add a durable pre-submission idempotency boundary.
-- This migration is additive: existing sessions, gas usage, and credits are preserved.

CREATE TABLE IF NOT EXISTS gogh_broker_punk_priority_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES gogh_broker_punk_priority_sessions(session_id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  state TEXT NOT NULL DEFAULT 'CLAIMED'
    CHECK (state IN ('CLAIMED', 'SUBMISSION_RESERVED', 'SUBMITTED', 'RECORDED')),
  worker_release TEXT NOT NULL CHECK (worker_release ~ '^[0-9a-f]{40}$'),
  lane_id SMALLINT NOT NULL CHECK (lane_id BETWEEN 1 AND 6),
  lease_token UUID NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  account_address TEXT CHECK (account_address IS NULL OR account_address ~ '^0x[0-9a-f]{40}$'),
  target_collection TEXT
    CHECK (target_collection IS NULL OR target_collection ~ '^0x[0-9a-f]{40}$'),
  acquisition_nonce NUMERIC(78, 0) CHECK (acquisition_nonce IS NULL OR acquisition_nonce >= 0),
  transaction_hash TEXT UNIQUE
    CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  result_status TEXT CHECK (result_status IS NULL OR result_status ~ '^[A-Z0-9_]{1,128}$'),
  submitted BOOLEAN NOT NULL DEFAULT FALSE,
  minted BOOLEAN NOT NULL DEFAULT FALSE,
  gas_used NUMERIC(78, 0) CHECK (gas_used IS NULL OR gas_used > 0),
  effective_gas_price_wei NUMERIC(78, 0)
    CHECK (effective_gas_price_wei IS NULL OR effective_gas_price_wei > 0),
  transaction_gas_cost_wei NUMERIC(78, 0)
    CHECK (transaction_gas_cost_wei IS NULL OR transaction_gas_cost_wei > 0),
  terminal_state TEXT
    CHECK (terminal_state IS NULL OR terminal_state IN ('OWNER_CHANGED', 'CANCELLED')),
  reserved_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, attempt_number),
  CHECK ((state NOT IN ('SUBMISSION_RESERVED', 'SUBMITTED')) OR reserved_at IS NOT NULL),
  CHECK ((state <> 'SUBMITTED') OR (submitted AND transaction_hash IS NOT NULL)),
  CHECK ((state <> 'RECORDED') OR recorded_at IS NOT NULL),
  CHECK ((gas_used IS NULL AND effective_gas_price_wei IS NULL
          AND transaction_gas_cost_wei IS NULL)
      OR (gas_used IS NOT NULL AND effective_gas_price_wei IS NOT NULL
          AND transaction_gas_cost_wei = gas_used * effective_gas_price_wei))
);

CREATE UNIQUE INDEX IF NOT EXISTS gogh_broker_punk_priority_attempts_one_open_idx
  ON gogh_broker_punk_priority_attempts (session_id)
  WHERE state <> 'RECORDED';

CREATE INDEX IF NOT EXISTS gogh_broker_punk_priority_attempts_transaction_idx
  ON gogh_broker_punk_priority_attempts (transaction_hash)
  WHERE transaction_hash IS NOT NULL;

ALTER TABLE gogh_broker_punk_priority_attempts ENABLE ROW LEVEL SECURITY;

-- Atomically claim one logical attempt. An expired CLAIMED lease may be resumed because no
-- submission reservation exists. A reserved/submitted attempt is never executable again: an
-- operator or receipt reconciler must settle it using its account nonce or transaction hash.
CREATE OR REPLACE FUNCTION gogh_broker_begin_punk_priority_attempt(
  requested_session_id UUID,
  requested_worker_release TEXT,
  requested_lane_id SMALLINT,
  requested_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE(
  attempt_id UUID,
  lease_token UUID,
  executable BOOLEAN,
  reason TEXT,
  attempt_state TEXT,
  transaction_hash TEXT,
  session_state TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_session gogh_broker_punk_priority_sessions%ROWTYPE;
  selected_attempt gogh_broker_punk_priority_attempts%ROWTYPE;
  selected_lease_token UUID;
  selected_attempt_number INTEGER;
BEGIN
  IF requested_worker_release !~ '^[0-9a-f]{40}$'
     OR requested_lane_id NOT BETWEEN 1 AND 6
     OR requested_lease_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION 'invalid priority attempt claim';
  END IF;

  SELECT priority_session.* INTO selected_session
    FROM gogh_broker_punk_priority_sessions AS priority_session
   WHERE priority_session.session_id = requested_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF selected_session.state = 'ACTIVE' AND selected_session.expires_at <= NOW() THEN
    UPDATE gogh_broker_punk_priority_sessions AS priority_session
       SET state = 'EXPIRED', updated_at = NOW()
     WHERE priority_session.session_id = selected_session.session_id;
    selected_session.state := 'EXPIRED';
  ELSIF selected_session.state = 'ACTIVE'
        AND selected_session.completed_mints >= selected_session.requested_mints THEN
    UPDATE gogh_broker_punk_priority_sessions AS priority_session
       SET state = 'COMPLETE', updated_at = NOW()
     WHERE priority_session.session_id = selected_session.session_id;
    selected_session.state := 'COMPLETE';
  END IF;

  IF selected_session.state <> 'ACTIVE' THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, FALSE, 'SESSION_TERMINAL', NULL::TEXT,
      NULL::TEXT, selected_session.state, selected_session.expires_at;
    RETURN;
  END IF;

  SELECT priority_attempt.* INTO selected_attempt
    FROM gogh_broker_punk_priority_attempts AS priority_attempt
   WHERE priority_attempt.session_id = selected_session.session_id
     AND priority_attempt.state <> 'RECORDED'
   FOR UPDATE;

  IF FOUND THEN
    IF selected_attempt.state <> 'CLAIMED' THEN
      RETURN QUERY SELECT selected_attempt.attempt_id, selected_attempt.lease_token, FALSE,
        CASE WHEN selected_attempt.state = 'SUBMITTED'
          THEN 'TRANSACTION_SUBMITTED_AWAITING_RECORD'
          ELSE 'SUBMISSION_RESERVED_AWAITING_RECONCILIATION' END,
        selected_attempt.state, selected_attempt.transaction_hash,
        selected_session.state, selected_session.expires_at;
      RETURN;
    END IF;
    IF selected_attempt.lease_until > NOW() THEN
      RETURN QUERY SELECT selected_attempt.attempt_id, selected_attempt.lease_token, FALSE,
        'ATTEMPT_IN_PROGRESS', selected_attempt.state, selected_attempt.transaction_hash,
        selected_session.state,
        selected_session.expires_at;
      RETURN;
    END IF;
    selected_lease_token := gen_random_uuid();
    UPDATE gogh_broker_punk_priority_attempts AS priority_attempt
       SET lease_token = selected_lease_token,
           lease_until = NOW() + (requested_lease_seconds * INTERVAL '1 second'),
           worker_release = requested_worker_release,
           lane_id = requested_lane_id,
           updated_at = NOW()
     WHERE priority_attempt.attempt_id = selected_attempt.attempt_id;
    RETURN QUERY SELECT selected_attempt.attempt_id, selected_lease_token, TRUE,
      'CLAIM_RESUMED', 'CLAIMED', selected_attempt.transaction_hash,
      selected_session.state, selected_session.expires_at;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(priority_attempt.attempt_number), 0) + 1
    INTO selected_attempt_number
    FROM gogh_broker_punk_priority_attempts AS priority_attempt
   WHERE priority_attempt.session_id = selected_session.session_id;
  selected_lease_token := gen_random_uuid();
  INSERT INTO gogh_broker_punk_priority_attempts AS priority_attempt
    (session_id, attempt_number, worker_release, lane_id, lease_token, lease_until)
  VALUES
    (selected_session.session_id, selected_attempt_number, requested_worker_release,
     requested_lane_id, selected_lease_token,
     NOW() + (requested_lease_seconds * INTERVAL '1 second'))
  RETURNING priority_attempt.attempt_id INTO selected_attempt.attempt_id;
  RETURN QUERY SELECT selected_attempt.attempt_id, selected_lease_token, TRUE,
    'CLAIMED', 'CLAIMED', NULL::TEXT, selected_session.state, selected_session.expires_at;
END;
$$;

-- This function is the durable transaction idempotency boundary. It must succeed after final
-- simulation and before wallet.sendTransaction. Once reserved, automatic retries cannot submit.
CREATE OR REPLACE FUNCTION gogh_broker_reserve_punk_priority_submission(
  requested_attempt_id UUID,
  requested_lease_token UUID,
  requested_account_address TEXT,
  requested_target_collection TEXT,
  requested_acquisition_nonce NUMERIC
)
RETURNS TABLE(reserved BOOLEAN, reason TEXT, attempt_state TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_attempt gogh_broker_punk_priority_attempts%ROWTYPE;
  selected_session gogh_broker_punk_priority_sessions%ROWTYPE;
BEGIN
  IF requested_account_address !~ '^0x[0-9a-f]{40}$'
     OR requested_target_collection !~ '^0x[0-9a-f]{40}$'
     OR requested_acquisition_nonce < 0 THEN
    RAISE EXCEPTION 'invalid priority submission reservation';
  END IF;
  SELECT priority_attempt.* INTO selected_attempt
    FROM gogh_broker_punk_priority_attempts AS priority_attempt
   WHERE priority_attempt.attempt_id = requested_attempt_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT priority_session.* INTO selected_session
    FROM gogh_broker_punk_priority_sessions AS priority_session
   WHERE priority_session.session_id = selected_attempt.session_id
   FOR UPDATE;
  IF selected_session.state <> 'ACTIVE' OR selected_session.expires_at <= NOW() THEN
    IF selected_session.state = 'ACTIVE' THEN
      UPDATE gogh_broker_punk_priority_sessions AS priority_session
         SET state = 'EXPIRED', updated_at = NOW()
       WHERE priority_session.session_id = selected_session.session_id;
    END IF;
    RETURN QUERY SELECT FALSE, 'SESSION_TERMINAL', selected_attempt.state;
    RETURN;
  END IF;
  IF selected_attempt.state <> 'CLAIMED'
     OR selected_attempt.lease_token <> requested_lease_token
     OR selected_attempt.lease_until <= NOW() THEN
    RETURN QUERY SELECT FALSE, 'ATTEMPT_NOT_CLAIMED', selected_attempt.state;
    RETURN;
  END IF;
  UPDATE gogh_broker_punk_priority_attempts AS priority_attempt
     SET state = 'SUBMISSION_RESERVED', account_address = requested_account_address,
         target_collection = requested_target_collection,
         acquisition_nonce = requested_acquisition_nonce, reserved_at = NOW(), updated_at = NOW()
   WHERE priority_attempt.attempt_id = selected_attempt.attempt_id;
  RETURN QUERY SELECT TRUE, 'SUBMISSION_RESERVED', 'SUBMISSION_RESERVED';
END;
$$;

CREATE OR REPLACE FUNCTION gogh_broker_note_punk_priority_submission(
  requested_attempt_id UUID,
  requested_lease_token UUID,
  requested_transaction_hash TEXT
)
RETURNS TABLE(noted BOOLEAN, reason TEXT, attempt_state TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_attempt gogh_broker_punk_priority_attempts%ROWTYPE;
BEGIN
  IF requested_transaction_hash !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid priority transaction hash';
  END IF;
  SELECT priority_attempt.* INTO selected_attempt
    FROM gogh_broker_punk_priority_attempts AS priority_attempt
   WHERE priority_attempt.attempt_id = requested_attempt_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF selected_attempt.state = 'SUBMITTED'
     AND selected_attempt.transaction_hash = requested_transaction_hash THEN
    RETURN QUERY SELECT TRUE, 'ALREADY_NOTED', selected_attempt.state;
    RETURN;
  END IF;
  IF selected_attempt.state <> 'SUBMISSION_RESERVED'
     OR selected_attempt.lease_token <> requested_lease_token THEN
    RETURN QUERY SELECT FALSE, 'SUBMISSION_NOT_RESERVED', selected_attempt.state;
    RETURN;
  END IF;
  UPDATE gogh_broker_punk_priority_attempts AS priority_attempt
     SET state = 'SUBMITTED', submitted = TRUE,
         transaction_hash = requested_transaction_hash, submitted_at = NOW(), updated_at = NOW()
   WHERE priority_attempt.attempt_id = selected_attempt.attempt_id;
  RETURN QUERY SELECT TRUE, 'SUBMISSION_NOTED', 'SUBMITTED';
END;
$$;

-- Attempt-aware result persistence. Replaying the same attempt returns its settled state without
-- inserting usage, charging gas, or incrementing completed_mints a second time.
CREATE OR REPLACE FUNCTION gogh_broker_record_punk_priority_attempt_v2(
  requested_attempt_id UUID,
  requested_lease_token UUID,
  requested_status TEXT,
  requested_minted BOOLEAN,
  requested_transaction_hash TEXT,
  requested_gas_used NUMERIC,
  requested_effective_gas_price_wei NUMERIC,
  requested_transaction_gas_cost_wei NUMERIC,
  requested_terminal_state TEXT
)
RETURNS TABLE(
  punk_token_id NUMERIC,
  session_state TEXT,
  requested_mints SMALLINT,
  completed_mints SMALLINT,
  expires_at TIMESTAMPTZ,
  credited_wei NUMERIC,
  spent_wei NUMERIC,
  available_wei NUMERIC,
  usage_recorded BOOLEAN,
  attempt_recorded BOOLEAN,
  attempt_state TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_attempt gogh_broker_punk_priority_attempts%ROWTYPE;
  selected_session gogh_broker_punk_priority_sessions%ROWTYPE;
  inserted_count INTEGER := 0;
  selected_charge NUMERIC := 0;
  increment_mint BOOLEAN := FALSE;
BEGIN
  IF requested_status !~ '^[A-Z0-9_]{1,128}$'
     OR (requested_terminal_state IS NOT NULL
         AND requested_terminal_state NOT IN ('OWNER_CHANGED', 'CANCELLED')) THEN
    RAISE EXCEPTION 'invalid priority attempt result';
  END IF;
  SELECT priority_attempt.* INTO selected_attempt
    FROM gogh_broker_punk_priority_attempts AS priority_attempt
   WHERE priority_attempt.attempt_id = requested_attempt_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT priority_session.* INTO selected_session
    FROM gogh_broker_punk_priority_sessions AS priority_session
   WHERE priority_session.session_id = selected_attempt.session_id
   FOR UPDATE;

  IF selected_attempt.state = 'RECORDED' THEN
    RETURN QUERY
      SELECT priority_session.punk_token_id, priority_session.state,
        priority_session.requested_mints, priority_session.completed_mints,
        priority_session.expires_at, gas_account.credited_wei, gas_account.spent_wei,
        gas_account.credited_wei - gas_account.spent_wei, FALSE, FALSE,
        selected_attempt.state
        FROM gogh_broker_punk_priority_sessions AS priority_session
        JOIN gogh_broker_punk_agent_gas_accounts AS gas_account
          ON gas_account.chain_id = priority_session.chain_id
         AND gas_account.collection_address = priority_session.collection_address
         AND gas_account.punk_token_id = priority_session.punk_token_id
       WHERE priority_session.session_id = selected_session.session_id;
    RETURN;
  END IF;
  IF selected_attempt.lease_token <> requested_lease_token THEN
    RAISE EXCEPTION 'priority attempt lease mismatch';
  END IF;
  IF selected_attempt.state = 'SUBMISSION_RESERVED' AND requested_transaction_hash IS NULL THEN
    RAISE EXCEPTION 'reserved priority submission requires reconciliation';
  END IF;
  IF requested_transaction_hash IS NOT NULL
     AND selected_attempt.state NOT IN ('SUBMISSION_RESERVED', 'SUBMITTED') THEN
    RAISE EXCEPTION 'priority transaction was not reserved';
  END IF;
  IF selected_attempt.state = 'SUBMITTED'
     AND selected_attempt.transaction_hash IS DISTINCT FROM requested_transaction_hash THEN
    RAISE EXCEPTION 'priority transaction hash mismatch';
  END IF;

  IF requested_transaction_hash IS NOT NULL THEN
    IF requested_gas_used IS NULL OR requested_effective_gas_price_wei IS NULL
       OR requested_transaction_gas_cost_wei IS NULL
       OR requested_transaction_hash !~ '^0x[0-9a-f]{64}$'
       OR requested_gas_used <= 0 OR requested_effective_gas_price_wei <= 0
       OR requested_transaction_gas_cost_wei
          <> requested_gas_used * requested_effective_gas_price_wei THEN
      RAISE EXCEPTION 'invalid receipt-backed gas evidence';
    END IF;
    SELECT LEAST(requested_transaction_gas_cost_wei,
      GREATEST(gas_account.credited_wei - gas_account.spent_wei, 0))
      INTO selected_charge
      FROM gogh_broker_punk_agent_gas_accounts AS gas_account
     WHERE gas_account.chain_id = selected_session.chain_id
       AND gas_account.collection_address = selected_session.collection_address
       AND gas_account.punk_token_id = selected_session.punk_token_id
     FOR UPDATE;

    INSERT INTO gogh_broker_punk_agent_gas_usage
      (transaction_hash, session_id, chain_id, collection_address, punk_token_id,
       agent_address, gas_used, effective_gas_price_wei, actual_cost_wei,
       charged_wei, outcome)
    SELECT requested_transaction_hash, selected_session.session_id,
      selected_session.chain_id, selected_session.collection_address,
      selected_session.punk_token_id, gas_deposit.agent_address, requested_gas_used,
      requested_effective_gas_price_wei, requested_transaction_gas_cost_wei,
      selected_charge, requested_status
      FROM gogh_broker_punk_agent_gas_deposits AS gas_deposit
     WHERE gas_deposit.transaction_hash = selected_session.deposit_transaction_hash
    ON CONFLICT (transaction_hash) DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    IF inserted_count = 0 AND NOT EXISTS (
      SELECT 1 FROM gogh_broker_punk_agent_gas_usage AS gas_usage
       WHERE gas_usage.transaction_hash = requested_transaction_hash
         AND gas_usage.session_id = selected_session.session_id
    ) THEN
      RAISE EXCEPTION 'priority transaction hash belongs to another session';
    END IF;
    IF inserted_count = 1 THEN
      UPDATE gogh_broker_punk_agent_gas_accounts AS gas_account
         SET spent_wei = gas_account.spent_wei + selected_charge, updated_at = NOW()
       WHERE gas_account.chain_id = selected_session.chain_id
         AND gas_account.collection_address = selected_session.collection_address
         AND gas_account.punk_token_id = selected_session.punk_token_id;
    END IF;
  ELSIF requested_gas_used IS NOT NULL OR requested_effective_gas_price_wei IS NOT NULL
        OR requested_transaction_gas_cost_wei IS NOT NULL THEN
    RAISE EXCEPTION 'gas evidence requires a transaction hash';
  END IF;

  increment_mint := requested_minted AND requested_transaction_hash IS NOT NULL
    AND inserted_count = 1;
  UPDATE gogh_broker_punk_priority_sessions AS priority_session
     SET completed_mints = priority_session.completed_mints
           + CASE WHEN increment_mint THEN 1 ELSE 0 END,
         state = CASE
           WHEN requested_terminal_state IS NOT NULL THEN requested_terminal_state
           WHEN priority_session.completed_mints
                  + CASE WHEN increment_mint THEN 1 ELSE 0 END
                  >= priority_session.requested_mints THEN 'COMPLETE'
           WHEN priority_session.expires_at <= NOW() THEN 'EXPIRED'
           ELSE priority_session.state END,
         last_attempt_at = NOW(), last_result = requested_status,
         last_transaction_hash = COALESCE(requested_transaction_hash,
           priority_session.last_transaction_hash), updated_at = NOW()
   WHERE priority_session.session_id = selected_session.session_id
     AND priority_session.state IN ('ACTIVE', 'COMPLETE', 'EXPIRED');

  UPDATE gogh_broker_punk_priority_attempts AS priority_attempt
     SET state = 'RECORDED', result_status = requested_status,
         submitted = requested_transaction_hash IS NOT NULL,
         minted = increment_mint,
         transaction_hash = COALESCE(requested_transaction_hash,
           priority_attempt.transaction_hash),
         gas_used = requested_gas_used,
         effective_gas_price_wei = requested_effective_gas_price_wei,
         transaction_gas_cost_wei = requested_transaction_gas_cost_wei,
         terminal_state = requested_terminal_state,
         recorded_at = NOW(), updated_at = NOW()
   WHERE priority_attempt.attempt_id = selected_attempt.attempt_id;

  RETURN QUERY
    SELECT priority_session.punk_token_id, priority_session.state,
      priority_session.requested_mints, priority_session.completed_mints,
      priority_session.expires_at, gas_account.credited_wei, gas_account.spent_wei,
      gas_account.credited_wei - gas_account.spent_wei, inserted_count = 1, TRUE,
      'RECORDED'
      FROM gogh_broker_punk_priority_sessions AS priority_session
      JOIN gogh_broker_punk_agent_gas_accounts AS gas_account
        ON gas_account.chain_id = priority_session.chain_id
       AND gas_account.collection_address = priority_session.collection_address
       AND gas_account.punk_token_id = priority_session.punk_token_id
     WHERE priority_session.session_id = selected_session.session_id;
END;
$$;

-- Replace the already-deployed rolling-compatibility function without changing its signature.
-- Every table column on an expression RHS is explicitly qualified so RETURNS TABLE output
-- variables cannot collide with PL/pgSQL identifiers.
CREATE OR REPLACE FUNCTION gogh_broker_record_punk_priority_attempt(
  requested_session_id UUID,
  requested_status TEXT,
  requested_minted BOOLEAN,
  requested_transaction_hash TEXT,
  requested_gas_used NUMERIC,
  requested_effective_gas_price_wei NUMERIC,
  requested_transaction_gas_cost_wei NUMERIC,
  requested_terminal_state TEXT
)
RETURNS TABLE(
  punk_token_id NUMERIC,
  session_state TEXT,
  requested_mints SMALLINT,
  completed_mints SMALLINT,
  expires_at TIMESTAMPTZ,
  credited_wei NUMERIC,
  spent_wei NUMERIC,
  available_wei NUMERIC,
  usage_recorded BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_session gogh_broker_punk_priority_sessions%ROWTYPE;
  inserted_count INTEGER := 0;
  selected_charge NUMERIC := 0;
  increment_mint BOOLEAN := FALSE;
BEGIN
  SELECT priority_session.* INTO selected_session
    FROM gogh_broker_punk_priority_sessions AS priority_session
   WHERE priority_session.session_id = requested_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF requested_transaction_hash IS NOT NULL
     AND requested_gas_used IS NOT NULL
     AND requested_effective_gas_price_wei IS NOT NULL
     AND requested_transaction_gas_cost_wei IS NOT NULL THEN
    IF requested_transaction_hash !~ '^0x[0-9a-f]{64}$'
       OR requested_gas_used <= 0 OR requested_effective_gas_price_wei <= 0
       OR requested_transaction_gas_cost_wei
          <> requested_gas_used * requested_effective_gas_price_wei THEN
      RAISE EXCEPTION 'invalid receipt-backed gas evidence';
    END IF;
    SELECT LEAST(requested_transaction_gas_cost_wei,
      GREATEST(gas_account.credited_wei - gas_account.spent_wei, 0))
      INTO selected_charge
      FROM gogh_broker_punk_agent_gas_accounts AS gas_account
     WHERE gas_account.chain_id = selected_session.chain_id
       AND gas_account.collection_address = selected_session.collection_address
       AND gas_account.punk_token_id = selected_session.punk_token_id
     FOR UPDATE;
    INSERT INTO gogh_broker_punk_agent_gas_usage
      (transaction_hash, session_id, chain_id, collection_address, punk_token_id,
       agent_address, gas_used, effective_gas_price_wei, actual_cost_wei,
       charged_wei, outcome)
    SELECT requested_transaction_hash, selected_session.session_id,
      selected_session.chain_id, selected_session.collection_address,
      selected_session.punk_token_id, gas_deposit.agent_address, requested_gas_used,
      requested_effective_gas_price_wei, requested_transaction_gas_cost_wei,
      selected_charge, requested_status
      FROM gogh_broker_punk_agent_gas_deposits AS gas_deposit
     WHERE gas_deposit.transaction_hash = selected_session.deposit_transaction_hash
    ON CONFLICT (transaction_hash) DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    IF inserted_count = 1 THEN
      UPDATE gogh_broker_punk_agent_gas_accounts AS gas_account
         SET spent_wei = gas_account.spent_wei + selected_charge, updated_at = NOW()
       WHERE gas_account.chain_id = selected_session.chain_id
         AND gas_account.collection_address = selected_session.collection_address
         AND gas_account.punk_token_id = selected_session.punk_token_id;
    END IF;
  END IF;
  increment_mint := requested_minted AND requested_transaction_hash IS NOT NULL
    AND inserted_count = 1;
  UPDATE gogh_broker_punk_priority_sessions AS priority_session
     SET completed_mints = priority_session.completed_mints
           + CASE WHEN increment_mint THEN 1 ELSE 0 END,
         state = CASE
           WHEN requested_terminal_state IS NOT NULL THEN requested_terminal_state
           WHEN priority_session.completed_mints
                  + CASE WHEN increment_mint THEN 1 ELSE 0 END
                  >= priority_session.requested_mints THEN 'COMPLETE'
           WHEN priority_session.expires_at <= NOW() THEN 'EXPIRED'
           ELSE priority_session.state END,
         last_attempt_at = NOW(), last_result = requested_status,
         last_transaction_hash = COALESCE(requested_transaction_hash,
           priority_session.last_transaction_hash), updated_at = NOW()
   WHERE priority_session.session_id = requested_session_id
     AND priority_session.state IN ('ACTIVE', 'COMPLETE', 'EXPIRED');
  RETURN QUERY
    SELECT priority_session.punk_token_id, priority_session.state,
      priority_session.requested_mints, priority_session.completed_mints,
      priority_session.expires_at, gas_account.credited_wei, gas_account.spent_wei,
      gas_account.credited_wei - gas_account.spent_wei, inserted_count = 1
      FROM gogh_broker_punk_priority_sessions AS priority_session
      JOIN gogh_broker_punk_agent_gas_accounts AS gas_account
        ON gas_account.chain_id = priority_session.chain_id
       AND gas_account.collection_address = priority_session.collection_address
       AND gas_account.punk_token_id = priority_session.punk_token_id
     WHERE priority_session.session_id = requested_session_id;
END;
$$;

REVOKE ALL ON TABLE gogh_broker_punk_priority_attempts FROM PUBLIC;
REVOKE ALL ON FUNCTION gogh_broker_begin_punk_priority_attempt(UUID, TEXT, SMALLINT, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION gogh_broker_reserve_punk_priority_submission(
  UUID, UUID, TEXT, TEXT, NUMERIC
) FROM PUBLIC;
REVOKE ALL ON FUNCTION gogh_broker_note_punk_priority_submission(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION gogh_broker_record_punk_priority_attempt_v2(
  UUID, UUID, TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION gogh_broker_record_punk_priority_attempt(
  UUID, TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION gogh_broker_begin_punk_priority_attempt(UUID, TEXT, SMALLINT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION gogh_broker_reserve_punk_priority_submission(
  UUID, UUID, TEXT, TEXT, NUMERIC
) TO service_role;
GRANT EXECUTE ON FUNCTION gogh_broker_note_punk_priority_submission(UUID, UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION gogh_broker_record_punk_priority_attempt_v2(
  UUID, UUID, TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION gogh_broker_record_punk_priority_attempt(
  UUID, TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT
) TO service_role;
