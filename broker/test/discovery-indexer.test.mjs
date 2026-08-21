import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseEther,
  zeroAddress,
} from "viem";
import { DiscoveryEngine } from "../src/discovery/engine.mjs";
import {
  RobinhoodTransferSource,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
} from "../src/discovery/onchain-events.mjs";
import {
  ORDER_FULFILLED_EVENT_ABI,
  ORDER_FULFILLED_TOPIC,
  ROBINHOOD_SEAPORT,
  RobinhoodSeaportActivitySource,
  decodeSeaportActivityLog,
} from "../src/discovery/seaport-activity.mjs";
import { ReorgAwareIndexer, logId } from "../src/indexer/reorg-indexer.mjs";
import { RobinhoodJsonRpcSource } from "../src/indexer/json-rpc-source.mjs";
import { projectScoutLog } from "../src/indexer/opportunity-projection.mjs";
import { ACCOUNT_ACTIVATION_TOPIC, protocolStreams } from "../src/indexer/streams.mjs";
import { PostgresIndexerRepository } from "../../netlify/functions/broker/indexer-repository.mjs";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const BUYER = "0x3333333333333333333333333333333333333333";
const ZONE = "0x4444444444444444444444444444444444444444";
const FEE_RECIPIENT = "0x5555555555555555555555555555555555555555";

function seaportLog({
  offer = [{ itemType: 2, token: COLLECTION, identifier: 42n, amount: 1n }],
  consideration = [
    {
      itemType: 0,
      token: zeroAddress,
      identifier: 0n,
      amount: parseEther("0.0002925"),
      recipient: SELLER,
    },
    {
      itemType: 0,
      token: zeroAddress,
      identifier: 0n,
      amount: parseEther("0.0000075"),
      recipient: FEE_RECIPIENT,
    },
  ],
  address = ROBINHOOD_SEAPORT,
} = {}) {
  const topics = encodeEventTopics({
    abi: [ORDER_FULFILLED_EVENT_ABI],
    eventName: "OrderFulfilled",
    args: { offerer: SELLER, zone: ZONE },
  });
  const data = encodeAbiParameters(
    ORDER_FULFILLED_EVENT_ABI.inputs.filter((input) => !input.indexed),
    [`0x${"ab".repeat(32)}`, BUYER, offer, consideration],
  );
  return {
    address,
    transactionHash: `0x${"cd".repeat(32)}`,
    blockNumber: "0x50",
    blockHash: `0x${"ef".repeat(32)}`,
    blockTimestamp: "1786968000",
    logIndex: "0x7",
    topics,
    data,
  };
}

