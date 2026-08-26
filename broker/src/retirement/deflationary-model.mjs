export const GOGH_RETIREMENT_TARGET_SUPPLY = 1_420;

export const DRAFT_RARITY_MINT_LIMITS = Object.freeze({
  COMMON: 100,
  UNCOMMON: 200,
  RARE: 400,
  EPIC: 800,
  LEGENDARY: 1_600,
  MYTHIC: 3_200,
});

export const RARITY_SURVIVAL_WEIGHTS = Object.freeze({
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 4,
  EPIC: 8,
  LEGENDARY: 16,
  MYTHIC: 32,
});

const TIERS = Object.freeze(Object.keys(DRAFT_RARITY_MINT_LIMITS));

function integer(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).some((key) => typeof key !== "string")
    || Object.keys(value).sort().join("\u0000") !== [...keys].sort().join("\u0000")) {
    throw new TypeError(`${label} has an invalid shape`);
  }
}

export function validateRarityMintLimits(value) {
  exactKeys(value, TIERS, "rarity mint limits");
  const limits = Object.fromEntries(TIERS.map((tier) => [
    tier, integer(value[tier], `${tier} mint limit`, { minimum: 1, maximum: 100_000 }),
  ]));
  for (let index = 1; index < TIERS.length; index += 1) {
    if (limits[TIERS[index]] <= limits[TIERS[index - 1]]) {
      throw new TypeError("rarer tiers must receive strictly longer mint lifetimes");
    }
  }
  return Object.freeze(limits);
}

export function buildCollectionRetirementPlan({ circulatingSupply, tierPopulations }) {
  const supply = integer(circulatingSupply, "circulating supply", { maximum: 10_000 });
  exactKeys(tierPopulations, TIERS, "tier populations");
  const populations = Object.fromEntries(TIERS.map((tier) => [
    tier, integer(tierPopulations[tier], `${tier} population`, { maximum: 10_000 }),
  ]));
  if (Object.values(populations).reduce((sum, count) => sum + count, 0) !== supply) {
    throw new TypeError("tier populations must equal circulating supply");
  }

  const survivorCount = Math.min(supply, GOGH_RETIREMENT_TARGET_SUPPLY);
  const survivors = Object.fromEntries(TIERS.map((tier) => [tier, 0]));
  for (let seat = 0; seat < survivorCount; seat += 1) {
    let selectedTier = null;
    for (const tier of TIERS) {
      if (survivors[tier] >= populations[tier]) continue;
      if (selectedTier === null) {
        selectedTier = tier;
        continue;
      }
      const candidateScore = BigInt(populations[tier] * RARITY_SURVIVAL_WEIGHTS[tier])
        * BigInt(survivors[selectedTier] + 1);
      const selectedScore = BigInt(
        populations[selectedTier] * RARITY_SURVIVAL_WEIGHTS[selectedTier],
      ) * BigInt(survivors[tier] + 1);
      // Equal weighted claims resolve toward the rarer tier so the allocation
      // cannot accidentally favor Common tokens merely because they sort first.
      if (candidateScore >= selectedScore) selectedTier = tier;
    }
    if (selectedTier === null) throw new TypeError("survivor allocation is impossible");
    survivors[selectedTier] += 1;
  }

  const tiers = Object.freeze(Object.fromEntries(TIERS.map((tier) => [tier, Object.freeze({
    population: populations[tier],
    survivorTarget: survivors[tier],
    retirementTarget: populations[tier] - survivors[tier],
    mintLifetime: DRAFT_RARITY_MINT_LIMITS[tier],
    survivalWeight: RARITY_SURVIVAL_WEIGHTS[tier],
  })])));
  return Object.freeze({
    circulatingSupply: supply,
    targetSupply: GOGH_RETIREMENT_TARGET_SUPPLY,
    requiredRetirements: Math.max(0, supply - GOGH_RETIREMENT_TARGET_SUPPLY),
    survivorCount,
    tiers,
    automaticBurning: false,
    ownerBurnRequired: true,
  });
}

export function buildPunkRetirementState(input, limits = DRAFT_RARITY_MINT_LIMITS) {
  exactKeys(input, [
    "tokenId", "rarityTier", "rarityEvidence", "confirmedAutonomousMints",
    "circulatingSupply", "automationContained", "knownNftCount", "knownTokenBalanceCount",
    "nativeBalanceWei", "inventoryReviewedByOwner", "cooldownElapsed", "ownerFinalConfirmation",
  ], "Punk retirement input");
  const normalizedLimits = validateRarityMintLimits(limits);
  const tokenId = String(input.tokenId);
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(tokenId)) throw new TypeError("Punk token ID is invalid");
  if (!TIERS.includes(input.rarityTier) || input.rarityEvidence !== "VERIFIED_SNAPSHOT") {
    return Object.freeze({
      status: "RARITY_EVIDENCE_REQUIRED", tokenId, burnReady: false,
      agentMayBurn: false, burnIsAutomatic: false, targetSupply: GOGH_RETIREMENT_TARGET_SUPPLY,
    });
  }
  const confirmedMints = integer(input.confirmedAutonomousMints, "confirmed autonomous mint count");
  const circulatingSupply = integer(input.circulatingSupply, "circulating supply", {
    maximum: 10_000,
  });
  const knownNftCount = integer(input.knownNftCount, "known NFT count", { maximum: 10_000 });
  const knownTokenBalanceCount = integer(
    input.knownTokenBalanceCount, "known token balance count", { maximum: 10_000 },
  );
  if (typeof input.nativeBalanceWei !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(input.nativeBalanceWei)) {
    throw new TypeError("native balance is invalid");
  }
  for (const key of [
    "automationContained", "inventoryReviewedByOwner", "cooldownElapsed", "ownerFinalConfirmation",
  ]) {
    if (typeof input[key] !== "boolean") throw new TypeError(`${key} is invalid`);
  }
  const mintLimit = normalizedLimits[input.rarityTier];
  const base = Object.freeze({
    tokenId, rarityTier: input.rarityTier, confirmedMints, mintLimit,
    targetSupply: GOGH_RETIREMENT_TARGET_SUPPLY,
    agentMayBurn: false, burnIsAutomatic: false,
  });
  if (circulatingSupply <= GOGH_RETIREMENT_TARGET_SUPPLY) {
    return Object.freeze({ ...base, status: "TARGET_SUPPLY_REACHED", burnReady: false });
  }
  if (confirmedMints < mintLimit) {
    return Object.freeze({ ...base, status: "MINT_LIFETIME_ACTIVE", burnReady: false });
  }
  if (!input.automationContained) {
    return Object.freeze({ ...base, status: "CONTAIN_AUTOMATION", burnReady: false });
  }
  if (knownNftCount > 0 || knownTokenBalanceCount > 0 || BigInt(input.nativeBalanceWei) > 0n) {
    return Object.freeze({ ...base, status: "EVACUATE_KNOWN_ASSETS", burnReady: false });
  }
  if (!input.inventoryReviewedByOwner) {
    return Object.freeze({ ...base, status: "OWNER_INVENTORY_REVIEW_REQUIRED", burnReady: false });
  }
  if (!input.cooldownElapsed) {
    return Object.freeze({ ...base, status: "RETIREMENT_COOLDOWN", burnReady: false });
  }
  if (!input.ownerFinalConfirmation) {
    return Object.freeze({ ...base, status: "OWNER_FINAL_CONFIRMATION_REQUIRED", burnReady: false });
  }
  return Object.freeze({ ...base, status: "OWNER_BURN_REVIEW_READY", burnReady: true });
}
