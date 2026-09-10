import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { collectingIntentConfirmation, defaultAskIntent, normalizePunkCollectingIntent,
} from "../../broker/src/v4/collecting-intent.mjs";
import { interpretPunkCollectingIntent } from "../../broker/src/v4/ai/intent-interpreter.mjs";
import { normalizeV2Opportunity } from "../../broker/src/v4/opportunity.mjs";
import { inspectArtBrokerLink } from "../../broker/src/v4/link-scanner.mjs";
import { GoghArtBrokerMcpServer, handleArtBrokerMcpJsonRpc } from
  "../../broker/src/v4/mcp/art-broker-mcp.mjs";
import { json, readJson } from "./_shared/http.mjs";
import { createDatabaseBackedGoghIntelligence } from "./_shared/v2-ai-runtime.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

function v2McpDependencies(pool, principal) {
  const authority = (tokenId) => readV2PunkAuthority(tokenId, { expectedOwner: principal.walletAddress });
  const opportunity = async (id) => {
    const result = await pool.query("SELECT normalized FROM broker_v2_opportunities WHERE opportunity_id = $1", [id]);
    return result.rows[0] ? normalizeV2Opportunity(result.rows[0].normalized) : null;
  };
  const strategy = async (tokenId) => {
    const result = await pool.query(`SELECT version, intent_hash, intent, state, expires_at
      FROM broker_v2_strategies WHERE chain_id = $1 AND collection_address = $2
        AND token_id = $3::numeric AND state IN ('ACTIVE', 'PAUSED')
        AND configured_by = $4 AND intent->>'expectedOwner' = $4
      ORDER BY version DESC LIMIT 1`, [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, principal.walletAddress]);
    return result.rows[0] ?? null;
  };
  return {
    requireCurrentOwner: async (tokenId) => authority(tokenId),
    getMyPunks: async () => {
      const result = await pool.query(`SELECT token_id::text, account_address FROM broker_punks
        WHERE chain_id = $1 AND collection_address = $2 AND owner_snapshot = $3 ORDER BY token_id`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, principal.walletAddress]);
      const verified = [];
      for (const row of result.rows.slice(0, 256)) {
        try { const live = await authority(row.token_id); verified.push({ tokenId: row.token_id,
          punkWallet: live.punkWallet, ownershipBlock: live.blockNumber }); } catch { /* stale index */ }
      }
      return { punks: verified, indexIsAuthority: false };
    },
    get_punk: async (tokenId) => ({ authority: await authority(tokenId), strategy: await strategy(tokenId) }),
    get_punk_wallet: async (tokenId) => { const value = await authority(tokenId);
      return { tokenId, punkWallet: value.punkWallet, activated: value.activated }; },
    get_punk_balance: async (tokenId) => { const value = await authority(tokenId);
      return { tokenId, punkWallet: value.punkWallet, nativeBalanceWei: value.nativeBalanceWei,
        blockNumber: value.blockNumber }; },
    get_punk_collection: async (tokenId) => {
      const result = await pool.query(`SELECT nft_collection_address, nft_token_id::text,
          asset_amount::text, acquisition_mode, acquired_at FROM broker_acquisitions
        WHERE chain_id = $1 AND punk_collection_address = $2 AND punk_token_id = $3::numeric
        ORDER BY acquired_at DESC LIMIT 250`, [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId]);
      return { tokenId, holdings: result.rows };
    },
    get_punk_activity: async (tokenId) => {
      const result = await pool.query(`SELECT activity_type, public_detail, occurred_at
        FROM broker_v2_activity WHERE chain_id = $1 AND punk_token_id = $2::numeric
        ORDER BY occurred_at DESC LIMIT 100`, [ROBINHOOD.chainId, tokenId]);
      return { tokenId, activity: result.rows, v1HistoryUrl: `/api/punk/${tokenId}` };
    },
    get_punk_strategy: async (tokenId) => ({ tokenId, strategy: await strategy(tokenId) }),
    getOpportunities: async () => {
      const result = await pool.query(`SELECT normalized FROM broker_v2_opportunities
        WHERE chain_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY updated_at DESC LIMIT 100`, [ROBINHOOD.chainId]);
      return { opportunities: result.rows.map(({ normalized }) => normalizeV2Opportunity(normalized)) };
    },
    get_opportunity: async (id) => ({ opportunity: await opportunity(id) }),
    explain_opportunity: async (id) => {
      const value = await opportunity(id);
      return value ? { opportunityId: id, explanation: `${value.collectionName} is ${value.riskLevel.toLowerCase()} risk with ${value.screeningStatus.toLowerCase()} screening and ${value.simulationStatus.toLowerCase()} simulation.`,
        aiAuthority: false } : { opportunityId: id, explanation: null };
    },
    inspect_collection: async (collectionContract) => {
      const result = await pool.query(`SELECT standard, name, symbol, source_verified,
          proxy_status, risk_label, risk_score, evidence, analyzed_at
        FROM broker_collections WHERE chain_id = $1 AND collection_address = LOWER($2)`,
      [ROBINHOOD.chainId, collectionContract]);
      return { collectionContract: String(collectionContract).toLowerCase(), inspection: result.rows[0] ?? null };
    },
    classify_collection: async (collectionContract) => {
      const result = await pool.query(`SELECT analysis.art_styles, analysis.summary,
          analysis.provider, analysis.created_at FROM broker_v2_opportunity_analysis AS analysis
        JOIN broker_v2_opportunities AS opportunity ON opportunity.opportunity_id = analysis.opportunity_id
        WHERE opportunity.collection_contract = LOWER($1)
        ORDER BY analysis.created_at DESC LIMIT 1`, [collectionContract]);
      return { collectionContract: String(collectionContract).toLowerCase(),
        classification: result.rows[0] ?? null, cacheOnly: true };
    },
    inspect_mint_link: async (url) => inspectArtBrokerLink(url),
    estimate_mint_cost: async (tokenId, id) => {
      const value = await opportunity(id); const live = await authority(tokenId);
      return value ? { tokenId, opportunityId: id, mintPriceWei: value.priceWei,
        estimatedGasCostWei: value.estimatedGasCostWei, punkBalanceWei: live.nativeBalanceWei } : null;
    },
    simulate_mint: async (tokenId, id) => {
      const live = await authority(tokenId);
      const result = await pool.query(`SELECT status, gas_estimate, expected_receiver, effects,
          pinned_block, simulated_at FROM broker_v2_simulations
        WHERE opportunity_id = $1 AND punk_account = $2 ORDER BY simulated_at DESC LIMIT 1`,
      [id, live.punkWallet]);
      return { tokenId, opportunityId: id, simulation: result.rows[0] ?? null,
        submitted: false };
    },
    prepare_mint: async (tokenId, id) => {
      const value = await opportunity(id); const live = await authority(tokenId);
      if (!value) return null;
      return { tokenId, opportunityId: id, punkWallet: live.punkWallet,
        status: "KNOWN_SAFE_ADAPTER_AND_FRESH_SIMULATION_REQUIRED", submitted: false,
        arbitraryCalldataAccepted: false };
    },
    draft_strategy: async (tokenId, message) => {
      const live = await authority(tokenId); const current = await strategy(tokenId);
      const base = current?.intent ?? defaultAskIntent({ punkTokenId: tokenId,
        expectedOwner: principal.walletAddress, punkWallet: live.punkWallet });
      const runtime = createDatabaseBackedGoghIntelligence(pool);
      return interpretPunkCollectingIntent({ router: runtime.router, message,
        currentIntent: base, context: { ownerFingerprint: principal.walletAddress, punkTokenId: tokenId } });
    },
    validate_strategy: async (tokenId, intent) => {
      const live = await authority(tokenId); const normalized = normalizePunkCollectingIntent(intent);
      if (normalized.punkTokenId !== tokenId || normalized.expectedOwner !== live.owner
        || normalized.punkWallet !== live.punkWallet) throw new TypeError("strategy identity changed");
      return { intent: normalized, confirmation: collectingIntentConfirmation(normalized),
        activated: false };
    },
    prepare_strategy_update: async (tokenId, intentHash) => {
      const row = await pool.query(`SELECT intent FROM broker_v2_strategies WHERE chain_id = $1
        AND collection_address = $2 AND token_id = $3::numeric AND intent_hash = $4
        AND configured_by = $5 AND intent->>'expectedOwner' = $5`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, intentHash, principal.walletAddress]);
      return { tokenId, intentHash, available: Boolean(row.rows[0]),
        activationApi: `/api/v2/punks/${tokenId}/strategy`, activated: false };
    },
    prepare_strategy_activation: async (tokenId, intentHash) => ({ tokenId, intentHash,
      activationApi: `/api/v2/punks/${tokenId}/strategy`, action: "prepare_activation",
      signatureRequired: true, activated: false }),
  };
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    const body = await readJson(request, 32_768);
    let principal = null;
    if (body?.method === "tools/call") principal = await requireV2Session(request, pool);
    const server = new GoghArtBrokerMcpServer({
      authenticate: async () => principal ? { owner: principal.walletAddress } : null,
      dependencies: principal ? v2McpDependencies(pool, principal) : {},
    });
    const response = await handleArtBrokerMcpJsonRpc(server, body, principal?.walletAddress ?? null);
    return json(response, response.error ? 400 : 200);
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/mcp", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
} };
