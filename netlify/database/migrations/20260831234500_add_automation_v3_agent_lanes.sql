ALTER TABLE broker_automation_v3_enrollments
  ADD COLUMN IF NOT EXISTS agent_address CHAR(42),
  ADD COLUMN IF NOT EXISTS agent_lane SMALLINT;

UPDATE broker_automation_v3_enrollments
   SET agent_address = '0x3bb2ebf6b3c4d7f5e5781cdf2091428f7750af7d',
       agent_lane = 1
 WHERE agent_address IS NULL OR agent_lane IS NULL;

ALTER TABLE broker_automation_v3_enrollments
  ALTER COLUMN agent_address SET NOT NULL,
  ALTER COLUMN agent_lane SET NOT NULL;

ALTER TABLE broker_automation_v3_enrollments
  DROP CONSTRAINT IF EXISTS broker_automation_v3_enrollments_agent_address_lowercase,
  DROP CONSTRAINT IF EXISTS broker_automation_v3_enrollments_agent_lane_range;

ALTER TABLE broker_automation_v3_enrollments
  ADD CONSTRAINT broker_automation_v3_enrollments_agent_address_lowercase
    CHECK (agent_address = LOWER(agent_address)),
  ADD CONSTRAINT broker_automation_v3_enrollments_agent_lane_range
    CHECK (agent_lane >= 1 AND agent_lane <= 6);

CREATE INDEX IF NOT EXISTS broker_automation_v3_enrollments_agent_requested_idx
  ON broker_automation_v3_enrollments (agent_address, last_requested_at DESC);
