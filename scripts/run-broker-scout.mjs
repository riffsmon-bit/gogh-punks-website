import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { decodeFunctionResult, encodeFunctionData } from "viem";
import { ROBINHOOD, normalizeAddress, readFeatureFlags } from "../broker/src/config.mjs";
import { PUNK_PERSONAS } from "../broker/src/personas.mjs";
import { normalizeArtMandate } from "../broker/src/mandate.mjs";
import { buildScoutRecommendation } from "../broker/src/scout/recommendation.mjs";
import { RobinhoodJsonRpcSource } from "../broker/src/indexer/json-rpc-source.mjs";
import { PostgresScoutRepository } from "../netlify/functions/broker/scout-repository.mjs";

const OWNER_OF_SELECTOR = "6352211e";
const ZERO_HASH = `0x${"00".repeat(32)}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const FACADE_ACCOUNT_ABI = Object.freeze([{
  type: "function",
  name: "account",
  stateMutability: "view",
  inputs: [{ name: "tokenId", type: "uint256" }],
  outputs: [{ name: "accountAddress", type: "address" }],
}]);

const ERC6551_ACCOUNT_ABI = Object.freeze([{
  type: "function",
  name: "account",
  stateMutability: "view",
  inputs: [
    { name: "implementation", type: "address" },
    { name: "salt", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "tokenContract", type: "address" },
    { name: "tokenId", type: "uint256" },
  ],
  outputs: [{ name: "accountAddress", type: "address" }],
}]);

function boundedInteger(environment, name, fallback, minimum, maximum) {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function tokenIdFrom(environment) {
  const value = environment.BROKER_SCOUT_TOKEN_ID;
  try {
    const tokenId = BigInt(value);
    if (tokenId < 0n || tokenId >= 10_000n) throw new RangeError();
    return tokenId;
  } catch {
    throw new TypeError("BROKER_SCOUT_TOKEN_ID must be an integer between 0 and 9999");
  }
}

function ownerCallData(tokenId) {
  return `0x${OWNER_OF_SELECTOR}${tokenId.toString(16).padStart(64, "0")}`;
}

function decodeOwner(result) {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new TypeError("ownerOf returned malformed data");
  }
  const owner = `0x${result.slice(-40)}`.toLowerCase();
  if (owner === "0x0000000000000000000000000000000000000000") {
    throw new Error("Scout Punk has no current owner");
  }
  return owner;
}

function deployedAccountBinding(deployment) {
  if (deployment?.status === "NOT_DEPLOYED") return null;
  if (deployment?.status !== "DEPLOYED") {
    throw new TypeError("Robinhood deployment manifest status is invalid");
  }
  if (Number(deployment?.chain?.chainId) !== ROBINHOOD.chainId
    || normalizeAddress(deployment?.canonicalCollection, "manifest collection")
      !== ROBINHOOD.canonicalCollection
    || normalizeAddress(deployment?.canonicalERC6551Registry, "manifest ERC-6551 registry")
      !== ROBINHOOD.canonicalERC6551Registry
    || String(deployment?.accountSalt).toLowerCase() !== ZERO_HASH) {
    throw new TypeError("deployed manifest does not bind the canonical Robinhood Punk identity");
  }
  const facadeRecord = deployment?.contracts?.GoghPunkAccountRegistry;
  const implementationRecord = deployment?.contracts?.GoghPunkAccountV1;
  if (facadeRecord?.implementationVersion !== "1"
    || implementationRecord?.implementationVersion !== "1") {
    throw new TypeError("deployed manifest must bind Punk Account implementation version 1");
  }
  const facade = normalizeAddress(facadeRecord?.address, "manifest Gogh registry");
  const implementation = normalizeAddress(
    implementationRecord?.address,
    "manifest Gogh account implementation",
  );
  let availableFromBlock;
  try {
    const facadeBlock = BigInt(facadeRecord.deploymentBlock);
    const implementationBlock = BigInt(implementationRecord.deploymentBlock);
    if (facadeBlock < 0n || implementationBlock < 0n) throw new RangeError();
    availableFromBlock = facadeBlock > implementationBlock ? facadeBlock : implementationBlock;
  } catch {
    throw new TypeError("deployed Punk Account manifest records require deployment blocks");
  }
  return Object.freeze({
    facade,
    implementation,
    canonicalRegistry: ROBINHOOD.canonicalERC6551Registry,
    salt: ZERO_HASH,
    availableFromBlock,
  });
}

async function headOf(source) {
  return typeof source.blockNumber === "function"
    ? BigInt(await source.blockNumber())
    : BigInt(await source.call("eth_blockNumber", []));
}

async function headerAt(source, blockNumber) {
  const block = typeof source.blockHeader === "function"
    ? await source.blockHeader(blockNumber)
    : await source.call("eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, false]);
  try {
    const number = BigInt(block.number);
    const timestamp = BigInt(block.timestamp);
    if (number !== blockNumber || timestamp < 0n
      || !/^0x[0-9a-fA-F]{64}$/.test(block.hash ?? "")) {
      throw new TypeError();
    }
    return Object.freeze({
      number: number.toString(),
      hash: block.hash.toLowerCase(),
      timestamp: timestamp.toString(),
    });
  } catch {
    throw new TypeError("confirmed Scout block header is malformed");
  }
}

function decodeAccount(result, abi, field) {
  try {
    return normalizeAddress(decodeFunctionResult({
      abi,
      functionName: "account",
      data: result,
    }), field);
  } catch {
    throw new TypeError(`${field} returned malformed data`);
  }
}

function normalizedCode(value) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new TypeError("Punk Account eth_getCode response is malformed");
  }
  return value.toLowerCase();
}

async function observeAccount(source, binding, tokenId, blockTag) {
  const facadeData = encodeFunctionData({
    abi: FACADE_ACCOUNT_ABI,
    functionName: "account",
    args: [tokenId],
  });
  const canonicalData = encodeFunctionData({
    abi: ERC6551_ACCOUNT_ABI,
    functionName: "account",
    args: [
      binding.implementation,
      binding.salt,
      BigInt(ROBINHOOD.chainId),
      ROBINHOOD.canonicalCollection,
      tokenId,
    ],
  });
  const [facadeResult, canonicalResult] = await Promise.all([
    source.call("eth_call", [{ to: binding.facade, data: facadeData }, blockTag]),
    source.call("eth_call", [{ to: binding.canonicalRegistry, data: canonicalData }, blockTag]),
  ]);
  const facadeAccount = decodeAccount(facadeResult, FACADE_ACCOUNT_ABI, "facade account");
  const canonicalAccount = decodeAccount(
    canonicalResult,
    ERC6551_ACCOUNT_ABI,
    "canonical ERC-6551 account",
  );
  if (facadeAccount !== canonicalAccount) {
    throw new Error("Gogh registry and canonical ERC-6551 registry disagree on the Punk Account");
  }
  if (facadeAccount === ZERO_ADDRESS) {
    throw new Error("canonical ERC-6551 registry returned the zero account");
  }
  const code = normalizedCode(await source.call("eth_getCode", [facadeAccount, blockTag]));
  return Object.freeze({ account: facadeAccount, code });
}

async function reconcileDeployedAccount({
  primary,
  secondary,
  binding,
  tokenId,
  safeBlock,
  blockTag,
  owner,
}) {
  if (safeBlock < binding.availableFromBlock) return null;
  const [primaryOwner, secondaryOwner, primaryObservation, secondaryObservation] = await Promise.all([
    primary.call("eth_call", [{
      to: ROBINHOOD.canonicalCollection,
      data: ownerCallData(tokenId),
    }, blockTag]).then(decodeOwner),
    secondary.call("eth_call", [{
      to: ROBINHOOD.canonicalCollection,
      data: ownerCallData(tokenId),
    }, blockTag]).then(decodeOwner),
    observeAccount(primary, binding, tokenId, blockTag),
    observeAccount(secondary, binding, tokenId, blockTag),
  ]);
  if (primaryOwner !== owner || secondaryOwner !== owner) {
    throw new Error("distinct RPC observations disagree on confirmed Punk ownership");
  }
  if (primaryObservation.account !== secondaryObservation.account
    || primaryObservation.code !== secondaryObservation.code) {
    throw new Error("distinct RPC observations disagree on the deterministic Punk Account");
  }
  if (primaryObservation.code === "0x") return null;
  return primaryObservation.account;
}

export async function runBrokerScout({
  environment = process.env,
  repository = new PostgresScoutRepository(),
  source = null,
  secondarySource = null,
  deployment = null,
  clock = () => new Date(),
} = {}) {
  if (environment.BROKER_SCOUT_ENABLED !== "true") {
    throw new Error("BROKER_SCOUT_ENABLED must be exactly true");
  }
  const flags = readFeatureFlags(environment);
  if (!flags.ENABLE_SCOUT_MODE) throw new Error("ENABLE_SCOUT_MODE must remain true");
  if (
    flags.ENABLE_APPROVAL_PURCHASES
    || flags.ENABLE_AUTONOMOUS_PURCHASES
    || flags.ENABLE_AUTONOMOUS_MINTS
    || flags.ENABLE_UNKNOWN_COLLECTION_EXECUTION
    || flags.ENABLE_SELLING
    || flags.ENABLE_AUTONOMOUS_SELLING
  ) throw new Error("Scout worker refuses to run while any execution feature is enabled");

  const tokenId = tokenIdFrom(environment);
  const personaKey = environment.BROKER_SCOUT_PERSONA ?? "PIXEL_MAXI";
  if (!PUNK_PERSONAS[personaKey]) throw new TypeError(`Unknown BROKER_SCOUT_PERSONA ${personaKey}`);
  const confirmations = boundedInteger(environment, "BROKER_CONFIRMATIONS", 20, 0, 10_000);
  const maximumHeadSkew = boundedInteger(
    environment,
    "BROKER_RPC_MAX_HEAD_SKEW",
    8,
    0,
    1_000,
  );
  const maximumBlockAge = boundedInteger(
    environment,
    "BROKER_RPC_MAX_BLOCK_AGE_SECONDS",
    600,
    1,
    86_400,
  );
  const limit = boundedInteger(
    environment,
    "BROKER_SCOUT_MAX_RECOMMENDATIONS_PER_RUN",
    24,
    1,
    100,
  );
  const rpcSource = source ?? new RobinhoodJsonRpcSource({
    rpcUrl: environment.ROBINHOOD_RPC_URL,
    streams: {},
  });
  const manifest = deployment ?? JSON.parse(
    readFileSync(resolve(process.cwd(), "deployments/robinhood.json"), "utf8"),
  );
  const accountBinding = deployedAccountBinding(manifest);
  if (accountBinding && confirmations < 12) {
    throw new RangeError("deployed Punk Account reconciliation requires at least 12 confirmations");
  }
  const independentSource = accountBinding
    ? secondarySource ?? new RobinhoodJsonRpcSource({
      rpcUrl: environment.ROBINHOOD_SECONDARY_RPC_URL,
      streams: {},
    })
    : null;
  if (accountBinding && independentSource === rpcSource) {
    throw new TypeError("Punk Account reconciliation requires a distinct secondary RPC object");
  }
  if (accountBinding && rpcSource.rpcUrl && independentSource.rpcUrl) {
    const primaryOrigin = new URL(rpcSource.rpcUrl).origin;
    const secondaryOrigin = new URL(independentSource.rpcUrl).origin;
    if (primaryOrigin === secondaryOrigin) {
      throw new TypeError("Punk Account reconciliation RPCs must use distinct origins");
    }
  }
  const [remoteChainId, secondaryChainId] = await Promise.all([
    rpcSource.call("eth_chainId", []).then((value) => Number(BigInt(value))),
    independentSource
      ? independentSource.call("eth_chainId", []).then((value) => Number(BigInt(value)))
      : Promise.resolve(ROBINHOOD.chainId),
  ]);
  if (remoteChainId !== ROBINHOOD.chainId) {
    throw new Error(`RPC chain mismatch: expected ${ROBINHOOD.chainId}, received ${remoteChainId}`);
  }
  if (secondaryChainId !== ROBINHOOD.chainId) {
    throw new Error(
      `secondary RPC chain mismatch: expected ${ROBINHOOD.chainId}, received ${secondaryChainId}`,
    );
  }
  const [primaryHead, secondaryHead] = await Promise.all([
    headOf(rpcSource),
    independentSource ? headOf(independentSource) : Promise.resolve(null),
  ]);
  if (secondaryHead !== null) {
    const headSkew = primaryHead > secondaryHead
      ? primaryHead - secondaryHead
      : secondaryHead - primaryHead;
    if (headSkew > BigInt(maximumHeadSkew)) {
      throw new Error(`Punk Account reconciliation RPC head skew exceeds ${maximumHeadSkew}`);
    }
  }
  const head = secondaryHead !== null && secondaryHead < primaryHead ? secondaryHead : primaryHead;
  const safeBlock = head > BigInt(confirmations) ? head - BigInt(confirmations) : 0n;
  const blockTag = `0x${safeBlock.toString(16)}`;
  const owner = decodeOwner(await rpcSource.call("eth_call", [{
    to: ROBINHOOD.canonicalCollection,
    data: ownerCallData(tokenId),
  }, blockTag]));
  let accountAddress = null;
  let accountObservedBlockHash = null;
  if (accountBinding) {
    const [primaryHeader, secondaryHeader] = await Promise.all([
      headerAt(rpcSource, safeBlock),
      headerAt(independentSource, safeBlock),
    ]);
    if (primaryHeader.hash !== secondaryHeader.hash) {
      throw new Error("distinct RPC observations disagree on the confirmed Scout block");
    }
    if (primaryHeader.timestamp !== secondaryHeader.timestamp) {
      throw new Error("distinct RPC observations disagree on the confirmed block timestamp");
    }
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError("Scout clock must return a valid Date");
    }
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1_000));
    const observedSeconds = BigInt(primaryHeader.timestamp);
    if (observedSeconds > nowSeconds + 120n
      || nowSeconds - observedSeconds > BigInt(maximumBlockAge)) {
      throw new Error("confirmed Scout block timestamp is stale or implausibly future-dated");
    }
    accountAddress = await reconcileDeployedAccount({
      primary: rpcSource,
      secondary: independentSource,
      binding: accountBinding,
      tokenId,
      safeBlock,
      blockTag,
      owner,
    });
    const [closingPrimary, closingSecondary] = await Promise.all([
      headerAt(rpcSource, safeBlock),
      headerAt(independentSource, safeBlock),
    ]);
    if (closingPrimary.hash !== primaryHeader.hash || closingSecondary.hash !== primaryHeader.hash) {
      throw new Error("confirmed Scout block changed during Punk Account reconciliation");
    }
    if (accountAddress) accountObservedBlockHash = primaryHeader.hash;
  }

  const punk = await repository.upsertPunk({
    tokenId: tokenId.toString(),
    owner,
    ownerBlock: safeBlock.toString(),
    personaKey,
    accountAddress,
    accountVersion: accountAddress ? "1" : null,
    accountObservedBlock: accountAddress ? safeBlock.toString() : null,
    accountObservedBlockHash,
  });
  const opportunities = await repository.analyzedOpportunities(limit);
  const storedMandate = typeof repository.latestArtMandate === "function"
    ? await repository.latestArtMandate({ tokenId: tokenId.toString(), owner })
    : null;
  const mandate = normalizeArtMandate(storedMandate ?? {
    tokenId: tokenId.toString(),
    mode: "SCOUT",
  });
  let recommendationsSaved = 0;
  for (const opportunity of opportunities) {
    const recommendation = buildScoutRecommendation({
      tokenId: tokenId.toString(),
      personaKey,
      opportunity,
      mandate,
    });
    await repository.saveRecommendation(recommendation);
    recommendationsSaved += 1;
  }
  return Object.freeze({
    chainId: ROBINHOOD.chainId,
    tokenId: tokenId.toString(),
    owner,
    ownerBlock: safeBlock.toString(),
    personaKey,
    mandateVersion: mandate.version || null,
    accountAddress: accountAddress ?? punk?.account_address ?? null,
    opportunitiesReviewed: opportunities.length,
    recommendationsSaved,
    executionEnabled: false,
  });
}

function isMainModule() {
  return process.argv[1]
    && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  runBrokerScout().then((result) => {
    console.log(JSON.stringify({ ok: true, mode: "SCOUT", ...result }));
  }).catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error?.name ?? "Error",
      message: error?.message ?? "Scout refresh failed",
    }));
    process.exitCode = 1;
  });
}
