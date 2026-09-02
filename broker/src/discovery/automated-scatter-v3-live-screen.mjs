import { getAddress, keccak256, parseAbi } from "viem";

import {
  buildAutomatedScatterV3Execution,
  configuredScatterTargets,
  SCATTER_ARCHETYPE_IMPLEMENTATION,
  SCATTER_ARCHETYPE_IMPLEMENTATION_CODE_HASH,
} from "../recommendation/automated-scatter-v3-execution.mjs";
import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";

const MAX_HEAD_SKEW = 128n;
const ADAPTER_ABI = parseAbi([
  "function collection() view returns (address)",
  "function publicInviteKey() view returns (bytes32)",
  "function expectedImplementationCodeHash() view returns (bytes32)",
  "function expectedCollectionRuntimeCodeHash() view returns (bytes32)",
]);
const COLLECTION_ABI = parseAbi([
  "function archetypeAddresses() view returns ((address platform,address payouts,address batch))",
  "function config() view returns (string baseUri,address affiliateSigner,uint32 maxSupply,uint32 maxBatchSize,uint16 affiliateFee,uint16 affiliateDiscount,uint16 defaultRoyalty)",
  "function invites(bytes32 key) view returns (uint128 price,uint128 reservePrice,uint128 delta,uint32 start,uint32 end,uint32 limit,uint32 maxSupply,uint32 interval,uint32 unitSize,address tokenAddress,bool isBlacklist)",
  "function listSupply(bytes32 key) view returns (uint256)",
  "function minted(address minter,bytes32 key) view returns (uint256)",
  "function packedBonusDiscounts(bytes32 key) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

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
    fail("INVALID_SCATTER_SCREEN", `${label} must be immutable plain JSON`);
  }
}

function value(tuple, name, index) {
  const selected = tuple?.[name] ?? tuple?.[index];
  if (selected === undefined) fail("INVALID_RPC_RESPONSE", `missing Scatter ${name}`);
  return selected;
}

function normalizeTarget(target) {
  const clean = snapshot(target, "target");
  return configuredScatterTargets({
    BROKER_AUTOMATION_V3_SCATTER_TARGETS_JSON: JSON.stringify([clean]),
  })[0];
}

function normalizeOptions(options) {
  const clean = snapshot(options, "options");
  if (!clean || typeof clean !== "object" || Array.isArray(clean)
    || Object.keys(clean).sort().join(",") !== "confirmations,maximumEvidenceAgeSeconds") {
    fail("INVALID_SCATTER_SCREEN", "Scatter live-screen options are malformed");
  }
  const { confirmations, maximumEvidenceAgeSeconds } = clean;
  if (!Number.isSafeInteger(confirmations) || confirmations < 12 || confirmations > 256
    || !Number.isSafeInteger(maximumEvidenceAgeSeconds)
    || maximumEvidenceAgeSeconds < 5 || maximumEvidenceAgeSeconds > 30) {
    fail("INVALID_SCATTER_SCREEN", "Scatter live-screen bounds are invalid");
  }
  return { confirmations, maximumEvidenceAgeSeconds };
}

