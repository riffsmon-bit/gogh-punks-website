-- Public exact owner-wallet mints: separate from legacy delayed paid escrow.
-- No worker grants, signed bytes, custody, secret, or broad application-role access.
CREATE TABLE broker_public_paid_reviews (
 owner text NOT NULL CHECK(owner ~ '^0x[0-9a-f]{40}$'),
 token_id text NOT NULL CHECK(token_id ~ '^[1-9][0-9]{0,3}$' AND token_id::integer<=5016),
 intent_id text PRIMARY KEY CHECK(intent_id ~ '^[0-9a-f]{64}$'),
 review_json text NOT NULL CHECK(octet_length(review_json)<16384),
 review_hash text NOT NULL CHECK(review_hash=encode(sha256(convert_to(review_json,'UTF8')),'hex')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 status text NOT NULL DEFAULT 'PREPARED' CHECK(status IN('PREPARED','WALLET_REQUESTED','CONFIRMED','REVERTED','CANCELLED','DECLINED')),
 reported_hash text CHECK(reported_hash ~ '^0x[0-9a-f]{64}$'),receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((review_json::jsonb->>'schema'='GOGH_PUBLIC_OWNER_PAID_REVIEW_V1') IS TRUE),
 CHECK((review_json::jsonb->>'intentId'=intent_id) IS TRUE),
 CHECK((review_json::jsonb->>'owner'=owner) IS TRUE),CHECK((review_json::jsonb->>'tokenId'=token_id) IS TRUE),
 CHECK((jsonb_typeof(review_json::jsonb)='object' AND
  jsonb_typeof(review_json::jsonb->'quantity')='number' AND review_json::jsonb->>'quantity'='1' AND
  review_json::jsonb->>'recipient' ~ '^0x[0-9a-f]{40}$' AND review_json::jsonb->>'recipientCodeHash' ~ '^0x[0-9a-f]{64}$' AND
  review_json::jsonb->>'collection' ~ '^0x[0-9a-f]{40}$' AND
  review_json::jsonb->>'priceWei' ~ '^[1-9][0-9]{0,15}$' AND
  (review_json::jsonb->>'maximumPriceWei')::numeric BETWEEN (review_json::jsonb->>'priceWei')::numeric AND 1000000000000000 AND
  review_json::jsonb->>'accountState' ~ '^[0-9]+$' AND (review_json::jsonb->>'maximumNetworkFeeWei')::numeric BETWEEN 1 AND 1000000000000000 AND
  jsonb_typeof(review_json::jsonb->'expiresAt')='number' AND
  jsonb_typeof(review_json::jsonb->'anchor')='object' AND review_json::jsonb->'anchor'->>'number' ~ '^[0-9]+$' AND
  review_json::jsonb->'anchor'->>'hash' ~ '^0x[0-9a-f]{64}$' AND review_json::jsonb->'anchor'->>'timestamp' ~ '^[0-9]+$' AND
  jsonb_typeof(review_json::jsonb->'transaction')='object' AND
  review_json::jsonb->'transaction'->>'from'=owner AND review_json::jsonb->'transaction'->>'to'=review_json::jsonb->>'recipient' AND
  review_json::jsonb->'transaction'->>'chainId'='0x1237' AND review_json::jsonb->'transaction'->>'type'='0x0' AND
  review_json::jsonb->'transaction'->>'value' ~ '^0x[0-9a-f]+$' AND review_json::jsonb->'transaction'->>'data' ~ '^0x[0-9a-f]+$' AND
  review_json::jsonb->'transaction'->>'gas' ~ '^0x[0-9a-f]+$' AND review_json::jsonb->'transaction'->>'gasPrice' ~ '^0x[0-9a-f]+$' AND review_json::jsonb->'transaction'->>'nonce' ~ '^0x[0-9a-f]+$'
 ) IS TRUE),
 CHECK((status IN('CONFIRMED','REVERTED'))=(receipt IS NOT NULL))
);
CREATE UNIQUE INDEX broker_public_paid_hold ON broker_public_paid_reviews(owner) WHERE status IN('PREPARED','WALLET_REQUESTED');
CREATE UNIQUE INDEX broker_public_paid_receipt_unique ON broker_public_paid_reviews(reported_hash) WHERE status IN('CONFIRMED','REVERTED');
CREATE INDEX broker_public_paid_history ON broker_public_paid_reviews(owner,token_id,created_at DESC);
CREATE FUNCTION broker_public_paid_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PREPARED' OR NEW.revision<>0 OR NEW.reported_hash IS NOT NULL OR NEW.receipt IS NOT NULL THEN RAISE EXCEPTION 'PAID_INVALID_INITIAL_STATE'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['revision','status','reported_hash','receipt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','status','reported_hash','receipt']) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'PAID_IMMUTABLE_REVIEW'; END IF;
  IF NOT((OLD.status='PREPARED' AND NEW.status IN('WALLET_REQUESTED','CANCELLED')) OR (OLD.status='WALLET_REQUESTED' AND NEW.status IN('WALLET_REQUESTED','CONFIRMED','REVERTED')) OR (OLD.status='WALLET_REQUESTED' AND NEW.status='DECLINED' AND OLD.reported_hash IS NULL AND NEW.reported_hash IS NULL)) THEN RAISE EXCEPTION 'PAID_INVALID_TRANSITION'; END IF;
  IF OLD.reported_hash IS NOT NULL AND NEW.reported_hash IS DISTINCT FROM OLD.reported_hash THEN RAISE EXCEPTION 'PAID_ORIGINAL_HASH_REQUIRED'; END IF;
  IF OLD.status='PREPARED' AND NEW.status='WALLET_REQUESTED' AND (NEW.review_json::jsonb->>'expiresAt')::numeric<=extract(epoch from clock_timestamp())*1000 THEN RAISE EXCEPTION 'PAID_REVIEW_EXPIRED'; END IF;
  IF NEW.status IN('CONFIRMED','REVERTED') AND (NEW.reported_hash IS NULL OR NEW.receipt->>'transactionHash' IS DISTINCT FROM NEW.reported_hash OR NEW.receipt->>'status' IS DISTINCT FROM NEW.status OR NEW.receipt->>'finalized' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'PAID_RECEIPT_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER broker_public_paid_review_guard BEFORE INSERT OR UPDATE ON broker_public_paid_reviews FOR EACH ROW EXECUTE FUNCTION broker_public_paid_guard();
ALTER TABLE broker_public_paid_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_public_paid_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON broker_public_paid_reviews FROM PUBLIC;
REVOKE ALL ON FUNCTION broker_public_paid_guard() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forge_request') THEN
  GRANT SELECT,INSERT ON broker_public_paid_reviews TO forge_request;
  GRANT UPDATE(revision,status,reported_hash,receipt) ON broker_public_paid_reviews TO forge_request;
 END IF;
END $$;
CREATE POLICY public_paid_request_scope ON broker_public_paid_reviews
 USING(owner=current_setting('gogh.public_paid_owner',true))
 WITH CHECK(owner=current_setting('gogh.public_paid_owner',true));
-- A source can carry a previous owner's unresolved wallet request after transfer.
-- Count-only safety inspection deliberately crosses owner RLS, without exposing
-- review payloads, wallet addresses, or transaction hashes. The migration must
-- run as a reviewed BYPASSRLS administrator; no such role is created/granted.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'PUBLIC_PAID_MIGRATION_REQUIRES_REVIEWED_BYPASSRLS_ADMIN';
 END IF;
END $$;
CREATE FUNCTION broker_public_paid_pending_for_token(p_token_id text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET row_security=off AS $$
BEGIN
 IF p_token_id IS NULL OR p_token_id !~ '^[1-9][0-9]{0,3}$' OR p_token_id::integer>5016 THEN RAISE EXCEPTION 'PUBLIC_PAID_INVALID_TOKEN'; END IF;
 RETURN (SELECT count(*) FROM broker_public_paid_reviews WHERE token_id=p_token_id AND status IN('PREPARED','WALLET_REQUESTED'));
END $$;
REVOKE ALL ON FUNCTION broker_public_paid_pending_for_token(text) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forge_request') THEN
  GRANT EXECUTE ON FUNCTION broker_public_paid_pending_for_token(text) TO forge_request;
 END IF;
END $$;
