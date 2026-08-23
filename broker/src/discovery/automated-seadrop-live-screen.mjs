import { createHash } from "node:crypto";

import { getAddress, isAddress } from "viem";

import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";
import { AUTOMATED_ACCOUNT_EXECUTION_ABI } from
  "../recommendation/automated-seadrop-execution-batch.mjs";
import {
  NATIVE_CURRENCY,
  SEA_DROP,
  SEA_DROP_MINT_PUBLIC_SELECTOR,
} from "../recommendation/automated-seadrop-run-plan.mjs";
import { screenAutomatedSeaDropCandidate } from "./automated-seadrop-screen.mjs";

export const AUTOMATED_LIVE_SCREEN_SCHEMA = "GOGH_AUTOMATED_SEADROP_LIVE_SCREEN_V1";
export const OPEN_SEA_FEE_RECIPIENT = "0x0000a26b00c1f0df003000390027140000faa719";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_HEAD_SKEW = 128n;
const REQUIRED_CLIENT_METHODS = Object.freeze([
  "getBlockNumber", "getBlock", "getCodeEvidence", "readContract", "simulateContract",
  "estimateContractGas",
]);

const PUBLIC_DROP_ABI = Object.freeze([{
  type: "function", name: "getPublicDrop", stateMutability: "view",
  inputs: [{ name: "nftContract", type: "address" }],
  outputs: [{
    name: "drop", type: "tuple", components: [
      { name: "mintPrice", type: "uint80" },
      { name: "startTime", type: "uint48" },
      { name: "endTime", type: "uint48" },
      { name: "maxTotalMintableByWallet", type: "uint16" },
      { name: "feeBps", type: "uint16" },
      { name: "restrictFeeRecipients", type: "bool" },
    ],
  }],
}, {
  type: "function", name: "getFeeRecipientIsAllowed", stateMutability: "view",
  inputs: [
    { name: "nftContract", type: "address" },
    { name: "feeRecipient", type: "address" },
  ],
  outputs: [{ name: "allowed", type: "bool" }],
}]);

const COLLECTION_ABI = Object.freeze([{
  type: "function", name: "getMintStats", stateMutability: "view",
  inputs: [{ name: "minter", type: "address" }],
  outputs: [
    { name: "minterNumMinted", type: "uint256" },
    { name: "currentTotalMinted", type: "uint256" },
    { name: "maxSupply", type: "uint256" },
  ],
}]);

const POLICY_ABI = Object.freeze([{
  type: "function", name: "deniedCollections", stateMutability: "view",
  inputs: [
    { name: "account", type: "address" },
    { name: "collection", type: "address" },
  ],
  outputs: [{ name: "denied", type: "bool" }],
}]);

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

function address(value, label) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    fail("INVALID_ADDRESS", `${label} must be an exact EVM address`);
  }
  const normalized = getAddress(value).toLowerCase();
  if (normalized === ZERO_ADDRESS) fail("INVALID_ADDRESS", `${label} cannot be zero`);
  return normalized;
}

function hash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)
    || /^0x0{64}$/.test(value)) fail("INVALID_HASH", `${label} must be nonzero bytes32`);
  return value;
}

