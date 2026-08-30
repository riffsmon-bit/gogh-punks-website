CREATE INDEX IF NOT EXISTS broker_punk_agent_activity_global_timeline_idx
  ON broker_punk_agent_activity (chain_id, occurred_at DESC, event_id DESC);
