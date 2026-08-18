import { decodeEventLog, getAddress, zeroAddress } from "viem";
import { ROBINHOOD, normalizeAddress } from "../config.mjs";

export const ROBINHOOD_SEAPORT =
  "0x0000000000000068f116a894984e2db1123eb395";
export const ORDER_FULFILLED_TOPIC =
  "0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31";

export const ORDER_FULFILLED_EVENT_ABI = Object.freeze({
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
});

function hexBlock(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function normalizedAddress(value) {
  try {
    return getAddress(value).toLowerCase();
  } catch {
    return null;
  }
}

function logIndex(value) {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(parsed);
  } catch {
    return null;
  }
}

function nftStandard(itemType) {
  if (Number(itemType) === 2) return "ERC721";
  if (Number(itemType) === 3) return "ERC1155";
  return null;
}

function currencyAddress(item) {
  if (Number(item.itemType) === 0 && normalizedAddress(item.token) === zeroAddress) {
    return zeroAddress;
  }
  if (Number(item.itemType) === 1) return normalizedAddress(item.token);
  return null;
}

/**
 * Treat a completed Seaport order as a collection-research signal, never as an
 * active listing. Only a single offered NFT with one consistent payment
 * currency is normalized; bundles and ambiguous consideration fail closed.
 */
export function decodeSeaportActivityLog(log, discoveredAt = new Date()) {
  if (normalizedAddress(log?.address) !== ROBINHOOD_SEAPORT) return null;
  if (log?.topics?.[0]?.toLowerCase() !== ORDER_FULFILLED_TOPIC) return null;
  if (!/^0x[0-9a-f]{64}$/i.test(log.transactionHash ?? "")) return null;

  let args;
  try {
    ({ args } = decodeEventLog({
      abi: [ORDER_FULFILLED_EVENT_ABI],
      eventName: "OrderFulfilled",
      data: log.data,
      topics: log.topics,
      strict: true,
    }));
  } catch {
    return null;
  }

  if (args.offer.length !== 1 || args.consideration.length === 0) return null;
  const offered = args.offer[0];
  const assetStandard = nftStandard(offered.itemType);
  if (!assetStandard || offered.amount <= 0n) return null;
  if (assetStandard === "ERC721" && offered.amount !== 1n) return null;

  const currencies = args.consideration.map(currencyAddress);
  if (currencies.some((currency) => !currency)) return null;
  if (currencies.some((currency) => currency !== currencies[0])) return null;
  if (args.consideration.some((item) => item.amount <= 0n)) return null;

  const seller = normalizedAddress(args.offerer);
  const buyer = normalizedAddress(args.recipient);
  const collection = normalizedAddress(offered.token);
  const index = logIndex(log.logIndex);
  if (
    !seller || !buyer || !collection || index === null || seller === buyer
      || seller === zeroAddress || buyer === zeroAddress
  ) return null;

  const salePrice = args.consideration.reduce((total, item) => total + item.amount, 0n);
  let observedBlock;
  let observedAt;
  try {
    observedBlock = BigInt(log.blockNumber).toString();
    observedAt = new Date(discoveredAt);
    if (Number.isNaN(observedAt.getTime())) return null;
  } catch {
    return null;
  }
  return Object.freeze({
    id: `${ROBINHOOD.chainId}:seaport:${log.transactionHash.toLowerCase()}:${index}`,
    chainId: ROBINHOOD.chainId,
    collection,
    tokenId: offered.identifier.toString(),
    opportunityType: "SECONDARY_BUY",
    source: "ROBINHOOD_SEAPORT_ACTIVITY",
    salePrice: salePrice.toString(),
    currency: currencies[0],
    marketplace: ROBINHOOD_SEAPORT,
    discoveredAt: observedAt.toISOString(),
    metadata: Object.freeze({
      historicalSaleSignal: true,
      actionableListing: false,
      settlementVerified: true,
      transactionHash: log.transactionHash.toLowerCase(),
      blockNumber: observedBlock,
      logIndex: index,
      orderHash: args.orderHash.toLowerCase(),
      seller,
      buyer,
      assetStandard,
      assetAmount: offered.amount.toString(),
    }),
    riskLabel: "UNKNOWN",
    recommendation: "RESEARCH",
  });
}