function decimal(value, label, maximumBits = 256) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("INVALID_VALUE", `${label} must be a canonical decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed >= 1n << BigInt(maximumBits)) fail("INVALID_VALUE", `${label} is out of range`);
  return parsed;
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("INVALID_VALUE", `${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function registrableDomain(hostname) {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  const compound = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz"]);
  const tail = labels.slice(-2).join(".");
  return compound.has(tail) && labels.length >= 3 ? labels.slice(-3).join(".") : tail;
}

function endpoint(value, client, label) {
  if (typeof value !== "string") fail("INVALID_PROVIDER", `${label} URL is required`);
  let parsed;
  let transport;
  try {
    parsed = new URL(value);
    transport = new URL(client?.transport?.url);
  } catch {
    fail("INVALID_PROVIDER", `${label} must use a valid client-bound HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.hash || parsed.href !== transport.href) {
    fail("INVALID_PROVIDER", `${label} client transport does not match its configured URL`);
  }
  if (!client || Object.getPrototypeOf(client) !== Object.prototype) {
    fail("INVALID_CLIENT", `${label} client must be a plain read-only facade`);
  }
  const allowedKeys = ["transport", ...REQUIRED_CLIENT_METHODS].sort();
  const rawKeys = Reflect.ownKeys(client);
  if (rawKeys.some((key) => typeof key !== "string")) {
    fail("INVALID_CLIENT", `${label} client cannot expose symbols`);
  }
  const actualKeys = rawKeys.sort();
  if (actualKeys.length !== allowedKeys.length
    || actualKeys.some((key, index) => typeof key !== "string" || key !== allowedKeys[index])) {
    fail("INVALID_CLIENT", `${label} client must expose only the fixed read API`);
  }
  if (!client.transport || Object.getPrototypeOf(client.transport) !== Object.prototype
    || Reflect.ownKeys(client.transport).length !== 1
    || !Object.hasOwn(client.transport, "url")
    || typeof client.transport.url !== "string"
    || !Object.isFrozen(client.transport)) {
    fail("INVALID_CLIENT", `${label} transport must be a frozen inert URL descriptor`);
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== "function") {
      fail("INVALID_CLIENT", `${label} client is missing ${method}`);
    }
  }
  return Object.freeze({
    href: parsed.href,
    origin: parsed.origin,
    domain: registrableDomain(parsed.hostname),
    client,
  });
}

function normalizeScope(input) {
  const scope = snapshot(input, "scope");
  exactKeys(scope, [
    "account", "agent", "expectedOwner", "policyModule", "adapter", "adapterCodeHash",
    "nonce", "policyVersion", "createdAt", "expiresAt",
  ], "scope");
  const createdAt = decimal(scope.createdAt, "scope.createdAt", 64);
  const expiresAt = decimal(scope.expiresAt, "scope.expiresAt", 64);
  if (expiresAt <= createdAt || expiresAt - createdAt > 120n) {
    fail("INVALID_TIME", "scope intent lifetime must be from 1 through 120 seconds");
  }
  return Object.freeze({
    account: address(scope.account, "scope.account"),
    agent: address(scope.agent, "scope.agent"),
    expectedOwner: address(scope.expectedOwner, "scope.expectedOwner"),
    policyModule: address(scope.policyModule, "scope.policyModule"),
    adapter: address(scope.adapter, "scope.adapter"),
    adapterCodeHash: hash(scope.adapterCodeHash, "scope.adapterCodeHash"),
    nonce: decimal(scope.nonce, "scope.nonce").toString(),
    policyVersion: decimal(scope.policyVersion, "scope.policyVersion", 64).toString(),
    createdAt: createdAt.toString(),
    expiresAt: expiresAt.toString(),
  });
}

function normalizeCandidate(input) {
  const candidate = snapshot(input, "candidate");
  exactKeys(candidate, [
    "collection", "opportunityId", "reasoningHash", "contractRiskScore", "tasteMatch",
    "metadataSanitized", "analysisComplete",
  ], "candidate");
  if (candidate.metadataSanitized !== true || candidate.analysisComplete !== true) {
    fail("ANALYSIS_INCOMPLETE", "candidate analysis and sanitized metadata are required");
  }
  return Object.freeze({
    collection: address(candidate.collection, "candidate.collection"),
    opportunityId: hash(candidate.opportunityId, "candidate.opportunityId"),
    reasoningHash: hash(candidate.reasoningHash, "candidate.reasoningHash"),
    contractRiskScore: integer(candidate.contractRiskScore, 0, 100, "candidate.contractRiskScore"),
    tasteMatch: integer(candidate.tasteMatch, 0, 100, "candidate.tasteMatch"),
    metadataSanitized: true,
    analysisComplete: true,
  });
}

function tupleValue(value, name, index, label) {
  const selected = value?.[name] ?? value?.[index];
  if (selected === undefined) fail("INVALID_RPC_RESPONSE", `${label}.${name} is missing`);
  return selected;
}

function codeEvidence(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("INVALID_RPC_RESPONSE", `${label} evidence is malformed`);
  }
  exactKeys(value, ["codeHash", "length"], `${label} evidence`);
  if (!Number.isSafeInteger(value.length) || value.length <= 0
    || typeof value.codeHash !== "string" || !/^0x[0-9a-f]{64}$/.test(value.codeHash)
    || /^0x0{64}$/.test(value.codeHash)) {
    fail("INVALID_RPC_RESPONSE", `${label} evidence is empty or malformed`);
  }
  return value;
}

function strictBool(value, label) {
  if (value !== true && value !== false) fail("INVALID_RPC_RESPONSE", `${label} is not boolean`);
  return value;
}

function iso(timestamp) {
  return new Date(Number(timestamp) * 1_000).toISOString();
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

async function collectObservation(client, candidate, scope, block, checkedAt) {
  const collection = candidate.collection.toLowerCase();
  const [collectionCodeValue, seaDropCodeValue, deniedValue, dropValue, statsValue,
    feeAllowedValue] = await Promise.all([
    client.getCodeEvidence({ address: collection, blockNumber: block.number }),
    client.getCodeEvidence({ address: SEA_DROP, blockNumber: block.number }),
    client.readContract({
      address: scope.policyModule, abi: POLICY_ABI, functionName: "deniedCollections",
      args: [scope.account, collection], blockNumber: block.number,
    }),
    client.readContract({
      address: SEA_DROP, abi: PUBLIC_DROP_ABI, functionName: "getPublicDrop",
      args: [collection], blockNumber: block.number,
    }),
    client.readContract({
      address: collection, abi: COLLECTION_ABI, functionName: "getMintStats",
      args: [scope.account], blockNumber: block.number,
    }),
    client.readContract({
      address: SEA_DROP, abi: PUBLIC_DROP_ABI, functionName: "getFeeRecipientIsAllowed",
      args: [collection, OPEN_SEA_FEE_RECIPIENT], blockNumber: block.number,
    }),
  ]);
  const collectionCode = codeEvidence(collectionCodeValue, "collection code");
  const seaDropCode = codeEvidence(seaDropCodeValue, "SeaDrop code");
  const totalMinted = BigInt(tupleValue(statsValue, "currentTotalMinted", 1, "mintStats"));
  const intent = {
    account: scope.account,
    chainId: 4663n,
    expectedOwner: scope.expectedOwner,
    nonce: BigInt(scope.nonce),
    policyVersion: BigInt(scope.policyVersion),
    opportunityType: 2,
    assetStandard: 0,
    adapter: scope.adapter,
    venue: SEA_DROP,
    collection,
    tokenId: totalMinted + 1n,
    assetAmount: 1n,
    currency: NATIVE_CURRENCY,
    expectedPrice: 0n,
    maxPrice: 0n,
    maxSlippageBps: 0,
    createdAt: BigInt(scope.createdAt),
    expiresAt: BigInt(scope.expiresAt),
    opportunityId: candidate.opportunityId,
    reasoningHash: candidate.reasoningHash,
    adapterCodeHash: scope.adapterCodeHash,
  };
  const simulationRequest = {
    address: scope.account,
    account: scope.agent,
    abi: AUTOMATED_ACCOUNT_EXECUTION_ABI,
    functionName: "executeAutonomousAcquisition",
    args: [intent, "0x"],
    blockNumber: block.number,
  };
  await client.simulateContract(simulationRequest);
  const gasEstimate = await client.estimateContractGas(simulationRequest);
  return {
    chainId: 4663,
    checkedAt,
    blockNumber: block.number.toString(),
    blockHash: block.hash.toLowerCase(),
    blockTimestamp: iso(block.timestamp),
    collection,
    collectionCodeHash: collectionCode.codeHash,
    collectionRuntimeLength: collectionCode.length,
    seaDropCodeHash: seaDropCode.codeHash,
    explicitlyDenied: strictBool(deniedValue, "deniedCollections"),
    drop: {
      mintPriceWei: BigInt(tupleValue(dropValue, "mintPrice", 0, "drop")).toString(),
      startTime: BigInt(tupleValue(dropValue, "startTime", 1, "drop")).toString(),
      endTime: BigInt(tupleValue(dropValue, "endTime", 2, "drop")).toString(),
      maxTotalMintableByWallet:
        BigInt(tupleValue(dropValue, "maxTotalMintableByWallet", 3, "drop")).toString(),
      restrictFeeRecipients: strictBool(
        tupleValue(dropValue, "restrictFeeRecipients", 5, "drop"),
        "drop.restrictFeeRecipients",
      ),
    },
    mintStats: {
      minterNumMinted: BigInt(tupleValue(statsValue, "minterNumMinted", 0, "mintStats"))
        .toString(),
      currentTotalMinted: totalMinted.toString(),
      maxSupply: BigInt(tupleValue(statsValue, "maxSupply", 2, "mintStats")).toString(),
    },
    feeRecipientAllowed: strictBool(feeAllowedValue, "fee recipient evidence"),
    simulation: {
      succeeded: true,
      target: SEA_DROP,
      valueWei: "0",
      selector: SEA_DROP_MINT_PUBLIC_SELECTOR,
      tokenId: (totalMinted + 1n).toString(),
      gasEstimate: BigInt(gasEstimate).toString(),
    },
  };
}

export async function attestAutomatedSeaDropCandidateLive(
  candidateInput,
  scopeInput,
  endpointInput,
  optionsInput,
  clientsInput,
) {
  const candidate = normalizeCandidate(candidateInput);
  const scope = normalizeScope(scopeInput);
  const endpoints = snapshot(endpointInput, "endpoints");
  const options = snapshot(optionsInput, "options");
  exactKeys(endpoints, ["primaryUrl", "secondaryUrl"], "endpoints");
  exactKeys(options, ["confirmations", "maximumEvidenceAgeSeconds"], "options");
  if (!clientsInput || typeof clientsInput !== "object"
    || Array.isArray(clientsInput) || Object.getPrototypeOf(clientsInput) !== Object.prototype
    || Reflect.ownKeys(clientsInput).length !== 2
    || !Object.hasOwn(clientsInput, "primary") || !Object.hasOwn(clientsInput, "secondary")) {
    fail("INVALID_CLIENT", "clients must be an exact plain primary/secondary pair");
  }
  const confirmations = integer(options.confirmations, 12, 256, "options.confirmations");
  const maximumAge = integer(
    options.maximumEvidenceAgeSeconds, 5, 30, "options.maximumEvidenceAgeSeconds",
  );
  const startedAtSeconds = Math.floor(Date.now() / 1_000);
  const primary = endpoint(endpoints.primaryUrl, clientsInput.primary, "primary");
  const secondary = endpoint(endpoints.secondaryUrl, clientsInput.secondary, "secondary");
  if (primary.origin === secondary.origin || primary.domain === secondary.domain
    || primary.client === secondary.client) {
    fail("SAME_PROVIDER", "live screening requires distinct clients and provider domains");
  }

  const [primaryHead, secondaryHead] = await Promise.all([
    primary.client.getBlockNumber(), secondary.client.getBlockNumber(),
  ]);
  const headSkew = primaryHead > secondaryHead
    ? primaryHead - secondaryHead : secondaryHead - primaryHead;
  if (headSkew > MAX_HEAD_SKEW) fail("HEAD_SKEW", "RPC heads differ by more than 128 blocks");
  const lowerHead = primaryHead < secondaryHead ? primaryHead : secondaryHead;
  if (lowerHead < BigInt(confirmations)) fail("INSUFFICIENT_HISTORY", "confirmed block unavailable");
  const pinnedNumber = lowerHead - BigInt(confirmations);
  const [primaryBlock, secondaryBlock] = await Promise.all([
    primary.client.getBlock({ blockNumber: pinnedNumber }),
    secondary.client.getBlock({ blockNumber: pinnedNumber }),
  ]);
  for (const [value, label] of [[primaryBlock, "primary"], [secondaryBlock, "secondary"]]) {
    if (value?.number !== pinnedNumber || typeof value?.hash !== "string"
      || typeof value?.timestamp !== "bigint") {
      fail("INVALID_RPC_RESPONSE", `${label} pinned block is malformed`);
    }
  }
  if (primaryBlock.hash.toLowerCase() !== secondaryBlock.hash.toLowerCase()
    || primaryBlock.timestamp !== secondaryBlock.timestamp) {
    fail("RPC_DISAGREEMENT", "providers disagree on the pinned block");
  }
  if (BigInt(startedAtSeconds) < primaryBlock.timestamp
    || BigInt(startedAtSeconds) - primaryBlock.timestamp > BigInt(maximumAge)) {
    fail("STALE_EVIDENCE", "pinned block timestamp is stale");
  }
  const checkedAt = new Date(startedAtSeconds * 1_000).toISOString();
  const [primaryObservation, secondaryObservation] = await Promise.all([
    collectObservation(primary.client, candidate, scope, primaryBlock, checkedAt),
    collectObservation(secondary.client, candidate, scope, secondaryBlock, checkedAt),
  ]);
  const screen = screenAutomatedSeaDropCandidate(
    candidate, primaryObservation, secondaryObservation,
    {
      nowSeconds: startedAtSeconds,
      maximumEvidenceAgeSeconds: maximumAge,
      primaryOrigin: primary.origin,
      secondaryOrigin: secondary.origin,
    },
  );
  const [primaryClosing, secondaryClosing] = await Promise.all([
    primary.client.getBlock({ blockNumber: pinnedNumber }),
    secondary.client.getBlock({ blockNumber: pinnedNumber }),
  ]);
  if (primaryClosing?.hash?.toLowerCase() !== primaryBlock.hash.toLowerCase()
    || secondaryClosing?.hash?.toLowerCase() !== primaryBlock.hash.toLowerCase()
    || primaryClosing?.timestamp !== primaryBlock.timestamp
    || secondaryClosing?.timestamp !== primaryBlock.timestamp) {
    fail("REORG_DETECTED", "pinned block changed during live screening");
  }
  const finishedAtSeconds = Math.floor(Date.now() / 1_000);
  if (finishedAtSeconds < startedAtSeconds || finishedAtSeconds - startedAtSeconds > maximumAge
    || BigInt(finishedAtSeconds) - primaryBlock.timestamp > BigInt(maximumAge)) {
    fail("STALE_EVIDENCE", "live screening exceeded its closing clock bound");
  }
  const evidence = {
    schema: AUTOMATED_LIVE_SCREEN_SCHEMA,
    version: 1,
    chainId: 4663,
    checkedAt,
    finalCheckedAt: new Date(finishedAtSeconds * 1_000).toISOString(),
    confirmations,
    pinnedBlock: {
      number: pinnedNumber.toString(),
      hash: primaryBlock.hash.toLowerCase(),
      timestamp: iso(primaryBlock.timestamp),
    },
    scope,
    screen,
    providers: {
      primaryOrigin: primary.origin,
      secondaryOrigin: secondary.origin,
      distinctClients: true,
      distinctRegistrableDomains: true,
      exactTransportUrlsBound: true,
      providerIndependenceVerified: false,
    },
    safety: {
      exactFullAccountSimulation: true,
      exactConfirmedBlockAgreement: true,
      closingReorgCheck: true,
      signingPerformed: false,
      submissionPerformed: false,
      chainStateWritten: false,
    },
  };
  return deepFreeze({ ...evidence, evidenceHash: sha256(evidence) });
}
