import { getDatabase } from "@netlify/database";
import { createPublicClient, defineChain, http, parseAbi } from "viem";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import automationManifest from "../../deployments/robinhood-automation-v3.json" with { type: "json" };
import { json } from "./_shared/http.mjs";
import { nftDisplayMetadata, NFT_DISPLAY_METADATA_SELECT } from
  "./_shared/broker-display-metadata.mjs";

const MAX_CANDIDATES = 200;
const OPENSEA_COLLECTION_SLUG = "gogh-punks-255843210";
const OPENSEA_RESPONSE_BYTES = 1_000_000;
const OPENSEA_PAGE_LIMIT = 200;
const OPENSEA_MAX_PAGES = 3;
const AUTOMATION_ROSTER_LIMIT = 32;
const GOGH_PUNKS_MAX_SUPPLY = 5_016;
const OPENSEA_IMAGE_HOSTS = new Set(["i.seadn.io", "raw2.seadn.io"]);
const OWNER_DISCOVERY_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);
const AUTOMATION_REGISTRY_ABI = parseAbi([
  "function isAccountCreated(uint256 tokenId) view returns (bool)",
]);
const OWNER_SCAN_CHUNK = 200;
const OWNER_SCAN_CONCURRENCY = 4;
const MULTICALL3_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11";

function own(value, key) {
  return value && typeof value === "object" && Object.hasOwn(value, key)
    ? value[key] : undefined;
}

function boundedText(value, maximum) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maximum) : null;
}

function openSeaImageUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && OPENSEA_IMAGE_HOSTS.has(url.hostname)
      && !url.username && !url.password && !url.port && !url.hash ? url.href : null;
  } catch {
    return null;
  }
}

export function proposedRetirementTierForOpenSeaRank(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > GOGH_PUNKS_MAX_SUPPLY) return null;
  if (value <= Math.ceil(GOGH_PUNKS_MAX_SUPPLY * 0.01)) return "MYTHIC";
  if (value <= Math.ceil(GOGH_PUNKS_MAX_SUPPLY * 0.05)) return "LEGENDARY";
  if (value <= Math.ceil(GOGH_PUNKS_MAX_SUPPLY * 0.15)) return "EPIC";
  if (value <= Math.ceil(GOGH_PUNKS_MAX_SUPPLY * 0.35)) return "RARE";
  if (value <= Math.ceil(GOGH_PUNKS_MAX_SUPPLY * 0.60)) return "UNCOMMON";
  return "COMMON";
}

function openSeaDecoration(nft, tokenId) {
  const imageUrl = ["display_image_url", "image_url", "original_image_url"]
    .map((key) => openSeaImageUrl(own(nft, key))).find(Boolean) ?? null;
  const rarityValue = own(nft, "rarity");
  const rankValue = own(rarityValue, "rank");
  const rank = Number.isSafeInteger(rankValue) && rankValue >= 1
    && rankValue <= GOGH_PUNKS_MAX_SUPPLY ? rankValue : null;
  const proposedTier = proposedRetirementTierForOpenSeaRank(rank);
  return Object.freeze({
    tokenId,
    artwork: Object.freeze({
      status: "AVAILABLE",
      name: boundedText(own(nft, "name"), 200) ?? `Gogh Punk #${tokenId}`,
      description: null,
      imageUrl,
      collectionSlug: OPENSEA_COLLECTION_SLUG,
      tokenStandard: "ERC721",
      traits: null,
      openSeaUrl: `https://opensea.io/assets/robinhood/${ROBINHOOD.canonicalCollection}/${tokenId}`,
      fetchedAt: null,
    }),
    rarity: rank && proposedTier ? Object.freeze({
      source: "OPENSEA_OPENRARITY_CURRENT",
      rank,
      proposedTier,
      rankBandSupply: GOGH_PUNKS_MAX_SUPPLY,
      strategyId: boundedText(own(rarityValue, "strategy_id"), 96),
      strategyVersion: boundedText(own(rarityValue, "strategy_version"), 96),
      permanentSnapshot: false,
    }) : null,
  });
}

function address(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase() : null;
}

export function ownerPunkView(value) {
  try {
    const view = new URL(String(value)).searchParams.get("view");
    return view === "indexed" ? "indexed" : "reconcile";
  } catch {
    return "reconcile";
  }
}

function ownerDiscoveryClient(environment = process.env) {
  const raw = environment.ROBINHOOD_RPC_URL ?? environment.RPC_URL ?? ROBINHOOD.rpcUrl;
  let rpcUrl;
  try { rpcUrl = new URL(raw); } catch { throw new TypeError("owner discovery RPC is invalid"); }
  if (rpcUrl.protocol !== "https:" || rpcUrl.username || rpcUrl.password || rpcUrl.hash) {
    throw new TypeError("owner discovery RPC is invalid");
  }
  const chain = defineChain({
    id: ROBINHOOD.chainId,
    name: ROBINHOOD.name,
    nativeCurrency: ROBINHOOD.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl.href] } },
    contracts: { multicall3: { address: MULTICALL3_ADDRESS } },
  });
  return createPublicClient({
    chain,
    transport: http(rpcUrl.href, { retryCount: 1, timeout: 5_000 }),
  });
}

