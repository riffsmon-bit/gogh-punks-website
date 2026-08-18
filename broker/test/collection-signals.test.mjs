import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  decodeFunctionData,
  encodeFunctionResult,
} from "viem";
import { summarizeCollectionActivity } from "../src/analysis/collection-activity.mjs";
import {
  RpcNftEvidenceInspector,
  classifyMetadataArt,
} from "../src/analysis/rpc-nft-evidence-inspector.mjs";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const OWNER_A = "0x2222222222222222222222222222222222222222";
const OWNER_B = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";
const TOKEN_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "uri", type: "string" }],
  },
];

function sale({
  tokenId,
  occurredAt,
  price,
  currency = ZERO,
  buyer = OWNER_A,
  seller = OWNER_B,
  block = 70,
  indexedAt = "2026-08-17T12:00:00.000Z",
}) {
  return {
    token_id: tokenId,
    source_block_number: String(block),
    source_block_timestamp: occurredAt,
    metadata: {
      historicalSaleSignal: true,
      actionableListing: false,
      historicalSalePrice: String(price),
      historicalSaleCurrency: currency,
      buyer,
      seller,
      indexedAt,
    },
  };
}

test("metadata art classifier labels self-described evidence as heuristic only", () => {
  const classified = classifyMetadataArt({
    name: "Pixel Dream #1",
    description: "Experimental generative pixel art",
    attributes: [{ traitType: "Format", value: "PFP" }],
    image: { scheme: "data", onChain: true },
    animation: null,
  }, { metadataOnChain: true });
  assert.equal(classified.status, "HEURISTIC");
  assert.ok(classified.dimensions.pixelArt > 0);
  assert.ok(classified.dimensions.generativeArt > 0);
  assert.ok(classified.dimensions.onChainArt > 0);
  assert.ok(classified.confidence <= 45);
  assert.match(classified.caveat, /untrusted NFT metadata/i);

  const unknown = classifyMetadataArt({
    name: "Untitled",
    description: null,
    attributes: [],
    image: null,
    animation: null,
  });
  assert.equal(unknown.status, "UNAVAILABLE");
  assert.equal(unknown.artScore, null);
});

test("NFT evidence pins owner samples and on-chain metadata to one confirmed block", async () => {
  const metadata = Buffer.from(JSON.stringify({
    name: "Pixel Dream #1",
    description: "Fully on-chain generative pixel art",
    image: "data:image/svg+xml;base64,PHN2Zy8+",
    attributes: [{ trait_type: "Category", value: "PFP" }],
  })).toString("base64");
  const uri = `data:application/json;base64,${metadata}`;
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_blockNumber") return "0x64";
    if (method === "eth_getBlockByNumber") {
      return { number: params[0], hash: `0x${"ab".repeat(32)}`, timestamp: "0x1234" };
    }
    if (method === "eth_call") {
      const decoded = decodeFunctionData({ abi: TOKEN_ABI, data: params[0].data });
      if (decoded.functionName === "name" || decoded.functionName === "symbol") {
        return encodeFunctionResult({
          abi: TOKEN_ABI,
          functionName: decoded.functionName,
          result: decoded.functionName === "name" ? "Pixel Dreams" : "PXDRM",
        });
      }
      if (decoded.functionName === "ownerOf") {
        return encodeFunctionResult({
          abi: TOKEN_ABI,
          functionName: "ownerOf",
          result: decoded.args[0] === 1n ? OWNER_A : OWNER_B,
        });
      }
      return encodeFunctionResult({
        abi: TOKEN_ABI,
        functionName: "tokenURI",
        result: uri,
      });
    }
    throw new Error("unexpected RPC method");
  };
  const inspector = new RpcNftEvidenceInspector({
    rpc,
    clock: () => new Date("2026-08-17T12:00:00.000Z"),
  });
  const evidence = await inspector.inspect(COLLECTION, {
    standard: "ERC721",
    tokenIds: ["1", "2", "2"],
    blockNumber: 80,
    expectedBlockHash: `0x${"ab".repeat(32)}`,
  });
  assert.equal(evidence.observedBlock, "80");
  assert.equal(evidence.observedBlockTimestamp, "4660");
  assert.equal(evidence.identity.name, "Pixel Dreams");
  assert.equal(evidence.identity.symbol, "PXDRM");
  assert.equal(evidence.ownerSample.requested, 2);
  assert.equal(evidence.ownerSample.resolved, 2);
  assert.equal(evidence.ownerSample.uniqueOwners, 2);
  assert.equal(evidence.ownerSample.concentrationPercentage, 50);
  assert.equal(evidence.metadata.status, "ONCHAIN_JSON");
  assert.equal(evidence.metadata.summary.name, "Pixel Dream #1");
  assert.equal(evidence.metadata.art.status, "HEURISTIC");
  assert.match(evidence.metadata.metadataHash, /^0x[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(evidence).includes(uri), false);
  assert.ok(
    calls
      .filter(({ method }) => method === "eth_call")
      .every(({ params }) => params.at(-1) === "0x50"),
  );
  await assert.rejects(
    () => inspector.inspect(COLLECTION, {
      standard: "ERC721",
      tokenIds: ["1"],
      blockNumber: 80,
      expectedBlockHash: `0x${"cd".repeat(32)}`,
    }),
    /does not match contract evidence/,
  );
  await assert.rejects(
    () => inspector.inspect(COLLECTION, {
      standard: "ERC721",
      tokenIds: ["1"],
      blockNumber: 80,
      expectedBlockTimestamp: "4661",
    }),
    /timestamp does not match contract evidence/,
  );
});

