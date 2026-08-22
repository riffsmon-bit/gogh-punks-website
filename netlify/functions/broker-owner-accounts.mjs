import { createPublicClient, defineChain, http, parseAbi, parseAbiItem } from "viem";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { CURRENT_BROKER_DEPLOYMENT_SURFACE } from
  "./_shared/broker-deployment-surface.mjs";
import { getRpcUrl } from "./_shared/config.mjs";
import { json } from "./_shared/http.mjs";

const RECENT_BLOCKS = 100_000n;
const MAX_REQUESTED_TOKENS = 20;
const PUNK_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const REGISTRY_ABI = parseAbi([
  "function account(uint256 tokenId) view returns (address)",
  "function isAccountCreated(uint256 tokenId) view returns (bool)",
]);
const ACTIVATION_EVENT = parseAbiItem(
  "event GoghPunkAccountActivated(address indexed account,uint256 indexed chainId,address indexed collection,uint256 tokenId,address owner,address implementation,uint256 implementationVersion)",
);

function address(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

export function requestedTokenIds(url) {
  const values = new URL(url).searchParams.get("tokens")?.split(",") ?? [];
  const unique = new Set(["1797"]);
  for (const value of values) {
    if (unique.size >= MAX_REQUESTED_TOKENS + 1) break;
    const token = value.trim();
    if (/^(0|[1-9]\d{0,3})$/.test(token) && BigInt(token) <= 9999n) unique.add(token);
  }
  return unique;
}

function publicClient() {
  const rpcUrl = getRpcUrl();
  const chain = defineChain({
    id: ROBINHOOD.chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export async function findOwnerPunkAccounts({ owner, requested = new Set(),
  surface = CURRENT_BROKER_DEPLOYMENT_SURFACE, client = publicClient() }) {
  const normalizedOwner = address(owner);
  if (!normalizedOwner) throw new Error("INVALID_OWNER");
  if (surface?.deploymentStatus !== "DEPLOYED" || !surface.accountRegistry) {
    return Object.freeze({ blockNumber: null, accounts: [] });
  }
  const blockNumber = await client.getBlockNumber();
  const fromBlock = blockNumber > RECENT_BLOCKS ? blockNumber - RECENT_BLOCKS : 0n;
  const logs = await client.getLogs({
    address: surface.accountRegistry,
    event: ACTIVATION_EVENT,
    fromBlock,
    toBlock: blockNumber,
  });
  const candidates = new Set(requested);
  for (const log of logs) {
    if (Number(log.args?.chainId) === ROBINHOOD.chainId
      && address(log.args?.collection) === ROBINHOOD.canonicalCollection
      && address(log.args?.owner) === normalizedOwner) {
      candidates.add(BigInt(log.args.tokenId).toString());
    }
  }
  const checks = await Promise.allSettled([...candidates].map(async (tokenId) => {
    const id = BigInt(tokenId);
    const [liveOwner, account, created] = await Promise.all([
      client.readContract({ address: ROBINHOOD.canonicalCollection, abi: PUNK_ABI,
        functionName: "ownerOf", args: [id], blockNumber }),
      client.readContract({ address: surface.accountRegistry, abi: REGISTRY_ABI,
        functionName: "account", args: [id], blockNumber }),
      client.readContract({ address: surface.accountRegistry, abi: REGISTRY_ABI,
        functionName: "isAccountCreated", args: [id], blockNumber }),
    ]);
    if (address(liveOwner) !== normalizedOwner || created !== true) return null;
    const code = await client.getCode({ address: account, blockNumber });
    if (typeof code !== "string" || code === "0x") return null;
    return Object.freeze({
      tokenId,
      account: address(account),
      owner: normalizedOwner,
      status: "ACTIVATED_ONCHAIN",
    });
  }));
  const accounts = checks.flatMap((result) => (
    result.status === "fulfilled" && result.value ? [result.value] : []
  )).sort((left, right) => Number(left.tokenId) - Number(right.tokenId));
  return Object.freeze({ blockNumber: blockNumber.toString(), accounts });
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const owner = address(new URL(request.url).searchParams.get("owner"));
  if (!owner) return json({ ok: false, code: "INVALID_OWNER" }, 400);
  try {
    const result = await findOwnerPunkAccounts({
      owner,
      requested: requestedTokenIds(request.url),
    });
    return json({
      ok: true,
      chainId: ROBINHOOD.chainId,
      collection: ROBINHOOD.canonicalCollection,
      owner,
      observedBlock: result.blockNumber,
      evidenceScope: "KNOWN_SCOUT_PLUS_RECENT_100000_BLOCK_ACTIVATIONS_PLUS_REQUESTED_TOKENS",
      activatedPunks: result.accounts,
      autonomyEnabled: false,
    }, 200, { "cache-control": "private, no-store" });
  } catch (error) {
    console.error(JSON.stringify({ event: "BROKER_OWNER_ACCOUNTS_FAILED", type: error?.name }));
    return json({ ok: false, code: "LIVE_ACCOUNT_CHECK_UNAVAILABLE" }, 503,
      { "cache-control": "private, no-store" });
  }
}

export const config = {
  path: "/api/broker/owner-accounts",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 30,
    windowSize: 60,
  },
};
