const DIMENSIONS = [
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

function profile(values) {
  return Object.freeze(
    Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, values[dimension] ?? 25])),
  );
}

export const PUNK_PERSONAS = Object.freeze({
  PIXEL_MAXI: Object.freeze({
    name: "The Pixel Maxi",
    riskTolerance: "MODERATE",
    weights: profile({ pixelArt: 100, pfp: 85, onChainArt: 75, generativeArt: 65 }),
  }),
  EMERGING_ARTIST_HUNTER: Object.freeze({
    name: "The Emerging Artist Hunter",
    riskTolerance: "MODERATE",
    weights: profile({ emergingArtists: 100, oneOfOne: 75, experimentalNFTs: 70 }),
  }),
  GENERATIVE_CURATOR: Object.freeze({
    name: "The Generative Curator",
    riskTolerance: "MODERATE",
    weights: profile({ generativeArt: 100, onChainArt: 90, abstract: 70 }),
  }),
  ONE_OF_ONE_COLLECTOR: Object.freeze({
    name: "The 1/1 Collector",
    riskTolerance: "CONSERVATIVE",
    weights: profile({ oneOfOne: 100, illustration: 70, photography: 65 }),
  }),
  DEGEN_GALLERIST: Object.freeze({
    name: "The Degen Gallerist",
    riskTolerance: "HIGH",
    weights: profile({ experimentalNFTs: 100, emergingArtists: 85, pfp: 70 }),
  }),
  CONSERVATIVE_COLLECTOR: Object.freeze({
    name: "The Conservative Collector",
    riskTolerance: "LOW",
    weights: profile({ historicalNFTs: 90, onChainArt: 75, oneOfOne: 65 }),
  }),
  CHAIN_ARCHAEOLOGIST: Object.freeze({
    name: "The Chain Archaeologist",
    riskTolerance: "MODERATE",
    weights: profile({ historicalNFTs: 100, onChainArt: 90, experimentalNFTs: 60 }),
  }),
  CONTRARIAN: Object.freeze({
    name: "The Contrarian",
    riskTolerance: "MODERATE",
    weights: profile({ experimentalNFTs: 90, conceptualArt: 85, emergingArtists: 80 }),
  }),
  MUSEUM_CURATOR: Object.freeze({
    name: "The Museum Curator",
    riskTolerance: "LOW",
    weights: profile({ oneOfOne: 85, conceptualArt: 90, illustration: 75, abstract: 70 }),
  }),
});

export function tasteMatch(persona, artworkDimensions) {
  const weights = persona?.weights;
  if (!weights) throw new TypeError("persona is required");
  let weighted = 0;
  let total = 0;
  for (const dimension of DIMENSIONS) {
    const weight = Number(weights[dimension]);
    const score = Number(artworkDimensions?.[dimension] ?? 0);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new TypeError(`${dimension} must be between 0 and 100`);
    }
    weighted += weight * score;
    total += weight;
  }
  return total === 0 ? 0 : Math.round((weighted / total) * 100) / 100;
}
