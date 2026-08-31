-- Punk-specific prepaid priority sessions.  Native deposits remain in the reviewed
-- hosted signer because an EVM contract account cannot originate a transaction or
-- pay its own gas.  This ledger binds the service entitlement to exactly one Punk,
-- current-owner snapshot, successful-mint ceiling, and expiry.

CREATE TABLE IF NOT EXISTS gogh_broker_punk_priority_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id BIGINT NOT NULL CHECK (chain_id = 4663),
  collection_address TEXT NOT NULL CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  owner_snapshot TEXT NOT NULL CHECK (owner_snapshot ~ '^0x[0-9a-f]{40}$'),
  deposit_transaction_hash TEXT NOT NULL UNIQUE
    REFERENCES gogh_broker_punk_agent_gas_deposits(transaction_hash),
  requested_mints SMALLINT NOT NULL CHECK (requested_mints IN (1, 3, 5, 10)),
  completed_mints SMALLINT NOT NULL DEFAULT 0 CHECK (completed_mints >= 0),
  duration_days SMALLINT NOT NULL CHECK (duration_days IN (1, 3, 7, 30)),
  state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (state IN ('ACTIVE', 'COMPLETE', 'EXPIRED', 'OWNER_CHANGED', 'CANCELLED')),
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_attempt_at TIMESTAMPTZ,
  last_result TEXT,
  last_transaction_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (completed_mints <= requested_mints),
  CHECK (expires_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS gogh_broker_punk_priority_sessions_one_active_idx
  ON gogh_broker_punk_priority_sessions (chain_id, collection_address, punk_token_id)
  WHERE state = 'ACTIVE';

CREATE INDEX IF NOT EXISTS gogh_broker_punk_priority_sessions_due_idx
  ON gogh_broker_punk_priority_sessions
    (last_attempt_at NULLS FIRST, created_at, punk_token_id)
  WHERE state = 'ACTIVE';

ALTER TABLE gogh_broker_punk_priority_sessions ENABLE ROW LEVEL SECURITY;

-- Credit a confirmed native deposit and atomically create or replace this Punk's
-- bounded priority session. Replaying the same transaction is idempotent and can
-- never create a second session or credit the gas ledger twice.
CREATE OR REPLACE FUNCTION gogh_broker_start_punk_priority_session(
  requested_transaction_hash TEXT,
  requested_punk_token_id NUMERIC,
  requested_owner_address TEXT,
  requested_agent_address TEXT,
  requested_amount_wei NUMERIC,
  requested_block_number BIGINT,
  requested_confirmed_at TIMESTAMPTZ,
  requested_release TEXT,
  requested_mints SMALLINT,
  requested_duration_days SMALLINT
)
RETURNS TABLE(
  credited BOOLEAN,
  available_wei NUMERIC,
  session_id UUID,
  session_state TEXT,
  completed_mints SMALLINT,
  expires_at TIMESTAMPTZ,
  job_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER;
  selected_job_id UUID;
  selected_session_id UUID;
BEGIN
  IF requested_transaction_hash !~ '^0x[0-9a-f]{64}$'
     OR requested_owner_address !~ '^0x[0-9a-f]{40}$'
     OR requested_agent_address !~ '^0x[0-9a-f]{40}$'
     OR requested_punk_token_id < 0
     OR requested_amount_wei <= 0
     OR requested_block_number < 0
     OR requested_release !~ '^[0-9a-f]{40}$'
     OR requested_mints NOT IN (1, 3, 5, 10)
     OR requested_duration_days NOT IN (1, 3, 7, 30) THEN
    RAISE EXCEPTION 'invalid Punk priority-session evidence';
  END IF;

  INSERT INTO gogh_broker_punk_agent_gas_deposits
    (transaction_hash, chain_id, collection_address, punk_token_id, owner_address,
     agent_address, amount_wei, block_number, confirmed_at)
  VALUES
    (requested_transaction_hash, 4663,
     '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6', requested_punk_token_id,
     requested_owner_address, requested_agent_address, requested_amount_wei,
     requested_block_number, requested_confirmed_at)
  ON CONFLICT (transaction_hash) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 1 THEN
    INSERT INTO gogh_broker_punk_agent_gas_accounts
      (chain_id, collection_address, punk_token_id, owner_snapshot, credited_wei, updated_at)
    VALUES
      (4663, '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6',
       requested_punk_token_id, requested_owner_address, requested_amount_wei, NOW())
    ON CONFLICT (chain_id, collection_address, punk_token_id) DO UPDATE SET
      owner_snapshot = EXCLUDED.owner_snapshot,
      credited_wei = gogh_broker_punk_agent_gas_accounts.credited_wei
        + EXCLUDED.credited_wei,
      updated_at = NOW();

    UPDATE gogh_broker_punk_priority_sessions
       SET state = 'CANCELLED', updated_at = NOW()
     WHERE chain_id = 4663
       AND collection_address = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6'
       AND punk_token_id = requested_punk_token_id
       AND state = 'ACTIVE';

    INSERT INTO gogh_broker_punk_priority_sessions
      (chain_id, collection_address, punk_token_id, owner_snapshot,
       deposit_transaction_hash, requested_mints, duration_days, starts_at, expires_at)
    VALUES
      (4663, '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6',
       requested_punk_token_id, requested_owner_address, requested_transaction_hash,
       requested_mints, requested_duration_days, requested_confirmed_at,
       requested_confirmed_at + (requested_duration_days * INTERVAL '1 day'))
    RETURNING gogh_broker_punk_priority_sessions.session_id INTO selected_session_id;

    INSERT INTO gogh_broker_punk_jobs
      (idempotency_key, chain_id, collection_address, punk_token_id, job_kind, state,
       priority, available_at, source, source_release, updated_at)
    VALUES
      ('priority-session:' || selected_session_id::text, 4663,
       '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6', requested_punk_token_id,
       'SCOUT', 'QUEUED', 100, NOW(), 'USER', requested_release, NOW())
    ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
    RETURNING gogh_broker_punk_jobs.job_id INTO selected_job_id;
  ELSE
    SELECT existing.session_id INTO selected_session_id
      FROM gogh_broker_punk_priority_sessions AS existing
     WHERE existing.deposit_transaction_hash = requested_transaction_hash;
  END IF;

  RETURN QUERY
    SELECT inserted_count = 1,
      account.credited_wei - account.spent_wei,
      session.session_id,
      session.state,
      session.completed_mints,
      session.expires_at,
      selected_job_id
    FROM gogh_broker_punk_agent_gas_accounts AS account
    JOIN gogh_broker_punk_priority_sessions AS session
      ON session.session_id = selected_session_id
    WHERE account.chain_id = 4663
      AND account.collection_address = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6'
      AND account.punk_token_id = requested_punk_token_id;
END;
$$;

REVOKE ALL ON FUNCTION gogh_broker_start_punk_priority_session(
  TEXT, NUMERIC, TEXT, TEXT, NUMERIC, BIGINT, TIMESTAMPTZ, TEXT, SMALLINT, SMALLINT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gogh_broker_start_punk_priority_session(
  TEXT, NUMERIC, TEXT, TEXT, NUMERIC, BIGINT, TIMESTAMPTZ, TEXT, SMALLINT, SMALLINT
) TO service_role;
