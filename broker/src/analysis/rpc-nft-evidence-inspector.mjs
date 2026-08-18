import { createHash } from "node:crypto";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
} from "viem";
import { ROBINHOOD, normalizeAddress } from "../config.mjs";
import { analyzeArt } from "./art.mjs";

const MAXIMUM_OWNER_SAMPLES = 32;
const MAXIMUM_RPC_RESULT_BYTES = 1_000_000;
const MAXIMUM_TOKEN_URI_CHARACTERS = 400_000;
const MAXIMUM_METADATA_BYTES = 256_000;
const MAXIMUM_ATTRIBUTES = 64;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const JSON_DATA_URI_HEADER = /^data:application\/json(?:;charset=(?:utf-8|utf8))?(?:;base64)?$/i;

const ERC721_ABI = Object.freeze([
  Object.freeze({
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: Object.freeze([]),
    outputs: Object.freeze([{ name: "", type: "string" }]),
  }),
  Object.freeze({
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: Object.freeze([]),
    outputs: Object.freeze([{ name: "", type: "string" }]),
  }),
  Object.freeze({
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: Object.freeze([{ name: "tokenId", type: "uint256" }]),
    outputs: Object.freeze([{ name: "owner", type: "address" }]),
  }),
  Object.freeze({
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: Object.freeze([{ name: "tokenId", type: "uint256" }]),
    outputs: Object.freeze([{ name: "uri", type: "string" }]),
  }),
]);

const ERC1155_ABI = Object.freeze([
  ...ERC721_ABI.filter(({ name }) => name === "name" || name === "symbol"),
  Object.freeze({
    type: "function",
    name: "uri",
    stateMutability: "view",
    inputs: Object.freeze([{ name: "tokenId", type: "uint256" }]),
    outputs: Object.freeze([{ name: "uri", type: "string" }]),
  }),
]);

const DIMENSION_RULES = Object.freeze({
  pixelArt: Object.freeze([/\bpixel(?:ated)?\b/i, /\b8[ -]?bit\b/i, /\b16[ -]?bit\b/i]),
  generativeArt: Object.freeze([/\bgenerative\b/i, /\balgorithmic\b/i, /\bprocedural\b/i]),
  oneOfOne: Object.freeze([/\b1\s*\/\s*1\b/i, /\bone[ -]of[ -]one\b/i, /\bunique artwork\b/i]),
  photography: Object.freeze([/\bphotograph(?:y|ic)?\b/i, /\bphoto art\b/i]),
  illustration: Object.freeze([/\billustrat(?:ion|ed)\b/i, /\bdigital drawing\b/i]),
  animation: Object.freeze([/\banimat(?:ion|ed)\b/i, /\bmotion art\b/i]),
  abstract: Object.freeze([/\babstract\b/i]),
  surrealism: Object.freeze([/\bsurreal(?:ism|ist|istic)?\b/i]),
  pfp: Object.freeze([/\bpfp\b/i, /\bprofile picture\b/i, /\bavatar collection\b/i]),
  conceptualArt: Object.freeze([/\bconceptual\b/i]),
  onChainArt: Object.freeze([/\bon[ -]?chain art\b/i, /\bfully on[ -]?chain\b/i]),
  aiAssistedArt: Object.freeze([/\bai[ -]assisted\b/i, /\bgenerative ai\b/i, /\bartificial intelligence\b/i]),
  editions: Object.freeze([/\bedition(?:s)?\b/i, /\blimited edition\b/i]),
  physicalLinkedArt: Object.freeze([/\bphysical(?:ly)? linked\b/i, /\bphygital\b/i, /\bredeemable physical\b/i]),
  emergingArtists: Object.freeze([/\bemerging artist\b/i]),
  historicalNFTs: Object.freeze([/\bhistorical nft\b/i, /\bearly nft\b/i]),
  experimentalNFTs: Object.freeze([/\bexperimental\b/i, /\bavant[ -]?garde\b/i]),
});

function blockTag(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function observedDate(clock) {
  const value = new Date(clock());
  if (Number.isNaN(value.getTime())) throw new TypeError("clock returned an invalid date");
  return value.toISOString();
}

function boundedRpcResult(value) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new TypeError("eth_call returned invalid ABI data");
  }
  if ((value.length - 2) / 2 > MAXIMUM_RPC_RESULT_BYTES) {
    throw new RangeError("eth_call result is too large");
  }
  return value;
}

function tokenIds(values) {
  if (!Array.isArray(values)) throw new TypeError("tokenIds must be an array");
  const unique = new Set();
  for (const value of values) {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new TypeError("tokenId cannot be negative");
    unique.add(parsed.toString());
  }
  if (unique.size > MAXIMUM_OWNER_SAMPLES) {
    throw new RangeError(`tokenIds cannot exceed ${MAXIMUM_OWNER_SAMPLES} samples`);
  }
  return [...unique];
}

