ALTER TABLE broker_automation_v3_worker_leases
  DROP CONSTRAINT IF EXISTS broker_automation_v3_worker_leases_lock_id_check;

ALTER TABLE broker_automation_v3_worker_leases
  ADD CONSTRAINT broker_automation_v3_worker_leases_lock_id_check
    CHECK (lock_id >= 46630003 AND lock_id <= 46630008);
