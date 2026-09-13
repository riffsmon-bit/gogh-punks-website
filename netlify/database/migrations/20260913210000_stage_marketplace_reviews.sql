-- Staged only. No production grants, policies, deployment, or execution authority.
CREATE TABLE broker_marketplace_reviews (
 intent_id text PRIMARY KEY CHECK(intent_id ~ '^[0-9a-f]{64}$'),
 owner_address text NOT NULL CHECK(owner_address ~ '^0x[0-9a-f]{40}$'),
 punk_id text NOT NULL CHECK(punk_id ~ '^(0|[1-9][0-9]{0,3})$' AND punk_id::numeric<=5016),
 chain_id integer NOT NULL CHECK(chain_id=4663), expires_at_ms bigint NOT NULL,
 review_json text NOT NULL CHECK(octet_length(review_json)<65536),
 review_hash text NOT NULL CHECK(review_hash=encode(sha256(convert_to(review_json,'UTF8')),'hex')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 status text NOT NULL DEFAULT 'PREPARED' CHECK(status IN('PREPARED','WALLET_REQUESTED','COMPLETED','REVERTED','CANCELLED')),
 reported_hash text CHECK(reported_hash ~ '^0x[0-9a-f]{64}$'), receipt jsonb,
 reason text CHECK(reason ~ '^[A-Z][A-Z0-9_]{0,95}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(jsonb_typeof(review_json::jsonb)='object' AND review_json::jsonb ?& ARRAY['intentId','releaseHash','input','review']),
 CHECK(jsonb_typeof(review_json::jsonb->'review')='object' AND review_json::jsonb->'review' ?&
  ARRAY['schema','owner','punkId','chainId','expiresAt','action','transaction']),
 CHECK(jsonb_typeof(review_json::jsonb->'review'->'transaction')='object'),
 CHECK(review_json::jsonb->>'intentId'=intent_id),
 CHECK(review_json::jsonb->'review'->>'schema'='GOGH_MARKETPLACE_REVIEW_V1'),
 CHECK(review_json::jsonb->'review'->>'owner'=owner_address),
 CHECK(review_json::jsonb->'review'->>'punkId'=punk_id),
 CHECK((review_json::jsonb->'review'->>'chainId')::integer=chain_id),
 CHECK((review_json::jsonb->'review'->>'expiresAt')::bigint=expires_at_ms),
 CHECK(review_json::jsonb->'review'->>'action'='BUY_LISTINGS'),
 CHECK((status IN('COMPLETED','REVERTED'))=(receipt IS NOT NULL)),
 CHECK(status NOT IN('PREPARED','CANCELLED') OR reported_hash IS NULL)
);
-- Transfer does not release the previous owner's potentially submitted operation.
CREATE UNIQUE INDEX broker_marketplace_punk_hold ON broker_marketplace_reviews(chain_id,punk_id)
 WHERE status IN('PREPARED','WALLET_REQUESTED');
-- Owner EOAs share one nonce stream even when the selected Punk changes.
CREATE UNIQUE INDEX broker_marketplace_owner_hold ON broker_marketplace_reviews(chain_id,owner_address)
 WHERE status IN('PREPARED','WALLET_REQUESTED');
CREATE TABLE broker_marketplace_events (
 intent_id text NOT NULL REFERENCES broker_marketplace_reviews(intent_id), revision integer NOT NULL,
 status text NOT NULL, reported_hash text, receipt jsonb, reason text,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(intent_id,revision)
);
CREATE FUNCTION broker_marketplace_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'MARKETPLACE_DELETE_FORBIDDEN'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PREPARED' OR NEW.revision<>0 OR NEW.reported_hash IS NOT NULL OR NEW.receipt IS NOT NULL OR NEW.reason IS NOT NULL
   THEN RAISE EXCEPTION 'MARKETPLACE_INVALID_INITIAL_STATE'; END IF;
  IF NEW.expires_at_ms<=extract(epoch from clock_timestamp())*1000 THEN RAISE EXCEPTION 'MARKETPLACE_REVIEW_EXPIRED'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['revision','status','reported_hash','receipt','reason']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['revision','status','reported_hash','receipt','reason']) OR NEW.revision<>OLD.revision+1
   THEN RAISE EXCEPTION 'MARKETPLACE_IMMUTABLE_REVIEW'; END IF;
  IF NOT((OLD.status='PREPARED' AND NEW.status IN('WALLET_REQUESTED','CANCELLED')) OR
    (OLD.status='WALLET_REQUESTED' AND NEW.status IN('WALLET_REQUESTED','COMPLETED','REVERTED')))
   THEN RAISE EXCEPTION 'MARKETPLACE_INVALID_TRANSITION'; END IF;
  IF OLD.status='PREPARED' AND NEW.status='WALLET_REQUESTED' AND NEW.expires_at_ms<=extract(epoch from clock_timestamp())*1000
   THEN RAISE EXCEPTION 'MARKETPLACE_REVIEW_EXPIRED'; END IF;
  IF OLD.reported_hash IS NOT NULL AND NEW.reported_hash IS DISTINCT FROM OLD.reported_hash
   THEN RAISE EXCEPTION 'MARKETPLACE_ORIGINAL_HASH_IMMUTABLE'; END IF;
  IF OLD.status='PREPARED' AND (NEW.reported_hash IS NOT NULL OR NEW.receipt IS NOT NULL)
   THEN RAISE EXCEPTION 'MARKETPLACE_CLAIM_REQUIRED'; END IF;
  IF NEW.status IN('COMPLETED','REVERTED') AND (NEW.reported_hash IS NULL OR NEW.receipt->>'transactionHash' IS DISTINCT FROM NEW.reported_hash
    OR NEW.receipt->>'status' IS DISTINCT FROM NEW.status) THEN RAISE EXCEPTION 'MARKETPLACE_RECEIPT_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION broker_marketplace_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.broker_marketplace_events(intent_id,revision,status,reported_hash,receipt,reason)
 VALUES(NEW.intent_id,NEW.revision,NEW.status,NEW.reported_hash,NEW.receipt,NEW.reason); RETURN NEW;
END $$;
CREATE TRIGGER broker_marketplace_review_guard BEFORE INSERT OR UPDATE OR DELETE ON broker_marketplace_reviews
 FOR EACH ROW EXECUTE FUNCTION broker_marketplace_guard();
CREATE TRIGGER broker_marketplace_review_audit AFTER INSERT OR UPDATE ON broker_marketplace_reviews
 FOR EACH ROW EXECUTE FUNCTION broker_marketplace_audit();
ALTER TABLE broker_marketplace_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_marketplace_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON broker_marketplace_reviews,broker_marketplace_events FROM PUBLIC;
REVOKE ALL ON FUNCTION broker_marketplace_guard(),broker_marketplace_audit() FROM PUBLIC;
