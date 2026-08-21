import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hashTypedData } from "viem";
import { ROBINHOOD } from "../broker/src/config.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(projectRoot, "deployments/robinhood.json");
const defaultConfigPath = resolve(projectRoot, "ops/canary-approval.json");
const zeroAddress = "0x0000000000000000000000000000000000000000";
const maximumIntentLifetimeMs = 120 * 1_000;
const maximumEvidenceAgeMs = 120 * 1_000;
const emptyAdapterDataHash = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const maximumUint256 = (1n << 256n) - 1n;
const maximumUint64 = (1n << 64n) - 1n;
const requiredContracts = Object.freeze([
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
]);
const typedIntentFields = Object.freeze([
  "account",
  "chainId",
  "expectedOwner",
  "nonce",
  "policyVersion",
  "opportunityType",
  "assetStandard",
  "adapter",
  "venue",
  "collection",
  "tokenId",
  "assetAmount",
  "currency",
  "expectedPrice",
  "maxPrice",
  "maxSlippageBps",
  "createdAt",
  "expiresAt",
  "opportunityId",
  "reasoningHash",
  "adapterCodeHash",
  "adapterDataHash",
  "intentHash",
]);
const addressIntentFields = new Set([
  "account",
  "expectedOwner",
  "adapter",
  "venue",
  "collection",
  "currency",
]);
const hashIntentFields = new Set([
  "opportunityId",
  "reasoningHash",
  "adapterCodeHash",
  "adapterDataHash",
  "intentHash",
]);
const acquisitionIntentTypes = Object.freeze({
  AcquisitionIntent: Object.freeze([
    { name: "account", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "expectedOwner", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "policyVersion", type: "uint64" },
    { name: "opportunityType", type: "uint8" },
    { name: "assetStandard", type: "uint8" },
    { name: "adapter", type: "address" },
    { name: "venue", type: "address" },
    { name: "collection", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "assetAmount", type: "uint256" },
    { name: "currency", type: "address" },
    { name: "expectedPrice", type: "uint256" },
    { name: "maxPrice", type: "uint256" },
    { name: "maxSlippageBps", type: "uint16" },
    { name: "createdAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "opportunityId", type: "bytes32" },
    { name: "reasoningHash", type: "bytes32" },
    { name: "adapterCodeHash", type: "bytes32" },
    { name: "adapterDataHash", type: "bytes32" },
  ]),
});

function address(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function hash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)
    && !/^0x0{64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function uintString(value, { maximum = maximumUint256, positive = false } = {}) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = BigInt(value);
  if (parsed > maximum || (positive && parsed === 0n)) return null;
  return value;
}

function strictIsoTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function safeUintNumber(value, { maximum = Number.MAX_SAFE_INTEGER, positive = false } = {}) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
    && (!positive || value > 0);
}

function exactObject(value, keys, path, failures) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    failures.push(`${path} must be a plain object`);
    return false;
  }
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) failures.push(`${path}.${key} is not allowed`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) failures.push(`${path}.${key} is required`);
  }
  return true;
}

