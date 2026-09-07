import { getDatabase } from "@netlify/database";
import { PublicError, json, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

export default async function handler(request) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    requireSameOrigin(request);
    const session = await requireV2Session(request, pool);
    const body = await readJson(request, 8_192);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 2 || !/^(?:0|[1-9]\d{0,3})$/.test(body.tokenId)
      || !/^[a-zA-Z0-9:_-]{8,256}$/.test(body.opportunityId)) {
      throw new PublicError(400, "INVALID_REQUEST", "The simulation request is invalid.");
    }
    const authority = await readV2PunkAuthority(body.tokenId, { expectedOwner: session.walletAddress });
    const result = await pool.query(`SELECT status, gas_estimate, expected_receiver, effects,
        pinned_block, simulated_at FROM broker_v2_simulations
      WHERE opportunity_id = $1 AND punk_account = $2 ORDER BY simulated_at DESC LIMIT 1`,
    [body.opportunityId, authority.punkWallet]);
    if (!result.rows[0]) throw new PublicError(409, "KNOWN_SAFE_ADAPTER_REQUIRED",
      "No Punk-specific known-safe simulation exists. External website calldata was not accepted.");
    const row = result.rows[0];
    return json({ ok: true, opportunityId: body.opportunityId, tokenId: body.tokenId,
      simulation: { status: row.status, gasEstimateWei: row.gas_estimate ? String(row.gas_estimate) : null,
        expectedReceiver: row.expected_receiver, effects: row.effects,
        pinnedBlock: String(row.pinned_block), simulatedAt: new Date(row.simulated_at).toISOString() },
      transactionPrepared: false, transactionSubmitted: false });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/simulate", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 20, windowSize: 60,
} };
