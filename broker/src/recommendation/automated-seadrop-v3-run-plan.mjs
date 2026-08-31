import { createHash } from "node:crypto";

import { ROBINHOOD, normalizeAddress } from "../config.mjs";
import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";

export const AUTOMATED_PROFILE_SCHEMA = "GOGH_AUTOMATED_SEADROP_V3_PROFILE_V1";
export const AUTOMATED_LIVE_STATE_SCHEMA = "GOGH_AUTOMATED_SEADROP_V3_LIVE_STATE_V1";
export const AUTOMATED_RUN_PLAN_SCHEMA = "GOGH_AUTOMATED_SEADROP_V3_RUN_PLAN_V1";
export const SEA_DROP = "0x00005ea00ac477b1030ce78506496e8c2de24bf5";
export const SEA_DROP_CODE_HASH =
  "0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c";
export const CLONE_IMPLEMENTATION = "0x09a26fc8fcef18192e267d7a6da9dfb4be81dd6a";
export const CLONE_IMPLEMENTATION_CODE_HASH =
  "0xda60742d810ae5de9c087af2e82b05fb84e9112cfade927fca0db6490ea52519";
export const CLONE_COLLECTION_RUNTIME_CODE_HASH =
  "0xe3e252831cdd0c11e1327d04a57ddd9bfa11ef49d50edb524040d98bfb228bc4";
export const STUDIO_COLLECTION_RUNTIME_CODE_HASH =
  "0x69e7a7158f30acb817dc83a4e21af19a216c3a2ae57db423599ca82f321e3041";
export const SEA_DROP_MINT_PUBLIC_SELECTOR = "0x161ac21f";
export const NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";

const UINT256_MAX = (1n << 256n) - 1n;
const MAX_TARGETS = 50;

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function snapshot(value, label) {
  try {
    const serialized = canonicalJson(value);
    structuredClone(value);
    return parseCanonicalJson(serialized);
  } catch {
    fail("INVALID_JSON", `${label} must be immutable plain JSON without accessors or Proxies`);
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SCHEMA", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCHEMA", `${label} contains missing or unknown fields`);
  }
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("INVALID_VALUE", `${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function decimal(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("INVALID_VALUE", `${label} must be a canonical unsigned decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) fail("INVALID_VALUE", `${label} exceeds uint256`);
  return parsed;
}

function address(value, label) {
  try {
    return normalizeAddress(value, label);
  } catch {
    fail("INVALID_ADDRESS", `${label} must be a 20-byte EVM address`);
  }
}

