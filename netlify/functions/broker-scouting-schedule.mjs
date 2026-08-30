import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { getAddress } from "viem";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { normalizeScoutingSchedule } from
  "../../broker/src/connector/scouting-schedule.mjs";
import { getSiteUrl } from "./_shared/config.mjs";
import { json, PublicError, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { normalizeWalletAddress, verifyWalletSignature } from "./_shared/verification.mjs";
import { requireLiveOwner } from "./broker-mandate.mjs";

const CHALLENGE_SECONDS = 10 * 60;
const TOKEN_ID = /^(?:0|[1-9][0-9]{0,3})$/;

function exactBody(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new PublicError(400, "INVALID_REQUEST", `${label} has an invalid field set.`);
  }
}

function schedule(value) {
  try {
    return normalizeScoutingSchedule(value);
  } catch (error) {
    throw new PublicError(400, "INVALID_SCHEDULE", error.message);
  }
}

function failure(error) {
  if (error instanceof PublicError) {
    return json({ ok: false, code: error.code, message: error.message }, error.status);
  }
  console.error(JSON.stringify({ event: "BROKER_SCOUTING_SCHEDULE_FAILED",
    type: error?.name ?? "Error" }));
  return json({ ok: false, code: "SCHEDULE_UNAVAILABLE",
    message: "The scouting schedule service is temporarily unavailable. No schedule was changed." }, 503);
}

async function current(pool, tokenId) {
  const result = await pool.query(
    `SELECT enabled, start_at, end_at, timezone, updated_at
       FROM broker_scouting_schedules
      WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
      LIMIT 1`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
  );
  const row = result.rows[0];
  return row ? Object.freeze({ schema: "GOGH_SCOUTING_SCHEDULE_V1", tokenId,
    startAt: new Date(row.start_at).toISOString(), endAt: new Date(row.end_at).toISOString(),
    timezone: row.timezone, enabled: row.enabled === true,
    updatedAt: new Date(row.updated_at).toISOString() }) : null;
}

async function prepare(pool, body) {
  exactBody(body, ["action", "walletAddress", "schedule"], "Prepare request");
  const walletAddress = normalizeWalletAddress(body.walletAddress);
  const normalized = schedule(body.schedule);
  await requireLiveOwner(walletAddress, normalized.tokenId);
  const challengeId = randomUUID();
  const now = new Date();
  const expirationTime = new Date(now.getTime() + CHALLENGE_SECONDS * 1_000);
  const siteUrl = getSiteUrl();
  const message = createSiweMessage({
    address: getAddress(walletAddress), chainId: ROBINHOOD.chainId,
    domain: new URL(siteUrl).host, expirationTime, issuedAt: now,
    nonce: generateSiweNonce(), requestId: challengeId,
    resources: [`${siteUrl}/broker/punk/${normalized.tokenId}#agent`],
    statement: `Save the exact UTC scouting window for Gogh Punk #${normalized.tokenId}. This signature is not a transaction and cannot grant mint authority.`,
    uri: `${siteUrl}/broker/punk/${normalized.tokenId}`, version: "1",
  });
  await pool.query(
    `INSERT INTO broker_scouting_schedule_challenges
      (id, chain_id, collection_address, token_id, wallet_address, message, schedule_json, expires_at)
     VALUES ($1, $2, $3, $4::numeric, $5, $6, $7::jsonb, $8)`,
    [challengeId, ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, normalized.tokenId,
      walletAddress, message, JSON.stringify(normalized), expirationTime],
  );
  return json({ ok: true, action: "SIGN_SCHEDULE", challengeId, message, expirationTime });
}

async function complete(pool, body) {
  exactBody(body, ["action", "challengeId", "walletAddress", "signature"], "Save request");
  if (typeof body.challengeId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(body.challengeId)) {
    throw new PublicError(400, "INVALID_CHALLENGE", "The schedule challenge is invalid.");
  }
  const walletAddress = normalizeWalletAddress(body.walletAddress);
  const result = await pool.query(
    `SELECT token_id, wallet_address, message, schedule_json, expires_at, used_at
       FROM broker_scouting_schedule_challenges WHERE id = $1`, [body.challengeId],
  );
  const challenge = result.rows[0];
  if (!challenge || challenge.used_at || challenge.wallet_address !== walletAddress
    || new Date(challenge.expires_at).getTime() <= Date.now()) {
    throw new PublicError(409, "CHALLENGE_EXPIRED", "The schedule signature request expired.");
  }
  const normalized = schedule(challenge.schedule_json);
  if (normalized.tokenId !== String(challenge.token_id)) {
    throw new PublicError(409, "CHALLENGE_MISMATCH", "The saved schedule challenge is invalid.");
  }
  await verifyWalletSignature({ walletAddress, message: challenge.message, signature: body.signature });
  await requireLiveOwner(walletAddress, normalized.tokenId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockId = (BigInt(ROBINHOOD.chainId) * 10_000n + BigInt(normalized.tokenId)).toString();
    await client.query("SELECT pg_advisory_xact_lock($1)", [lockId]);
    const locked = await client.query(
      `SELECT used_at, expires_at FROM broker_scouting_schedule_challenges
        WHERE id = $1 FOR UPDATE`, [body.challengeId],
    );
    if (!locked.rows[0] || locked.rows[0].used_at
      || new Date(locked.rows[0].expires_at).getTime() <= Date.now()) {
      throw new PublicError(409, "CHALLENGE_EXPIRED", "The schedule signature request expired.");
    }
    await client.query(
      `INSERT INTO broker_scouting_schedules
        (chain_id, collection_address, token_id, owner_snapshot, enabled, start_at, end_at, timezone)
       VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, 'UTC')
       ON CONFLICT (chain_id, collection_address, token_id) DO UPDATE SET
         owner_snapshot = EXCLUDED.owner_snapshot, enabled = EXCLUDED.enabled,
         start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at,
         timezone = EXCLUDED.timezone, updated_at = NOW()`,
      [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, normalized.tokenId,
        walletAddress, normalized.enabled, normalized.startAt, normalized.endAt],
    );
    await client.query("UPDATE broker_scouting_schedule_challenges SET used_at = NOW() WHERE id = $1",
      [body.challengeId]);
    await client.query("COMMIT");
    return json({ ok: true, status: "SCHEDULE_SAVED", schedule: Object.freeze({
      ...normalized, updatedAt: new Date().toISOString(),
    }) });
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
      const tokenId = new URL(request.url).searchParams.get("tokenId") ?? "";
      if (!TOKEN_ID.test(tokenId)) throw new PublicError(400, "INVALID_TOKEN_ID", "Choose a valid Gogh Punk ID.");
      return json({ ok: true, tokenId, schedule: await current(pool, tokenId) });
    }
    if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
    requireSameOrigin(request);
    const body = await readJson(request, 16_384);
    if (body.action === "prepare") return await prepare(pool, body);
    if (body.action === "complete") return await complete(pool, body);
    throw new PublicError(400, "INVALID_ACTION", "Choose a supported schedule action.");
  } catch (error) {
    return failure(error);
  }
}

export const config = { path: "/api/broker/scouting-schedule", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 20, windowSize: 60,
} };
