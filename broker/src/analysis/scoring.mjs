const SCORE_FIELDS = [
  "artScore",
  "tasteMatch",
  "creatorScore",
  "marketScore",
  "liquidityScore",
  "collectionScore",
  "contractRiskScore",
  "confidence",
];

function score(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new TypeError(`${field} must be between 0 and 100`);
  }
  return parsed;
}

export function scoreOpportunity(values) {
  const parsed = Object.fromEntries(SCORE_FIELDS.map((field) => [field, score(values[field], field)]));
  const positive =
    parsed.artScore * 0.28 +
    parsed.tasteMatch * 0.27 +
    parsed.creatorScore * 0.13 +
    parsed.marketScore * 0.1 +
    parsed.liquidityScore * 0.05 +
    parsed.collectionScore * 0.1 +
    parsed.confidence * 0.07;
  return Object.freeze({
    ...parsed,
    opportunityScore: Math.max(
      0,
      Math.round((positive - parsed.contractRiskScore * 0.18) * 100) / 100,
    ),
  });
}
