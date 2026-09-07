import { getDatabase } from "@netlify/database";
import { createPublicClient, http } from "viem";

import deployment from "../../deployments/robinhood-punk-agent-account.json" with { type: "json" };
import {
  createConfiguredPunkAgentBundler,
  createPunkAgentSessionSigner,
  readPunkAgentAccountRuntime,
  readPunkAgentBundlerReadiness,
} from "../../broker/src/agent-account/punk-agent-account-runtime.mjs";
import { punkAgentAccountReadiness } from
  "../../broker/src/agent-account/punk-agent-account-manifest.mjs";
import { getRpcUrl } from "./_shared/config.mjs";
import { json } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { v2TokenIdFrom } from "./_shared/v2-route.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

function liveClient() {
  return createPublicClient({ transport: http(getRpcUrl(), { timeout: 10_000, retryCount: 1 }) });
}

function publicRuntime(runtime) {
  if (!runtime?.account) return runtime;
  return Object.freeze({ ...runtime,
    acquisitionNonce: runtime.acquisitionNonce?.toString() ?? null,
    sessionGeneration: runtime.sessionGeneration?.toString() ?? null,
    entryPointDeposit: runtime.entryPointDeposit?.toString() ?? null,
    nativeBalance: runtime.nativeBalance?.toString() ?? null,
    session: runtime.session ? Object.freeze(Object.fromEntries(Object.entries(runtime.session)
      .map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]))) : null });
}

