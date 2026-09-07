import assert from "node:assert/strict";
import test from "node:test";

import { defaultAskIntent } from "../broker/src/v4/collecting-intent.mjs";
import { resolveV2PunkChat } from "../netlify/functions/broker-v2-chat.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const WALLET = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-09-07T16:00:00.000Z");
const currentIntent = defaultAskIntent({ punkTokenId: "93", expectedOwner: OWNER,
  punkWallet: WALLET }, NOW);
const authority = { punkWallet: WALLET, nativeBalanceWei: "200000000000000", activated: true };

test("production chat routes a natural mint mission through the deterministic parser", async () => {
  const result = await resolveV2PunkChat({ router: { run: async () => {
    throw new Error("mission commands must not require an AI provider");
  } }, ownerMessage: "yooo i want you to find some free mints, find me 5 and mint 5 please",
  currentIntent, tokenId: "93", authority, owner: OWNER, now: NOW });
  assert.equal(result.responseKind, "STRATEGY_DRAFT");
  assert.equal(result.provider.provider, "DETERMINISTIC_REVIEW_PARSER");
  assert.equal(result.draft.intent.mintMode, "FREE_ONLY");
  assert.equal(result.draft.intent.dailyMintLimit, 5);
  assert.equal(result.draft.intent.totalMintLimit, 5);
  assert.match(result.reply, /5 MAX PER DAY\. 5 MAX FOR THIS STRATEGY/);
});

test("production chat sends ordinary questions to AI and preserves a safe fallback", async () => {
  const answered = await resolveV2PunkChat({ router: { run: async () => ({
    text: "Pixel art makes every block earn its place.", provider: "GEMINI",
    registryKey: "gemini:auto",
  }) }, ownerMessage: "What do you think about pixel art?", currentIntent,
  tokenId: "93", authority, owner: OWNER, now: NOW });
  assert.equal(answered.responseKind, "CONVERSATION");
  assert.equal(answered.provider.provider, "GEMINI");
  assert.match(answered.reply, /every block/);

  const fallback = await resolveV2PunkChat({ router: { run: async () => {
    throw new Error("provider unavailable");
  } }, ownerMessage: "What do you think about pixel art?", currentIntent,
  tokenId: "93", authority, owner: OWNER, now: NOW });
  assert.equal(fallback.responseKind, "CONVERSATION");
  assert.equal(fallback.providerAvailable, false);
  assert.match(fallback.reply, /Pixel art rewards clarity/);
});
