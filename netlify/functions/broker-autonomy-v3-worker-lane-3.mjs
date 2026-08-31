import { runScheduledAutomationV3Lane } from "./_shared/automation-v3-lane-handler.mjs";

export default async function handler() {
  const result = await runScheduledAutomationV3Lane(3);
  console.log(JSON.stringify({ event: "AUTOMATION_V3_WORKER_LANE", ...result }));
}

export const config = { schedule: "4-59/5 * * * *" };