async function liveOwnedFromCandidates(client, owner, tokenIds, blockNumber) {
  const output = [];
  for (let offset = 0; offset < tokenIds.length; offset += OWNER_SCAN_CHUNK) {
    const chunk = tokenIds.slice(offset, offset + OWNER_SCAN_CHUNK);
    const results = await client.multicall({
      allowFailure: true,
      blockNumber,
      contracts: chunk.map((tokenId) => ({
        address: ROBINHOOD.canonicalCollection,
        abi: OWNER_DISCOVERY_ABI,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      })),
    });
    if (!Array.isArray(results) || results.length !== chunk.length) {
      throw new TypeError("owner discovery result count changed");
    }
    for (let index = 0; index < chunk.length; index += 1) {
      const result = results[index];
      if (result?.status === "success" && address(result.result) === owner) output.push(chunk[index]);
    }
  }
  return output;
}

export async function liveOwnerPunkSnapshot(owner, candidateTokenIds = [], {
  client = ownerDiscoveryClient(),
} = {}) {
  const normalized = address(owner);
  if (!normalized || !Array.isArray(candidateTokenIds)
    || candidateTokenIds.length > MAX_CANDIDATES
    || candidateTokenIds.some((value) => punkTokenId(String(value)) !== String(value))
    || typeof client?.getBlockNumber !== "function"
    || typeof client?.readContract !== "function" || typeof client?.multicall !== "function") {
    throw new TypeError("live owner discovery input is invalid");
  }
  const blockNumber = await client.getBlockNumber();
  if (typeof blockNumber !== "bigint" || blockNumber < 0n
    || blockNumber > 9_223_372_036_854_775_807n) {
    throw new TypeError("live owner discovery block is invalid");
  }
  const balance = await client.readContract({
    address: ROBINHOOD.canonicalCollection,
    abi: OWNER_DISCOVERY_ABI,
    functionName: "balanceOf",
    args: [normalized],
    blockNumber,
  });
  if (typeof balance !== "bigint" || balance < 0n || balance > BigInt(MAX_CANDIDATES)) {
    throw new RangeError("live owner Punk balance is outside the UI bound");
  }
  if (balance === 0n) {
    return Object.freeze({ tokenIds: Object.freeze([]), blockNumber });
  }

  const boundedCandidates = [...new Set(candidateTokenIds)];
  const verifiedCandidates = await liveOwnedFromCandidates(
    client, normalized, boundedCandidates, blockNumber,
  );
  if (BigInt(verifiedCandidates.length) === balance) {
    return Object.freeze({
      tokenIds: Object.freeze(
        verifiedCandidates.sort((left, right) => Number(left) - Number(right)),
      ),
      blockNumber,
    });
  }

  // The local ownership index and marketplace cache are acceleration hints, not completeness
  // evidence. Only when their live-verified count differs from balanceOf do we scan the bounded
  // 5,017-token collection. Four workers keep this to 26 server-side Multicall reads rather than
  // 5,017 wallet-provider requests; the browser still performs its own live verification.
  const chunks = [];
  for (let first = 0; first <= GOGH_PUNKS_MAX_SUPPLY; first += OWNER_SCAN_CHUNK) {
    chunks.push(Array.from({
      length: Math.min(OWNER_SCAN_CHUNK, GOGH_PUNKS_MAX_SUPPLY - first + 1),
    }, (_, index) => String(first + index)));
  }
  const output = [];
  let cursor = 0;
  const scan = async () => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor];
      cursor += 1;
      output.push(...await liveOwnedFromCandidates(client, normalized, chunk, blockNumber));
    }
  };
  await Promise.all(Array.from({ length: Math.min(OWNER_SCAN_CONCURRENCY, chunks.length) }, scan));
  output.sort((left, right) => Number(left) - Number(right));
  if (BigInt(output.length) !== balance || new Set(output).size !== output.length) {
    throw new TypeError("live owner discovery did not reconcile the wallet balance");
  }
  return Object.freeze({ tokenIds: Object.freeze(output), blockNumber });
}

export async function liveOwnerPunkIds(owner, candidateTokenIds = [], options = {}) {
  return (await liveOwnerPunkSnapshot(owner, candidateTokenIds, options)).tokenIds;
}

