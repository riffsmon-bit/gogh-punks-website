import { createHash } from "node:crypto";

import { decodeFunctionData, encodeFunctionData, keccak256 } from "viem";

import { parseOpenSeaMintUrl } from "../control-center/directed-opensea.mjs";
import { SEA_DROP } from "../recommendation/automated-seadrop-v3-run-plan.mjs";
import { createOpenSeaDropsClient } from "./opensea-drops-client.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const OPEN_SEA_FEE_RECIPIENT = "0x0000a26b00c1f0df003000390027140000faa719";
const ZERO_ADDRESS = `0x${"00".repeat(20)}`;
const MINT_PUBLIC_ABI = Object.freeze([{
  type: "function",
  name: "mintPublic",
  stateMutability: "payable",
  inputs: [
    { name: "nftContract", type: "address" },
    { name: "feeRecipient", type: "address" },
    { name: "minterIfNotPayer", type: "address" },
    { name: "quantity", type: "uint256" },
  ],
  outputs: [],
}]);

export class OpenSeaDirectedReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OpenSeaDirectedReviewError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new OpenSeaDirectedReviewError(code, message);
}

function address(value, label) {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    fail("INVALID_IDENTITY", `${label} is invalid.`);
  }
  return value.toLowerCase();
}

function boundedText(value, maximum) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean && clean.length <= maximum ? clean : null;
}

function own(value, key) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.hasOwn(value, key) ? value[key] : undefined;
}

function dropSummary(raw, parsed) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("UNVERIFIED_DROP", "OpenSea drop details are invalid.");
  }
  const collection = own(raw, "collection");
  const name = boundedText(own(raw, "name"), 160)
    ?? boundedText(own(raw, "collection_name"), 160)
    ?? boundedText(own(collection, "name"), 160)
    ?? parsed.slug;
  const chain = (boundedText(own(raw, "chain"), 64)
    ?? boundedText(own(collection, "chain"), 64)
    ?? "UNVERIFIED").toLowerCase();
  return Object.freeze({
    collectionName: name,
    chain,
    chainVerified: chain === "robinhood",
    detailsRetrieved: true,
  });
}

function proposalReview(proposal, account, chainVerified) {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: MINT_PUBLIC_ABI, data: proposal.calldata });
  } catch {
    fail("UNSUPPORTED_MINT", "OpenSea returned a mint method that is not currently supported.");
  }
  if (decoded.functionName !== "mintPublic" || decoded.args.length !== 4) {
    fail("UNSUPPORTED_MINT", "OpenSea returned a mint method that is not currently supported.");
  }
  const collection = address(decoded.args[0], "mint collection");
  const feeRecipient = address(decoded.args[1], "fee recipient");
  const minterIfNotPayer = address(decoded.args[2], "mint recipient");
  const quantity = BigInt(decoded.args[3]);
  const canonical = encodeFunctionData({
    abi: MINT_PUBLIC_ABI,
    functionName: "mintPublic",
    args: [collection, feeRecipient, minterIfNotPayer, quantity],
  }).toLowerCase();
  if (canonical !== proposal.calldata || quantity !== 1n) {
    fail("UNSUPPORTED_MINT", "OpenSea mint calldata is not canonical quantity-one SeaDrop data.");
  }
  const valueWei = BigInt(proposal.valueWei);
  const exactVenue = proposal.target === SEA_DROP;
  const exactFeeRecipient = feeRecipient === OPEN_SEA_FEE_RECIPIENT;
  const recipientCompatible = minterIfNotPayer === ZERO_ADDRESS
    || minterIfNotPayer === account;
  const currentFreeAdapterCompatible = chainVerified && exactVenue && exactFeeRecipient
    && minterIfNotPayer === ZERO_ADDRESS && valueWei === 0n;
  return Object.freeze({
    target: proposal.target,
    collection,
    feeRecipient,
    minterIfNotPayer,
    quantity: 1,
    valueWei: valueWei.toString(),
    priceKind: valueWei === 0n ? "FREE" : "PAID",
    calldataKeccak256: keccak256(proposal.calldata),
    exactVenue,
    exactFeeRecipient,
    recipientCompatible,
    currentFreeAdapterCompatible,
  });
}

