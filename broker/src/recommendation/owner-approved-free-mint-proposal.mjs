import { createHash } from "node:crypto";
import { hashTypedData } from "viem";
import { ROBINHOOD, normalizeAddress } from "../config.mjs";
import { buildAcquisitionIntent, IntentBuildError } from "./intent-builder.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const EMPTY_ADAPTER_DATA_HASH = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_EXPIRY_SECONDS = 120n;
const ASSET_STANDARDS = new Set(["ERC721", "ERC1155"]);
const ALLOWED_INPUT_FIELDS = new Set([
  "chainId",
  "punkCollection",
  "punkTokenId",
  "punkAccount",
  "expectedOwner",
  "ownerReview",
  "opportunityType",
  "assetStandard",
  "adapter",
  "venue",
  "collection",
  "mintSelector",
  "tokenId",
  "assetAmount",
  "currency",
  "expectedPrice",
  "maxPrice",
  "maxSlippageBps",
  "expiresAt",
  "nonce",
  "policyVersion",
  "opportunityId",
  "reasoningHash",
  "adapterCodeHash",
]);

export class FreeMintProposalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FreeMintProposalError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new FreeMintProposalError(code, message);
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_INPUT", `${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_INPUT", `${label} must be a plain object`);
  }
}

function rejectUnknownFields(input) {
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !ALLOWED_INPUT_FIELDS.has(key)) {
      fail("UNKNOWN_FIELD", `Unsupported proposal field: ${String(key)}`);
    }
  }
  for (const key of ALLOWED_INPUT_FIELDS) {
    if (!Object.hasOwn(input, key)) fail("MISSING_FIELD", `Missing proposal field: ${key}`);
  }
}

function decimalInteger(value, field, { maximum = MAX_UINT256, positive = false } = {}) {
  let text;
  if (typeof value === "bigint") text = value.toString();
  else if (typeof value === "number" && Number.isSafeInteger(value)) text = String(value);
  else if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) text = value;
  else fail("INVALID_INTEGER", `${field} must be an unsigned decimal integer`);
  const parsed = BigInt(text);
  if (parsed > maximum || (positive && parsed === 0n)) {
    fail("INVALID_INTEGER", `${field} is outside its permitted range`);
  }
  return parsed;
}

function exactInteger(value, expected, field) {
  if (decimalInteger(value, field) !== expected) {
    fail("INVALID_FIXED_VALUE", `${field} must be exactly ${expected}`);
  }
}

function address(value, field) {
  let normalized;
  try {
    normalized = normalizeAddress(value, field);
  } catch (error) {
    fail("INVALID_ADDRESS", error.message);
  }
  return normalized;
}

function nonzeroAddress(value, field) {
  const normalized = address(value, field);
  if (normalized === ZERO_ADDRESS) fail("ZERO_ADDRESS", `${field} cannot be the zero address`);
  return normalized;
}

function bytes32(value, field) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_BYTES32", `${field} must be exactly 32 bytes`);
  }
  const normalized = value.toLowerCase();
  if (normalized === ZERO_BYTES32) fail("ZERO_BYTES32", `${field} cannot be zero`);
  return normalized;
}

function nonzeroBytes4(value, field) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(value)) {
    fail("INVALID_BYTES4", `${field} must be exactly 4 bytes`);
  }
  const normalized = value.toLowerCase();
  if (normalized === "0x00000000") fail("ZERO_BYTES4", `${field} cannot be zero`);
  return normalized;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeNow(nowSeconds) {
  const value = nowSeconds ?? Math.floor(Date.now() / 1_000);
  const parsed = decimalInteger(value, "nowSeconds", { maximum: MAX_UINT64 });
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("INVALID_TIME", "nowSeconds exceeds safe local JSON precision");
  }
  return parsed;
}

