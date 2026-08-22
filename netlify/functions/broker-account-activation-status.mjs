import coreManifest from "../../deployments/robinhood.json" with { type: "json" };
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { CURRENT_BROKER_DEPLOYMENT_SURFACE } from
  "./_shared/broker-deployment-surface.mjs";
import { json } from "./_shared/http.mjs";

const ZERO_HASH = `0x${"00".repeat(32)}`;

export function accountActivationSnapshot(surface = CURRENT_BROKER_DEPLOYMENT_SURFACE,
  manifest = coreManifest) {
  if (surface?.deploymentStatus !== "DEPLOYED") {
    return Object.freeze({
      status: "NOT_DEPLOYED",
      capability: false,
      reason: surface?.reason ?? "CORE_MANIFEST_NOT_DEPLOYED",
      bindings: null,
    });
  }
  const registry = manifest.contracts.GoghPunkAccountRegistry;
  const implementation = manifest.contracts.GoghPunkAccountV1;
  return Object.freeze({
    status: "READY_FOR_OWNER_ACTIVATION_CHECK",
    capability: true,
    reason: null,
    bindings: Object.freeze({
      chainId: ROBINHOOD.chainId,
      punkCollection: ROBINHOOD.canonicalCollection,
      accountRegistry: surface.accountRegistry,
      accountRegistryRuntimeCodeHash: registry.runtimeBytecodeHash,
      accountImplementation: surface.accountImplementation,
      accountImplementationRuntimeCodeHash: implementation.runtimeBytecodeHash,
      canonicalERC6551Registry: ROBINHOOD.canonicalERC6551Registry,
      canonicalERC6551RegistryRuntimeCodeHash:
        ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash,
      accountSalt: ZERO_HASH,
    }),
  });
}

export default function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  return json({
    ok: true,
    activationGate: accountActivationSnapshot(),
    authorityGranted: false,
    autonomyStatus: "DISABLED",
  }, 200, {
    "cache-control": "no-store, max-age=0",
    "netlify-cdn-cache-control": "no-store",
  });
}

export const config = {
  path: "/api/broker/account-activation-status",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 120,
    windowSize: 60,
  },
};
