import { createHash } from "node:crypto";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"00".repeat(32)}`;

export class CleanPreconfigurationStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CleanPreconfigurationStateError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CleanPreconfigurationStateError(code, message);
}

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("INVALID_CLEAN_PRESTATE", `${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_CLEAN_PRESTATE", `${label} fields do not match the canonical schema`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function same(actual, expected, label) {
  if (typeof actual === "string" && typeof expected === "string") {
    if (actual.toLowerCase() === expected.toLowerCase()) return;
  } else if (actual === expected) return;
  fail("NONCLEAN_PRECONFIGURATION", `${label} does not match the required clean value`);
}

function hash(value, label, allowZero = false) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)
    || (!allowZero && value.toLowerCase() === ZERO_HASH)) {
    fail("INVALID_CLEAN_PRESTATE", `${label} is not a valid hash`);
  }
  return value.toLowerCase();
}

function zeroDecimal(value, label) {
  same(value, "0", label);
}

function validateScan(scan, label, expectedFrom, expectedTo, countKeys) {
  exact(scan, ["fromBlock", "toBlock", ...countKeys, "passed", "evidenceHash"], label);
  same(scan.fromBlock, expectedFrom, `${label}.fromBlock`);
  same(scan.toBlock, expectedTo, `${label}.toBlock`);
  for (const key of countKeys) same(scan[key], 0, `${label}.${key}`);
  same(scan.passed, true, `${label}.passed`);
  const body = { ...scan };
  delete body.evidenceHash;
  same(hash(scan.evidenceHash, `${label}.evidenceHash`), sha(body), `${label}.evidenceHash`);
}