export async function createdAutomationV3PunkIds(tokenIds, {
  client = ownerDiscoveryClient(),
  registry = automationManifest?.contracts?.GoghPunkAccountRegistryV3?.address,
} = {}) {
  const normalizedRegistry = address(registry);
  if (!normalizedRegistry || !Array.isArray(tokenIds) || tokenIds.length > MAX_CANDIDATES
    || tokenIds.some((value) => punkTokenId(String(value)) !== String(value))
    || typeof client?.multicall !== "function") {
    throw new TypeError("V3 Punk wallet discovery input is invalid");
  }
  if (tokenIds.length === 0) return Object.freeze([]);
  const results = await client.multicall({
    allowFailure: true,
    contracts: tokenIds.map((tokenId) => ({
      address: normalizedRegistry,
      abi: AUTOMATION_REGISTRY_ABI,
      functionName: "isAccountCreated",
      args: [BigInt(tokenId)],
    })),
  });
  if (!Array.isArray(results) || results.length !== tokenIds.length) {
    throw new TypeError("V3 Punk wallet discovery result count changed");
  }
  return Object.freeze(tokenIds.filter((_, index) => (
    results[index]?.status === "success" && results[index].result === true
  )));
}

export async function indexedOwnerPunkIds(owner, query = (...args) => (
  getDatabase().pool.query(...args)
)) {
  const normalized = address(owner);
  if (!normalized) throw new TypeError("invalid owner");
  const result = await query(
    `SELECT token_id
       FROM broker_punks
      WHERE chain_id = $1
        AND collection_address = $2
        AND LOWER(owner_snapshot) = $3
      ORDER BY token_id::numeric
      LIMIT $4`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, normalized, MAX_CANDIDATES + 1],
  );
  if (!Array.isArray(result?.rows) || result.rows.length > MAX_CANDIDATES) {
    throw new RangeError("indexed owner Punk candidate set is unavailable or too large");
  }
  const tokenIds = result.rows.map(({ token_id: tokenId }) => String(tokenId));
  if (tokenIds.some((tokenId) => !/^(0|[1-9]\d{0,3})$/.test(tokenId))) {
    throw new TypeError("indexed owner Punk token is invalid");
  }
  return Object.freeze([...new Set(tokenIds)]);
}

export async function refreshIndexedOwnerPunks(owner, tokenIds, blockNumber, query = (...args) => (
  getDatabase().pool.query(...args)
)) {
  const normalized = address(owner);
  if (!normalized || !Array.isArray(tokenIds) || tokenIds.length > MAX_CANDIDATES
    || tokenIds.some((value) => punkTokenId(String(value)) !== String(value))
    || typeof blockNumber !== "bigint" || blockNumber < 0n
    || blockNumber > 9_223_372_036_854_775_807n || typeof query !== "function") {
    throw new TypeError("owner Punk index refresh input is invalid");
  }
  const normalizedTokenIds = [...new Set(tokenIds)]
    .sort((left, right) => Number(left) - Number(right));
  const result = await query(
    `WITH owned AS (
       SELECT UNNEST($4::numeric[]) AS token_id
     ), cleared AS (
       UPDATE broker_punks AS punk
          SET owner_snapshot = NULL,
              owner_snapshot_block = $5,
              indexed_through_block = GREATEST(
                COALESCE(punk.indexed_through_block, $5), $5
              ),
              updated_at = NOW()
        WHERE punk.chain_id = $1
          AND punk.collection_address = $2
          AND LOWER(punk.owner_snapshot) = $3
          AND (punk.owner_snapshot_block IS NULL OR punk.owner_snapshot_block <= $5)
          AND NOT EXISTS (
            SELECT 1 FROM owned WHERE owned.token_id = punk.token_id
          )
       RETURNING punk.token_id
     ), upserted AS (
       INSERT INTO broker_punks
         (chain_id, collection_address, token_id, owner_snapshot,
          owner_snapshot_block, indexed_through_block, updated_at)
       SELECT $1, $2, owned.token_id, $3, $5, $5, NOW()
         FROM owned
       ON CONFLICT (chain_id, collection_address, token_id) DO UPDATE
         SET owner_snapshot = EXCLUDED.owner_snapshot,
             owner_snapshot_block = EXCLUDED.owner_snapshot_block,
             indexed_through_block = GREATEST(
               COALESCE(broker_punks.indexed_through_block, EXCLUDED.indexed_through_block),
               EXCLUDED.indexed_through_block
             ),
             updated_at = NOW()
       WHERE broker_punks.owner_snapshot_block IS NULL
          OR broker_punks.owner_snapshot_block <= EXCLUDED.owner_snapshot_block
       RETURNING broker_punks.token_id
     )
     SELECT
       (SELECT COUNT(*)::integer FROM cleared) AS cleared_count,
       (SELECT COUNT(*)::integer FROM upserted) AS upserted_count`,
    [
      ROBINHOOD.chainId,
      ROBINHOOD.canonicalCollection,
      normalized,
      normalizedTokenIds,
      blockNumber.toString(),
    ],
  );
  if (!Array.isArray(result?.rows) || result.rows.length !== 1) {
    throw new TypeError("owner Punk index refresh result is invalid");
  }
  return Object.freeze({
    tokenIds: Object.freeze(normalizedTokenIds),
    blockNumber,
    clearedCount: Number(result.rows[0].cleared_count ?? 0),
    upsertedCount: Number(result.rows[0].upserted_count ?? 0),
  });
}