function validateStrictSchema(config, failures) {
  if (!exactObject(config, [
    "schemaVersion", "chainId", "collection", "accountMode", "globalFeatureFlags",
    "mintControls", "punk", "target", "intent", "evidence",
  ], "config", failures)) return;
  exactObject(config.globalFeatureFlags, [
    "ENABLE_SCOUT_MODE", "ENABLE_APPROVAL_PURCHASES", "ENABLE_AUTONOMOUS_PURCHASES",
    "ENABLE_AUTONOMOUS_MINTS", "ENABLE_UNKNOWN_COLLECTION_EXECUTION", "ENABLE_SELLING",
    "ENABLE_AUTONOMOUS_SELLING",
  ], "config.globalFeatureFlags", failures);
  exactObject(config.mintControls, [
    "ownerApprovedMints", "autonomousFreeMints", "autonomousPaidMints",
  ], "config.mintControls", failures);
  if (exactObject(config.punk, [
    "tokenId", "expectedOwner", "expectedAccount", "accountDerivations",
  ], "config.punk", failures) && Array.isArray(config.punk.accountDerivations)) {
    config.punk.accountDerivations.forEach((item, index) => exactObject(
      item,
      ["method", "account", "evidenceHash"],
      `config.punk.accountDerivations[${index}]`,
      failures,
    ));
  }
  exactObject(config.target, [
    "opportunityType", "adapter", "venue", "collection", "selector", "assetStandard",
    "tokenId", "amount", "currency", "expectedPriceWei", "maximumPriceWei", "valueWei",
    "maxSlippageBps",
  ], "config.target", failures);
  exactObject(config.intent, typedIntentFields, "config.intent", failures);
  if (!exactObject(config.evidence, [
    "generatedAt", "confirmations", "pinnedBlock", "rpcPrimary", "rpcSecondary",
    "permissions", "code", "simulation",
  ], "config.evidence", failures)) return;
  exactObject(config.evidence.pinnedBlock, ["number", "hash", "timestamp"],
    "config.evidence.pinnedBlock", failures);
  const rpcFields = [
    "provider", "url", "chainId", "blockNumber", "blockHash", "blockTimestamp",
    "chainHead", "punkTokenId", "currentOwner", "resolvedAccount", "observedAt",
    "evidenceHash",
  ];
  exactObject(config.evidence.rpcPrimary, rpcFields, "config.evidence.rpcPrimary", failures);
  exactObject(config.evidence.rpcSecondary, rpcFields, "config.evidence.rpcSecondary", failures);
  exactObject(config.evidence.permissions, [
    "account", "adapter", "venue", "collection", "selector", "assetStandard", "tokenId",
    "amount", "currency", "adapterAllowed", "venueAllowed", "mintContractAllowed",
    "collectionAllowed", "selectorAllowed", "currencyAllowed", "collectionDenied",
    "selectorDenied", "policyVersion", "maximumValueWei", "permissionSetHash", "counts",
    "observedAtBlock",
  ], "config.evidence.permissions", failures);
  exactObject(config.evidence.permissions?.counts, [
    "adapters", "venues", "mintContracts", "collections", "selectors", "currencies",
  ], "config.evidence.permissions.counts", failures);
  if (exactObject(config.evidence.code, ["account", "adapter", "venue", "collection"],
    "config.evidence.code", failures)) {
    for (const field of ["account", "adapter", "venue", "collection"]) {
      exactObject(config.evidence.code[field], [
        "address", "expectedRuntimeCodeHash", "observedRuntimeCodeHash", "observedAtBlock",
      ], `config.evidence.code.${field}`, failures);
    }
  }
  if (exactObject(config.evidence.simulation, [
    "status", "blockNumber", "blockHash", "simulatedAt", "evidenceHash", "traceHash",
    "from", "executionAccount", "executionSelector", "intent", "nftRecipient",
    "nativePaymentWei", "approvalChanges", "unexpectedCalls",
  ], "config.evidence.simulation", failures)) {
    exactObject(config.evidence.simulation.intent, typedIntentFields,
      "config.evidence.simulation.intent", failures);
  }
}

export function computeAcquisitionIntentHash(intent) {
  return hashTypedData({
    domain: {
      name: "Gogh Punk Account",
      version: "1",
      chainId: ROBINHOOD.chainId,
      verifyingContract: intent.account,
    },
    types: acquisitionIntentTypes,
    primaryType: "AcquisitionIntent",
    message: {
      account: intent.account,
      chainId: BigInt(intent.chainId),
      expectedOwner: intent.expectedOwner,
      nonce: BigInt(intent.nonce),
      policyVersion: BigInt(intent.policyVersion),
      opportunityType: 2,
      assetStandard: intent.assetStandard === "ERC721" ? 0 : 1,
      adapter: intent.adapter,
      venue: intent.venue,
      collection: intent.collection,
      tokenId: BigInt(intent.tokenId),
      assetAmount: BigInt(intent.assetAmount),
      currency: intent.currency,
      expectedPrice: BigInt(intent.expectedPrice),
      maxPrice: BigInt(intent.maxPrice),
      maxSlippageBps: intent.maxSlippageBps,
      createdAt: BigInt(intent.createdAt),
      expiresAt: BigInt(intent.expiresAt),
      opportunityId: intent.opportunityId,
      reasoningHash: intent.reasoningHash,
      adapterCodeHash: intent.adapterCodeHash,
      adapterDataHash: intent.adapterDataHash,
    },
  });
}

