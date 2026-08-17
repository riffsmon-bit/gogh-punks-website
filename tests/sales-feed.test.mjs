import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseEther,
  zeroAddress,
} from "viem";
import {
  GOGH_PUNKS_CHAIN_ID,
  GOGH_PUNKS_COLLECTION,
  ROBINHOOD_SEAPORT,
  buildDiscordSaleMessage,
  decodeReceiptSales,
  orderFulfilledEventAbi,
} from "../netlify/functions/_shared/sales-feed.mjs";

const seller = "0x1111111111111111111111111111111111111111";
const buyer = "0x2222222222222222222222222222222222222222";
const zone = "0x3333333333333333333333333333333333333333";
const fee = "0x4444444444444444444444444444444444444444";
const orderHash = `0x${"ab".repeat(32)}`;
const transactionHash = `0x${"cd".repeat(32)}`;
const blockHash = `0x${"ef".repeat(32)}`;
const tokenId = 317n;

const transferEventAbi = {
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
};

function fixture({ transferBuyer = buyer, includeOrder = true } = {}) {
  const offer = [
    {
      itemType: 2,
      token: GOGH_PUNKS_COLLECTION,
      identifier: tokenId,
      amount: 1n,
    },
  ];
  const consideration = [
    {
      itemType: 0,
      token: zeroAddress,
      identifier: 0n,
      amount: parseEther("0.0002925"),
      recipient: seller,
    },
    {
      itemType: 0,
      token: zeroAddress,
      identifier: 0n,
      amount: parseEther("0.0000075"),
      recipient: fee,
    },
  ];
  const orderTopics = encodeEventTopics({
    abi: [orderFulfilledEventAbi],
    eventName: "OrderFulfilled",
    args: { offerer: seller, zone },
  });
  const orderData = encodeAbiParameters(
    orderFulfilledEventAbi.inputs.filter((input) => !input.indexed),
    [orderHash, buyer, offer, consideration],
  );
  const transferTopics = encodeEventTopics({
    abi: [transferEventAbi],
    eventName: "Transfer",
    args: { from: seller, to: transferBuyer, tokenId },
  });
  const logs = [
    {
      address: GOGH_PUNKS_COLLECTION,
      topics: transferTopics,
      data: "0x",
      logIndex: "0x7",
    },
  ];
  if (includeOrder) {
    logs.push({
      address: ROBINHOOD_SEAPORT,
      topics: orderTopics,
      data: orderData,
      logIndex: "0x8",
    });
  }
  return {
    status: "0x1",
    transactionHash,
    blockHash,
    blockNumber: "0x1234",
    logs,
  };
}

test("decodes an exact native OpenSea sale and includes all consideration", () => {
  const sales = decodeReceiptSales(fixture());
  assert.equal(sales.length, 1);
  assert.equal(sales[0].chainId, GOGH_PUNKS_CHAIN_ID);
  assert.equal(sales[0].tokenId, "317");
  assert.equal(sales[0].seller, seller);
  assert.equal(sales[0].buyer, buyer);
  assert.equal(sales[0].amountEth, "0.0003");
  assert.match(sales[0].eventId, /^[0-9a-f]{64}$/);
});

test("rejects a gift transfer without a marketplace fulfillment", () => {
  assert.deepEqual(decodeReceiptSales(fixture({ includeOrder: false })), []);
});

test("rejects a fulfillment whose exact seller-to-buyer transfer is absent", () => {
  assert.deepEqual(decodeReceiptSales(fixture({ transferBuyer: fee })), []);
});

test("builds a no-mentions Discord embed with canonical proof links", () => {
  const sale = decodeReceiptSales(fixture())[0];
  const payload = buildDiscordSaleMessage(sale, new Date("2026-08-17T02:00:00Z"));
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.embeds[0].title, "GOGH PUNK SALE · #317");
  assert.match(payload.embeds[0].description, /0\.0003 ETH/);
  assert.match(payload.embeds[0].url, /opensea\.io\/assets\/robinhood/);
  assert.match(payload.embeds[0].fields[2].value, /robinhoodchain\.blockscout\.com\/tx/);
  assert.equal(payload.embeds[0].footer.text, `GOGH_SALE:${sale.eventId}`);
});

test("migration and scheduler enforce chain-qualified deduplication", async () => {
  const migration = await readFile(
    new URL("../netlify/database/migrations/20260817020000_create_discord_sales_feed.sql", import.meta.url),
    "utf8",
  );
  const handler = await readFile(
    new URL("../netlify/functions/discord-sales.mjs", import.meta.url),
    "utf8",
  );
  assert.match(migration, /UNIQUE \(chain_id, transaction_hash, order_log_index, collection_address\)/);
  assert.match(handler, /pg_try_advisory_lock/);
  assert.match(handler, /const CONFIRMATIONS = 8/);
  assert.match(handler, /const MAX_BLOCKS_PER_RUN = 2_000/);
  assert.match(handler, /schedule: "\* \* \* \* \*"/);
});
