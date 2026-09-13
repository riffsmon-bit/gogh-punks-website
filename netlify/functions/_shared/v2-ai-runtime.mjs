import { createHash } from "node:crypto";
import { ArtBrokerProviderError, assertProviderTask } from "../../../broker/src/v4/ai/provider.mjs";
import { createGoghIntelligenceRuntime } from "../../../broker/src/v4/ai/runtime.mjs";

const registryInitializations = new WeakMap();

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
  const registry = createGoghIntelligenceRuntime({ environment, fetchImpl }).registry;
  const registryKey = createHash("sha256").update(JSON.stringify(registry.enabled())).digest("hex");
  const ensureRegistry = async () => {
    const cached = registryInitializations.get(pool);
    if (cached?.key === registryKey) return cached.promise;
    const promise = (async () => {
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
    })();
    registryInitializations.set(pool, { key: registryKey, promise });
    try { await promise; } catch (error) {
      if (registryInitializations.get(pool)?.promise === promise) registryInitializations.delete(pool);
      throw error;
    }
  };
  const validate = value => {
    if (typeof value.ownerFingerprint !== "string" || !value.ownerFingerprint.trim()
      || value.ownerFingerprint.length > 160 || typeof value.punkTokenId !== "string" || !/^(?:0|[1-9]\d{0,77})$/.test(value.punkTokenId)) {
      throw new TypeError("AI quota identity is invalid");
    }
    assertProviderTask(value.task);
    const entry = registry.get(value.registryKey);
    if (!entry || entry.provider !== value.provider) throw new TypeError("AI quota model is invalid");
    return { entry, owner: fingerprint(value.ownerFingerprint) };
  };
  const quota = {
    async consume(value) {
      const { owner } = validate(value);
      await ensureRegistry();
      const client = await pool.connect();
      try {
        // A fresh READ COMMITTED snapshot after acquiring the owner lock sees all
        // earlier committed reservations, including other Punks and model fallbacks.
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await client.query("SET LOCAL lock_timeout = '2000ms'");
        await client.query("SET LOCAL statement_timeout = '3000ms'");
        const lock = BigInt.asIntN(64, BigInt(`0x${owner}`)).toString();
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [lock]);
        const result = await client.query(`SELECT COUNT(*)::integer AS owner_requests,
          COUNT(*) FILTER (WHERE punk_token_id = $2::numeric)::integer AS punk_requests
          FROM broker_v2_provider_usage WHERE owner_fingerprint = $1
            AND occurred_at >= NOW() - INTERVAL '24 hours'`, [owner, value.punkTokenId]);
        if (Number(result.rows[0]?.owner_requests ?? 0) >= 100
          || Number(result.rows[0]?.punk_requests ?? 0) >= 25) {
          await client.query("COMMIT"); return false;
        }
        const reserved = await client.query(`INSERT INTO broker_v2_provider_usage
          (owner_fingerprint, punk_token_id, provider, model_registry_key, task, result_code, occurred_at)
          VALUES ($1, $2::numeric, $3, $4, $5, 'RESERVED', NOW()) RETURNING usage_id`,
        [owner, value.punkTokenId, value.provider, value.registryKey, value.task]);
        await client.query("COMMIT");
        return reserved.rows[0].usage_id;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
  };
  const usage = {
    async record(value) {
      const { entry, owner } = validate(value);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.reservationId)) {
        throw new TypeError("AI usage reservation is invalid");
      }
      const resultCode = String(value.resultCode ?? "UNKNOWN").replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
      if (resultCode === "RESERVED") throw new TypeError("AI usage outcome is invalid");
      const updated = await pool.query(`UPDATE broker_v2_provider_usage SET
        input_tokens = $7, output_tokens = $8, estimated_cost_microusd = $9,
        cache_hit = $10, latency_ms = $11, result_code = $12
        WHERE usage_id = $1::uuid AND owner_fingerprint = $2 AND punk_token_id = $3::numeric
          AND provider = $4 AND model_registry_key = $5 AND task = $6 AND result_code = 'RESERVED'
        RETURNING usage_id`, [value.reservationId, owner, value.punkTokenId, value.provider,
        value.registryKey, value.task, value.usage?.inputTokens ?? null,
        value.usage?.outputTokens ?? null, estimateV2ProviderCostMicrousd(entry, value.usage),
        value.cacheHit === true, value.latencyMs ?? null, resultCode]);
      if (updated.rows.length !== 1) throw new ArtBrokerProviderError("AI_USAGE_RESERVATION_MISMATCH",
        "The intelligence usage record could not be confirmed.");
    },
  };
  return createGoghIntelligenceRuntime({ environment, fetchImpl, quota, usage });
}