function verifyBuiltIntent(intent, expected) {
  const invariantFields = [
    "account",
    "chainId",
    "expectedOwner",
    "nonce",
    "policyVersion",
    "opportunityType",
    "assetStandard",
    "adapter",
    "venue",
    "collection",
    "tokenId",
    "assetAmount",
    "currency",
    "expectedPrice",
    "maxPrice",
    "maxSlippageBps",
    "createdAt",
    "expiresAt",
    "opportunityId",
    "reasoningHash",
    "adapterCodeHash",
  ];
  const actualKeys = Object.keys(intent).sort();
  const expectedKeys = [...invariantFields].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail("UNEXPECTED_INTENT_SHAPE", "Typed intent shape changed and requires security review");
  }
  for (const field of invariantFields) {
    if (intent[field] !== expected[field]) {
      fail("INTENT_INVARIANT_FAILURE", `Typed intent changed the reviewed ${field} field`);
    }
  }
}

const ACQUISITION_INTENT_TYPES = Object.freeze({
  AcquisitionIntent: Object.freeze([
    Object.freeze({ name: "account", type: "address" }),
    Object.freeze({ name: "chainId", type: "uint256" }),
    Object.freeze({ name: "expectedOwner", type: "address" }),
    Object.freeze({ name: "nonce", type: "uint256" }),
    Object.freeze({ name: "policyVersion", type: "uint64" }),
    Object.freeze({ name: "opportunityType", type: "uint8" }),
    Object.freeze({ name: "assetStandard", type: "uint8" }),
    Object.freeze({ name: "adapter", type: "address" }),
    Object.freeze({ name: "venue", type: "address" }),
    Object.freeze({ name: "collection", type: "address" }),
    Object.freeze({ name: "tokenId", type: "uint256" }),
    Object.freeze({ name: "assetAmount", type: "uint256" }),
    Object.freeze({ name: "currency", type: "address" }),
    Object.freeze({ name: "expectedPrice", type: "uint256" }),
    Object.freeze({ name: "maxPrice", type: "uint256" }),
    Object.freeze({ name: "maxSlippageBps", type: "uint16" }),
    Object.freeze({ name: "createdAt", type: "uint64" }),
    Object.freeze({ name: "expiresAt", type: "uint64" }),
    Object.freeze({ name: "opportunityId", type: "bytes32" }),
    Object.freeze({ name: "reasoningHash", type: "bytes32" }),
    Object.freeze({ name: "adapterCodeHash", type: "bytes32" }),
    Object.freeze({ name: "adapterDataHash", type: "bytes32" }),
  ]),
});

function acquisitionIntentDigest(intent) {
  const domain = Object.freeze({
    name: "Gogh Punk Account",
    version: "1",
    chainId: ROBINHOOD.chainId,
    verifyingContract: intent.account,
  });
  const opportunityType = 2; // GoghBrokerTypes.OpportunityType.FREE_MINT
  const assetStandard = intent.assetStandard === "ERC721" ? 0 : 1;
  const message = {
    account: intent.account,
    chainId: BigInt(intent.chainId),
    expectedOwner: intent.expectedOwner,
    nonce: BigInt(intent.nonce),
    policyVersion: BigInt(intent.policyVersion),
    opportunityType,
    assetStandard,
    adapter: intent.adapter,
    venue: intent.venue,
    collection: intent.collection,
    tokenId: BigInt(intent.tokenId),
    assetAmount: BigInt(intent.assetAmount),
    currency: intent.currency,
    expectedPrice: BigInt(intent.expectedPrice),
    maxPrice: BigInt(intent.maxPrice),
    maxSlippageBps: intent.maxSlippageBps,
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt,
    opportunityId: intent.opportunityId,
    reasoningHash: intent.reasoningHash,
    adapterCodeHash: intent.adapterCodeHash,
    adapterDataHash: EMPTY_ADAPTER_DATA_HASH,
  };
  return Object.freeze({
    domain,
    primaryType: "AcquisitionIntent",
    adapterDataPolicy: "EMPTY_ONLY",
    adapterDataHash: EMPTY_ADAPTER_DATA_HASH,
    intentDigest: hashTypedData({
      domain,
      types: ACQUISITION_INTENT_TYPES,
      primaryType: "AcquisitionIntent",
      message,
    }),
    derivation: "LOCAL_CURRENT_GOGH_PUNK_ACCOUNT_V1",
    liveDeploymentVerified: false,
    ownerApprovalObtained: false,
  });
}