function candidate(overrides = {}) {
  return {
    id: "candidate-1",
    chainId: 4663,
    collection: COLLECTION,
    tokenId: 1,
    opportunityType: "MINT",
    discoveredAt: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}

function addressTopic(address) {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

function uint256Word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function transferMintLog({
  standard = "ERC721",
  from = zeroAddress,
  to = BUYER,
  tokenId = 42n,
  amount = 1n,
  data,
  topics,
  transactionHash = `0x${"aa".repeat(32)}`,
  logIndex = "0x2",
} = {}) {
  const resolvedTopics = topics ?? (standard === "ERC721"
    ? [
      TRANSFER_TOPIC,
      addressTopic(from),
      addressTopic(to),
      `0x${uint256Word(tokenId)}`,
    ]
    : [
      TRANSFER_SINGLE_TOPIC,
      addressTopic(SELLER),
      addressTopic(from),
      addressTopic(to),
    ]);
  const resolvedData = data ?? (standard === "ERC721"
    ? "0x"
    : `0x${uint256Word(tokenId)}${uint256Word(amount)}`);
  return {
    address: COLLECTION,
    transactionHash,
    blockNumber: "0x50",
    blockHash: `0x${"ef".repeat(32)}`,
    blockTimestamp: "1786968000",
    logIndex,
    topics: resolvedTopics,
    data: resolvedData,
  };
}

test("discovery isolates source failures and defaults execution eligibility off", async () => {
  const engine = new DiscoveryEngine({
    clock: () => new Date("2026-08-15T12:00:00.000Z"),
    sources: [
      { name: "GOOD", discover: async () => [candidate(), candidate()] },
      { name: "FAILED", discover: async () => { throw new Error("provider down"); } },
    ],
  });
  const result = await engine.scout();
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.opportunities[0].scoutable, true);
  assert.equal(result.opportunities[0].autonomousExecutionEligible, false);
  assert.deepEqual(result.failures, [{ source: "FAILED", error: "Error" }]);
});

test("transfer discovery verifies Robinhood and distinguishes ERC-721 and ERC-1155 mints", async () => {
  const topicAddress = (address) => `0x${"0".repeat(24)}${address.slice(2)}`;
  const recipient = "0x2222222222222222222222222222222222222222";
  const word = (value) => BigInt(value).toString(16).padStart(64, "0");
  const rpc = async (method) => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_blockNumber") return "0x64";
    if (method === "eth_getLogs") {
      return [
        {
          address: COLLECTION,
          transactionHash: `0x${"aa".repeat(32)}`,
          logIndex: "0x0",
          blockNumber: "0x50",
          topics: [
            TRANSFER_TOPIC,
            topicAddress("0x0000000000000000000000000000000000000000"),
            topicAddress(recipient),
            `0x${word(42)}`,
          ],
          data: "0x",
        },
        {
          address: COLLECTION,
          transactionHash: `0x${"bb".repeat(32)}`,
          logIndex: "0x1",
          blockNumber: "0x50",
          topics: [
            TRANSFER_SINGLE_TOPIC,
            topicAddress("0x3333333333333333333333333333333333333333"),
            topicAddress("0x0000000000000000000000000000000000000000"),
            topicAddress(recipient),
          ],
          data: `0x${word(7)}${word(5)}`,
        },
      ];
    }
    throw new Error("unexpected RPC method");
  };
  const source = new RobinhoodTransferSource({ rpc, confirmations: 20 });
  const opportunities = await source.discover({ fromBlock: 80, toBlock: 80 });
  assert.equal(opportunities[0].opportunityType, "MINT");
  assert.equal(opportunities[0].tokenId, "42");
  assert.equal(opportunities[0].metadata.blockNumber, "80");
  assert.equal(opportunities[1].opportunityType, "EDITION");
  assert.equal(opportunities[1].tokenId, "7");
  assert.equal(opportunities[1].metadata.assetAmount, "5");

  const wrongChain = new RobinhoodTransferSource({ rpc: async () => "0x1" });
  await assert.rejects(
    () => wrongChain.discover({ fromBlock: 0, toBlock: 0 }),
    /RPC chain mismatch/,
  );
});

test("Seaport Scout source normalizes completed native sales as non-actionable research", async () => {
  const observedFilters = [];
  const rpc = async (method, params) => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_blockNumber") return "0x64";
    if (method === "eth_getBlockByNumber") {
      return {
        number: params[0],
        hash: `0x${"ef".repeat(32)}`,
        timestamp: "0x6a82f7c0",
      };
    }
    if (method === "eth_getLogs") {
      observedFilters.push(params[0]);
      return [seaportLog()];
    }
    throw new Error("unexpected RPC method");
  };
  const source = new RobinhoodSeaportActivitySource({ rpc, confirmations: 20 });
  const engine = new DiscoveryEngine({
    sources: [source],
    clock: () => new Date("2026-08-17T12:00:00.000Z"),
  });
  const result = await engine.scout({ fromBlock: 80, toBlock: 80 });
  assert.equal(result.failures.length, 0);
  assert.equal(result.opportunities.length, 1);
  const activity = result.opportunities[0];
  assert.equal(activity.collection, COLLECTION);
  assert.equal(activity.tokenId, "42");
  assert.equal(activity.salePrice, parseEther("0.0003").toString());
  assert.equal(activity.currency, zeroAddress);
  assert.equal(activity.marketplace, ROBINHOOD_SEAPORT);
  assert.equal(activity.discoveredAt, "2026-08-17T12:00:00.000Z");
  assert.equal(activity.recommendation, "RESEARCH");
  assert.equal(activity.metadata.historicalSaleSignal, true);
  assert.equal(activity.metadata.actionableListing, false);
  assert.equal(activity.metadata.seller, SELLER);
  assert.equal(activity.metadata.buyer, BUYER);
  assert.equal(activity.autonomousExecutionEligible, false);
  assert.deepEqual(observedFilters[0], {
    address: ROBINHOOD_SEAPORT,
    fromBlock: "0x50",
    toBlock: "0x50",
    topics: [ORDER_FULFILLED_TOPIC],
  });
});

