import { createPublicClient, getAddress, http, parseAbi } from "viem";
import { getDatabase } from "@netlify/database";

import { json } from "./_shared/http.mjs";
import { buildNftWithdrawalGate } from "./broker-nft-withdrawal-status.mjs";
import { nftDisplayMetadata, NFT_DISPLAY_METADATA_SELECT } from
  "./_shared/broker-display-metadata.mjs";
import { enrichOpenSeaPortfolio, OpenSeaPortfolioSource } from
  "../../broker/src/metadata/opensea-portfolio.mjs";
import { readOnchainNftDisplay } from "../../broker/src/metadata/onchain-nft-display.mjs";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = `0x${"0".repeat(64)}`;
const OWNER_OF_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const COLLECTION_NAME_ABI = parseAbi(["function name() view returns (string)"]);
const TOKEN_URI_ABI = parseAbi(["function tokenURI(uint256 tokenId) view returns (string)"]);

function displayCollectionName(value) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 160) : null;
}

function collectionSlugName(value) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return null;
  return displayCollectionName(value.split("-").map((part) => (
    `${part.charAt(0).toUpperCase()}${part.slice(1)}`
  )).join(" "));
}

function tokenId(value) {
  const normalized = String(value);
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(normalized)) {
    throw new TypeError("Punk token ID is invalid");
  }
  return normalized;
}

function tokenIds(value) {
  if (typeof value !== "string" || value.length > 640) {
    throw new TypeError("Punk token IDs are invalid");
  }
  const values = value.split(",").map(tokenId);
  if (!values.length || values.length > 128 || new Set(values).size !== values.length) {
    throw new TypeError("Punk token IDs are invalid");
  }
  return values;
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
    provenance: "ART_BROKER",
    ownershipStatus: "LIVE_VERIFIED",
    openSeaUrl: `https://opensea.io/item/robinhood/${collection}/${matches[0]}`,
  }) : null;
}

