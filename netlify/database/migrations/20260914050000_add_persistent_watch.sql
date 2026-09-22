-- Additive logical watching only. No wallet key, signing payload or economic authority.
CREATE TABLE broker_v2_persistent_watches (
 token_id text PRIMARY KEY CHECK(token_id ~ '^[1-9][0-9]{0,3}$' AND token_id::integer<=5016),
 chain_id integer NOT NULL DEFAULT 4663 CHECK(chain_id=4663),
 collection_address text NOT NULL DEFAULT '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6'
   CHECK(collection_address='0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6'),
 owner_snapshot text NOT NULL CHECK(owner_snapshot ~ '^0x[0-9a-f]{40}$'),
 version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('ACTIVE','PAUSED','OWNER_ACTION_REQUIRED')),
 config jsonb NOT NULL CHECK(jsonb_typeof(config)='object' AND config ? 'schema' AND config->>'schema'='GOGH_PERSISTENT_WATCH_CONFIG_V1'),
 checkpoint_block numeric(78,0) NOT NULL CHECK(checkpoint_block>=0),
 checkpoint_hash text NOT NULL CHECK(checkpoint_hash ~ '^0x[0-9a-f]{64}$'),
 activated_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 last_checked_at timestamptz
);
CREATE INDEX broker_v2_persistent_active ON broker_v2_persistent_watches
 (last_checked_at NULLS FIRST,token_id) WHERE state='ACTIVE';
CREATE TABLE broker_v2_persistent_watch_drafts (
 draft_id uuid PRIMARY KEY,
 token_id text NOT NULL CHECK(token_id ~ '^[1-9][0-9]{0,3}$' AND token_id::integer<=5016),
 owner_address text NOT NULL CHECK(owner_address ~ '^0x[0-9a-f]{40}$'),
 expected_version integer NOT NULL CHECK(expected_version>=0), config jsonb NOT NULL,
 anchor jsonb NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz,
 UNIQUE(token_id,owner_address)
);
CREATE TABLE broker_v2_persistent_watch_decisions (
 token_id text NOT NULL REFERENCES broker_v2_persistent_watches(token_id),
 watch_version integer NOT NULL CHECK(watch_version>0),
 observation_key text NOT NULL CHECK(observation_key ~ '^[0-9a-f]{64}$'),
 opportunity_id text NOT NULL CHECK(length(opportunity_id) BETWEEN 8 AND 256),
 utc_day date NOT NULL, status text NOT NULL CHECK(status IN ('CLAIMED','DONE','CANCELLED')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 PRIMARY KEY(token_id,watch_version,observation_key),
 CHECK((status='DONE')=(result IS NOT NULL)),
 CHECK(result IS NULL OR (jsonb_typeof(result)='object'
   AND result ?& ARRAY['schema','executionAuthorized','transactionPrepared','transactionSubmitted']
   AND result->>'schema'='GOGH_PERSISTENT_WATCH_DECISION_V1'
   AND result->'executionAuthorized'='false'::jsonb AND result->'transactionPrepared'='false'::jsonb
   AND result->'transactionSubmitted'='false'::jsonb))
);
CREATE INDEX broker_v2_persistent_decisions_history ON broker_v2_persistent_watch_decisions(token_id,created_at DESC);
ALTER TABLE broker_v2_persistent_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_v2_persistent_watch_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_v2_persistent_watch_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON broker_v2_persistent_watches,broker_v2_persistent_watch_drafts,broker_v2_persistent_watch_decisions FROM PUBLIC;
-- No browser/anonymous policies. Existing trusted server role requires reviewed table privileges.
