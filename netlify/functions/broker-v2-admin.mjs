import { getDatabase } from "@netlify/database";
import { json } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { verifyAdminBearer } from "./_shared/v2-session.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    verifyAdminBearer(request);
    const [opportunities, strategies, usage, attempts] = await Promise.all([
      pool.query(`SELECT COUNT(*)::integer AS discovered,
          COUNT(*) FILTER (WHERE screening_status = 'PASSED')::integer AS screened,
          COUNT(*) FILTER (WHERE screening_status = 'BLOCKED')::integer AS blocked
        FROM broker_v2_opportunities`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE state = 'ACTIVE')::integer AS active,
          COUNT(DISTINCT token_id) FILTER (WHERE state = 'ACTIVE')::integer AS funded_candidates
        FROM broker_v2_strategies`),
      pool.query(`SELECT provider, COUNT(*)::integer AS calls,
          COALESCE(SUM(input_tokens), 0)::bigint::text AS input_tokens,
          COALESCE(SUM(output_tokens), 0)::bigint::text AS output_tokens,
          COALESCE(SUM(estimated_cost_microusd), 0)::bigint::text AS estimated_cost_microusd,
          COUNT(*) FILTER (WHERE cache_hit)::integer AS cache_hits
        FROM broker_v2_provider_usage GROUP BY provider ORDER BY provider`),
      pool.query(`SELECT COUNT(*)::integer AS attempts,
          COUNT(*) FILTER (WHERE state = 'CONFIRMED')::integer AS successful,
          COUNT(*) FILTER (WHERE state IN ('REVERTED', 'REJECTED'))::integer AS failed,
          COUNT(*) FILTER (WHERE state = 'RECONCILIATION_REQUIRED')::integer AS reconcile
        FROM broker_v2_execution_attempts`),
    ]);
    return json({ ok: true, privacy: "AGGREGATED_ONLY",
      opportunities: opportunities.rows[0], strategies: strategies.rows[0],
      providerUsage: usage.rows, execution: attempts.rows[0],
      executor: { productionSubmissionEnabled: false,
        blocker: "SELF_FUNDED_AUTONOMOUS_GAS_UNSUPPORTED_BY_DEPLOYED_ACCOUNT" } });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/admin", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
} };
