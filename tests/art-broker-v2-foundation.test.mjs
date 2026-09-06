import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectingIntentConfirmation,
  defaultAskIntent,
  normalizePunkCollectingIntent,
  punkCollectingIntentHash,
} from "../broker/src/v4/collecting-intent.mjs";
import {
  assertV2ExecutionCapability,
  transitionV2ExecutionAttempt,
  v2ExecutionIdentity,
} from "../broker/src/v4/execution-boundary.mjs";
import { normalizeV2Opportunity } from "../broker/src/v4/opportunity.mjs";
import { matchV2Opportunity } from "../broker/src/v4/policy-matcher.mjs";

const NOW = new Date("2026-09-06T12:00:00Z");
const OWNER = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
const ADAPTER = "0x3333333333333333333333333333333333333333";
const COLLECTION = "0x4444444444444444444444444444444444444444";
const MINT = "0x5555555555555555555555555555555555555555";
const CODE_HASH = `0x${"66".repeat(32)}`;

function intent(overrides = {}) {
  return {
    ...defaultAskIntent({ punkTokenId: "119", expectedOwner: OWNER, punkWallet: ACCOUNT }, NOW),
    operatingMode: "AUTONOMOUS",
    dailyMintLimit: 3,
    totalMintLimit: 10,
    minimumReserveWei: "10000000000000000",
    maximumCollectionSupply: 2_000,
    preferences: { prefer: ["PIXEL_ART"], avoid: ["ANIME"] },
    requiresWebsite: true,
    requiresSocial: true,
    preferredSocialPlatforms: ["X"],
    allowedAdapters: [ADAPTER],
    riskThreshold: 25,
    ...overrides,
  };
}