test("Seaport activity decoder rejects bundles, mixed currencies, and other emitters", () => {
  const bundle = seaportLog({
    offer: [
      { itemType: 2, token: COLLECTION, identifier: 42n, amount: 1n },
      { itemType: 2, token: COLLECTION, identifier: 43n, amount: 1n },
    ],
  });
  assert.equal(decodeSeaportActivityLog(bundle), null);

  const mixedCurrency = seaportLog({
    consideration: [
      {
        itemType: 0,
        token: zeroAddress,
        identifier: 0n,
        amount: 1n,
        recipient: SELLER,
      },
      {
        itemType: 1,
        token: FEE_RECIPIENT,
        identifier: 0n,
        amount: 1n,
        recipient: FEE_RECIPIENT,
      },
    ],
  });
  assert.equal(decodeSeaportActivityLog(mixedCurrency), null);
  assert.equal(
    decodeSeaportActivityLog(
      seaportLog({ address: "0x6666666666666666666666666666666666666666" }),
    ),
    null,
  );
  assert.equal(
    decodeSeaportActivityLog({ ...seaportLog(), blockNumber: "malformed" }),
    null,
  );
  assert.equal(decodeSeaportActivityLog(seaportLog(), "not-a-date"), null);
});

test("Seaport indexed logs project to historical Scout evidence, never an executable quote", () => {
  const projection = projectScoutLog({
    chainId: 4663,
    stream: "seaport_activity",
    record: seaportLog(),
    observedAt: new Date("2026-08-17T12:00:00.000Z"),
  });
  assert.equal(projection.collection.address, COLLECTION);
  assert.equal(projection.collection.standard, "ERC721");
  assert.equal(projection.opportunity.expectedPrice, "0");
  assert.equal(projection.opportunity.maximumPrice, "0");
  assert.equal(
    projection.opportunity.metadata.historicalSalePrice,
    parseEther("0.0003").toString(),
  );
  assert.equal(projection.opportunity.metadata.actionableListing, false);
  assert.equal(projection.opportunity.autonomousExecutionEligible, false);
  assert.equal(projection.opportunity.canonical, true);
  assert.equal(projection.opportunity.sourceBlockNumber, "80");
  assert.equal(projection.opportunity.sourceBlockTimestamp, "2026-08-17T12:00:00.000Z");
  assert.equal(projection.opportunity.sourceLogIndex, 7);
  assert.equal(
    projectScoutLog({ chainId: 1, stream: "seaport_activity", record: seaportLog() }),
    null,
  );
  assert.equal(
    projectScoutLog({ chainId: 4663, stream: "nft_transfers", record: seaportLog() }),
    null,
  );
  assert.equal(
    projectScoutLog({
      chainId: 4663,
      stream: "seaport_activity",
      record: { ...seaportLog(), blockHash: "0x01" },
    }),
    null,
  );
  assert.equal(
    projectScoutLog({
      chainId: 4663,
      stream: "seaport_activity",
      record: { ...seaportLog(), blockTimestamp: "not-a-timestamp" },
    }),
    null,
  );
});