test("remote metadata is recorded but never fetched by the RPC evidence inspector", async () => {
  let tokenUri = "http://unsafe.example/token/1.json";
  const rpc = async (method, params) => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_blockNumber") return "0x64";
    if (method === "eth_getBlockByNumber") {
      return { number: params[0], hash: `0x${"ab".repeat(32)}`, timestamp: "0x1234" };
    }
    if (method === "eth_call") {
      const decoded = decodeFunctionData({ abi: TOKEN_ABI, data: params[0].data });
      if (decoded.functionName === "name" || decoded.functionName === "symbol") {
        return encodeFunctionResult({
          abi: TOKEN_ABI,
          functionName: decoded.functionName,
          result: decoded.functionName === "name" ? "Remote Collection" : "REMOTE",
        });
      }
      if (decoded.functionName === "ownerOf") {
        return encodeFunctionResult({ abi: TOKEN_ABI, functionName: "ownerOf", result: ZERO });
      }
      return encodeFunctionResult({
        abi: TOKEN_ABI,
        functionName: "tokenURI",
        result: tokenUri,
      });
    }
    throw new Error("unexpected RPC method");
  };
  const evidence = await new RpcNftEvidenceInspector({ rpc }).inspect(COLLECTION, {
    standard: "ERC721",
    tokenIds: ["1"],
  });
  assert.equal(evidence.metadata.status, "INSECURE_REMOTE_BLOCKED");
  assert.equal(evidence.metadata.summary, null);
  assert.equal(evidence.metadata.art.status, "UNAVAILABLE");
  assert.equal(evidence.ownerSample.resolved, 0);

  tokenUri = "data:application/json-evil,%7B%7D";
  const malformed = await new RpcNftEvidenceInspector({ rpc }).inspect(COLLECTION, {
    standard: "ERC721",
    tokenIds: ["1"],
  });
  assert.equal(malformed.metadata.status, "UNAVAILABLE");
});

test("market activity uses source block time, separates currencies, and never claims liquidity", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");
  const currency = "0x4444444444444444444444444444444444444444";
  const rows = [
    sale({ tokenId: "1", occurredAt: "2026-08-17T11:00:00.000Z", price: 3, block: 80 }),
    sale({
      tokenId: "2",
      occurredAt: "2026-08-15T12:00:00.000Z",
      price: 7,
      currency,
      buyer: OWNER_B,
      seller: OWNER_A,
      block: 75,
    }),
    sale({
      tokenId: "3",
      occurredAt: "2026-07-01T12:00:00.000Z",
      price: 11,
      block: 20,
      indexedAt: "2026-08-17T11:59:00.000Z",
    }),
    sale({ tokenId: "4", occurredAt: "2026-08-18T12:00:00.000Z", price: 5, block: 90 }),
  ];
  const summary = summarizeCollectionActivity(rows, {
    now,
    ownerSample: {
      status: "SAMPLED",
      requested: 3,
      resolved: 3,
      uniqueOwners: 2,
      maximumTokensPerOwner: 2,
      concentrationPercentage: 66.67,
    },
  });
  assert.equal(summary.sales.observed, 3);
  assert.equal(summary.sales.last24Hours, 1);
  assert.equal(summary.sales.last7Days, 2);
  assert.equal(summary.sales.last30Days, 2);
  assert.equal(summary.rejectedRows, 1);
  assert.equal(summary.volumes30dByCurrency[ZERO], "3");
  assert.equal(summary.volumes30dByCurrency[currency], "7");
  assert.equal(summary.liquidityScore, null);
  assert.equal(summary.liquidityStatus, "UNAVAILABLE");
  assert.equal(summary.ownerSample.sampledHolderDiversity, 66.67);
  assert.equal(summary.sourceMinBlock, "20");
  assert.equal(summary.sourceMaxBlock, "80");
  assert.equal(summary.executionEligible, false);
  assert.match(summary.caveats[0], /do not prove current listings/i);
  assert.throws(
    () => summarizeCollectionActivity(Array.from({ length: 501 }, () => ({}))),
    /at most 500/,
  );
});
