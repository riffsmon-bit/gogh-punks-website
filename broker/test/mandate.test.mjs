import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMintInterest, normalizeArtMandate } from "../src/mandate.mjs";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const MINT = "0x2222222222222222222222222222222222222222";
const OWNER = "0x3333333333333333333333333333333333333333";

function mandate(overrides = {}) {
  const economics = {
    inspectMints: true,
    allowFreeMints: true,
    allowPaidMints: true,
    maxMintPriceWei: "100",
    dailyBudgetWei: "500",
    weeklyBudgetWei: "1000",
    minimumReserveWei: "250",
    maxMintsPerDay: 2,
    ...overrides.economicSettings,
  };
  return normalizeArtMandate({
    tokenId: "4242",
    configuredBy: OWNER,
    mode: "SCOUT",
    riskSettings: { unknownMintMode: "SCOUT_ONLY", maxContractRiskScore: 30 },
    artisticPreferences: { minimumTasteMatch: 75 },
    mintPermissions: {
      approvedMintContracts: [MINT],
      approvedCollections: [COLLECTION],
      blockedCollections: [],
    },
    ...overrides,
    economicSettings: economics,
  });
}

function mintOpportunity(overrides = {}) {
  return {
    chainId: 4663,
    opportunityType: "FREE_MINT",
    collection: COLLECTION,
    expectedPrice: "0",
    maxPrice: "0",
    riskLabel: "LOWER_RISK",
    scores: { contractRiskScore: 15, tasteMatch: 90 },
    metadata: { actionableMint: true, mintPriceStatus: "KNOWN", mintContract: MINT },
    ...overrides,
  };
}

function usage(overrides = {}) {
  return {
    acquisitionsToday: 0,
    spentTodayWei: "0",
    spentThisWeekWei: "0",
    accountBalanceWei: "1000",
    expectedOwner: OWNER,
    ...overrides,
  };
}

test("deterministic mint states never enable execution or autonomy", () => {
  const free = evaluateMintInterest({
    mandate: mandate(),
    opportunity: mintOpportunity(),
    controls: usage(),
  });
  assert.equal(free.decision, "RECOMMEND");
  assert.equal(free.wantsToJoin, true);
  assert.equal(free.executionEnabled, false);
  assert.equal(free.autonomyEnabled, false);
  assert.equal(free.autonomousEligible, false);

  const autonomous = evaluateMintInterest({
    mandate: mandate({ mode: "AUTONOMOUS" }),
    opportunity: mintOpportunity(),
    controls: {
      ...usage(),
      autonomousMintFeatureEnabled: true,
      agentAuthorized: true,
      adapterApproved: true,
      onchainPolicyValidated: true,
    },
  });
  assert.equal(autonomous.decision, "RECOMMEND");
  assert.equal(autonomous.autonomyEnabled, false);
});

test("DISABLED, inspect-off, and blocked mandates deterministically IGNORE", () => {
  for (const configured of [
    mandate({ mode: "DISABLED" }),
    mandate({ economicSettings: { inspectMints: false } }),
    mandate({
      mintPermissions: {
        approvedMintContracts: [MINT],
        approvedCollections: [COLLECTION],
        blockedCollections: [COLLECTION],
      },
    }),
  ]) {
    const result = evaluateMintInterest({
      mandate: configured,
      opportunity: mintOpportunity(),
      controls: usage(),
    });
    assert.equal(result.decision, "IGNORE");
    assert.equal(result.wantsToJoin, false);
  }
});

test("unknown or non-actionable mints honor the unknown-mint setting", () => {
  const unknown = mintOpportunity({
    riskLabel: "UNKNOWN",
    metadata: { actionableMint: false, mintPriceStatus: "UNKNOWN", mintContract: MINT },
  });
  const watch = evaluateMintInterest({ mandate: mandate(), opportunity: unknown, controls: usage() });
  assert.equal(watch.decision, "WATCH");
  assert.equal(watch.wantsToJoin, false);

  const ignore = evaluateMintInterest({
    mandate: mandate({ riskSettings: { unknownMintMode: "IGNORE", maxContractRiskScore: 30 } }),
    opportunity: unknown,
    controls: usage(),
  });
  assert.equal(ignore.decision, "IGNORE");
});

test("missing or exhausted usage evidence fails closed to WATCH", () => {
  const missing = evaluateMintInterest({ mandate: mandate(), opportunity: mintOpportunity() });
  assert.equal(missing.decision, "WATCH");
  assert.match(missing.reasons.join(" "), /unavailable/i);

  const cases = [
    [usage({ acquisitionsToday: 2 }), /daily mint count/i],
    [usage({ spentTodayWei: "450" }), /remaining daily budget/i],
    [usage({ spentThisWeekWei: "950" }), /remaining weekly budget/i],
    [usage({ accountBalanceWei: "249" }), /minimum reserve/i],
  ];
  for (const [controls, reason] of cases) {
    const result = evaluateMintInterest({
      mandate: mandate(),
      opportunity: mintOpportunity({ opportunityType: "MINT", expectedPrice: "60", maxPrice: "60" }),
      controls,
    });
    assert.equal(result.decision, "WATCH");
    assert.match(result.reasons.join(" "), reason);
  }
});

