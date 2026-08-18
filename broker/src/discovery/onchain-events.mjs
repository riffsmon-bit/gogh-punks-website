import { ROBINHOOD, normalizeAddress } from "../config.mjs";

export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const TRANSFER_SINGLE_TOPIC =
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";

function hexBlock(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function topicUint(topic) {
  return BigInt(topic).toString();
}

function topicAddress(topic) {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) {
    throw new TypeError("invalid address topic");
  }
  return normalizeAddress(`0x${topic.slice(-40)}`);
}

function dataWord(data, index) {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data)) {
    throw new TypeError("invalid event data");
  }
  const start = 2 + index * 64;
  const word = data.slice(start, start + 64);
  if (word.length !== 64) throw new TypeError("missing event data word");
  return BigInt(`0x${word}`).toString();
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class RobinhoodTransferSource {
  constructor({ rpc, confirmations = 20, maximumBlockRange = 2_000 }) {
    if (typeof rpc !== "function") throw new TypeError("rpc must be a function");
    this.name = "ROBINHOOD_TRANSFER_LOGS";
    this.rpc = rpc;
    this.confirmations = BigInt(confirmations);
    this.maximumBlockRange = BigInt(maximumBlockRange);
    if (this.confirmations < 0n) throw new RangeError("confirmations cannot be negative");
    if (this.maximumBlockRange <= 0n) throw new RangeError("maximumBlockRange must be positive");
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
      throw new RangeError("invalid or excessive discovery block range");
    }
    const logs = await this.rpc("eth_getLogs", [
      {
        fromBlock: hexBlock(start),
        toBlock: hexBlock(end),
        topics: [[TRANSFER_TOPIC, TRANSFER_SINGLE_TOPIC]],
      },
    ]);
    return logs.flatMap((log) => {
      const signature = log.topics?.[0]?.toLowerCase();
      if (log.topics?.length < 4) return [];
      let from;
      let to;
      let tokenId;
      let assetAmount = "1";
      let assetStandard;
      if (signature === TRANSFER_TOPIC) {
        from = topicAddress(log.topics[1]);
        to = topicAddress(log.topics[2]);
        tokenId = topicUint(log.topics[3]);
        assetStandard = "ERC721";
      } else if (signature === TRANSFER_SINGLE_TOPIC) {
        from = topicAddress(log.topics[2]);
        to = topicAddress(log.topics[3]);
        tokenId = dataWord(log.data, 0);
        assetAmount = dataWord(log.data, 1);
        assetStandard = "ERC1155";
      } else {
        return [];
      }
      if (to === ZERO_ADDRESS) return [];
      const mintSignal = from === ZERO_ADDRESS;
      return [
        {
          id: `${ROBINHOOD.chainId}:${log.transactionHash.toLowerCase()}:${Number(BigInt(log.logIndex))}`,
          chainId: ROBINHOOD.chainId,
          collection: normalizeAddress(log.address),
          tokenId,
          opportunityType: mintSignal
            ? assetStandard === "ERC721" ? "MINT" : "EDITION"
            : "SECONDARY_BUY",
          source: this.name,
          discoveredAt: new Date(now).toISOString(),
          metadata: {
            transactionHash: log.transactionHash.toLowerCase(),
            blockNumber: BigInt(log.blockNumber).toString(),
            observedTransfer: true,
            mintSignal,
            assetStandard,
            assetAmount,
            from,
            to,
          },
          riskLabel: "UNKNOWN",
          recommendation: "RESEARCH",
        },
      ];
    });
  }
}
