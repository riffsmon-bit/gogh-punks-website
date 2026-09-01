-- Receipt-backed priority gas metering and refund-safe settlement state.
-- Refund broadcast remains application feature-flagged: this migration never
-- moves native value and never grants a browser access to a hosted signer.

CREATE TABLE IF NOT EXISTS gogh_broker_punk_agent_gas_usage (
  transaction_hash TEXT PRIMARY KEY CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  session_id UUID NOT NULL REFERENCES gogh_broker_punk_priority_sessions(session_id),
  chain_id BIGINT NOT NULL DEFAULT 4663 CHECK (chain_id = 4663),
  collection_address TEXT NOT NULL
    DEFAULT '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6'
    CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  agent_address TEXT NOT NULL CHECK (agent_address ~ '^0x[0-9a-f]{40}$'),
  gas_used NUMERIC(78, 0) NOT NULL CHECK (gas_used > 0),
  effective_gas_price_wei NUMERIC(78, 0) NOT NULL CHECK (effective_gas_price_wei > 0),
  actual_cost_wei NUMERIC(78, 0) NOT NULL CHECK (actual_cost_wei > 0),
  charged_wei NUMERIC(78, 0) NOT NULL CHECK (charged_wei >= 0),
  outcome TEXT NOT NULL CHECK (outcome ~ '^[A-Z0-9_]{1,128}$'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (actual_cost_wei = gas_used * effective_gas_price_wei),
  CHECK (charged_wei <= actual_cost_wei)
);

CREATE INDEX IF NOT EXISTS gogh_broker_punk_agent_gas_usage_punk_time_idx
  ON gogh_broker_punk_agent_gas_usage
    (chain_id, collection_address, punk_token_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS gogh_broker_punk_agent_gas_refunds (
  refund_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES gogh_broker_punk_priority_sessions(session_id),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  owner_address TEXT NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  agent_address TEXT NOT NULL CHECK (agent_address ~ '^0x[0-9a-f]{40}$'),
  requested_wei NUMERIC(78, 0) NOT NULL CHECK (requested_wei > 0),
  state TEXT NOT NULL DEFAULT 'ELIGIBLE'
    CHECK (state IN ('ELIGIBLE', 'SUBMITTING', 'CONFIRMED', 'FAILED', 'DUST')),
  transaction_hash TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gogh_broker_punk_agent_gas_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE gogh_broker_punk_agent_gas_refunds ENABLE ROW LEVEL SECURITY;

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
  SELECT * INTO selected_session FROM gogh_broker_punk_priority_sessions
   WHERE session_id = requested_session_id FOR UPDATE;
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
      GREATEST(account.credited_wei - account.spent_wei, 0))
      INTO selected_charge
      FROM gogh_broker_punk_agent_gas_accounts AS account
     WHERE account.chain_id = selected_session.chain_id
       AND account.collection_address = selected_session.collection_address
       AND account.punk_token_id = selected_session.punk_token_id
     FOR UPDATE;

    INSERT INTO gogh_broker_punk_agent_gas_usage
      (transaction_hash, session_id, chain_id, collection_address, punk_token_id,
       agent_address, gas_used, effective_gas_price_wei, actual_cost_wei,
       charged_wei, outcome)
    SELECT requested_transaction_hash, selected_session.session_id,
      selected_session.chain_id, selected_session.collection_address,
      selected_session.punk_token_id, deposit.agent_address, requested_gas_used,
      requested_effective_gas_price_wei, requested_transaction_gas_cost_wei,
      selected_charge, requested_status
      FROM gogh_broker_punk_agent_gas_deposits AS deposit
     WHERE deposit.transaction_hash = selected_session.deposit_transaction_hash
    ON CONFLICT (transaction_hash) DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    IF inserted_count = 1 THEN
      UPDATE gogh_broker_punk_agent_gas_accounts
         SET spent_wei = spent_wei + selected_charge, updated_at = NOW()
       WHERE chain_id = selected_session.chain_id
         AND collection_address = selected_session.collection_address
         AND punk_token_id = selected_session.punk_token_id;
    END IF;
  END IF;

  increment_mint := requested_minted AND requested_transaction_hash IS NOT NULL
    AND inserted_count = 1;
  UPDATE gogh_broker_punk_priority_sessions AS session
     SET completed_mints = completed_mints + CASE WHEN increment_mint THEN 1 ELSE 0 END,
         state = CASE
           WHEN requested_terminal_state IS NOT NULL THEN requested_terminal_state
           WHEN completed_mints + CASE WHEN increment_mint THEN 1 ELSE 0 END
                  >= requested_mints THEN 'COMPLETE'
           WHEN expires_at <= NOW() THEN 'EXPIRED'
           ELSE state END,
         last_attempt_at = NOW(), last_result = requested_status,
         last_transaction_hash = COALESCE(requested_transaction_hash,
           last_transaction_hash), updated_at = NOW()
   WHERE session.session_id = requested_session_id
     AND session.state IN ('ACTIVE', 'COMPLETE', 'EXPIRED');

  RETURN QUERY
    SELECT session.punk_token_id, session.state, session.requested_mints,
      session.completed_mints, session.expires_at, account.credited_wei,
      account.spent_wei, account.credited_wei - account.spent_wei,
      inserted_count = 1
      FROM gogh_broker_punk_priority_sessions AS session
      JOIN gogh_broker_punk_agent_gas_accounts AS account
        ON account.chain_id = session.chain_id
       AND account.collection_address = session.collection_address
       AND account.punk_token_id = session.punk_token_id
     WHERE session.session_id = requested_session_id;
END;
$$;

REVOKE ALL ON FUNCTION gogh_broker_record_punk_priority_attempt(
  UUID, TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gogh_broker_record_punk_priority_attempt(
  UUID, TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT
) TO service_role;