function expectedFeatureFlags(flags) {
  return flags?.ENABLE_SCOUT_MODE === true
    && flags?.ENABLE_APPROVAL_PURCHASES === true
    && flags?.ENABLE_AUTONOMOUS_PURCHASES === false
    && flags?.ENABLE_AUTONOMOUS_MINTS === false
    && flags?.ENABLE_UNKNOWN_COLLECTION_EXECUTION === false
    && flags?.ENABLE_SELLING === false
    && flags?.ENABLE_AUTONOMOUS_SELLING === false;
}

export function validateApprovalManifest(manifest) {
  const failures = [];
  if (manifest?.status !== "DEPLOYED") {
    failures.push(
      `authoritative manifest must be DEPLOYED (current ${manifest?.status ?? "missing"})`,
    );
    return failures;
  }
  if (manifest?.chain?.chainId !== ROBINHOOD.chainId) {
    failures.push(`manifest chain ID must be ${ROBINHOOD.chainId}`);
  }
  if (address(manifest?.canonicalCollection) !== ROBINHOOD.canonicalCollection) {
    failures.push("manifest canonical Gogh Punks collection is incorrect");
  }
  if (!/^[0-9a-f]{40}$/i.test(manifest?.gitCommit ?? "")) {
    failures.push("manifest must pin the deployed git commit");
  }
  if (!expectedFeatureFlags(manifest?.featureFlags)) {
    failures.push("manifest feature flags are not the approval-only canary profile");
  }
  const contractAddresses = [];
  for (const name of requiredContracts) {
    const record = manifest?.contracts?.[name];
    const contractAddress = address(record?.address);
    if (!contractAddress || contractAddress === zeroAddress || !hash(record?.runtimeBytecodeHash)) {
      failures.push(`manifest ${name} must pin its address and runtime bytecode hash`);
    } else {
      contractAddresses.push(contractAddress);
    }
    if (record?.verificationStatus !== "VERIFIED") {
      failures.push(`manifest ${name} must be VERIFIED`);
    }
  }
  if (new Set(contractAddresses).size !== requiredContracts.length) {
    failures.push("manifest protocol contract addresses must be nonzero and distinct");
  }
  return failures;
}

