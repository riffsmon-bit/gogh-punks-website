import { getDatabase } from "@netlify/database";
import {
  GOGH_PUNKS_CHAIN_ID,
  GOGH_PUNKS_COLLECTION,
  TRANSFER_TOPIC,
  buildDiscordSaleMessage,
  decodeReceiptSales,
} from "./_shared/sales-feed.mjs";
import {
  backgroundRpcDecision, logBackgroundRpcSkip,
} from "./_shared/background-rpc-policy.mjs";

const FEED_KEY = "gogh-punks-opensea-native-v1";
const EXPECTED_GUILD_ID = "1535718970471219232";
const DEFAULT_SALES_CHANNEL_ID = "1538732801036263514";
const OFFICIAL_ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com/";
const CONFIRMATIONS = 8;
const MAX_BLOCKS_PER_RUN = 2_000;
const MAX_BLOCKS_PER_QUERY = 500;
const MAX_RECEIPTS_PER_RUN = 100;
const MAX_POSTS_PER_RUN = 5;
const FEED_LOCK_ID = 4_663_721;
const DISCORD_API = "https://discord.com/api/v10";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function getSettings() {
  const chainId = Number(process.env.CHAIN_ID ?? GOGH_PUNKS_CHAIN_ID);
  if (chainId !== GOGH_PUNKS_CHAIN_ID) {
    throw new Error(`CHAIN_ID must remain ${GOGH_PUNKS_CHAIN_ID}.`);
  }
  const guildId = process.env.DISCORD_GUILD_ID?.trim() || EXPECTED_GUILD_ID;
  if (guildId !== EXPECTED_GUILD_ID) {
    throw new Error(`DISCORD_GUILD_ID must remain ${EXPECTED_GUILD_ID}.`);
  }
  const channelId =
    process.env.DISCORD_SALES_CHANNEL_ID?.trim() || DEFAULT_SALES_CHANNEL_ID;
  if (!/^\d{17,20}$/.test(channelId)) {
    throw new Error("DISCORD_SALES_CHANNEL_ID is invalid.");
  }
  const rpcUrl = new URL(required("RPC_URL"));
  if (rpcUrl.protocol !== "https:") throw new Error("RPC_URL must use HTTPS.");
  return {
    rpcUrls: [...new Set([rpcUrl.toString(), OFFICIAL_ROBINHOOD_RPC])],
    botToken: required("DISCORD_BOT_TOKEN"),
    guildId,
    channelId,
  };
}

let rpcId = 0;
async function rpcRequest(url, method, params) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`JSON-RPC ${body.error.code}`);
    return body.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function rpc(urls, method, params) {
  const failures = [];
  for (const url of urls) {
    try {
      return await rpcRequest(url, method, params);
    } catch (error) {
      failures.push(String(error?.message ?? error));
    }
  }
  throw new Error(`RPC ${method} unavailable (${failures.join("; ").slice(0, 160)}).`);
}