function normalizeEndpoint(url, client, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail("INVALID_PROVIDER", `${label} Scatter provider URL is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.hash || parsed.username || parsed.password) {
    fail("INVALID_PROVIDER", `${label} Scatter provider must use credential-free HTTPS`);
  }
  const methods = [
    "getBlockNumber", "getBlock", "getCode", "readContract", "call", "estimateGas",
  ];
  const expectedKeys = ["transport", ...methods].sort();
  if (!client || Object.getPrototypeOf(client) !== Object.prototype
    || Reflect.ownKeys(client).some((key) => typeof key !== "string")
    || Reflect.ownKeys(client).sort().some((key, index) => key !== expectedKeys[index])
    || Reflect.ownKeys(client).length !== expectedKeys.length
    || !client.transport || Object.getPrototypeOf(client.transport) !== Object.prototype
    || Reflect.ownKeys(client.transport).length !== 1
    || client.transport.url !== parsed.href || !Object.isFrozen(client.transport)) {
    fail("INVALID_PROVIDER", `${label} Scatter client is not bound to its exact URL`);
  }
  for (const method of methods) {
    if (typeof client?.[method] !== "function") {
      fail("INVALID_PROVIDER", `${label} Scatter client is missing ${method}`);
    }
  }
  return { parsed, client };
}

function registrableDomain(hostname) {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  const compound = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz"]);
  const tail = labels.slice(-2).join(".");
  return compound.has(tail) && labels.length >= 3 ? labels.slice(-3).join(".") : tail;
}

function scopeValue(scope, name, pattern) {
  const selected = scope?.[name];
  if (typeof selected !== "string" || !pattern.test(selected)) {
    fail("INVALID_SCATTER_SCREEN", `scope.${name} is invalid`);
  }
  return selected;
}

function normalizeScope(scope) {
  const clean = snapshot(scope, "scope");
  if (!clean || typeof clean !== "object" || Array.isArray(clean)
    || Object.keys(clean).sort().join(",")
      !== "account,agent,createdAt,expectedOwner,expiresAt,nonce,opportunityId,policyVersion,reasoningHash") {
    fail("INVALID_SCATTER_SCREEN", "Scatter live-screen scope is malformed");
  }
  const addressPattern = /^0x[0-9a-fA-F]{40}$/;
  const decimalPattern = /^(0|[1-9][0-9]*)$/;
  const hashPattern = /^0x[0-9a-f]{64}$/;
  const normalized = {
    account: getAddress(scopeValue(clean, "account", addressPattern)).toLowerCase(),
    agent: getAddress(scopeValue(clean, "agent", addressPattern)).toLowerCase(),
    expectedOwner: getAddress(scopeValue(clean, "expectedOwner", addressPattern)).toLowerCase(),
    nonce: scopeValue(clean, "nonce", decimalPattern),
    policyVersion: scopeValue(clean, "policyVersion", decimalPattern),
    createdAt: scopeValue(clean, "createdAt", decimalPattern),
    expiresAt: scopeValue(clean, "expiresAt", decimalPattern),
    opportunityId: scopeValue(clean, "opportunityId", hashPattern),
    reasoningHash: scopeValue(clean, "reasoningHash", hashPattern),
  };
  if (BigInt(normalized.expiresAt) <= BigInt(normalized.createdAt)
    || BigInt(normalized.expiresAt) - BigInt(normalized.createdAt) > 120n) {
    fail("INVALID_SCATTER_SCREEN", "Scatter intent lifetime is invalid");
  }
  return normalized;
}

async function codeEvidence(client, address, blockNumber, label) {
  const code = (await client.getCode({ address, blockNumber })) ?? "0x";
  if (code === "0x") fail("TARGET_STATE_READ_FAILED", `${label} runtime is missing`);
  return { codeHash: keccak256(code), length: (code.length - 2) / 2 };
}

async function observe(client, target, scope, block) {
  const readAdapter = (functionName) => client.readContract({
    address: target.adapter, abi: ADAPTER_ABI, functionName, blockNumber: block.number,
  });
  const readCollection = (functionName, args = []) => client.readContract({
    address: target.collection, abi: COLLECTION_ABI, functionName, args,
    blockNumber: block.number,
  });
  let state;
  try {
    state = await Promise.all([
      codeEvidence(client, target.adapter, block.number, "Scatter adapter"),
      codeEvidence(client, target.collection, block.number, "Scatter collection"),
      codeEvidence(
        client, SCATTER_ARCHETYPE_IMPLEMENTATION, block.number, "Scatter implementation",
      ),
      readAdapter("collection"),
      readAdapter("publicInviteKey"),
      readAdapter("expectedImplementationCodeHash"),
      readAdapter("expectedCollectionRuntimeCodeHash"),
      readCollection("archetypeAddresses"),
      readCollection("config"),
      readCollection("invites", [target.publicInviteKey]),
      readCollection("listSupply", [target.publicInviteKey]),
      readCollection("minted", [scope.account, target.publicInviteKey]),
      readCollection("packedBonusDiscounts", [target.publicInviteKey]),
      readCollection("totalSupply"),
    ]);
  } catch (error) {
    if (error?.code === "TARGET_STATE_READ_FAILED") throw error;
    fail("TARGET_STATE_READ_FAILED", "Scatter target state could not be read");
  }
  const [adapterCode, collectionCode, implementationCode, boundCollection, boundKey,
    expectedImplementationHash, expectedCollectionHash, addresses, config, invite,
    listSupply, accountMints, packedBonus, totalSupply] = state;
  const price = BigInt(value(invite, "price", 0));
  const reservePrice = BigInt(value(invite, "reservePrice", 1));
  const delta = BigInt(value(invite, "delta", 2));
  const start = BigInt(value(invite, "start", 3));
  const end = BigInt(value(invite, "end", 4));
  const walletLimit = BigInt(value(invite, "limit", 5));
  const listMaximum = BigInt(value(invite, "maxSupply", 6));
  const interval = BigInt(value(invite, "interval", 7));
  const unitSize = BigInt(value(invite, "unitSize", 8));
  const tokenAddress = getAddress(value(invite, "tokenAddress", 9)).toLowerCase();
  const isBlacklist = value(invite, "isBlacklist", 10);
  const collectionMaximum = BigInt(value(config, "maxSupply", 2));
  const maxBatchSize = BigInt(value(config, "maxBatchSize", 3));
  const normalizedTotal = BigInt(totalSupply);
  const normalizedListSupply = BigInt(listSupply);
  const normalizedAccountMints = BigInt(accountMints);
  const expectedCollectionCodeHash = String(expectedCollectionHash).toLowerCase();
  if (adapterCode.codeHash !== target.adapterCodeHash
    || collectionCode.length !== 45
    || collectionCode.codeHash !== expectedCollectionCodeHash
    || implementationCode.codeHash !== SCATTER_ARCHETYPE_IMPLEMENTATION_CODE_HASH
    || String(expectedImplementationHash).toLowerCase()
      !== SCATTER_ARCHETYPE_IMPLEMENTATION_CODE_HASH
    || getAddress(boundCollection).toLowerCase() !== target.collection
    || String(boundKey).toLowerCase() !== target.publicInviteKey) {
    fail("SCATTER_PIN_MISMATCH", "Scatter adapter or runtime pin changed");
  }
  if (price !== 0n || reservePrice !== 0n || delta !== 0n || interval !== 0n
    || walletLimit === 0n || unitSize !== 1n
    || tokenAddress !== "0x0000000000000000000000000000000000000000"
    || isBlacklist !== false || BigInt(packedBonus) !== 0n || maxBatchSize === 0n) {
    fail("SCATTER_LIST_INELIGIBLE", "Scatter list is not a plain public free mint");
  }
  if (block.timestamp < start || (end > start && block.timestamp > end)
    || normalizedAccountMints >= walletLimit
    || normalizedListSupply >= listMaximum
    || normalizedTotal >= collectionMaximum
    || getAddress(value(addresses, "batch", 2)).toLowerCase() === scope.account) {
    fail("SCATTER_LIST_EXHAUSTED", "Scatter list has no live slot for this Punk");
  }
  const tokenId = normalizedTotal + 1n;
  const transaction = buildAutomatedScatterV3Execution({
    target,
    ...scope,
    tokenId: tokenId.toString(),
  });
  try {
    await client.call({
      account: scope.agent,
      to: scope.account,
      data: transaction.data,
      value: 0n,
      blockNumber: block.number,
    });
  } catch {
    fail("FULL_ACCOUNT_SIMULATION_FAILED", "Scatter Punk Account simulation reverted");
  }
  let gasEstimate;
  try {
    gasEstimate = await client.estimateGas({
      account: scope.agent,
      to: scope.account,
      data: transaction.data,
      value: 0n,
      blockNumber: block.number,
    });
  } catch {
    fail("GAS_ESTIMATE_FAILED", "Scatter Punk Account gas estimation failed");
  }
  return {
    adapterCodeHash: adapterCode.codeHash,
    collectionCodeHash: collectionCode.codeHash,
    expectedCollectionCodeHash,
    implementationCodeHash: implementationCode.codeHash,
    publicInviteKey: target.publicInviteKey,
    price: price.toString(),
    walletLimit: walletLimit.toString(),
    listMaximum: listMaximum.toString(),
    listSupply: normalizedListSupply.toString(),
    accountMints: normalizedAccountMints.toString(),
    collectionMaximum: collectionMaximum.toString(),
    totalSupply: normalizedTotal.toString(),
    tokenId: tokenId.toString(),
    gasEstimate: BigInt(gasEstimate).toString(),
    transactionDataKeccak256: transaction.dataKeccak256,
  };
}

function equalObservation(left, right) {
  const withoutGas = ({ gasEstimate: _gas, ...value }) => value;
  return JSON.stringify(withoutGas(left)) === JSON.stringify(withoutGas(right));
}

export async function attestAutomatedScatterV3CandidateLive(
  targetInput, scopeInput, endpointInput, optionsInput, clientsInput,
) {
  const target = normalizeTarget(targetInput);
  const scope = normalizeScope(scopeInput);
  const options = normalizeOptions(optionsInput);
  const endpoints = snapshot(endpointInput, "endpoints");
  if (!endpoints || Object.keys(endpoints).sort().join(",") !== "primaryUrl,secondaryUrl") {
    fail("INVALID_PROVIDER", "Scatter endpoints are malformed");
  }
  if (!clientsInput || Object.getPrototypeOf(clientsInput) !== Object.prototype
    || Reflect.ownKeys(clientsInput).some((key) => typeof key !== "string")
    || Reflect.ownKeys(clientsInput).sort().join(",") !== "primary,secondary") {
    fail("INVALID_PROVIDER", "Scatter clients must be an exact pair");
  }
  const primary = normalizeEndpoint(endpoints.primaryUrl, clientsInput.primary, "primary");
  const secondary = normalizeEndpoint(
    endpoints.secondaryUrl, clientsInput.secondary, "secondary",
  );
  if (primary.parsed.hostname === secondary.parsed.hostname
    || registrableDomain(primary.parsed.hostname) === registrableDomain(secondary.parsed.hostname)
    || primary.client === secondary.client) {
    fail("SAME_PROVIDER", "Scatter live screen requires distinct providers");
  }
  const startedAt = Math.floor(Date.now() / 1_000);
  const [primaryHead, secondaryHead] = await Promise.all([
    primary.client.getBlockNumber(), secondary.client.getBlockNumber(),
  ]);
  const skew = primaryHead > secondaryHead
    ? primaryHead - secondaryHead : secondaryHead - primaryHead;
  if (skew > MAX_HEAD_SKEW) fail("HEAD_SKEW", "Scatter provider heads disagree");
  const lowerHead = primaryHead < secondaryHead ? primaryHead : secondaryHead;
  if (lowerHead < BigInt(options.confirmations)) {
    fail("INSUFFICIENT_HISTORY", "Scatter confirmed block is unavailable");
  }
  const pinnedNumber = lowerHead - BigInt(options.confirmations);
  const [primaryBlock, secondaryBlock] = await Promise.all([
    primary.client.getBlock({ blockNumber: pinnedNumber }),
    secondary.client.getBlock({ blockNumber: pinnedNumber }),
  ]);
  if (primaryBlock?.number !== pinnedNumber || secondaryBlock?.number !== pinnedNumber
    || primaryBlock?.hash?.toLowerCase() !== secondaryBlock?.hash?.toLowerCase()
    || primaryBlock?.timestamp !== secondaryBlock?.timestamp) {
    fail("RPC_DISAGREEMENT", "Scatter providers disagree on the pinned block");
  }
  if (BigInt(startedAt) < primaryBlock.timestamp
    || BigInt(startedAt) - primaryBlock.timestamp
      > BigInt(options.maximumEvidenceAgeSeconds)) {
    fail("STALE_EVIDENCE", "Scatter pinned block is stale");
  }
  const [primaryObservation, secondaryObservation] = await Promise.all([
    observe(primary.client, target, scope, primaryBlock),
    observe(secondary.client, target, scope, secondaryBlock),
  ]);
  if (!equalObservation(primaryObservation, secondaryObservation)) {
    fail("RPC_DISAGREEMENT", "Scatter providers disagree on target state or simulation");
  }
  const [primaryClosing, secondaryClosing] = await Promise.all([
    primary.client.getBlock({ blockNumber: pinnedNumber }),
    secondary.client.getBlock({ blockNumber: pinnedNumber }),
  ]);
  if (primaryClosing?.hash?.toLowerCase() !== primaryBlock.hash.toLowerCase()
    || secondaryClosing?.hash?.toLowerCase() !== primaryBlock.hash.toLowerCase()) {
    fail("REORG_DETECTED", "Scatter pinned block changed during screening");
  }
  const finishedAt = Math.floor(Date.now() / 1_000);
  if (finishedAt - startedAt > options.maximumEvidenceAgeSeconds
    || BigInt(finishedAt) - primaryBlock.timestamp
      > BigInt(options.maximumEvidenceAgeSeconds)) {
    fail("STALE_EVIDENCE", "Scatter live screen exceeded its clock bound");
  }
  return Object.freeze({
    schema: "GOGH_AUTOMATED_SCATTER_V3_LIVE_SCREEN_V1",
    version: 1,
    chainId: 4663,
    checkedAt: new Date(startedAt * 1_000).toISOString(),
    finalCheckedAt: new Date(finishedAt * 1_000).toISOString(),
    confirmations: options.confirmations,
    pinnedBlock: Object.freeze({
      number: pinnedNumber.toString(),
      hash: primaryBlock.hash.toLowerCase(),
      timestamp: new Date(Number(primaryBlock.timestamp) * 1_000).toISOString(),
    }),
    target,
    scope: Object.freeze(scope),
    tokenId: primaryObservation.tokenId,
    gasEstimate: (
      BigInt(primaryObservation.gasEstimate) > BigInt(secondaryObservation.gasEstimate)
        ? primaryObservation.gasEstimate : secondaryObservation.gasEstimate
    ),
    transactionDataKeccak256: primaryObservation.transactionDataKeccak256,
    safety: Object.freeze({
      exactTargetBoundAdapter: true,
      exactReviewedClone: true,
      publicFreeListOnly: true,
      fullAccountSimulationOnBothProviders: true,
      closingReorgCheck: true,
      apiCalldataTrustedForExecution: false,
    }),
  });
}