function validateRpcEvidence(config, failures, now) {
  const pinned = config?.evidence?.pinnedBlock;
  if (!Number.isSafeInteger(pinned?.number) || pinned.number <= 0 || !hash(pinned?.hash)) {
    failures.push("evidence.pinnedBlock must contain a positive number and nonzero block hash");
    return;
  }
  const pinnedTimestamp = strictIsoTimestamp(pinned.timestamp);
  if (pinnedTimestamp === null || pinnedTimestamp > now
    || now - pinnedTimestamp > maximumEvidenceAgeMs) {
    failures.push("pinned block timestamp must be strict ISO UTC and no more than 120 seconds old");
  }
  const generatedAt = strictIsoTimestamp(config?.evidence?.generatedAt);
  if (generatedAt === null || generatedAt > now || now - generatedAt > maximumEvidenceAgeMs
    || (pinnedTimestamp !== null && generatedAt < pinnedTimestamp)) {
    failures.push("evidence generatedAt must be strict ISO UTC, fresh, and after the pinned block");
  }
  const confirmations = config?.evidence?.confirmations;
  if (!Number.isSafeInteger(confirmations) || confirmations < 8 || confirmations > 128) {
    failures.push("evidence.confirmations must be between 8 and 128");
  }

  const providers = [config?.evidence?.rpcPrimary, config?.evidence?.rpcSecondary];
  const origins = [];
  const names = [];
  for (const [index, provider] of providers.entries()) {
    const label = index === 0 ? "rpcPrimary" : "rpcSecondary";
    try {
      const url = new URL(provider?.url);
      if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
        throw new Error();
      }
      origins.push(url.origin);
    } catch {
      failures.push(`evidence.${label}.url must be a credential-free HTTPS URL`);
    }
    if (typeof provider?.provider !== "string" || provider.provider.trim().length < 2) {
      failures.push(`evidence.${label}.provider is required`);
    } else {
      names.push(provider.provider.trim().toLowerCase());
    }
    if (provider?.chainId !== ROBINHOOD.chainId) {
      failures.push(`evidence.${label}.chainId must be ${ROBINHOOD.chainId}`);
    }
    if (provider?.blockNumber !== pinned.number
      || hash(provider?.blockHash) !== hash(pinned.hash)
      || provider?.blockTimestamp !== pinned.timestamp) {
      failures.push(`evidence.${label} does not agree with the pinned confirmed block`);
    }
    if (!Number.isSafeInteger(provider?.chainHead)
      || provider.chainHead < pinned.number + (confirmations ?? Number.MAX_SAFE_INTEGER)) {
      failures.push(`evidence.${label}.chainHead does not prove the required confirmations`);
    }
    if (!hash(provider?.evidenceHash)) {
      failures.push(`evidence.${label}.evidenceHash must be a nonzero evidence hash`);
    }
    const observedAt = strictIsoTimestamp(provider?.observedAt);
    if (observedAt === null || observedAt > now || now - observedAt > maximumEvidenceAgeMs
      || (pinnedTimestamp !== null && observedAt < pinnedTimestamp)
      || (generatedAt !== null && observedAt > generatedAt)) {
      failures.push(`evidence.${label}.observedAt must be fresh and within the evidence window`);
    }
    if (provider?.punkTokenId !== config?.punk?.tokenId
      || address(provider?.currentOwner) !== address(config?.punk?.expectedOwner)
      || address(provider?.resolvedAccount) !== address(config?.punk?.expectedAccount)) {
      failures.push(
        `evidence.${label} must independently resolve the one Punk's current owner and account`,
      );
    }
  }
  if (origins.length === 2 && origins[0] === origins[1]) {
    failures.push("primary and secondary RPC evidence must use different HTTPS origins");
  }
  if (names.length === 2 && names[0] === names[1]) {
    failures.push("primary and secondary RPC evidence must name independent providers");
  }
}

function validateCodeEvidence(config, failures) {
  const pinnedNumber = config?.evidence?.pinnedBlock?.number;
  const expected = {
    account: config?.punk?.expectedAccount,
    adapter: config?.target?.adapter,
    venue: config?.target?.venue,
    collection: config?.target?.collection,
  };
  for (const [name, expectedAddress] of Object.entries(expected)) {
    const record = config?.evidence?.code?.[name];
    if (address(record?.address) !== address(expectedAddress)) {
      failures.push(`evidence.code.${name}.address must exactly match the canary target`);
    }
    const expectedHash = hash(record?.expectedRuntimeCodeHash);
    const observedHash = hash(record?.observedRuntimeCodeHash);
    if (!expectedHash || expectedHash !== observedHash) {
      failures.push(`evidence.code.${name} runtime code hashes must be nonzero and exact`);
    }
    if (record?.observedAtBlock !== pinnedNumber) {
      failures.push(`evidence.code.${name} must be observed at the pinned block`);
    }
  }
}

function validateExactPermissions(config, failures) {
  const target = config?.target ?? {};
  const permissions = config?.evidence?.permissions ?? {};
  if (address(permissions.account) !== address(config?.punk?.expectedAccount)) {
    failures.push("evidence.permissions.account must be the one expected Punk Account");
  }
  const exactFields = [
    "adapter",
    "venue",
    "collection",
    "selector",
    "assetStandard",
    "tokenId",
    "amount",
    "currency",
  ];
  for (const field of exactFields) {
    const left = typeof permissions[field] === "string" ? permissions[field].toLowerCase() : null;
    const right = typeof target[field] === "string" ? target[field].toLowerCase() : null;
    if (left === null || left !== right) {
      failures.push(`evidence.permissions.${field} must exactly match target.${field}`);
    }
  }
  const requiredTrue = [
    "adapterAllowed",
    "venueAllowed",
    "mintContractAllowed",
    "collectionAllowed",
    "selectorAllowed",
    "currencyAllowed",
  ];
  for (const field of requiredTrue) {
    if (permissions[field] !== true) failures.push(`evidence.permissions.${field} must be true`);
  }
  for (const field of ["collectionDenied", "selectorDenied"]) {
    if (permissions[field] !== false) failures.push(`evidence.permissions.${field} must be false`);
  }
  if (!safeUintNumber(permissions.policyVersion, { positive: true })) {
    failures.push("evidence.permissions.policyVersion must be a positive safe uint64 number");
  }
  if (permissions.policyVersion !== config?.intent?.policyVersion
    || permissions.maximumValueWei !== "0"
    || !hash(permissions.permissionSetHash)) {
    failures.push("permission snapshot must exactly bind policy version, zero value, and set hash");
  }
  for (const field of ["adapters", "venues", "mintContracts", "collections", "selectors", "currencies"]) {
    if (permissions.counts?.[field] !== 1) {
      failures.push(`evidence.permissions.counts.${field} must be exactly 1`);
    }
  }
  if (permissions.observedAtBlock !== config?.evidence?.pinnedBlock?.number) {
    failures.push("permission evidence must be observed at the pinned block");
  }
}

