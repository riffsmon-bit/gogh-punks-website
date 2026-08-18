const FORMULAS = Object.freeze({
  TOP_CURATOR: "30% average taste + 25% average art + 20% artist diversity + 15% conversion + 10% emerging discovery ratio",
  MOST_DIVERSE_GALLERY: "artistDiversityScore",
  EMERGING_ARTIST_HUNTER: "emergingArtistDiscoveries, then averageTasteMatch",
  MOST_ACTIVE_BROKER: "totalAcquisitions, then totalRecommendations",
  HIGHEST_TASTE_MATCH: "averageTasteMatch with at least one acquisition",
});

function clamp(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function curatorScore(reputation) {
  const emergingRatio = reputation.totalAcquisitions
    ? (reputation.emergingArtistDiscoveries / reputation.totalAcquisitions) * 100
    : 0;
  return Math.round((
    clamp(reputation.averageTasteMatch) * 0.3 +
    clamp(reputation.averageArtScore) * 0.25 +
    clamp(reputation.artistDiversityScore) * 0.2 +
    clamp(reputation.recommendationConversionRate) * 0.15 +
    clamp(emergingRatio) * 0.1
  ) * 100) / 100;
}

function categoryValue(category, reputation) {
  switch (category) {
    case "TOP_CURATOR": return [curatorScore(reputation)];
    case "MOST_DIVERSE_GALLERY": return [clamp(reputation.artistDiversityScore)];
    case "EMERGING_ARTIST_HUNTER":
      return [reputation.emergingArtistDiscoveries ?? 0, clamp(reputation.averageTasteMatch)];
    case "MOST_ACTIVE_BROKER":
      return [reputation.totalAcquisitions ?? 0, reputation.totalRecommendations ?? 0];
    case "HIGHEST_TASTE_MATCH":
      return [reputation.totalAcquisitions > 0 ? clamp(reputation.averageTasteMatch) : -1];
    default: throw new TypeError(`unsupported leaderboard category ${category}`);
  }
}

export function leaderboardFormulas() {
  return FORMULAS;
}

export function rankCurators(category, reputations) {
  if (!Object.hasOwn(FORMULAS, category)) {
    throw new TypeError(`unsupported leaderboard category ${category}`);
  }
  return Object.freeze([...reputations]
    .map((reputation) => ({
      punk: String(reputation.punk),
      values: categoryValue(category, reputation),
      score: category === "TOP_CURATOR" ? curatorScore(reputation) : undefined,
    }))
    .sort((left, right) => {
      const length = Math.max(left.values.length, right.values.length);
      for (let index = 0; index < length; index += 1) {
        const difference = (right.values[index] ?? 0) - (left.values[index] ?? 0);
        if (difference !== 0) return difference;
      }
      return left.punk.localeCompare(right.punk);
    })
    .map((entry, index) => Object.freeze({ rank: index + 1, ...entry })));
}
