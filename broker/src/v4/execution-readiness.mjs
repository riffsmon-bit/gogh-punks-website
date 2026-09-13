import { createPublicClient, http } from "viem";
import release from "../../../deployments/robinhood-directed-paid-mint.json" with { type: "json" };
import { resolveRobinhoodRpcPair } from "../infrastructure/robinhood-rpc-endpoints.mjs";
import { verifyPaidHistoryAccess } from "./directed-paid-archive.mjs";
import { ROBINHOOD } from "../config.mjs";

const createReadClient = (url) => createPublicClient({ cacheTime: 0,
  transport: http(url, { timeout: 6_000, retryCount: 0, batch: { batchSize: 20, wait: 5 } }) });
const unavailable = (code) => { throw Object.assign(new Error(code), { code }); };

function safeProviderStatus(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).flatMap((item) => {
    if (!["PRIMARY", "SECONDARY"].includes(item?.provider)) return [];
    return [{ provider: item.provider,
      status: ["READY", "UNAVAILABLE", "CHECKING"].includes(item.status) ? item.status : "UNAVAILABLE",
      stage: ["CHAIN", "ARCHIVE"].includes(item.stage) ? item.stage : "CHAIN",
      ...(Number.isInteger(item.httpStatus) && item.httpStatus >= 100 && item.httpStatus <= 599
        ? { httpStatus: item.httpStatus } : {}),
      ...(Number.isSafeInteger(item.rpcCode) && item.rpcCode >= -32768 && item.rpcCode <= 32767
        ? { rpcCode: item.rpcCode } : {}) }];
  });
}

// This probes the selected paid lane's history prerequisite. It does not check
// a mission's ownership continuity or authorize preparation, signing or sending.
export async function checkV2ExecutionReadiness({ environment = process.env,
  createClient = createReadClient, now = Date.now, release: historyRelease = release } = {}) {
  const base = { scope: "SELECTED_PAID_HISTORY_ACCESS_ONLY", chainId: 4663, tokenId: "93",
    historyLookbackBlocks: 20_000, productionAuthorized: false, continuityVerified: false,
    publicTransactions: 0, databaseWrites: 0 };
  let stage = "CONFIG";
  try {
    // Trusted dependency injection supports offline fixtures; the CLI exposes
    // no release override and always uses the checked-in selected release.
    if (historyRelease?.chainId !== ROBINHOOD.chainId || historyRelease.tokenId !== "93"
      || historyRelease.collection !== ROBINHOOD.canonicalCollection
      || !/^0x[0-9a-f]{64}$/.test(historyRelease.collectionCodeHash ?? "")) {
      unavailable("PAID_HISTORY_UNAVAILABLE");
    }
    const pair = resolveRobinhoodRpcPair({
      ROBINHOOD_RPC_URL: environment.ROBINHOOD_ARCHIVE_RPC_URL ?? environment.ROBINHOOD_RPC_URL
        ?? environment.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
      ROBINHOOD_SECONDARY_RPC_URL: environment.ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL
        ?? environment.ROBINHOOD_SECONDARY_RPC_URL ?? "https://robinhood-rpc.publicnode.com",
    });
    const clients = Object.values(pair).map(createClient);
    if (clients.length !== 2 || clients[0] === clients[1]) unavailable("PAID_HISTORY_UNAVAILABLE");
    stage = "HEAD";
    const heads = await Promise.all(clients.map((client) => client.getBlock()));
    const timestamp = now();
    if (!Number.isFinite(timestamp)) unavailable("PAID_HISTORY_UNAVAILABLE");
    for (const head of heads) {
      if (typeof head?.number !== "bigint" || head.number < 0n
        || typeof head.timestamp !== "bigint" || !/^0x[0-9a-f]{64}$/i.test(head.hash ?? "")) {
        unavailable("PAID_HISTORY_UNAVAILABLE");
      }
      if (Math.abs(timestamp / 1000 - Number(head.timestamp)) >= 45) unavailable("PAID_CHAIN_STALE");
    }
    const head = heads.reduce((a, b) => a.number < b.number ? a : b);
    const anchor = { number: String(head.number), hash: head.hash, timestamp: String(head.timestamp) };
    stage = "ARCHIVE";
    const checked = await verifyPaidHistoryAccess(clients, historyRelease, anchor);
    return Object.freeze({ ...base, status: "READY", code: "PAID_HISTORY_ACCESS_READY",
      verifiedProviders: checked.verifiedProviders, anchor });
  } catch (error) {
    // Never emit Error.message, nested causes, endpoints, environment or client objects.
    const code = stage === "CONFIG" ? "RPC_CONFIGURATION_INVALID"
      : error?.code === "PAID_CHAIN_STALE" ? "PAID_CHAIN_STALE" : "PAID_HISTORY_UNAVAILABLE";
    return Object.freeze({ ...base, status: "UNAVAILABLE", code, verifiedProviders: 0,
      providerStatus: safeProviderStatus(error?.providerStatus) });
  }
}
