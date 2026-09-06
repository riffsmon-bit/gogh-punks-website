import { createHash } from "node:crypto";

export const NORMALIZED_V2_OPPORTUNITY_SCHEMA = "GOGH_NORMALIZED_OPPORTUNITY_V2";
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const SCREENING = new Set(["PENDING", "PASSED", "BLOCKED", "NEEDS_REVIEW"]);
const SIMULATION = new Set(["PENDING", "PASSED", "FAILED", "UNAVAILABLE"]);
const RISK = new Set(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]);

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} is invalid`);
  return value;
}

function address(value, label, nullable = false) {
  if (nullable && value === null) return null;
  const output = String(value ?? "").toLowerCase();
  if (!ADDRESS.test(output)) throw new TypeError(`${label} is invalid`);
  return output;
}

function hash(value, label, nullable = false) {
  if (nullable && value === null) return null;
  const output = String(value ?? "").toLowerCase();
  if (!HASH.test(output)) throw new TypeError(`${label} is invalid`);
  return output;
}

function uint(value, label) {
  const text = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(text)) throw new TypeError(`${label} is invalid`);
  return text;
}

function date(value, label, nullable = false) {
  if (nullable && value === null) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${label} is invalid`);
  return parsed.toISOString();
}

function strings(values, label, maximum = 32) {
  if (!Array.isArray(values) || values.length > maximum || values.some((item) => (
    typeof item !== "string" || item.length === 0 || item.length > 500
  ))) throw new TypeError(`${label} is invalid`);
  return Object.freeze([...new Set(values)].sort());
}

function publicHttps(value, label, nullable = false, hosts = null) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > 2_048) throw new TypeError(`${label} is invalid`);
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${label} is invalid`); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
    || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
    || hosts && !hosts.has(host)) throw new TypeError(`${label} is invalid`);
  return url.toString();
}

export function v2OpportunityDedupeKey(value) {
  const source = record(value, "opportunity identity");
  const fields = [
    Number(source.chainId),
    address(source.collectionContract, "collection contract"),
    address(source.mintContract, "mint contract"),
    String(source.mintStage ?? "").toUpperCase(),
    address(source.adapter, "adapter"),
  ];
  if (fields[0] !== 4663 || fields[3].length === 0 || fields[3].length > 96) {
    throw new TypeError("opportunity identity is invalid");
  }
  return createHash("sha256").update(fields.join("|")).digest("hex");
}

export function normalizeV2Opportunity(value, now = new Date()) {
  const source = record(value, "opportunity");
  if (source.schema !== NORMALIZED_V2_OPPORTUNITY_SCHEMA || source.version !== 2
    || source.chainId !== 4663) throw new TypeError("opportunity schema is invalid");
  const screeningStatus = String(source.screeningStatus ?? "");
  const simulationStatus = String(source.simulationStatus ?? "");
  const riskLevel = String(source.riskLevel ?? "");
  if (!SCREENING.has(screeningStatus) || !SIMULATION.has(simulationStatus)
    || !RISK.has(riskLevel)) throw new TypeError("opportunity safety state is invalid");
  const supply = source.supply === null ? null : Number(source.supply);
  const walletLimit = source.walletLimit === null ? null : Number(source.walletLimit);
  const riskScore = Number(source.riskScore);
  if ((supply !== null && (!Number.isSafeInteger(supply) || supply < 0))
    || (walletLimit !== null && (!Number.isSafeInteger(walletLimit) || walletLimit < 1))
    || !Number.isInteger(riskScore) || riskScore < 0 || riskScore > 100) {
    throw new TypeError("opportunity numeric metadata is invalid");
  }
  const socialUrls = record(source.socialUrls, "social URLs");
  const startTime = date(source.startTime, "start time", true);
  const endTime = date(source.endTime, "end time", true);
  if (startTime && endTime && Date.parse(endTime) <= Date.parse(startTime)) {
    throw new TypeError("opportunity time window is invalid");
  }
  const normalized = {
    schema: NORMALIZED_V2_OPPORTUNITY_SCHEMA,
    version: 2,
    opportunityId: String(source.opportunityId ?? ""),
    dedupeKey: v2OpportunityDedupeKey(source),
    chainId: 4663,
    collectionContract: address(source.collectionContract, "collection contract"),
    mintContract: address(source.mintContract, "mint contract"),
    adapter: address(source.adapter, "adapter"),
    mintStage: String(source.mintStage ?? "").toUpperCase(),
    mintMethod: String(source.mintMethod ?? ""),
    priceWei: uint(source.priceWei, "price"),
    estimatedGasCostWei: uint(source.estimatedGasCostWei, "estimated gas"),
    supply,
    walletLimit,
    startTime,
    endTime,
    website: publicHttps(source.website, "website", true),
    socialUrls: Object.freeze({
      x: publicHttps(socialUrls.x, "X URL", true, new Set(["x.com", "twitter.com"])),
      discord: publicHttps(socialUrls.discord, "Discord URL", true,
        new Set(["discord.com", "discord.gg"])),
      farcaster: publicHttps(socialUrls.farcaster, "Farcaster URL", true,
        new Set(["warpcast.com", "farcaster.xyz"])),
    }),
    sourceUrls: Object.freeze(strings(source.sourceUrls, "source URLs")
      .map((url) => publicHttps(url, "source URL"))),
    artStyles: strings(source.artStyles, "art styles"),
    imageReference: publicHttps(source.imageReference, "image reference", true),
    collectionName: String(source.collectionName ?? "Unknown collection").slice(0, 160),
    contractCodeHash: hash(source.contractCodeHash, "contract code hash"),
    adapterCodeHash: hash(source.adapterCodeHash, "adapter code hash"),
    screeningStatus,
    simulationStatus,
    riskLevel,
    riskScore,
    expectedNftReceiver: address(source.expectedNftReceiver, "expected NFT receiver", true),
    unexpectedApprovals: source.unexpectedApprovals === true,
    unexpectedTransfers: source.unexpectedTransfers === true,
    createdAt: date(source.createdAt ?? now, "created time"),
    updatedAt: date(source.updatedAt ?? now, "updated time"),
  };
  if (!/^[a-zA-Z0-9:_-]{8,256}$/.test(normalized.opportunityId)
    || !/^[A-Z0-9_]{1,96}$/.test(normalized.mintStage)
    || !/^[A-Za-z0-9_().,]{1,160}$/.test(normalized.mintMethod)) {
    throw new TypeError("opportunity identity text is invalid");
  }
  return Object.freeze(normalized);
}
