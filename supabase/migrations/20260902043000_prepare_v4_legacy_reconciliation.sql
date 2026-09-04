-- V4 legacy hosted-balance reconciliation and payout preparation.
-- This migration stores evidence and durable payout identities only. It cannot move native value,
-- authorize a signer, broadcast a transaction, or sweep a hosted wallet.

CREATE TABLE IF NOT EXISTS gogh_broker_legacy_reconciliation_runs (
  reconciliation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version SMALLINT NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  chain_id BIGINT NOT NULL DEFAULT 4663 CHECK (chain_id = 4663),
  snapshot_block NUMERIC(78, 0) NOT NULL CHECK (snapshot_block >= 0),
  source_sha256 TEXT NOT NULL UNIQUE CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT', 'REVIEW_REQUIRED', 'REVIEWED', 'FINAL')),
  hosted_history_complete BOOLEAN NOT NULL DEFAULT FALSE,
  total_historical_inflows_wei NUMERIC(78, 0) NOT NULL CHECK (total_historical_inflows_wei >= 0),
  total_confirmed_gas_spend_wei NUMERIC(78, 0) NOT NULL CHECK (total_confirmed_gas_spend_wei >= 0),
  total_confirmed_mint_value_spend_wei NUMERIC(78, 0) NOT NULL
    CHECK (total_confirmed_mint_value_spend_wei >= 0),
  total_refunds_issued_wei NUMERIC(78, 0) NOT NULL CHECK (total_refunds_issued_wei >= 0),
  total_other_proven_outflows_wei NUMERIC(78, 0) NOT NULL
    CHECK (total_other_proven_outflows_wei >= 0),
  expected_remaining_balance_wei NUMERIC(78, 0) NOT NULL
    CHECK (expected_remaining_balance_wei >= 0),
  actual_hosted_balance_wei NUMERIC(78, 0) NOT NULL CHECK (actual_hosted_balance_wei >= 0),
  total_user_liability_wei NUMERIC(78, 0) NOT NULL CHECK (total_user_liability_wei >= 0),
  total_project_owned_wei NUMERIC(78, 0) NOT NULL CHECK (total_project_owned_wei >= 0),
  total_ambiguous_wei NUMERIC(78, 0) NOT NULL CHECK (total_ambiguous_wei >= 0),
  final_sweep_ready BOOLEAN NOT NULL DEFAULT FALSE,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL CHECK (created_by ~ '^[A-Za-z0-9:@._-]{3,160}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  CHECK (NOT final_sweep_ready OR (
    state = 'FINAL' AND hosted_history_complete
    AND total_user_liability_wei = 0 AND total_ambiguous_wei = 0
    AND expected_remaining_balance_wei = actual_hosted_balance_wei
  ))
);

CREATE TABLE IF NOT EXISTS gogh_broker_legacy_reconciliation_entries (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id UUID NOT NULL
    REFERENCES gogh_broker_legacy_reconciliation_runs(reconciliation_id),
  owner_wallet TEXT NOT NULL CHECK (owner_wallet ~ '^0x[0-9a-f]{40}$'),
  owner_snapshot TEXT NOT NULL CHECK (owner_snapshot ~ '^0x[0-9a-f]{40}$'),
  punk_token_id NUMERIC(78, 0) NOT NULL CHECK (punk_token_id >= 0),
  punk_wallet TEXT CHECK (punk_wallet IS NULL OR punk_wallet ~ '^0x[0-9a-f]{40}$'),
  funding_source TEXT NOT NULL CHECK (funding_source ~ '^[A-Z0-9_]{3,128}$'),
  deposit_transaction_hashes JSONB NOT NULL,
  deposit_amount_wei NUMERIC(78, 0) NOT NULL CHECK (deposit_amount_wei >= 0),
  recorded_credit_wei NUMERIC(78, 0) NOT NULL CHECK (recorded_credit_wei >= 0),
  gas_spent_wei NUMERIC(78, 0) NOT NULL CHECK (gas_spent_wei >= 0),
  mint_value_spent_wei NUMERIC(78, 0) NOT NULL CHECK (mint_value_spent_wei >= 0),
  priority_fees_spent_wei NUMERIC(78, 0) NOT NULL CHECK (priority_fees_spent_wei >= 0),
  refunds_already_issued_wei NUMERIC(78, 0) NOT NULL
    CHECK (refunds_already_issued_wei >= 0),
  remaining_user_balance_wei NUMERIC(78, 0) NOT NULL
    CHECK (remaining_user_balance_wei >= 0),
  project_subsidy_wei NUMERIC(78, 0) NOT NULL CHECK (project_subsidy_wei >= 0),
  classification TEXT NOT NULL CHECK (classification IN (
    'USER_REFUNDABLE', 'USER_MIGRATABLE_TO_PUNK', 'USER_CHOICE_PENDING',
    'PROJECT_FUNDED', 'ALREADY_SPENT', 'ALREADY_REFUNDED',
    'AMBIGUOUS_REQUIRES_REVIEW'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('VERIFIED', 'PARTIAL', 'REQUIRES_REVIEW')),
  evidence JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reconciliation_id, punk_token_id),
  CHECK (jsonb_typeof(deposit_transaction_hashes) = 'array')
);

