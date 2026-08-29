import {
  runAutomationV3Once, SCHEDULED_WORKER_LEASE_MILLISECONDS,
} from "./_shared/automation-v3-runner.mjs";
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
    const result = await runAutomationV3Once({
      leaseMilliseconds: SCHEDULED_WORKER_LEASE_MILLISECONDS,
      retainLease: true,
    });
    console.log(JSON.stringify({ event: "AUTOMATION_V3_WORKER", ...result }));
  } catch (error) {
    console.error(JSON.stringify({ event: "AUTOMATION_V3_WORKER_FAILED", code: error?.code ?? "FAILED" }));
    throw error;
  }
}

export const config = { schedule: "2-59/5 * * * *" };
