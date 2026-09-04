-- The owner clarified that V1 retires September 5 at 6:00 PM EDT. Keep the original
-- migration immutable and move the singleton cutoff forward additively before it executes.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM broker_v1_retirement
     WHERE singleton_id = 1 AND started_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'V1 retirement already started; refusing to reschedule';
  END IF;
END;
$$;

ALTER TABLE broker_v1_retirement
  DROP CONSTRAINT IF EXISTS broker_v1_retirement_shutdown_at_check;

ALTER TABLE broker_v1_retirement
  ALTER COLUMN shutdown_at SET DEFAULT '2026-09-05T22:00:00Z'::TIMESTAMPTZ;

UPDATE broker_v1_retirement
   SET shutdown_at = '2026-09-05T22:00:00Z'::TIMESTAMPTZ,
       updated_at = NOW()
 WHERE singleton_id = 1;

ALTER TABLE broker_v1_retirement
  ADD CONSTRAINT broker_v1_retirement_shutdown_at_check
  CHECK (shutdown_at = '2026-09-05T22:00:00Z'::TIMESTAMPTZ);
