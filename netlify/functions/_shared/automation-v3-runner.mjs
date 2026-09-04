import { getDatabase } from "@netlify/database";
import { randomUUID } from "node:crypto";
import {
  AUTOMATION_V3_WORKER_TIME_BUDGET_MS, runAutomatedSeaDropV3Worker,
} from
  "../../../scripts/run-automated-seadrop-v3-worker.mjs";
import {
  recordAutomationV3PunkWorkerEvidence, recordAutomationV3WorkerHeartbeat,
} from "./automation-v3-worker-state.mjs";
import { shadowAutomationV3Run } from "./supabase-operational-store.mjs";
import { automationV3LaneLockId } from "./automation-v3-agent-pool.mjs";
import { assertHostedExecutionEnabled } from "./broker-migration-state.mjs";

const WORKER_LEASE_MILLISECONDS = 90_000;
export const SCHEDULED_WORKER_LEASE_MILLISECONDS = 240_000;

function failureCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,128}$/.test(error.code)
    ? error.code : "FAILED";
}

export function heartbeatPersistenceFailure(error) {
  if (typeof error?.code === "string" && /^[0-9A-Z_]{3,64}$/.test(error.code)) {
    return error.code;
  }
  return error instanceof TypeError
    ? "INVALID_HEARTBEAT_EVIDENCE" : "HEARTBEAT_PERSISTENCE_FAILED";
}

export async function runAutomationV3Once(options = {}) {
  const environment = options.environment ?? process.env;
  assertHostedExecutionEnabled(environment, { now: options.now });
  const database = options.database ?? getDatabase().pool;
  const worker = options.worker ?? runAutomatedSeaDropV3Worker;
  const record = options.record ?? recordAutomationV3WorkerHeartbeat;
  const leaseMilliseconds = options.leaseMilliseconds ?? WORKER_LEASE_MILLISECONDS;
  const laneId = Number(options.laneId
    ?? environment.BROKER_AUTOMATION_V3_ACTIVE_LANE ?? 1);
  const workerLockId = automationV3LaneLockId(laneId);
  const retainLease = options.retainLease === true;
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
      [workerLockId, holder, environment.BROKER_AUTOMATION_V3_WORKER_RELEASE,
        leaseMilliseconds],
    );
    locked = lock.rows[0]?.holder === holder;
    if (!locked) return Object.freeze({ status: "RUN_IN_PROGRESS", submitted: 0 });
    const startedAt = new Date();
    try {
      const result = await worker(environment, {
        database,
        requestedTokenId: options.requestedTokenId ?? null,
        deadlineMs: startedAt.getTime() + AUTOMATION_V3_WORKER_TIME_BUDGET_MS,
        now: options.now,
        beforeSubmission: options.beforeSubmission,
        afterSubmission: options.afterSubmission,
      });
      const completedAt = new Date();
      try {
        await record(result, {
          database,
          release: environment.BROKER_AUTOMATION_V3_WORKER_RELEASE,
          startedAt,
          completedAt,
          laneId,
        });
      } catch (error) {
        console.error(JSON.stringify({ event: "AUTOMATION_V3_HEARTBEAT_FAILED",
          reason: heartbeatPersistenceFailure(error) }));
      }
      try {
        await (options.recordPunks ?? recordAutomationV3PunkWorkerEvidence)(result, {
          database, jobId: holder, startedAt, completedAt,
        });
      } catch {
        console.error(JSON.stringify({ event: "AUTOMATION_V3_PUNK_EVIDENCE_FAILED" }));
      }
      try {
        await (options.shadow ?? shadowAutomationV3Run)(result, {
          environment,
          jobId: holder,
          release: environment.BROKER_AUTOMATION_V3_WORKER_RELEASE,
          startedAt,
          completedAt,
          laneId,
        });
      } catch {
        // Supabase starts as a non-authoritative shadow. A shadow write failure must be visible
        // to operators, but it cannot change the reviewed worker result or strand a Punk.
        console.error(JSON.stringify({ event: "AUTOMATION_V3_SUPABASE_SHADOW_FAILED" }));
      }
      return Object.freeze(result);
    } catch (error) {
      const completedAt = new Date();
      const failedResult = {
        status: "FAILED", submitted: 0, failureCode: failureCode(error),
        tokenId: error?.tokenId ?? null,
        account: error?.account ?? null,
        collection: error?.collection ?? null,
        transactionHash: error?.transactionHash ?? null,
        gasUsed: error?.gasUsed ?? null,
        effectiveGasPriceWei: error?.effectiveGasPriceWei ?? null,
        transactionGasCostWei: error?.transactionGasCostWei ?? null,
        ...(error?.diagnostics ? { diagnostics: error.diagnostics } : {}),
      };
      try {
        await record(failedResult, {
          database,
          release: environment.BROKER_AUTOMATION_V3_WORKER_RELEASE,
          startedAt,
          completedAt,
        });
      } catch (error) {
        console.error(JSON.stringify({ event: "AUTOMATION_V3_HEARTBEAT_FAILED",
          reason: heartbeatPersistenceFailure(error) }));
      }
      try {
        await (options.recordPunks ?? recordAutomationV3PunkWorkerEvidence)(failedResult, {
          database, jobId: holder, startedAt, completedAt,
        });
      } catch {
        console.error(JSON.stringify({ event: "AUTOMATION_V3_PUNK_EVIDENCE_FAILED" }));
      }
      try {
        await (options.shadow ?? shadowAutomationV3Run)(failedResult, {
          environment,
          jobId: holder,
          release: environment.BROKER_AUTOMATION_V3_WORKER_RELEASE,
          startedAt,
          completedAt,
        });
      } catch {
        console.error(JSON.stringify({ event: "AUTOMATION_V3_SUPABASE_SHADOW_FAILED" }));
      }
      throw error;
    }
  } finally {
    if (locked && !retainLease) {
      try {
        await client.query(
          "DELETE FROM broker_automation_v3_worker_leases WHERE lock_id = $1 AND holder = $2",
          [workerLockId, holder],
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
