import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { createPublicClient, defineChain, getAddress, http, parseAbi } from "viem";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import {
  normalizeOwnerArtMandate,
  OWNER_MANDATE_TOKEN_ID,
  ownerArtMandateSha256,
  storedOwnerArtMandate,
} from "../../broker/src/owner-art-mandate.mjs";
import { getRpcUrl, getSiteUrl } from "./_shared/config.mjs";
import { json, PublicError, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { normalizeWalletAddress, verifyWalletSignature } from "./_shared/verification.mjs";

const OWNER_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const CHALLENGE_SECONDS = 10 * 60;
const LOCK_ID = 4_663_1_797;

function exactBody(body, keys, label) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== keys.length
    || keys.some((key) => !Object.hasOwn(body, key))) {
    throw new PublicError(400, "INVALID_REQUEST", `${label} has an invalid field set.`);
  }
}

function publicFailure(error) {
  if (error instanceof PublicError) {
    return json({ ok: false, code: error.code, message: error.message }, error.status);
  }
  console.error(JSON.stringify({
    event: "BROKER_MANDATE_FAILED",
    type: error?.name ?? "Error",
    code: error?.code ?? "UNEXPECTED",
  }));
  return json({
    ok: false,
    code: "MANDATE_UNAVAILABLE",
    message: "The Art Mandate service is temporarily unavailable. No preference was saved.",
  }, 503);
}

