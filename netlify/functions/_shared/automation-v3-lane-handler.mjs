import {
  runAutomationV3Once, SCHEDULED_WORKER_LEASE_MILLISECONDS,
} from "./automation-v3-runner.mjs";
import {
  backgroundRpcDecision, logBackgroundRpcSkip,
} from "./background-rpc-policy.mjs";
import { automationV3LaneEnvironment } from "./automation-v3-agent-pool.mjs";

export async function runScheduledAutomationV3Lane(laneId, dependencies = {}) {
  const baseEnvironment = dependencies.environment ?? process.env;
  const decision = backgroundRpcDecision(baseEnvironment, "AUTOMATION_V3_WORKER");
  if (!decision.enabled) {
    logBackgroundRpcSkip(decision);
    return Object.freeze({ status: "DISABLED", submitted: 0, laneId });
  }
  const environment = automationV3LaneEnvironment(baseEnvironment, laneId);
  const runOnce = dependencies.runOnce ?? runAutomationV3Once;
  const result = await runOnce({
    environment,
    laneId,
    leaseMilliseconds: SCHEDULED_WORKER_LEASE_MILLISECONDS,
    retainLease: true,
  });
  return Object.freeze({ ...result, laneId });
}
