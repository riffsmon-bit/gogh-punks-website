import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { normalizePunkCollectingIntent } from "../../broker/src/v4/collecting-intent.mjs";
import { normalizeV2Opportunity } from "../../broker/src/v4/opportunity.mjs";
import { matchV2Opportunity } from "../../broker/src/v4/policy-matcher.mjs";
import { PublicError, json, readJson } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2DeployPreview } from "./_shared/v2-review.mjs";

const OWNER = /^0x[0-9a-f]{40}$/;
const TOKEN = /^(?:0|[1-9]\d{0,3})$/;

function requestBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 3
    || !["intent", "owner", "tokenId"].every((field) => Object.hasOwn(value, field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The review-agent run request is invalid.");
  }
  const owner = typeof value.owner === "string" ? value.owner.toLowerCase() : "";
  const tokenId = String(value.tokenId ?? "");
  if (!OWNER.test(owner) || !TOKEN.test(tokenId) || !value.intent
    || typeof value.intent !== "object" || Array.isArray(value.intent)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose an owned Punk and confirmed strategy.");
  }
  return Object.freeze({ owner, tokenId, intent: value.intent });
}

export async function handleV2ReviewRun(request, { readAuthority = readV2PunkAuthority,
  pool = getDatabase().pool, now = new Date() } = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    requireV2DeployPreview(request);
    const body = requestBody(await readJson(request, 20_000));
    const authority = await readAuthority(body.tokenId, { expectedOwner: body.owner });
    let intent;
    try { intent = normalizePunkCollectingIntent(body.intent, now); }
    catch { throw new PublicError(400, "INVALID_STRATEGY", "The confirmed review strategy is invalid."); }
    if (intent.punkTokenId !== body.tokenId || intent.expectedOwner !== body.owner
      || intent.punkWallet !== authority.punkWallet
      || !["ASK", "ASSIST"].includes(intent.operatingMode)) {
      throw new PublicError(400, "STRATEGY_AUTHORITY_MISMATCH",
        "The strategy does not match the selected Punk and current owner.");
    }
    const [activityResult, opportunityUsageResult, opportunityResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FILTER (WHERE occurred_at >=
          date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS daily,
          COUNT(*)::integer AS total FROM broker_v2_activity WHERE chain_id = $1
            AND punk_token_id = $2::numeric AND activity_type = 'COLLECTED'`,
      [ROBINHOOD.chainId, body.tokenId]),
      pool.query(`SELECT opportunity_id, COUNT(*)::integer AS count FROM broker_v2_activity
        WHERE chain_id = $1 AND punk_token_id = $2::numeric AND activity_type = 'COLLECTED'
          AND opportunity_id IS NOT NULL GROUP BY opportunity_id`,
      [ROBINHOOD.chainId, body.tokenId]),
      pool.query(`SELECT normalized FROM broker_v2_opportunities WHERE chain_id = $1
        AND (expires_at IS NULL OR expires_at > $2) ORDER BY updated_at DESC LIMIT 100`,
      [ROBINHOOD.chainId, new Date(now).toISOString()]),
    ]);
    const counts = new Map(opportunityUsageResult.rows.map((row) => (
      [row.opportunity_id, Number(row.count)])));
    const usage = activityResult.rows[0] ?? {};
    const matches = opportunityResult.rows.map(({ normalized }) => {
      const opportunity = normalizeV2Opportunity(normalized, now);
      const match = matchV2Opportunity(intent, opportunity, {
        currentOwner: authority.owner, punkWallet: authority.punkWallet,
        punkWalletBalanceWei: authority.nativeBalanceWei,
        dailyMints: Number(usage.daily ?? 0), totalMints: Number(usage.total ?? 0),
        opportunityMints: counts.get(opportunity.opportunityId) ?? 0,
      }, now);
      return Object.freeze({ opportunity, match });
    });
    const eligible = matches.filter(({ match }) => match.recommendationEligible);
    const screeningPassedCount = matches.filter(({ opportunity }) => (
      opportunity.screeningStatus === "PASSED")).length;
    const simulationPassedCount = matches.filter(({ opportunity }) => (
      opportunity.simulationStatus === "PASSED")).length;
    const ordered = [...eligible, ...matches.filter(({ match }) => !match.recommendationEligible)];
    return json({ ok: true, reviewOnly: true, authority: "NONE", tokenId: body.tokenId,
      checkedAt: new Date(now).toISOString(), checkedCount: matches.length,
      eligibleCount: eligible.length, screeningPassedCount, simulationPassedCount,
      opportunities: ordered.slice(0, 20),
      transactionPrepared: false, executionAttemptCreated: false });
  } catch (error) { return v2Failure(error); }
}

export default handleV2ReviewRun;

export const config = { path: "/api/v2/review/run", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 20, windowSize: 60,
} };