function publicClient() {
  const rpcUrl = getRpcUrl();
  const chain = defineChain({
    id: ROBINHOOD.chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

async function requireLiveOwner(walletAddress, client = publicClient()) {
  const owner = normalizeWalletAddress(await client.readContract({
    address: getAddress(ROBINHOOD.canonicalCollection),
    abi: OWNER_ABI,
    functionName: "ownerOf",
    args: [BigInt(OWNER_MANDATE_TOKEN_ID)],
  }));
  if (owner !== walletAddress) {
    throw new PublicError(
      403,
      "NOT_CURRENT_OWNER",
      `The connected wallet is not the current owner of Punk #${OWNER_MANDATE_TOKEN_ID}.`,
    );
  }
  return owner;
}

function mandateFromRow(row) {
  if (!row) return null;
  const normalized = normalizeOwnerArtMandate({
    chainId: Number(row.chain_id),
    collection: row.collection_address,
    tokenId: String(row.token_id),
    mode: row.mode,
    economicSettings: {
      inspectMints: row.economic_settings.inspectMints,
      allowFreeMints: row.economic_settings.allowFreeMints,
      maxMintsPerDay: row.economic_settings.maxMintsPerDay,
    },
    riskSettings: row.risk_settings,
    artisticPreferences: row.artistic_preferences,
  });
  return storedOwnerArtMandate(
    normalized,
    normalizeWalletAddress(row.configured_by),
    Number(row.version),
  );
}

async function latestMandate(pool) {
  const result = await pool.query(
    `SELECT chain_id, collection_address, token_id, version, mode,
            economic_settings, risk_settings, artistic_preferences,
            configured_by, created_at
       FROM broker_art_mandates
      WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3
      ORDER BY version DESC LIMIT 1`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, OWNER_MANDATE_TOKEN_ID],
  );
  const mandate = mandateFromRow(result.rows[0]);
  return mandate ? Object.freeze({ ...mandate, savedAt: result.rows[0].created_at }) : null;
}

async function prepare(body, pool) {
  exactBody(body, ["action", "walletAddress", "mandate"], "Prepare request");
  const walletAddress = normalizeWalletAddress(body.walletAddress);
  let mandate;
  try {
    mandate = normalizeOwnerArtMandate(body.mandate);
  } catch {
    throw new PublicError(400, "INVALID_MANDATE", "The Art Mandate settings are invalid.");
  }
  await requireLiveOwner(walletAddress);
  const challengeId = randomUUID();
  const now = new Date();
  const expirationTime = new Date(now.getTime() + CHALLENGE_SECONDS * 1_000);
  const siteUrl = getSiteUrl();
  const mandateSha256 = ownerArtMandateSha256(mandate);
  const message = createSiweMessage({
    address: getAddress(walletAddress),
    chainId: ROBINHOOD.chainId,
    domain: new URL(siteUrl).host,
    expirationTime,
    issuedAt: now,
    nonce: generateSiweNonce(),
    requestId: challengeId,
    resources: [`${siteUrl}/broker/#mandate-${mandateSha256.slice(2)}`],
    statement: `Save off-chain Scout preferences for Gogh Punk #${OWNER_MANDATE_TOKEN_ID}. This signature is not a transaction or token approval and cannot enable autonomous execution.`,
    uri: `${siteUrl}/broker/`,
    version: "1",
  });
  await pool.query(
    `INSERT INTO broker_mandate_challenges
      (id, chain_id, collection_address, token_id, wallet_address, message,
       mandate_sha256, mandate_json, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [challengeId, ROBINHOOD.chainId, ROBINHOOD.canonicalCollection,
      OWNER_MANDATE_TOKEN_ID, walletAddress, message, mandateSha256,
      JSON.stringify(mandate), expirationTime],
  );
  return json({ ok: true, action: "SIGN_MANDATE", challengeId, message, expirationTime });
}

async function complete(body, pool) {
  exactBody(body, ["action", "challengeId", "walletAddress", "signature"], "Save request");
  if (typeof body.challengeId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(body.challengeId)) {
    throw new PublicError(400, "INVALID_CHALLENGE", "The mandate challenge is invalid.");
  }
  const walletAddress = normalizeWalletAddress(body.walletAddress);
  const found = await pool.query(
    `SELECT id, wallet_address, message, mandate_sha256, mandate_json, expires_at, used_at
       FROM broker_mandate_challenges WHERE id = $1`,
    [body.challengeId],
  );
  const challenge = found.rows[0];
  if (!challenge || challenge.used_at || new Date(challenge.expires_at).getTime() <= Date.now()
    || challenge.wallet_address !== walletAddress) {
    throw new PublicError(409, "CHALLENGE_EXPIRED", "The mandate signature request expired.");
  }
  let mandate;
  try {
    mandate = normalizeOwnerArtMandate(challenge.mandate_json);
    if (ownerArtMandateSha256(mandate) !== challenge.mandate_sha256) throw new Error();
  } catch {
    throw new PublicError(409, "CHALLENGE_MISMATCH", "The saved mandate challenge is invalid.");
  }
  await verifyWalletSignature({ walletAddress, message: challenge.message, signature: body.signature });
  await requireLiveOwner(walletAddress);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]);
    const locked = await client.query(
      `SELECT used_at, expires_at FROM broker_mandate_challenges WHERE id = $1 FOR UPDATE`,
      [body.challengeId],
    );
    const live = locked.rows[0];
    if (!live || live.used_at || new Date(live.expires_at).getTime() <= Date.now()) {
      throw new PublicError(409, "CHALLENGE_EXPIRED", "The mandate signature request expired.");
    }
    const versionResult = await client.query(
      `SELECT COALESCE(MAX(version), 0)::text AS version
         FROM broker_art_mandates
        WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, OWNER_MANDATE_TOKEN_ID],
    );
    const version = Number(BigInt(versionResult.rows[0].version) + 1n);
    const stored = storedOwnerArtMandate(mandate, walletAddress, version);
    await client.query(
      `INSERT INTO broker_art_mandates
        (chain_id, collection_address, token_id, version, mode, economic_settings,
         risk_settings, artistic_preferences, marketplace_permissions, configured_by,
         onchain_policy_version)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, NULL)`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, OWNER_MANDATE_TOKEN_ID,
        version, stored.mode, JSON.stringify(stored.economicSettings),
        JSON.stringify(stored.riskSettings), JSON.stringify(stored.artisticPreferences),
        JSON.stringify(stored.mintPermissions), walletAddress],
    );
    await client.query(
      "UPDATE broker_mandate_challenges SET used_at = NOW() WHERE id = $1",
      [body.challengeId],
    );
    await client.query("COMMIT");
    return json({ ok: true, status: "MANDATE_SAVED", mandate: stored });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export default async function handler(request) {
  const pool = getDatabase().pool;
  try {
    if (request.method === "GET") {
      return json({ ok: true, tokenId: OWNER_MANDATE_TOKEN_ID, mandate: await latestMandate(pool) });
    }
    if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
    requireSameOrigin(request);
    const body = await readJson(request, 24_000);
    if (body.action === "prepare") return await prepare(body, pool);
    if (body.action === "complete") return await complete(body, pool);
    throw new PublicError(400, "INVALID_ACTION", "Choose a supported mandate action.");
  } catch (error) {
    return publicFailure(error);
  }
}

export const config = {
  path: "/api/broker/mandate",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 20,
    windowSize: 60,
  },
};