export async function ownerPunkArtwork(tokenIds, query = (...args) => (
  getDatabase().pool.query(...args)
)) {
  if (!Array.isArray(tokenIds) || tokenIds.length > MAX_CANDIDATES
    || tokenIds.some((value) => punkTokenId(String(value)) !== String(value))) {
    throw new TypeError("owner Punk artwork input is invalid");
  }
  if (tokenIds.length === 0) return Object.freeze([]);
  const result = await query(
    `SELECT nft_metadata.token_id, ${NFT_DISPLAY_METADATA_SELECT}
       FROM broker_nft_metadata AS nft_metadata
      WHERE nft_metadata.chain_id = $1
        AND nft_metadata.collection_address = $2
        AND nft_metadata.token_id = ANY($3::numeric[])
      ORDER BY nft_metadata.token_id`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenIds],
  );
  const byToken = new Map((result.rows ?? []).map((row) => [String(row.token_id), row]));
  return Object.freeze(tokenIds.map((id) => Object.freeze({
    tokenId: id,
    artwork: Object.freeze(nftDisplayMetadata(byToken.get(id) ?? {})),
  })));
}

function punkTokenId(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,3})$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 9_999 ? String(parsed) : null;
}

export function configuredAutomationPunkIds(environment = process.env) {
  const raw = environment.BROKER_AUTOMATION_V3_PUNK_IDS;
  if (raw === undefined || raw === "") return Object.freeze([]);
  if (typeof raw !== "string" || raw.trim() !== raw || raw.length > 384) {
    throw new TypeError("automation Punk roster is invalid");
  }
  const tokenIds = raw.split(",");
  if (tokenIds.length < 1 || tokenIds.length > AUTOMATION_ROSTER_LIMIT
    || tokenIds.some((tokenId) => punkTokenId(tokenId) !== tokenId)
    || new Set(tokenIds).size !== tokenIds.length) {
    throw new TypeError("automation Punk roster is invalid");
  }
  return Object.freeze([...tokenIds].sort((left, right) => Number(left) - Number(right)));
}

export async function enrolledAutomationPunkIds(owner, query = (...args) => (
  getDatabase().pool.query(...args)
)) {
  const normalized = address(owner);
  if (!normalized) throw new TypeError("invalid owner");
  const result = await query(
    `SELECT token_id::text AS token_id
       FROM broker_automation_v3_enrollments
      WHERE chain_id = $1
        AND collection_address = $2
        AND LOWER(owner_snapshot) = $3
      ORDER BY token_id::numeric
      LIMIT $4`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, normalized, MAX_CANDIDATES + 1],
  );
  if (!Array.isArray(result?.rows) || result.rows.length > MAX_CANDIDATES) {
    throw new RangeError("automation enrollment set is unavailable or too large");
  }
  const tokenIds = result.rows.map(({ token_id: value }) => punkTokenId(String(value)));
  if (tokenIds.some((value) => value === null)) {
    throw new TypeError("automation enrollment token is invalid");
  }
  return Object.freeze([...new Set(tokenIds)]);
}

function agentSummaryStatus(row, nowMs = Date.now()) {
  const configured = row.configured === true;
  const enrolled = row.enrolled === true;
  if (!enrolled) return configured ? "NEEDS_ENROLLMENT" : "READY";
  if (row.worker_state == null) return "WAITING_FOR_FIRST_SCAN";
  const evidenceAt = row.updated_at == null ? Number.NaN : Date.parse(row.updated_at);
  // next_scan_estimate is advisory. A manual run can calculate it from a one-Punk request even
  // though the scheduled worker subsequently rotates through the full production roster. An
  // overdue estimate therefore cannot prove that this Punk needs owner attention. Use durable
  // per-Punk worker evidence for the card and reserve global failures for the worker-health tile.
  if (!Number.isFinite(evidenceAt) || evidenceAt > nowMs + 30_000
    || evidenceAt < nowMs - 3 * 60 * 60_000) {
    return "NEEDS_ATTENTION";
  }
  if (row.worker_state === "PAUSED") return "PAUSED";
  if (row.worker_state === "ERROR") {
    // These failures happen before an executable transaction exists. Enrollment remains intact,
    // so the scheduled fair rotation retries the Punk without new authority or an owner click.
    // Contract/account defects stay owner-visible rather than entering a blind retry loop.
    return new Set([
      "DISCOVERY_SCAN_FAILED", "PROFILE_STATE_READ_FAILED", "CANDIDATE_STATE_READ_FAILED",
      "PROVIDER_OWNER_DISAGREEMENT", "WORKER_RUN_FAILED",
    ]).has(row.reason) ? "RETRY_SCHEDULED" : "NEEDS_ATTENTION";
  }
  if (["SUBMITTING", "CONFIRMING"].includes(row.worker_state)) return "MINTING";
  if (["SCANNING", "CANDIDATE_FOUND", "VERIFYING_CONTRACT", "CHECKING_PRICE",
    "CHECKING_ELIGIBILITY", "CHECKING_LIMITS", "SIMULATING", "READY"].includes(
    row.worker_state,
  )) return "SCANNING";
  if (row.worker_state === "QUEUED") return "QUEUED";
  return "ACTIVE";
}

