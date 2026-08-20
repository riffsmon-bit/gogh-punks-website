import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMintInterest, normalizeArtMandate } from "../src/mandate.mjs";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const MINT = "0x2222222222222222222222222222222222222222";

function mandate(overrides = {}) {
  return normalizeArtMandate({
    tokenId: "1797",
    mode: "AUTONOMOUS",
    economicSettings: {
      inspectMints: true,
      allowFreeMints: true,
      allowPaidMints: true,
      maxMintPriceWei: "100",
      dailyBudgetWei: "500",
      weeklyBudgetWei: "1000",
      minimumReserveWei: "250",
      maxMintsPerDay: 2,
      ...overrides.economicSettings,
    },
    riskSettings: { unknownMintMode: "SCOUT_ONLY", maxContractRiskScore: 30 },
    artisticPreferences: { minimumTasteMatch: 75 },
    mintPermissions: {
      approvedMintContracts: [MINT],
      approvedCollections: [COLLECTION],
      blockedCollections: [],
    },
    ...overrides,
  });
}

function mintOpportunity(overrides = {}) {
  return {
    opportunityType: "MINT",
    collection: COLLECTION,
    expectedPrice: "0",
    riskLabel: "LOWER_RISK",
    scores: { contractRiskScore: 15, tasteMatch: 90 },
    metadata: { mintPriceStatus: "KNOWN", mintContract: MINT },
    ...overrides,
  };
}

test("each Punk mandate independently configures free and paid mint interest", () => {
  const free = evaluateMintInterest({ mandate: mandate(), opportunity: mintOpportunity() });
  assert.equal(free.wantsToJoin, true);
  assert.equal(free.decision, "OWNER_APPROVAL_REQUIRED");
  assert.equal(free.autonomousEligible, false);

  const paid = evaluateMintInterest({
    mandate: mandate(),
    opportunity: mintOpportunity({ expectedPrice: "99" }),
  });
  assert.equal(paid.wantsToJoin, true);

  const overCap = evaluateMintInterest({
    mandate: mandate(),
    opportunity: mintOpportunity({ expectedPrice: "101" }),
  });
  assert.equal(overCap.wantsToJoin, false);
  assert.match(overCap.reasons.join(" "), /ceiling/i);
});

test("unknown mint signals remain research-only even when a Punk likes the art", () => {
  const result = evaluateMintInterest({
    mandate: mandate(),
    opportunity: mintOpportunity({
      riskLabel: "UNKNOWN",
      metadata: { mintPriceStatus: "UNKNOWN", mintContract: MINT },
    }),
  });
  assert.equal(result.decision, "RESEARCH");
  assert.equal(result.wantsToJoin, false);
  assert.equal(result.autonomousEligible, false);
});

test("autonomous mint eligibility requires explicit permissions and every on-chain guard", () => {
  const controls = {
    autonomousMintFeatureEnabled: true,
    agentAuthorized: true,
    adapterApproved: true,
    onchainPolicyValidated: true,
    budgetAndReserveValidated: true,
  };
  const eligible = evaluateMintInterest({ mandate: mandate(), opportunity: mintOpportunity(), controls });
  assert.equal(eligible.decision, "AUTONOMOUS_POLICY_ELIGIBLE");
  assert.equal(eligible.autonomousEligible, true);

  const missingGuard = evaluateMintInterest({
    mandate: mandate(),
    opportunity: mintOpportunity(),
    controls: { ...controls, adapterApproved: false },
  });
  assert.equal(missingGuard.decision, "OWNER_APPROVAL_REQUIRED");
  assert.equal(missingGuard.autonomousEligible, false);
});

test("default mandate can inspect signals but cannot express spending intent", () => {
  const defaultMandate = normalizeArtMandate({ tokenId: "23" });
  assert.equal(defaultMandate.economicSettings.inspectMints, true);
  assert.equal(defaultMandate.economicSettings.allowFreeMints, false);
  assert.equal(defaultMandate.economicSettings.allowPaidMints, false);
  const result = evaluateMintInterest({ mandate: defaultMandate, opportunity: mintOpportunity() });
  assert.equal(result.wantsToJoin, false);
  assert.equal(result.autonomousEligible, false);
});

test("daily mint count and paid budgets remain hard parts of Punk interest", () => {
  const noMints = evaluateMintInterest({
    mandate: mandate({ economicSettings: { maxMintsPerDay: 0 } }),
    opportunity: mintOpportunity(),
  });
  assert.equal(noMints.wantsToJoin, false);
  assert.match(noMints.reasons.join(" "), /daily mint count/i);

  const overBudget = evaluateMintInterest({
    mandate: mandate({ economicSettings: { dailyBudgetWei: "50" } }),
    opportunity: mintOpportunity({ expectedPrice: "60" }),
  });
  assert.equal(overBudget.wantsToJoin, false);
  assert.match(overBudget.reasons.join(" "), /budget/i);
});
