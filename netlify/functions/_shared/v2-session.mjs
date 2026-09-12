import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getAddress } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { ROBINHOOD } from "../../../broker/src/config.mjs";
import { getSiteUrl } from "./config.mjs";
import { PublicError } from "./http.mjs";
import { normalizeWalletAddress, verifyWalletSignature } from "./verification.mjs";

const SESSION_COOKIE = "gogh_v2_session";
const SESSION_SECONDS = 12 * 60 * 60;
const CHALLENGE_SECONDS = 10 * 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function sessionHash(token) {
  return createHash("sha256").update(token).digest("hex");
}
function cookieValue(request, name) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
  }
  return null;
}
function sessionCookie(token, maximumAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/api/v2; Max-Age=${maximumAge}`;
}

export async function prepareV2Session(pool, walletValue, now = new Date(), siteUrl = getSiteUrl()) {
  const walletAddress = normalizeWalletAddress(walletValue);
  if (!walletAddress) throw new PublicError(400, "INVALID_WALLET", "Choose a valid wallet address.");
  const challengeId = randomUUID();
  const issuedAt = new Date(now);
  const expirationTime = new Date(issuedAt.getTime() + CHALLENGE_SECONDS * 1_000);
  const message = createSiweMessage({ address: getAddress(walletAddress), chainId: ROBINHOOD.chainId,
    domain: new URL(siteUrl).host, expirationTime, issuedAt, nonce: generateSiweNonce(),
    requestId: challengeId, resources: [`${siteUrl}/broker/v2/`],
    statement: "Sign in to talk to and configure your Gogh Punk. This is not a transaction and grants no asset-transfer authority.",
    uri: `${siteUrl}/broker/v2/`, version: "1" });
  await pool.query(`INSERT INTO broker_v2_auth_challenges
    (challenge_id, wallet_address, message, purpose, expires_at)
    VALUES ($1, $2, $3, 'SESSION', $4)`, [challengeId, walletAddress, message, expirationTime]);
  return Object.freeze({ challengeId, walletAddress, message,
    expiresAt: expirationTime.toISOString() });
}

export async function completeV2Session(pool, { challengeId, walletAddress: walletValue, signature },
  now = new Date(), siteUrl = getSiteUrl()) {
  const walletAddress = normalizeWalletAddress(walletValue);
  if (!walletAddress || typeof challengeId !== "string" || !/^[0-9a-f-]{36}$/.test(challengeId)
    || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new PublicError(400, "INVALID_SESSION_PROOF", "The sign-in proof is invalid.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT wallet_address, message, expires_at, used_at, purpose
      FROM broker_v2_auth_challenges WHERE challenge_id = $1 FOR UPDATE`, [challengeId]);
    const challenge = result.rows[0];
    if (!challenge || challenge.purpose !== "SESSION" || challenge.used_at
      || challenge.wallet_address !== walletAddress
      || new Date(challenge.expires_at).getTime() <= new Date(now).getTime()) {
      throw new PublicError(409, "SESSION_CHALLENGE_EXPIRED", "The sign-in request expired.");
    }
    const signed = parseSiweMessage(challenge.message);
    if (signed.domain !== new URL(siteUrl).host || signed.uri !== `${siteUrl}/broker/v2/`) {
      throw new PublicError(403, "SESSION_ORIGIN_MISMATCH", "Sign in again on this broker page.");
    }
    await verifyWalletSignature({ walletAddress, message: challenge.message, signature });
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(new Date(now).getTime() + SESSION_SECONDS * 1_000);
    await client.query(`INSERT INTO broker_v2_sessions (session_hash, wallet_address, expires_at)
      VALUES ($1, $2, $3)`, [sessionHash(token), walletAddress, expiresAt]);
    await client.query("UPDATE broker_v2_auth_challenges SET used_at = NOW() WHERE challenge_id = $1",
      [challengeId]);
    await client.query("COMMIT");
    return Object.freeze({ token, walletAddress, expiresAt: expiresAt.toISOString(),
      cookie: sessionCookie(token) });
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
}

export async function requireV2Session(request, pool, now = new Date()) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || !TOKEN.test(token)) throw new PublicError(401, "V2_SESSION_REQUIRED", "Sign in with your wallet.");
  const result = await pool.query(`SELECT wallet_address, expires_at, revoked_at
    FROM broker_v2_sessions WHERE session_hash = $1`, [sessionHash(token)]);
  const session = result.rows[0];
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= new Date(now).getTime()) {
    throw new PublicError(401, "V2_SESSION_EXPIRED", "Your Art Broker session expired.");
  }
  await pool.query("UPDATE broker_v2_sessions SET last_seen_at = NOW() WHERE session_hash = $1",
    [sessionHash(token)]);
  return Object.freeze({ walletAddress: session.wallet_address,
    expiresAt: new Date(session.expires_at).toISOString() });
}

export async function revokeV2Session(request, pool) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token && TOKEN.test(token)) await pool.query(
    "UPDATE broker_v2_sessions SET revoked_at = NOW() WHERE session_hash = $1", [sessionHash(token)]);
  return sessionCookie("", 0);
}

export function verifyAdminBearer(request, environment = process.env) {
  const configured = environment.GOGH_V2_ADMIN_TOKEN;
  const header = request.headers.get("authorization") ?? "";
  if (typeof configured !== "string" || configured.length < 24 || configured.length > 512
    || !header.startsWith("Bearer ")) throw new PublicError(401, "ADMIN_AUTH_REQUIRED", "Admin authorization is required.");
  const presented = header.slice(7);
  const left = createHash("sha256").update(configured).digest();
  const right = createHash("sha256").update(presented).digest();
  if (!timingSafeEqual(left, right)) throw new PublicError(401, "ADMIN_AUTH_REQUIRED", "Admin authorization is required.");
}
