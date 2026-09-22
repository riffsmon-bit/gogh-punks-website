-- Additive, staged holder Forge journal. No grants or production activation.
CREATE TABLE broker_holder_burn_reviews (
  intent_id text PRIMARY KEY CHECK(intent_id ~ '^[0-9a-f]{64}$'),
  owner_address text NOT NULL CHECK(owner_address ~ '^0x[0-9a-f]{40}$'),
  source_token_id text NOT NULL CHECK(source_token_id ~ '^(0|[1-9][0-9]{0,3})$' AND source_token_id::numeric<=5016),
  target_token_id text NOT NULL CHECK(target_token_id ~ '^(0|[1-9][0-9]{0,3})$' AND target_token_id::numeric<=5016),
  review_json text NOT NULL CHECK(octet_length(review_json)<131072),
  review_hash text NOT NULL CHECK(review_hash=encode(sha256(convert_to(review_json,'UTF8')),'hex')),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  status text NOT NULL DEFAULT 'PREPARED' CHECK(status IN('PREPARED','WALLET_REQUESTED','CONFIRMED','REVERTED','CANCELLED')),
  reported_hash text CHECK(reported_hash ~ '^0x[0-9a-f]{64}$'), receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(source_token_id<>target_token_id),
  CHECK(jsonb_typeof(review_json::jsonb)='object' AND review_json::jsonb ?&
    ARRAY['schema','intentId','action','chainId','state','expiresAt','maximumNetworkFeeWei','transaction','sourceEvidence']),
  CHECK(review_json::jsonb->>'schema'='GOGH_ORIGINAL_PUNK_BURN_PREPARATION_V1'
    AND jsonb_typeof(review_json::jsonb->'schema')='string'),
  CHECK(jsonb_typeof(review_json::jsonb->'intentId')='string' AND jsonb_typeof(review_json::jsonb->'action')='string'),
  CHECK(jsonb_typeof(review_json::jsonb->'chainId')='number' AND review_json::jsonb->>'chainId'='4663'),
  CHECK(jsonb_typeof(review_json::jsonb->'state')='object' AND (review_json::jsonb->'state') ?& ARRAY['owner','sourceTokenId','targetTokenId']),
  CHECK(jsonb_typeof(review_json::jsonb#>'{state,owner}')='string'
    AND jsonb_typeof(review_json::jsonb#>'{state,sourceTokenId}')='string'
    AND jsonb_typeof(review_json::jsonb#>'{state,targetTokenId}')='string'),
  CHECK(jsonb_typeof(review_json::jsonb->'expiresAt')='number' AND review_json::jsonb->>'expiresAt' ~ '^[1-9][0-9]{0,15}$'),
  CHECK(jsonb_typeof(review_json::jsonb->'maximumNetworkFeeWei')='string'
    AND review_json::jsonb->>'maximumNetworkFeeWei' ~ '^[1-9][0-9]{0,15}$'),
  CHECK(jsonb_typeof(review_json::jsonb->'sourceEvidence')='object'),
  CHECK(jsonb_typeof(review_json::jsonb->'transaction')='object' AND (review_json::jsonb->'transaction') ?&
    ARRAY['from','to','chainId','value','nonce','gas','gasPrice','data']
    AND (review_json::jsonb->'transaction')-ARRAY['from','to','chainId','value','type','nonce','gas','gasPrice','data']='{}'::jsonb),
  CHECK(jsonb_typeof(review_json::jsonb#>'{transaction,from}')='string' AND review_json::jsonb#>>'{transaction,from}'=owner_address
    AND jsonb_typeof(review_json::jsonb#>'{transaction,to}')='string' AND review_json::jsonb#>>'{transaction,to}' ~ '^0x[0-9a-f]{40}$'),
  CHECK(jsonb_typeof(review_json::jsonb#>'{transaction,chainId}')='string' AND review_json::jsonb#>>'{transaction,chainId}'='0x1237'
    AND jsonb_typeof(review_json::jsonb#>'{transaction,value}')='string' AND review_json::jsonb#>>'{transaction,value}'='0x0'),
  CHECK(jsonb_typeof(review_json::jsonb#>'{transaction,nonce}')='string' AND review_json::jsonb#>>'{transaction,nonce}' ~ '^0x[0-9a-f]+$'
    AND jsonb_typeof(review_json::jsonb#>'{transaction,gas}')='string' AND review_json::jsonb#>>'{transaction,gas}' ~ '^0x[0-9a-f]+$'
    AND jsonb_typeof(review_json::jsonb#>'{transaction,gasPrice}')='string' AND review_json::jsonb#>>'{transaction,gasPrice}' ~ '^0x[0-9a-f]+$'
    AND jsonb_typeof(review_json::jsonb#>'{transaction,data}')='string' AND review_json::jsonb#>>'{transaction,data}' ~ '^0x[0-9a-f]+$'),
  CHECK(review_json::jsonb->>'intentId'=intent_id),
  CHECK(review_json::jsonb#>>'{state,owner}'=owner_address),
  CHECK(review_json::jsonb#>>'{state,sourceTokenId}'=source_token_id),
  CHECK(review_json::jsonb#>>'{state,targetTokenId}'=target_token_id),
  CHECK(review_json::jsonb->>'action' IN('APPROVE','BURN')),
  CHECK((status IN('CONFIRMED','REVERTED'))=(receipt IS NOT NULL))
);
-- One potentially submitted action cannot be hidden by selecting another pair,
-- recipient or owner. The owner nonce is also held across different Punks.
CREATE UNIQUE INDEX broker_holder_burn_source_hold ON broker_holder_burn_reviews(source_token_id)
  WHERE status IN('PREPARED','WALLET_REQUESTED');
CREATE UNIQUE INDEX broker_holder_burn_owner_hold ON broker_holder_burn_reviews(owner_address)
  WHERE status IN('PREPARED','WALLET_REQUESTED');
CREATE INDEX broker_holder_burn_current ON broker_holder_burn_reviews(owner_address,source_token_id,target_token_id,
  (status IN('PREPARED','WALLET_REQUESTED')) DESC,created_at DESC,intent_id DESC);
CREATE TABLE broker_holder_burn_events (
  intent_id text NOT NULL REFERENCES broker_holder_burn_reviews(intent_id),revision integer NOT NULL,status text NOT NULL,
  reported_hash text,receipt jsonb,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(intent_id,revision)
);
CREATE FUNCTION broker_holder_burn_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'HOLDER_BURN_DELETE_FORBIDDEN'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PREPARED' OR NEW.revision<>0 OR NEW.reported_hash IS NOT NULL OR NEW.receipt IS NOT NULL
      THEN RAISE EXCEPTION 'HOLDER_BURN_INITIAL_STATE'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['revision','status','reported_hash','receipt']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['revision','status','reported_hash','receipt']) OR NEW.revision<>OLD.revision+1
      THEN RAISE EXCEPTION 'HOLDER_BURN_IMMUTABLE'; END IF;
    IF NOT ((OLD.status='PREPARED' AND NEW.status IN('CANCELLED','WALLET_REQUESTED')) OR
      (OLD.status='WALLET_REQUESTED' AND NEW.status IN('WALLET_REQUESTED','CONFIRMED','REVERTED')))
      THEN RAISE EXCEPTION 'HOLDER_BURN_TRANSITION'; END IF;
    IF OLD.reported_hash IS NOT NULL AND NEW.reported_hash IS DISTINCT FROM OLD.reported_hash
      THEN RAISE EXCEPTION 'HOLDER_BURN_ORIGINAL_HASH'; END IF;
    IF OLD.status='PREPARED' AND (NEW.reported_hash IS NOT NULL OR NEW.receipt IS NOT NULL)
      THEN RAISE EXCEPTION 'HOLDER_BURN_CLAIM_FIRST'; END IF;
  END IF;
  IF NEW.status IN('PREPARED','WALLET_REQUESTED') AND (TG_OP='INSERT' OR OLD.status='PREPARED') AND
    (NEW.review_json::jsonb->>'expiresAt')::numeric<=extract(epoch from clock_timestamp())*1000
    THEN RAISE EXCEPTION 'HOLDER_BURN_EXPIRED'; END IF;
  IF NEW.status IN('CONFIRMED','REVERTED') AND (NEW.reported_hash IS NULL OR
    NEW.receipt->>'transactionHash' IS DISTINCT FROM NEW.reported_hash OR NEW.receipt->>'status' IS DISTINCT FROM NEW.status)
    THEN RAISE EXCEPTION 'HOLDER_BURN_RECEIPT_REQUIRED'; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION broker_holder_burn_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.broker_holder_burn_events(intent_id,revision,status,reported_hash,receipt)
    VALUES(NEW.intent_id,NEW.revision,NEW.status,NEW.reported_hash,NEW.receipt); RETURN NEW;
END $$;
CREATE TRIGGER broker_holder_burn_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON broker_holder_burn_reviews
  FOR EACH ROW EXECUTE FUNCTION broker_holder_burn_guard();
CREATE TRIGGER broker_holder_burn_audit_trigger AFTER INSERT OR UPDATE ON broker_holder_burn_reviews
  FOR EACH ROW EXECUTE FUNCTION broker_holder_burn_audit();

CREATE TABLE broker_holder_asset_history (
  history_key text PRIMARY KEY CHECK(history_key ~ '^[0-9a-f]{64}$'),identity jsonb NOT NULL,
  cursor_block bigint NOT NULL DEFAULT -1 CHECK(cursor_block>=-1),anchor_hash text CHECK(anchor_hash ~ '^0x[0-9a-f]{64}$'),
  assets jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(assets)='array' AND jsonb_array_length(assets)<=2048),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),reorg_proof jsonb,
  CHECK(jsonb_typeof(identity)='object' AND identity ?& ARRAY['key','chainId','collection','sourceTokenId','wallets']),
  CHECK(jsonb_typeof(identity->'key')='string' AND identity->>'key'=history_key),
  CHECK((cursor_block=-1)=(anchor_hash IS NULL))
);
CREATE TABLE broker_holder_history_resets (
  history_key text NOT NULL REFERENCES broker_holder_asset_history(history_key),generation integer NOT NULL,
  prior_cursor bigint NOT NULL,prior_hash text NOT NULL,prior_assets jsonb NOT NULL,proof jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(history_key,generation)
);
CREATE FUNCTION broker_holder_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'HOLDER_HISTORY_DELETE_FORBIDDEN'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.cursor_block<>-1 OR NEW.revision<>0 OR NEW.generation<>0 OR NEW.reorg_proof IS NOT NULL OR NEW.assets<>'[]'::jsonb
      THEN RAISE EXCEPTION 'HOLDER_HISTORY_START_REQUIRED'; END IF;
  ELSE
    IF NEW.history_key<>OLD.history_key OR NEW.identity<>OLD.identity OR NEW.revision<>OLD.revision+1
      THEN RAISE EXCEPTION 'HOLDER_HISTORY_CURSOR_INVALID'; END IF;
    IF NEW.generation=OLD.generation THEN
      IF NEW.cursor_block<=OLD.cursor_block OR NEW.cursor_block-OLD.cursor_block>2000 OR NOT NEW.assets @> OLD.assets
        OR NEW.reorg_proof IS DISTINCT FROM OLD.reorg_proof THEN RAISE EXCEPTION 'HOLDER_HISTORY_CURSOR_INVALID'; END IF;
    ELSE
      IF NEW.generation<>OLD.generation+1 OR OLD.cursor_block<0 OR NEW.cursor_block<>-1 OR NEW.anchor_hash IS NOT NULL
        OR NEW.assets<>'[]'::jsonb OR NEW.reorg_proof IS NULL
        OR NEW.reorg_proof->>'reason' IS DISTINCT FROM 'CANONICAL_REORG'
        OR NEW.reorg_proof->>'oldCursor' IS DISTINCT FROM OLD.cursor_block::text
        OR NEW.reorg_proof->>'oldHash' IS DISTINCT FROM OLD.anchor_hash
        OR COALESCE(NEW.reorg_proof->>'replacementHash','') !~ '^0x[0-9a-f]{64}$'
        OR NEW.reorg_proof->>'replacementHash'=OLD.anchor_hash THEN RAISE EXCEPTION 'HOLDER_HISTORY_RESET_INVALID'; END IF;
    END IF;
  END IF; RETURN NEW;
END $$;
CREATE FUNCTION broker_holder_history_reset_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.broker_holder_history_resets(history_key,generation,prior_cursor,prior_hash,prior_assets,proof)
    VALUES(NEW.history_key,NEW.generation,OLD.cursor_block,OLD.anchor_hash,OLD.assets,NEW.reorg_proof); RETURN NEW;
END $$;
CREATE TRIGGER broker_holder_history_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON broker_holder_asset_history
  FOR EACH ROW EXECUTE FUNCTION broker_holder_history_guard();
CREATE TRIGGER broker_holder_history_reset_audit_trigger AFTER UPDATE ON broker_holder_asset_history
  FOR EACH ROW WHEN(NEW.generation IS DISTINCT FROM OLD.generation) EXECUTE FUNCTION broker_holder_history_reset_audit();
ALTER TABLE broker_holder_burn_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_holder_burn_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_holder_asset_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_holder_history_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON broker_holder_burn_reviews,broker_holder_burn_events,broker_holder_asset_history,broker_holder_history_resets FROM PUBLIC;
REVOKE ALL ON FUNCTION broker_holder_burn_guard(),broker_holder_burn_audit(),broker_holder_history_guard(),broker_holder_history_reset_audit() FROM PUBLIC;