export async function buildWithdrawableNftAssets(
  selectedTokenId,
  { environment = process.env, database, gateBuilder = buildNftWithdrawalGate,
    getReceipt, getOwner, getCollectionName, getTokenUri,
    enrichItems = enrichOpenSeaPortfolio, readTokenDisplay = readOnchainNftDisplay,
    openSeaSource, exactAsset = null } = {},
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
  const collectionNameReader = getCollectionName ?? (client
    ? ((collection) => client.readContract({
      address: getAddress(collection), abi: COLLECTION_NAME_ABI, functionName: "name",
    }))
    : (async () => null));
  const tokenUriReader = getTokenUri ?? (client
    ? ((collection, mintedTokenId) => client.readContract({
      address: getAddress(collection), abi: TOKEN_URI_ABI, functionName: "tokenURI",
      args: [BigInt(mintedTokenId)],
    }))
    : null);
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
  const identities = candidates.filter(Boolean).map((item) => `${item.collection}:${item.tokenId}`);
  const collectionNames = new Map(await Promise.all(
    [...new Set(candidates.filter(Boolean).map((item) => item.collection))].map(async (collection) => {
      try {
        return [collection, displayCollectionName(await collectionNameReader(collection))];
      } catch {
        return [collection, null];
      }
    }),
  ));
  let metadataByIdentity = new Map();
  if (identities.length) {
    try {
      const collections = candidates.filter(Boolean).map((item) => item.collection);
      const tokenIds = candidates.filter(Boolean).map((item) => item.tokenId);
      const metadata = await pool.query(
        `SELECT nft_metadata.collection_address, nft_metadata.token_id,
                ${NFT_DISPLAY_METADATA_SELECT}
           FROM broker_nft_metadata AS nft_metadata
           JOIN UNNEST($1::text[], $2::numeric[]) AS wanted(collection_address, token_id)
             ON nft_metadata.collection_address = wanted.collection_address
            AND nft_metadata.token_id = wanted.token_id
          WHERE nft_metadata.chain_id = 4663`,
        [collections, tokenIds],
      );
      metadataByIdentity = new Map((metadata.rows ?? []).map((row) => [
        `${String(row.collection_address).toLowerCase()}:${String(row.token_id)}`,
        nftDisplayMetadata(row),
      ]));
    } catch {
      // Display enrichment is advisory. Receipt and live owner checks remain authoritative.
    }
  }
  const unique = new Map();
  for (const item of candidates) {
    if (item && !unique.has(`${item.collection}:${item.tokenId}`)) {
      const display = metadataByIdentity.get(`${item.collection}:${item.tokenId}`) ?? {};
      unique.set(`${item.collection}:${item.tokenId}`, Object.freeze({
        ...item,
        collectionName: collectionNames.get(item.collection)
          ?? collectionSlugName(display.collectionSlug),
        name: display.name ?? null,
        imageUrl: display.imageUrl ?? null,
        collectionSlug: display.collectionSlug ?? null,
        floorPrice: null,
      }));
    }
  }
  let items = [...unique.values()].slice(0, 64);
  // A marketplace account index may lag or omit an otherwise live-owned NFT. Allow the
  // holder to supply one exact ERC-721 identity, then prove ownerOf against the selected
  // Punk Wallet before exposing it to the existing withdrawal preflight. This is a
  // bounded recovery lookup, not a user-controlled transaction path.
  if (exactAsset && items.length < 64) {
    try {
      const collection = address(exactAsset.collection, "exact NFT collection");
      const identifier = BigInt(exactAsset.tokenId).toString();
      if (!/^(?:0|[1-9][0-9]*)$/.test(identifier)) throw new TypeError();
      const identity = `${collection}:${identifier}`;
      const currentOwner = address(await ownerReader(collection, identifier), "NFT owner");
      if (currentOwner === account && !items.some((item) => (
        `${item.collection}:${item.tokenId}` === identity
      ))) {
        let collectionName = null;
        try { collectionName = displayCollectionName(await collectionNameReader(collection)); }
        catch { /* Display metadata is advisory. */ }
        items.push(Object.freeze({
          standard: "ERC721", collection, tokenId: identifier, amount: "1",
          transactionHash: null, acquiredAt: null, provenance: "RECEIVED",
          ownershipStatus: "LIVE_CHECK_REQUIRED",
          openSeaUrl: `https://opensea.io/item/robinhood/${collection}/${identifier}`,
          collectionName, name: null, imageUrl: null, collectionSlug: null, floorPrice: null,
        }));
      }
    } catch {
      // The exact identity is included only when live ownerOf proves the Punk Wallet owns it.
    }
  }
  // The marketplace account index broadens display beyond broker mint history so manually
  // deposited and externally received NFTs can be selected. It remains advisory: every
  // withdrawal performs a fresh standard-specific owner/balance check before simulation.
  if (typeof environment.OPENSEA_API_KEY === "string" && environment.OPENSEA_API_KEY.trim()) {
    try {
      const provider = openSeaSource ?? new OpenSeaPortfolioSource({
        apiKey: environment.OPENSEA_API_KEY,
      });
      const indexed = await provider.accountNfts(account);
      const known = new Set(items.map((item) => `${item.collection}:${item.tokenId}`));
      for (const item of indexed) {
        if (items.length >= 64 || known.has(item.identity)) continue;
        known.add(item.identity);
        items.push(Object.freeze({
          standard: item.standard,
          collection: item.collection,
          tokenId: item.tokenId,
          amount: item.amount,
          transactionHash: null,
          acquiredAt: null,
          provenance: "RECEIVED",
          ownershipStatus: "LIVE_CHECK_REQUIRED",
          openSeaUrl: `https://opensea.io/item/robinhood/${item.collection}/${item.tokenId}`,
          collectionName: collectionSlugName(item.collectionSlug),
          name: item.name,
          imageUrl: item.imageUrl,
          collectionSlug: item.collectionSlug,
          floorPrice: null,
        }));
      }
      items = await enrichItems(items, account, { apiKey: environment.OPENSEA_API_KEY,
        source: provider, indexedItems: indexed });
    } catch {
      // Account inventory is an optional indexed fast path; confirmed broker holdings remain.
    }
  }
  if (tokenUriReader && typeof readTokenDisplay === "function") {
    const hydrated = [];
    for (let offset = 0; offset < items.length; offset += 4) {
      const batch = await Promise.all(items.slice(offset, offset + 4).map(async (item) => {
        if (item.name && item.imageUrl) return item;
        try {
          const display = await readTokenDisplay(await tokenUriReader(item.collection, item.tokenId));
          if (!display) return item;
          return Object.freeze({
            ...item,
            name: item.name ?? display.name ?? null,
            imageUrl: item.imageUrl ?? display.imageUrl ?? null,
          });
        } catch {
          return item;
        }
      }));
      hydrated.push(...batch);
    }
    items = hydrated;
  }
  return Object.freeze({
    status: "READY", capability: true, reason: null, checkedAt: new Date().toISOString(),
    punkTokenId: normalizedTokenId, account, owner,
    items: Object.freeze(items),
  });
}

