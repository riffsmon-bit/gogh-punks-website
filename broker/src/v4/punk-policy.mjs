import { createHash } from "node:crypto";

const ADDRESS = /^0x[0-9a-f]{40}$/;

function uint(value, label) {
  const text = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(text)) throw new TypeError(`${label} is invalid`);
  return BigInt(text);
}

function address(value, label) {
  const normalized = String(value ?? "").toLowerCase();
  if (!ADDRESS.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function addresses(values, label) {
  if (!Array.isArray(values) || values.length > 128) throw new TypeError(`${label} is invalid`);
  return Object.freeze([...new Set(values.map((value) => address(value, label)))].sort());
}

export function normalizeV4PunkPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("V4 Punk policy is invalid");
  }
  const mintType = String(value.mintType ?? "");
  if (!new Set(["FREE_ONLY", "PAID_UP_TO_LIMIT"]).has(mintType)) {
    throw new TypeError("mint type is invalid");
  }
  const dailyMintLimit = Number(value.dailyMintLimit);
  const totalRemainingMintLimit = Number(value.totalRemainingMintLimit);
  const maximumRiskScore = value.maximumRiskScore == null ? null : Number(value.maximumRiskScore);
  const expiresAt = new Date(value.expiresAt);
  if (!Number.isInteger(dailyMintLimit) || dailyMintLimit < 1 || dailyMintLimit > 100
    || !Number.isInteger(totalRemainingMintLimit) || totalRemainingMintLimit < 0
    || totalRemainingMintLimit > 10_000 || !Number.isFinite(expiresAt.getTime())
    || (maximumRiskScore !== null && (!Number.isInteger(maximumRiskScore)
      || maximumRiskScore < 0 || maximumRiskScore > 100))) {
    throw new TypeError("V4 Punk policy limits are invalid");
  }
  return Object.freeze({
    automationEnabled: value.automationEnabled === true,
    mintType,
    maximumMintPriceWei: uint(value.maximumMintPriceWei, "maximum mint price").toString(),
    maximumGasPerMintWei: uint(value.maximumGasPerMintWei, "maximum gas per mint").toString(),
    dailyMintLimit,
    totalRemainingMintLimit,
    minimumNativeReserveWei: uint(value.minimumNativeReserveWei, "minimum reserve").toString(),
    allowedAdapters: addresses(value.allowedAdapters ?? [], "allowed adapter"),
    blockedContracts: addresses(value.blockedContracts ?? [], "blocked contract"),
    maximumRiskScore,
    expiresAt: expiresAt.toISOString(),
  });
}

export function evaluateV4PunkOpportunity(policyValue, candidate, state, now = new Date()) {
  const policy = normalizeV4PunkPolicy(policyValue);
  const adapter = address(candidate?.adapter, "candidate adapter");
  const collection = address(candidate?.collection, "candidate collection");
  const price = uint(candidate?.priceWei, "candidate price");
  const estimatedGas = uint(candidate?.estimatedGasCostWei, "estimated gas cost");
  const balance = uint(state?.punkWalletBalanceWei, "Punk Wallet balance");
  const dailyMints = Number(state?.dailyMints);
  const riskScore = Number(candidate?.riskScore);
  if (!Number.isInteger(dailyMints) || dailyMints < 0 || !Number.isInteger(riskScore)
    || riskScore < 0 || riskScore > 100 || !Number.isFinite(new Date(now).getTime())) {
    throw new TypeError("V4 policy evaluation state is invalid");
  }
  const reasons = [];
  if (!policy.automationEnabled) reasons.push("AUTOMATION_DISABLED");
  if (new Date(now).getTime() >= Date.parse(policy.expiresAt)) reasons.push("POLICY_EXPIRED");
  if (candidate?.screeningState !== "PASSED") reasons.push("SCREENING_NOT_PASSED");
  if (candidate?.simulationState !== "PASSED") reasons.push("SIMULATION_NOT_PASSED");
  if (!policy.allowedAdapters.includes(adapter)) reasons.push("ADAPTER_NOT_ALLOWED");
  if (policy.blockedContracts.includes(collection)) reasons.push("CONTRACT_BLOCKED");
  if (policy.mintType === "FREE_ONLY" && price !== 0n) reasons.push("PAID_MINT_BLOCKED");
  if (price > uint(policy.maximumMintPriceWei, "maximum mint price")) {
    reasons.push("MINT_PRICE_LIMIT_EXCEEDED");
  }
  if (estimatedGas > uint(policy.maximumGasPerMintWei, "maximum gas per mint")) {
    reasons.push("GAS_LIMIT_EXCEEDED");
  }
  if (dailyMints >= policy.dailyMintLimit) reasons.push("DAILY_MINT_LIMIT_REACHED");
  if (policy.totalRemainingMintLimit === 0) reasons.push("TOTAL_MINT_LIMIT_REACHED");
  if (policy.maximumRiskScore !== null && riskScore > policy.maximumRiskScore) {
    reasons.push("RISK_LIMIT_EXCEEDED");
  }
  const required = price + estimatedGas + uint(policy.minimumNativeReserveWei, "minimum reserve");
  if (balance < required) reasons.push("MINIMUM_RESERVE_VIOLATION");
  return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons),
    requiredBalanceWei: required.toString(), policy });
}

export function v4ExecutionIdentity({ chainId, punkAccount, opportunityId, policyHash,
  accountNonce }) {
  const account = address(punkAccount, "Punk account");
  const nonce = uint(accountNonce, "account nonce");
  if (Number(chainId) !== 4663 || typeof opportunityId !== "string"
    || opportunityId.length === 0 || opportunityId.length > 512
    || !/^0x[0-9a-f]{64}$/.test(String(policyHash ?? "").toLowerCase())) {
    throw new TypeError("V4 execution identity input is invalid");
  }
  return createHash("sha256").update([
    "GOGH_V4_EXECUTION_V1", "4663", account, opportunityId,
    String(policyHash).toLowerCase(), nonce.toString(),
  ].join("|")).digest("hex");
}