test("indexed ERC-721 and ERC-1155 mint transfers become non-actionable Scout research", () => {
  const observedAt = new Date("2026-08-17T12:01:00.000Z");
  const erc721 = projectScoutLog({
    chainId: 4663,
    stream: "nft_transfers",
    record: transferMintLog(),
    observedAt,
  });
  assert.equal(erc721.collection.address, COLLECTION);
  assert.equal(erc721.collection.standard, "ERC721");
  assert.equal(erc721.collection.evidence.mintTransferObserved, true);
  assert.equal(erc721.opportunity.source, "ROBINHOOD_NFT_TRANSFER_MINT");
  assert.equal(erc721.opportunity.opportunityType, "MINT");
  assert.equal(erc721.opportunity.tokenId, "42");
  assert.equal(erc721.opportunity.expectedPrice, "0");
  assert.equal(erc721.opportunity.maximumPrice, "0");
  assert.equal(erc721.opportunity.metadata.priceObserved, false);
  assert.equal(erc721.opportunity.metadata.mintPriceStatus, "UNKNOWN");
  assert.equal(erc721.opportunity.metadata.actionableMint, false);
  assert.equal(erc721.opportunity.metadata.assetAmount, "1");
  assert.equal(erc721.opportunity.metadata.to, BUYER);
  assert.equal(erc721.opportunity.metadata.analysisStatus.contract, "PENDING");
  assert.equal(erc721.opportunity.riskLabel, "UNKNOWN");
  assert.equal(erc721.opportunity.recommendation, "RESEARCH");
  assert.equal(erc721.opportunity.scoutable, true);
  assert.equal(erc721.opportunity.autonomousExecutionEligible, false);
  assert.equal(erc721.opportunity.canonical, true);
  assert.equal(erc721.opportunity.sourceBlockNumber, "80");
  assert.equal(erc721.opportunity.sourceBlockTimestamp, "2026-08-17T12:00:00.000Z");
  assert.equal(erc721.opportunity.metadata.indexedAt, observedAt.toISOString());
  assert.equal(erc721.opportunity.sourceLogIndex, 2);

  const erc1155 = projectScoutLog({
    chainId: 4663,
    stream: "nft_transfers",
    record: transferMintLog({ standard: "ERC1155", tokenId: 7n, amount: 5n, logIndex: "0x3" }),
    observedAt,
  });
  assert.equal(erc1155.collection.standard, "ERC1155");
  assert.equal(erc1155.opportunity.opportunityType, "EDITION");
  assert.equal(erc1155.opportunity.tokenId, "7");
  assert.equal(erc1155.opportunity.metadata.assetAmount, "5");
  assert.equal(erc1155.opportunity.metadata.operator, SELLER);
  assert.equal(erc1155.opportunity.sourceLogIndex, 3);
});

test("indexed mint projection rejects transfers, burns, malformed logs, and zero editions", () => {
  const project = (record, overrides = {}) => projectScoutLog({
    chainId: 4663,
    stream: "nft_transfers",
    record,
    ...overrides,
  });

  assert.equal(project(transferMintLog({ from: SELLER })), null);
  assert.equal(project(transferMintLog({ to: zeroAddress })), null);
  assert.equal(project(transferMintLog({ standard: "ERC1155", amount: 0n })), null);
  assert.equal(project(transferMintLog({
    standard: "ERC1155",
    topics: [
      TRANSFER_SINGLE_TOPIC,
      addressTopic(zeroAddress),
      addressTopic(zeroAddress),
      addressTopic(BUYER),
    ],
  })), null);
  assert.equal(project(transferMintLog({ data: `0x${uint256Word(1)}` })), null);
  assert.equal(project(transferMintLog({ transactionHash: "0x01" })), null);
  assert.equal(project(transferMintLog({ logIndex: "-1" })), null);
  assert.equal(project(transferMintLog({
    topics: [TRANSFER_TOPIC, addressTopic(zeroAddress), addressTopic(BUYER)],
  })), null);
  assert.equal(project(transferMintLog({
    topics: [
      TRANSFER_TOPIC,
      `0x${"1".repeat(24)}${zeroAddress.slice(2)}`,
      addressTopic(BUYER),
      `0x${uint256Word(42)}`,
    ],
  })), null);
  assert.equal(
    projectScoutLog({
      chainId: 4663,
      stream: "gogh_punk_transfers",
      record: transferMintLog(),
    }),
    null,
  );
  assert.equal(project(transferMintLog(), { chainId: 1 }), null);
});

