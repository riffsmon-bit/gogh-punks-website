import { runAutomatedSeaDropWorker } from "../../scripts/run-automated-seadrop-worker.mjs";
import { recordAutomationV2WorkerHeartbeat } from "./_shared/automation-v2-worker-state.mjs";

export default async function handler() {
  const startedAt = new Date();
  const release = process.env.BROKER_AUTOMATION_V2_WORKER_RELEASE;
  try {
    const result = await runAutomatedSeaDropWorker();
    try {
      await recordAutomationV2WorkerHeartbeat(result, {
        release,
        startedAt,
        completedAt: new Date(),
      });
    } catch {
      console.error(JSON.stringify({ event: "AUTOMATION_V2_HEARTBEAT_FAILED" }));
    }
    console.log(JSON.stringify({ event: "AUTOMATION_V2_WORKER", ...result }));
  } catch (error) {
    try {
      await recordAutomationV2WorkerHeartbeat({
        status: "FAILED",
        submitted: 0,
        failureCode: /^[A-Z0-9_]{1,128}$/.test(error?.code ?? "") ? error.code : "FAILED",
      }, { release, startedAt, completedAt: new Date() });
    } catch {
      console.error(JSON.stringify({ event: "AUTOMATION_V2_HEARTBEAT_FAILED" }));
    }
    console.error(JSON.stringify({ event: "AUTOMATION_V2_WORKER_FAILED", code: error?.code ?? "FAILED" }));
    throw error;
  }
}

export const config = { schedule: "2-59/5 * * * *" };