export function buildOwnerReviewFreeMintProposal(input, { nowSeconds } = {}) {
  requirePlainObject(input, "proposal input");
  rejectUnknownFields(input);

  exactInteger(input.chainId, BigInt(ROBINHOOD.chainId), "chainId");
  const punkCollection = nonzeroAddress(input.punkCollection, "punkCollection");
  if (punkCollection !== ROBINHOOD.canonicalCollection) {
    fail("NONCANONICAL_PUNK", "punkCollection must be the canonical Robinhood Gogh Punks contract");
  }
  const punkTokenId = decimalInteger(input.punkTokenId, "punkTokenId").toString();
  const punkAccount = nonzeroAddress(input.punkAccount, "punkAccount");
  const expectedOwner = nonzeroAddress(input.expectedOwner, "expectedOwner");

  if (input.ownerReview !== true) {
    fail("OWNER_REVIEW_REQUIRED", "ownerReview must be exactly true for this local review artifact");
  }
  if (input.opportunityType !== "FREE_MINT") {
    fail("FREE_MINT_ONLY", "opportunityType must be exactly FREE_MINT");
  }
  if (!ASSET_STANDARDS.has(input.assetStandard)) {
    fail("INVALID_ASSET_STANDARD", "assetStandard must be ERC721 or ERC1155");
  }
  exactInteger(input.assetAmount, 1n, "assetAmount");
  if (address(input.currency, "currency") !== ZERO_ADDRESS) {
    fail("NATIVE_CURRENCY_ONLY", "currency must be the native zero address");
  }
  exactInteger(input.expectedPrice, 0n, "expectedPrice");
  exactInteger(input.maxPrice, 0n, "maxPrice");
  exactInteger(input.maxSlippageBps, 0n, "maxSlippageBps");

  const adapter = nonzeroAddress(input.adapter, "adapter");
  const venue = nonzeroAddress(input.venue, "venue");
  const collection = nonzeroAddress(input.collection, "collection");
  const mintSelector = nonzeroBytes4(input.mintSelector, "mintSelector");
  const tokenId = decimalInteger(input.tokenId, "tokenId").toString();
  const nonce = decimalInteger(input.nonce, "nonce").toString();
  const policyVersionValue = decimalInteger(input.policyVersion, "policyVersion", {
    maximum: MAX_UINT64,
    positive: true,
  });
  if (policyVersionValue > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("INVALID_POLICY_VERSION", "policyVersion exceeds safe local JSON precision");
  }

  const createdAt = normalizeNow(nowSeconds);
  const expiresAt = decimalInteger(input.expiresAt, "expiresAt", { maximum: MAX_UINT64 });
  if (expiresAt <= createdAt) fail("INTENT_EXPIRED", "expiresAt must be in the future");
  if (expiresAt - createdAt > MAX_EXPIRY_SECONDS) {
    fail("EXPIRY_TOO_LONG", "free-mint proposals must expire within 120 seconds");
  }
  if (expiresAt > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("INVALID_TIME", "expiresAt exceeds safe local JSON precision");
  }

  const opportunityId = bytes32(input.opportunityId, "opportunityId");
  const reasoningHash = bytes32(input.reasoningHash, "reasoningHash");
  const adapterCodeHash = bytes32(input.adapterCodeHash, "adapterCodeHash");

  let intent;
  try {
    intent = buildAcquisitionIntent({
      account: punkAccount,
      expectedOwner,
      nonce,
      policyVersion: Number(policyVersionValue),
      opportunityType: "FREE_MINT",
      assetStandard: input.assetStandard,
      adapter,
      venue,
      collection,
      tokenId,
      assetAmount: "1",
      currency: ZERO_ADDRESS,
      expectedPrice: "0",
      maxPrice: "0",
      maxSlippageBps: 0,
      expiresAt: expiresAt.toString(),
      opportunityId,
      reasoningHash,
      adapterCodeHash,
    }, {
      ownerApproved: true,
      collectionAllowlisted: true,
      nowSeconds: createdAt.toString(),
      featureFlags: {
        ENABLE_APPROVAL_PURCHASES: true,
        ENABLE_AUTONOMOUS_PURCHASES: false,
        ENABLE_AUTONOMOUS_MINTS: false,
        ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
        ENABLE_SELLING: false,
        ENABLE_AUTONOMOUS_SELLING: false,
      },
    });
  } catch (error) {
    if (error instanceof IntentBuildError) {
      fail(error.code, `Typed intent rejected: ${error.message}`);
    }
    throw error;
  }
  verifyBuiltIntent(intent, {
    account: punkAccount,
    chainId: ROBINHOOD.chainId,
    expectedOwner,
    nonce,
    policyVersion: Number(policyVersionValue),
    opportunityType: "FREE_MINT",
    assetStandard: input.assetStandard,
    adapter,
    venue,
    collection,
    tokenId,
    assetAmount: "1",
    currency: ZERO_ADDRESS,
    expectedPrice: "0",
    maxPrice: "0",
    maxSlippageBps: 0,
    createdAt: Number(createdAt),
    expiresAt: Number(expiresAt),
    opportunityId,
    reasoningHash,
    adapterCodeHash,
  });

  const proposal = {
    schema: "GOGH_OWNER_REVIEW_FREE_MINT_PROPOSAL_V1",
    stage: "LOCAL_OWNER_REVIEW",
    punk: {
      chainId: ROBINHOOD.chainId,
      collection: punkCollection,
      tokenId: punkTokenId,
      account: punkAccount,
      expectedOwner,
    },
    authorization: {
      executionPath: "OWNER_APPROVAL_REQUIRED",
      ownerReviewRequested: true,
      ownerApprovalObtained: false,
      approvalPurchasesStaged: true,
      executionEnabled: false,
      autonomousPurchasesEnabled: false,
      autonomousMintsEnabled: false,
      unknownCollectionExecutionEnabled: false,
      sellingEnabled: false,
    },
    intent,
    eip712: acquisitionIntentDigest(intent),
    humanReview: {
      summary: `Review a zero-price ${input.assetStandard} mint of token ${tokenId} into Gogh Punk ${punkTokenId}'s account.`,
      target: {
        adapter,
        venue,
        collection,
        mintSelector,
        adapterDataPolicy: "EMPTY_ONLY",
        adapterDataHash: EMPTY_ADAPTER_DATA_HASH,
      },
      outputTokenId: tokenId,
      outputAmount: "1",
      totalPrice: "0",
      expiresInSeconds: Number(expiresAt - createdAt),
      requiredChecks: [
        "Verify the live Gogh Punk owner and deterministic Punk Account on Robinhood Chain.",
        "Verify the adapter registration, venue, collection, selector, and adapter runtime code hash.",
        "Verify this adapter and selector require exactly empty adapter data.",
        "Verify the venue will mint the named token into the Punk Account for zero payment.",
        "Obtain a separate owner approval through the eventual deployed account flow.",
      ],
    },
    localArtifacts: {
      signingPerformed: false,
      submissionPerformed: false,
      chainWritePerformed: false,
    },
  };
  const proposalHash = `0x${createHash("sha256").update(canonicalJson(proposal)).digest("hex")}`;
  return deepFreeze({
    hashAlgorithm: "SHA256_CANONICAL_JSON_V1",
    proposalHash,
    proposal,
  });
}
