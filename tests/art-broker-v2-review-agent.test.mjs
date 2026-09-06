import assert from "node:assert/strict";
import test from "node:test";

import {
  activateReviewAgent, normalizeReviewAgentRun, pauseReviewAgent, reviewAgentKey,
  reviewInspectionPipeline,
} from "../site/broker-v2-review-agent.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const PUNK_WALLET = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-09-06T18:00:00.000Z");

function draft(overrides = {}) {
  return { intentHash: `0x${"ab".repeat(32)}`, intent: {
    schema: "PUNK_COLLECTING_INTENT_V1", version: 1, chainId: 4663,
    punkTokenId: "93", expectedOwner: OWNER, punkWallet: PUNK_WALLET,
    operatingMode: "ASK", preferences: { prefer: ["PIXEL_ART"], avoid: [] },
    expiration: "2026-10-06T18:00:00.000Z", ...overrides,
  } };
}

test("review agents bind one confirmed ASK or ASSIST strategy to the selected Punk", () => {
  const agent = activateReviewAgent(draft({ operatingMode: "ASSIST" }), {
    owner: OWNER, punkTokenId: "93", punkWallet: PUNK_WALLET,
  }, NOW);
  assert.equal(reviewAgentKey(OWNER, "93"), `${OWNER}:93`);
  assert.equal(agent.mode, "ASSIST");
  assert.equal(agent.status, "ACTIVE");
  assert.equal(agent.reviewOnly, true);
  assert.equal(agent.authority, "NONE");
  assert.equal(Object.isFrozen(agent.intent), true);
  assert.equal(Object.isFrozen(agent.intent.preferences), true);
  assert.equal(Object.isFrozen(agent.intent.preferences.prefer), true);
  assert.equal(pauseReviewAgent(agent, new Date(NOW.getTime() + 1_000)).status, "PAUSED");
});

test("review agents reject autonomy, ownership drift, wallet drift, and expired drafts", () => {
  const selection = { owner: OWNER, punkTokenId: "93", punkWallet: PUNK_WALLET };
  assert.throws(() => activateReviewAgent(draft({ operatingMode: "AUTONOMOUS" }), selection, NOW), /match/);
  assert.throws(() => activateReviewAgent(draft({ expectedOwner: PUNK_WALLET }), selection, NOW), /match/);
  assert.throws(() => activateReviewAgent(draft({ punkWallet: OWNER }), selection, NOW), /match/);
  assert.throws(() => activateReviewAgent(draft({ expiration: NOW.toISOString() }), selection, NOW), /expired/);
});

test("review inspection stages never invent screening, simulation, or execution", () => {
  assert.deepEqual(reviewInspectionPipeline(null), {
    discovery: "WAITING", contract: "NOT IDENTIFIED", screening: "NOT RUN",
    simulation: "NOT RUN", decision: "NO OPPORTUNITY",
  });
  assert.deepEqual(reviewInspectionPipeline({ status: "NEEDS_REVIEW",
    link: { kind: "OPENSEA_COLLECTION" } }), {
    discovery: "LINK NORMALIZED", contract: "NOT IDENTIFIED", screening: "NOT RUN",
    simulation: "NOT RUN", decision: "NEEDS REVIEW",
  });
});

test("review-run responses are reduced to bounded display-only evidence", () => {
  const run = normalizeReviewAgentRun({ ok: true, reviewOnly: true, authority: "NONE",
    tokenId: "93", checkedCount: 1, eligibleCount: 1, screeningPassedCount: 1,
    simulationPassedCount: 1, transactionPrepared: false, executionAttemptCreated: false,
    testMode: null, testOpportunityCount: 0,
    opportunities: [{ previewFixture: false, opportunity: { collectionContract: PUNK_WALLET,
      collectionName: "Neon Alley", screeningStatus: "PASSED", simulationStatus: "PASSED" },
    match: { recommendationEligible: true, matchScore: 94 } }],
  }, "93");
  assert.equal(run.opportunities[0].collectionName, "Neon Alley");
  assert.equal(run.opportunities[0].previewFixture, false);
  assert.equal(Object.hasOwn(run.opportunities[0], "transaction"), false);
  assert.throws(() => normalizeReviewAgentRun({ ...run, ok: true, reviewOnly: true,
    authority: "EXECUTE", tokenId: "93", transactionPrepared: false,
    executionAttemptCreated: false }, "93"), /invalid/);
});