function sameTypedIntent(actual, expected) {
  return typedIntentFields.every((field) => {
    if (addressIntentFields.has(field)) return address(actual?.[field]) === address(expected?.[field]);
    if (hashIntentFields.has(field)) return hash(actual?.[field]) === hash(expected?.[field]);
    return actual?.[field] === expected?.[field];
  });
}

function validateSimulation(config, failures, now) {
  const simulation = config?.evidence?.simulation ?? {};
  if (simulation.status !== "PASS") failures.push("simulation status must be PASS");
  if (simulation.blockNumber !== config?.evidence?.pinnedBlock?.number
    || hash(simulation.blockHash) !== hash(config?.evidence?.pinnedBlock?.hash)) {
    failures.push("simulation must run against the exact pinned block");
  }
  const simulatedAt = strictIsoTimestamp(simulation.simulatedAt);
  if (simulatedAt === null || simulatedAt > now || now - simulatedAt > maximumEvidenceAgeMs) {
    failures.push("simulation evidence must be strict ISO UTC and no more than 120 seconds old");
  }
  const createdAtMs = safeUintNumber(config?.intent?.createdAt)
    ? config.intent.createdAt * 1_000
    : null;
  const generatedAt = strictIsoTimestamp(config?.evidence?.generatedAt);
  if (simulatedAt !== null && (
    createdAtMs === null || simulatedAt < createdAtMs
      || (generatedAt !== null && simulatedAt > generatedAt)
  )) failures.push("simulation must occur after the final intent and before evidence generation");
  if (!hash(simulation.evidenceHash) || !hash(simulation.traceHash)) {
    failures.push("simulation must include nonzero evidence and trace hashes");
  }
  if (address(simulation.from) !== address(config?.punk?.expectedOwner)
    || address(simulation.executionAccount) !== address(config?.punk?.expectedAccount)) {
    failures.push("simulation owner and execution account must match the single Punk target");
  }
  if (!sameTypedIntent(simulation.intent, config?.intent)) {
    failures.push("simulation must bind the exact canonical typed intent");
  }
  if (simulation.executionSelector?.toLowerCase() !== config?.target?.selector?.toLowerCase()) {
    failures.push("simulation execution selector must exactly match the pinned target selector");
  }
  if (address(simulation.nftRecipient) !== address(config?.punk?.expectedAccount)) {
    failures.push("simulation NFT recipient must be the expected Punk Account");
  }
  if (simulation.nativePaymentWei !== "0") failures.push("simulation must move zero payment");
  if (!Array.isArray(simulation.approvalChanges) || simulation.approvalChanges.length !== 0) {
    failures.push("simulation must show no token or operator approval changes");
  }
  if (!Array.isArray(simulation.unexpectedCalls) || simulation.unexpectedCalls.length !== 0) {
    failures.push("simulation must show no unexpected calls");
  }
}