CREATE INDEX IF NOT EXISTS gogh_broker_legacy_reconciliation_entries_owner_idx
  ON gogh_broker_legacy_reconciliation_entries
    (owner_wallet, reconciliation_id, punk_token_id);

CREATE TABLE IF NOT EXISTS gogh_broker_legacy_payout_intents (
  payout_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (idempotency_key ~ '^legacy-balance:[0-9a-f]{64}$'),
  reconciliation_id UUID NOT NULL
    REFERENCES gogh_broker_legacy_reconciliation_runs(reconciliation_id),
  entry_id UUID NOT NULL REFERENCES gogh_broker_legacy_reconciliation_entries(entry_id),
  destination_kind TEXT NOT NULL CHECK (destination_kind IN ('OWNER_WALLET', 'PUNK_WALLET')),
  destination_address TEXT NOT NULL CHECK (destination_address ~ '^0x[0-9a-f]{40}$'),
  amount_wei NUMERIC(78, 0) NOT NULL CHECK (amount_wei > 0),
  reason TEXT NOT NULL CHECK (reason ~ '^[A-Z0-9_]{3,128}$'),
  state TEXT NOT NULL DEFAULT 'DRY_RUN' CHECK (state IN (
    'DRY_RUN', 'USER_AUTHORIZED', 'SUBMISSION_RESERVED', 'SUBMITTED',
    'CONFIRMED', 'FAILED', 'CANCELLED'
  )),
  owner_authorization_hash TEXT
    CHECK (owner_authorization_hash IS NULL OR owner_authorization_hash ~ '^0x[0-9a-f]{64}$'),
  operator TEXT CHECK (operator IS NULL OR operator ~ '^[A-Za-z0-9:@._-]{3,160}$'),
  signer_address TEXT CHECK (signer_address IS NULL OR signer_address ~ '^0x[0-9a-f]{40}$'),
  signer_nonce NUMERIC(78, 0) CHECK (signer_nonce IS NULL OR signer_nonce >= 0),
  transaction_envelope_hash TEXT
    CHECK (transaction_envelope_hash IS NULL OR transaction_envelope_hash ~ '^[0-9a-f]{64}$'),
  transaction_hash TEXT UNIQUE
    CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  reserved_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (signer_address, signer_nonce),
  CHECK (state NOT IN ('SUBMISSION_RESERVED', 'SUBMITTED', 'CONFIRMED') OR (
    signer_address IS NOT NULL AND signer_nonce IS NOT NULL
    AND transaction_envelope_hash IS NOT NULL AND transaction_hash IS NOT NULL
    AND reserved_at IS NOT NULL
  )),
  CHECK (state NOT IN ('SUBMITTED', 'CONFIRMED') OR submitted_at IS NOT NULL),
  CHECK (state <> 'CONFIRMED' OR confirmed_at IS NOT NULL)
);

ALTER TABLE gogh_broker_legacy_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gogh_broker_legacy_reconciliation_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE gogh_broker_legacy_payout_intents ENABLE ROW LEVEL SECURITY;

