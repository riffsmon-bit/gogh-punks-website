-- A separate journal for the selected burn. No grants or execution authority.
CREATE TABLE broker_selected_burn_reviews (
  intent_id text PRIMARY KEY CHECK (intent_id ~ '^[0-9a-f]{64}$'),
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  source_token_id text NOT NULL CHECK (source_token_id ~ '^[0-9]{1,4}$'),
  review_json text NOT NULL CHECK (octet_length(review_json) < 32768),
  review_hash text NOT NULL CHECK (review_hash = encode(sha256(convert_to(review_json,'UTF8')),'hex')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','CANCELLED','DECLINED','WALLET_REQUESTED','CONFIRMED','REVERTED')),
  reported_hash text CHECK (reported_hash ~ '^0x[0-9a-f]{64}$'),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((review_json::jsonb ->> 'intentId') = intent_id),
  CHECK (lower(review_json::jsonb #>> '{state,owner}') = owner_address),
  CHECK ((review_json::jsonb #>> '{state,sourceTokenId}') = source_token_id),
  CHECK ((status IN ('CONFIRMED','REVERTED')) = (receipt IS NOT NULL))
);
CREATE UNIQUE INDEX broker_selected_burn_hold ON broker_selected_burn_reviews(owner_address,source_token_id)
  WHERE status IN ('PREPARED','WALLET_REQUESTED');
CREATE TABLE broker_selected_burn_events (
  intent_id text NOT NULL REFERENCES broker_selected_burn_reviews(intent_id),
  revision integer NOT NULL, status text NOT NULL, reported_hash text, receipt jsonb,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(intent_id,revision)
);
CREATE FUNCTION broker_selected_burn_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PREPARED' OR NEW.revision<>0 OR NEW.reported_hash IS NOT NULL OR NEW.receipt IS NOT NULL
      THEN RAISE EXCEPTION 'BURN_INVALID_INITIAL_STATE'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['revision','status','reported_hash','receipt']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['revision','status','reported_hash','receipt']) OR NEW.revision<>OLD.revision+1
      THEN RAISE EXCEPTION 'BURN_IMMUTABLE_REVIEW'; END IF;
    IF NOT ((OLD.status='PREPARED' AND NEW.status IN ('CANCELLED','WALLET_REQUESTED')) OR
      (OLD.status='WALLET_REQUESTED' AND NEW.status IN ('WALLET_REQUESTED','CONFIRMED','REVERTED')) OR
      (OLD.status='WALLET_REQUESTED' AND NEW.status='DECLINED' AND OLD.reported_hash IS NULL AND NEW.reported_hash IS NULL))
      THEN RAISE EXCEPTION 'BURN_INVALID_TRANSITION'; END IF;
    IF OLD.status='PREPARED' AND NEW.status='WALLET_REQUESTED' AND
      (NEW.review_json::jsonb ->> 'expiresAt')::numeric <= extract(epoch from clock_timestamp())*1000
      THEN RAISE EXCEPTION 'BURN_REVIEW_EXPIRED'; END IF;
    IF NEW.status IN ('CONFIRMED','REVERTED') AND (NEW.reported_hash IS NULL OR
      NEW.receipt->>'transactionHash' IS DISTINCT FROM NEW.reported_hash OR NEW.receipt->>'status' IS DISTINCT FROM NEW.status)
      THEN RAISE EXCEPTION 'BURN_RECEIPT_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION broker_selected_burn_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO broker_selected_burn_events(intent_id,revision,status,reported_hash,receipt)
    VALUES(NEW.intent_id,NEW.revision,NEW.status,NEW.reported_hash,NEW.receipt);
  RETURN NEW;
END $$;
CREATE TRIGGER broker_selected_burn_guard_trigger BEFORE INSERT OR UPDATE ON broker_selected_burn_reviews
  FOR EACH ROW EXECUTE FUNCTION broker_selected_burn_guard();
CREATE TRIGGER broker_selected_burn_audit_trigger AFTER INSERT OR UPDATE ON broker_selected_burn_reviews
  FOR EACH ROW EXECUTE FUNCTION broker_selected_burn_audit();
ALTER TABLE broker_selected_burn_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_selected_burn_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON broker_selected_burn_reviews,broker_selected_burn_events FROM PUBLIC;
REVOKE ALL ON FUNCTION broker_selected_burn_guard(),broker_selected_burn_audit() FROM PUBLIC;
