import { runAutomatedSeaDropV3Worker } from "../../scripts/run-automated-seadrop-v3-worker.mjs";
import { recordAutomationV3WorkerHeartbeat } from "./_shared/automation-v3-worker-state.mjs";

export default async function handler() {
  const startedAt = new Date();
  const release = process.env.BROKER_AUTOMATION_V3_WORKER_RELEASE;
  try {
    const result = await runAutomatedSeaDropV3Worker();
    try {
      await recordAutomationV3WorkerHeartbeat(result, {
        release,
        startedAt,
        completedAt: new Date(),
      });
    } catch {
      console.error(JSON.stringify({ event: "AUTOMATION_V3_HEARTBEAT_FAILED" }));
    }
    console.log(JSON.stringify({ event: "AUTOMATION_V3_WORKER", ...result }));
  } catch (error) {
    try {
      await recordAutomationV3WorkerHeartbeat({
        status: "FAILED",
        submitted: 0,
        failureCode: /^[A-Z0-9_]{1,128}$/.test(error?.code ?? "") ? error.code : "FAILED",
      }, { release, startedAt, completedAt: new Date() });
    } catch {
      console.error(JSON.stringify({ event: "AUTOMATION_V3_HEARTBEAT_FAILED" }));
    }
    console.error(JSON.stringify({ event: "AUTOMATION_V3_WORKER_FAILED", code: error?.code ?? "FAILED" }));
    throw error;
  }
}

export const config = { schedule: "2-59/5 * * * *" };
