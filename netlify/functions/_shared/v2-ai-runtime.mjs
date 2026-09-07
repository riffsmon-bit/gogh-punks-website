import { createHash } from "node:crypto";
import { createGoghIntelligenceRuntime } from "../../../broker/src/v4/ai/runtime.mjs";

function fingerprint(value) {
  return createHash("sha256").update(String(value ?? "").toLowerCase()).digest("hex").slice(0, 16);
}

export function estimateV2ProviderCostMicrousd(entry, usage) {
  if (!entry || !usage || entry.inputCostMicrousdPerMillionTokens === null
    || entry.outputCostMicrousdPerMillionTokens === null
    || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens)) return null;
  const numerator = BigInt(usage.inputTokens) * BigInt(entry.inputCostMicrousdPerMillionTokens)
    + BigInt(usage.outputTokens) * BigInt(entry.outputCostMicrousdPerMillionTokens);
  const roundedUp = (numerator + 999_999n) / 1_000_000n;
  return roundedUp <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(roundedUp) : null;
}

export function createDatabaseBackedGoghIntelligence(pool, environment = process.env,
  fetchImpl = fetch) {
  const quota = {
    async consume({ ownerFingerprint, punkTokenId }) {
      const owner = fingerprint(ownerFingerprint);
      const result = await pool.query(`SELECT
        COUNT(*) FILTER (WHERE owner_fingerprint = $1)::integer AS owner_requests,
        COUNT(*) FILTER (WHERE owner_fingerprint = $1 AND punk_token_id = $2::numeric)::integer AS punk_requests
        FROM broker_v2_provider_usage WHERE occurred_at >= NOW() - INTERVAL '24 hours'`,
      [owner, punkTokenId]);
      return Number(result.rows[0]?.owner_requests ?? 0) < 100
        && Number(result.rows[0]?.punk_requests ?? 0) < 25;
    },
  };
  const registry = createGoghIntelligenceRuntime({ environment, fetchImpl }).registry;
  let initialized = false;
  const ensureRegistry = async () => {
    if (initialized) return;
    for (const entry of registry.enabled()) {
      await pool.query(`INSERT INTO broker_v2_model_registry
        (registry_key, provider, model_id, display_name, capabilities, cost_tier,
         speed_tier, enabled, fallback_priority, input_cost_microusd_per_million_tokens,
         output_cost_microusd_per_million_tokens)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, TRUE, $8, $9, $10)
        ON CONFLICT (registry_key) DO UPDATE SET model_id = EXCLUDED.model_id,
          display_name = EXCLUDED.display_name, capabilities = EXCLUDED.capabilities,
          cost_tier = EXCLUDED.cost_tier, speed_tier = EXCLUDED.speed_tier,
          enabled = EXCLUDED.enabled, fallback_priority = EXCLUDED.fallback_priority,
          input_cost_microusd_per_million_tokens = EXCLUDED.input_cost_microusd_per_million_tokens,
          output_cost_microusd_per_million_tokens = EXCLUDED.output_cost_microusd_per_million_tokens,
          updated_at = NOW()`, [entry.registryKey, entry.provider, entry.modelId,
        entry.displayName, JSON.stringify(entry.capabilities), entry.costTier, entry.speedTier,
        entry.fallbackPriority, entry.inputCostMicrousdPerMillionTokens,
        entry.outputCostMicrousdPerMillionTokens]);
    }
    initialized = true;
  };
  const usage = {
    async record(value) {
      await ensureRegistry();
      if (!value.registryKey || !registry.get(value.registryKey)) return;
      const entry = registry.get(value.registryKey);
      await pool.query(`INSERT INTO broker_v2_provider_usage
        (owner_fingerprint, punk_token_id, provider, model_registry_key, task,
         input_tokens, output_tokens, estimated_cost_microusd, cache_hit, latency_ms,
         result_code, occurred_at)
        VALUES ($1, $2::numeric, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [fingerprint(value.ownerFingerprint), value.punkTokenId, value.provider,
        value.registryKey, value.task, value.usage?.inputTokens ?? null,
        value.usage?.outputTokens ?? null, estimateV2ProviderCostMicrousd(entry, value.usage),
        value.cacheHit === true, value.latencyMs ?? null,
        String(value.resultCode ?? "UNKNOWN").replace(/[^A-Z0-9_]/g, "_").slice(0, 64)]);
    },
  };
  return createGoghIntelligenceRuntime({ environment, fetchImpl, quota, usage });
}
