import { runScheduledAutomationV3Lane } from "./_shared/automation-v3-lane-handler.mjs";
import {
  backgroundRpcDecision, logBackgroundRpcSkip,
} from "./_shared/background-rpc-policy.mjs";

export default async function handler() {
  const decision = backgroundRpcDecision(process.env, "AUTOMATION_V3_WORKER");
  if (!decision.enabled) {
    logBackgroundRpcSkip(decision);
    return;
  }
  try {
    const result = await runScheduledAutomationV3Lane(1);
    console.log(JSON.stringify({ event: "AUTOMATION_V3_WORKER", ...result }));
  } catch (error) {
    console.error(JSON.stringify({ event: "AUTOMATION_V3_WORKER_FAILED", code: error?.code ?? "FAILED" }));
    throw error;
  }
}

export const config = { schedule: "2-59/5 * * * *" };
