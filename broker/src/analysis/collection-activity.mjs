import { normalizeAddress } from "../config.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAXIMUM_ACTIVITY_ROWS = 500;

function timestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function metadata(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || value.length > 100_000) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeAddress(value) {
  try {
    return normalizeAddress(value);
  } catch {
    return null;
  }
}

function safeAmount(value) {
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function safeBlock(value) {
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function ageScore(ageMilliseconds) {
  const day = 86_400_000;
  if (ageMilliseconds <= day) return 100;
  if (ageMilliseconds <= 7 * day) return 70;
  if (ageMilliseconds <= 30 * day) return 35;
  return 0;
}

function countSince(sales, cutoff) {
  return sales.filter(({ occurredAt }) => occurredAt >= cutoff).length;
}

function holderDiversity(ownerSample) {
  if (ownerSample?.status !== "SAMPLED" || ownerSample.resolved <= 0) return null;
  return rounded((ownerSample.uniqueOwners / ownerSample.resolved) * 100);
}

/**
 * Score only observed completed-sale activity. It deliberately excludes floor,
 * listings, bids, and value forecasts because those sources are not present.
 */
export function summarizeCollectionActivity(rows, {
  now = new Date(),
  ownerSample = null,
  truncated = false,
} = {}) {
  if (!Array.isArray(rows) || rows.length > MAXIMUM_ACTIVITY_ROWS) {
    throw new RangeError(`activity rows must be an array of at most ${MAXIMUM_ACTIVITY_ROWS}`);
  }
  const observedAt = timestamp(now);
  if (!observedAt) throw new TypeError("now must be a valid date");
  const valid = [];
  let rejectedRows = 0;
  for (const row of rows) {
    const detail = metadata(row.metadata);
    const occurredAt = timestamp(row.source_block_timestamp ?? row.sourceBlockTimestamp);
    const price = safeAmount(detail?.historicalSalePrice);
    const currency = safeAddress(detail?.historicalSaleCurrency);
    const buyer = safeAddress(detail?.buyer);
    const seller = safeAddress(detail?.seller);
    const sourceBlock = safeBlock(row.source_block_number ?? row.sourceBlockNumber);
    const tokenId = safeAmount(row.token_id ?? row.tokenId);
    if (
      detail?.historicalSaleSignal !== true
      || detail?.actionableListing !== false
      || !occurredAt
      || occurredAt > observedAt
      || price === null
      || !currency
      || !buyer
      || !seller
      || buyer === seller
      || buyer === ZERO_ADDRESS
      || seller === ZERO_ADDRESS
      || sourceBlock === null
      || tokenId === null
    ) {
      rejectedRows += 1;
      continue;
    }
    valid.push(Object.freeze({
      occurredAt,
      price,
      currency,
      buyer,
      seller,
      sourceBlock,
      tokenId: tokenId.toString(),
    }));
  }
  valid.sort((left, right) => right.occurredAt - left.occurredAt);
  const day = 86_400_000;
  const sales24h = countSince(valid, new Date(observedAt.getTime() - day));
  const sales7d = countSince(valid, new Date(observedAt.getTime() - 7 * day));
  const sales30d = countSince(valid, new Date(observedAt.getTime() - 30 * day));
  const recent = valid.filter(
    ({ occurredAt }) => occurredAt >= new Date(observedAt.getTime() - 30 * day),
  );
  const buyers = new Set(recent.map(({ buyer }) => buyer));
  const sellers = new Set(recent.map(({ seller }) => seller));
  const participants = new Set(recent.flatMap(({ buyer, seller }) => [buyer, seller]));
  const tokenSample = [...new Set(valid.map(({ tokenId }) => tokenId))].slice(0, 32);
  const volumes = new Map();
  for (const sale of recent) {
    volumes.set(sale.currency, (volumes.get(sale.currency) ?? 0n) + sale.price);
  }

  const activityFrequency = Math.min(100, (Math.log2(sales30d + 1) / Math.log2(33)) * 100);
  const recency = valid.length
    ? ageScore(observedAt.getTime() - valid[0].occurredAt.getTime())
    : 0;
  const participantDiversity = sales30d >= 3
    ? Math.min(100, (participants.size / (sales30d * 2)) * 100)
    : 0;
  const marketScore = rounded(
    activityFrequency * 0.6 + recency * 0.2 + participantDiversity * 0.2,
  );
  const sampledHolderDiversity = holderDiversity(ownerSample);
  const confidence = valid.length === 0
    ? 0
    : Math.min(
      65,
      10
        + Math.min(30, valid.length * 3)
        + Math.min(15, participants.size * 2)
        + Math.min(10, ownerSample?.resolved ?? 0)
        - (truncated ? 10 : 0),
    );
  const sourceBlocks = valid.map(({ sourceBlock }) => sourceBlock);

  return Object.freeze({
    status: valid.length ? "OBSERVED_ACTIVITY" : "UNAVAILABLE",
    formulaVersion: "observed-seaport-activity-v1",
    observedAt: observedAt.toISOString(),
    marketScore: valid.length ? marketScore : null,
    marketConfidence: Math.max(0, confidence),
    liquidityScore: null,
    liquidityStatus: "UNAVAILABLE",
    sales: Object.freeze({
      observed: valid.length,
      last24Hours: sales24h,
      last7Days: sales7d,
      last30Days: sales30d,
      latestAt: valid[0]?.occurredAt.toISOString() ?? null,
      oldestAt: valid.at(-1)?.occurredAt.toISOString() ?? null,
    }),
    participants: Object.freeze({
      uniqueBuyers30d: buyers.size,
      uniqueSellers30d: sellers.size,
      uniqueParticipants30d: participants.size,
    }),
    ownerSample: Object.freeze({
      requested: ownerSample?.requested ?? 0,
      resolved: ownerSample?.resolved ?? 0,
      uniqueOwners: ownerSample?.uniqueOwners ?? 0,
      maximumTokensPerOwner: ownerSample?.maximumTokensPerOwner ?? null,
      concentrationPercentage: ownerSample?.concentrationPercentage ?? null,
      sampledHolderDiversity,
      caveat: "Sampled ownership is not total holder count or full holder concentration.",
    }),
    volumes30dByCurrency: Object.freeze(
      Object.fromEntries([...volumes].map(([currency, amount]) => [currency, amount.toString()])),
    ),
    tokenSample: Object.freeze(tokenSample),
    sourceMinBlock: sourceBlocks.length
      ? sourceBlocks.reduce((minimum, value) => value < minimum ? value : minimum).toString()
      : null,
    sourceMaxBlock: sourceBlocks.length
      ? sourceBlocks.reduce((maximum, value) => value > maximum ? value : maximum).toString()
      : null,
    rejectedRows,
    truncated: Boolean(truncated),
    caveats: Object.freeze([
      "Completed sales do not prove current listings, bids, floor price, or executable liquidity.",
      "Volumes remain separated by currency and are never combined into a portfolio value.",
      "This score measures observed activity strength, not artistic merit or expected profit.",
    ]),
    executionEligible: false,
  });
}
