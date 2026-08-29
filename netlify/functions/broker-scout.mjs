import { runBrokerScout } from "../../scripts/run-broker-scout.mjs";
import {
  backgroundRpcDecision, logBackgroundRpcSkip,
} from "./_shared/background-rpc-policy.mjs";

export default async function handler() {
  const decision = backgroundRpcDecision(process.env, "BROKER_SCOUT");
  if (!decision.enabled) {
    logBackgroundRpcSkip(decision);
    return;
  }
  if (process.env.BROKER_SCOUT_ENABLED !== "true") {
    console.log(JSON.stringify({ event: "BROKER_SCOUT_SKIPPED", reason: "DISABLED" }));
    return;
  }
  try {
    const result = await runBrokerScout();
    console.log(JSON.stringify({ event: "BROKER_SCOUT_REFRESH", ...result }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "BROKER_SCOUT_ERROR",
      type: error?.name ?? "Error",
      message: String(error?.message ?? "Scout refresh failed").slice(0, 300),
    }));
    throw error;
  }
}

export const config = { schedule: "1-59/5 * * * *" };
