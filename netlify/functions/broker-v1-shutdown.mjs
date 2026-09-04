import { brokerMigrationState } from "./_shared/broker-migration-state.mjs";
import { finalizeV1Retirement } from "./_shared/v1-retirement-finalizer.mjs";

export default async function handler() {
  const lifecycle = brokerMigrationState(process.env);
  if (!lifecycle.cutoffReached) {
    console.log(JSON.stringify({ event: "BROKER_V1_SHUTDOWN_PENDING",
      shutdownAt: lifecycle.shutdownAt }));
    return;
  }
  const result = await finalizeV1Retirement();
  console.log(JSON.stringify({ event: "BROKER_V1_SHUTDOWN", ...result }));
}

// Repetition is intentional: the server-side cutoff is authoritative and finalization is
// idempotent, so a missed exact-minute invocation converges on the next scheduled run.
export const config = { schedule: "* * * * *" };