export async function handleV2AgentAccount(request, {
  pool = getDatabase().pool, readAuthority = readV2PunkAuthority, client = null,
  manifest = deployment, environment = process.env, requireSession = requireV2Session,
} = {}) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const tokenId = v2TokenIdFrom(request, "/agent-account");
    const session = await requireSession(request, pool);
    const authority = await readAuthority(tokenId, { expectedOwner: session.walletAddress });
    const readiness = punkAgentAccountReadiness(manifest);
    let signerAddress = null;
    let signerConfigured = false;
    try {
      const signer = createPunkAgentSessionSigner(environment);
      signerAddress = signer.address.toLowerCase(); signerConfigured = true;
    } catch { /* Public readiness exposes no secret diagnostics. */ }
    let runtime = null;
    if (manifest.status === "DEPLOYED") {
      runtime = await readPunkAgentAccountRuntime({ client: client ?? liveClient(),
        deployment: manifest, tokenId, expectedOwner: session.walletAddress,
        ...(signerAddress ? { expectedSessionKey: signerAddress } : {}) });
    }
    let bundler = Object.freeze({ ready: false });
    if (environment.PUNK_AGENT_BUNDLER_RPC_URL
      || environment.PUNK_AGENT_BUNDLER_MODE === "DIRECT_PRIVATE_RELAY") {
      try { bundler = await readPunkAgentBundlerReadiness({
        bundler: createConfiguredPunkAgentBundler(environment),
      }); } catch { bundler = Object.freeze({ ready: false }); }
    }
    let mission = null;
    let skills = [];
    let databaseReady = true;
    try {
      const result = await pool.query(`SELECT session.session_id::text, session.punk_account,
          session.session_key, session.strategy_version, session.status, session.valid_after,
          session.valid_until, session.max_mints_per_day, session.max_mints_total,
          session.authorization_transaction_hash, strategy.intent,
          operation.state AS operation_state, operation.user_operation_hash,
          operation.transaction_hash, operation.updated_at AS operation_updated_at
        FROM broker_v2_agent_sessions session
        JOIN broker_v2_strategies strategy ON strategy.chain_id = session.chain_id
          AND strategy.collection_address = session.collection_address
          AND strategy.token_id = session.punk_token_id
          AND strategy.version = session.strategy_version
        LEFT JOIN LATERAL (SELECT state, user_operation_hash, transaction_hash, updated_at
          FROM broker_v2_agent_user_operations WHERE session_id = session.session_id
          ORDER BY created_at DESC LIMIT 1) operation ON TRUE
        WHERE session.chain_id = 4663 AND session.punk_token_id = $1::numeric
          AND session.status IN ('PENDING_RECEIPT', 'ACTIVE', 'PAUSED', 'COMPLETED')
        ORDER BY session.created_at DESC LIMIT 1`, [tokenId]);
      const row = result.rows[0];
      if (row) {
        const activity = await pool.query(`SELECT
            COUNT(*) FILTER (WHERE activity_type IN ('AGENT_SCOUTED', 'USER_OPERATION_SUBMITTED'))::integer AS checks,
            COUNT(*) FILTER (WHERE activity_type = 'COLLECTED')::integer AS completed_mints,
            COALESCE(SUM(CASE WHEN public_detail->>'opportunitiesChecked' ~ '^[0-9]+$'
              THEN (public_detail->>'opportunitiesChecked')::integer ELSE 0 END), 0)::integer
              AS opportunities_checked
          FROM broker_v2_activity WHERE chain_id = 4663 AND punk_token_id = $1::numeric
            AND occurred_at >= $2`, [tokenId, row.valid_after]);
        const counters = activity.rows[0] ?? {};
        mission = Object.freeze({ sessionId: row.session_id,
        account: row.punk_account, sessionKey: row.session_key,
        strategyVersion: Number(row.strategy_version), status: row.status,
        validAfter: new Date(row.valid_after).toISOString(),
        validUntil: new Date(row.valid_until).toISOString(),
        dailyLimit: Number(row.max_mints_per_day), totalLimit: Number(row.max_mints_total),
        authorizationTransactionHash: row.authorization_transaction_hash,
        intent: row.intent, checks: Number(counters.checks ?? 0),
        completedMints: Number(counters.completed_mints ?? 0),
        opportunitiesChecked: Number(counters.opportunities_checked ?? 0),
        latestOperation: row.operation_state ? Object.freeze({ state: row.operation_state,
          userOperationHash: row.user_operation_hash,
          transactionHash: row.transaction_hash,
          updatedAt: new Date(row.operation_updated_at).toISOString() }) : null });
      }
      const skillResult = await pool.query(`SELECT skill_id, name, description, capabilities,
          configured_by, created_at
        FROM broker_v2_punk_skills WHERE chain_id = 4663 AND token_id = $1::numeric
          AND state = 'ACTIVE' AND configured_by = $2 ORDER BY activated_at DESC LIMIT 8`,
      [tokenId, session.walletAddress]);
      skills = skillResult.rows.map((skill) => Object.freeze({
        schema: "GOGH_PUNK_SKILL_V1", version: 1, skillId: skill.skill_id,
        punkTokenId: tokenId, expectedOwner: session.walletAddress,
        punkWallet: authority.punkWallet, name: skill.name, description: skill.description,
        capabilities: skill.capabilities, authority: "READ_ONLY", policyEffect: "NONE",
        state: "ACTIVE", createdAt: new Date(skill.created_at).toISOString(),
      }));
    } catch { databaseReady = false; }
    const blockers = [...new Set([
      ...readiness.blockers,
      ...(databaseReady ? [] : ["AGENT_DATABASE_NOT_READY"]),
      ...(signerConfigured ? [] : ["SESSION_SIGNER_NOT_CONFIGURED"]),
      ...(bundler.ready ? [] : ["BUNDLER_NOT_READY"]),
      ...(runtime?.accountCreated ? [] : ["ACCOUNT_NOT_ACTIVATED"]),
      ...(runtime?.sessionActive ? [] : ["SESSION_NOT_AUTHORIZED"]),
    ])];
    return json({ ok: true, tokenId, productName: "Punk Agent Account",
      owner: session.walletAddress, readiness: { ...readiness,
        ready: blockers.length === 0, automaticExecutionReady: blockers.length === 0,
        setupAvailable: readiness.ready && databaseReady && signerConfigured && bundler.ready,
        databaseReady, blockers }, signer: { configured: signerConfigured, address: signerAddress },
      bundler, runtime: publicRuntime(runtime), mission, skills, transactionPrepared: false,
      transactionSubmitted: false }, 200, {
      "cache-control": "private, no-store", "netlify-cdn-cache-control": "no-store",
    });
  } catch (error) { return v2Failure(error); }
}

export default handleV2AgentAccount;

export const config = { path: "/api/v2/punks/:tokenId/agent-account", method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip"], windowLimit: 30, windowSize: 60 } };