export async function automationPunkAgentSummaries(owner, query = (...args) => (
  getDatabase().pool.query(...args)
), nowMs = Date.now()) {
  const normalized = address(owner);
  if (!normalized || typeof query !== "function" || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError("agent summary input is invalid");
  }
  const result = await query(
    `WITH latest_mandates AS (
       SELECT DISTINCT ON (token_id) token_id, mode, configured_by
         FROM broker_art_mandates
        WHERE chain_id = $1 AND collection_address = $2
        ORDER BY token_id, version DESC
     ), roster AS (
       SELECT token_id, TRUE AS configured, FALSE AS enrolled, NULL::text AS account_address
         FROM latest_mandates
        WHERE LOWER(configured_by) = $3 AND mode = 'AUTONOMOUS'
       UNION ALL
       SELECT token_id, FALSE AS configured, TRUE AS enrolled, account_address::text
         FROM broker_automation_v3_enrollments
        WHERE chain_id = $1 AND collection_address = $2 AND LOWER(owner_snapshot) = $3
     ), combined AS (
       SELECT token_id, BOOL_OR(configured) AS configured, BOOL_OR(enrolled) AS enrolled,
              MAX(account_address) AS account_address
         FROM roster GROUP BY token_id
     )
     SELECT combined.token_id::text, combined.configured, combined.enrolled,
            combined.account_address, heartbeat.state AS worker_state,
            heartbeat.last_scheduled_scan, heartbeat.last_actual_scan,
            heartbeat.last_successful_mint, heartbeat.next_scan_estimate,
            heartbeat.reason, heartbeat.updated_at,
            global.status AS global_status, global.completed_at AS global_completed_at
       FROM combined
       LEFT JOIN broker_punk_agent_heartbeats AS heartbeat
         ON heartbeat.chain_id = $1 AND heartbeat.punk_token_id = combined.token_id
       LEFT JOIN broker_automation_v3_worker_state AS global ON global.singleton_id = 1
      ORDER BY combined.token_id
      LIMIT $4`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, normalized, MAX_CANDIDATES + 1],
  );
  if (!Array.isArray(result?.rows) || result.rows.length > MAX_CANDIDATES) {
    throw new RangeError("agent summary set is unavailable or too large");
  }
  return Object.freeze(result.rows.map((row) => {
    const selectedTokenId = punkTokenId(String(row.token_id));
    if (!selectedTokenId) throw new TypeError("agent summary token is invalid");
    const timestamp = (value) => value == null ? null : new Date(value).toISOString();
    const transactionHash = row.last_successful_mint == null
      ? null : String(row.last_successful_mint).toLowerCase();
    if (transactionHash !== null && !/^0x[0-9a-f]{64}$/.test(transactionHash)) {
      throw new TypeError("agent summary mint hash is invalid");
    }
    const reason = row.reason == null ? null : String(row.reason);
    if (reason !== null && !/^[A-Z0-9_]{3,64}$/.test(reason)) {
      throw new TypeError("agent summary reason is invalid");
    }
    return Object.freeze({
      tokenId: selectedTokenId,
      configured: row.configured === true,
      enrolled: row.enrolled === true,
      account: address(row.account_address),
      status: agentSummaryStatus(row, nowMs),
      workerState: row.worker_state == null ? null : String(row.worker_state),
      lastScheduledScan: timestamp(row.last_scheduled_scan),
      lastActualScan: timestamp(row.last_actual_scan),
      lastSuccessfulMint: transactionHash,
      nextScanEstimate: timestamp(row.next_scan_estimate),
      reason,
      updatedAt: timestamp(row.updated_at),
    });
  }));
}