export async function buildWithdrawableNftPortfolio(
  selectedTokenIds,
  { database, buildAssets = buildWithdrawableNftAssets } = {},
) {
  const normalizedTokenIds = Array.isArray(selectedTokenIds)
    ? selectedTokenIds.map(tokenId) : tokenIds(selectedTokenIds);
  if (!normalizedTokenIds.length || normalizedTokenIds.length > 128
    || new Set(normalizedTokenIds).size !== normalizedTokenIds.length) {
    throw new TypeError("Punk token IDs are invalid");
  }
  const pool = database ?? getDatabase().pool;
  const result = await pool.query(
    `SELECT punk_token_id::text AS punk_token_id
       FROM broker_automation_v3_worker_runs
      WHERE status = 'MINT_CONFIRMED'
        AND punk_token_id = ANY($1::numeric[])
      GROUP BY punk_token_id
      ORDER BY punk_token_id::numeric
      LIMIT 128`,
    [normalizedTokenIds],
  );
  const matched = (result.rows ?? []).map((row) => tokenId(row.punk_token_id));
  const groups = [];
  for (let offset = 0; offset < matched.length; offset += 4) {
    const batch = await Promise.all(matched.slice(offset, offset + 4).map(async (id) => {
      try {
        const assets = await buildAssets(id, { database: pool });
        return assets?.capability === true ? assets : null;
      } catch {
        return null;
      }
    }));
    groups.push(...batch.filter(Boolean));
  }
  return Object.freeze({
    status: "READY", capability: true, reason: null, checkedAt: new Date().toISOString(),
    punkTokenIds: Object.freeze(normalizedTokenIds),
    groups: Object.freeze(groups),
  });
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const params = new URL(request.url).searchParams;
  const selectedTokenId = params.get("tokenId");
  const selectedTokenIds = params.get("tokenIds");
  const exactCollection = params.get("collection");
  const exactTokenId = params.get("assetTokenId");
  try {
    if ((selectedTokenId === null) === (selectedTokenIds === null)) {
      throw new TypeError("Choose exactly one NFT asset query");
    }
    if ((exactCollection === null) !== (exactTokenId === null) || (selectedTokenIds !== null
      && exactCollection !== null)) throw new TypeError("Exact NFT lookup is invalid");
    const exactAsset = exactCollection === null ? null : Object.freeze({
      collection: address(exactCollection, "exact NFT collection"),
      tokenId: BigInt(exactTokenId).toString(),
    });
    const body = selectedTokenIds === null
      ? { ok: true, assets: await buildWithdrawableNftAssets(selectedTokenId, { exactAsset }) }
      : { ok: true, portfolio: await buildWithdrawableNftPortfolio(tokenIds(selectedTokenIds)) };
    return json(body, 200, {
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
