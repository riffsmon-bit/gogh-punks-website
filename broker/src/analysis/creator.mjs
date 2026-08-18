export function analyzeCreator(evidence = {}) {
  const signals = [];
  let score = 40;
  let observations = 0;
  const apply = (known, delta, code) => {
    if (known === undefined || known === null) return;
    observations += 1;
    if (known) {
      score += delta;
      signals.push(code);
    }
  };
  apply(evidence.marketplaceVerified, 12, "MARKETPLACE_VERIFIED");
  apply(evidence.priorSuccessfulLaunch, 12, "PRIOR_SUCCESSFUL_LAUNCH");
  apply(evidence.priorAbandonedCollection, -20, "PRIOR_ABANDONED_COLLECTION");
  apply(evidence.creatorWalletOlderThan90Days, 8, "ESTABLISHED_WALLET");
  apply(evidence.suspiciousFundingProvenance, -25, "SUSPICIOUS_FUNDING_PROVENANCE");
  apply(evidence.publicIdentityLinked, 8, "PUBLIC_IDENTITY_LINKED");
  apply(evidence.suspiciousWalletClustering, -20, "SUSPICIOUS_WALLET_CLUSTERING");
  return Object.freeze({
    creatorScore: Math.max(0, Math.min(100, score)),
    confidence: Math.min(100, observations * 14),
    signals: Object.freeze(signals),
    caveat: "Creator and identity heuristics are signals, not proof of identity or intent.",
  });
}