export function validateCleanPreconfigurationState(value, {
  commonBlockNumber,
  commonBlockHash,
  commonBlockTimestamp,
  policyDeploymentBlock,
  agentRegistryDeploymentBlock,
}) {
  exact(value, [
    "blockNumber", "blockHash", "blockTimestamp", "accountState", "acquisitionNonce",
    "policy", "mintControls", "adapterRecord", "permissions", "featureFlags",
    "globalPauses", "authorizationGeneration", "activeAgents",
    "agentAuthorizationEventScan", "acquisitionUsage", "nativeUsage", "isolationEventScan",
    "evidenceHash",
  ], "cleanPreconfigurationState");
  same(value.blockNumber, commonBlockNumber, "clean block number");
  same(hash(value.blockHash, "clean block hash"), commonBlockHash, "clean block hash");
  same(value.blockTimestamp, commonBlockTimestamp, "clean block timestamp");
  zeroDecimal(value.accountState, "account state");
  zeroDecimal(value.acquisitionNonce, "acquisition nonce");

  exact(value.policy, [
    "mode", "maxSpendPerTransaction", "maxSpendPerDay", "maxSpendPerWeek", "maxMintPrice",
    "maxSecondaryPurchasePrice", "minimumNativeReserve", "maxAcquisitionsPerDay",
    "maxIntentAge", "maxSlippageBps", "requireCollectionAllowlist",
    "allowUnknownCollections", "configuredBy", "version", "permissionGeneration",
    "accountPaused",
  ], "clean policy");
  for (const field of [
    "mode", "maxAcquisitionsPerDay", "maxIntentAge", "maxSlippageBps", "version",
    "permissionGeneration",
  ]) same(value.policy[field], 0, `clean policy.${field}`);
  for (const field of [
    "maxSpendPerTransaction", "maxSpendPerDay", "maxSpendPerWeek", "maxMintPrice",
    "maxSecondaryPurchasePrice", "minimumNativeReserve",
  ]) zeroDecimal(value.policy[field], `clean policy.${field}`);
  same(value.policy.configuredBy, ZERO_ADDRESS, "clean policy.configuredBy");
  for (const field of ["requireCollectionAllowlist", "allowUnknownCollections", "accountPaused"]) {
    same(value.policy[field], false, `clean policy.${field}`);
  }

  exact(value.mintControls,
    ["ownerApprovedMints", "autonomousFreeMints", "autonomousPaidMints"],
    "clean mint controls");
  for (const field of Object.keys(value.mintControls)) {
    same(value.mintControls[field], false, `clean mint controls.${field}`);
  }
  exact(value.adapterRecord, [
    "kind", "active", "venue", "adapterCodeHash", "venueCodeHash", "versionHash",
    "metadataHash",
  ], "clean adapter record");
  same(value.adapterRecord.kind, 0, "clean adapter kind");
  same(value.adapterRecord.active, false, "clean adapter active");
  same(value.adapterRecord.venue, ZERO_ADDRESS, "clean adapter venue");
  for (const field of ["adapterCodeHash", "venueCodeHash", "versionHash", "metadataHash"]) {
    same(hash(value.adapterRecord[field], `clean adapter ${field}`, true), ZERO_HASH,
      `clean adapter ${field}`);
  }

  exact(value.permissions, [
    "adapterAllowed", "mintContractAllowed", "collectionAllowed", "collectionDenied",
    "selectorAllowed", "selectorDenied", "nativeCurrencyPolicy", "venueCurrencyMaximum",
  ], "clean permissions");
  for (const field of [
    "adapterAllowed", "mintContractAllowed", "collectionAllowed", "collectionDenied",
    "selectorAllowed", "selectorDenied",
  ]) same(value.permissions[field], false, `clean permissions.${field}`);
  zeroDecimal(value.permissions.venueCurrencyMaximum, "clean venue maximum");
  exact(value.permissions.nativeCurrencyPolicy, [
    "allowed", "maxSpendPerTransaction", "maxSpendPerDay", "maxSpendPerWeek", "maxMintPrice",
    "maxSecondaryPurchasePrice",
  ], "clean native currency policy");
  same(value.permissions.nativeCurrencyPolicy.allowed, false, "clean native currency allowed");
  for (const field of [
    "maxSpendPerTransaction", "maxSpendPerDay", "maxSpendPerWeek", "maxMintPrice",
    "maxSecondaryPurchasePrice",
  ]) zeroDecimal(value.permissions.nativeCurrencyPolicy[field], `clean native currency.${field}`);

  exact(value.featureFlags, [
    "scoutMode", "approvalPurchases", "autonomousPurchases", "autonomousMints",
    "unknownCollectionExecution", "selling", "autonomousSelling",
  ], "clean feature flags");
  same(value.featureFlags.scoutMode, true, "clean scout mode");
  for (const field of Object.keys(value.featureFlags).filter((field) => field !== "scoutMode")) {
    same(value.featureFlags[field], false, `clean feature flags.${field}`);
  }
  exact(value.globalPauses, ["policy", "adapters", "agents"], "clean global pauses");
  for (const field of Object.keys(value.globalPauses)) {
    same(value.globalPauses[field], false, `clean global pauses.${field}`);
  }
  same(value.authorizationGeneration, 0, "clean agent authorization generation");
  if (!Array.isArray(value.activeAgents) || value.activeAgents.length !== 0) {
    fail("NONCLEAN_PRECONFIGURATION", "clean activeAgents must be empty");
  }
  exact(value.acquisitionUsage, ["acquisitionsToday"], "clean acquisition usage");
  same(value.acquisitionUsage.acquisitionsToday, 0, "clean acquisitions today");
  exact(value.nativeUsage, ["acquisitionsToday", "spentToday", "spentThisWeek"],
    "clean native usage");
  same(value.nativeUsage.acquisitionsToday, 0, "clean native acquisitions today");
  zeroDecimal(value.nativeUsage.spentToday, "clean native spent today");
  zeroDecimal(value.nativeUsage.spentThisWeek, "clean native spent this week");
  validateScan(value.isolationEventScan, "clean isolation event scan", policyDeploymentBlock,
    commonBlockNumber, ["accountScopedPolicyMutationEvents", "featureFlagChangeEvents"]);
  validateScan(value.agentAuthorizationEventScan, "clean agent event scan",
    agentRegistryDeploymentBlock, commonBlockNumber,
    ["authorizedEvents", "revokedEvents", "allAgentsRevokedEvents"]);
  const body = { ...value };
  delete body.evidenceHash;
  same(hash(value.evidenceHash, "clean preconfiguration evidence hash"), sha(body),
    "clean preconfiguration evidence hash");
  return Object.freeze({ ...value });
}