test("Seaport Scout source rejects the wrong chain and excessive ranges", async () => {
  const wrongChain = new RobinhoodSeaportActivitySource({ rpc: async () => "0x1" });
  await assert.rejects(
    () => wrongChain.discover({ fromBlock: 0, toBlock: 0 }),
    /RPC chain mismatch/,
  );
  const source = new RobinhoodSeaportActivitySource({
    rpc: async (method) => method === "eth_chainId" ? "0x1237" : "0x3000",
    maximumBlockRange: 10,
  });
  await assert.rejects(
    () => source.discover({ fromBlock: 1, toBlock: 11 }),
    /excessive Seaport discovery block range/,
  );

  const mismatchedHeader = new RobinhoodSeaportActivitySource({
    rpc: async (method, params) => {
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_blockNumber") return "0x64";
      if (method === "eth_getLogs") return [seaportLog()];
      if (method === "eth_getBlockByNumber") {
        return {
          number: params[0],
          hash: `0x${"aa".repeat(32)}`,
          timestamp: "0x6a82f7c0",
        };
      }
      throw new Error("unexpected method");
    },
  });
  await assert.rejects(
    () => mismatchedHeader.discover({ fromBlock: 80, toBlock: 80 }),
    /does not match its canonical block header/,
  );
});

test("JSON-RPC block headers preserve canonical timestamps with bounded concurrency", async () => {
  const requestedBlocks = [];
  const source = new RobinhoodJsonRpcSource({
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    streams: {},
    fetchImpl: async (_url, request) => {
      const payload = JSON.parse(request.body);
      const block = BigInt(payload.params[0]);
      requestedBlocks.push(block.toString());
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          number: payload.params[0],
          hash: `0x${block.toString(16).padStart(64, "0")}`,
          timestamp: `0x${(1_786_968_000n + block).toString(16)}`,
        },
      }));
    },
  });
  const headers = await source.blockHeaders([80, 80, 81], { concurrency: 2 });
  assert.deepEqual(requestedBlocks.sort(), ["80", "81"]);
  assert.equal(headers[0].number, "80");
  assert.equal(headers[0].timestamp, "1786968080");
  await assert.rejects(
    () => source.blockHeaders([80], { concurrency: 9 }),
    /concurrency/,
  );
  const oversized = new RobinhoodJsonRpcSource({
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    streams: {},
    maximumResponseBytes: 1_000,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "1001" },
      text: async () => "should not be read",
    }),
  });
  await assert.rejects(() => oversized.blockNumber(), /too large/);
  const mismatchedResponse = new RobinhoodJsonRpcSource({
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    streams: {},
    fetchImpl: async () => new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 999,
      result: "0x64",
    })),
  });
  await assert.rejects(
    () => mismatchedResponse.blockNumber(),
    (error) => error?.code === "MISMATCHED_RESPONSE",
  );
  assert.throws(
    () => new RobinhoodJsonRpcSource({
      rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
      streams: {},
      timeoutMs: 0,
    }),
    /timeoutMs/,
  );
});

test("JSON-RPC source rejects a provider log outside a pinned stream address", async () => {
  const expectedAddress = "0x1111111111111111111111111111111111111111";
  const source = new RobinhoodJsonRpcSource({
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    streams: {
      pinned: { address: expectedAddress, topics: [ACCOUNT_ACTIVATION_TOPIC] },
    },
    fetchImpl: async (_url, request) => {
      const payload = JSON.parse(request.body);
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: [{
          address: "0x2222222222222222222222222222222222222222",
          blockNumber: "0x50",
          blockHash: `0x${"ab".repeat(32)}`,
          transactionHash: `0x${"cd".repeat(32)}`,
          logIndex: "0x0",
          topics: [ACCOUNT_ACTIVATION_TOPIC],
          data: "0x",
        }],
      }));
    },
  });
  await assert.rejects(
    () => source.logs("pinned", 80n, 80n),
    (error) => error?.code === "FILTER_ADDRESS_MISMATCH",
  );
});

class MemoryRepository {
  checkpointValue = null;
  logs = new Map();
  rewinds = [];
  streamDefinitionValue = null;

  async checkpoint() {
    return this.checkpointValue;
  }

