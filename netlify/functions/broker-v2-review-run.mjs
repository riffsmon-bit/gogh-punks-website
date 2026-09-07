import { getDatabase } from "@netlify/database";
import { createPublicClient, http } from "viem";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { normalizePunkCollectingIntent } from "../../broker/src/v4/collecting-intent.mjs";
import { normalizeV2Opportunity } from "../../broker/src/v4/opportunity.mjs";
import { matchV2Opportunity } from "../../broker/src/v4/policy-matcher.mjs";
import { simulateOwnerAssistedSeaDropMint } from
  "../../broker/src/v4/owner-assisted-seadrop-mint.mjs";
import { getRpcUrl } from "./_shared/config.mjs";
import { PublicError, json, readJson } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2DeployPreview } from "./_shared/v2-review.mjs";

const OWNER = /^0x[0-9a-f]{40}$/;
const TOKEN = /^(?:0|[1-9]\d{0,3})$/;

function requestBody(value) {
  const fields = ["intent", "owner", "testMode", "tokenId"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((field) => !fields.includes(field))
    || !["intent", "owner", "tokenId"].every((field) => Object.hasOwn(value, field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The review-agent run request is invalid.");
  }
  const owner = typeof value.owner === "string" ? value.owner.toLowerCase() : "";
  const tokenId = String(value.tokenId ?? "");
  if (!OWNER.test(owner) || !TOKEN.test(tokenId) || !value.intent
    || typeof value.intent !== "object" || Array.isArray(value.intent)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose an owned Punk and confirmed strategy.");
  }
  const testMode = Object.hasOwn(value, "testMode") ? value.testMode : null;
  if (testMode !== null && testMode !== "SAFE_FIXTURE") {
    throw new PublicError(400, "INVALID_REQUEST", "The review test mode is invalid.");
  }
  return Object.freeze({ owner, tokenId, intent: value.intent, testMode });
}

function previewTestOpportunity(punkWallet, now) {
  return normalizeV2Opportunity({
    schema: "GOGH_NORMALIZED_OPPORTUNITY_V2", version: 2,
    opportunityId: "preview_test:pixel_study:public", chainId: ROBINHOOD.chainId,
    collectionContract: "0x000000000000000000000000000000000000f001",
    mintContract: "0x000000000000000000000000000000000000f002",
    adapter: "0x000000000000000000000000000000000000a001",
    mintStage: "PREVIEW_TEST", mintMethod: "mintPreviewTest(address,uint256)",
    priceWei: "0", estimatedGasCostWei: "100000000000000", supply: 777, walletLimit: 1,
    startTime: new Date(new Date(now).getTime() - 60_000).toISOString(),
    endTime: new Date(new Date(now).getTime() + 86_400_000).toISOString(),
    website: "https://goghpunks.xyz", socialUrls: {
      x: "https://x.com/goghpunks", discord: null, farcaster: null,
    },
    sourceUrls: ["https://goghpunks.xyz"], artStyles: ["PIXEL_ART", "EXPERIMENTAL"],
    imageReference: null, collectionName: "PREVIEW TEST · PIXEL STUDY",
    contractCodeHash: `0x${"11".repeat(32)}`, adapterCodeHash: `0x${"22".repeat(32)}`,
    screeningStatus: "PASSED", simulationStatus: "PASSED", riskLevel: "LOW", riskScore: 1,
    expectedNftReceiver: punkWallet, unexpectedApprovals: false, unexpectedTransfers: false,
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
  }, now);
}

function opportunityForPunk(row, punkWallet, now) {
  const normalized = normalizeV2Opportunity(row.normalized, now);
  const receiver = typeof row.expected_receiver === "string"
    ? row.expected_receiver.toLowerCase() : null;
  const gas = String(row.gas_estimate ?? "");
  if (row.simulation_status !== "PASSED" || receiver !== punkWallet
    || !/^(?:0|[1-9][0-9]{0,77})$/.test(gas)) return normalized;
  return normalizeV2Opportunity({ ...normalized, simulationStatus: "PASSED",
    estimatedGasCostWei: gas, expectedNftReceiver: receiver }, now);
}

export async function handleV2ReviewRun(request, { readAuthority = readV2PunkAuthority,
  pool = getDatabase().pool, now = new Date(), client = null,
  simulateOpportunity = simulateOwnerAssistedSeaDropMint } = {}) {
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
      pool.query(`SELECT opportunity.normalized, simulation.status AS simulation_status,
          simulation.gas_estimate::text AS gas_estimate,
          simulation.expected_receiver
        FROM broker_v2_opportunities opportunity
        LEFT JOIN LATERAL (SELECT status, gas_estimate, expected_receiver
          FROM broker_v2_simulations WHERE opportunity_id = opportunity.opportunity_id
            AND punk_account = $3 AND simulated_at >= opportunity.updated_at
          ORDER BY simulated_at DESC LIMIT 1) simulation ON TRUE
        WHERE opportunity.chain_id = $1
          AND (opportunity.expires_at IS NULL OR opportunity.expires_at > $2)
        ORDER BY opportunity.updated_at DESC LIMIT 100`,
      [ROBINHOOD.chainId, new Date(now).toISOString(), authority.punkWallet]),
    ]);
    const counts = new Map(opportunityUsageResult.rows.map((row) => (
      [row.opportunity_id, Number(row.count)])));
    const usage = activityResult.rows[0] ?? {};
    const simulationClient = () => client ?? createPublicClient({
      transport: http(getRpcUrl(), { timeout: 10_000, retryCount: 1 }),
    });
    const opportunities = [];
    let liveSimulationCount = 0;
    for (const row of opportunityResult.rows) {
      let opportunity = opportunityForPunk(row, authority.punkWallet, now);
      if (opportunity.screeningStatus === "PASSED" && opportunity.simulationStatus !== "PASSED"
        && liveSimulationCount < 3) {
        liveSimulationCount += 1;
        try {
          const simulated = await simulateOpportunity({ client: simulationClient(), authority,
            opportunity, now });
          opportunity = normalizeV2Opportunity({ ...opportunity,
            simulationStatus: "PASSED",
            estimatedGasCostWei: simulated.evidence.estimatedGasWei,
            expectedNftReceiver: authority.punkWallet,
            updatedAt: new Date(now).toISOString() }, now);
          await pool.query(`INSERT INTO broker_v2_simulations
            (opportunity_id, punk_account, input_hash, pinned_block, status, gas_estimate,
             expected_receiver, effects, simulated_at)
            VALUES ($1, $2, $3, $4::numeric, 'PASSED', $5::numeric, $2, $6::jsonb, $7)
            ON CONFLICT (opportunity_id, punk_account, input_hash) DO NOTHING`,
          [opportunity.opportunityId, authority.punkWallet, simulated.evidence.inputHash,
            simulated.evidence.pinnedBlock, simulated.evidence.estimatedGasWei,
            JSON.stringify({ expectedTokenId: simulated.evidence.expectedTokenId,
              quantity: 1, mintPriceWei: "0", callDidNotRevert: true,
              effectTraceAvailable: false, postconditionPendingReceipt: true,
              ownerApprovalRequired: true }), simulated.evidence.simulatedAt]);
        } catch { /* One unsafe or unavailable candidate cannot stop the bounded review pass. */ }
      }
      opportunities.push(Object.freeze({ opportunity, previewFixture: false }));
    }
    if (body.testMode === "SAFE_FIXTURE") opportunities.unshift(Object.freeze({
      opportunity: previewTestOpportunity(authority.punkWallet, now), previewFixture: true,
    }));
    const matches = opportunities.map(({ opportunity, previewFixture }) => {
      const match = matchV2Opportunity(intent, opportunity, {
        currentOwner: authority.owner, punkWallet: authority.punkWallet,
        punkWalletBalanceWei: authority.nativeBalanceWei,
        dailyMints: Number(usage.daily ?? 0), totalMints: Number(usage.total ?? 0),
        opportunityMints: counts.get(opportunity.opportunityId) ?? 0,
      }, now);
      return Object.freeze({ opportunity, match, previewFixture });
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
      testMode: body.testMode, testOpportunityCount: matches.filter((item) => item.previewFixture).length,
      opportunities: ordered.slice(0, 20),
      transactionPrepared: false, executionAttemptCreated: false });
  } catch (error) { return v2Failure(error); }
}

export default handleV2ReviewRun;

export const config = { path: "/api/v2/review/run", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 20, windowSize: 60,
} };