export class RobinhoodSeaportActivitySource {
  constructor({
    rpc,
    confirmations = 20,
    maximumBlockRange = 2_000,
    maximumHeaderRequests = 64,
    headerConcurrency = 4,
  }) {
    if (typeof rpc !== "function") throw new TypeError("rpc must be a function");
    this.name = "ROBINHOOD_SEAPORT_ACTIVITY";
    this.rpc = rpc;
    this.confirmations = BigInt(confirmations);
    this.maximumBlockRange = BigInt(maximumBlockRange);
    this.maximumHeaderRequests = Number(maximumHeaderRequests);
    this.headerConcurrency = Number(headerConcurrency);
    if (this.confirmations < 0n) throw new RangeError("confirmations cannot be negative");
    if (this.maximumBlockRange <= 0n) throw new RangeError("maximumBlockRange must be positive");
    if (
      !Number.isSafeInteger(this.maximumHeaderRequests)
      || this.maximumHeaderRequests < 1
      || this.maximumHeaderRequests > 512
    ) throw new RangeError("maximumHeaderRequests must be between 1 and 512");
    if (
      !Number.isSafeInteger(this.headerConcurrency)
      || this.headerConcurrency < 1
      || this.headerConcurrency > 8
    ) throw new RangeError("headerConcurrency must be between 1 and 8");
  }

  async discover({ fromBlock, toBlock, now = new Date() }) {
    const remoteChainId = Number(BigInt(await this.rpc("eth_chainId", [])));
    if (remoteChainId !== ROBINHOOD.chainId) {
      throw new Error(`RPC chain mismatch: expected ${ROBINHOOD.chainId}, received ${remoteChainId}`);
    }
    const head = BigInt(await this.rpc("eth_blockNumber", []));
    const safeHead = head > this.confirmations ? head - this.confirmations : 0n;
    const start = BigInt(fromBlock ?? safeHead);
    const requestedEnd = BigInt(toBlock ?? safeHead);
    const end = requestedEnd < safeHead ? requestedEnd : safeHead;
    if (end < start || end - start + 1n > this.maximumBlockRange) {
      throw new RangeError("invalid or excessive Seaport discovery block range");
    }

    const logs = await this.rpc("eth_getLogs", [
      {
        address: ROBINHOOD_SEAPORT,
        fromBlock: hexBlock(start),
        toBlock: hexBlock(end),
        topics: [ORDER_FULFILLED_TOPIC],
      },
    ]);
    const blockNumbers = [...new Set(logs.map((log) => BigInt(log.blockNumber).toString()))];
    if (blockNumbers.length > this.maximumHeaderRequests) {
      throw new RangeError("Seaport discovery requires too many block headers");
    }
    const headers = new Map();
    let cursor = 0;
    const worker = async () => {
      while (cursor < blockNumbers.length) {
        const index = cursor;
        cursor += 1;
        const number = blockNumbers[index];
        const block = await this.rpc("eth_getBlockByNumber", [hexBlock(number), false]);
        if (
          !block
          || BigInt(block.number) !== BigInt(number)
          || !/^0x[0-9a-fA-F]{64}$/.test(block.hash ?? "")
        ) throw new TypeError("invalid Seaport source block header");
        const timestamp = BigInt(block.timestamp);
        if (timestamp < 0n || timestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new TypeError("invalid Seaport source block timestamp");
        }
        const occurredAt = new Date(Number(timestamp) * 1_000);
        if (Number.isNaN(occurredAt.getTime())) {
          throw new TypeError("invalid Seaport source block timestamp");
        }
        headers.set(number, Object.freeze({
          hash: block.hash.toLowerCase(),
          occurredAt,
        }));
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(this.headerConcurrency, blockNumbers.length) },
        () => worker(),
      ),
    );
    return logs.map((log) => {
      const header = headers.get(BigInt(log.blockNumber).toString());
      if (!header || header.hash !== String(log.blockHash).toLowerCase()) {
        throw new Error("Seaport log does not match its canonical block header");
      }
      return decodeSeaportActivityLog(log, header.occurredAt);
    }).filter(Boolean);
  }
}
