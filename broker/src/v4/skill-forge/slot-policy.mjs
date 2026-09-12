// Approved product policy. This calculation does not award slots or authorize execution.
export const SLOT_POLICY = Object.freeze({
  id: 'gogh-rarity-starting-slots-v1',
  chainId: 4663,
  collection: '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6',
  collectionSlug: 'gogh-punks-255843210',
  maxEquippedSkills: 7,
  baseSlots: 1,
  topFivePercentSlots: 3,
  topTwentyFivePercentSlots: 2,
  creditsPerSacrifice: 1,
  creditsPerSlot: 1,
  rarityBurnMultiplier: false,
});

// Use only with a complete, reviewed, frozen snapshot. Never infer a missing rank.
// Equal supplied ranks get equal allocation, including ties spanning a percentile boundary.
export function startingSlotsForRank(rank, population) {
  if (!Number.isSafeInteger(rank) || !Number.isSafeInteger(population)
    || rank < 1 || population < 1 || rank > population) throw new Error('INVALID_RARITY_RANK');
  const scaled = BigInt(rank) * 100n, total = BigInt(population);
  if (scaled <= total * 5n) return SLOT_POLICY.topFivePercentSlots;
  if (scaled <= total * 25n) return SLOT_POLICY.topTwentyFivePercentSlots;
  return SLOT_POLICY.baseSlots;
}