  async insertLogs(
    _chainId,
    _stream,
    records,
    { checkpoint = null, streamDefinition = null } = {},
  ) {
    this.streamDefinitionValue = streamDefinition;
    let inserted = 0;
    for (const record of records) {
      if (!this.logs.has(record.id)) inserted += 1;
      this.logs.set(record.id, record);
    }
    if (checkpoint) this.checkpointValue = checkpoint;
    return inserted;
  }

  async saveCheckpoint(_chainId, _stream, value) {
    this.checkpointValue = value;
  }

  async rewind(_chainId, _stream, fromBlock) {
    this.rewinds.push(fromBlock.toString());
    for (const [id, record] of this.logs) {
      if (BigInt(record.blockNumber) >= fromBlock) this.logs.delete(id);
    }
    this.checkpointValue = null;
  }
}

class MemorySource {
  head = 120n;
  reorgedCheckpoint = false;

  async blockNumber() {
    return this.head;
  }

  async blockHash(block) {
    if (this.reorgedCheckpoint && block === 100n) return `0x${"ff".repeat(32)}`;
    return `0x${block.toString(16).padStart(64, "0")}`;
  }

  async blockHeaders(blocks) {
    return Promise.all([...new Set(blocks.map((block) => BigInt(block).toString()))].map(
      async (block) => ({
        number: block,
        hash: await this.blockHash(BigInt(block)),
        timestamp: (1_786_968_000n + BigInt(block)).toString(),
      }),
    ));
  }

  async logs(_stream, from, to) {
    return [
      {
        transactionHash: `0x${from.toString(16).padStart(64, "0")}`,
        logIndex: "0x0",
        blockNumber: from.toString(),
        blockHash: await this.blockHash(from),
        toBlock: to.toString(),
      },
    ];
  }

  streamDefinition(stream) {
    return { name: stream };
  }
}

test("indexer uses confirmed blocks, idempotent log IDs, and rewinds on reorg", async () => {
  const source = new MemorySource();
  const repository = new MemoryRepository();
  const indexer = new ReorgAwareIndexer({
    chainId: 4663,
    source,
    repository,
    confirmations: 20,
    batchSize: 50,
    reorgWindow: 64,
  });
  const first = await indexer.run("transfers");
  assert.equal(first.safeHead, "100");
  assert.equal(first.inserted, 3);
  assert.deepEqual(repository.streamDefinitionValue, { name: "transfers" });
  assert.ok([...repository.logs.keys()].every((id) => id.startsWith("transfers:4663:")));
  assert.equal(repository.checkpointValue.blockNumber, "100");
  const second = await indexer.run("transfers");
  assert.equal(second.inserted, 0);

  source.reorgedCheckpoint = true;
  const third = await indexer.run("transfers");
  assert.equal(repository.rewinds[0], "36");
  assert.ok(third.inserted >= 1);
  assert.equal(
    logId(4663, { transactionHash: `0x${"AB".repeat(32)}`, logIndex: "0x2" }),
    `4663:0x${"ab".repeat(32)}:2`,
  );
});

test("indexer begins at its configured deployment block and never rewinds before it", async () => {
  const source = new MemorySource();
  const repository = new MemoryRepository();
  const indexer = new ReorgAwareIndexer({
    chainId: 4663,
    source,
    repository,
    confirmations: 20,
    batchSize: 10,
    reorgWindow: 64,
    startBlock: 90,
  });

  const first = await indexer.run("broker-events");
  assert.equal(first.inserted, 2);
  assert.deepEqual(
    [...repository.logs.values()].map((record) => record.blockNumber),
    ["90", "100"],
  );

  repository.checkpointValue = {
    blockNumber: "100",
    blockHash: `0x${"aa".repeat(32)}`,
  };
  const second = await indexer.run("broker-events");
  assert.equal(repository.rewinds.at(-1), "90");
  assert.equal(second.inserted, 2);
});

