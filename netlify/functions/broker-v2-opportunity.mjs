import { getDatabase } from "@netlify/database";
import { normalizeV2Opportunity } from "../../broker/src/v4/opportunity.mjs";
import { PublicError, json } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    await requireV2Session(request, pool);
    const id = decodeURIComponent(new URL(request.url).pathname.slice("/api/v2/opportunities/".length));
    if (!/^[a-zA-Z0-9:_-]{8,256}$/.test(id)) throw new PublicError(400, "INVALID_OPPORTUNITY_ID", "Choose a valid opportunity.");
    const [opportunity, sources, analyses, screenings, simulations] = await Promise.all([
      pool.query("SELECT normalized FROM broker_v2_opportunities WHERE opportunity_id = $1", [id]),
      pool.query(`SELECT source_kind, source_identity, source_url, discovered_at
        FROM broker_v2_opportunity_sources WHERE opportunity_id = $1 ORDER BY discovered_at`, [id]),
      pool.query(`SELECT analysis_version, art_styles, summary, provider, model_registry_key, created_at
        FROM broker_v2_opportunity_analysis WHERE opportunity_id = $1 ORDER BY analysis_version DESC LIMIT 5`, [id]),
      pool.query(`SELECT status, reasons, checked_at FROM broker_v2_security_screenings
        WHERE opportunity_id = $1 ORDER BY checked_at DESC LIMIT 5`, [id]),
      pool.query(`SELECT status, gas_estimate, expected_receiver, effects, simulated_at
        FROM broker_v2_simulations WHERE opportunity_id = $1 ORDER BY simulated_at DESC LIMIT 5`, [id]),
    ]);
    if (!opportunity.rows[0]) throw new PublicError(404, "OPPORTUNITY_NOT_FOUND", "This opportunity was not found.");
    return json({ ok: true, opportunity: normalizeV2Opportunity(opportunity.rows[0].normalized),
      sources: sources.rows, analyses: analyses.rows, screenings: screenings.rows,
      simulations: simulations.rows, externalTransactionAuthorized: false });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/opportunities/:opportunityId", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
} };
