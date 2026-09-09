import { getDatabase } from "@netlify/database";
import { createPublicClient, http, keccak256 } from "viem";

import deployment from "../../deployments/robinhood-punk-agent-account.json" with { type: "json" };
import { buildPunkAgentAccountSessionSetup } from
  "../../broker/src/agent-account/punk-agent-account-setup.mjs";
import { punkAgentAccountReadiness } from
  "../../broker/src/agent-account/punk-agent-account-manifest.mjs";
import {
  createPunkAgentSessionSigner,
  readPunkAgentAccountRuntime,
} from "../../broker/src/agent-account/punk-agent-account-runtime.mjs";
import {
  normalizePunkCollectingIntent,
  punkCollectingIntentHash,
} from "../../broker/src/v4/collecting-intent.mjs";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { getRpcUrl } from "./_shared/config.mjs";
import { PublicError, json, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { isV2DeployPreviewUrl, requireV2DeployPreview } from "./_shared/v2-review.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

const OWNER = /^0x[0-9a-f]{40}$/;
const TOKEN = /^(?:0|[1-9]\d{0,3})$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function origin(request) {
  if (isV2DeployPreviewUrl(request)) requireV2DeployPreview(request);
  else requireSameOrigin(request);
}

function bodyValue(value) {
  const fields = ["intent", "owner", "tokenId"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The Punk Agent Account setup request is invalid.");
  }
  const owner = String(value.owner ?? "").toLowerCase();
  const tokenId = String(value.tokenId ?? "");
  if (!OWNER.test(owner) || !TOKEN.test(tokenId) || !value.intent
    || typeof value.intent !== "object" || Array.isArray(value.intent)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose one owned Punk and complete mission.");
  }
  return Object.freeze({ owner, tokenId, intent: value.intent });
}

function liveClient() {
  return createPublicClient({ transport: http(getRpcUrl(), { timeout: 10_000, retryCount: 1 }) });
}

function preparationError(error) {
  if (error instanceof PublicError) return error;
  const publicCodes = new Set(["CONTRACTS_NOT_DEPLOYED", "ACCOUNT_NOT_ACTIVATED",
    "SESSION_INACTIVE", "OWNER_CHANGED", "RUNTIME_MISMATCH", "MISSING_RUNTIME"]);
  if (publicCodes.has(error?.code)) return new PublicError(409, error.code, error.message);
  return error;
}

export async function reuseAgentStrategyReview(database, { tokenId, intentHash, owner }) {
  const bindings = [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, intentHash, owner];
  const result = await database.query(`SELECT version, state FROM broker_v2_strategies
    WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
      AND intent_hash = $4 AND configured_by = $5 LIMIT 1 FOR UPDATE`, bindings);
  const row = result.rows[0];
  if (!row) return null;
  if (!["PENDING_OWNER_CONFIRMATION", "PAUSED"].includes(row.state)) throw new PublicError(409,
    "STRATEGY_ALREADY_RECORDED", "This strategy is active or retired. Recall an active mission or review changed limits before a new setup.");
  if (row.state === "PAUSED") {
    // Preparation can reopen a review, never activate it. Receipt reconciliation
    // still requires a fresh owner-signed on-chain session with the next generation.
    await database.query(`UPDATE broker_v2_strategies SET state = 'PENDING_OWNER_CONFIRMATION'
      WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
        AND intent_hash = $4 AND configured_by = $5 AND state = 'PAUSED'`, bindings);
  }
  return Number(row.version);
}

export async function handleV2AgentAccountSetup(request, {
  pool = getDatabase().pool, readAuthority = readV2PunkAuthority, client = null,
  manifest = deployment, environment = process.env, now = new Date(),
  requireSession = requireV2Session,
} = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    origin(request);
    const body = bodyValue(await readJson(request, 24_000));
    const session = await requireSession(request, pool, now);
    if (session.walletAddress !== body.owner) {
      throw new PublicError(403, "NOT_CURRENT_OWNER", "Sign in with the connected Punk owner.");
    }
    const authority = await readAuthority(body.tokenId, { expectedOwner: body.owner });
    const readiness = punkAgentAccountReadiness(manifest);
    if (!readiness.ready) throw new PublicError(409, "PUNK_AGENT_ACCOUNT_NOT_READY",
      `Punk Agent Account setup is locked: ${readiness.blockers.join(", ")}.`);
    const rpc = client ?? liveClient();
    const signer = createPunkAgentSessionSigner(environment);
    const runtime = await readPunkAgentAccountRuntime({ client: rpc, deployment: manifest,
      tokenId: body.tokenId, expectedOwner: body.owner });
    let supplied;
    try { supplied = normalizePunkCollectingIntent(body.intent, now); } catch {
      throw new PublicError(400, "INVALID_STRATEGY", "The autonomous mission is invalid.");
    }
    const agentIntent = normalizePunkCollectingIntent({ ...supplied, operatingMode: "AUTONOMOUS",
      punkWallet: runtime.account, expectedOwner: body.owner, punkTokenId: body.tokenId }, now);
    const adapter = manifest.reusedContracts.AutomatedSeaDropStudioFreeMintAdapter.toLowerCase();
    const venue = manifest.reusedContracts.SeaDrop.toLowerCase();
    if (agentIntent.mintMode !== "FREE_ONLY" || agentIntent.maxMintPriceWei !== "0"
      || !agentIntent.requireSimulation || agentIntent.dailyMintLimit > 100
      || agentIntent.totalMintLimit < 1 || agentIntent.totalMintLimit > 100
      || agentIntent.allowedAdapters.length > 0 && !agentIntent.allowedAdapters.includes(adapter)) {
      throw new PublicError(409, "UNSAFE_AUTONOMOUS_STRATEGY",
        "Punk Agent Account currently accepts only 1–100 free mints through its reviewed adapter.");
    }
    const nowSeconds = BigInt(Math.floor(new Date(now).getTime() / 1_000));
    const intentExpiry = BigInt(Math.floor(Date.parse(agentIntent.expiration) / 1_000));
    const validUntil = intentExpiry < nowSeconds + 30n * 86_400n
      ? intentExpiry : nowSeconds + 30n * 86_400n;
    const adapterCode = await rpc.getCode({ address: adapter });
    if (!adapterCode || adapterCode === "0x") throw new PublicError(503,
      "ADAPTER_RUNTIME_UNAVAILABLE", "Reviewed mint adapter runtime is unavailable.");
    const setup = buildPunkAgentAccountSessionSetup({
      schema: "GOGH_PUNK_AGENT_ACCOUNT_SETUP_INPUT_V1", version: 1, chainId: 4663,
      checkedAt: new Date(now).toISOString(),
      punk: { tokenId: body.tokenId, expectedOwner: body.owner, account: runtime.account,
        accountCreated: runtime.accountCreated },
      infrastructure: { accountRegistry: readiness.accountRegistry,
        entryPoint: readiness.entryPoint,
        adapterRegistry: manifest.reusedContracts.ArtAdapterRegistry,
        adapter, venue },
      session: { sessionKey: signer.address, adapterCodeHash: keccak256(adapterCode),
        targetCollection: agentIntent.allowedContracts.length === 1
          ? agentIntent.allowedContracts[0] : ZERO_ADDRESS,
        validAfter: (nowSeconds - 1n).toString(), validUntil: validUntil.toString(),
        maxMintsPerDay: String(agentIntent.dailyMintLimit),
        maxMintsTotal: String(agentIntent.totalMintLimit),
        maxGasCostWei: agentIntent.maxGasPerMintWei,
        minimumNativeReserveWei: agentIntent.minimumReserveWei },
    }, { nowSeconds });
    const intentHash = punkCollectingIntentHash(agentIntent, now);
    const database = await pool.connect();
    let strategyVersion; let sessionId;
    try {
      await database.query("BEGIN");
      await database.query("SELECT pg_advisory_xact_lock($1)",
        [(BigInt(ROBINHOOD.chainId) * 10_000n + BigInt(body.tokenId)).toString()]);
      const active = await database.query(`SELECT session_id::text, status
        FROM broker_v2_agent_sessions WHERE chain_id = $1 AND punk_token_id = $2::numeric
          AND status IN ('ACTIVE', 'PAUSED') FOR UPDATE`, [ROBINHOOD.chainId, body.tokenId]);
      if (active.rows[0]) throw new PublicError(409, "AGENT_SESSION_ALREADY_ACTIVE",
        "Recall the current Punk mission before authorizing a replacement session.");
      const existing = await database.query(`SELECT session.session_id::text,
          session.strategy_version, session.setup_artifact_hash
        FROM broker_v2_agent_sessions session
        WHERE session.chain_id = $1 AND session.punk_token_id = $2::numeric
          AND session.status = 'PENDING_RECEIPT' FOR UPDATE`,
      [ROBINHOOD.chainId, body.tokenId]);
      if (existing.rows[0] && existing.rows[0].setup_artifact_hash === setup.artifactHash) {
        sessionId = existing.rows[0].session_id;
        strategyVersion = Number(existing.rows[0].strategy_version);
      } else {
        if (existing.rows[0]) await database.query(`UPDATE broker_v2_agent_sessions
          SET status = 'REVOKED', updated_at = $1 WHERE session_id = $2`,
        [new Date(now).toISOString(), existing.rows[0].session_id]);
        strategyVersion = await reuseAgentStrategyReview(database, {
          tokenId: body.tokenId, intentHash, owner: body.owner });
        if (strategyVersion === null) {
          const versionResult = await database.query(`SELECT COALESCE(MAX(version), 0) + 1 AS version
            FROM broker_v2_strategies WHERE chain_id = $1 AND collection_address = $2
              AND token_id = $3::numeric`, [ROBINHOOD.chainId,
            ROBINHOOD.canonicalCollection, body.tokenId]);
          strategyVersion = Number(versionResult.rows[0].version);
          await database.query(`INSERT INTO broker_v2_strategies
            (chain_id, collection_address, token_id, version, schema_name, intent_hash, intent,
             state, configured_by, ownership_block, expires_at)
            VALUES ($1, $2, $3::numeric, $4, 'PUNK_COLLECTING_INTENT_V1', $5, $6::jsonb,
              'PENDING_OWNER_CONFIRMATION', $7, $8::bigint, $9)`, [ROBINHOOD.chainId,
            ROBINHOOD.canonicalCollection, body.tokenId, strategyVersion, intentHash,
            JSON.stringify(agentIntent), body.owner, authority.blockNumber, agentIntent.expiration]);
        }
        const inserted = await database.query(`INSERT INTO broker_v2_agent_sessions
          (chain_id, collection_address, punk_token_id, punk_account, owner_snapshot,
           strategy_version, strategy_hash, session_key, session_generation, adapter_address,
           venue_address, adapter_code_hash, target_collection, max_mints_per_day,
           max_mints_total, max_gas_cost_wei, minimum_native_reserve_wei, valid_after,
           valid_until, status, setup_artifact_hash)
          VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16::numeric, $17::numeric, $18, $19,
            'PENDING_RECEIPT', $20) RETURNING session_id::text`, [ROBINHOOD.chainId,
          ROBINHOOD.canonicalCollection, body.tokenId, runtime.account, body.owner,
          strategyVersion, intentHash, signer.address.toLowerCase(),
          ((runtime.sessionGeneration ?? 0n) + 1n).toString(), adapter, venue,
          setup.session.adapterCodeHash, setup.session.targetCollection,
          agentIntent.dailyMintLimit, agentIntent.totalMintLimit,
          agentIntent.maxGasPerMintWei, agentIntent.minimumReserveWei,
          new Date(Number(nowSeconds - 1n) * 1_000).toISOString(),
          new Date(Number(validUntil) * 1_000).toISOString(), setup.artifactHash]);
        sessionId = inserted.rows[0].session_id;
      }
      await database.query("COMMIT");
    } catch (error) { await database.query("ROLLBACK"); throw error; }
    finally { database.release(); }
    return json({ ok: true, productName: "Punk Agent Account", tokenId: body.tokenId,
      owner: body.owner, strategy: { version: strategyVersion, intentHash, intent: agentIntent,
        state: "PENDING_OWNER_CONFIRMATION" }, sessionId, setup,
      ownerTransactionsRequired: setup.setupTransactions.length,
      perMintWalletPopupRequired: false, transactionSubmitted: false }, 200, {
      "cache-control": "private, no-store", "netlify-cdn-cache-control": "no-store",
    });
  } catch (error) { return v2Failure(preparationError(error)); }
}

export default handleV2AgentAccountSetup;

export const config = { path: "/api/v2/agent-account/setup", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 5, windowSize: 60,
} };