function validateCanonicalIntent(config, failures, now) {
  const intent = config?.intent ?? {};
  const target = config?.target ?? {};
  const punk = config?.punk ?? {};
  if (address(intent.account) !== address(punk.expectedAccount)
    || intent.chainId !== ROBINHOOD.chainId
    || address(intent.expectedOwner) !== address(punk.expectedOwner)) {
    failures.push("typed intent must bind the exact Punk Account, Robinhood chain, and live owner");
  }
  if (intent.opportunityType !== "FREE_MINT"
    || intent.assetStandard !== target.assetStandard
    || address(intent.adapter) !== address(target.adapter)
    || address(intent.venue) !== address(target.venue)
    || address(intent.collection) !== address(target.collection)
    || intent.tokenId !== target.tokenId
    || intent.assetAmount !== target.amount
    || address(intent.currency) !== address(target.currency)) {
    failures.push("typed intent must exactly bind the approved free-mint target and asset");
  }
  if (!uintString(intent.nonce)
    || !safeUintNumber(intent.policyVersion, { positive: true })
    || !uintString(intent.tokenId)
    || intent.assetAmount !== "1"
    || intent.expectedPrice !== "0"
    || intent.maxPrice !== "0"
    || intent.maxSlippageBps !== 0) {
    failures.push("typed intent numeric fields must fit their ABI bounds and preserve zero payment");
  }
  if (!safeUintNumber(intent.createdAt, { maximum: Number(maximumUint64) })
    || !safeUintNumber(intent.expiresAt, { maximum: Number(maximumUint64) })) {
    failures.push("typed intent createdAt/expiresAt must be safe uint64 Unix seconds");
  } else {
    const createdAtMs = intent.createdAt * 1_000;
    const expiresAtMs = intent.expiresAt * 1_000;
    if (createdAtMs > now || expiresAtMs <= now || expiresAtMs <= createdAtMs
      || expiresAtMs - createdAtMs > maximumIntentLifetimeMs) {
      failures.push("typed intent must be current, unexpired, ordered, and at most 120 seconds");
    }
  }
  for (const field of [
    "opportunityId", "reasoningHash", "adapterCodeHash", "adapterDataHash", "intentHash",
  ]) {
    if (!hash(intent[field])) failures.push(`typed intent ${field} must be nonzero bytes32`);
  }
  if (hash(intent.adapterDataHash) !== emptyAdapterDataHash) {
    failures.push("typed intent adapterDataHash must equal keccak256(empty bytes)");
  }
  const adapterCode = config?.evidence?.code?.adapter;
  if (hash(intent.adapterCodeHash) !== hash(adapterCode?.expectedRuntimeCodeHash)
    || hash(intent.adapterCodeHash) !== hash(adapterCode?.observedRuntimeCodeHash)) {
    failures.push("typed intent adapterCodeHash must match expected and observed adapter code");
  }
  try {
    if (hash(intent.intentHash) !== computeAcquisitionIntentHash(intent).toLowerCase()) {
      failures.push("intentHash must equal the canonical Gogh Punk Account EIP-712 digest");
    }
  } catch {
    failures.push("typed intent cannot be encoded as the canonical EIP-712 acquisition intent");
  }
}

