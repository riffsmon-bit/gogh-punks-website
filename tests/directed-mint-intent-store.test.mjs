import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeDirectedMintIntent, createDirectedMintIntent,
} from "../broker/src/connector/directed-mint-intent-store.mjs";

const OWNER = `0x${"1".repeat(40)}`;
const ID = "dmi_11111111-1111-4111-8111-111111111111";
const REVIEW = Object.freeze({ reviewId: `osr_${"a".repeat(64)}`,
  sourceUrl: "https://opensea.io/drops/example", executionReady: false });

test("directed mint intent persists a bounded single-use review without authority", async () => {
  let inserted;
  const database = { query: async (sql, values) => {
    inserted = { sql, values };
    return { rows: [] };
  } };
  const intent = await createDirectedMintIntent({ review: REVIEW,
    walletAddress: OWNER, punkTokenId: "93" }, {
    database, nowMs: Date.parse("2026-08-29T05:00:00Z"), id: ID,
  });
  assert.equal(intent.intentId, ID);
  assert.equal(intent.expiresAt, "2026-08-29T05:05:00.000Z");
  assert.match(inserted.sql, /broker_directed_mint_intents/);
  assert.doesNotMatch(inserted.sql, /private_key|signature|calldata/i);
  assert.equal(inserted.values[1], OWNER);
});

test("intent consumption is atomic, identity-bound, expiring, and integrity checked", async () => {
  const now = Date.parse("2026-08-29T05:01:00Z");
  const record = {
    intent_id: ID, wallet_address: OWNER, punk_token_id: "93",
    source_url: REVIEW.sourceUrl, review_id: REVIEW.reviewId,
    review_sha256: "1d0e6c95c4d28ff79d5c76d9e94b7c46be10d8d28272caa0ac2dec999a5c81b4",
    review_body: REVIEW, expires_at: "2026-08-29T05:05:00Z",
    consumed_at: new Date(now).toISOString(),
  };
  // Use the hash produced by the creation query instead of duplicating canonicalization here.
  let hash;
  await createDirectedMintIntent({ review: REVIEW, walletAddress: OWNER, punkTokenId: "93" }, {
    database: { query: async (_sql, values) => { hash = values[5]; return { rows: [] }; } },
    nowMs: now, id: ID,
  });
  record.review_sha256 = hash;
  // JSONB may return keys in a different order than the inserted object.
  record.review_body = { sourceUrl: REVIEW.sourceUrl, executionReady: false,
    reviewId: REVIEW.reviewId };
  const consumed = await consumeDirectedMintIntent({ intentId: ID,
    walletAddress: OWNER, punkTokenId: "93" }, {
    database: { query: async (sql, values) => {
      assert.match(sql, /consumed_at IS NULL/);
      assert.deepEqual(values.slice(0, 3), [ID, OWNER, "93"]);
      return { rows: [record] };
    } }, nowMs: now,
  });
  assert.equal(consumed.reviewId, REVIEW.reviewId);

  await assert.rejects(consumeDirectedMintIntent({ intentId: ID,
    walletAddress: OWNER, punkTokenId: "93" }, {
    database: { query: async () => ({ rows: [] }) }, nowMs: now,
  }), /expired or was already used/);
});
