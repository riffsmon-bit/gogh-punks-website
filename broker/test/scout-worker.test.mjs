import assert from "node:assert/strict";
import test from "node:test";
import { ROBINHOOD } from "../src/config.mjs";
import { buildScoutRecommendation } from "../src/scout/recommendation.mjs";
import { runBrokerScout } from "../../scripts/run-broker-scout.mjs";

const OWNER = "0x1234567890123456789012345678901234567890";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const FACADE = "0x2222222222222222222222222222222222222222";
const IMPLEMENTATION = "0x3333333333333333333333333333333333333333";
const CONFIRMED_HASH = `0x${"ab".repeat(32)}`;
const NOW = new Date("2026-08-20T14:00:00.000Z");

function addressResult(address) {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

function deployedManifest() {
  return {
    status: "DEPLOYED",
    chain: { chainId: ROBINHOOD.chainId },
    canonicalCollection: ROBINHOOD.canonicalCollection,
    canonicalERC6551Registry: ROBINHOOD.canonicalERC6551Registry,
    accountSalt: `0x${"00".repeat(32)}`,
    contracts: {
      GoghPunkAccountRegistry: {
        address: FACADE,
        deploymentBlock: 10,
        implementationVersion: "1",
      },
      GoghPunkAccountV1: {
        address: IMPLEMENTATION,
        deploymentBlock: 9,
        implementationVersion: "1",
      },
    },
  };
}

function reconciliationSource({
  head = 100n,
  account = ACCOUNT,
  code = "0x6000",
  blockHash = CONFIRMED_HASH,
  timestamp = BigInt(Math.floor(NOW.getTime() / 1_000)),
} = {}) {
  return {
    async call(method, params) {
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_blockNumber") return `0x${head.toString(16)}`;
      if (method === "eth_getBlockByNumber") {
        return {
          number: params[0],
          hash: blockHash,
          timestamp: `0x${timestamp.toString(16)}`,
        };
      }
      if (method === "eth_call") {
        return params[0].to.toLowerCase() === ROBINHOOD.canonicalCollection
          ? addressResult(OWNER)
          : addressResult(account);
      }
      if (method === "eth_getCode") return code;
      throw new Error(`unexpected ${method}`);
    },
  };
}

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
    tokenId: "4242",
    personaKey: "PIXEL_MAXI",
    opportunity: opportunity(),
  });
  const second = buildScoutRecommendation({
    tokenId: "4242",
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
    tokenId: "4242",
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
      BROKER_SCOUT_TOKEN_ID: "4242",
      BROKER_SCOUT_PERSONA: "PIXEL_MAXI",
      BROKER_CONFIRMATIONS: "20",
    },
    repository,
    source,
    deployment: { status: "NOT_DEPLOYED" },
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
        BROKER_SCOUT_TOKEN_ID: "4242",
        ENABLE_APPROVAL_PURCHASES: "true",
      },
      repository: {},
      source: {},
    }),
    /execution feature is enabled/,
  );
});

test("deployed Scout reconciles a permissionlessly pre-created account at one confirmed block", async () => {
  const upserts = [];
  const repository = {
    async upsertPunk(value) {
      upserts.push(value);
      return { account_address: value.accountAddress };
    },
    async analyzedOpportunities() { return []; },
  };
  const result = await runBrokerScout({
    environment: {
      BROKER_SCOUT_ENABLED: "true",
      BROKER_SCOUT_TOKEN_ID: "4242",
      BROKER_CONFIRMATIONS: "20",
    },
    repository,
    source: reconciliationSource(),
    secondarySource: reconciliationSource(),
    deployment: deployedManifest(),
    clock: () => NOW,
  });
  assert.equal(result.accountAddress, ACCOUNT);
  assert.equal(upserts[0].accountAddress, ACCOUNT);
  assert.equal(upserts[0].accountVersion, "1");
  assert.equal(upserts[0].accountObservedBlock, "80");
  assert.equal(upserts[0].accountObservedBlockHash, CONFIRMED_HASH);
});

test("deployed Scout does not bind an uncreated deterministic account", async () => {
  let observed;
  const result = await runBrokerScout({
    environment: {
      BROKER_SCOUT_ENABLED: "true",
      BROKER_SCOUT_TOKEN_ID: "4242",
      BROKER_CONFIRMATIONS: "20",
    },
    repository: {
      async upsertPunk(value) {
        observed = value;
        return { account_address: null };
      },
      async analyzedOpportunities() { return []; },
    },
    source: reconciliationSource({ code: "0x" }),
    secondarySource: reconciliationSource({ code: "0x" }),
    deployment: deployedManifest(),
    clock: () => NOW,
  });
  assert.equal(result.accountAddress, null);
  assert.equal(observed.accountAddress, null);
  assert.equal(observed.accountObservedBlockHash, null);
});

