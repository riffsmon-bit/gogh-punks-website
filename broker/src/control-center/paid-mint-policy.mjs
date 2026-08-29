const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_UINT256 = (1n << 256n) - 1n;

export class PaidMintPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PaidMintPolicyError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PaidMintPolicyError(code, message);
}

function exact(value, keys, label) {
  try { return snapshotExactRecord(value, keys, label); }
  catch (error) { fail("INVALID_INPUT", error.message); }
}

export function canonicalUint(value, label = "amount") {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    fail("INVALID_INTEGER", `${label} must be a canonical unsigned decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) fail("INVALID_INTEGER", `${label} exceeds uint256`);
  return parsed;
}

function canonicalAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_ADDRESS", `${label} is invalid`);
  }
  return value.toLowerCase();
}

function canonicalTokenId(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,3})$/.test(value)) {
    fail("INVALID_TOKEN", "Punk token ID is invalid");
  }
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("INVALID_INTEGER", `${label} is invalid`);
  }
  return value;
}

function canonicalBoolean(value, label) {
  if (typeof value !== "boolean") fail("INVALID_BOOLEAN", `${label} must be boolean`);
  return value;
}

export function normalizePaidMintPolicy(value) {
  value = exact(value, ["schema", "chainId", "punkTokenId", "account", "configuredBy",
    "currentOwner", "authorizationActive", "freeMintsEnabled", "paidMintsEnabled", "dailyMintLimit",
    "dailySpendLimitWei", "maxPerMintWei", "authorizationValidUntil"], "policy");
  if (value.schema !== "GOGH_PUNK_PAID_MINT_POLICY_V2" || value.chainId !== 4663) {
    fail("INVALID_POLICY", "policy schema or chain is invalid");
  }
  const policy = {
    schema: value.schema,
    chainId: value.chainId,
    punkTokenId: canonicalTokenId(value.punkTokenId),
    account: canonicalAddress(value.account, "Punk wallet"),
    configuredBy: canonicalAddress(value.configuredBy, "configured owner"),
    currentOwner: canonicalAddress(value.currentOwner, "current owner"),
    authorizationActive: canonicalBoolean(value.authorizationActive, "authorization status"),
    freeMintsEnabled: canonicalBoolean(value.freeMintsEnabled, "free mint permission"),
    paidMintsEnabled: canonicalBoolean(value.paidMintsEnabled, "paid mint permission"),
    dailyMintLimit: boundedInteger(value.dailyMintLimit, 0, 100, "daily mint limit"),
    dailySpendLimitWei: canonicalUint(value.dailySpendLimitWei, "daily spend limit").toString(),
    maxPerMintWei: canonicalUint(value.maxPerMintWei, "per-mint limit").toString(),
    authorizationValidUntil: boundedInteger(value.authorizationValidUntil, 0,
      Number.MAX_SAFE_INTEGER, "authorization expiry"),
  };
  return Object.freeze(policy);
}

export function normalizeDailySpendUsage(value) {
  value = exact(value, ["utcDay", "amountSpentWei", "paidMintCount", "totalMintCount"], "usage");
  if (typeof value.utcDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.utcDay)
    || new Date(`${value.utcDay}T00:00:00.000Z`).toISOString().slice(0, 10) !== value.utcDay) {
    fail("INVALID_USAGE", "usage UTC day is invalid");
  }
  return Object.freeze({
    utcDay: value.utcDay,
    amountSpentWei: canonicalUint(value.amountSpentWei, "spent amount").toString(),
    paidMintCount: boundedInteger(value.paidMintCount, 0, 1_000_000, "paid mint count"),
    totalMintCount: boundedInteger(value.totalMintCount, 0, 1_000_000, "total mint count"),
  });
}

export function normalizePaidMintCandidate(value) {
  value = exact(value, ["chainId", "adapterId", "mintContract", "collection", "recipient",
    "priceWei", "transactionValueWei", "quantity", "saleActive", "runtimeSupported"],
  "candidate");
  if (value.chainId !== 4663 || value.quantity !== 1) {
    fail("INVALID_CANDIDATE", "candidate chain or quantity is unsupported");
  }
  if (typeof value.adapterId !== "string" || !/^[A-Z0-9_]{3,64}$/.test(value.adapterId)) {
    fail("INVALID_CANDIDATE", "adapter identity is invalid");
  }
  return Object.freeze({
    chainId: 4663,
    adapterId: value.adapterId,
    mintContract: canonicalAddress(value.mintContract, "mint contract"),
    collection: canonicalAddress(value.collection, "collection"),
    recipient: canonicalAddress(value.recipient, "recipient"),
    priceWei: canonicalUint(value.priceWei, "mint price").toString(),
    transactionValueWei: canonicalUint(value.transactionValueWei, "transaction value").toString(),
    quantity: 1,
    saleActive: canonicalBoolean(value.saleActive, "sale status"),
    runtimeSupported: canonicalBoolean(value.runtimeSupported, "runtime status"),
  });
}

function result(allowed, code, policy, usage, candidate) {
  const limit = canonicalUint(policy.dailySpendLimitWei);
  const spent = canonicalUint(usage.amountSpentWei);
  const remaining = spent < limit ? limit - spent : 0n;
  return Object.freeze({
    allowed, code,
    priceWei: candidate.priceWei,
    spentTodayWei: spent.toString(),
    remainingDailySpendWei: remaining.toString(),
    dailySpendLimitWei: limit.toString(),
    maxPerMintWei: policy.maxPerMintWei,
    totalMintCount: usage.totalMintCount,
    dailyMintLimit: policy.dailyMintLimit,
  });
}

export function evaluatePaidMint(input) {
  const { policy: rawPolicy, usage: rawUsage, candidate: rawCandidate, nowSeconds }
    = exact(input, ["policy", "usage", "candidate", "nowSeconds"], "evaluation");
  const policy = normalizePaidMintPolicy(rawPolicy);
  const usage = normalizeDailySpendUsage(rawUsage);
  const candidate = normalizePaidMintCandidate(rawCandidate);
  const now = boundedInteger(nowSeconds, 0, Number.MAX_SAFE_INTEGER, "current time");
  const utcDay = new Date(now * 1_000).toISOString().slice(0, 10);
  if (usage.utcDay !== utcDay) return result(false, "USAGE_DAY_MISMATCH", policy, usage, candidate);
  if (policy.currentOwner !== policy.configuredBy) return result(false, "OWNER_CHANGED", policy, usage, candidate);
  if (!policy.authorizationActive) return result(false, "AUTHORIZATION_INACTIVE", policy, usage, candidate);
  if (candidate.recipient !== policy.account) return result(false, "WRONG_RECIPIENT", policy, usage, candidate);
  if (!candidate.runtimeSupported) return result(false, "UNSUPPORTED_RUNTIME", policy, usage, candidate);
  if (!candidate.saleActive) return result(false, "SALE_INACTIVE", policy, usage, candidate);
  if (!policy.paidMintsEnabled) return result(false, "PAID_MODE_DISABLED", policy, usage, candidate);
  if (now >= policy.authorizationValidUntil) return result(false, "AUTHORIZATION_EXPIRED", policy, usage, candidate);
  if (usage.totalMintCount >= policy.dailyMintLimit) return result(false, "DAILY_MINT_LIMIT", policy, usage, candidate);
  const price = canonicalUint(candidate.priceWei);
  if (price === 0n || price !== canonicalUint(candidate.transactionValueWei)) {
    return result(false, "PRICE_VALUE_MISMATCH", policy, usage, candidate);
  }
  if (price > canonicalUint(policy.maxPerMintWei)) return result(false, "PER_MINT_LIMIT", policy, usage, candidate);
  const spent = canonicalUint(usage.amountSpentWei);
  const daily = canonicalUint(policy.dailySpendLimitWei);
  if (spent > daily || price > daily - spent) return result(false, "DAILY_SPEND_LIMIT", policy, usage, candidate);
  return result(true, "ALLOWED", policy, usage, candidate);
}

export function assertPaidMintSimulation(value, candidateValue, expectedAccount) {
  value = exact(value, ["success", "nativeSpentWei", "approvals", "outgoingNfts", "outgoingTokens",
    "contractCreations", "nftReceipts"], "simulation");
  const candidate = normalizePaidMintCandidate(candidateValue);
  const account = canonicalAddress(expectedAccount, "expected Punk wallet");
  if (value.success !== true) fail("SIMULATION_REVERT", "transaction simulation failed");
  if (canonicalUint(value.nativeSpentWei, "simulated spend") !== canonicalUint(candidate.priceWei)) {
    fail("UNEXPECTED_SPEND", "simulation spend differs from the reviewed price");
  }
  for (const [key, code] of [["approvals", "UNEXPECTED_APPROVAL"],
    ["outgoingNfts", "UNEXPECTED_NFT_TRANSFER"], ["outgoingTokens", "UNEXPECTED_TOKEN_TRANSFER"],
    ["contractCreations", "UNEXPECTED_CONTRACT_CREATION"]]) {
    let entries;
    try { entries = snapshotDenseArray(value[key], `simulation ${key}`); }
    catch { fail(code, `simulation contains invalid ${key}`); }
    if (entries.length !== 0) {
      fail(code, `simulation contains ${key}`);
    }
  }
  let receipts;
  try { receipts = snapshotDenseArray(value.nftReceipts, "simulation NFT receipts"); }
  catch { fail("UNEXPECTED_RECEIPT", "simulation NFT receipts are invalid"); }
  if (receipts.length !== 1) {
    fail("UNEXPECTED_RECEIPT", "simulation must mint exactly one NFT");
  }
  const receipt = exact(receipts[0], ["collection", "recipient", "quantity"], "NFT receipt");
  if (canonicalAddress(receipt.collection, "receipt collection") !== candidate.collection
    || canonicalAddress(receipt.recipient, "receipt recipient") !== account
    || receipt.quantity !== 1) {
    fail("UNEXPECTED_RECEIPT", "simulation NFT receipt is not the reviewed Punk mint");
  }
  return Object.freeze({ safe: true, code: "SIMULATION_PASSED", nativeSpentWei: candidate.priceWei,
    recipient: account, collection: candidate.collection });
}

export { ZERO_ADDRESS };
import { snapshotDenseArray, snapshotExactRecord } from "./strict-record.mjs";
