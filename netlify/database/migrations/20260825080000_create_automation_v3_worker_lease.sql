CREATE TABLE IF NOT EXISTS broker_automation_v3_worker_leases (
  lock_id INTEGER PRIMARY KEY CHECK (lock_id = 46630003),
  holder UUID NOT NULL,
  release_commit CHAR(40) NOT NULL CHECK (release_commit = LOWER(release_commit)),
  acquired_at TIMESTAMPTZ NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL CHECK (lease_until > acquired_at)
);

CREATE INDEX IF NOT EXISTS broker_automation_v3_worker_leases_expiry_idx
  ON broker_automation_v3_worker_leases (lease_until);
