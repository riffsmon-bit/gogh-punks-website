import { runAutomatedSeaDropWorker } from "../../scripts/run-automated-seadrop-worker.mjs";

export default async function handler() {
  try {
    const result = await runAutomatedSeaDropWorker();
    console.log(JSON.stringify({ event: "AUTOMATION_V2_WORKER", ...result }));
  } catch (error) {
    console.error(JSON.stringify({ event: "AUTOMATION_V2_WORKER_FAILED", code: error?.code ?? "FAILED" }));
    throw error;
  }
}

export const config = { schedule: "2-59/5 * * * *" };
