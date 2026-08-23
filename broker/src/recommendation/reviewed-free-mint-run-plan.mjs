import { createHash } from "node:crypto";

import { ROBINHOOD, normalizeAddress } from "../config.mjs";
import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";

export const REVIEWED_QUEUE_SCHEMA = "GOGH_REVIEWED_FREE_MINT_QUEUE_V1";
export const REVIEWED_RUN_PLAN_SCHEMA = "GOGH_REVIEWED_FREE_MINT_RUN_PLAN_V1";
export const SEA_DROP = "0x00005ea00ac477b1030ce78506496e8c2de24bf5";
export const SEA_DROP_MINT_PUBLIC_SELECTOR = "0x161ac21f";
export const NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";

const UINT256_MAX = (1n << 256n) - 1n;
const MAX_TARGETS = 10;

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
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
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
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} must be a nonzero lowercase bytes32`);
  }
  return value;
}

function blockHash(value, label) {
  return hash(value, label);
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
  return value;
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

function normalizeQueue(input) {
  const queue = snapshot(input, "queue");
  exactKeys(queue, ["schema", "version", "chainId", "createdAt", "expiresAt", "punk", "agent", "limits", "targets"], "queue");
  if (queue.schema !== REVIEWED_QUEUE_SCHEMA || queue.version !== 1 || queue.chainId !== ROBINHOOD.chainId) {
    fail("INVALID_QUEUE", "queue must use the reviewed Robinhood V1 schema");
  }
  const createdAt = iso(queue.createdAt, "queue.createdAt");
  const expiresAt = iso(queue.expiresAt, "queue.expiresAt");
  if (expiresAt <= createdAt || expiresAt - createdAt > 86_400) {
    fail("INVALID_QUEUE", "queue lifetime must be positive and no longer than 24 hours");
  }

  exactKeys(queue.punk, ["tokenId", "collection", "account", "expectedOwner"], "queue.punk");
  const tokenId = decimal(queue.punk.tokenId, "queue.punk.tokenId");
  if (tokenId === 0n) fail("INVALID_QUEUE", "queue Punk token ID must be positive");
  const collection = address(queue.punk.collection, "queue.punk.collection");
  if (collection !== ROBINHOOD.canonicalCollection) fail("INVALID_QUEUE", "queue collection is not Gogh Punks");
  const account = address(queue.punk.account, "queue.punk.account");
  const expectedOwner = address(queue.punk.expectedOwner, "queue.punk.expectedOwner");
  const agent = address(queue.agent, "queue.agent");
  if (new Set([account, expectedOwner, agent]).size !== 3) {
    fail("INVALID_QUEUE", "account, current owner, and agent must be distinct");
  }

  exactKeys(queue.limits, [
    "maxMintsPerUtcDay", "maxMintsPerRun", "maxGasPerMint", "maxGasWeiPerRun",
    "minAgentReserveWei", "intentTtlSeconds", "maxEvidenceAgeSeconds", "stopOnFailure",
    "containAfterRun",
  ], "queue.limits");
  const limits = {
    maxMintsPerUtcDay: integer(queue.limits.maxMintsPerUtcDay, 1, 10, "queue.limits.maxMintsPerUtcDay"),
    maxMintsPerRun: integer(queue.limits.maxMintsPerRun, 1, 10, "queue.limits.maxMintsPerRun"),
    maxGasPerMint: integer(queue.limits.maxGasPerMint, 100_000, 1_000_000, "queue.limits.maxGasPerMint"),
    maxGasWeiPerRun: decimal(queue.limits.maxGasWeiPerRun, "queue.limits.maxGasWeiPerRun"),
    minAgentReserveWei: decimal(queue.limits.minAgentReserveWei, "queue.limits.minAgentReserveWei"),
    intentTtlSeconds: integer(queue.limits.intentTtlSeconds, 30, 120, "queue.limits.intentTtlSeconds"),
    maxEvidenceAgeSeconds: integer(queue.limits.maxEvidenceAgeSeconds, 5, 30, "queue.limits.maxEvidenceAgeSeconds"),
    stopOnFailure: bool(queue.limits.stopOnFailure, true, "queue.limits.stopOnFailure"),
    containAfterRun: bool(queue.limits.containAfterRun, true, "queue.limits.containAfterRun"),
  };
  if (limits.maxMintsPerRun > limits.maxMintsPerUtcDay || limits.maxGasWeiPerRun === 0n) {
    fail("INVALID_QUEUE", "run cap cannot exceed the daily cap and gas budget must be positive");
  }

  if (!Array.isArray(queue.targets) || queue.targets.length === 0 || queue.targets.length > MAX_TARGETS) {
    fail("INVALID_QUEUE", `queue must contain one through ${MAX_TARGETS} reviewed targets`);
  }
  const seenIds = new Set();
  const seenCollections = new Set();
  const seenAdapters = new Set();
  const targets = queue.targets.map((target, index) => {
    const label = `queue.targets[${index}]`;
    exactKeys(target, [
      "id", "opportunityId", "reasoningHash", "collection", "collectionCodeHash",
      "venue", "venueCodeHash", "selector", "adapter", "adapterCodeHash",
      "adapterVersionHash", "adapterMetadataHash", "adapterData",
      "assetAmount", "currency", "expectedPrice", "maxPrice", "maxSlippageBps",
      "reviewEvidenceHash", "reviewedAt", "expiresAt", "status",
    ], label);
    if (typeof target.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(target.id)) {
      fail("INVALID_TARGET", `${label}.id must be a short lowercase identifier`);
    }
    const targetCollection = address(target.collection, `${label}.collection`);
    const adapter = address(target.adapter, `${label}.adapter`);
    const venue = address(target.venue, `${label}.venue`);
    if (venue !== SEA_DROP || target.adapterData !== "0x" || target.assetAmount !== "1"
      || address(target.currency, `${label}.currency`) !== NATIVE_CURRENCY
      || target.selector !== SEA_DROP_MINT_PUBLIC_SELECTOR
      || target.expectedPrice !== "0" || target.maxPrice !== "0" || target.maxSlippageBps !== 0
      || target.status !== "REVIEWED_READY") {
      fail("INVALID_TARGET", `${label} is not an exact zero-value quantity-one SeaDrop target`);
    }
    const reviewedAt = iso(target.reviewedAt, `${label}.reviewedAt`);
    const targetExpiresAt = iso(target.expiresAt, `${label}.expiresAt`);
    if (reviewedAt < createdAt || targetExpiresAt <= reviewedAt || targetExpiresAt > expiresAt) {
      fail("INVALID_TARGET", `${label} review times are outside the queue lifetime`);
    }
    if (seenIds.has(target.id) || seenCollections.has(targetCollection) || seenAdapters.has(adapter)) {
      fail("INVALID_TARGET", "target IDs, collections, and bound adapters must be unique");
    }
    seenIds.add(target.id); seenCollections.add(targetCollection); seenAdapters.add(adapter);
    return {
      id: target.id,
      opportunityId: hash(target.opportunityId, `${label}.opportunityId`),
      reasoningHash: hash(target.reasoningHash, `${label}.reasoningHash`),
      collection: targetCollection,
      collectionCodeHash: hash(target.collectionCodeHash, `${label}.collectionCodeHash`),
      venue,
      venueCodeHash: hash(target.venueCodeHash, `${label}.venueCodeHash`),
      selector: SEA_DROP_MINT_PUBLIC_SELECTOR,
      adapter,
      adapterCodeHash: hash(target.adapterCodeHash, `${label}.adapterCodeHash`),
      adapterVersionHash: hash(target.adapterVersionHash, `${label}.adapterVersionHash`),
      adapterMetadataHash: hash(target.adapterMetadataHash, `${label}.adapterMetadataHash`),
      adapterData: "0x", assetAmount: "1", currency: NATIVE_CURRENCY,
      expectedPrice: "0", maxPrice: "0", maxSlippageBps: 0,
      reviewEvidenceHash: hash(target.reviewEvidenceHash, `${label}.reviewEvidenceHash`),
      reviewedAt: target.reviewedAt, expiresAt: target.expiresAt,
      status: "REVIEWED_READY",
    };
  });

  return {
    schema: REVIEWED_QUEUE_SCHEMA, version: 1, chainId: ROBINHOOD.chainId,
    createdAt: queue.createdAt, expiresAt: queue.expiresAt,
    punk: { tokenId: tokenId.toString(), collection, account, expectedOwner },
    agent, limits: { ...queue.limits }, targets,
  };
}

function normalizeLiveState(input, queue, nowSeconds) {
  const live = snapshot(input, "liveState");
  exactKeys(live, [
    "schema", "chainId", "checkedAt", "blockNumber", "blockHash", "blockTimestamp",
    "owner", "account", "agent", "policyVersion", "nonce", "acquisitionsToday",
    "agentBalanceWei", "maxFeePerGasWei", "accountPaused", "agentAuthorized",
    "featureFlags", "policy", "targets",
  ], "liveState");
  if (live.schema !== "GOGH_REVIEWED_FREE_MINT_LIVE_STATE_V1" || live.chainId !== ROBINHOOD.chainId) {
    fail("INVALID_LIVE_STATE", "live state must use the Robinhood V1 schema");
  }
  const checkedAt = iso(live.checkedAt, "liveState.checkedAt");
  const blockTimestamp = iso(live.blockTimestamp, "liveState.blockTimestamp");
  if (checkedAt > nowSeconds || nowSeconds - checkedAt > queue.limits.maxEvidenceAgeSeconds
    || blockTimestamp > checkedAt || checkedAt - blockTimestamp > queue.limits.maxEvidenceAgeSeconds) {
    fail("STALE_EVIDENCE", "live state or chain block is stale");
  }
  if (nowSeconds >= iso(queue.expiresAt, "queue.expiresAt")) fail("QUEUE_EXPIRED", "reviewed queue expired");
  if (address(live.owner, "liveState.owner") !== queue.punk.expectedOwner
    || address(live.account, "liveState.account") !== queue.punk.account
    || address(live.agent, "liveState.agent") !== queue.agent) {
    fail("IDENTITY_CHANGED", "owner, Punk Account, or agent differs from the reviewed queue");
  }
  integer(live.blockNumber, 1, Number.MAX_SAFE_INTEGER, "liveState.blockNumber");
  blockHash(live.blockHash, "liveState.blockHash");
  const policyVersion = decimal(live.policyVersion, "liveState.policyVersion");
  const nonce = decimal(live.nonce, "liveState.nonce");
  const acquisitionsToday = integer(live.acquisitionsToday, 0, 10, "liveState.acquisitionsToday");
  const agentBalanceWei = decimal(live.agentBalanceWei, "liveState.agentBalanceWei");
  const maxFeePerGasWei = decimal(live.maxFeePerGasWei, "liveState.maxFeePerGasWei");
  bool(live.accountPaused, false, "liveState.accountPaused");
  bool(live.agentAuthorized, true, "liveState.agentAuthorized");

  exactKeys(live.featureFlags, [
    "scoutMode", "approvalPurchases", "autonomousPurchases", "autonomousMints",
    "unknownCollectionExecution", "selling", "autonomousSelling",
  ], "liveState.featureFlags");
  bool(live.featureFlags.scoutMode, true, "liveState.featureFlags.scoutMode");
  bool(live.featureFlags.approvalPurchases, false, "liveState.featureFlags.approvalPurchases");
  bool(live.featureFlags.autonomousPurchases, true, "liveState.featureFlags.autonomousPurchases");
  bool(live.featureFlags.autonomousMints, true, "liveState.featureFlags.autonomousMints");
  bool(live.featureFlags.unknownCollectionExecution, false, "liveState.featureFlags.unknownCollectionExecution");
  bool(live.featureFlags.selling, false, "liveState.featureFlags.selling");
  bool(live.featureFlags.autonomousSelling, false, "liveState.featureFlags.autonomousSelling");

  exactKeys(live.policy, ["mode", "maxAcquisitionsPerDay", "autonomousFreeMints", "autonomousPaidMints"], "liveState.policy");
  if (live.policy.mode !== "AUTONOMOUS") fail("UNSAFE_STATE", "policy mode must be AUTONOMOUS");
  const onchainDailyCap = integer(live.policy.maxAcquisitionsPerDay, 1, 10, "liveState.policy.maxAcquisitionsPerDay");
  if (onchainDailyCap !== queue.limits.maxMintsPerUtcDay) fail("UNSAFE_STATE", "on-chain daily cap differs from queue cap");
  bool(live.policy.autonomousFreeMints, true, "liveState.policy.autonomousFreeMints");
  bool(live.policy.autonomousPaidMints, false, "liveState.policy.autonomousPaidMints");

  if (!Array.isArray(live.targets) || live.targets.length !== queue.targets.length) {
    fail("INVALID_LIVE_STATE", "live target state must cover every reviewed target exactly once");
  }
  const byId = new Map();
  live.targets.forEach((target, index) => {
    const label = `liveState.targets[${index}]`;
    exactKeys(target, [
      "id", "collection", "collectionCodeHash", "venue", "venueCodeHash", "adapter",
      "adapterCodeHash", "adapterVersionHash", "adapterMetadataHash", "selector",
      "adapterActive", "adapterAllowed", "venueAllowed", "collectionAllowed",
      "selectorAllowed", "currencyAllowed", "venueCurrencyMaximumWei", "dropActive", "mintPriceWei",
      "walletRemaining", "supplyRemaining", "nextTokenId", "gasEstimate",
      "simulationSucceeded",
    ], label);
    if (typeof target.id !== "string" || byId.has(target.id)) fail("INVALID_LIVE_STATE", "live target IDs must be unique");
    byId.set(target.id, target);
  });
  const targets = queue.targets.map((target) => {
    const observed = byId.get(target.id);
    if (!observed) fail("INVALID_LIVE_STATE", `missing live target ${target.id}`);
    if (address(observed.collection, `${target.id}.collection`) !== target.collection
      || address(observed.venue, `${target.id}.venue`) !== target.venue
      || address(observed.adapter, `${target.id}.adapter`) !== target.adapter
      || observed.collectionCodeHash !== target.collectionCodeHash
      || observed.venueCodeHash !== target.venueCodeHash
      || observed.adapterCodeHash !== target.adapterCodeHash
      || observed.adapterVersionHash !== target.adapterVersionHash
      || observed.adapterMetadataHash !== target.adapterMetadataHash
      || observed.selector !== target.selector) {
      fail("TARGET_CHANGED", `reviewed code or address changed for ${target.id}`);
    }
    for (const field of ["adapterActive", "adapterAllowed", "venueAllowed", "collectionAllowed", "selectorAllowed", "currencyAllowed", "dropActive", "simulationSucceeded"]) {
      bool(observed[field], true, `${target.id}.${field}`);
    }
    if (observed.mintPriceWei !== "0" || observed.venueCurrencyMaximumWei !== "0") {
      fail("TARGET_CHANGED", `${target.id} is no longer an exact zero-value route`);
    }
    const walletRemaining = decimal(observed.walletRemaining, `${target.id}.walletRemaining`);
    const supplyRemaining = decimal(observed.supplyRemaining, `${target.id}.supplyRemaining`);
    const nextTokenId = decimal(observed.nextTokenId, `${target.id}.nextTokenId`);
    const gasEstimate = decimal(observed.gasEstimate, `${target.id}.gasEstimate`);
    if (walletRemaining === 0n || supplyRemaining === 0n || nextTokenId === 0n
      || gasEstimate === 0n || gasEstimate > BigInt(queue.limits.maxGasPerMint)) {
      fail("TARGET_INELIGIBLE", `${target.id} exceeds a limit or has no mint remaining`);
    }
    return { ...target, nextTokenId, gasEstimate };
  });
  return { checkedAt, policyVersion, nonce, acquisitionsToday, agentBalanceWei, maxFeePerGasWei, targets };
}

export function buildReviewedFreeMintRunPlan(queueInput, liveStateInput, options = {}) {
  const optionSnapshot = snapshot(options, "options");
  exactKeys(optionSnapshot, ["nowSeconds"], "options");
  const nowSeconds = integer(optionSnapshot.nowSeconds, 1, Number.MAX_SAFE_INTEGER, "options.nowSeconds");
  const queue = normalizeQueue(queueInput);
  const live = normalizeLiveState(liveStateInput, queue, nowSeconds);

  const remainingDaily = queue.limits.maxMintsPerUtcDay - live.acquisitionsToday;
  if (remainingDaily <= 0) fail("DAILY_CAP_REACHED", "the Punk reached its reviewed UTC daily cap");
  const minimumReserveWei = BigInt(queue.limits.minAgentReserveWei);
  const availableGasWei = live.agentBalanceWei > minimumReserveWei
    ? live.agentBalanceWei - minimumReserveWei : 0n;
  const gasBudgetWei = availableGasWei < BigInt(queue.limits.maxGasWeiPerRun)
    ? availableGasWei : BigInt(queue.limits.maxGasWeiPerRun);
  if (gasBudgetWei === 0n) fail("INSUFFICIENT_GAS", "agent balance does not preserve the required reserve");

  const maxCount = Math.min(remainingDaily, queue.limits.maxMintsPerRun);
  const selected = [];
  let cumulativeGasWei = 0n;
  for (const target of live.targets) {
    if (selected.length >= maxCount) break;
    const targetGasWei = target.gasEstimate * live.maxFeePerGasWei;
    if (targetGasWei > gasBudgetWei - cumulativeGasWei) continue;
    const targetExpiry = iso(target.expiresAt, `${target.id}.expiresAt`);
    const validUntil = Math.min(nowSeconds + queue.limits.intentTtlSeconds, targetExpiry, iso(queue.expiresAt, "queue.expiresAt"));
    if (validUntil - nowSeconds < 30) continue;
    selected.push({
      sequence: selected.length + 1,
      id: target.id,
      opportunityId: target.opportunityId,
      reasoningHash: target.reasoningHash,
      account: queue.punk.account,
      expectedOwner: queue.punk.expectedOwner,
      agent: queue.agent,
      adapter: target.adapter,
      adapterCodeHash: target.adapterCodeHash,
      selector: target.selector,
      venue: target.venue,
      collection: target.collection,
      assetStandard: "ERC721",
      opportunityType: "FREE_MINT",
      tokenId: target.nextTokenId.toString(),
      assetAmount: "1",
      currency: NATIVE_CURRENCY,
      expectedPrice: "0",
      maxPrice: "0",
      maxSlippageBps: 0,
      policyVersion: live.policyVersion.toString(),
      nonce: (live.nonce + BigInt(selected.length)).toString(),
      validAfter: String(nowSeconds),
      validUntil: String(validUntil),
      adapterData: "0x",
      gasEstimate: target.gasEstimate.toString(),
      maximumGasCostWei: targetGasWei.toString(),
      reviewEvidenceHash: target.reviewEvidenceHash,
    });
    cumulativeGasWei += targetGasWei;
  }
  if (selected.length === 0) fail("NO_EXECUTABLE_TARGETS", "no reviewed target fits the remaining daily and gas limits");

  const plan = {
    schema: REVIEWED_RUN_PLAN_SCHEMA,
    version: 1,
    chainId: ROBINHOOD.chainId,
    generatedAt: new Date(nowSeconds * 1000).toISOString(),
    queueHash: sha256(queue),
    checkedAt: new Date(live.checkedAt * 1000).toISOString(),
    punk: queue.punk,
    agent: queue.agent,
    limits: {
      dailyCap: queue.limits.maxMintsPerUtcDay,
      acquisitionsAlreadyToday: live.acquisitionsToday,
      runCap: queue.limits.maxMintsPerRun,
      selectedCount: selected.length,
      maximumRunGasCostWei: queue.limits.maxGasWeiPerRun,
      plannedMaximumGasCostWei: cumulativeGasWei.toString(),
      minimumAgentReserveWei: queue.limits.minAgentReserveWei,
      stopOnFailure: true,
      containAfterRun: true,
    },
    actions: selected,
    safety: {
      reviewedTargetsOnly: true,
      arbitraryCalldataAccepted: false,
      nativeValuePerMintWei: "0",
      tokenApprovalsAllowed: false,
      unknownCollectionsAllowed: false,
      paidMintsAllowed: false,
      sellingAllowed: false,
      signingPerformed: false,
      submissionPerformed: false,
      chainStateWritten: false,
      executionAuthorizedByThisArtifact: false,
      mandatoryNextGate: "FRESH_DUAL_RPC_RESIMULATION_SIGNED_AGENT_EXECUTION_AND_CONTAINMENT",
    },
  };
  return deepFreeze({ ...plan, planHash: sha256(plan) });
}
