import { createGoghIntelligenceRuntime } from "../../broker/src/v4/ai/runtime.mjs";
import { json } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const runtime = createGoghIntelligenceRuntime();
    const providers = await Promise.all(runtime.registry.enabled().map(async (entry) => ({
      registryKey: entry.registryKey, provider: entry.provider, displayName: entry.displayName,
      capabilities: entry.capabilities, costTier: entry.costTier, speedTier: entry.speedTier,
      health: await runtime.providers[entry.registryKey].healthCheck(),
    })));
    return json({ ok: true, default: "AUTO", providers,
      unavailableMessage: "Gogh Intelligence temporarily unavailable. Existing safety rules remain active.",
      modelIdsExposed: false });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/providers", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 120, windowSize: 60,
} };
