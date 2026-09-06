import { createPublicClient, http, keccak256, parseAbi, parseAbiItem } from "viem";

import { ROBINHOOD } from "../../config.mjs";
import {
  V2_ADAPTER_REGISTRY, V2_OPEN_SEA_FEE_RECIPIENT, V2_SEADROP, V2_SEADROP_ADAPTER,
  V2_SEADROP_ADAPTER_CODE_HASH,
} from "./seadrop-ingestor.mjs";

const PUBLIC_DROP_UPDATED = parseAbiItem(
  "event PublicDropUpdated(address indexed nftContract, (uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients) publicDrop)",
);
const ABI = parseAbi([
  "function getPublicDrop(address nftContract) view returns ((uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))",
  "function getFeeRecipientIsAllowed(address nftContract,address feeRecipient) view returns (bool)",
  "function validateAdapter(address adapter,uint8 expectedKind,address expectedVenue,bytes32 expectedCodeHash) view returns (bool)",
  "function name() view returns (string)",
  "function maxSupply() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);
const SOURCE_KEY = "ROBINHOOD_SEADROP_PUBLIC_DROP_V2";
const CONFIRMATIONS = 20n;
const BOOTSTRAP_BLOCKS = 10_000n;
const CHUNK = 2_000n;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readLogsWithBackoff(client, request, pause = delay) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return await client.getLogs(request); }
    catch (error) {
      lastError = error;
      const retryable = error?.code === 429 || error?.status === 429
        || /too many requests|rate limit/i.test(String(error?.message ?? ""));
      if (!retryable || attempt === 3) throw error;
      await pause(500 * (2 ** attempt));
    }
  }
  throw lastError;
}

export function createRobinhoodDiscoveryClient(rpcUrl = ROBINHOOD.rpcUrl) {
  return createPublicClient({ transport: http(rpcUrl, { timeout: 8_000, retryCount: 1 }) });
}

async function optionalRead(client, request, fallback) {
  try { return await client.readContract(request); } catch { return fallback; }
}

