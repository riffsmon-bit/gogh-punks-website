import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ROBINHOOD, readFeatureFlags } from "../broker/src/config.mjs";
import { PUNK_PERSONAS } from "../broker/src/personas.mjs";
import { normalizeArtMandate } from "../broker/src/mandate.mjs";
import { buildScoutRecommendation } from "../broker/src/scout/recommendation.mjs";
import { RobinhoodJsonRpcSource } from "../broker/src/indexer/json-rpc-source.mjs";
import { PostgresScoutRepository } from "../netlify/functions/broker/scout-repository.mjs";

const OWNER_OF_SELECTOR = "6352211e";

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

export async function runBrokerScout({
  environment = process.env,
  repository = new PostgresScoutRepository(),
  source = null,
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
  const remoteChainId = Number(BigInt(await rpcSource.call("eth_chainId", [])));
  if (remoteChainId !== ROBINHOOD.chainId) {
    throw new Error(`RPC chain mismatch: expected ${ROBINHOOD.chainId}, received ${remoteChainId}`);
  }
  const head = BigInt(await rpcSource.call("eth_blockNumber", []));
  const safeBlock = head > BigInt(confirmations) ? head - BigInt(confirmations) : 0n;
  const blockTag = `0x${safeBlock.toString(16)}`;
  const owner = decodeOwner(await rpcSource.call("eth_call", [{
    to: ROBINHOOD.canonicalCollection,
    data: ownerCallData(tokenId),
  }, blockTag]));

  const punk = await repository.upsertPunk({
    tokenId: tokenId.toString(),
    owner,
    ownerBlock: safeBlock.toString(),
    personaKey,
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
    accountAddress: punk?.account_address ?? null,
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