function opportunity(overrides = {}) {
  return {
    schema: "GOGH_NORMALIZED_OPPORTUNITY_V2",
    version: 2,
    opportunityId: "seadrop:4444:public",
    chainId: 4663,
    collectionContract: COLLECTION,
    mintContract: MINT,
    adapter: ADAPTER,
    mintStage: "PUBLIC",
    mintMethod: "mintPublic(address,address,address,uint256)",
    priceWei: "0",
    estimatedGasCostWei: "180000000000000",
    supply: 777,
    walletLimit: 1,
    startTime: "2026-09-06T11:00:00Z",
    endTime: "2026-09-07T11:00:00Z",
    website: "https://example.test",
    socialUrls: { x: "https://x.com/example", discord: null, farcaster: null },
    sourceUrls: ["https://opensea.io/collection/example"],
    artStyles: ["PIXEL_ART", "CYBERPUNK"],
    imageReference: "https://i.seadn.io/example.png",
    collectionName: "Neon Alley",
    contractCodeHash: CODE_HASH,
    adapterCodeHash: CODE_HASH,
    screeningStatus: "PASSED",
    simulationStatus: "PASSED",
    riskLevel: "LOW",
    riskScore: 12,
    expectedNftReceiver: ACCOUNT,
    unexpectedApprovals: false,
    unexpectedTransfers: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

test("new Punk strategies default to ASK and require explicit confirmation", () => {
  const draft = defaultAskIntent({ punkTokenId: "119", expectedOwner: OWNER, punkWallet: ACCOUNT }, NOW);
  assert.equal(draft.operatingMode, "ASK");
  assert.equal(draft.mintMode, "FREE_ONLY");
  assert.equal(draft.maxMintPriceWei, "0");
  const card = collectingIntentConfirmation(draft, NOW);
  assert.equal(card.activationRequired, true);
  assert.match(card.intentHash, /^0x[0-9a-f]{64}$/);
  assert.equal(card.title, "YOUR PUNK UNDERSTANDS");
});

test("structured policy is canonical, deterministic, and rejects unsafe ambiguity", () => {
  const normalized = normalizePunkCollectingIntent(intent(), NOW);
  assert.equal(punkCollectingIntentHash(normalized, NOW), punkCollectingIntentHash(intent(), NOW));
  assert.throws(() => normalizePunkCollectingIntent({ ...intent(), surprise: true }, NOW), /unknown/);
  assert.throws(() => normalizePunkCollectingIntent(intent({ requireSimulation: false }), NOW), /requires simulation/);
  assert.throws(() => normalizePunkCollectingIntent(intent({ maxMintPriceWei: "1" }), NOW), /free-only/);
});

test("normalized opportunities deduplicate source sightings by the mint stage identity", () => {
  const first = normalizeV2Opportunity(opportunity({ sourceUrls: ["https://x.com/example"] }), NOW);
  const second = normalizeV2Opportunity(opportunity({ sourceUrls: ["https://example.test"] }), NOW);
  assert.equal(first.dedupeKey, second.dedupeKey);
  assert.notDeepEqual(first.sourceUrls, second.sourceUrls);
  assert.throws(() => normalizeV2Opportunity(opportunity({ website: "http://127.0.0.1/mint" }), NOW), /website/);
  assert.throws(() => normalizeV2Opportunity(opportunity({ socialUrls: {
    x: "https://evil.example/not-x", discord: null, farcaster: null } }), NOW), /X URL/);
  assert.throws(() => normalizeV2Opportunity(opportunity({ endTime: "2026-09-06T10:00:00Z" }), NOW), /time window/);
});

test("deterministic matcher explains a safe preference match", () => {
  const result = matchV2Opportunity(intent(), opportunity(), {
    punkWalletBalanceWei: "30000000000000000",
    dailyMints: 0,
    totalMints: 0,
    currentOwner: OWNER,
    punkWallet: ACCOUNT,
  }, NOW);
  assert.equal(result.matched, true);
  assert.equal(result.matchScore, 95);
  assert.ok(result.matchReasons.includes("Preferred pixel art"));
});

test("default ASK treats adapter choices as protocol-screened unless the owner narrows them", () => {
  const result = matchV2Opportunity(intent({ operatingMode: "ASK", allowedAdapters: [] }),
    opportunity(), {
      punkWalletBalanceWei: "30000000000000000",
      dailyMints: 0,
      totalMints: 0,
      currentOwner: OWNER,
      punkWallet: ACCOUNT,
    }, NOW);
  assert.equal(result.matched, true);
  assert.equal(result.recommendationEligible, true);

  const restricted = matchV2Opportunity(intent({ operatingMode: "ASK",
    allowedAdapters: ["0x7777777777777777777777777777777777777777"] }), opportunity(), {
    punkWalletBalanceWei: "30000000000000000",
    dailyMints: 0,
    totalMints: 0,
    currentOwner: OWNER,
    punkWallet: ACCOUNT,
  }, NOW);
  assert.equal(restricted.matched, false);
  assert.ok(restricted.reasons.includes("ADAPTER_NOT_ALLOWED"));
});

test("policy matching fails closed on owner, reserve, gas, recipient, safety, and taste", () => {
  const result = matchV2Opportunity(intent({ maxGasPerMintWei: "10" }), opportunity({
    screeningStatus: "NEEDS_REVIEW",
    simulationStatus: "FAILED",
    expectedNftReceiver: OWNER,
    unexpectedApprovals: true,
    artStyles: ["ANIME"],
  }), {
    punkWalletBalanceWei: "1",
    dailyMints: 3,
    totalMints: 10, opportunityMints: 1,
    currentOwner: ACCOUNT,
    punkWallet: ACCOUNT,
  }, NOW);
  for (const reason of ["OWNER_CHANGED", "WRONG_RECIPIENT", "SCREENING_NOT_PASSED",
    "SIMULATION_NOT_PASSED", "UNEXPECTED_APPROVAL", "GAS_LIMIT_EXCEEDED",
    "DAILY_LIMIT_REACHED", "TOTAL_LIMIT_REACHED", "WALLET_LIMIT_REACHED", "AVOIDED_STYLE",
    "MINIMUM_RESERVE_VIOLATION"]) assert.ok(result.reasons.includes(reason), reason);
  assert.equal(result.matched, false);
});

test("no-deployment execution boundary keeps V2 autonomy disabled", () => {
  assert.equal(assertV2ExecutionCapability("ASK").submits, false);
  assert.equal(assertV2ExecutionCapability("ASSIST").ownerConfirmation, true);
  assert.throws(() => assertV2ExecutionCapability("AUTONOMOUS"), (error) => (
    error.code === "SELF_FUNDED_AUTONOMOUS_GAS_UNSUPPORTED_BY_DEPLOYED_ACCOUNT"
  ));
  assert.throws(() => assertV2ExecutionCapability("ASSIST", { production: true }), (error) => (
    error.code === "V2_PRODUCTION_AUTHORIZATION_REQUIRED"
  ));
});

test("execution attempts have durable identity and monotonic transitions", () => {
  const idempotencyKey = v2ExecutionIdentity({
    chainId: 4663,
    punkWallet: ACCOUNT,
    opportunityId: "seadrop:4444:public",
    strategyHash: `0x${"77".repeat(32)}`,
    accountNonce: "4",
    operatingMode: "ASSIST",
  });
  const reserved = { idempotencyKey, state: "RESERVED", updatedAt: NOW.toISOString() };
  const simulated = transitionV2ExecutionAttempt(reserved, "SIMULATED", NOW);
  assert.equal(simulated.state, "SIMULATED");
  assert.throws(() => transitionV2ExecutionAttempt(simulated, "CONFIRMED", NOW), /invalid/);
});

test("V2 migration is additive, lane-free, and never stores signing material", async () => {
  const sql = (await Promise.all([
    readFile(new URL("../netlify/database/migrations/20260906010000_create_art_broker_v2.sql",
      import.meta.url), "utf8"),
    readFile(new URL("../netlify/database/migrations/20260906020000_add_v2_discovery_ingestion.sql",
      import.meta.url), "utf8"),
  ])).join("\n");
  for (const table of ["broker_v2_profiles", "broker_v2_strategies",
    "broker_v2_conversations", "broker_v2_opportunities", "broker_v2_execution_attempts",
    "broker_v2_model_registry", "broker_v2_provider_usage",
    "broker_v2_discovery_checkpoints"]) assert.match(sql, new RegExp(table));
  assert.doesNotMatch(sql, /private_key|seed_phrase|hosted_lane|priority_lane/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});