function fromHex(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`${label} is not valid hexadecimal.`);
  }
  const number = BigInt(value);
  if (number > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the safe integer range.`);
  }
  return Number(number);
}

function blockHex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

async function mapLimit(values, limit, callback) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      results[index] = await callback(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

async function discordFetch(path, options, botToken) {
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Discord ${response.status}: ${detail.slice(0, 240)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function validateDiscordChannel({ channelId, guildId, botToken }) {
  const channel = await discordFetch(`/channels/${channelId}`, {}, botToken);
  if (channel.id !== channelId || channel.guild_id !== guildId || channel.type !== 0) {
    throw new Error("Configured Discord sales channel is not a guild text channel.");
  }
}

function markerFromMessage(message) {
  for (const embed of message.embeds ?? []) {
    const marker = embed.footer?.text;
    if (/^GOGH_SALE:[0-9a-f]{64}$/.test(marker ?? "")) return marker.slice(10);
  }
  return null;
}

async function postPendingSales(client, settings) {
  const pending = await client.query(
    `SELECT event_id, transaction_hash, block_number, block_hash,
            order_log_index, transfer_log_index, order_hash, token_id,
            seller, buyer, amount_wei, detected_at
       FROM discord_sales_events
      WHERE discord_message_id IS NULL
      ORDER BY block_number ASC, order_log_index ASC
      LIMIT $1`,
    [MAX_POSTS_PER_RUN],
  );
  if (pending.rows.length === 0) return { posted: 0, failed: 0, reconciled: 0 };

  await validateDiscordChannel(settings);
  const recent = await discordFetch(
    `/channels/${settings.channelId}/messages?limit=50`,
    {},
    settings.botToken,
  );
  const existing = new Map(
    recent
      .map((message) => [markerFromMessage(message), message.id])
      .filter(([marker]) => marker),
  );

  let posted = 0;
  let failed = 0;
  let reconciled = 0;
  for (const row of pending.rows) {
    const existingMessageId = existing.get(row.event_id.trim());
    if (existingMessageId) {
      await client.query(
        `UPDATE discord_sales_events
            SET discord_message_id = $2, posted_at = COALESCE(posted_at, NOW()),
                last_post_error = NULL
          WHERE event_id = $1 AND discord_message_id IS NULL`,
        [row.event_id, existingMessageId],
      );
      reconciled += 1;
      continue;
    }

    const sale = {
      eventId: row.event_id.trim(),
      transactionHash: row.transaction_hash.trim(),
      tokenId: row.token_id,
      seller: row.seller.trim(),
      buyer: row.buyer.trim(),
      amountWei: row.amount_wei,
      amountEth: formatEth(row.amount_wei),
    };
    try {
      const message = await discordFetch(
        `/channels/${settings.channelId}/messages`,
        { method: "POST", body: JSON.stringify(buildDiscordSaleMessage(sale, row.detected_at)) },
        settings.botToken,
      );
      await client.query(
        `UPDATE discord_sales_events
            SET discord_message_id = $2, posted_at = NOW(),
                post_attempts = post_attempts + 1, last_post_error = NULL
          WHERE event_id = $1 AND discord_message_id IS NULL`,
        [row.event_id, message.id],
      );
      posted += 1;
    } catch (error) {
      await client.query(
        `UPDATE discord_sales_events
            SET post_attempts = post_attempts + 1, last_post_error = $2
          WHERE event_id = $1`,
        [row.event_id, String(error?.message ?? error).slice(0, 500)],
      );
      failed += 1;
      break;
    }
  }
  return { posted, failed, reconciled };
}

function formatEth(amountWei) {
  const wei = BigInt(amountWei);
  const whole = wei / 1_000_000_000_000_000_000n;
  const fraction = (wei % 1_000_000_000_000_000_000n)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function insertSalesAndAdvance(client, sales, toBlock, toBlockHash) {
  await client.query("BEGIN");
  try {
    let inserted = 0;
    for (const sale of sales) {
      const result = await client.query(
        `INSERT INTO discord_sales_events
          (event_id, chain_id, collection_address, transaction_hash,
           block_number, block_hash, order_log_index, transfer_log_index,
           order_hash, token_id, seller, buyer, amount_wei)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT DO NOTHING`,
        [
          sale.eventId,
          sale.chainId,
          sale.collectionAddress,
          sale.transactionHash,
          sale.blockNumber,
          sale.blockHash,
          sale.orderLogIndex,
          sale.transferLogIndex,
          sale.orderHash,
          sale.tokenId,
          sale.seller,
          sale.buyer,
          sale.amountWei,
        ],
      );
      inserted += result.rowCount;
    }
    await client.query(
      `UPDATE discord_sales_feed_state
          SET last_scanned_block = $2, last_scanned_block_hash = $3,
              updated_at = NOW()
        WHERE feed_key = $1`,
      [FEED_KEY, toBlock, toBlockHash],
    );
    await client.query("COMMIT");
    return inserted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runSalesFeed() {
  const settings = getSettings();
  const client = await getDatabase().pool.connect();
  let locked = false;
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [FEED_LOCK_ID],
    );
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return { skipped: "already_running" };

    const rpcChainId = fromHex(
      await rpc(settings.rpcUrls, "eth_chainId", []),
      "RPC chain ID",
    );
    if (rpcChainId !== GOGH_PUNKS_CHAIN_ID) {
      throw new Error(`RPC is connected to chain ${rpcChainId}, not ${GOGH_PUNKS_CHAIN_ID}.`);
    }

    const head = fromHex(await rpc(settings.rpcUrls, "eth_blockNumber", []), "head block");
    const confirmedHead = Math.max(0, head - CONFIRMATIONS);
    const stateResult = await client.query(
      `SELECT last_scanned_block, last_scanned_block_hash
         FROM discord_sales_feed_state
        WHERE feed_key = $1`,
      [FEED_KEY],
    );

    if (!stateResult.rows[0]) {
      const block = await rpc(settings.rpcUrls, "eth_getBlockByNumber", [blockHex(confirmedHead), false]);
      if (!block?.hash) throw new Error("RPC did not return the initialization block.");
      await client.query(
        `INSERT INTO discord_sales_feed_state
          (feed_key, chain_id, collection_address, last_scanned_block,
           last_scanned_block_hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (feed_key) DO NOTHING`,
        [FEED_KEY, GOGH_PUNKS_CHAIN_ID, GOGH_PUNKS_COLLECTION, confirmedHead, block.hash.toLowerCase()],
      );
      return { initializedAt: confirmedHead, confirmations: CONFIRMATIONS };
    }

    const lastBlock = Number(stateResult.rows[0].last_scanned_block);
    const previous = await rpc(settings.rpcUrls, "eth_getBlockByNumber", [blockHex(lastBlock), false]);
    if (!previous?.hash || previous.hash.toLowerCase() !== stateResult.rows[0].last_scanned_block_hash.trim()) {
      throw new Error(`Confirmed cursor block ${lastBlock} changed; feed halted for reorg review.`);
    }

    let scanned = 0;
    let discovered = 0;
    let inserted = 0;
    let cursor = lastBlock;
    while (cursor < confirmedHead && scanned < MAX_BLOCKS_PER_RUN) {
      const remainingCapacity = MAX_BLOCKS_PER_RUN - scanned;
      const toBlock = Math.min(
        confirmedHead,
        cursor + Math.min(MAX_BLOCKS_PER_QUERY, remainingCapacity),
      );
      const logs = await rpc(settings.rpcUrls, "eth_getLogs", [
        {
          address: GOGH_PUNKS_COLLECTION,
          fromBlock: blockHex(cursor + 1),
          toBlock: blockHex(toBlock),
          topics: [TRANSFER_TOPIC],
        },
      ]);
      const transactionHashes = [...new Set(logs.map((log) => log.transactionHash?.toLowerCase()).filter(Boolean))];
      if (transactionHashes.length > MAX_RECEIPTS_PER_RUN) {
        throw new Error(`Block window contains ${transactionHashes.length} NFT transactions; safe limit is ${MAX_RECEIPTS_PER_RUN}.`);
      }
      const receipts = await mapLimit(transactionHashes, 8, (hash) =>
        rpc(settings.rpcUrls, "eth_getTransactionReceipt", [hash]),
      );
      const sales = receipts.flatMap(decodeReceiptSales);
      const finalBlock = await rpc(settings.rpcUrls, "eth_getBlockByNumber", [blockHex(toBlock), false]);
      if (!finalBlock?.hash) throw new Error("RPC did not return the final scanned block.");
      inserted += await insertSalesAndAdvance(client, sales, toBlock, finalBlock.hash.toLowerCase());
      scanned += toBlock - cursor;
      discovered += sales.length;
      cursor = toBlock;
    }

    const delivery = await postPendingSales(client, settings);
    return {
      scanned,
      confirmedHead,
      discovered,
      inserted,
      ...delivery,
    };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [FEED_LOCK_ID]);
    client.release();
  }
}

export default async function handler() {
  const decision = backgroundRpcDecision(process.env, "DISCORD_SALES_FEED");
  if (!decision.enabled) {
    logBackgroundRpcSkip(decision);
    return;
  }
  try {
    const result = await runSalesFeed();
    console.log(JSON.stringify({ event: "DISCORD_SALES_FEED", ...result }));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "DISCORD_SALES_FEED_ERROR",
        message: String(error?.message ?? error).slice(0, 500),
      }),
    );
    throw error;
  }
}

export const config = { schedule: "* * * * *" };