-- Persist the deterministic transaction identity before a later, separately authorized broadcaster
-- is permitted to submit. Replays return the original reservation and cannot allocate a new nonce.
CREATE OR REPLACE FUNCTION gogh_broker_reserve_legacy_payout_submission(
  requested_idempotency_key TEXT,
  requested_operator TEXT,
  requested_signer_address TEXT,
  requested_signer_nonce NUMERIC,
  requested_transaction_envelope_hash TEXT,
  requested_transaction_hash TEXT
)
RETURNS TABLE(
  payout_id UUID,
  payout_state TEXT,
  transaction_hash TEXT,
  signer_nonce NUMERIC,
  reserved BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_payout gogh_broker_legacy_payout_intents%ROWTYPE;
BEGIN
  IF requested_idempotency_key !~ '^legacy-balance:[0-9a-f]{64}$'
     OR requested_operator !~ '^[A-Za-z0-9:@._-]{3,160}$'
     OR requested_signer_address !~ '^0x[0-9a-f]{40}$'
     OR requested_signer_nonce < 0
     OR requested_transaction_envelope_hash !~ '^[0-9a-f]{64}$'
     OR requested_transaction_hash !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid legacy payout reservation';
  END IF;
  SELECT payout.* INTO selected_payout
    FROM gogh_broker_legacy_payout_intents AS payout
   WHERE payout.idempotency_key = requested_idempotency_key
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF selected_payout.state = 'SUBMISSION_RESERVED'
     AND selected_payout.transaction_hash = requested_transaction_hash THEN
    RETURN QUERY SELECT selected_payout.payout_id, selected_payout.state,
      selected_payout.transaction_hash, selected_payout.signer_nonce, FALSE;
    RETURN;
  END IF;
  IF selected_payout.state <> 'USER_AUTHORIZED' THEN
    RAISE EXCEPTION 'legacy payout is not user-authorized for reservation';
  END IF;
  UPDATE gogh_broker_legacy_payout_intents AS payout
     SET state = 'SUBMISSION_RESERVED', operator = requested_operator,
         signer_address = requested_signer_address, signer_nonce = requested_signer_nonce,
         transaction_envelope_hash = requested_transaction_envelope_hash,
         transaction_hash = requested_transaction_hash, reserved_at = NOW(), updated_at = NOW()
   WHERE payout.payout_id = selected_payout.payout_id;
  RETURN QUERY SELECT selected_payout.payout_id, 'SUBMISSION_RESERVED'::TEXT,
    requested_transaction_hash, requested_signer_nonce, TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION gogh_broker_note_legacy_payout_submitted(
  requested_idempotency_key TEXT,
  requested_transaction_hash TEXT
)
RETURNS TABLE(payout_id UUID, payout_state TEXT, noted BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_payout gogh_broker_legacy_payout_intents%ROWTYPE;
BEGIN
  SELECT payout.* INTO selected_payout
    FROM gogh_broker_legacy_payout_intents AS payout
   WHERE payout.idempotency_key = requested_idempotency_key
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF selected_payout.transaction_hash IS DISTINCT FROM requested_transaction_hash THEN
    RAISE EXCEPTION 'legacy payout transaction hash mismatch';
  END IF;
  IF selected_payout.state IN ('SUBMITTED', 'CONFIRMED') THEN
    RETURN QUERY SELECT selected_payout.payout_id, selected_payout.state, FALSE;
    RETURN;
  END IF;
  IF selected_payout.state <> 'SUBMISSION_RESERVED' THEN
    RAISE EXCEPTION 'legacy payout submission was not reserved';
  END IF;
  UPDATE gogh_broker_legacy_payout_intents AS payout
     SET state = 'SUBMITTED', submitted_at = NOW(), updated_at = NOW()
   WHERE payout.payout_id = selected_payout.payout_id;
  RETURN QUERY SELECT selected_payout.payout_id, 'SUBMITTED'::TEXT, TRUE;
END;
$$;

REVOKE ALL ON TABLE gogh_broker_legacy_reconciliation_runs FROM PUBLIC;
REVOKE ALL ON TABLE gogh_broker_legacy_reconciliation_entries FROM PUBLIC;
REVOKE ALL ON TABLE gogh_broker_legacy_payout_intents FROM PUBLIC;
REVOKE ALL ON FUNCTION gogh_broker_reserve_legacy_payout_submission(
  TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION gogh_broker_note_legacy_payout_submitted(TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION gogh_broker_reserve_legacy_payout_submission(
  TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION gogh_broker_note_legacy_payout_submitted(TEXT, TEXT)
  TO service_role;