test("indexer advances through a bounded block window and reports catch-up state", async () => {
  const source = new MemorySource();
  const repository = new MemoryRepository();
  const indexer = new ReorgAwareIndexer({
    chainId: 4663,
    source,
    repository,
    confirmations: 20,
    batchSize: 10,
    maximumBlocksPerRun: 21,
  });

  const first = await indexer.run("bounded");
  assert.equal(first.safeHead, "100");
  assert.equal(first.processedThrough, "20");
  assert.equal(first.caughtUp, false);
  assert.equal(repository.checkpointValue.blockNumber, "20");

  const second = await indexer.run("bounded");
  assert.equal(second.processedThrough, "41");
  assert.equal(second.caughtUp, false);
  assert.equal(repository.checkpointValue.blockNumber, "41");

  repository.checkpointValue = {
    blockNumber: "99",
    blockHash: await source.blockHash(99n),
  };
  const final = await indexer.run("bounded");
  assert.equal(final.processedThrough, "100");
  assert.equal(final.caughtUp, true);
});

test("indexer rejects unsafe numeric configuration", () => {
  const base = {
    chainId: 4663,
    source: new MemorySource(),
    repository: new MemoryRepository(),
  };
  assert.throws(() => new ReorgAwareIndexer({ ...base, startBlock: -1 }), /startBlock/);
  assert.throws(() => new ReorgAwareIndexer({ ...base, confirmations: -1 }), /confirmations/);
  assert.throws(() => new ReorgAwareIndexer({ ...base, batchSize: 0 }), /batchSize/);
  assert.throws(
    () => new ReorgAwareIndexer({ ...base, maximumBlocksPerRun: 0 }),
    /maximumBlocksPerRun/,
  );
});

test("protocol streams fail closed until a complete deployed manifest exists", () => {
  const staged = protocolStreams({
    status: "NOT_DEPLOYED",
    contracts: {
      GoghPunkAccountRegistry: { address: null },
      BrokerPolicyModule: { address: null },
    },
  });
  assert.equal(Object.hasOwn(staged, "account_activations"), false);
  assert.equal(Object.hasOwn(staged, "policy_activity"), false);
  assert.equal(staged.seaport_activity.address, ROBINHOOD_SEAPORT);
  assert.deepEqual(staged.seaport_activity.topics, [ORDER_FULFILLED_TOPIC]);

  const deployed = protocolStreams({
    status: "DEPLOYED",
    contracts: {
      GoghPunkAccountRegistry: { address: "0x1111111111111111111111111111111111111111" },
      GoghPunkAccountV1: { address: "0x3333333333333333333333333333333333333333" },
      BrokerPolicyModule: { address: "0x2222222222222222222222222222222222222222" },
    },
  });
  assert.deepEqual(deployed.account_activations.topics, [ACCOUNT_ACTIVATION_TOPIC]);
  assert.equal(
    deployed.account_activations.implementation,
    "0x3333333333333333333333333333333333333333",
  );
  assert.equal(Object.hasOwn(deployed.account_acquisitions, "address"), false);
  assert.equal(deployed.policy_activity.address, "0x2222222222222222222222222222222222222222");

  assert.throws(
    () => protocolStreams({ status: "DEPLOYED", contracts: {} }),
    /GoghPunkAccountRegistry/,
  );
});

test("database chain lock keeps all indexer work on the locked connection", async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (sql.includes("broker_indexer_checkpoints")) return { rows: [] };
      return { rows: [{ pg_advisory_unlock: true }] };
    },
    release() {
      released = true;
    },
  };
  const repository = new PostgresIndexerRepository({ connect: async () => client });
  const value = await repository.withChainLock(4663, async (lockedRepository) => {
    assert.equal(lockedRepository.database, client);
    return lockedRepository.checkpoint(4663, "gogh_punk_transfers");
  });
  assert.equal(value, null);
  assert.equal(released, true);
  assert.ok(calls.some((sql) => sql.includes("pg_advisory_unlock")));
});

