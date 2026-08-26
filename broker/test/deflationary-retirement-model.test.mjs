import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCollectionRetirementPlan,
  buildPunkRetirementState,
  DRAFT_RARITY_MINT_LIMITS,
  GOGH_RETIREMENT_TARGET_SUPPLY,
  validateRarityMintLimits,
} from "../src/retirement/deflationary-model.mjs";

function input(overrides = {}) {
  return {
    tokenId: "93", rarityTier: "COMMON", rarityEvidence: "VERIFIED_SNAPSHOT",
    confirmedAutonomousMints: 100, circulatingSupply: 5_000,
    automationContained: true, knownNftCount: 0, knownTokenBalanceCount: 0,
    nativeBalanceWei: "0", inventoryReviewedByOwner: true, cooldownElapsed: true,
    ownerFinalConfirmation: true, ...overrides,
  };
}

test("rarer Punks receive strictly longer autonomous mint lifetimes", () => {
  const limits = validateRarityMintLimits(DRAFT_RARITY_MINT_LIMITS);
  assert.deepEqual(Object.values(limits), [100, 200, 400, 800, 1_600, 3_200]);
  assert.throws(() => validateRarityMintLimits({
    ...DRAFT_RARITY_MINT_LIMITS, UNCOMMON: 100,
  }), /strictly longer/);
});

test("collection plan allocates an exact 1420 survivor target toward rarer Punks", () => {
  const plan = buildCollectionRetirementPlan({
    circulatingSupply: 4_295,
    tierPopulations: {
      COMMON: 1_800, UNCOMMON: 1_100, RARE: 700,
      EPIC: 400, LEGENDARY: 220, MYTHIC: 75,
    },
  });
  assert.equal(plan.requiredRetirements, 2_875);
  assert.equal(Object.values(plan.tiers)
    .reduce((sum, tier) => sum + tier.survivorTarget, 0), 1_420);
  assert.equal(Object.values(plan.tiers)
    .reduce((sum, tier) => sum + tier.retirementTarget, 0), 2_875);
  assert.ok(plan.tiers.COMMON.retirementTarget / plan.tiers.COMMON.population
    > plan.tiers.MYTHIC.retirementTarget / plan.tiers.MYTHIC.population);
  assert.equal(plan.automaticBurning, false);
  assert.equal(plan.ownerBurnRequired, true);
});

test("collection plan rejects an unbound or inconsistent rarity population", () => {
  assert.throws(() => buildCollectionRetirementPlan({
    circulatingSupply: 100,
    tierPopulations: {
      COMMON: 100, UNCOMMON: 1, RARE: 0, EPIC: 0, LEGENDARY: 0, MYTHIC: 0,
    },
  }), /must equal/);
});

test("retirement cannot proceed below the 1420 target or before the rarity lifetime", () => {
  assert.equal(GOGH_RETIREMENT_TARGET_SUPPLY, 1_420);
  assert.equal(buildPunkRetirementState(input({ circulatingSupply: 1_420 })).status,
    "TARGET_SUPPLY_REACHED");
  assert.equal(buildPunkRetirementState(input({ confirmedAutonomousMints: 99 })).status,
    "MINT_LIFETIME_ACTIVE");
  assert.equal(buildPunkRetirementState(input({ rarityEvidence: "SELF_REPORTED" })).status,
    "RARITY_EVIDENCE_REQUIRED");
});

test("retirement contains automation and evacuates every known asset first", () => {
  assert.equal(buildPunkRetirementState(input({ automationContained: false })).status,
    "CONTAIN_AUTOMATION");
  assert.equal(buildPunkRetirementState(input({ knownNftCount: 1 })).status,
    "EVACUATE_KNOWN_ASSETS");
  assert.equal(buildPunkRetirementState(input({ nativeBalanceWei: "1" })).status,
    "EVACUATE_KNOWN_ASSETS");
  assert.equal(buildPunkRetirementState(input({ inventoryReviewedByOwner: false })).status,
    "OWNER_INVENTORY_REVIEW_REQUIRED");
});

test("only a cooled-down final owner review can become burn-ready", () => {
  assert.equal(buildPunkRetirementState(input({ cooldownElapsed: false })).status,
    "RETIREMENT_COOLDOWN");
  assert.equal(buildPunkRetirementState(input({ ownerFinalConfirmation: false })).status,
    "OWNER_FINAL_CONFIRMATION_REQUIRED");
  const ready = buildPunkRetirementState(input());
  assert.equal(ready.status, "OWNER_BURN_REVIEW_READY");
  assert.equal(ready.burnReady, true);
  assert.equal(ready.agentMayBurn, false);
  assert.equal(ready.burnIsAutomatic, false);
});
