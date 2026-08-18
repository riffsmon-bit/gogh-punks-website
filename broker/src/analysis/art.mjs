const ART_DIMENSIONS = [
  "pixelArt",
  "generativeArt",
  "oneOfOne",
  "photography",
  "illustration",
  "animation",
  "abstract",
  "surrealism",
  "pfp",
  "conceptualArt",
  "onChainArt",
  "aiAssistedArt",
  "editions",
  "physicalLinkedArt",
  "emergingArtists",
  "historicalNFTs",
  "experimentalNFTs",
];

export function analyzeArt({ dimensions = {}, metadataAvailable = false, mediaAvailable = false }) {
  const normalized = {};
  for (const dimension of ART_DIMENSIONS) {
    const value = Number(dimensions[dimension] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new TypeError(`${dimension} must be between 0 and 100`);
    }
    normalized[dimension] = value;
  }
  const nonZero = Object.values(normalized).filter((value) => value > 0);
  const artScore = nonZero.length
    ? Math.round((nonZero.reduce((sum, value) => sum + value, 0) / nonZero.length) * 100) / 100
    : 0;
  return Object.freeze({
    artScore,
    dimensions: Object.freeze(normalized),
    confidence: metadataAvailable && mediaAvailable ? 85 : metadataAvailable ? 55 : 15,
    caveat: "Art scores express a configured curatorial model, not objective artistic value.",
  });
}