export async function readCurrentRobinhoodSeaDropObservations({ pool, client,
  now = new Date(), maximum = 50, pause = delay }) {
  if (!pool || typeof pool.query !== "function" || !client
    || typeof client.getBlockNumber !== "function" || !Number.isInteger(maximum)
    || maximum < 1 || maximum > 100) throw new TypeError("Robinhood discovery source is invalid");
  const head = await client.getBlockNumber();
  const confirmed = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;
  const checkpointResult = await pool.query(`SELECT indexed_through_block::text AS block
    FROM broker_v2_discovery_checkpoints WHERE source_key = $1 AND chain_id = $2`,
  [SOURCE_KEY, ROBINHOOD.chainId]);
  const checkpointText = checkpointResult.rows?.[0]?.block;
  const checkpoint = typeof checkpointText === "string" && /^(?:0|[1-9][0-9]*)$/.test(checkpointText)
    ? BigInt(checkpointText) : null;
  const first = checkpoint === null
    ? (confirmed >= BOOTSTRAP_BLOCKS ? confirmed - BOOTSTRAP_BLOCKS + 1n : 0n)
    : checkpoint > CONFIRMATIONS ? checkpoint - CONFIRMATIONS + 1n : 0n;
  const logs = [];
  for (let fromBlock = first; fromBlock <= confirmed; fromBlock += CHUNK) {
    const toBlock = fromBlock + CHUNK - 1n < confirmed ? fromBlock + CHUNK - 1n : confirmed;
    logs.push(...await readLogsWithBackoff(client, { address: V2_SEADROP,
      event: PUBLIC_DROP_UPDATED, fromBlock, toBlock }, pause));
    if (toBlock < confirmed) await pause(250);
  }
  const existing = await pool.query(`SELECT opportunity.collection_contract,
      source.source_identity AS update_transaction_hash,
      source.evidence->>'updateBlockNumber' AS update_block_number,
      source.evidence->>'updateBlockHash' AS update_block_hash
    FROM broker_v2_opportunities opportunity
    JOIN LATERAL (SELECT source_identity, evidence
      FROM broker_v2_opportunity_sources
      WHERE opportunity_id = opportunity.opportunity_id
        AND source_kind = 'ROBINHOOD_SEADROP_EVENT'
      ORDER BY discovered_at DESC LIMIT 1) source ON TRUE
    WHERE opportunity.chain_id = $1 AND opportunity.adapter_address = $2
      AND (expires_at IS NULL OR expires_at > $3) ORDER BY updated_at DESC LIMIT $4`,
  [ROBINHOOD.chainId, V2_SEADROP_ADAPTER, new Date(now).toISOString(), maximum]);
  const candidates = new Map((existing.rows ?? []).filter((row) => (
    /^0x[0-9a-f]{64}$/.test(String(row.update_transaction_hash ?? ""))
      && /^0x[0-9a-f]{64}$/.test(String(row.update_block_hash ?? ""))
      && /^(?:0|[1-9][0-9]*)$/.test(String(row.update_block_number ?? ""))
  )).map((row) => [String(row.collection_contract).toLowerCase(), {
    collection: String(row.collection_contract).toLowerCase(),
    blockNumber: BigInt(row.update_block_number), blockHash: row.update_block_hash,
    transactionHash: row.update_transaction_hash,
  }]));
  for (const log of logs) {
    const collection = String(log.args.nftContract).toLowerCase();
    const prior = candidates.get(collection);
    if (!prior || BigInt(log.blockNumber) >= BigInt(prior.blockNumber)) candidates.set(collection, {
      collection, blockNumber: BigInt(log.blockNumber), blockHash: String(log.blockHash).toLowerCase(),
      transactionHash: String(log.transactionHash).toLowerCase(), previousUpdatedAt: null,
    });
  }
  const pinned = await client.getBlock({ blockNumber: confirmed });
  const [seaDropCode, adapterCode] = await Promise.all([
    client.getCode({ address: V2_SEADROP, blockNumber: confirmed }),
    client.getCode({ address: V2_SEADROP_ADAPTER, blockNumber: confirmed }),
  ]);
  const observations = [];
  for (const candidate of [...candidates.values()].slice(0, maximum)) {
    const [drop, collectionCode, adapterRegistered, name, maxSupply, totalSupply] = await Promise.all([
      client.readContract({ address: V2_SEADROP, abi: ABI, functionName: "getPublicDrop",
        args: [candidate.collection], blockNumber: confirmed }),
      client.getCode({ address: candidate.collection, blockNumber: confirmed }),
      optionalRead(client, { address: V2_ADAPTER_REGISTRY, abi: ABI,
        functionName: "validateAdapter", args: [V2_SEADROP_ADAPTER, 1, V2_SEADROP,
          V2_SEADROP_ADAPTER_CODE_HASH], blockNumber: confirmed }, false),
      optionalRead(client, { address: candidate.collection, abi: ABI, functionName: "name",
        blockNumber: confirmed }, "Unknown SeaDrop collection"),
      optionalRead(client, { address: candidate.collection, abi: ABI, functionName: "maxSupply",
        blockNumber: confirmed }, null),
      optionalRead(client, { address: candidate.collection, abi: ABI, functionName: "totalSupply",
        blockNumber: confirmed }, null),
    ]);
    const feeRecipientAllowed = drop.restrictFeeRecipients
      ? await optionalRead(client, { address: V2_SEADROP, abi: ABI,
        functionName: "getFeeRecipientIsAllowed",
        args: [candidate.collection, V2_OPEN_SEA_FEE_RECIPIENT], blockNumber: confirmed }, false)
      : true;
    const safeMaxSupply = maxSupply !== null && BigInt(maxSupply) <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(maxSupply) : null;
    const safeTotalSupply = totalSupply !== null
      && BigInt(totalSupply) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(totalSupply) : null;
    observations.push(Object.freeze({ collection: candidate.collection,
      updateBlockNumber: candidate.blockNumber.toString(),
      updateBlockHash: candidate.blockHash ?? String(pinned.hash).toLowerCase(),
      updateTransactionHash: candidate.transactionHash,
      pinnedBlockNumber: confirmed.toString(), pinnedBlockHash: String(pinned.hash).toLowerCase(),
      checkedAt: new Date(now).toISOString(), collectionName: String(name),
      maxSupply: safeMaxSupply, totalSupply: safeTotalSupply,
      drop: { priceWei: BigInt(drop.mintPrice).toString(),
        startTime: BigInt(drop.startTime).toString(), endTime: BigInt(drop.endTime).toString(),
        walletLimit: Number(drop.maxTotalMintableByWallet),
        restrictFeeRecipients: drop.restrictFeeRecipients },
      contracts: { seaDropCodeHash: keccak256(seaDropCode ?? "0x"),
        adapterCodeHash: keccak256(adapterCode ?? "0x"),
        collectionCodeHash: keccak256(collectionCode ?? "0x") },
      adapterRegistered, feeRecipientAllowed }));
  }
  return Object.freeze({ sourceKey: SOURCE_KEY, head: head.toString(),
    confirmedBlock: confirmed.toString(), observations: Object.freeze(observations) });
}

export async function advanceRobinhoodDiscoveryCheckpoint(pool, confirmedBlock) {
  const block = String(confirmedBlock);
  if (!pool || typeof pool.query !== "function" || !/^(?:0|[1-9][0-9]*)$/.test(block)) {
    throw new TypeError("Robinhood discovery checkpoint is invalid");
  }
  await pool.query(`INSERT INTO broker_v2_discovery_checkpoints
    (source_key, chain_id, indexed_through_block, updated_at) VALUES ($1, $2, $3, NOW())
    ON CONFLICT (source_key, chain_id) DO UPDATE SET indexed_through_block =
      GREATEST(broker_v2_discovery_checkpoints.indexed_through_block,
        EXCLUDED.indexed_through_block), updated_at = NOW()`,
  [SOURCE_KEY, ROBINHOOD.chainId, block]);
}
