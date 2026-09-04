CREATE TABLE IF NOT EXISTS broker_v1_retirement (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  shutdown_at TIMESTAMPTZ NOT NULL
    DEFAULT '2026-09-04T22:00:00Z'::TIMESTAMPTZ
    CHECK (shutdown_at = '2026-09-04T22:00:00Z'::TIMESTAMPTZ),
  state TEXT NOT NULL DEFAULT 'V1_SUNSET_PENDING' CHECK (state IN (
    'V1_SUNSET_PENDING', 'V1_SHUTDOWN_EXECUTING',
    'REQUIRES_RECEIPT_RECONCILIATION', 'V1_RETIRED'
  )),
  enrolled_punks_at_cutoff INTEGER CHECK (enrolled_punks_at_cutoff IS NULL
    OR enrolled_punks_at_cutoff >= 0),
  paid_jobs_released INTEGER NOT NULL DEFAULT 0 CHECK (paid_jobs_released >= 0),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO broker_v1_retirement (singleton_id)
VALUES (1)
ON CONFLICT (singleton_id) DO NOTHING;

COMMENT ON TABLE broker_v1_retirement IS
  'Canonical V1 sunset audit state. Enrollment rows remain preserved as history; the server cutoff removes their execution capability.';
