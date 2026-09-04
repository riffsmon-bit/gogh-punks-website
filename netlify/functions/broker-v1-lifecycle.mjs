import { brokerMigrationState } from "./_shared/broker-migration-state.mjs";
import { json } from "./_shared/http.mjs";
import { readNetlifyV1Retirement } from "./_shared/v1-retirement-finalizer.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const lifecycle = brokerMigrationState(process.env);
  let durableState = null;
  if (lifecycle.cutoffReached) {
    try { durableState = await readNetlifyV1Retirement(); } catch { durableState = null; }
  }
  const transitionComplete = durableState?.state === "V1_RETIRED"
    || lifecycle.transitionComplete;
  const publicLifecycle = Object.freeze({
    ...lifecycle,
    transitionComplete,
    transitionState: transitionComplete ? "V2_COMING_SOON"
      : lifecycle.transitionState,
    durableState,
  });
  return json({ ok: true, lifecycle: publicLifecycle }, 200, {
    "cache-control": "no-store, max-age=0",
    "netlify-cdn-cache-control": "no-store",
  });
}

export const config = {
  path: "/api/broker/v1-lifecycle",
  method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip"], windowLimit: 120, windowSize: 60 },
};
