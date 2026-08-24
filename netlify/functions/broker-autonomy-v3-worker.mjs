import { runAutomationV3Once } from "./_shared/automation-v3-runner.mjs";

export default async function handler() {
  try {
    const result = await runAutomationV3Once();
    console.log(JSON.stringify({ event: "AUTOMATION_V3_WORKER", ...result }));
  } catch (error) {
    console.error(JSON.stringify({ event: "AUTOMATION_V3_WORKER_FAILED", code: error?.code ?? "FAILED" }));
    throw error;
  }
}

export const config = { schedule: "2-59/5 * * * *" };
