import { normalizePunkCollectingIntent } from "./collecting-intent.mjs";
import { normalizeV2Opportunity } from "./opportunity.mjs";

function socialPresent(opportunity, platform) {
  if (platform === "X") return Boolean(opportunity.socialUrls.x);
  if (platform === "DISCORD") return Boolean(opportunity.socialUrls.discord);
  if (platform === "FARCASTER") return Boolean(opportunity.socialUrls.farcaster);
  return false;
}

export function matchV2Opportunity(intentValue, opportunityValue, state, now = new Date()) {
  const intent = normalizePunkCollectingIntent(intentValue, now);
  const opportunity = normalizeV2Opportunity(opportunityValue, now);
  const balance = BigInt(String(state?.punkWalletBalanceWei ?? ""));
  const dailyMints = Number(state?.dailyMints);
  const totalMints = Number(state?.totalMints);
  const opportunityMints = Number(state?.opportunityMints ?? 0);
  const currentOwner = String(state?.currentOwner ?? "").toLowerCase();
  const currentWallet = String(state?.punkWallet ?? "").toLowerCase();
  if (balance < 0n || !Number.isInteger(dailyMints) || dailyMints < 0
    || !Number.isInteger(totalMints) || totalMints < 0
    || !Number.isInteger(opportunityMints) || opportunityMints < 0) {
    throw new TypeError("Punk matching state is invalid");
  }
  const reasons = [];
  const notes = [];
  if (intent.chainId !== opportunity.chainId) reasons.push("WRONG_CHAIN");
  if (currentOwner !== intent.expectedOwner) reasons.push("OWNER_CHANGED");
  if (currentWallet !== intent.punkWallet || opportunity.expectedNftReceiver !== intent.punkWallet) {
    reasons.push("WRONG_RECIPIENT");
  }
  if (!intent.discoveryEnabled) reasons.push("DISCOVERY_DISABLED");
  if (Date.parse(intent.expiration) <= new Date(now).getTime()) reasons.push("STRATEGY_EXPIRED");
  if (opportunity.startTime && Date.parse(opportunity.startTime) > new Date(now).getTime()) {
    reasons.push("MINT_NOT_STARTED");
  }
  if (opportunity.endTime && Date.parse(opportunity.endTime) <= new Date(now).getTime()) {
    reasons.push("MINT_ENDED");
  }
  if (opportunity.screeningStatus !== "PASSED") reasons.push("SCREENING_NOT_PASSED");
  if (intent.requireSimulation && opportunity.simulationStatus !== "PASSED") {
    reasons.push("SIMULATION_NOT_PASSED");
  }
  if (opportunity.unexpectedApprovals) reasons.push("UNEXPECTED_APPROVAL");
  if (opportunity.unexpectedTransfers) reasons.push("UNEXPECTED_TRANSFER");
  if (!intent.allowedAdapters.includes(opportunity.adapter)) reasons.push("ADAPTER_NOT_ALLOWED");
  if (intent.blockedContracts.includes(opportunity.collectionContract)
    || intent.blockedContracts.includes(opportunity.mintContract)) reasons.push("CONTRACT_BLOCKED");
  if (intent.allowedContracts.length > 0
    && !intent.allowedContracts.includes(opportunity.collectionContract)) {
    reasons.push("CONTRACT_NOT_ALLOWED");
  }
  if (intent.blockedCollections.includes(opportunity.collectionName)) {
    reasons.push("COLLECTION_BLOCKED");
  }
  const price = BigInt(opportunity.priceWei);
  const gas = BigInt(opportunity.estimatedGasCostWei);
  if (intent.mintMode === "FREE_ONLY" && price !== 0n) reasons.push("PAID_MINT_BLOCKED");
  if (price > BigInt(intent.maxMintPriceWei)) reasons.push("PRICE_LIMIT_EXCEEDED");
  if (gas > BigInt(intent.maxGasPerMintWei)) reasons.push("GAS_LIMIT_EXCEEDED");
  if (dailyMints >= intent.dailyMintLimit) reasons.push("DAILY_LIMIT_REACHED");
  if (totalMints >= intent.totalMintLimit) reasons.push("TOTAL_LIMIT_REACHED");
  if (opportunity.walletLimit !== null && opportunityMints >= opportunity.walletLimit) {
    reasons.push("WALLET_LIMIT_REACHED");
  }
  if (opportunity.riskScore > intent.riskThreshold) reasons.push("RISK_LIMIT_EXCEEDED");
  if (intent.maximumCollectionSupply !== null
    && (opportunity.supply === null || opportunity.supply > intent.maximumCollectionSupply)) {
    reasons.push(opportunity.supply === null ? "SUPPLY_UNKNOWN" : "SUPPLY_LIMIT_EXCEEDED");
  }
  if (intent.requiresWebsite && !opportunity.website) reasons.push("WEBSITE_REQUIRED");
  if (intent.requiresSocial && !Object.values(opportunity.socialUrls).some(Boolean)) {
    reasons.push("SOCIAL_REQUIRED");
  }
  for (const platform of intent.preferredSocialPlatforms) {
    if (!socialPresent(opportunity, platform)) reasons.push(`${platform}_REQUIRED`);
  }
  const avoided = opportunity.artStyles.filter((style) => intent.preferences.avoid.includes(style));
  if (avoided.length > 0) reasons.push("AVOIDED_STYLE");
  const requiredBalance = price + gas + BigInt(intent.minimumReserveWei);
  if (balance < requiredBalance) reasons.push("MINIMUM_RESERVE_VIOLATION");

  let matchScore = 50;
  const preferred = opportunity.artStyles.filter((style) => intent.preferences.prefer.includes(style));
  if (preferred.length > 0) {
    matchScore += Math.min(30, preferred.length * 15);
    notes.push(...preferred.map((style) => `Preferred ${style.toLowerCase().replaceAll("_", " ")}`));
  } else if (intent.preferences.prefer.length > 0) {
    matchScore -= 20;
    notes.push("No preferred style match");
  }
  if (price === 0n) { matchScore += 8; notes.push("Free mint"); }
  if (opportunity.website) { matchScore += 4; notes.push("Website present"); }
  if (opportunity.socialUrls.x) { matchScore += 4; notes.push("X profile present"); }
  if (opportunity.supply !== null && intent.maximumCollectionSupply !== null
    && opportunity.supply <= intent.maximumCollectionSupply) {
    matchScore += 4; notes.push("Supply within limit");
  }
  if (opportunity.screeningStatus === "PASSED") matchScore += 5;
  if (opportunity.simulationStatus === "PASSED") matchScore += 5;
  matchScore = Math.max(0, Math.min(100, matchScore));
  return Object.freeze({
    matched: reasons.length === 0,
    recommendationEligible: reasons.length === 0,
    automaticExecutionCandidate: reasons.length === 0 && intent.operatingMode === "AUTONOMOUS",
    reasons: Object.freeze([...new Set(reasons)]),
    matchScore,
    matchReasons: Object.freeze(notes),
    requiredBalanceWei: requiredBalance.toString(),
    intent,
    opportunity,
  });
}