async function boundedJson(response, source = "Owner candidate") {
  const declared = response.headers?.get?.("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > OPENSEA_RESPONSE_BYTES) {
    throw new RangeError(`${source} response is too large`);
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > OPENSEA_RESPONSE_BYTES) {
    throw new RangeError(`${source} response is too large`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new TypeError(`${source} response is not valid JSON`);
  }
}

export async function openSeaOwnerPunks(owner, {
  apiKey,
  fetchFn = fetch,
  timeoutMs = 8_000,
  maximumPages = OPENSEA_MAX_PAGES,
} = {}) {
  const normalized = address(owner);
  if (!normalized) throw new TypeError("invalid owner");
  if (typeof apiKey !== "string" || apiKey.trim().length < 8 || apiKey.length > 512) {
    throw new TypeError("OpenSea API key is unavailable");
  }
  if (typeof fetchFn !== "function" || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1_000 || timeoutMs > 30_000
    || !Number.isSafeInteger(maximumPages) || maximumPages < 1 || maximumPages > 5) {
    throw new TypeError("OpenSea owner discovery configuration is invalid");
  }

  const output = new Map();
  const cursors = new Set();
  let cursor = null;
  for (let page = 0; page < maximumPages; page += 1) {
    const endpoint = new URL(`https://api.opensea.io/api/v2/chain/robinhood/account/${normalized}/nfts`);
    endpoint.searchParams.set("collection", OPENSEA_COLLECTION_SLUG);
    endpoint.searchParams.set("limit", String(OPENSEA_PAGE_LIMIT));
    if (cursor) endpoint.searchParams.set("next", cursor);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(endpoint, {
        method: "GET",
        headers: Object.freeze({ accept: "application/json", "x-api-key": apiKey.trim() }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response?.ok) {
        throw new Error(`OpenSea owner request failed (${response?.status ?? "unknown"})`);
      }
      const payload = await boundedJson(response, "OpenSea owner");
      const nfts = own(payload, "nfts");
      if (!payload || typeof payload !== "object" || Array.isArray(payload)
        || !Array.isArray(nfts) || nfts.length > OPENSEA_PAGE_LIMIT) {
        throw new TypeError("OpenSea owner response has an invalid NFT list");
      }
      for (const nft of nfts) {
        if (!nft || typeof nft !== "object" || Array.isArray(nft)) continue;
        if (address(own(nft, "contract")) !== ROBINHOOD.canonicalCollection) continue;
        if (own(nft, "collection") !== undefined
          && own(nft, "collection") !== OPENSEA_COLLECTION_SLUG) continue;
        const tokenId = punkTokenId(own(nft, "identifier"));
        if (tokenId) output.set(tokenId, openSeaDecoration(nft, tokenId));
        if (output.size > MAX_CANDIDATES) throw new RangeError("OpenSea Punk candidate set is too large");
      }
      const next = own(payload, "next");
      if (next === null || next === undefined || next === "") break;
      if (typeof next !== "string" || next.length > 1_024
        || cursors.has(next)) throw new TypeError("OpenSea owner cursor is invalid");
      cursors.add(next);
      cursor = next;
    } finally {
      clearTimeout(timeout);
    }
  }
  return Object.freeze([...output.values()].sort((left, right) => (
    Number(left.tokenId) - Number(right.tokenId)
  )));
}

export async function openSeaOwnerPunkIds(owner, options) {
  const punks = await openSeaOwnerPunks(owner, options);
  return Object.freeze(punks.map(({ tokenId }) => tokenId));
}

export function mergeOwnerPunkDecorations(
  tokenIds,
  cachedPunks,
  openSeaPunks,
  automationTokenIds = [],
  automationCreatedTokenIds = [],
  agentSummaries = [],
) {
  if (!Array.isArray(tokenIds) || !Array.isArray(cachedPunks)
    || !Array.isArray(openSeaPunks) || !Array.isArray(automationTokenIds)
    || !Array.isArray(automationCreatedTokenIds) || !Array.isArray(agentSummaries)
    || automationTokenIds.some((value) => punkTokenId(String(value)) !== String(value))
    || automationCreatedTokenIds.some((value) => punkTokenId(String(value)) !== String(value))) {
    throw new TypeError("owner Punk decorations are invalid");
  }
  const cached = new Map(cachedPunks.map((item) => [String(item?.tokenId), item]));
  const external = new Map(openSeaPunks.map((item) => [String(item?.tokenId), item]));
  const automation = new Set(automationTokenIds);
  const automationCreated = new Set(automationCreatedTokenIds);
  const summaries = new Map(agentSummaries.map((item) => [String(item?.tokenId), item]));
  return Object.freeze(tokenIds.map((tokenId) => {
    const cacheItem = cached.get(tokenId);
    const openSeaItem = external.get(tokenId);
    const cachedArtwork = cacheItem?.artwork ?? null;
    const artwork = cachedArtwork?.imageUrl ? cachedArtwork : openSeaItem?.artwork ?? cachedArtwork;
    return Object.freeze({
      tokenId,
      artwork: artwork ?? null,
      rarity: openSeaItem?.rarity ?? null,
      automationConfigured: automation.has(tokenId),
      automationCreated: automationCreated.has(tokenId),
      agentSummary: summaries.get(tokenId) ?? null,
    });
  }));
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const owner = address(new URL(request.url).searchParams.get("owner"));
  if (!owner) return json({ ok: false, code: "INVALID_OWNER" }, 400);
  try {
    const view = ownerPunkView(request.url);
    const automationRoster = configuredAutomationPunkIds();
    const [indexedResult, enrollmentResult, agentSummaryResult] = await Promise.allSettled([
      indexedOwnerPunkIds(owner),
      enrolledAutomationPunkIds(owner),
      automationPunkAgentSummaries(owner),
    ]);
    // This route only supplies discovery hints. The browser's bounded Multicall scan and the
    // selection-time ownerOf check remain authoritative, so an index outage may return an empty
    // hint set instead of blocking the holder behind an unrelated marketplace API.
    const enrolled = enrollmentResult.status === "fulfilled" ? enrollmentResult.value : [];
    const agentSummaries = agentSummaryResult.status === "fulfilled" ? agentSummaryResult.value : [];
    const automationTokenIds = [...new Set([
      ...automationRoster, ...enrolled, ...agentSummaries.map(({ tokenId }) => tokenId),
    ])];
    let candidateTokenIds = [...new Set([
      ...(indexedResult.status === "fulfilled" ? indexedResult.value : []),
      ...automationTokenIds,
    ])].sort((left, right) => Number(left) - Number(right));
    if (candidateTokenIds.length > MAX_CANDIDATES) throw new RangeError("owner candidate set is too large");
    if (view === "indexed") {
      let indexedAutomationCreated = [];
      let automationWalletsAvailable = false;
      try {
        // One bounded Multicall supplies the immutable V3 wallet-created bit for the complete
        // indexed roster. Without it, the fast path showed only locally configured/enrolled
        // rows and a holder's active-agent count could collapse until a slow reconciliation.
        indexedAutomationCreated = [...await createdAutomationV3PunkIds(candidateTokenIds)];
        automationWalletsAvailable = true;
      } catch {
        // Durable enrollments are still useful display hints when the one live batch is
        // temporarily unavailable. Selection and every privileged action recheck the chain.
        indexedAutomationCreated = [...enrolled];
      }
      let cachedPunks = [];
      let artworkAvailable = false;
      try {
        // Immutable Punk artwork is safe to decorate from the local metadata index. Loading all
        // indexed cards is one bounded SQL read and avoids delaying the first usable roster on
        // OpenSea, tokenURI, or a wallet RPC. Ownership and wallet state remain unverified hints.
        cachedPunks = await ownerPunkArtwork(candidateTokenIds);
        artworkAvailable = true;
      } catch (error) {
        console.error(JSON.stringify({
          event: "BROKER_OWNER_PUNK_INDEXED_ARTWORK_UNAVAILABLE", type: error?.name,
        }));
      }
      const candidatePunks = mergeOwnerPunkDecorations(
        candidateTokenIds,
        cachedPunks,
        [],
        automationTokenIds,
        // Enrollment is durable evidence that this wallet existed when the Punk last passed the
        // live worker gate, but it is not current authority. Mark it only as a cached visual hint;
        // browser Multicall and selection-time status replace it before actions are enabled.
        indexedAutomationCreated,
        agentSummaries,
      );
      return json({
        ok: true,
        chainId: ROBINHOOD.chainId,
        collection: ROBINHOOD.canonicalCollection,
        owner,
        view,
        candidateTokenIds,
        candidatePunks,
        candidateSources: Object.freeze({
          indexed: indexedResult.status === "fulfilled",
          openSea: false,
          liveOwnerComplete: false,
          liveMulticall: false,
          automationRoster: automationRoster.length > 0,
          automationEnrollments: enrollmentResult.status === "fulfilled",
          automationWallets: automationWalletsAvailable,
          agentSummaries: agentSummaryResult.status === "fulfilled",
          artwork: artworkAvailable,
        }),
        reconciliationRecommended: candidateTokenIds.length === 0,
        evidence: "INDEXED_DISCOVERY_HINTS_ONLY_EACH_SELECTION_REQUIRES_LIVE_WALLET_OWNER_CHECK",
        activationAuthorized: false,
        autonomyAuthorized: false,
      }, 200, { "cache-control": "private, max-age=15, stale-while-revalidate=45" });
    }
    let openSeaPunks = [];
    let openSeaAvailable = false;
    if (process.env.OPENSEA_API_KEY) {
      try {
        // This route is called only after an owner connects. OpenSea is a bounded discovery hint
        // that fills recently transferred/activated Punks which have not reached the local index
        // yet; every returned ID is still live-verified through Multicall in the browser.
        openSeaPunks = await openSeaOwnerPunks(owner, {
          apiKey: process.env.OPENSEA_API_KEY,
          timeoutMs: 2_500,
        });
        openSeaAvailable = true;
        candidateTokenIds = [...new Set([
          ...candidateTokenIds,
          ...openSeaPunks.map(({ tokenId }) => tokenId),
        ])].sort((left, right) => Number(left) - Number(right));
      } catch (error) {
        console.error(JSON.stringify({
          event: "BROKER_OWNER_PUNK_OPENSEA_FALLBACK_UNAVAILABLE", type: error?.name,
        }));
      }
    }
    let liveOwnerAvailable = false;
    let liveOwnerSnapshot = null;
    try {
      // Complete the fast index/marketplace hints only when balanceOf proves they are stale. The
      // resulting list is still a server hint; browser Multicall remains the UI authority.
      liveOwnerSnapshot = await liveOwnerPunkSnapshot(owner, candidateTokenIds);
      candidateTokenIds = [...liveOwnerSnapshot.tokenIds];
      liveOwnerAvailable = true;
    } catch (primaryError) {
      try {
        // A keyed provider is preferred, but Punk discovery must not disappear when that provider
        // is rate-limited or misconfigured. The canonical public RPC is a read-only completion
        // fallback used only for this owner-triggered request.
        liveOwnerSnapshot = await liveOwnerPunkSnapshot(owner, candidateTokenIds, {
          client: ownerDiscoveryClient({ ROBINHOOD_RPC_URL: ROBINHOOD.rpcUrl }),
        });
        candidateTokenIds = [...liveOwnerSnapshot.tokenIds];
        liveOwnerAvailable = true;
      } catch (fallbackError) {
        console.error(JSON.stringify({
          event: "BROKER_OWNER_PUNK_LIVE_COMPLETION_UNAVAILABLE",
          primaryType: primaryError?.name,
          fallbackType: fallbackError?.name,
        }));
      }
    }
    if (liveOwnerSnapshot) {
      try {
        // A complete balanceOf reconciliation at one pinned block is safe to persist as an
        // acceleration index. The browser and every privileged action still recheck live ownerOf.
        await refreshIndexedOwnerPunks(
          owner, liveOwnerSnapshot.tokenIds, liveOwnerSnapshot.blockNumber,
        );
      } catch (error) {
        console.error(JSON.stringify({
          event: "BROKER_OWNER_PUNK_INDEX_REFRESH_UNAVAILABLE", type: error?.name,
        }));
      }
    }
    if (candidateTokenIds.length > MAX_CANDIDATES) throw new RangeError("owner candidate set is too large");
    let automationCreatedTokenIds = [];
    let automationWalletsAvailable = false;
    try {
      automationCreatedTokenIds = [...await createdAutomationV3PunkIds(candidateTokenIds)];
      automationWalletsAvailable = true;
    } catch (primaryError) {
      try {
        automationCreatedTokenIds = [...await createdAutomationV3PunkIds(candidateTokenIds, {
          client: ownerDiscoveryClient({ ROBINHOOD_RPC_URL: ROBINHOOD.rpcUrl }),
        })];
        automationWalletsAvailable = true;
      } catch (fallbackError) {
        console.error(JSON.stringify({
          event: "BROKER_OWNER_PUNK_V3_WALLETS_UNAVAILABLE",
          primaryType: primaryError?.name,
          fallbackType: fallbackError?.name,
        }));
      }
    }
    let cachedPunks = [];
    let artworkAvailable = false;
    try {
      // Initial discovery does not need artwork for every inactive Punk. Active/enrolled cards
      // may use cached decoration immediately; a newly selected Punk hydrates from tokenURI.
      cachedPunks = await ownerPunkArtwork([...new Set([
        ...automationTokenIds, ...automationCreatedTokenIds,
      ])]);
      artworkAvailable = true;
    } catch (error) {
      // Artwork is decoration, never authority. A metadata/index outage must not prevent
      // a holder from seeing and live-verifying their Punk IDs.
      console.error(JSON.stringify({
        event: "BROKER_OWNER_PUNK_ARTWORK_UNAVAILABLE", type: error?.name,
      }));
    }
    const candidatePunks = mergeOwnerPunkDecorations(
      candidateTokenIds,
      cachedPunks,
      openSeaPunks,
      automationTokenIds,
      automationCreatedTokenIds,
      agentSummaries,
    );
    return json({
      ok: true,
      chainId: ROBINHOOD.chainId,
      collection: ROBINHOOD.canonicalCollection,
      owner,
      view,
      candidateTokenIds,
      candidatePunks,
      candidateSources: Object.freeze({
        indexed: indexedResult.status === "fulfilled",
        openSea: openSeaAvailable,
        liveOwnerComplete: liveOwnerAvailable,
        liveMulticall: true,
        automationRoster: automationRoster.length > 0,
        automationEnrollments: enrollmentResult.status === "fulfilled",
        automationWallets: automationWalletsAvailable,
        agentSummaries: agentSummaryResult.status === "fulfilled",
        artwork: artworkAvailable,
      }),
      reconciliationRecommended: false,
      evidence: "DISCOVERY_CANDIDATES_ONLY_EACH_SELECTION_REQUIRES_LIVE_WALLET_OWNER_CHECK",
      activationAuthorized: false,
      autonomyAuthorized: false,
    }, 200, { "cache-control": "private, no-store" });
  } catch (error) {
    console.error(JSON.stringify({ event: "BROKER_OWNER_PUNKS_FAILED", type: error?.name }));
    return json({ ok: false, code: "OWNER_PUNK_CANDIDATES_UNAVAILABLE" }, 503,
      { "cache-control": "private, no-store" });
  }
}

export const config = {
  path: "/api/broker/owner-punks",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 30,
    windowSize: 60,
  },
};
