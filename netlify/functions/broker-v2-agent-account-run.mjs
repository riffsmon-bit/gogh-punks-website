import { getDatabase } from "@netlify/database";
import { PublicError, json, readJson } from "./_shared/http.mjs";
import { requireV2DeployPreview } from "./_shared/v2-review.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { v2TokenIdFrom } from "./_shared/v2-route.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { runScheduledPunkAgentWorker } from "./broker-punk-agent-worker.mjs";

// One owner-requested check of an already authorized mission. Never creates or
// broadens a session. The scheduled worker retains its on-chain and receipt gates.
export async function handleV2AgentAccountRun(request, { pool = getDatabase().pool,
  environment = process.env, requireSession = requireV2Session,
  readAuthority = readV2PunkAuthority, run = runScheduledPunkAgentWorker, now = new Date(),
} = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    requireV2DeployPreview(request);
    if (environment.PUNK_AGENT_PREVIEW_RUN_ENABLED !== "true") throw new PublicError(409,
      "PREVIEW_RUN_DISABLED", "Manual mission checks are not enabled on this preview.");
    const tokenId = v2TokenIdFrom(request, "/agent-account/run");
    const session = await requireSession(request, pool, now);
    await readAuthority(tokenId, { expectedOwner: session.walletAddress });
    const body = await readJson(request, 1_024);
    if (!body || typeof body !== "object" || Object.keys(body).length !== 1
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.sessionId ?? "")) {
      throw new PublicError(400, "INVALID_REQUEST", "Refresh the active mission before checking it.");
    }
    const result = await pool.query(`SELECT session_id FROM broker_v2_agent_sessions
      WHERE session_id = $1::uuid AND chain_id = 4663 AND punk_token_id = $2::numeric
        AND owner_snapshot = $3 AND status = 'ACTIVE'
        AND authorization_transaction_hash IS NOT NULL
        AND valid_after <= $4 AND valid_until > $4 LIMIT 1`,
    [body.sessionId, tokenId, session.walletAddress, new Date(now).toISOString()]);
    if (!result.rows[0]) throw new PublicError(409, "AGENT_MISSION_NOT_ACTIVE",
      "This owner-approved mission is no longer active. Refresh its status.");
    const outcome = await run({ pool, environment, now,
      missionScope: { tokenId, owner: session.walletAddress, sessionId: body.sessionId } });
    return json({ ok: true, tokenId, sessionId: body.sessionId, status: outcome.status,
      submitted: outcome.submitted === true, userOpHash: outcome.userOpHash ?? null,
      reconciliationStatus: outcome.reconciliation?.status ?? null }, 200,
    { "cache-control": "private, no-store", "netlify-cdn-cache-control": "no-store" });
  } catch (error) { return v2Failure(error); }
}

export default handleV2AgentAccountRun;
export const config = { path: "/api/v2/punks/:tokenId/agent-account/run", method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 3, windowSize: 60 } };
