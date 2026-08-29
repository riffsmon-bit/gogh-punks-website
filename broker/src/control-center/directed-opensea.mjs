import { assertPaidMintSimulation, evaluatePaidMint, normalizePaidMintCandidate,
  normalizePaidMintPolicy, ZERO_ADDRESS } from "./paid-mint-policy.mjs";
import { snapshotExactRecord } from "./strict-record.mjs";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

export class DirectedMintError extends Error {
  constructor(code, message) { super(message); this.name = "DirectedMintError"; this.code = code; }
}

function fail(code, message) { throw new DirectedMintError(code, message); }

export function parseOpenSeaMintUrl(value) {
  if (typeof value !== "string" || value.length > 2_048 || value.trim() !== value) {
    fail("INVALID_URL", "Paste a complete OpenSea mint link");
  }
  let url;
  try { url = new URL(value); } catch { fail("INVALID_URL", "This is not a valid URL"); }
  if (url.protocol !== "https:" || url.hostname !== "opensea.io" || url.username
    || url.password || url.port || url.hash || [...url.searchParams].length) {
    fail("INVALID_URL", "Only a clean HTTPS OpenSea link is supported");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  let kind;
  let slug;
  if (segments[0] === "collection" && (segments.length === 2
    || (segments.length === 3 && segments[2] === "overview"))) {
    [kind, slug] = ["collection", segments[1]];
  } else if (segments[0] === "drops" && segments.length === 2) {
    [kind, slug] = ["drop", segments[1]];
  } else {
    fail("UNSUPPORTED_URL", "This OpenSea link is not a supported collection or drop link");
  }
  if (!SLUG.test(slug)) fail("INVALID_URL", "OpenSea collection identity is invalid");
  return Object.freeze({ platform: "opensea", kind, slug,
    canonicalUrl: `https://opensea.io/${kind === "drop" ? "drops" : "collection"}/${slug}` });
}

function address(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("UNVERIFIED_MINT", `${label} could not be verified`);
  }
  return value.toLowerCase();
}

function boundedName(value) {
  if (typeof value !== "string") fail("UNVERIFIED_MINT", "collection name is unavailable");
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 160) fail("UNVERIFIED_MINT", "collection name is invalid");
  return clean;
}

export async function resolveOpenSeaDirectedMint(urlValue, options) {
  let lookup;
  let recipient;
  try {
    ({ lookup, recipient } = snapshotExactRecord(options, ["lookup", "recipient"],
      "resolver options"));
  } catch { fail("RESOLVER_UNAVAILABLE", "mint resolver is unavailable"); }
  if (typeof lookup !== "function") fail("RESOLVER_UNAVAILABLE", "mint resolver is unavailable");
  const parsed = parseOpenSeaMintUrl(urlValue);
  const account = address(recipient, "Punk wallet");
  let evidence;
  try {
    evidence = snapshotExactRecord(await lookup(parsed), ["chainId", "collectionName",
      "collection", "mintContract", "saleStage", "saleActive", "priceWei", "currency",
      "quantity", "eligibility", "runtimeSupported", "adapterId", "checkedBlockNumber"],
    "mint evidence");
  } catch {
    fail("UNVERIFIED_MINT", "We couldn't safely verify this mint yet");
  }
  if (evidence.chainId !== 4663 || evidence.saleActive !== true || evidence.quantity !== 1
    || evidence.runtimeSupported !== true || evidence.currency !== ZERO_ADDRESS
    || !["ELIGIBLE", "NOT_ELIGIBLE", "UNABLE_TO_VERIFY"].includes(evidence.eligibility)
    || !Number.isSafeInteger(evidence.checkedBlockNumber) || evidence.checkedBlockNumber < 1) {
    fail("UNVERIFIED_MINT", "We couldn't safely verify this mint yet");
  }
  const candidate = normalizePaidMintCandidate({
    chainId: 4663,
    adapterId: evidence.adapterId,
    mintContract: address(evidence.mintContract, "mint contract"),
    collection: address(evidence.collection, "collection"),
    recipient: account,
    priceWei: evidence.priceWei,
    transactionValueWei: evidence.priceWei,
    quantity: 1,
    saleActive: true,
    runtimeSupported: true,
  });
  return Object.freeze({
    platform: "opensea", sourceUrl: parsed.canonicalUrl, collectionName: boundedName(evidence.collectionName),
    saleStage: boundedName(evidence.saleStage), eligibility: evidence.eligibility,
    checkedBlockNumber: evidence.checkedBlockNumber, candidate,
  });
}

