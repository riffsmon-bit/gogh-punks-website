import { createHash, randomUUID } from "node:crypto";

import { getDatabase } from "@netlify/database";

import { canonicalJson } from "../scout/canonical-json.mjs";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const TOKEN_ID = /^(?:0|[1-9][0-9]{0,3})$/;
const INTENT_ID = /^dmi_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TTL_MS = 5 * 60_000;

export class DirectedMintIntentError extends Error {
  constructor(code, message) { super(message); this.name = "DirectedMintIntentError"; this.code = code; }
}

function fail(code, message) { throw new DirectedMintIntentError(code, message); }
function address(value) {
  if (typeof value !== "string" || !ADDRESS.test(value.toLowerCase())) {
    fail("INVALID_INTENT", "Directed mint wallet identity is invalid.");
  }
  return value.toLowerCase();
}
function tokenId(value) {
  if (typeof value !== "string" || !TOKEN_ID.test(value)) {
    fail("INVALID_INTENT", "Directed mint Punk identity is invalid.");
  }
  return value;
}
function intentId(value) {
  if (typeof value !== "string" || !INTENT_ID.test(value)) {
    fail("INVALID_INTENT", "Directed mint intent is invalid.");
  }
  return value;
}
function exactReview(review) {
  if (!review || typeof review !== "object" || Array.isArray(review)
    || typeof review.reviewId !== "string" || !/^osr_[0-9a-f]{64}$/.test(review.reviewId)
    || typeof review.sourceUrl !== "string" || review.sourceUrl.length > 2_048
    || review.executionReady !== false) {
    fail("INVALID_INTENT", "Directed mint review is invalid.");
  }
  return structuredClone(review);
}
function digest(review) {
  // PostgreSQL JSONB does not preserve object-key insertion order. Hash the
  // strict canonical representation so a genuine row survives a DB round-trip
  // while any semantic mutation still fails the integrity check.
  return createHash("sha256").update(canonicalJson(review)).digest("hex");
}

export async function createDirectedMintIntent({ review, walletAddress, punkTokenId }, {
  database, nowMs = Date.now(), id = `dmi_${randomUUID()}`,
} = {}) {
  const storedReview = exactReview(review);
  const wallet = address(walletAddress);
  const punk = tokenId(punkTokenId);
  const selectedId = intentId(id);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail("INVALID_INTENT", "Intent time is invalid.");
  const expiresAt = new Date(nowMs + TTL_MS).toISOString();
  const pool = database ?? getDatabase().pool;
  await pool.query(
    `INSERT INTO broker_directed_mint_intents
       (intent_id, wallet_address, punk_token_id, source_url, review_id,
        review_sha256, review_body, expires_at)
     VALUES ($1, $2, $3::numeric, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
    [selectedId, wallet, punk, storedReview.sourceUrl, storedReview.reviewId,
      digest(storedReview), JSON.stringify(storedReview), expiresAt],
  );
  return Object.freeze({ intentId: selectedId, expiresAt, reviewId: storedReview.reviewId });
}

export async function consumeDirectedMintIntent({ intentId: rawId, walletAddress,
  punkTokenId }, { database, nowMs = Date.now() } = {}) {
  const selectedId = intentId(rawId);
  const wallet = address(walletAddress);
  const punk = tokenId(punkTokenId);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail("INVALID_INTENT", "Intent time is invalid.");
  const pool = database ?? getDatabase().pool;
  const result = await pool.query(
    `UPDATE broker_directed_mint_intents
        SET consumed_at = $4::timestamptz
      WHERE intent_id = $1 AND wallet_address = $2 AND punk_token_id = $3::numeric
        AND consumed_at IS NULL AND expires_at > $4::timestamptz
      RETURNING intent_id, wallet_address, punk_token_id::text AS punk_token_id,
                source_url, review_id, review_sha256, review_body, expires_at, consumed_at`,
    [selectedId, wallet, punk, new Date(nowMs).toISOString()],
  );
  const row = result.rows?.[0];
  if (!row) fail("INTENT_EXPIRED", "This mint review expired or was already used. Check the mint again.");
  const review = typeof row.review_body === "string" ? JSON.parse(row.review_body) : row.review_body;
  if (digest(review) !== row.review_sha256 || review.reviewId !== row.review_id
    || review.sourceUrl !== row.source_url) {
    fail("INTENT_TAMPERED", "Stored mint review failed its integrity check.");
  }
  return Object.freeze({
    intentId: row.intent_id,
    walletAddress: row.wallet_address,
    punkTokenId: row.punk_token_id,
    sourceUrl: row.source_url,
    reviewId: row.review_id,
    review: Object.freeze(structuredClone(review)),
    expiresAt: new Date(row.expires_at).toISOString(),
    consumedAt: new Date(row.consumed_at).toISOString(),
  });
}
