import { getDatabase } from "@netlify/database";
import { randomUUID } from "node:crypto";
import { runAutomatedSeaDropV3Worker } from
  "../../../scripts/run-automated-seadrop-v3-worker.mjs";
import { recordAutomationV3WorkerHeartbeat } from "./automation-v3-worker-state.mjs";

const WORKER_LOCK_ID = 46_630_003;
const WORKER_LEASE_MILLISECONDS = 240_000;

function failureCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,128}$/.test(error.code)
    ? error.code : "FAILED";
}

export async function runAutomationV3Once(options = {}) {
  const environment = options.environment ?? process.env;
  const database = options.database ?? getDatabase().pool;
  const worker = options.worker ?? runAutomatedSeaDropV3Worker;
  const record = options.record ?? recordAutomationV3WorkerHeartbeat;
  const client = await database.connect();
  const holder = randomUUID();
  let locked = false;
  try {
    const lock = await client.query(
      `INSERT INTO broker_automation_v3_worker_leases
         (lock_id, holder, release_commit, acquired_at, lease_until)
       VALUES ($1, $2, $3, NOW(), NOW() + ($4::integer * INTERVAL '1 millisecond'))
       ON CONFLICT (lock_id) DO UPDATE
         SET holder = EXCLUDED.holder,
             release_commit = EXCLUDED.release_commit,
             acquired_at = EXCLUDED.acquired_at,
             lease_until = EXCLUDED.lease_until
       WHERE broker_automation_v3_worker_leases.lease_until <= NOW()
       RETURNING holder`,
      [WORKER_LOCK_ID, holder, environment.BROKER_AUTOMATION_V3_WORKER_RELEASE,
        WORKER_LEASE_MILLISECONDS],
    );
    locked = lock.rows[0]?.holder === holder;
    if (!locked) return Object.freeze({ status: "RUN_IN_PROGRESS", submitted: 0 });
    const startedAt = new Date();
    try {
      const result = await worker(environment, {
        database,
        requestedTokenId: options.requestedTokenId ?? null,
      });
      try {
        await record(result, {
          database,
          release: environment.BROKER_AUTOMATION_V3_WORKER_RELEASE,
          startedAt,
          completedAt: new Date(),
        });
      } catch {
        console.error(JSON.stringify({ event: "AUTOMATION_V3_HEARTBEAT_FAILED" }));
      }
      return Object.freeze(result);
    } catch (error) {
      try {
        await record({
          status: "FAILED", submitted: 0, failureCode: failureCode(error),
        }, {
          database,
          release: environment.BROKER_AUTOMATION_V3_WORKER_RELEASE,
          startedAt,
          completedAt: new Date(),
        });
      } catch {
        console.error(JSON.stringify({ event: "AUTOMATION_V3_HEARTBEAT_FAILED" }));
      }
      throw error;
    }
  } finally {
    if (locked) {
      try {
        await client.query(
          "DELETE FROM broker_automation_v3_worker_leases WHERE lock_id = $1 AND holder = $2",
          [WORKER_LOCK_ID, holder],
        );
      } catch {
        // The lease expires independently, so a cleanup failure cannot strand
        // the worker or replace the actual run result.
        console.error(JSON.stringify({ event: "AUTOMATION_V3_LEASE_RELEASE_FAILED" }));
      }
    }
    client.release();
  }
}
