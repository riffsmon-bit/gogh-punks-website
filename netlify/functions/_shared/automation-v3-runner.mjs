import { getDatabase } from "@netlify/database";
import { runAutomatedSeaDropV3Worker } from
  "../../../scripts/run-automated-seadrop-v3-worker.mjs";
import { recordAutomationV3WorkerHeartbeat } from "./automation-v3-worker-state.mjs";

const WORKER_LOCK_ID = 46_630_003;

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
  let locked = false;
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [WORKER_LOCK_ID],
    );
    locked = lock.rows[0]?.acquired === true;
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
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [WORKER_LOCK_ID]);
    client.release();
  }
}