function sameCandidate(left, right) {
  return ["chainId", "adapterId", "mintContract", "collection", "recipient", "priceWei",
    "transactionValueWei", "quantity", "saleActive", "runtimeSupported"]
    .every((key) => left[key] === right[key]);
}

export async function simulateDirectedPaidMint(input) {
  let resolved;
  let policy;
  let usage;
  let nowSeconds;
  let revalidate;
  let readCurrentOwner;
  let simulate;
  try {
    ({ resolved, policy, usage, nowSeconds, revalidate, readCurrentOwner, simulate }
      = snapshotExactRecord(input, ["resolved", "policy", "usage", "nowSeconds", "revalidate",
        "readCurrentOwner", "simulate"], "directed mint execution"));
  } catch { fail("INVALID_REVIEW", "directed mint review is invalid"); }
  let reviewed;
  try {
    reviewed = snapshotExactRecord(resolved, ["platform", "sourceUrl", "collectionName",
      "saleStage", "eligibility", "checkedBlockNumber", "candidate"], "directed review");
  } catch { fail("INVALID_REVIEW", "directed mint review is invalid"); }
  if (reviewed.platform !== "opensea"
    || typeof simulate !== "function" || typeof revalidate !== "function"
    || typeof readCurrentOwner !== "function") {
    fail("INVALID_REVIEW", "directed mint review is invalid");
  }
  if (reviewed.eligibility !== "ELIGIBLE") {
    fail("ELIGIBILITY_UNVERIFIED", "This Punk's mint eligibility could not be verified");
  }
  let freshReview;
  try {
    freshReview = snapshotExactRecord(await revalidate(reviewed),
      ["candidate", "checkedBlockNumber", "eligibility"], "fresh mint review");
  } catch { fail("ELIGIBILITY_CHANGED", "Mint eligibility could not be reverified at execution time"); }
  if (freshReview.eligibility !== "ELIGIBLE"
    || !Number.isSafeInteger(freshReview.checkedBlockNumber)
    || freshReview.checkedBlockNumber < reviewed.checkedBlockNumber) {
    fail("ELIGIBILITY_CHANGED", "Mint eligibility could not be reverified at execution time");
  }
  const freshCandidate = normalizePaidMintCandidate(freshReview.candidate);
  if (!sameCandidate(freshCandidate, normalizePaidMintCandidate(reviewed.candidate))) {
    fail("MINT_CHANGED", "Mint price or contract state changed; review it again");
  }
  const currentOwner = address(await readCurrentOwner(), "current Punk owner");
  const normalizedPolicy = normalizePaidMintPolicy(policy);
  const livePolicy = { ...normalizedPolicy, currentOwner };
  const decision = evaluatePaidMint({ policy: livePolicy, usage,
    candidate: freshCandidate, nowSeconds });
  if (!decision.allowed) return Object.freeze({ ready: false, decision, simulation: null });
  const rawSimulation = await simulate(Object.freeze({
    adapterId: freshCandidate.adapterId,
    mintContract: freshCandidate.mintContract,
    collection: freshCandidate.collection,
    recipient: freshCandidate.recipient,
    quantity: 1,
    valueWei: freshCandidate.priceWei,
  }));
  const simulation = assertPaidMintSimulation(rawSimulation, freshCandidate,
    freshCandidate.recipient);
  return Object.freeze({ ready: true, decision, simulation });
}