test("database atomically materializes read-only Scout projections and hides reorged rows", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [] };
    },
  };
  const repository = new PostgresIndexerRepository(client, {
    clock: () => new Date("2026-08-17T12:00:00.000Z"),
  });
  await assert.rejects(
    () => repository.insertLogs(4663, "seaport_activity", [], {
      checkpoint: { blockNumber: "-1", blockHash: `0x${"ef".repeat(32)}` },
    }),
    /invalid indexer checkpoint/,
  );
  await assert.rejects(
    () => repository.saveCheckpoint(4663, "seaport_activity", null),
    /invalid indexer checkpoint/,
  );
  const record = {
    ...seaportLog(),
    id: `seaport_activity:4663:0x${"cd".repeat(32)}:7`,
    blockNumber: "80",
  };
  const inserted = await repository.insertLogs(4663, "seaport_activity", [record]);
  assert.equal(inserted, 1);
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
  assert.ok(calls.some(({ sql }) => sql.includes("INSERT INTO broker_collections")));
  const opportunityInsert = calls.find(({ sql }) =>
    sql.includes("INSERT INTO broker_opportunities"));
  assert.ok(opportunityInsert);
  assert.equal(opportunityInsert.values[9], "0");
  assert.equal(opportunityInsert.values[17], false);
  assert.equal(opportunityInsert.values[19], "80");
  assert.equal(opportunityInsert.values[23], true);
  assert.equal(opportunityInsert.values[24], "2026-08-17T12:00:00.000Z");
  const metadata = JSON.parse(opportunityInsert.values[12]);
  assert.equal(metadata.actionableListing, false);
  assert.equal(metadata.historicalSalePrice, parseEther("0.0003").toString());

  calls.length = 0;
  const mintRecord = {
    ...transferMintLog({ standard: "ERC1155", tokenId: 7n, amount: 5n }),
    id: `nft_transfers:4663:0x${"aa".repeat(32)}:2`,
    blockNumber: "80",
  };
  const mintInserted = await repository.insertLogs(4663, "nft_transfers", [mintRecord]);
  assert.equal(mintInserted, 1);
  const mintCollectionInsert = calls.find(({ sql }) =>
    sql.includes("INSERT INTO broker_collections"));
  assert.ok(mintCollectionInsert);
  assert.equal(JSON.parse(mintCollectionInsert.values[3]).mintTransferObserved, true);
  const mintOpportunityInsert = calls.find(({ sql }) =>
    sql.includes("INSERT INTO broker_opportunities"));
  assert.ok(mintOpportunityInsert);
  assert.equal(mintOpportunityInsert.values[4], "ROBINHOOD_NFT_TRANSFER_MINT");
  assert.equal(mintOpportunityInsert.values[5], "EDITION");
  assert.equal(mintOpportunityInsert.values[9], "0");
  assert.equal(mintOpportunityInsert.values[10], "0");
  assert.equal(mintOpportunityInsert.values[16], true);
  assert.equal(mintOpportunityInsert.values[17], false);
  assert.equal(mintOpportunityInsert.values[23], true);
  const mintMetadata = JSON.parse(mintOpportunityInsert.values[12]);
  assert.equal(mintMetadata.mintSignal, true);
  assert.equal(mintMetadata.priceObserved, false);
  assert.equal(mintMetadata.actionableMint, false);
  assert.equal(mintMetadata.assetAmount, "5");

  calls.length = 0;
  await repository.insertLogs(4663, "seaport_activity", [], {
    checkpoint: {
      blockNumber: "80",
      blockHash: `0x${"ef".repeat(32)}`,
    },
  });
  assert.equal(calls[0].sql, "BEGIN");
  assert.ok(calls.some(({ sql }) => sql.includes("INSERT INTO broker_indexer_checkpoints")));
  assert.equal(calls.at(-1).sql, "COMMIT");

  calls.length = 0;
  await repository.rewind(4663, "seaport_activity", 75n);
  assert.ok(calls.some(({ sql }) =>
    sql.includes("UPDATE broker_collections") && sql.includes("analysis_block_hash = NULL")));
  assert.ok(calls.some(({ sql }) =>
    sql.includes("DELETE FROM broker_collection_signal_snapshots")));
  assert.ok(calls.some(({ sql }) =>
    sql.includes("UPDATE broker_proposals AS proposal")));
  assert.ok(calls.some(({ sql }) =>
    sql.includes("SET canonical = FALSE") && sql.includes("scoutable = FALSE")));
});
