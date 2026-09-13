-- Separate owner reviews and worker-only signed transactions. No grants here.
CREATE TABLE broker_selected_paid_reviews (
 intent_id text PRIMARY KEY CHECK(intent_id ~ '^[0-9a-f]{64}$'),
 review_json text NOT NULL CHECK(octet_length(review_json)<16384),
 review_hash text NOT NULL CHECK(review_hash=encode(sha256(convert_to(review_json,'UTF8')),'hex')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 status text NOT NULL DEFAULT 'PREPARED' CHECK(status IN('PREPARED','WALLET_REQUESTED','CONFIRMED','REVERTED','CANCELLED','DECLINED')),
 reported_hash text CHECK(reported_hash ~ '^0x[0-9a-f]{64}$'), receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(review_json::jsonb->>'intentId'=intent_id),
 CHECK(review_json::jsonb->>'owner'='0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6'),
 CHECK(review_json::jsonb->>'tokenId'='93'),
 CHECK(review_json::jsonb->>'action' IN('AUTHORIZE','CANCEL_MISSION','WITHDRAW_REFUND')),
 CHECK((status IN('CONFIRMED','REVERTED'))=(receipt IS NOT NULL))
);
CREATE UNIQUE INDEX broker_selected_paid_hold ON broker_selected_paid_reviews((true)) WHERE status IN('PREPARED','WALLET_REQUESTED');
CREATE TABLE broker_selected_paid_executions (
 intent_id text PRIMARY KEY REFERENCES broker_selected_paid_reviews(intent_id),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 status text NOT NULL CHECK(status IN('SIGNED','SUBMITTED','COMPLETED','REVERTED','STOPPED')),
 transaction_json jsonb, raw_transaction text CHECK(octet_length(raw_transaction)<8192 AND raw_transaction ~ '^0x[0-9a-f]+$'),
 transaction_hash text CHECK(transaction_hash ~ '^0x[0-9a-f]{64}$'),
 receipt jsonb, reason text CHECK(reason ~ '^[A-Z][A-Z0-9_]{0,79}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((status='STOPPED')=(raw_transaction IS NULL)),
 CHECK((raw_transaction IS NULL)=(transaction_json IS NULL)),
 CHECK((raw_transaction IS NULL)=(transaction_hash IS NULL)),
 CHECK((status IN('COMPLETED','REVERTED'))=(receipt IS NOT NULL))
);
CREATE UNIQUE INDEX broker_selected_paid_signer_hold ON broker_selected_paid_executions((true)) WHERE status IN('SIGNED','SUBMITTED');
CREATE TABLE broker_selected_paid_events (
 intent_id text NOT NULL, journal text NOT NULL, revision integer NOT NULL,status text NOT NULL,
 transaction_hash text,receipt jsonb,reason text,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(intent_id,journal,revision)
);
CREATE FUNCTION broker_selected_paid_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='broker_selected_paid_reviews' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.status<>'PREPARED' OR NEW.revision<>0 OR NEW.reported_hash IS NOT NULL OR NEW.receipt IS NOT NULL THEN RAISE EXCEPTION 'PAID_INVALID_INITIAL_STATE'; END IF;
  ELSE
   IF (to_jsonb(NEW)-ARRAY['revision','status','reported_hash','receipt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','status','reported_hash','receipt'])
    OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'PAID_IMMUTABLE_REVIEW'; END IF;
   IF NOT((OLD.status='PREPARED' AND NEW.status IN('WALLET_REQUESTED','CANCELLED')) OR
    (OLD.status='WALLET_REQUESTED' AND NEW.status IN('WALLET_REQUESTED','CONFIRMED','REVERTED')) OR
    (OLD.status='WALLET_REQUESTED' AND NEW.status='DECLINED' AND OLD.reported_hash IS NULL AND NEW.reported_hash IS NULL)) THEN RAISE EXCEPTION 'PAID_INVALID_TRANSITION'; END IF;
   IF OLD.status='PREPARED' AND NEW.status='WALLET_REQUESTED' AND
    (NEW.review_json::jsonb->>'expiresAt')::numeric<=extract(epoch from clock_timestamp())*1000 THEN RAISE EXCEPTION 'PAID_REVIEW_EXPIRED'; END IF;
   IF NEW.status IN('CONFIRMED','REVERTED') AND (NEW.reported_hash IS NULL OR NEW.receipt->>'transactionHash' IS DISTINCT FROM NEW.reported_hash
    OR NEW.receipt->>'status' IS DISTINCT FROM NEW.status) THEN RAISE EXCEPTION 'PAID_RECEIPT_REQUIRED'; END IF;
  END IF;
 ELSE
  IF TG_OP='INSERT' THEN
   IF NEW.status NOT IN('SIGNED','STOPPED') OR NEW.revision<>0 OR NOT EXISTS(SELECT 1 FROM broker_selected_paid_reviews
    WHERE intent_id=NEW.intent_id AND status='CONFIRMED' AND review_json::jsonb->>'action'='AUTHORIZE') THEN RAISE EXCEPTION 'PAID_AUTHORIZATION_REQUIRED'; END IF;
  ELSE
   IF (to_jsonb(NEW)-ARRAY['revision','status','receipt','reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','status','receipt','reason'])
    OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'PAID_IMMUTABLE_SIGNED_TRANSACTION'; END IF;
   IF OLD.status NOT IN('SIGNED','SUBMITTED') OR NEW.status NOT IN('SUBMITTED','COMPLETED','REVERTED') THEN RAISE EXCEPTION 'PAID_INVALID_TRANSITION'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION broker_selected_paid_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO broker_selected_paid_events(intent_id,journal,revision,status,transaction_hash,receipt,reason)
 VALUES(NEW.intent_id,TG_TABLE_NAME,NEW.revision,NEW.status,COALESCE(to_jsonb(NEW)->>'reported_hash',to_jsonb(NEW)->>'transaction_hash'),
  NEW.receipt,to_jsonb(NEW)->>'reason');RETURN NEW;
END $$;
CREATE TRIGGER broker_selected_paid_review_guard BEFORE INSERT OR UPDATE ON broker_selected_paid_reviews FOR EACH ROW EXECUTE FUNCTION broker_selected_paid_guard();
CREATE TRIGGER broker_selected_paid_execution_guard BEFORE INSERT OR UPDATE ON broker_selected_paid_executions FOR EACH ROW EXECUTE FUNCTION broker_selected_paid_guard();
CREATE TRIGGER broker_selected_paid_review_audit AFTER INSERT OR UPDATE ON broker_selected_paid_reviews FOR EACH ROW EXECUTE FUNCTION broker_selected_paid_audit();
CREATE TRIGGER broker_selected_paid_execution_audit AFTER INSERT OR UPDATE ON broker_selected_paid_executions FOR EACH ROW EXECUTE FUNCTION broker_selected_paid_audit();
ALTER TABLE broker_selected_paid_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_selected_paid_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_selected_paid_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON broker_selected_paid_reviews,broker_selected_paid_executions,broker_selected_paid_events FROM PUBLIC;
REVOKE ALL ON FUNCTION broker_selected_paid_guard(),broker_selected_paid_audit() FROM PUBLIC;
