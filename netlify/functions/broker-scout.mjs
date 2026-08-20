import { runBrokerScout } from "../../scripts/run-broker-scout.mjs";

export default async function handler() {
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