test("paid mint uses maximum price, remaining budgets, and reserve", () => {
  const accepted = evaluateMintInterest({
    mandate: mandate(),
    opportunity: mintOpportunity({ opportunityType: "MINT", expectedPrice: "90", maxPrice: "99" }),
    controls: usage({ spentTodayWei: "100", spentThisWeekWei: "200", accountBalanceWei: "400" }),
  });
  assert.equal(accepted.decision, "RECOMMEND");
  assert.equal(accepted.price, "99");

  const overCap = evaluateMintInterest({
    mandate: mandate(),
    opportunity: mintOpportunity({ opportunityType: "MINT", expectedPrice: "99", maxPrice: "101" }),
    controls: usage(),
  });
  assert.equal(overCap.decision, "WATCH");
  assert.match(overCap.reasons.join(" "), /ceiling/i);
});

test("APPROVAL_REQUIRED emits PROPOSE only with allowlists and every review gate", () => {
  const incomplete = evaluateMintInterest({
    mandate: mandate({ mode: "APPROVAL_REQUIRED" }),
    opportunity: mintOpportunity(),
    controls: usage(),
  });
  assert.equal(incomplete.decision, "RECOMMEND");
  assert.equal(incomplete.ownerApprovalRequired, false);

  const proposed = evaluateMintInterest({
    mandate: mandate({ mode: "APPROVAL_REQUIRED" }),
    opportunity: mintOpportunity(),
    controls: {
      ...usage(),
      proposalSupported: true,
      targetInspectionValidated: true,
      ownerMandateCurrent: true,
      policySnapshotValidated: true,
    },
  });
  assert.equal(proposed.decision, "PROPOSE");
  assert.equal(proposed.ownerApprovalRequired, true);
  assert.equal(proposed.executionEnabled, false);
});

test("default mandate can inspect but cannot express mint interest", () => {
  const configured = normalizeArtMandate({ tokenId: "23" });
  const result = evaluateMintInterest({ mandate: configured, opportunity: mintOpportunity() });
  assert.equal(result.decision, "WATCH");
  assert.equal(result.wantsToJoin, false);
});

test("Taste Profile dimensions are bounded and unknown dimensions are rejected", () => {
  const configured = normalizeArtMandate({
    tokenId: "23",
    artisticPreferences: { dimensions: { pixelArt: 100, generativeArt: 25 } },
  });
  assert.deepEqual(configured.artisticPreferences.dimensions, { pixelArt: 100, generativeArt: 25 });
  assert.throws(
    () => normalizeArtMandate({ tokenId: "23", artisticPreferences: { dimensions: { profit: 100 } } }),
    /Unknown Taste Profile dimension/,
  );
  assert.throws(
    () => normalizeArtMandate({ tokenId: "23", artisticPreferences: { dimensions: { pixelArt: 101 } } }),
    /between 0 and 100/,
  );
});

test("missing, invalid, or coercible contract-risk evidence never reaches PROPOSE", () => {
  const configured = mandate({ mode: "APPROVAL_REQUIRED" });
  const proposalControls = {
    ...usage(),
    proposalSupported: true,
    targetInspectionValidated: true,
    ownerMandateCurrent: true,
    policySnapshotValidated: true,
  };
  for (const riskScore of [undefined, "", true, [], "0x10", "10", Number.NaN, 101]) {
    const scores = { tasteMatch: 90 };
    if (riskScore !== undefined) scores.contractRiskScore = riskScore;
    const result = evaluateMintInterest({
      mandate: configured,
      opportunity: mintOpportunity({ scores }),
      controls: proposalControls,
    });
    assert.ok(result.decision === "WATCH" || result.decision === "IGNORE", String(riskScore));
  }
  const bogus = evaluateMintInterest({
    mandate: configured,
    opportunity: mintOpportunity({ riskLabel: "BOGUS" }),
    controls: proposalControls,
  });
  assert.equal(bogus.decision, "WATCH");
});

test("conflicting decision-critical aliases and coercible prices are rejected", () => {
  assert.throws(
    () => evaluateMintInterest({
      mandate: mandate(),
      opportunity: mintOpportunity({ risk_label: "UNKNOWN" }),
      controls: usage(),
    }),
    /riskLabel aliases conflict/,
  );
  for (const price of ["", false, [], "0x0", "01", "+1", "1e2"]) {
    assert.throws(
      () => evaluateMintInterest({
        mandate: mandate(),
        opportunity: mintOpportunity({ expectedPrice: price, maxPrice: price }),
        controls: usage(),
      }),
      /non-negative integer amount/,
      String(price),
    );
  }
});

test("stale or missing configuredBy cannot express current-owner interest", () => {
  const missing = evaluateMintInterest({
    mandate: mandate({ configuredBy: null }),
    opportunity: mintOpportunity(),
    controls: usage(),
  });
  assert.equal(missing.decision, "WATCH");
  assert.equal(missing.wantsToJoin, false);

  const stale = evaluateMintInterest({
    mandate: mandate({ configuredBy: "0x9999999999999999999999999999999999999999" }),
    opportunity: mintOpportunity(),
    controls: usage(),
  });
  assert.equal(stale.decision, "WATCH");
  assert.match(stale.reasons.join(" "), /configuredBy/);
});

test("mandate counts and Taste weights reject coercible configuration values", () => {
  for (const value of [true, [], "", "0x1", "01", "1e2"]) {
    assert.throws(
      () => mandate({ economicSettings: { maxMintsPerDay: value } }),
      /must be an integer/,
      String(value),
    );
  }
  for (const value of [true, [], "", "100"]) {
    assert.throws(
      () => normalizeArtMandate({
        tokenId: "23",
        artisticPreferences: { dimensions: { pixelArt: value } },
      }),
      /weight must be between/,
      String(value),
    );
  }
});