async function mapWithConcurrency(values, concurrency, operation) {
  const results = new Array(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

function safeText(value, maximumLength) {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function safePrimitive(value, maximumLength = 160) {
  if (typeof value === "string") return safeText(value, maximumLength);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
}

function uriScheme(uri) {
  if (/^data:/i.test(uri)) return "data";
  if (/^ipfs:\/\//i.test(uri)) return "ipfs";
  if (/^https:\/\//i.test(uri)) return "https";
  if (/^http:\/\//i.test(uri)) return "http";
  return "other";
}

function mediaSummary(value) {
  const uri = safeText(value, 2_048);
  if (!uri) return null;
  return Object.freeze({
    scheme: uriScheme(uri),
    onChain: /^data:/i.test(uri),
  });
}

function sanitizedMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("NFT metadata must be a JSON object");
  }
  const attributes = [];
  if (Array.isArray(value.attributes)) {
    for (const attribute of value.attributes.slice(0, MAXIMUM_ATTRIBUTES)) {
      if (!attribute || typeof attribute !== "object" || Array.isArray(attribute)) continue;
      const traitType = safeText(attribute.trait_type, 96);
      const traitValue = safePrimitive(attribute.value);
      if (traitType && traitValue !== null) {
        attributes.push(Object.freeze({ traitType, value: traitValue }));
      }
    }
  }
  return Object.freeze({
    name: safeText(value.name, 160),
    description: safeText(value.description, 1_000),
    attributes: Object.freeze(attributes),
    image: mediaSummary(value.image),
    animation: mediaSummary(value.animation_url),
    external: mediaSummary(value.external_url),
  });
}

function metadataCorpus(metadata) {
  return [
    metadata.name,
    metadata.description,
    ...metadata.attributes.flatMap((attribute) => [
      attribute.traitType,
      typeof attribute.value === "string" ? attribute.value : null,
    ]),
  ].filter(Boolean);
}

export function classifyMetadataArt(metadata, { metadataOnChain = false } = {}) {
  const corpus = metadataCorpus(metadata);
  const dimensions = {};
  const matches = {};
  for (const [dimension, rules] of Object.entries(DIMENSION_RULES)) {
    const matchedFields = corpus.filter((field) => rules.some((rule) => rule.test(field)));
    if (matchedFields.length > 0) {
      dimensions[dimension] = Math.min(85, 58 + matchedFields.length * 7);
      matches[dimension] = matchedFields.length;
    }
  }
  if (metadata.animation) {
    dimensions.animation = Math.max(dimensions.animation ?? 0, 72);
    matches.animation = (matches.animation ?? 0) + 1;
  }
  if (metadataOnChain || metadata.image?.onChain || metadata.animation?.onChain) {
    dimensions.onChainArt = Math.max(dimensions.onChainArt ?? 0, 78);
    matches.onChainArt = (matches.onChainArt ?? 0) + 1;
  }
  if (Object.keys(dimensions).length === 0) {
    return Object.freeze({
      status: "UNAVAILABLE",
      artScore: null,
      confidence: 0,
      dimensions: Object.freeze({}),
      matches: Object.freeze({}),
      caveat: "Metadata contained no recognized art-style evidence; no art score was assigned.",
    });
  }
  const analysis = analyzeArt({ dimensions, metadataAvailable: true, mediaAvailable: false });
  return Object.freeze({
    status: "HEURISTIC",
    artScore: analysis.artScore,
    confidence: Math.min(45, 18 + Object.keys(dimensions).length * 5),
    dimensions: analysis.dimensions,
    matches: Object.freeze(matches),
    caveat: "Heuristic tags come only from untrusted NFT metadata; media was not judged and no objective artistic-quality claim is made.",
  });
}

function decodeDataJson(uri) {
  const comma = uri.indexOf(",");
  if (comma <= 0 || comma > 160) throw new TypeError("invalid JSON data URI");
  const header = uri.slice(0, comma);
  if (!JSON_DATA_URI_HEADER.test(header)) {
    throw new TypeError("unsupported metadata data URI media type");
  }
  const payload = uri.slice(comma + 1);
  let bytes;
  if (/;base64$/i.test(header)) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
      throw new TypeError("invalid base64 metadata payload");
    }
    bytes = Buffer.from(payload, "base64");
  } else {
    bytes = Buffer.from(decodeURIComponent(payload), "utf8");
  }
  if (bytes.byteLength > MAXIMUM_METADATA_BYTES) {
    throw new RangeError("decoded NFT metadata is too large");
  }
  const text = bytes.toString("utf8");
  return Object.freeze({
    hash: `0x${createHash("sha256").update(bytes).digest("hex")}`,
    value: sanitizedMetadata(JSON.parse(text)),
  });
}

function analyzeTokenUri(uri) {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > MAXIMUM_TOKEN_URI_CHARACTERS) {
    throw new TypeError("token URI is empty or exceeds the size limit");
  }
  const scheme = uriScheme(uri);
  if (scheme !== "data") {
    return Object.freeze({
      status: scheme === "http" ? "INSECURE_REMOTE_BLOCKED" : "REMOTE_UNFETCHED",
      scheme,
      metadataHash: null,
      summary: null,
      art: classifyMetadataArt(Object.freeze({ attributes: Object.freeze([]) })),
      caveat: "Remote metadata retrieval is disabled until an allowlisted, size-bounded gateway is configured.",
    });
  }
  const decoded = decodeDataJson(uri);
  return Object.freeze({
    status: "ONCHAIN_JSON",
    scheme,
    metadataHash: decoded.hash,
    summary: decoded.value,
    art: classifyMetadataArt(decoded.value, { metadataOnChain: true }),
    caveat: "Metadata text is untrusted evidence and is never treated as instructions.",
  });
}

export class RpcNftEvidenceInspector {
  constructor({
    rpc,
    chainId = ROBINHOOD.chainId,
    confirmations = 20,
    ownerConcurrency = 4,
    clock = () => new Date(),
  }) {
    if (typeof rpc !== "function") throw new TypeError("rpc must be a function");
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    if (!Number.isSafeInteger(ownerConcurrency) || ownerConcurrency < 1 || ownerConcurrency > 8) {
      throw new RangeError("ownerConcurrency must be between 1 and 8");
    }
    this.rpc = rpc;
    this.chainId = Number(chainId);
    this.confirmations = BigInt(confirmations);
    if (this.confirmations < 0n) throw new RangeError("confirmations cannot be negative");
    this.ownerConcurrency = ownerConcurrency;
    this.clock = clock;
  }

  async inspect(collectionAddress, {
    standard = "UNKNOWN",
    tokenIds: requestedTokenIds = [],
    blockNumber,
    expectedBlockHash,
    expectedBlockTimestamp,
  } = {}) {
    const address = normalizeAddress(collectionAddress, "collectionAddress");
    if (!new Set(["ERC721", "ERC1155", "UNKNOWN"]).has(standard)) {
      throw new TypeError("unsupported NFT standard");
    }
    const samples = tokenIds(requestedTokenIds);
    const remoteChainId = Number(BigInt(await this.rpc("eth_chainId", [])));
    if (remoteChainId !== this.chainId || remoteChainId !== ROBINHOOD.chainId) {
      throw new Error(`RPC chain mismatch: expected ${this.chainId}, received ${remoteChainId}`);
    }
    const head = BigInt(await this.rpc("eth_blockNumber", []));
    const safeHead = head > this.confirmations ? head - this.confirmations : 0n;
    const evidenceBlock = blockNumber === undefined ? safeHead : BigInt(blockNumber);
    if (evidenceBlock < 0n || evidenceBlock > safeHead) {
      throw new RangeError("evidence block must be non-negative and confirmed");
    }
    const evidenceTag = blockTag(evidenceBlock);
    const block = await this.rpc("eth_getBlockByNumber", [evidenceTag, false]);
    if (
      !block
      || BigInt(block.number) !== evidenceBlock
      || !/^0x[0-9a-fA-F]{64}$/.test(block.hash ?? "")
    ) throw new TypeError("RPC returned invalid NFT evidence block provenance");
    let observedBlockTimestamp;
    try {
      observedBlockTimestamp = BigInt(block.timestamp);
    } catch {
      throw new TypeError("RPC returned invalid NFT evidence block timestamp");
    }
    if (observedBlockTimestamp < 0n) {
      throw new TypeError("RPC returned invalid NFT evidence block timestamp");
    }
    if (
      expectedBlockTimestamp !== undefined
      && observedBlockTimestamp !== BigInt(expectedBlockTimestamp)
    ) {
      throw new Error("NFT evidence block timestamp does not match contract evidence");
    }
    const observedBlockHash = block.hash.toLowerCase();
    if (expectedBlockHash && observedBlockHash !== String(expectedBlockHash).toLowerCase()) {
      throw new Error("NFT evidence block hash does not match contract evidence");
    }

    const identityAbi = standard === "ERC1155" ? ERC1155_ABI : ERC721_ABI;
    const identityEntries = await Promise.all(["name", "symbol"].map(async (functionName) => {
      try {
        const data = encodeFunctionData({ abi: identityAbi, functionName });
        const result = boundedRpcResult(await this.rpc(
          "eth_call",
          [{ to: address, data }, evidenceTag],
        ));
        const maximumLength = functionName === "name" ? 160 : 32;
        return [functionName, safeText(decodeFunctionResult({
          abi: identityAbi,
          functionName,
          data: result,
        }), maximumLength)];
      } catch {
        return [functionName, null];
      }
    }));
    const identityValues = Object.fromEntries(identityEntries);
    const identity = Object.freeze({
      status: identityValues.name || identityValues.symbol ? "OBSERVED" : "UNAVAILABLE",
      name: identityValues.name,
      symbol: identityValues.symbol,
      caveat: "Collection identity strings are contract-returned labels, not verification of authorship.",
    });

    let ownerSample = Object.freeze({
      status: standard === "ERC721" && samples.length ? "UNAVAILABLE" : "NOT_APPLICABLE",
      requested: samples.length,
      resolved: 0,
      uniqueOwners: 0,
      maximumTokensPerOwner: null,
      concentrationPercentage: null,
      ownersByToken: Object.freeze([]),
      caveat: "A bounded token sample is not the collection's holder count.",
    });
    if (standard === "ERC721" && samples.length > 0) {
      const owners = await mapWithConcurrency(samples, this.ownerConcurrency, async (tokenId) => {
        try {
          const data = encodeFunctionData({
            abi: ERC721_ABI,
            functionName: "ownerOf",
            args: [BigInt(tokenId)],
          });
          const result = boundedRpcResult(await this.rpc(
            "eth_call",
            [{ to: address, data }, evidenceTag],
          ));
          const owner = normalizeAddress(getAddress(decodeFunctionResult({
            abi: ERC721_ABI,
            functionName: "ownerOf",
            data: result,
          })));
          if (owner === ZERO_ADDRESS) throw new TypeError("ownerOf returned the zero address");
          return Object.freeze({ tokenId, owner });
        } catch {
          return Object.freeze({ tokenId, owner: null });
        }
      });
      const resolved = owners.filter(({ owner }) => owner);
      const ownershipCounts = new Map();
      for (const { owner } of resolved) {
        ownershipCounts.set(owner, (ownershipCounts.get(owner) ?? 0) + 1);
      }
      const maximumTokensPerOwner = resolved.length
        ? Math.max(...ownershipCounts.values())
        : null;
      ownerSample = Object.freeze({
        status: resolved.length ? "SAMPLED" : "UNAVAILABLE",
        requested: samples.length,
        resolved: resolved.length,
        uniqueOwners: ownershipCounts.size,
        maximumTokensPerOwner,
        concentrationPercentage: maximumTokensPerOwner === null
          ? null
          : Math.round((maximumTokensPerOwner / resolved.length) * 10_000) / 100,
        ownersByToken: Object.freeze(owners),
        caveat: "A bounded token sample is not the collection's holder count or full concentration distribution.",
      });
    }

    let metadata = Object.freeze({
      status: samples.length ? "UNAVAILABLE" : "NO_TOKEN_SAMPLE",
      tokenId: samples[0] ?? null,
      failureType: null,
      art: classifyMetadataArt(Object.freeze({ attributes: Object.freeze([]) })),
    });
    if (samples.length > 0 && standard !== "UNKNOWN") {
      const functionName = standard === "ERC721" ? "tokenURI" : "uri";
      const abi = standard === "ERC721" ? ERC721_ABI : ERC1155_ABI;
      try {
        const data = encodeFunctionData({
          abi,
          functionName,
          args: [BigInt(samples[0])],
        });
        const result = boundedRpcResult(await this.rpc(
          "eth_call",
          [{ to: address, data }, evidenceTag],
        ));
        const uri = decodeFunctionResult({ abi, functionName, data: result });
        metadata = Object.freeze({ tokenId: samples[0], ...analyzeTokenUri(uri) });
      } catch (error) {
        metadata = Object.freeze({
          status: "UNAVAILABLE",
          tokenId: samples[0],
          failureType: error?.name ?? "Error",
          art: classifyMetadataArt(Object.freeze({ attributes: Object.freeze([]) })),
          caveat: "The metadata probe failed closed; no remote fallback was attempted.",
        });
      }
    }

    return Object.freeze({
      chainId: this.chainId,
      address,
      standard,
      observedAt: observedDate(this.clock),
      observedBlock: evidenceBlock.toString(),
      observedBlockHash,
      observedBlockTimestamp: observedBlockTimestamp.toString(),
      identity,
      ownerSample,
      metadata,
      executionEligible: false,
    });
  }
}
