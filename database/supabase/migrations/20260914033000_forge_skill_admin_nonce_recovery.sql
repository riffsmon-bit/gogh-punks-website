-- Complete nonce recovery without releasing an unresolved original transaction.
ALTER TABLE public.broker_forge_skill_admin_reviews ADD COLUMN IF NOT EXISTS recovery_hash text
  CHECK (recovery_hash ~ '^0x[0-9a-f]{64}$');
ALTER TABLE public.broker_forge_skill_admin_reviews DROP CONSTRAINT IF EXISTS broker_forge_skill_admin_reviews_status_check;
ALTER TABLE public.broker_forge_skill_admin_reviews ADD CONSTRAINT broker_forge_skill_admin_reviews_status_check
  CHECK (status IN ('PREPARED','WALLET_REQUESTED','SUBMITTED','CONFIRMED','REVERTED','CANCELLED','REPLACED'));
GRANT UPDATE(recovery_hash) ON public.broker_forge_skill_admin_reviews TO gogh_forge_skill_admin_request;

CREATE TABLE IF NOT EXISTS public.broker_forge_skill_admin_cancellations (
  id uuid PRIMARY KEY,parent_id uuid NOT NULL REFERENCES public.broker_forge_skill_admin_reviews(id),
  administrator text NOT NULL,registry text NOT NULL,request_key uuid NOT NULL,
  preparation jsonb NOT NULL,review_hash text NOT NULL CHECK(review_hash ~ '^0x[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('PREPARED','WALLET_REQUESTED')),revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(parent_id,request_key)
);
ALTER TABLE public.broker_forge_skill_admin_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_forge_skill_admin_cancellations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.broker_forge_skill_admin_cancellations FROM PUBLIC;
GRANT SELECT,INSERT ON public.broker_forge_skill_admin_cancellations TO gogh_forge_skill_admin_request;
GRANT UPDATE(status,revision,updated_at) ON public.broker_forge_skill_admin_cancellations TO gogh_forge_skill_admin_request;
DROP POLICY IF EXISTS skill_admin_cancel_role ON public.broker_forge_skill_admin_cancellations;
CREATE POLICY skill_admin_cancel_role ON public.broker_forge_skill_admin_cancellations
  TO gogh_forge_skill_admin_request USING(true) WITH CHECK(true);

CREATE TABLE IF NOT EXISTS public.broker_forge_skill_admin_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,parent_id uuid NOT NULL,
  cancellation_id uuid,administrator text NOT NULL,revision integer NOT NULL,status text NOT NULL,
  transaction_hash text,recovery_hash text,receipt jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.broker_forge_skill_admin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_forge_skill_admin_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.broker_forge_skill_admin_events FROM PUBLIC,gogh_forge_skill_admin_request;
GRANT SELECT ON public.broker_forge_skill_admin_events TO gogh_forge_skill_admin_request;
DROP POLICY IF EXISTS skill_admin_events_read ON public.broker_forge_skill_admin_events;
CREATE POLICY skill_admin_events_read ON public.broker_forge_skill_admin_events
  FOR SELECT TO gogh_forge_skill_admin_request USING(true);

CREATE OR REPLACE FUNCTION public.valid_forge_skill_admin_envelope(p jsonb,owner_address text,destination text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$ DECLARE t jsonb; gas_limit numeric; gas_price numeric; BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p->'transaction') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p->'expiresAt') IS DISTINCT FROM 'number' OR jsonb_typeof(p->'maximumNetworkFeeWei') IS DISTINCT FROM 'string'
    OR (p->'chainId') IS DISTINCT FROM '4663'::jsonb OR (p->'walletConfirmationRequired') IS DISTINCT FROM 'true'::jsonb
    OR NOT COALESCE(p->>'maximumNetworkFeeWei' ~ '^[1-9][0-9]{0,14}$',false)
    OR NOT COALESCE(p->>'expiresAt' ~ '^[1-9][0-9]{0,15}$',false) THEN RETURN false; END IF;
  IF (p->>'maximumNetworkFeeWei')::numeric>100000000000000 OR (p->>'expiresAt')::numeric>8640000000000000 THEN RETURN false; END IF;
  t=p->'transaction';
  IF NOT(t ?& ARRAY['from','to','value','data','chainId','nonce','gas','gasPrice'])
    OR (t-ARRAY['from','to','value','data','chainId','nonce','gas','gasPrice'])<>'{}'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_each(t) item WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string')
    OR lower(t->>'from') IS DISTINCT FROM owner_address OR lower(t->>'to') IS DISTINCT FROM destination
    OR t->>'value' IS DISTINCT FROM '0x0' OR t->>'chainId' IS DISTINCT FROM '0x1237'
    OR NOT COALESCE(t->>'nonce' ~ '^0x(0|[1-9a-f][0-9a-f]{0,15})$',false)
    OR NOT COALESCE(t->>'gas' ~ '^0x[1-9a-f][0-9a-f]{0,7}$',false)
    OR NOT COALESCE(t->>'gasPrice' ~ '^0x[1-9a-f][0-9a-f]{0,15}$',false)
    OR NOT COALESCE(t->>'data' ~ '^0x([0-9a-f]{2})*$',false) THEN RETURN false; END IF;
  gas_limit=(('x'||lpad(substr(t->>'gas',3),16,'0'))::bit(64)::bigint)::numeric;
  gas_price=(('x'||lpad(substr(t->>'gasPrice',3),16,'0'))::bit(64)::bigint)::numeric;
  IF gas_limit<=0 OR gas_limit>600000 OR gas_price<=0 OR gas_limit*gas_price<>(p->>'maximumNetworkFeeWei')::numeric THEN RETURN false; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_forge_skill_admin_review() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
  IF NOT public.valid_forge_skill_admin_envelope(NEW.preparation,NEW.administrator,NEW.registry)
    OR NEW.preparation->>'schema' IS DISTINCT FROM 'GOGH_READ_ONLY_SKILL_RELEASE_PREPARATION_V1'
    OR NEW.preparation->>'key' IS DISTINCT FROM NEW.skill_key OR NEW.preparation->>'action' IS DISTINCT FROM NEW.action
    OR NEW.preparation->'publicTransactions' IS DISTINCT FROM '0'::jsonb
    OR NEW.preparation->'serverReleaseActivated' IS DISTINCT FROM 'false'::jsonb
    OR jsonb_typeof(NEW.preparation->'name') IS DISTINCT FROM 'string'
    OR NOT COALESCE(NEW.preparation->>'manifestHash' ~ '^0x[0-9a-f]{64}$',false)
    OR NOT COALESCE(NEW.preparation->>'instructionHash' ~ '^0x[0-9a-f]{64}$',false)
    OR NOT COALESCE(NEW.preparation->>'reviewEvidenceHash' ~ '^0x[0-9a-f]{64}$',false)
    THEN RAISE EXCEPTION 'SKILL_ADMIN_PREPARATION_INVALID'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PREPARED' OR NEW.revision<>0 OR NEW.transaction_hash IS NOT NULL OR NEW.receipt IS NOT NULL OR NEW.recovery_hash IS NOT NULL
      THEN RAISE EXCEPTION 'SKILL_ADMIN_INITIAL_STATE_INVALID'; END IF; RETURN NEW;
  END IF;
  IF (NEW.id,NEW.administrator,NEW.chain_id,NEW.registry,NEW.skill_key,NEW.action,NEW.request_key,NEW.preparation,NEW.review_hash,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.administrator,OLD.chain_id,OLD.registry,OLD.skill_key,OLD.action,OLD.request_key,OLD.preparation,OLD.review_hash,OLD.created_at)
    THEN RAISE EXCEPTION 'SKILL_ADMIN_IMMUTABLE_REVIEW'; END IF;
  IF NEW.revision<>OLD.revision+1 OR NOT(
    (OLD.status='PREPARED' AND NEW.status IN ('WALLET_REQUESTED','CANCELLED')) OR
    (OLD.status='WALLET_REQUESTED' AND NEW.status IN ('SUBMITTED','REPLACED')) OR
    (OLD.status='SUBMITTED' AND NEW.status IN ('CONFIRMED','REVERTED','REPLACED')) OR
    (OLD.status IN ('WALLET_REQUESTED','SUBMITTED') AND NEW.status=OLD.status AND NEW.recovery_hash IS NOT NULL
      AND NEW.recovery_hash IS DISTINCT FROM OLD.recovery_hash AND NEW.transaction_hash IS NOT DISTINCT FROM OLD.transaction_hash
      AND NEW.receipt IS NOT DISTINCT FROM OLD.receipt)) THEN RAISE EXCEPTION 'SKILL_ADMIN_INVALID_TRANSITION'; END IF;
  IF NEW.status='WALLET_REQUESTED' AND OLD.status='PREPARED'
    AND (NEW.preparation->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000 THEN RAISE EXCEPTION 'SKILL_ADMIN_REVIEW_EXPIRED'; END IF;
  IF OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash THEN RAISE EXCEPTION 'SKILL_ADMIN_HASH_IMMUTABLE'; END IF;
  IF NEW.status IN ('SUBMITTED','CONFIRMED','REVERTED') AND NEW.transaction_hash IS NULL THEN RAISE EXCEPTION 'SKILL_ADMIN_HASH_REQUIRED'; END IF;
  IF NEW.status IN ('PREPARED','WALLET_REQUESTED','CANCELLED') AND NEW.transaction_hash IS NOT NULL THEN RAISE EXCEPTION 'SKILL_ADMIN_HASH_NOT_ALLOWED'; END IF;
  IF NEW.status IN ('CONFIRMED','REVERTED','REPLACED') THEN
    IF jsonb_typeof(NEW.receipt) IS DISTINCT FROM 'object'
      OR NOT(NEW.receipt ?& ARRAY['transactionHash','blockHash','blockNumber','status','minimumConfirmations','kind','valueWei'])
      OR EXISTS(SELECT 1 FROM jsonb_each(NEW.receipt) item WHERE item.key IN ('transactionHash','blockHash','blockNumber','status','kind','valueWei') AND jsonb_typeof(item.value) IS DISTINCT FROM 'string')
      OR NOT COALESCE(NEW.receipt->>'transactionHash' ~ '^0x[0-9a-f]{64}$',false)
      OR NOT COALESCE(NEW.receipt->>'blockHash' ~ '^0x[0-9a-f]{64}$',false)
      OR NOT COALESCE(NEW.receipt->>'blockNumber' ~ '^[0-9]+$',false)
      OR NEW.receipt->'minimumConfirmations' IS DISTINCT FROM '12'::jsonb
      OR NOT COALESCE(NEW.receipt->>'valueWei' ~ '^[0-9]+$',false)
      OR NOT COALESCE(NEW.receipt->>'status' IN ('success','reverted'),false)
      OR (NEW.status='REPLACED' AND (NEW.receipt->>'kind' IS DISTINCT FROM 'REPLACEMENT'
        OR NEW.receipt->>'transactionHash' IS DISTINCT FROM NEW.recovery_hash))
      OR (NEW.status<>'REPLACED' AND (NEW.receipt->>'kind' IS DISTINCT FROM 'ORIGINAL'
        OR NEW.receipt->>'valueWei' IS DISTINCT FROM '0'
        OR NEW.receipt->>'transactionHash' IS DISTINCT FROM COALESCE(NEW.recovery_hash,NEW.transaction_hash)
        OR NEW.receipt->>'status' IS DISTINCT FROM CASE WHEN NEW.status='CONFIRMED' THEN 'success' ELSE 'reverted' END))
      THEN RAISE EXCEPTION 'SKILL_ADMIN_TERMINAL_PROOF_INVALID'; END IF;
  ELSIF NEW.receipt IS NOT NULL THEN RAISE EXCEPTION 'SKILL_ADMIN_PREMATURE_PROOF'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_forge_skill_admin_cancellation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ DECLARE original public.broker_forge_skill_admin_reviews; BEGIN
  SELECT * INTO original FROM public.broker_forge_skill_admin_reviews WHERE id=NEW.parent_id FOR UPDATE;
  IF original.id IS NULL OR original.status NOT IN ('WALLET_REQUESTED','SUBMITTED')
    OR NEW.administrator<>original.administrator OR NEW.registry<>original.registry
    OR NOT public.valid_forge_skill_admin_envelope(NEW.preparation,NEW.administrator,NEW.administrator)
    OR NEW.preparation->>'schema' IS DISTINCT FROM 'GOGH_SKILL_ADMIN_NONCE_CANCELLATION_V1'
    OR NEW.preparation->>'parentId' IS DISTINCT FROM NEW.parent_id::text
    OR NEW.preparation->>'administrator' IS DISTINCT FROM NEW.administrator
    OR NEW.preparation->>'registry' IS DISTINCT FROM NEW.registry
    OR NEW.preparation->'transaction'->>'nonce' IS DISTINCT FROM original.preparation->'transaction'->>'nonce'
    OR jsonb_typeof(NEW.preparation->'replacementBaseGasPrice') IS DISTINCT FROM 'string'
    OR NOT COALESCE(NEW.preparation->>'replacementBaseGasPrice' ~ '^0x[1-9a-f][0-9a-f]{0,15}$',false)
    OR NEW.preparation->>'accountCode' NOT IN ('0x','0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b')
    OR jsonb_typeof(NEW.preparation->'accountCode') IS DISTINCT FROM 'string'
    OR NEW.preparation->>'originalNonce' IS DISTINCT FROM NEW.preparation->'transaction'->>'nonce'
    OR NEW.preparation->'transaction'->>'data' IS DISTINCT FROM '0x'
    OR NEW.preparation->'registryActionRepeated' IS DISTINCT FROM 'false'::jsonb
    OR NEW.preparation->>'assetValueWei' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'SKILL_ADMIN_CANCELLATION_INVALID'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PREPARED' OR NEW.revision<>0 THEN RAISE EXCEPTION 'SKILL_ADMIN_INITIAL_STATE_INVALID'; END IF;
  ELSE
    IF (NEW.id,NEW.parent_id,NEW.administrator,NEW.registry,NEW.request_key,NEW.preparation,NEW.review_hash,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.parent_id,OLD.administrator,OLD.registry,OLD.request_key,OLD.preparation,OLD.review_hash,OLD.created_at)
      THEN RAISE EXCEPTION 'SKILL_ADMIN_IMMUTABLE_REVIEW'; END IF;
    IF OLD.status<>'PREPARED' OR NEW.status<>'WALLET_REQUESTED' OR NEW.revision<>OLD.revision+1
      THEN RAISE EXCEPTION 'SKILL_ADMIN_INVALID_TRANSITION'; END IF;
    IF (NEW.preparation->>'expiresAt')::numeric<=extract(epoch FROM clock_timestamp())*1000 THEN RAISE EXCEPTION 'SKILL_ADMIN_REVIEW_EXPIRED'; END IF;
  END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS skill_admin_cancel_guard ON public.broker_forge_skill_admin_cancellations;
CREATE TRIGGER skill_admin_cancel_guard BEFORE INSERT OR UPDATE ON public.broker_forge_skill_admin_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_forge_skill_admin_cancellation();

CREATE OR REPLACE FUNCTION public.audit_forge_skill_admin_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
  IF TG_TABLE_NAME='broker_forge_skill_admin_cancellations' THEN
    INSERT INTO public.broker_forge_skill_admin_events(parent_id,cancellation_id,administrator,revision,status)
      VALUES(NEW.parent_id,NEW.id,NEW.administrator,NEW.revision,NEW.status);
  ELSE
    INSERT INTO public.broker_forge_skill_admin_events(parent_id,administrator,revision,status,transaction_hash,recovery_hash,receipt)
      VALUES(NEW.id,NEW.administrator,NEW.revision,NEW.status,NEW.transaction_hash,NEW.recovery_hash,NEW.receipt);
  END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_forge_skill_admin_transition() FROM PUBLIC,gogh_forge_skill_admin_request;
DROP TRIGGER IF EXISTS skill_admin_review_audit ON public.broker_forge_skill_admin_reviews;
CREATE TRIGGER skill_admin_review_audit AFTER INSERT OR UPDATE ON public.broker_forge_skill_admin_reviews
  FOR EACH ROW EXECUTE FUNCTION public.audit_forge_skill_admin_transition();
DROP TRIGGER IF EXISTS skill_admin_cancellation_audit ON public.broker_forge_skill_admin_cancellations;
CREATE TRIGGER skill_admin_cancellation_audit AFTER INSERT OR UPDATE ON public.broker_forge_skill_admin_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.audit_forge_skill_admin_transition();
