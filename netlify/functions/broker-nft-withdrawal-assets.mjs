import { createPublicClient, getAddress, http, parseAbi } from "viem";
import { getDatabase } from "@netlify/database";

import { json } from "./_shared/http.mjs";
import { buildNftWithdrawalGate } from "./broker-nft-withdrawal-status.mjs";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = `0x${"0".repeat(64)}`;
const OWNER_OF_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

function tokenId(value) {
  const normalized = String(value);
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(normalized)) {
    throw new TypeError("Punk token ID is invalid");
  }
  return normalized;
}

function address(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.toLowerCase();
}

function transactionHash(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError("transaction hash is invalid");
  }
  return value.toLowerCase();
}

function topicAddress(value) {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) return null;
  return `0x${value.slice(-40)}`.toLowerCase();
}

function topicUint(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  return BigInt(value).toString();
}

function httpsRpc(environment) {
  const raw = environment.ROBINHOOD_RPC_URL ?? environment.RPC_URL;
  if (typeof raw !== "string" || raw.length > 2_048) {
    throw new TypeError("Robinhood RPC is unavailable");
  }
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new TypeError("Robinhood RPC must use HTTPS");
  }
  return url.href;
}

function publicClient(environment) {
  return createPublicClient({
    transport: http(httpsRpc(environment), {
      batch: { batchSize: 5, wait: 25 }, retryCount: 2, retryDelay: 500, timeout: 10_000,
    }),
  });
}

export function erc721MintFromReceipt(run, receipt) {
  const collection = address(run.collection_address ?? run.collection, "collection");
  const account = address(run.account_address ?? run.account, "Punk account");
  const hash = transactionHash(run.transaction_hash ?? run.transactionHash);
  if (!receipt || receipt.status !== "success"
    || String(receipt.transactionHash).toLowerCase() !== hash
    || !Array.isArray(receipt.logs)) return null;
  const matches = receipt.logs.flatMap((log) => {
    if (String(log?.address ?? "").toLowerCase() !== collection
      || !Array.isArray(log?.topics) || log.topics.length !== 4
      || String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC
      || String(log.topics[1]).toLowerCase() !== ZERO_TOPIC
      || topicAddress(log.topics[2]) !== account) return [];
    const mintedTokenId = topicUint(log.topics[3]);
    return mintedTokenId === null ? [] : [mintedTokenId];
  });
  return matches.length === 1 ? Object.freeze({
    standard: "ERC721",
    collection,
    tokenId: matches[0],
    amount: "1",
    transactionHash: hash,
    acquiredAt: new Date(run.completed_at ?? run.acquiredAt).toISOString(),
    openSeaUrl: `https://opensea.io/item/robinhood/${collection}/${matches[0]}`,
  }) : null;
}

export async function buildWithdrawableNftAssets(
  selectedTokenId,
  { environment = process.env, database, gateBuilder = buildNftWithdrawalGate,
    getReceipt, getOwner } = {},
) {
  const normalizedTokenId = tokenId(selectedTokenId);
  const gate = await gateBuilder(normalizedTokenId);
  if (gate?.capability !== true || !gate.bindings) {
    return Object.freeze({
      status: "UNAVAILABLE", capability: false,
      reason: gate?.reason ?? "NFT_RECOVERY_UNAVAILABLE", checkedAt: new Date().toISOString(),
      punkTokenId: normalizedTokenId, account: null, owner: null, items: Object.freeze([]),
    });
  }
  const account = address(gate.bindings.account, "Punk account");
  const owner = address(gate.bindings.expectedOwner, "Punk owner");
  const pool = database ?? getDatabase().pool;
  const result = await pool.query(
    `SELECT account_address, collection_address, transaction_hash, completed_at
       FROM broker_automation_v3_worker_runs
      WHERE status = 'MINT_CONFIRMED' AND punk_token_id = $1::numeric
        AND account_address = $2
      ORDER BY completed_at DESC
      LIMIT 64`,
    [normalizedTokenId, account],
  );
  const client = getReceipt && getOwner ? null : publicClient(environment);
  const receiptReader = getReceipt ?? ((hash) => client.getTransactionReceipt({ hash }));
  const ownerReader = getOwner ?? ((collection, mintedTokenId) => client.readContract({
    address: getAddress(collection), abi: OWNER_OF_ABI, functionName: "ownerOf",
    args: [BigInt(mintedTokenId)],
  }));
  const candidates = await Promise.all((result.rows ?? []).map(async (run) => {
    try {
      const item = erc721MintFromReceipt(run, await receiptReader(transactionHash(run.transaction_hash)));
      if (!item) return null;
      const currentOwner = address(await ownerReader(item.collection, item.tokenId), "NFT owner");
      return currentOwner === account ? item : null;
    } catch {
      return null;
    }
  }));
  const unique = new Map();
  for (const item of candidates) {
    if (item && !unique.has(`${item.collection}:${item.tokenId}`)) {
      unique.set(`${item.collection}:${item.tokenId}`, item);
    }
  }
  return Object.freeze({
    status: "READY", capability: true, reason: null, checkedAt: new Date().toISOString(),
    punkTokenId: normalizedTokenId, account, owner,
    items: Object.freeze([...unique.values()].slice(0, 64)),
  });
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const selectedTokenId = new URL(request.url).searchParams.get("tokenId");
  try {
    const assets = await buildWithdrawableNftAssets(selectedTokenId);
    return json({ ok: true, assets }, 200, {
      "cache-control": "no-store, max-age=0",
      "netlify-cdn-cache-control": "no-store",
    });
  } catch {
    return json({ ok: false, code: "NFT_ASSET_LIST_UNAVAILABLE" }, 400, {
      "cache-control": "no-store, max-age=0",
      "netlify-cdn-cache-control": "no-store",
    });
  }
}

export const config = {
  path: "/api/broker/nft-withdrawal-assets",
  method: "GET",
  rateLimit: {
    action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
  },
};
