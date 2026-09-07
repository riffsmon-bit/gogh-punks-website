import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { matchV2Opportunity } from "../../broker/src/v4/policy-matcher.mjs";
import { normalizePunkCollectingIntent } from "../../broker/src/v4/collecting-intent.mjs";
import { normalizeV2Opportunity } from "../../broker/src/v4/opportunity.mjs";
import { PublicError, json } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

function tokenId(value) {
  if (value === null) return null;
  if (!/^(?:0|[1-9]\d{0,3})$/.test(value)) throw new PublicError(400, "INVALID_TOKEN_ID", "Choose a valid Gogh Punk.");
  return value;
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    const session = await requireV2Session(request, pool);
    const selected = tokenId(new URL(request.url).searchParams.get("tokenId"));
    let strategy = null; let authority = null; let state = null;
    if (selected) {
      authority = await readV2PunkAuthority(selected, { expectedOwner: session.walletAddress });
      const [strategyResult, usageResult, opportunityUsageResult] = await Promise.all([
        pool.query(`SELECT intent FROM broker_v2_strategies WHERE chain_id = $1
          AND collection_address = $2 AND token_id = $3::numeric AND state = 'ACTIVE'
          AND expires_at > NOW() ORDER BY version DESC LIMIT 1`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, selected]),
        pool.query(`SELECT COUNT(*) FILTER (WHERE occurred_at >=
            date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS daily,
            COUNT(*)::integer AS total FROM broker_v2_activity WHERE chain_id = $1
              AND punk_token_id = $2::numeric AND activity_type = 'COLLECTED'`,
        [ROBINHOOD.chainId, selected]),
        pool.query(`SELECT opportunity_id, COUNT(*)::integer AS count FROM broker_v2_activity
          WHERE chain_id = $1 AND punk_token_id = $2::numeric AND activity_type = 'COLLECTED'
            AND opportunity_id IS NOT NULL GROUP BY opportunity_id`, [ROBINHOOD.chainId, selected]),
      ]);
      strategy = strategyResult.rows[0]?.intent
        ? normalizePunkCollectingIntent(strategyResult.rows[0].intent) : null;
      state = { currentOwner: authority.owner, punkWallet: authority.punkWallet,
        punkWalletBalanceWei: authority.nativeBalanceWei,
        dailyMints: Number(usageResult.rows[0]?.daily ?? 0),
        totalMints: Number(usageResult.rows[0]?.total ?? 0),
        opportunityMints: new Map(opportunityUsageResult.rows.map((row) => (
          [row.opportunity_id, Number(row.count)]))) };
    }
    const result = await pool.query(`SELECT normalized FROM broker_v2_opportunities
      WHERE chain_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY updated_at DESC LIMIT 100`, [ROBINHOOD.chainId]);
    const opportunities = result.rows.map(({ normalized }) => {
      const opportunity = normalizeV2Opportunity(normalized);
      const matchState = state ? { ...state,
        opportunityMints: state.opportunityMints.get(opportunity.opportunityId) ?? 0 } : null;
      return { opportunity, match: strategy ? matchV2Opportunity(strategy, opportunity, matchState) : null };
    });
    return json({ ok: true, tokenId: selected, opportunities,
      deterministicPolicyMatching: Boolean(strategy), aiUsedForMatching: false });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/opportunities", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
} };