function hash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)
    || /^0x0{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} must be a nonzero lowercase bytes32`);
  }
  return value;
}

function iso(value, label) {
  if (typeof value !== "string") fail("INVALID_TIME", `${label} must be an ISO timestamp`);
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) {
    fail("INVALID_TIME", `${label} must be a canonical UTC ISO timestamp`);
  }
  return Math.floor(millis / 1000);
}

function bool(value, expected, label) {
  if (value !== expected) fail("UNSAFE_STATE", `${label} must be ${expected}`);
}

function sha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function normalizeProfile(input) {
  const profile = snapshot(input, "profile");
  exactKeys(profile, [
    "schema", "version", "chainId", "punk", "agent", "infrastructure", "limits",
  ], "profile");
  if (profile.schema !== AUTOMATED_PROFILE_SCHEMA || profile.version !== 1
    || profile.chainId !== ROBINHOOD.chainId) {
    fail("INVALID_PROFILE", "profile must use the Robinhood automated SeaDrop V3 schema");
  }
  exactKeys(profile.punk, ["tokenId", "collection", "account", "expectedOwner"], "profile.punk");
  const tokenId = decimal(profile.punk.tokenId, "profile.punk.tokenId");
  const collection = address(profile.punk.collection, "profile.punk.collection");
  if (collection !== ROBINHOOD.canonicalCollection) {
    fail("INVALID_PROFILE", "profile collection is not Gogh Punks");
  }
  const account = address(profile.punk.account, "profile.punk.account");
  const expectedOwner = address(profile.punk.expectedOwner, "profile.punk.expectedOwner");
  const agent = address(profile.agent, "profile.agent");
  if (new Set([account, expectedOwner, agent]).size !== 3) {
    fail("INVALID_PROFILE", "Punk Account, owner, and agent must be distinct");
  }

  exactKeys(profile.infrastructure, [
    "adapter", "adapterCodeHash", "seaDrop", "seaDropCodeHash", "cloneImplementation",
    "cloneImplementationCodeHash", "cloneCollectionRuntimeCodeHash",
    "studioCollectionRuntimeCodeHash",
  ], "profile.infrastructure");
  const infrastructure = {
    adapter: address(profile.infrastructure.adapter, "profile.infrastructure.adapter"),
    adapterCodeHash: hash(
      profile.infrastructure.adapterCodeHash,
      "profile.infrastructure.adapterCodeHash",
    ),
    seaDrop: address(profile.infrastructure.seaDrop, "profile.infrastructure.seaDrop"),
    seaDropCodeHash: hash(
      profile.infrastructure.seaDropCodeHash,
      "profile.infrastructure.seaDropCodeHash",
    ),
    cloneImplementation: address(
      profile.infrastructure.cloneImplementation,
      "profile.infrastructure.cloneImplementation",
    ),
    cloneImplementationCodeHash: hash(
      profile.infrastructure.cloneImplementationCodeHash,
      "profile.infrastructure.cloneImplementationCodeHash",
    ),
    cloneCollectionRuntimeCodeHash: hash(
      profile.infrastructure.cloneCollectionRuntimeCodeHash,
      "profile.infrastructure.cloneCollectionRuntimeCodeHash",
    ),
    studioCollectionRuntimeCodeHash: hash(
      profile.infrastructure.studioCollectionRuntimeCodeHash,
      "profile.infrastructure.studioCollectionRuntimeCodeHash",
    ),
  };
  if (infrastructure.seaDrop !== SEA_DROP
    || infrastructure.seaDropCodeHash !== SEA_DROP_CODE_HASH
    || infrastructure.cloneImplementation !== CLONE_IMPLEMENTATION
    || infrastructure.cloneImplementationCodeHash !== CLONE_IMPLEMENTATION_CODE_HASH
    || infrastructure.cloneCollectionRuntimeCodeHash !== CLONE_COLLECTION_RUNTIME_CODE_HASH
    || infrastructure.studioCollectionRuntimeCodeHash !== STUDIO_COLLECTION_RUNTIME_CODE_HASH) {
    fail("INFRASTRUCTURE_MISMATCH", "profile does not bind the reviewed SeaDrop infrastructure");
  }

  exactKeys(profile.limits, [
    "maxMintsPerUtcDay", "maxMintsPerRun", "maxGasPerMint", "maxGasWeiPerRun",
    "minAgentReserveWei", "intentTtlSeconds", "maxEvidenceAgeSeconds",
    "maxContractRiskScore", "minimumTasteMatch", "stopOnFailure",
  ], "profile.limits");
  const limits = {
    maxMintsPerUtcDay: integer(
      profile.limits.maxMintsPerUtcDay, 1, 10, "profile.limits.maxMintsPerUtcDay",
    ),
    maxMintsPerRun: integer(
      profile.limits.maxMintsPerRun, 1, 10, "profile.limits.maxMintsPerRun",
    ),
    maxGasPerMint: integer(
      profile.limits.maxGasPerMint, 100_000, 1_000_000, "profile.limits.maxGasPerMint",
    ),
    maxGasWeiPerRun: decimal(profile.limits.maxGasWeiPerRun, "profile.limits.maxGasWeiPerRun"),
    minAgentReserveWei: decimal(
      profile.limits.minAgentReserveWei,
      "profile.limits.minAgentReserveWei",
    ),
    intentTtlSeconds: integer(
      profile.limits.intentTtlSeconds, 30, 120, "profile.limits.intentTtlSeconds",
    ),
    maxEvidenceAgeSeconds: integer(
      profile.limits.maxEvidenceAgeSeconds, 5, 30, "profile.limits.maxEvidenceAgeSeconds",
    ),
    maxContractRiskScore: integer(
      profile.limits.maxContractRiskScore, 0, 100, "profile.limits.maxContractRiskScore",
    ),
    minimumTasteMatch: integer(
      profile.limits.minimumTasteMatch, 0, 100, "profile.limits.minimumTasteMatch",
    ),
    stopOnFailure: profile.limits.stopOnFailure,
  };
  bool(limits.stopOnFailure, true, "profile.limits.stopOnFailure");
  if (limits.maxMintsPerRun > limits.maxMintsPerUtcDay || limits.maxGasWeiPerRun === 0n) {
    fail("INVALID_PROFILE", "run cap cannot exceed daily cap and gas budget must be positive");
  }
  return {
    schema: AUTOMATED_PROFILE_SCHEMA,
    version: 1,
    chainId: ROBINHOOD.chainId,
    punk: { tokenId: tokenId.toString(), collection, account, expectedOwner },
    agent,
    infrastructure,
    limits: { ...profile.limits },
  };
}

function normalizeLiveState(input, profile, nowSeconds) {
  const live = snapshot(input, "liveState");
  exactKeys(live, [
    "schema", "chainId", "checkedAt", "blockNumber", "blockHash", "blockTimestamp",
    "owner", "account", "agent", "policyVersion", "nonce", "acquisitionsToday",
    "agentBalanceWei", "maxFeePerGasWei", "accountPaused", "agentAuthorized",
    "featureFlags", "policy", "permissions", "targets",
  ], "liveState");
  if (live.schema !== AUTOMATED_LIVE_STATE_SCHEMA || live.chainId !== ROBINHOOD.chainId) {
    fail("INVALID_LIVE_STATE", "live state must use the automated Robinhood V3 schema");
  }
  const checkedAt = iso(live.checkedAt, "liveState.checkedAt");
  const blockTimestamp = iso(live.blockTimestamp, "liveState.blockTimestamp");
  if (checkedAt > nowSeconds || nowSeconds - checkedAt > profile.limits.maxEvidenceAgeSeconds
    || blockTimestamp > checkedAt
    || checkedAt - blockTimestamp > profile.limits.maxEvidenceAgeSeconds) {
    fail("STALE_EVIDENCE", "live state or chain block is stale");
  }
  integer(live.blockNumber, 1, Number.MAX_SAFE_INTEGER, "liveState.blockNumber");
  hash(live.blockHash, "liveState.blockHash");
  if (address(live.owner, "liveState.owner") !== profile.punk.expectedOwner
    || address(live.account, "liveState.account") !== profile.punk.account
    || address(live.agent, "liveState.agent") !== profile.agent) {
    fail("IDENTITY_CHANGED", "owner, V3 Punk Account, or agent changed");
  }
  bool(live.accountPaused, false, "liveState.accountPaused");
  bool(live.agentAuthorized, true, "liveState.agentAuthorized");
  const policyVersion = decimal(live.policyVersion, "liveState.policyVersion");
  const nonce = decimal(live.nonce, "liveState.nonce");
  const acquisitionsToday = integer(
    live.acquisitionsToday, 0, 10, "liveState.acquisitionsToday",
  );
  const agentBalanceWei = decimal(live.agentBalanceWei, "liveState.agentBalanceWei");
  const maxFeePerGasWei = decimal(live.maxFeePerGasWei, "liveState.maxFeePerGasWei");

  exactKeys(live.featureFlags, [
    "scoutMode", "approvalPurchases", "autonomousPurchases", "autonomousMints",
    "unknownCollectionExecution", "selling", "autonomousSelling",
  ], "liveState.featureFlags");
  bool(live.featureFlags.scoutMode, true, "liveState.featureFlags.scoutMode");
  bool(live.featureFlags.approvalPurchases, false, "liveState.featureFlags.approvalPurchases");
  bool(live.featureFlags.autonomousPurchases, true, "liveState.featureFlags.autonomousPurchases");
  bool(live.featureFlags.autonomousMints, true, "liveState.featureFlags.autonomousMints");
  bool(
    live.featureFlags.unknownCollectionExecution,
    true,
    "liveState.featureFlags.unknownCollectionExecution",
  );
  bool(live.featureFlags.selling, false, "liveState.featureFlags.selling");
  bool(live.featureFlags.autonomousSelling, false, "liveState.featureFlags.autonomousSelling");

  exactKeys(live.policy, [
    "mode", "maxSpendPerTransaction", "maxSpendPerDay", "maxSpendPerWeek", "maxMintPrice",
    "maxSecondaryPurchasePrice", "minimumNativeReserve", "maxAcquisitionsPerDay",
    "maxIntentAge", "maxSlippageBps", "requireCollectionAllowlist",
    "allowUnknownCollections", "autonomousFreeMints", "autonomousPaidMints",
  ], "liveState.policy");
  if (live.policy.mode !== "AUTONOMOUS") fail("UNSAFE_STATE", "policy mode must be AUTONOMOUS");
  for (const field of [
    "maxSpendPerTransaction", "maxSpendPerDay", "maxSpendPerWeek", "maxMintPrice",
    "maxSecondaryPurchasePrice", "minimumNativeReserve",
  ]) {
    if (live.policy[field] !== "0") fail("UNSAFE_STATE", `${field} must be zero`);
  }
  if (live.policy.maxAcquisitionsPerDay !== profile.limits.maxMintsPerUtcDay
    || live.policy.maxIntentAge !== profile.limits.intentTtlSeconds
    || live.policy.maxSlippageBps !== 0) {
    fail("UNSAFE_STATE", "live policy caps differ from the owner profile");
  }
  bool(
    live.policy.requireCollectionAllowlist,
    false,
    "liveState.policy.requireCollectionAllowlist",
  );
  bool(live.policy.allowUnknownCollections, true, "liveState.policy.allowUnknownCollections");
  bool(live.policy.autonomousFreeMints, true, "liveState.policy.autonomousFreeMints");
  bool(live.policy.autonomousPaidMints, false, "liveState.policy.autonomousPaidMints");

  exactKeys(live.permissions, [
    "adapterActive", "adapterAllowed", "venueAllowed", "selectorAllowed", "currencyAllowed",
    "venueCurrencyMaximumWei",
  ], "liveState.permissions");
  for (const field of [
    "adapterActive", "adapterAllowed", "venueAllowed", "selectorAllowed", "currencyAllowed",
  ]) bool(live.permissions[field], true, `liveState.permissions.${field}`);
  if (live.permissions.venueCurrencyMaximumWei !== "0") {
    fail("UNSAFE_STATE", "SeaDrop native-currency maximum must be zero");
  }

  if (!Array.isArray(live.targets) || live.targets.length > MAX_TARGETS) {
    fail("INVALID_LIVE_STATE", `live targets must be an array of at most ${MAX_TARGETS}`);
  }
  const seen = new Set();
  const targets = live.targets.map((target, index) => {
    const label = `liveState.targets[${index}]`;
    exactKeys(target, [
      "collection", "collectionCodeHash", "collectionRuntimeLength", "explicitlyDenied",
      "dropActive", "mintPriceWei", "walletRemaining", "supplyRemaining", "nextTokenId",
      "restrictFeeRecipients", "feeRecipientAllowed", "contractRiskScore", "tasteMatch", "metadataSanitized",
      "analysisComplete", "simulationSucceeded", "simulationTarget", "simulationValueWei",
      "simulationSelector", "gasEstimate", "opportunityId", "reasoningHash",
    ], label);
    const collection = address(target.collection, `${label}.collection`);
    if (seen.has(collection)) fail("INVALID_LIVE_STATE", "duplicate target collection");
    seen.add(collection);
    const cloneRuntime = target.collectionCodeHash === CLONE_COLLECTION_RUNTIME_CODE_HASH
      && target.collectionRuntimeLength === 45;
    const studioRuntime = target.collectionCodeHash === STUDIO_COLLECTION_RUNTIME_CODE_HASH
      && target.collectionRuntimeLength === 19_658;
    if (!cloneRuntime && !studioRuntime) {
      fail("TARGET_INELIGIBLE", `${label} is not a reviewed OpenSea Studio runtime`);
    }
    bool(target.explicitlyDenied, false, `${label}.explicitlyDenied`);
    bool(target.dropActive, true, `${label}.dropActive`);
    if (typeof target.restrictFeeRecipients !== "boolean"
      || typeof target.feeRecipientAllowed !== "boolean") {
      fail("INVALID_LIVE_STATE", `${label} fee-recipient evidence must be boolean`);
    }
    if (target.restrictFeeRecipients && !target.feeRecipientAllowed) {
      fail("TARGET_INELIGIBLE", `${label} does not allow the pinned OpenSea fee recipient`);
    }
    bool(target.metadataSanitized, true, `${label}.metadataSanitized`);
    bool(target.analysisComplete, true, `${label}.analysisComplete`);
    bool(target.simulationSucceeded, true, `${label}.simulationSucceeded`);
    if (target.mintPriceWei !== "0" || target.simulationValueWei !== "0"
      || address(target.simulationTarget, `${label}.simulationTarget`) !== SEA_DROP
      || target.simulationSelector !== SEA_DROP_MINT_PUBLIC_SELECTOR) {
      fail("TARGET_INELIGIBLE", `${label} is not an exact zero-value SeaDrop simulation`);
    }
    const walletRemaining = decimal(target.walletRemaining, `${label}.walletRemaining`);
    const supplyRemaining = decimal(target.supplyRemaining, `${label}.supplyRemaining`);
    const nextTokenId = decimal(target.nextTokenId, `${label}.nextTokenId`);
    const gasEstimate = decimal(target.gasEstimate, `${label}.gasEstimate`);
    if (walletRemaining === 0n || supplyRemaining === 0n || nextTokenId === 0n
      || gasEstimate === 0n || gasEstimate > BigInt(profile.limits.maxGasPerMint)) {
      fail("TARGET_INELIGIBLE", `${label} has no capacity or exceeds the gas limit`);
    }
    const contractRiskScore = integer(
      target.contractRiskScore, 0, 100, `${label}.contractRiskScore`,
    );
    const tasteMatch = integer(target.tasteMatch, 0, 100, `${label}.tasteMatch`);
    return {
      collection,
      collectionCodeHash: target.collectionCodeHash,
      collectionRuntimeFamily: cloneRuntime ? "ERC721_CLONE" : "ERC721_STANDARD",
      nextTokenId,
      gasEstimate,
      walletRemaining,
      supplyRemaining,
      contractRiskScore,
      tasteMatch,
      opportunityId: hash(target.opportunityId, `${label}.opportunityId`),
      reasoningHash: hash(target.reasoningHash, `${label}.reasoningHash`),
    };
  });
  return {
    checkedAt,
    policyVersion,
    nonce,
    acquisitionsToday,
    agentBalanceWei,
    maxFeePerGasWei,
    targets,
  };
}

export function buildAutomatedSeaDropV3RunPlan(profileInput, liveStateInput, options = {}) {
  const normalizedOptions = snapshot(options, "options");
  const optionKeys = Object.hasOwn(normalizedOptions, "gasPayer")
    ? ["gasPayer", "nowSeconds"] : ["nowSeconds"];
  exactKeys(normalizedOptions, optionKeys, "options");
  const gasPayer = normalizedOptions.gasPayer ?? "AGENT";
  if (!new Set(["AGENT", "OWNER"]).has(gasPayer)) {
    fail("INVALID_VALUE", "options.gasPayer must be AGENT or OWNER");
  }
  const nowSeconds = integer(
    normalizedOptions.nowSeconds, 1, Number.MAX_SAFE_INTEGER, "options.nowSeconds",
  );
  const profile = normalizeProfile(profileInput);
  const live = normalizeLiveState(liveStateInput, profile, nowSeconds);
  const remainingDaily = profile.limits.maxMintsPerUtcDay - live.acquisitionsToday;
  if (remainingDaily <= 0) fail("DAILY_CAP_REACHED", "the Punk reached its UTC daily cap");

  const reserve = BigInt(profile.limits.minAgentReserveWei);
  const available = live.agentBalanceWei > reserve ? live.agentBalanceWei - reserve : 0n;
  const gasBudget = gasPayer === "OWNER" ? BigInt(profile.limits.maxGasWeiPerRun)
    : available < BigInt(profile.limits.maxGasWeiPerRun)
      ? available : BigInt(profile.limits.maxGasWeiPerRun);
  if (gasBudget === 0n) fail(
    "INSUFFICIENT_GAS",
    gasPayer === "OWNER" ? "the owner-paid gas limit is zero"
      : "agent gas balance cannot preserve its reserve",
  );

  // Phase 1 is an exact zero-price execution lane. Taste and off-chain risk scores
  // remain recorded for the journal, but never override the live clone/runtime,
  // public-drop, capacity, zero-value, simulation, policy, and gas gates above.
  const eligible = [...live.targets]
    .sort((left, right) => left.collection.localeCompare(right.collection));
  const maximumCount = Math.min(
    remainingDaily,
    profile.limits.maxMintsPerRun,
    eligible.length,
  );
  const actions = [];
  let plannedGasWei = 0n;
  for (const target of eligible) {
    if (actions.length >= maximumCount) break;
    const maximumGasCostWei = target.gasEstimate * live.maxFeePerGasWei;
    if (maximumGasCostWei > gasBudget - plannedGasWei) continue;
    const validUntil = nowSeconds + profile.limits.intentTtlSeconds;
    actions.push({
      sequence: actions.length + 1,
      account: profile.punk.account,
      chainId: ROBINHOOD.chainId,
      expectedOwner: profile.punk.expectedOwner,
      nonce: (live.nonce + BigInt(actions.length)).toString(),
      policyVersion: live.policyVersion.toString(),
      opportunityType: "FREE_MINT",
      assetStandard: "ERC721",
      adapter: profile.infrastructure.adapter,
      venue: SEA_DROP,
      collection: target.collection,
      tokenId: target.nextTokenId.toString(),
      assetAmount: "1",
      currency: NATIVE_CURRENCY,
      expectedPrice: "0",
      maxPrice: "0",
      maxSlippageBps: 0,
      createdAt: String(nowSeconds),
      expiresAt: String(validUntil),
      opportunityId: target.opportunityId,
      reasoningHash: target.reasoningHash,
      adapterCodeHash: profile.infrastructure.adapterCodeHash,
      adapterData: "0x",
      gasEstimate: target.gasEstimate.toString(),
      maximumGasCostWei: maximumGasCostWei.toString(),
      automatedEligibility: {
        reviewedCollectionRuntime: target.collectionRuntimeFamily,
        canonicalSeaDropRuntime: true,
        canonicalImplementationRuntime: true,
        publicDropActive: true,
        mintPriceWei: "0",
        quantity: "1",
        approvalsAllowed: false,
        arbitraryCalldataAllowed: false,
        contractRiskScore: target.contractRiskScore,
        tasteMatch: target.tasteMatch,
      },
    });
    plannedGasWei += maximumGasCostWei;
  }
  if (actions.length === 0) {
    fail("NO_EXECUTABLE_TARGETS", "no live zero-price target fits capacity and gas limits");
  }

  const plan = {
    schema: AUTOMATED_RUN_PLAN_SCHEMA,
    version: 1,
    chainId: ROBINHOOD.chainId,
    generatedAt: new Date(nowSeconds * 1000).toISOString(),
    profileHash: sha256(profile),
    liveEvidenceHash: sha256(snapshot(liveStateInput, "liveState")),
    checkedAt: new Date(live.checkedAt * 1000).toISOString(),
    punk: profile.punk,
    agent: profile.agent,
    limits: {
      dailyCap: profile.limits.maxMintsPerUtcDay,
      acquisitionsAlreadyToday: live.acquisitionsToday,
      runCap: profile.limits.maxMintsPerRun,
      selectedCount: actions.length,
      maximumRunGasCostWei: profile.limits.maxGasWeiPerRun,
      plannedMaximumGasCostWei: plannedGasWei.toString(),
      minimumAgentReserveWei: profile.limits.minAgentReserveWei,
      stopOnFailure: true,
    },
    actions,
    safety: {
      targetHumanReviewRequired: false,
      automatedOnchainEligibilityRequired: true,
      zeroPriceOnly: true,
      exactSeaDropOnly: true,
      exactReviewedStudioRuntimeFamiliesOnly: true,
      quantityOneOnly: true,
      tokenApprovalsAllowed: false,
      arbitraryCalldataAllowed: false,
      paidMintsAllowed: false,
      sellingAllowed: false,
      signingPerformed: false,
      submissionPerformed: false,
      chainStateWritten: false,
      executionAuthorizedByThisArtifact: false,
      mandatoryNextGate:
        "FRESH_DUAL_RPC_RECHECK_SIMULATION_AGENT_SIGNING_SUBMISSION_AND_RECEIPT_ATTESTATION",
    },
  };
  return deepFreeze({ ...plan, planHash: sha256(plan) });
}
