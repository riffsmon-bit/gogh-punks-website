-- Dedicated administrator review journal. No NFT, wallet or registry mutation.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gogh_forge_skill_admin_request') THEN
    CREATE ROLE gogh_forge_skill_admin_request NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.broker_forge_skill_admin_reviews (
  id uuid PRIMARY KEY,
  administrator text NOT NULL CHECK (administrator ~ '^0x[0-9a-f]{40}$'),
  chain_id integer NOT NULL CHECK (chain_id = 4663),
  registry text NOT NULL CHECK (registry = '0xc2a1bd47fbc0fe33e53c85f130be53591c898e83'),
  skill_key text NOT NULL CHECK (skill_key ~ '^0x[0-9a-f]{64}$'),
  action text NOT NULL CHECK (action IN ('REGISTER','MARK_TESTING','MARK_READY')),
  request_key uuid NOT NULL,
  preparation jsonb NOT NULL CHECK (jsonb_typeof(preparation) = 'object'),
  review_hash text NOT NULL CHECK (review_hash ~ '^0x[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('PREPARED','WALLET_REQUESTED','SUBMITTED','CONFIRMED','REVERTED','CANCELLED')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  transaction_hash text CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (administrator, registry, request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS broker_forge_skill_admin_one_open
  ON public.broker_forge_skill_admin_reviews(administrator, registry)
  WHERE status IN ('PREPARED','WALLET_REQUESTED','SUBMITTED');
ALTER TABLE public.broker_forge_skill_admin_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_forge_skill_admin_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.broker_forge_skill_admin_reviews FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO gogh_forge_skill_admin_request;
GRANT SELECT, INSERT ON public.broker_forge_skill_admin_reviews TO gogh_forge_skill_admin_request;
GRANT UPDATE(status,revision,transaction_hash,receipt,updated_at) ON public.broker_forge_skill_admin_reviews TO gogh_forge_skill_admin_request;
DROP POLICY IF EXISTS forge_skill_admin_request_only ON public.broker_forge_skill_admin_reviews;
CREATE POLICY forge_skill_admin_request_only ON public.broker_forge_skill_admin_reviews
  TO gogh_forge_skill_admin_request USING (true) WITH CHECK (true);
CREATE OR REPLACE FUNCTION public.enforce_forge_skill_admin_review() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'PREPARED' OR NEW.revision <> 0 OR NEW.transaction_hash IS NOT NULL OR NEW.receipt IS NOT NULL THEN
      RAISE EXCEPTION 'SKILL_ADMIN_INITIAL_STATE_INVALID';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW.administrator,NEW.chain_id,NEW.registry,NEW.skill_key,NEW.action,NEW.request_key,
      NEW.preparation,NEW.review_hash,NEW.created_at) IS DISTINCT FROM
     (OLD.id,OLD.administrator,OLD.chain_id,OLD.registry,OLD.skill_key,OLD.action,OLD.request_key,
      OLD.preparation,OLD.review_hash,OLD.created_at) THEN RAISE EXCEPTION 'SKILL_ADMIN_IMMUTABLE_REVIEW'; END IF;
  IF NEW.revision <> OLD.revision+1 OR NOT (
    (OLD.status='PREPARED' AND NEW.status IN ('WALLET_REQUESTED','CANCELLED')) OR
    (OLD.status='WALLET_REQUESTED' AND NEW.status='SUBMITTED') OR
    (OLD.status='SUBMITTED' AND NEW.status IN ('CONFIRMED','REVERTED'))
  ) THEN RAISE EXCEPTION 'SKILL_ADMIN_INVALID_TRANSITION'; END IF;
  IF NEW.status='WALLET_REQUESTED' AND (NEW.preparation->>'expiresAt')::numeric <= extract(epoch FROM clock_timestamp())*1000
    THEN RAISE EXCEPTION 'SKILL_ADMIN_REVIEW_EXPIRED'; END IF;
  IF OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash
    THEN RAISE EXCEPTION 'SKILL_ADMIN_HASH_IMMUTABLE'; END IF;
  IF (NEW.status IN ('SUBMITTED','CONFIRMED','REVERTED')) <> (NEW.transaction_hash IS NOT NULL)
    THEN RAISE EXCEPTION 'SKILL_ADMIN_HASH_REQUIRED'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS forge_skill_admin_review_guard ON public.broker_forge_skill_admin_reviews;
CREATE TRIGGER forge_skill_admin_review_guard BEFORE INSERT OR UPDATE ON public.broker_forge_skill_admin_reviews
  FOR EACH ROW EXECUTE FUNCTION public.enforce_forge_skill_admin_review();
REVOKE ALL ON FUNCTION public.enforce_forge_skill_admin_review() FROM PUBLIC;
COMMENT ON TABLE public.broker_forge_skill_admin_reviews IS
  'Restricted backend-only journal. Session and current registry administrator checks precede every read/write. Claims precede wallet requests; no signer or automatic broadcast exists.';
