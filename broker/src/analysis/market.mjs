function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

export function analyzeMarket(metrics = {}) {
  const supply = Math.max(0, Number(metrics.supply ?? 0));
  const holders = Math.max(0, Number(metrics.holders ?? 0));
  const sales24h = Math.max(0, Number(metrics.sales24h ?? 0));
  const listings = Math.max(0, Number(metrics.listings ?? 0));
  const volume24h = Math.max(0, Number(metrics.volume24h ?? 0));
  const washIndicator = Math.max(0, Math.min(100, Number(metrics.washTradingIndicator ?? 0)));
  const uniqueHolderPercentage = Math.min(100, ratio(holders, supply) * 100);
  const velocity = Math.min(100, ratio(sales24h, Math.max(1, supply)) * 1_000);
  const depth = Math.min(100, ratio(listings, Math.max(1, supply)) * 500);
  const volumeSignal = Math.min(100, Math.log10(volume24h + 1) * 20);
  const marketScore =
    uniqueHolderPercentage * 0.35 + velocity * 0.3 + volumeSignal * 0.2 + depth * 0.15;
  const liquidityScore = depth * 0.55 + velocity * 0.45;
  return Object.freeze({
    marketScore: Math.max(0, Math.round((marketScore - washIndicator * 0.35) * 100) / 100),
    liquidityScore: Math.round(liquidityScore * 100) / 100,
    uniqueHolderPercentage: Math.round(uniqueHolderPercentage * 100) / 100,
    washTradingIndicator: washIndicator,
    caveat: "Market metrics are estimates and do not imply future value or available liquidity.",
  });
}
