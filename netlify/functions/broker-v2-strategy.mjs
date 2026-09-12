import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getAddress } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { normalizePunkCollectingIntent } from "../../broker/src/v4/collecting-intent.mjs";
import { PublicError, json, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { isV2DeployPreviewUrl, requireV2DeployPreview } from "./_shared/v2-review.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";
import { verifyWalletSignature } from "./_shared/verification.mjs";

const CHALLENGE_SECONDS = 10 * 60;
const INTENT_HASH = /^0x[0-9a-f]{64}$/;

export function requireV2StrategyOrigin(request) {
  if (isV2DeployPreviewUrl(request)) {
    requireV2DeployPreview(request);
    return new URL(request.url).origin;
  }
  requireSameOrigin(request);
  return request.headers.get("origin");
}

function tokenIdFrom(request) {
  const match = new URL(request.url).pathname.match(/^\/api\/v2\/punks\/(\d+)\/strategy$/);
  if (!match || !/^(?:0|[1-9]\d{0,3})$/.test(match[1])) {
    throw new PublicError(400, "INVALID_TOKEN_ID", "Choose a valid Gogh Punk.");
  }
  return match[1];
}
function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The strategy request is invalid.");
  }
}
function strategyView(row) {
  if (!row) return null;
  return Object.freeze({ version: Number(row.version), intentHash: row.intent_hash,
    intent: row.intent, state: row.state, expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    activatedAt: row.activated_at ? new Date(row.activated_at).toISOString() : null });
}

async function current(pool, tokenId) {
  const result = await pool.query(`SELECT version, intent_hash, intent, state, expires_at,
      created_at, activated_at FROM broker_v2_strategies
    WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
    ORDER BY (state IN ('ACTIVE', 'PAUSED')) DESC, version DESC LIMIT 1`,
  [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId]);
  return strategyView(result.rows[0]);
}

async function prepare(pool, tokenId, session, body, { readAuthority, siteUrl }) {
  exact(body, ["action", "intentHash"]);
  if (!INTENT_HASH.test(body.intentHash)) throw new PublicError(400, "INVALID_INTENT_HASH", "Choose a valid strategy draft.");
  const authority = await readAuthority(tokenId, { expectedOwner: session.walletAddress });
  const result = await pool.query(`SELECT intent_hash, intent, expires_at, configured_by, state
    FROM broker_v2_strategies WHERE chain_id = $1 AND collection_address = $2
      AND token_id = $3::numeric AND intent_hash = $4 LIMIT 1`,
  [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, body.intentHash]);
  const row = result.rows[0];
  if (!row || row.configured_by !== session.walletAddress
    || !["PENDING_OWNER_CONFIRMATION", "PAUSED"].includes(row.state)
    || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new PublicError(409, "STRATEGY_DRAFT_UNAVAILABLE", "This strategy draft is unavailable.");
  }
  const intent = normalizePunkCollectingIntent(row.intent);
  if (intent.expectedOwner !== authority.owner || intent.punkWallet !== authority.punkWallet) {
    throw new PublicError(409, "OWNERSHIP_CHANGED", "Punk ownership or wallet binding changed. Draft a new strategy.");
  }
  if (intent.operatingMode === "AUTONOMOUS") throw new PublicError(409,
    "SELF_FUNDED_AUTONOMOUS_GAS_UNSUPPORTED_BY_DEPLOYED_ACCOUNT",
    "Autonomous execution cannot be activated with the current deployed Punk Wallet boundary.");
  const challengeId = randomUUID(); const now = new Date();
  const expirationTime = new Date(now.getTime() + CHALLENGE_SECONDS * 1_000);
  const message = createSiweMessage({ address: getAddress(session.walletAddress),
    chainId: ROBINHOOD.chainId, domain: new URL(siteUrl).host, expirationTime, issuedAt: now,
    nonce: generateSiweNonce(), requestId: challengeId,
    resources: [`urn:gogh:punk:${tokenId}`, `urn:gogh:strategy:${body.intentHash}`],
    statement: `Activate ${intent.operatingMode} strategy ${body.intentHash} for Gogh Punk #${tokenId}. This signature cannot transfer assets or submit a mint.`,
    uri: `${siteUrl}/broker/v2/`, version: "1" });
  await pool.query(`INSERT INTO broker_v2_auth_challenges
    (challenge_id, wallet_address, message, purpose, intent_hash, punk_token_id, expires_at)
    VALUES ($1, $2, $3, 'STRATEGY_ACTIVATION', $4, $5::numeric, $6)`,
  [challengeId, session.walletAddress, message, body.intentHash, tokenId, expirationTime]);
  return Object.freeze({ challengeId, message, intentHash: body.intentHash,
    expiresAt: expirationTime.toISOString(), authorityBlock: authority.blockNumber });
}