export function evaluateApprovalCanary(manifest, config, { now = Date.now() } = {}) {
  const failures = validateApprovalManifest(manifest);
  if (failures.length > 0) return { checklistComplete: false, ready: false, failures };

  validateStrictSchema(config, failures);
  if (config?.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (config?.chainId !== ROBINHOOD.chainId) failures.push(`chainId must be ${ROBINHOOD.chainId}`);
  if (address(config?.collection) !== ROBINHOOD.canonicalCollection) {
    failures.push("collection must be the canonical Gogh Punks contract");
  }
  if (config?.accountMode !== "APPROVAL_REQUIRED") {
    failures.push("accountMode must be APPROVAL_REQUIRED");
  }
  if (!expectedFeatureFlags(config?.globalFeatureFlags)) {
    failures.push("global feature flags must enable approval purchases only");
  }
  const mintControls = config?.mintControls;
  if (mintControls?.ownerApprovedMints !== true
    || mintControls?.autonomousFreeMints !== false
    || mintControls?.autonomousPaidMints !== false) {
    failures.push("mint controls must permit owner-approved mints and disable autonomous mints");
  }

  const punk = config?.punk ?? {};
  if (!uintString(punk.tokenId)) failures.push("exactly one Punk tokenId is required");
  const owner = address(punk.expectedOwner);
  const account = address(punk.expectedAccount);
  if (!owner || owner === zeroAddress) failures.push("Punk expected owner must be a nonzero address");
  if (!account || account === zeroAddress) failures.push("Punk expected account must be nonzero");
  if (owner && account && owner === account) {
    failures.push("expected Punk Account must be independently derived and distinct from the owner");
  }
  const derivations = punk.accountDerivations;
  if (!Array.isArray(derivations) || derivations.length !== 2) {
    failures.push("exactly two independent Punk Account derivations are required");
  } else {
    const methods = new Set();
    for (const [index, derivation] of derivations.entries()) {
      if (typeof derivation?.method !== "string" || derivation.method.trim().length < 3) {
        failures.push(`account derivation ${index + 1} must name its independent method`);
      } else {
        methods.add(derivation.method.trim().toLowerCase());
      }
      if (address(derivation?.account) !== account || !hash(derivation?.evidenceHash)) {
        failures.push(`account derivation ${index + 1} must resolve the expected account with evidence`);
      }
    }
    if (methods.size !== 2) failures.push("Punk Account derivation methods must be independent");
  }

  const target = config?.target ?? {};
  if (target.opportunityType !== "FREE_MINT") failures.push("canary target must be FREE_MINT");
  for (const field of ["adapter", "venue", "collection"]) {
    if (!address(target[field]) || address(target[field]) === zeroAddress) {
      failures.push(`target.${field} must be a nonzero address`);
    }
  }
  if (!/^0x[0-9a-fA-F]{8}$/.test(target.selector ?? "") || /^0x0{8}$/i.test(target.selector)) {
    failures.push("target.selector must be one exact nonzero function selector");
  }
  if (!new Set(["ERC721", "ERC1155"]).has(target.assetStandard)) {
    failures.push("target.assetStandard must be exactly ERC721 or ERC1155");
  }
  if (!uintString(target.tokenId)) failures.push("target.tokenId must be known exactly");
  if (target.amount !== "1") failures.push("target.amount must be exactly 1");
  if (address(target.currency) !== zeroAddress
    || target.expectedPriceWei !== "0"
    || target.maximumPriceWei !== "0"
    || target.valueWei !== "0"
    || target.maxSlippageBps !== 0) {
    failures.push("target must use zero currency/payment/maximum price/value/slippage");
  }

  validateCanonicalIntent(config, failures, now);
  validateRpcEvidence(config, failures, now);
  validateCodeEvidence(config, failures);
  validateExactPermissions(config, failures);
  validateSimulation(config, failures, now);

  return {
    checklistComplete: failures.length === 0,
    ready: false,
    failures,
    summary: failures.length === 0
      ? {
          stage: "APPROVAL_REQUIRED",
          chainId: ROBINHOOD.chainId,
          punkTokenId: punk.tokenId,
          account,
          pinnedBlock: config.evidence.pinnedBlock.number,
          expiresAt: config.intent.expiresAt,
          status: "EVIDENCE_CHECKLIST_ONLY",
          authenticityVerified: false,
          transactionAuthorized: false,
          signingPerformed: false,
          submissionPerformed: false,
        }
      : undefined,
  };
}

function blocked(failures) {
  console.error("APPROVAL CANARY EVIDENCE CHECKLIST: INCOMPLETE");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("No signing, submission, deployment, or transaction authorization occurred.");
  process.exitCode = 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    blocked(["usage: node scripts/canary-approval-preflight.mjs [evidence.json]"]);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    blocked(["authoritative deployment manifest is missing or invalid"]);
    return;
  }
  const manifestFailures = validateApprovalManifest(manifest);
  if (manifestFailures.length > 0) {
    blocked(manifestFailures);
    return;
  }
  const configPath = resolve(args[0] ?? defaultConfigPath);
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    blocked([`approval evidence file is missing or invalid: ${configPath}`]);
    return;
  }
  const result = evaluateApprovalCanary(manifest, config);
  if (!result.checklistComplete) {
    blocked(result.failures);
    return;
  }
  console.log("APPROVAL CANARY EVIDENCE CHECKLIST: COMPLETE");
  console.log(JSON.stringify(result.summary, null, 2));
  console.log(
    "Self-authored evidence authenticity is not verified. No transaction is authorized or produced.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
