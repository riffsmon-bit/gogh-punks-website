import assert from "node:assert/strict";
import test from "node:test";

import {
  activateReviewAgent, dispatchReviewAgent, normalizeReviewAgentRun,
  normalizeReviewAgentSnapshot, pauseReviewAgent, recordReviewMissionRun, reviewAgentKey,
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
    dailyMintLimit: 1, totalMintLimit: 1,
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

test("a dispatched Punk stays out until its unique-match mission is complete", () => {
  const active = activateReviewAgent(draft({ dailyMintLimit: 2, totalMintLimit: 2 }), {
    owner: OWNER, punkTokenId: "93", punkWallet: PUNK_WALLET,
  }, NOW);
  const scouting = dispatchReviewAgent(active, new Date(NOW.getTime() + 1_000));
  assert.equal(scouting.status, "SCOUTING");
  assert.equal(scouting.mission.targetMatches, 2);
  const one = { checkedCount: 25, opportunities: [{ collectionContract: PUNK_WALLET,
    recommendationEligible: true }] };
  const stillOut = recordReviewMissionRun(scouting, one, new Date(NOW.getTime() + 2_000));
  assert.equal(stillOut.status, "SCOUTING");
  assert.equal(stillOut.mission.foundContracts.length, 1);
  const duplicate = recordReviewMissionRun(stillOut, one, new Date(NOW.getTime() + 3_000));
  assert.equal(duplicate.status, "SCOUTING", "repeat sightings cannot finish the mission twice");
  const returned = recordReviewMissionRun(duplicate, { checkedCount: 25,
    opportunities: [{ collectionContract: OWNER, recommendationEligible: true }] },
  new Date(NOW.getTime() + 4_000));
  assert.equal(returned.status, "RETURNED");
  assert.equal(returned.mission.checks, 3);
  assert.equal(returned.mission.checkedOpportunities, 75);
});

test("a review mission can be safely restored after a same-tab reload", () => {
  const active = activateReviewAgent(draft({ dailyMintLimit: 2, totalMintLimit: 2 }), {
    owner: OWNER, punkTokenId: "93", punkWallet: PUNK_WALLET,
  }, NOW);
  const scouting = dispatchReviewAgent(active, new Date(NOW.getTime() + 1_000));
  const checked = recordReviewMissionRun(scouting, { checkedCount: 40, opportunities: [] },
    new Date(NOW.getTime() + 2_000));
  const restored = normalizeReviewAgentSnapshot(JSON.parse(JSON.stringify(checked)),
    new Date(NOW.getTime() + 3_000));
  assert.equal(restored.status, "SCOUTING");
  assert.equal(restored.mission.checks, 1);
  assert.equal(restored.mission.checkedOpportunities, 40);
  assert.equal(Object.isFrozen(restored.mission.foundContracts), true);
  assert.throws(() => normalizeReviewAgentSnapshot({ ...checked,
    authority: "EXECUTE" }, new Date(NOW.getTime() + 3_000)), /snapshot|mission|invalid/i);
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
    opportunities: [{ previewFixture: false, opportunity: {
      opportunityId: "seadrop:neon-alley:public", collectionContract: PUNK_WALLET,
      collectionName: "Neon Alley", screeningStatus: "PASSED", simulationStatus: "PASSED" },
    match: { recommendationEligible: true, matchScore: 94, reasons: [] } }],
  }, "93");
  assert.equal(run.opportunities[0].collectionName, "Neon Alley");
  assert.equal(run.opportunities[0].previewFixture, false);
  assert.deepEqual(run.opportunities[0].blockingReasons, []);
  assert.equal(Object.hasOwn(run.opportunities[0], "transaction"), false);
  assert.throws(() => normalizeReviewAgentRun({ ...run, ok: true, reviewOnly: true,
    authority: "EXECUTE", tokenId: "93", transactionPrepared: false,
    executionAttemptCreated: false }, "93"), /invalid/);
});