async function complete(pool, tokenId, session, body, { readAuthority, verifySignature, siteUrl }) {
  exact(body, ["action", "challengeId", "signature"]);
  if (typeof body.challengeId !== "string" || !/^[0-9a-f-]{36}$/.test(body.challengeId)
    || typeof body.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) {
    throw new PublicError(400, "INVALID_STRATEGY_PROOF", "The strategy confirmation is invalid.");
  }
  const authority = await readAuthority(tokenId, { expectedOwner: session.walletAddress });
  const client = await pool.connect();
  let activated;
  try {
    await client.query("BEGIN");
    const challengeResult = await client.query(`SELECT wallet_address, message, intent_hash,
        punk_token_id, expires_at, used_at, purpose FROM broker_v2_auth_challenges
      WHERE challenge_id = $1 FOR UPDATE`, [body.challengeId]);
    const challenge = challengeResult.rows[0];
    if (!challenge || challenge.purpose !== "STRATEGY_ACTIVATION" || challenge.used_at
      || challenge.wallet_address !== session.walletAddress || String(challenge.punk_token_id) !== tokenId
      || new Date(challenge.expires_at).getTime() <= Date.now()) {
      throw new PublicError(409, "STRATEGY_CHALLENGE_EXPIRED", "The strategy confirmation expired.");
    }
    const signed = parseSiweMessage(challenge.message);
    if (signed.domain !== new URL(siteUrl).host || signed.uri !== `${siteUrl}/broker/v2/`) {
      throw new PublicError(403, "STRATEGY_ORIGIN_MISMATCH", "Review and sign the strategy again on this broker page.");
    }
    await verifySignature({ walletAddress: session.walletAddress,
      message: challenge.message, signature: body.signature });
    const strategyResult = await client.query(`SELECT version, intent_hash, intent, state,
        expires_at, created_at, activated_at FROM broker_v2_strategies
      WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
        AND intent_hash = $4 FOR UPDATE`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, challenge.intent_hash]);
    const row = strategyResult.rows[0];
    if (!row || !["PENDING_OWNER_CONFIRMATION", "PAUSED"].includes(row.state)
      || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new PublicError(409, "STRATEGY_DRAFT_UNAVAILABLE", "This strategy draft is unavailable.");
    }
    const intent = normalizePunkCollectingIntent(row.intent);
    if (intent.operatingMode === "AUTONOMOUS" || intent.expectedOwner !== authority.owner
      || intent.punkWallet !== authority.punkWallet) {
      throw new PublicError(409, "STRATEGY_ACTIVATION_BLOCKED", "The strategy no longer matches the safe Punk boundary.");
    }
    await client.query(`UPDATE broker_v2_strategies SET state = 'SUPERSEDED'
      WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
        AND state = 'ACTIVE' AND intent_hash <> $4`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, row.intent_hash]);
    const confirmationHash = `0x${createHash("sha256").update(body.signature.toLowerCase()).digest("hex")}`;
    const updated = await client.query(`UPDATE broker_v2_strategies
      SET state = 'ACTIVE', owner_confirmation_hash = $1, activated_at = NOW()
      WHERE chain_id = $2 AND collection_address = $3 AND token_id = $4::numeric
        AND intent_hash = $5 RETURNING version, intent_hash, intent, state, expires_at,
          created_at, activated_at`, [confirmationHash, ROBINHOOD.chainId,
      ROBINHOOD.canonicalCollection, tokenId, row.intent_hash]);
    await client.query(`INSERT INTO broker_v2_profiles
      (chain_id, collection_address, token_id, active_strategy_version)
      VALUES ($1, $2, $3::numeric, $4) ON CONFLICT (chain_id, collection_address, token_id)
      DO UPDATE SET active_strategy_version = EXCLUDED.active_strategy_version, updated_at = NOW()`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId, row.version]);
    await client.query("UPDATE broker_v2_auth_challenges SET used_at = NOW() WHERE challenge_id = $1",
      [body.challengeId]);
    await client.query(`INSERT INTO broker_v2_activity
      (chain_id, punk_token_id, activity_type, public_detail, occurred_at)
      VALUES ($1, $2::numeric, 'STRATEGY_ACTIVATED', $3::jsonb, NOW())`,
    [ROBINHOOD.chainId, tokenId, JSON.stringify({ strategyVersion: Number(row.version),
      operatingMode: intent.operatingMode, intentHash: row.intent_hash })]);
    await client.query("COMMIT");
    activated = strategyView(updated.rows[0]);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return activated;
}

async function pause(pool, tokenId, session, body, { readAuthority }) {
  exact(body, ["action"]);
  await readAuthority(tokenId, { expectedOwner: session.walletAddress });
  const result = await pool.query(`UPDATE broker_v2_strategies SET state = 'PAUSED'
    WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
      AND state = 'ACTIVE' RETURNING version, intent_hash, intent, state, expires_at,
        created_at, activated_at`, [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId]);
  if (!result.rows[0]) throw new PublicError(409, "NO_ACTIVE_STRATEGY", "This Punk has no active strategy to pause.");
  return strategyView(result.rows[0]);
}

export async function handleV2Strategy(request, { pool, requireSession = requireV2Session,
  readAuthority = readV2PunkAuthority, verifySignature = verifyWalletSignature } = {}) {
  try {
    const tokenId = tokenIdFrom(request);
    const session = await requireSession(request, pool);
    if (request.method === "GET") {
      await readAuthority(tokenId, { expectedOwner: session.walletAddress });
      return json({ ok: true, tokenId, strategy: await current(pool, tokenId) });
    }
    if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
    const siteUrl = requireV2StrategyOrigin(request);
    const dependencies = { readAuthority, verifySignature, siteUrl };
    const body = await readJson(request, 20_000);
    if (body.action === "prepare_activation") return json({ ok: true,
      challenge: await prepare(pool, tokenId, session, body, dependencies), strategyActivated: false });
    if (body.action === "complete_activation") return json({ ok: true,
      strategy: await complete(pool, tokenId, session, body, dependencies), strategyActivated: true });
    if (body.action === "pause") return json({ ok: true,
      strategy: await pause(pool, tokenId, session, body, dependencies), strategyActivated: false });
    throw new PublicError(400, "INVALID_ACTION", "Choose a supported strategy action.");
  } catch (error) { return v2Failure(error); }
}

export default async function handler(request) {
  return handleV2Strategy(request, { pool: getDatabase().pool });
}

export const config = { path: "/api/v2/punks/:tokenId/strategy", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 20, windowSize: 60,
} };