function reviewId(value) {
  return `osr_${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.getPrototypeOf(input) !== Object.prototype) {
    fail("INVALID_REQUEST", "Mint review request is invalid.");
  }
  const keys = Object.keys(input).sort();
  const expected = ["action", "tokenId", "url", "walletAddress"].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail("INVALID_REQUEST", "Mint review request contains missing or unknown fields.");
  }
  if (!new Set(["inspect", "prepare"]).has(input.action)
    || typeof input.tokenId !== "string" || !/^(?:0|[1-9][0-9]{0,3})$/.test(input.tokenId)) {
    fail("INVALID_REQUEST", "Choose a valid Punk and review action.");
  }
  return Object.freeze({
    action: input.action,
    tokenId: input.tokenId,
    url: input.url,
    walletAddress: address(input.walletAddress, "connected wallet"),
  });
}

export async function reviewOpenSeaMintForPunk(input, options = {}) {
  const request = validateInput(input);
  const parsed = parseOpenSeaMintUrl(request.url);
  const readPunk = options.readPunk;
  if (typeof readPunk !== "function") fail("SERVICE_UNAVAILABLE", "Live Punk verification is unavailable.");
  const punk = await readPunk(request.tokenId);
  if (!punk || punk.tokenId !== request.tokenId || punk.created !== true) {
    fail("PUNK_NOT_ACTIVE", `Punk #${request.tokenId} does not have an active V3 wallet.`);
  }
  const owner = address(punk.owner, "current Punk owner");
  const account = address(punk.account, "Punk Wallet");
  if (owner !== request.walletAddress) {
    fail("OWNERSHIP_CHANGED", `The connected wallet does not currently own Punk #${request.tokenId}.`);
  }
  const client = createOpenSeaDropsClient({
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
  });
  const details = dropSummary(await client.getDrop(parsed.slug), parsed);
  const base = {
    tokenId: request.tokenId,
    punkWallet: account,
    currentOwner: owner,
    sourceUrl: parsed.canonicalUrl,
    slug: parsed.slug,
    collectionName: details.collectionName,
    chain: details.chain,
    chainVerified: details.chainVerified,
    detailsRetrieved: details.detailsRetrieved,
  };
  if (request.action === "inspect") {
    return Object.freeze({
      ...base,
      status: "DROP_DETAILS_RETRIEVED",
      executionReady: false,
      message: details.chainVerified
        ? "OpenSea drop details were retrieved. Prepare a bounded proposal to check the exact mint call."
        : "OpenSea drop details were retrieved, but Robinhood Chain could not yet be verified.",
    });
  }
  const proposal = await client.buildMintTransaction(parsed.slug, {
    minter: account,
    quantity: 1,
  });
  const decoded = proposalReview(proposal, account, details.chainVerified);
  const generatedAt = new Date(options.nowMs ?? Date.now()).toISOString();
  const result = {
    ...base,
    status: decoded.currentFreeAdapterCompatible
      ? "BOUNDED_PROPOSAL_REVIEWED" : "PROPOSAL_REQUIRES_ADDITIONAL_VALIDATION",
    executionReady: false,
    simulationPerformed: false,
    generatedAt,
    proposal: decoded,
    safety: {
      quantityOneOnly: true,
      exactRecipientChecked: decoded.recipientCompatible,
      arbitraryCalldataAllowed: false,
      approvalsAllowed: false,
      ownerWalletSpendingAllowed: false,
      signingPerformed: false,
      submissionPerformed: false,
    },
    message: decoded.currentFreeAdapterCompatible
      ? "The OpenSea proposal matches the current free SeaDrop call shape. A fresh live runtime screen and full Punk Account simulation are still required before execution."
      : "The proposal does not match every current free-adapter boundary. It will not be submitted.",
  };
  return Object.freeze({ ...result, reviewId: reviewId(result) });
}
