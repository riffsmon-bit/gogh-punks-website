import { pathToFileURL } from "node:url";
import { createPublicClient, http } from "viem";

const CHAIN_ID = 4663;
const CONFIRMATIONS = 12n;
const MAX_HEAD_SKEW = 12n;

function httpsEndpoint(value, name) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new TypeError(`${name} is unavailable`);
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new TypeError(`${name} must be an HTTPS URL without embedded user info`);
  }
  return url;
}

function publicOrigin(url) {
  return url.origin;
}

export async function checkRobinhoodRpcPair(environment = process.env, options = {}) {
  const primaryUrl = httpsEndpoint(
    environment.ROBINHOOD_RPC_URL ?? environment.RPC_URL,
    "ROBINHOOD_RPC_URL",
  );
  const secondaryUrl = httpsEndpoint(
    environment.ROBINHOOD_SECONDARY_RPC_URL,
    "ROBINHOOD_SECONDARY_RPC_URL",
  );
  if (primaryUrl.origin === secondaryUrl.origin
    || primaryUrl.hostname === secondaryUrl.hostname) {
    throw new TypeError("RPC endpoints must use distinct providers");
  }
  const clients = options.clients ?? [primaryUrl, secondaryUrl].map((url) => createPublicClient({
    transport: http(url.href, { retryCount: 1, timeout: 12_000 }),
  }));
  const chainIds = await Promise.all(clients.map((client) => client.getChainId()));
  if (chainIds.some((chainId) => chainId !== CHAIN_ID)) {
    throw new TypeError("Both RPC endpoints must report Robinhood Chain 4663");
  }
  const heads = await Promise.all(clients.map((client) => client.getBlockNumber()));
  const high = heads[0] > heads[1] ? heads[0] : heads[1];
  const low = heads[0] < heads[1] ? heads[0] : heads[1];
  if (high - low > MAX_HEAD_SKEW || low < CONFIRMATIONS) {
    throw new TypeError("RPC heads are too far apart for a reliable read pair");
  }
  const blockNumber = low - CONFIRMATIONS;
  const blocks = await Promise.all(clients.map((client) => client.getBlock({ blockNumber })));
  const hashes = blocks.map((block) => String(block?.hash ?? "").toLowerCase());
  if (!/^0x[0-9a-f]{64}$/.test(hashes[0]) || hashes[0] !== hashes[1]) {
    throw new TypeError("RPC endpoints disagree on the common confirmed block");
  }
  return Object.freeze({
    schema: "GOGH_ROBINHOOD_RPC_PAIR_CHECK_V1",
    checkedAt: new Date(options.now ?? Date.now()).toISOString(),
    chainId: CHAIN_ID,
    readOnly: true,
    providerOrigins: Object.freeze([publicOrigin(primaryUrl), publicOrigin(secondaryUrl)]),
    headSkew: Number(high - low),
    commonConfirmedBlock: blockNumber.toString(),
    commonConfirmedBlockHash: hashes[0],
  });
}

async function main() {
  try {
    const result = await checkRobinhoodRpcPair();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "RPC pair check failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
