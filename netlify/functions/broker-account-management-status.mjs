import { CURRENT_BROKER_DEPLOYMENT_SURFACE } from
  "./_shared/broker-deployment-surface.mjs";
import { json } from "./_shared/http.mjs";

export function accountManagementSnapshot(surface) {
  if (surface?.deploymentStatus !== "DEPLOYED" || surface?.canaryStatus !== "DEPLOYED"
    || !surface.canary) {
    return Object.freeze({
      status: "NOT_DEPLOYED",
      capability: false,
      reason: surface?.reason ?? "DEPLOYMENT_MANIFESTS_NOT_READY",
      bindings: null,
    });
  }
  return Object.freeze({
    status: "READY_FOR_LIVE_OWNER_CHECK",
    capability: true,
    reason: null,
    bindings: Object.freeze({
      chainId: surface.canary.chainId,
      expectedOwner: surface.canary.expectedOwner,
      account: surface.canary.account,
      accountRuntimeCodeHash: surface.canary.accountRuntimeCodeHash,
      punkCollection: surface.canary.punkCollection,
      punkTokenId: surface.canary.punkTokenId,
    }),
  });
}

export default function handler(request) {
  if (request.method !== "GET") {
    return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  }
  return json({
    ok: true,
    managementGate: accountManagementSnapshot(CURRENT_BROKER_DEPLOYMENT_SURFACE),
    autonomyStatus: "DISABLED",
  }, 200, {
    "cache-control": "no-store, max-age=0",
    "netlify-cdn-cache-control": "no-store",
  });
}

export const config = {
  path: "/api/broker/account-management-status",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 120,
    windowSize: 60,
  },
};
