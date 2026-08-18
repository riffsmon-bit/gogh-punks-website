import { normalizeAddress, readFeatureFlags } from "../broker/src/config.mjs";

const failures = [];
const pass = (label) => console.log(`PASS ${label}`);
const fail = (label, message) => failures.push(`${label}: ${message}`);

try {
  if (Number(process.env.CHAIN_ID ?? 4663) !== 4663) throw new Error("CHAIN_ID must be 4663");
  pass("Robinhood chain ID 4663");
} catch (error) {
  fail("chain", error.message);
}

for (const name of ["RPC_URL", "ROBINHOOD_RPC_URL"]) {
  try {
    const url = new URL(process.env[name] ?? "");
    if (url.protocol !== "https:") throw new Error("must use HTTPS");
    pass(`${name} URL shape`);
  } catch (error) {
    fail(name, error.message);
  }
}

try {
  const flags = readFeatureFlags(process.env);
  if (
    flags.ENABLE_AUTONOMOUS_PURCHASES ||
    flags.ENABLE_AUTONOMOUS_MINTS ||
    flags.ENABLE_UNKNOWN_COLLECTION_EXECUTION ||
    flags.ENABLE_AUTONOMOUS_SELLING
  ) {
    throw new Error("autonomous production features must remain false before canary authorization");
  }
  pass("fail-closed broker feature flags");
} catch (error) {
  fail("feature flags", error.message);
}

const deploymentStatus = process.env.BROKER_DEPLOYMENT_STATUS ?? "NOT_DEPLOYED";
if (!new Set(["NOT_DEPLOYED", "STAGED", "DEPLOYED"]).has(deploymentStatus)) {
  fail("BROKER_DEPLOYMENT_STATUS", "invalid status");
} else if (deploymentStatus === "DEPLOYED") {
  for (const name of [
    "PROTOCOL_GUARDIAN",
    "GOGH_ACCOUNT_REGISTRY",
    "GOGH_ACCOUNT_IMPLEMENTATION",
    "BROKER_POLICY_MODULE",
    "ART_AGENT_REGISTRY",
    "ART_ADAPTER_REGISTRY",
  ]) {
    try {
      normalizeAddress(process.env[name], name);
      pass(`${name} address shape`);
    } catch (error) {
      fail(name, error.message);
    }
  }
} else {
  pass(`deployment status ${deploymentStatus}`);
}

for (const [name, fallback] of [
  ["BROKER_INDEXER_ENABLED", "false"],
  ["BROKER_ANALYZER_ENABLED", "false"],
  ["BROKER_BLOCKSCOUT_ABI_ENABLED", "true"],
]) {
  const value = process.env[name] ?? fallback;
  if (value !== "true" && value !== "false") {
    fail(name, "must be exactly true or false");
  } else {
    pass(`${name} explicit boolean`);
  }
}

for (const [name, fallback, minimum, maximum] of [
  ["BROKER_CONFIRMATIONS", "20", 0, 10_000],
  ["BROKER_REORG_WINDOW", "64", 0, 100_000],
  ["BROKER_INDEX_BATCH_SIZE", "1000", 1, 10_000],
  ["BROKER_INDEX_MAX_BLOCKS_PER_RUN", "10000", 1, 1_000_000],
  ["BROKER_ANALYSIS_BATCH_SIZE", "10", 1, 100],
  ["BROKER_ANALYSIS_RETRY_HOURS", "24", 1, 720],
  ["BROKER_ANALYSIS_ACTIVITY_LIMIT", "200", 1, 500],
]) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(name, `must be between ${minimum} and ${maximum}`);
  } else {
    pass(`${name} bounded integer`);
  }
}

if (process.env.PRIVATE_KEY || process.env.SEED_PHRASE || process.env.MNEMONIC) {
  fail("secret policy", "private key or seed material must not be supplied to the application");
} else {
  pass("no application private-key environment variables");
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
}
