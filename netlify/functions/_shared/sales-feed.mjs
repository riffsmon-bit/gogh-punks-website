import { createHash } from "node:crypto";
import { decodeEventLog, formatEther, getAddress, zeroAddress } from "viem";

export const GOGH_PUNKS_CHAIN_ID = 4663;
export const GOGH_PUNKS_COLLECTION =
  "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
export const ROBINHOOD_SEAPORT =
  "0x0000000000000068f116a894984e2db1123eb395";
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const ORDER_FULFILLED_TOPIC =
  "0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31";

export const orderFulfilledEventAbi = {
  type: "event",
  name: "OrderFulfilled",
  anonymous: false,
  inputs: [
    { name: "orderHash", type: "bytes32", indexed: false },
    { name: "offerer", type: "address", indexed: true },
    { name: "zone", type: "address", indexed: true },
    { name: "recipient", type: "address", indexed: false },
    {
      name: "offer",
      type: "tuple[]",
      indexed: false,
      components: [
        { name: "itemType", type: "uint8" },
        { name: "token", type: "address" },
        { name: "identifier", type: "uint256" },
        { name: "amount", type: "uint256" },
      ],
    },
    {
      name: "consideration",
      type: "tuple[]",
      indexed: false,
      components: [
        { name: "itemType", type: "uint8" },
        { name: "token", type: "address" },
        { name: "identifier", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "recipient", type: "address" },
      ],
    },
  ],
};

function normalizedAddress(value) {
  try {
    return getAddress(value).toLowerCase();
  } catch {
    return null;
  }
}

function hexInteger(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  const integer = BigInt(value);
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(integer);
}

function topicAddress(topic) {
  if (typeof topic !== "string" || !/^0x[0-9a-f]{64}$/i.test(topic)) return null;
  return normalizedAddress(`0x${topic.slice(-40)}`);
}

function matchingTransfer(logs, { seller, buyer, tokenId }) {
  return logs.find((log) => {
    if (normalizedAddress(log.address) !== GOGH_PUNKS_COLLECTION) return false;
    if (log.topics?.length !== 4) return false;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return false;
    if (topicAddress(log.topics[1]) !== seller) return false;
    if (topicAddress(log.topics[2]) !== buyer) return false;
    try {
      return BigInt(log.topics[3]) === tokenId;
    } catch {
      return false;
    }
  });
}

function saleEventId(transactionHash, orderLogIndex, tokenId) {
  return createHash("sha256")
    .update(
      [
        GOGH_PUNKS_CHAIN_ID,
        GOGH_PUNKS_COLLECTION,
        transactionHash.toLowerCase(),
        orderLogIndex,
        tokenId.toString(),
      ].join(":"),
    )
    .digest("hex");
}

/**
 * Decode only native-token OpenSea sales whose receipt also contains the exact
 * ERC-721 transfer described by the Seaport order. Transfers, mints, burns,
 * bundles, ERC-20 bids, and unrelated marketplace calls fail closed.
 */
export function decodeReceiptSales(receipt) {
  if (!receipt || receipt.status !== "0x1" || !Array.isArray(receipt.logs)) return [];
  if (!/^0x[0-9a-f]{64}$/i.test(receipt.transactionHash ?? "")) return [];
  if (!/^0x[0-9a-f]{64}$/i.test(receipt.blockHash ?? "")) return [];

  const blockNumber = hexInteger(receipt.blockNumber);
  if (blockNumber === null) return [];

  const sales = [];
  for (const log of receipt.logs) {
    if (normalizedAddress(log.address) !== ROBINHOOD_SEAPORT) continue;
    if (log.topics?.[0]?.toLowerCase() !== ORDER_FULFILLED_TOPIC) continue;

    let args;
    try {
      ({ args } = decodeEventLog({
        abi: [orderFulfilledEventAbi],
        eventName: "OrderFulfilled",
        data: log.data,
        topics: log.topics,
        strict: true,
      }));
    } catch {
      continue;
    }

    const nftItems = args.offer.filter(
      (item) =>
        Number(item.itemType) === 2 &&
        normalizedAddress(item.token) === GOGH_PUNKS_COLLECTION &&
        item.amount === 1n,
    );
    if (args.offer.length !== 1 || nftItems.length !== 1) continue;
    if (!Array.isArray(args.consideration) || args.consideration.length === 0) continue;

    const allNative = args.consideration.every(
      (item) =>
        Number(item.itemType) === 0 &&
        normalizedAddress(item.token) === zeroAddress,
    );
    if (!allNative) continue;

    const amountWei = args.consideration.reduce((total, item) => total + item.amount, 0n);
    if (amountWei <= 0n) continue;

    const seller = normalizedAddress(args.offerer);
    const buyer = normalizedAddress(args.recipient);
    if (!seller || !buyer || seller === buyer || buyer === zeroAddress) continue;

    const tokenId = nftItems[0].identifier;
    const transfer = matchingTransfer(receipt.logs, { seller, buyer, tokenId });
    if (!transfer) continue;

    const orderLogIndex = hexInteger(log.logIndex);
    const transferLogIndex = hexInteger(transfer.logIndex);
    if (orderLogIndex === null || transferLogIndex === null) continue;

    sales.push({
      eventId: saleEventId(receipt.transactionHash, orderLogIndex, tokenId),
      chainId: GOGH_PUNKS_CHAIN_ID,
      collectionAddress: GOGH_PUNKS_COLLECTION,
      marketplaceAddress: ROBINHOOD_SEAPORT,
      transactionHash: receipt.transactionHash.toLowerCase(),
      blockNumber,
      blockHash: receipt.blockHash.toLowerCase(),
      orderLogIndex,
      transferLogIndex,
      orderHash: args.orderHash.toLowerCase(),
      tokenId: tokenId.toString(),
      seller,
      buyer,
      amountWei: amountWei.toString(),
      amountEth: formatEther(amountWei),
    });
  }
  return sales;
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function buildDiscordSaleMessage(sale, detectedAt = new Date()) {
  const explorer = "https://robinhoodchain.blockscout.com";
  const assetUrl = `https://opensea.io/assets/robinhood/${GOGH_PUNKS_COLLECTION}/${sale.tokenId}`;
  const transactionUrl = `${explorer}/tx/${sale.transactionHash}`;
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        color: 0xf4bd4f,
        title: `GOGH PUNK SALE · #${sale.tokenId}`,
        url: assetUrl,
        description: `**${sale.amountEth} ETH** on OpenSea`,
        fields: [
          {
            name: "Buyer",
            value: `[${shortAddress(sale.buyer)}](${explorer}/address/${sale.buyer})`,
            inline: true,
          },
          {
            name: "Seller",
            value: `[${shortAddress(sale.seller)}](${explorer}/address/${sale.seller})`,
            inline: true,
          },
          {
            name: "On-chain proof",
            value: `[View transaction](${transactionUrl}) · [View NFT](${assetUrl})`,
            inline: false,
          },
        ],
        footer: { text: `GOGH_SALE:${sale.eventId}` },
        timestamp: detectedAt.toISOString(),
      },
    ],
  };
}