test("deployed Scout rejects RPC account disagreement, excessive head skew, and stale blocks", async () => {
  const options = {
    environment: {
      BROKER_SCOUT_ENABLED: "true",
      BROKER_SCOUT_TOKEN_ID: "4242",
      BROKER_CONFIRMATIONS: "20",
    },
    repository: {},
    source: reconciliationSource(),
    deployment: deployedManifest(),
    clock: () => NOW,
  };
  await assert.rejects(
    () => runBrokerScout({
      ...options,
      environment: { ...options.environment, BROKER_CONFIRMATIONS: "11" },
      secondarySource: reconciliationSource(),
    }),
    /requires at least 12 confirmations/,
  );
  await assert.rejects(
    () => runBrokerScout({
      ...options,
      secondarySource: reconciliationSource({
        account: "0x4444444444444444444444444444444444444444",
      }),
    }),
    /disagree on the deterministic Punk Account/,
  );
  await assert.rejects(
    () => runBrokerScout({
      ...options,
      secondarySource: reconciliationSource({ head: 90n }),
    }),
    /head skew exceeds 8/,
  );
  await assert.rejects(
    () => runBrokerScout({
      ...options,
      source: reconciliationSource({
        timestamp: BigInt(Math.floor(NOW.getTime() / 1_000)) - 601n,
      }),
      secondarySource: reconciliationSource({
        timestamp: BigInt(Math.floor(NOW.getTime() / 1_000)) - 601n,
      }),
    }),
    /timestamp is stale/,
  );
});

test("Scout records an advisory per-Punk mint decision without enabling execution", () => {
  const mint = opportunity();
  mint.id = "mint:4663:0xabc:1";
  mint.chainId = 4663;
  mint.opportunity_type = "FREE_MINT";
  mint.collection_address = "0x1111111111111111111111111111111111111111";
  mint.expected_price = "0";
  mint.risk_label = "LOWER_RISK";
  mint.metadata.actionableMint = true;
  mint.metadata.mintPriceStatus = "KNOWN";
  mint.metadata.mintContract = "0x2222222222222222222222222222222222222222";
  mint.scores.contractRiskScore = 10;
  const result = buildScoutRecommendation({
    tokenId: "4242",
    personaKey: "PIXEL_MAXI",
    opportunity: mint,
    mandate: {
      tokenId: "4242",
      configuredBy: OWNER,
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
      mintPermissions: {
        approvedMintContracts: ["0x2222222222222222222222222222222222222222"],
        approvedCollections: ["0x1111111111111111111111111111111111111111"],
      },
    },
    decisionControls: {
      acquisitionsToday: 0,
      proposalSupported: true,
      targetInspectionValidated: true,
      ownerMandateCurrent: true,
      policySnapshotValidated: true,
      expectedOwner: OWNER,
    },
  });
  assert.equal(result.publicDetail.mintInterest.wantsToJoin, true);
  assert.equal(result.publicDetail.mintInterest.decision, "PROPOSE");
  assert.equal(result.mintDecision, "PROPOSE");
  assert.equal(result.recommendation, "RECOMMEND");
  assert.ok(result.publicDetail.curatorialSignal.recommendation);
  assert.equal(result.publicDetail.recommendation, "RECOMMEND");
  assert.equal(result.publicDetail.mintInterest.autonomousEligible, false);
  assert.equal(result.publicDetail.mintInterest.executionEnabled, false);
  assert.equal(result.policyVersion, 3);
});

test("per-Punk mandate dimensions drive Taste Match and the final mint state", () => {
  const mint = opportunity();
  mint.id = "mint:4663:0xabc:dimensions";
  mint.chainId = 4663;
  mint.opportunity_type = "FREE_MINT";
  mint.collection_address = "0x1111111111111111111111111111111111111111";
  mint.expected_price = "0";
  mint.risk_label = "LOWER_RISK";
  mint.metadata.actionableMint = true;
  mint.metadata.mintPriceStatus = "KNOWN";
  mint.metadata.mintContract = "0x2222222222222222222222222222222222222222";
  mint.scores.contractRiskScore = 10;

  const shared = {
    mode: "SCOUT",
    economicSettings: { allowFreeMints: true, maxMintsPerDay: 1 },
    riskSettings: { maxContractRiskScore: 30 },
    artisticPreferences: { minimumTasteMatch: 80 },
  };
  const pixel = buildScoutRecommendation({
    tokenId: "1",
    personaKey: "PIXEL_MAXI",
    opportunity: mint,
    mandate: {
      ...shared,
      tokenId: "1",
      configuredBy: OWNER,
      artisticPreferences: { minimumTasteMatch: 80, dimensions: { pixelArt: 100 } },
    },
    decisionControls: { acquisitionsToday: 0, expectedOwner: OWNER },
  });
  const photography = buildScoutRecommendation({
    tokenId: "2",
    personaKey: "PIXEL_MAXI",
    opportunity: mint,
    mandate: {
      ...shared,
      tokenId: "2",
      configuredBy: OWNER,
      artisticPreferences: { minimumTasteMatch: 80, dimensions: { photography: 100 } },
    },
    decisionControls: { acquisitionsToday: 0, expectedOwner: OWNER },
  });
  assert.equal(pixel.publicDetail.tasteProfileSource, "MANDATE_DIMENSIONS");
  assert.equal(pixel.scores.tasteMatch, 95);
  assert.equal(pixel.mintDecision, "RECOMMEND");
  assert.equal(photography.scores.tasteMatch, 0);
  assert.equal(photography.mintDecision, "WATCH");
  assert.match(photography.explanation, /Taste Match is below/i);
});
