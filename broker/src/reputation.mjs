import { assetKey, normalizeAddress } from "./config.mjs";

function finiteScore(value, field) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new TypeError(`${field} must be between 0 and 100`);
  }
  return parsed;
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function countByCurrency(acquisitions, field) {
  const totals = new Map();
  for (const acquisition of acquisitions) {
    const currency = normalizeAddress(acquisition.currency, "currency");
    const amount = BigInt(acquisition[field] ?? 0);
    if (amount < 0n) throw new TypeError(`${field} cannot be negative`);
    totals.set(currency, (totals.get(currency) ?? 0n) + amount);
  }
  return Object.freeze(
    Object.fromEntries([...totals].sort(([left], [right]) => left.localeCompare(right)).map(
      ([currency, amount]) => [currency, amount.toString()],
    )),
  );
}

export function buildCuratorReputation({ identity, acquisitions = [], recommendations = [] }) {
  const id = assetKey(identity.chainId, identity.collection, identity.tokenId);
  const normalizedAcquisitions = acquisitions.map((acquisition) => ({
    ...acquisition,
    collection: normalizeAddress(acquisition.collection, "collection"),
    tokenId: BigInt(acquisition.tokenId).toString(),
    creator: acquisition.creator ? normalizeAddress(acquisition.creator, "creator") : null,
    acquiredAt: new Date(acquisition.acquiredAt),
    tasteMatch: finiteScore(acquisition.tasteMatch, "tasteMatch"),
    artScore: finiteScore(acquisition.artScore, "artScore"),
  }));
  if (normalizedAcquisitions.some(({ acquiredAt }) => Number.isNaN(acquiredAt.getTime()))) {
    throw new TypeError("acquiredAt must be a valid date");
  }

  const uniqueAssets = new Set(
    normalizedAcquisitions.map((item) => assetKey(identity.chainId, item.collection, item.tokenId)),
  );
  const uniqueCollections = new Set(normalizedAcquisitions.map((item) => item.collection));
  const uniqueArtists = new Set(
    normalizedAcquisitions.map((item) => item.creator).filter((creator) => creator !== null),
  );
  const converted = recommendations.filter((item) => item.convertedToAcquisition).length;
  const ownerApproved = normalizedAcquisitions.filter(
    (item) => item.mode === "OWNER_APPROVED" || item.mode === "APPROVAL_REQUIRED",
  ).length;
  const autonomous = normalizedAcquisitions.filter((item) => item.mode === "AUTONOMOUS").length;
  const diversity = uniqueAssets.size === 0 ? 0 : (uniqueArtists.size / uniqueAssets.size) * 100;
  const emerging = normalizedAcquisitions.filter((item) => item.emergingArtist === true).length;

  return Object.freeze({
    punk: id,
    totalNftsCollected: uniqueAssets.size,
    uniqueArtists: uniqueArtists.size,
    uniqueCollections: uniqueCollections.size,
    totalAcquisitions: normalizedAcquisitions.length,
    ownerApprovedAcquisitions: ownerApproved,
    autonomousAcquisitions: autonomous,
    totalCapitalDeployedByCurrency: countByCurrency(normalizedAcquisitions, "price"),
    oldestHeldAt: normalizedAcquisitions.length
      ? new Date(Math.min(...normalizedAcquisitions.map((item) => item.acquiredAt.getTime()))).toISOString()
      : null,
    emergingArtistDiscoveries: emerging,
    totalRecommendations: recommendations.length,
    recommendationConversionRate: recommendations.length
      ? rounded((converted / recommendations.length) * 100)
      : 0,
    averageTasteMatch: rounded(average(normalizedAcquisitions.map((item) => item.tasteMatch))),
    averageArtScore: rounded(average(normalizedAcquisitions.map((item) => item.artScore))),
    artistDiversityScore: rounded(Math.min(100, diversity)),
    valuationNotice: "Capital and value remain separated by currency; estimates are not guaranteed returns.",
  });
}
