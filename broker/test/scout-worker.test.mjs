import assert from "node:assert/strict";
import test from "node:test";
import { buildScoutRecommendation } from "../src/scout/recommendation.mjs";
import { runBrokerScout } from "../../scripts/run-broker-scout.mjs";

const OWNER = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";

function opportunity() {
  return {
    id: "seaport:4663:0xabc:0",
    risk_label: "UNKNOWN",
    scores: {
      artScore: 88,
      artConfidence: 40,
      marketScore: 55,
      marketConfidence: 60,
      contractRiskScore: 35,
      contractRiskConfidence: 50,
    },
    metadata: {
      analysisStatus: {
        art: "HEURISTIC",
        market: "OBSERVED_ACTIVITY",
        liquidity: "UNAVAILABLE",
        contract: "HEURISTIC",
      },
      collectionSignals: {
        analyzerVersion: "collection-evidence-v2",
        art: { dimensions: { pixelArt: 95, pfp: 85, onChainArt: 75 } },
      },
    },
  };
}

test("Scout recommendation is deterministic, transparent, and never upgrades unknown risk", () => {
  const first = buildScoutRecommendation({
    tokenId: "1797",
    personaKey: "PIXEL_MAXI",
    opportunity: opportunity(),
  });
  const second = buildScoutRecommendation({
    tokenId: "1797",
    personaKey: "PIXEL_MAXI",
    opportunity: opportunity(),
  });
  assert.deepEqual(first, second);
  assert.equal(first.recommendation, "RESEARCH");
  assert.ok(first.scores.tasteMatch > 0);
  assert.match(first.explanation, /metadata heuristics/i);
  assert.match(first.reasoningHash, /^0x[0-9a-f]{64}$/);
  assert.match(first.agentVersionHash, /^0x[0-9a-f]{64}$/);
  assert.match(first.id, /^[0-9a-f-]{36}$/);
});

test("Scout never upgrades a completed sale or unverified mint signal into a collect action", () => {
  const historical = opportunity();
  historical.risk_label = "LOWER_RISK";
  historical.metadata.actionableListing = false;
  historical.scores.contractRiskScore = 10;
  historical.scores.contractRiskConfidence = 95;
  const result = buildScoutRecommendation({
    tokenId: "1797",
    personaKey: "PIXEL_MAXI",
    opportunity: historical,
  });
  assert.equal(result.recommendation, "RESEARCH");
  assert.match(result.explanation, /not a verified executable opportunity/i);
});

test("Scout worker pins ownership to a confirmed block and writes read-only recommendations", async () => {
  const calls = [];
  const saved = [];
  const source = {
    async call(method, params) {
      calls.push({ method, params });
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_blockNumber") return "0x64";
      if (method === "eth_call") return `0x${"0".repeat(24)}${OWNER.slice(2)}`;
      throw new Error(`unexpected ${method}`);
    },
  };
  const repository = {
    async upsertPunk(value) {
      assert.equal(value.ownerBlock, "80");
      assert.equal(value.owner, OWNER);
      return { account_address: null };
    },
    async analyzedOpportunities(limit) {
      assert.equal(limit, 24);
      return [opportunity()];
    },
    async saveRecommendation(value) {
      saved.push(value);
    },
  };
  const result = await runBrokerScout({
    environment: {
      BROKER_SCOUT_ENABLED: "true",
      BROKER_SCOUT_TOKEN_ID: "1797",
      BROKER_SCOUT_PERSONA: "PIXEL_MAXI",
      BROKER_CONFIRMATIONS: "20",
    },
    repository,
    source,
  });
  assert.equal(result.executionEnabled, false);
  assert.equal(result.ownerBlock, "80");
  assert.equal(result.recommendationsSaved, 1);
  assert.equal(saved.length, 1);
  assert.deepEqual(calls.at(-1).params.at(-1), "0x50");
});

test("Scout worker fails closed if any transaction feature is enabled", async () => {
  await assert.rejects(
    () => runBrokerScout({
      environment: {
        BROKER_SCOUT_ENABLED: "true",
        BROKER_SCOUT_TOKEN_ID: "1797",
        ENABLE_APPROVAL_PURCHASES: "true",
      },
      repository: {},
      source: {},
    }),
    /execution feature is enabled/,
  );
});

test("Scout records an advisory per-Punk mint decision without enabling execution", () => {
  const mint = opportunity();
  mint.id = "mint:4663:0xabc:1";
  mint.opportunity_type = "FREE_MINT";
  mint.collection_address = "0x1111111111111111111111111111111111111111";
  mint.expected_price = "0";
  mint.risk_label = "LOWER_RISK";
  mint.metadata.actionableMint = true;
  mint.metadata.mintPriceStatus = "KNOWN";
  mint.metadata.mintContract = "0x2222222222222222222222222222222222222222";
  mint.scores.contractRiskScore = 10;
  const result = buildScoutRecommendation({
    tokenId: "1797",
    personaKey: "PIXEL_MAXI",
    opportunity: mint,
    mandate: {
      tokenId: "1797",
      version: 3,
      mode: "APPROVAL_REQUIRED",
      economicSettings: {
        inspectMints: true,
        allowFreeMints: true,
        allowPaidMints: false,
        maxMintsPerDay: 1,
      },
      riskSettings: { maxContractRiskScore: 30 },
      artisticPreferences: { minimumTasteMatch: 0 },
    },
  });
  assert.equal(result.publicDetail.mintInterest.wantsToJoin, true);
  assert.equal(result.publicDetail.mintInterest.decision, "OWNER_APPROVAL_REQUIRED");
  assert.equal(result.publicDetail.mintInterest.autonomousEligible, false);
  assert.equal(result.policyVersion, 3);
});
