import { createHash } from "node:crypto";

import { normalizeAddress } from "../config.mjs";
import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";
import {
  CLONE_COLLECTION_RUNTIME_CODE_HASH,
  SEA_DROP,
  SEA_DROP_CODE_HASH,
  SEA_DROP_MINT_PUBLIC_SELECTOR,
  STUDIO_COLLECTION_RUNTIME_CODE_HASH,
} from "../recommendation/automated-seadrop-v3-run-plan.mjs";

export const AUTOMATED_V3_SCREEN_SCHEMA = "GOGH_AUTOMATED_SEADROP_V3_SCREEN_V1";

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function snapshot(value, label) {
  try {
    const serialized = canonicalJson(value);
    structuredClone(value);
    return parseCanonicalJson(serialized);
  } catch {
    fail("INVALID_JSON", `${label} must be immutable plain JSON without accessors or Proxies`);
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SCHEMA", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCHEMA", `${label} contains missing or unknown fields`);
  }
}

function address(value, label) {
  try {
    return normalizeAddress(value, label);
  } catch {
    fail("INVALID_ADDRESS", `${label} must be a 20-byte EVM address`);
  }
}

function hash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)
    || /^0x0{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} must be a nonzero lowercase bytes32`);
  }
  return value;
}

function decimal(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("INVALID_VALUE", `${label} must be a canonical unsigned decimal string`);
  }
  return BigInt(value);
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("INVALID_VALUE", `${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function isoSeconds(value, label) {
  if (typeof value !== "string") fail("INVALID_TIME", `${label} must be an ISO timestamp`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail("INVALID_TIME", `${label} must be a canonical UTC ISO timestamp`);
  }
  return Math.floor(milliseconds / 1_000);
}

function registrableDomain(hostname) {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  const compound = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz"]);
  const tail = labels.slice(-2).join(".");
  return compound.has(tail) && labels.length >= 3 ? labels.slice(-3).join(".") : tail;
}

function origins(options) {
  const output = [];
  for (const [key, label] of [["primaryOrigin", "primary"], ["secondaryOrigin", "secondary"]]) {
    try {
      const parsed = new URL(options[key]);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password
        || parsed.origin !== options[key]) throw new TypeError();
      output.push({ origin: parsed.origin, domain: registrableDomain(parsed.hostname) });
    } catch {
      fail("INVALID_PROVIDER", `${label} origin must be one credential-free exact HTTPS origin`);
    }
  }
  if (output[0].origin === output[1].origin || output[0].domain === output[1].domain) {
    fail("SAME_PROVIDER", "screening requires distinct registrable provider domains");
  }
  return output;
}

function normalizeObservation(input, label, candidate, nowSeconds, maximumAgeSeconds) {
  const value = snapshot(input, label);
  exactKeys(value, [
    "chainId", "checkedAt", "blockNumber", "blockHash", "blockTimestamp", "collection",
    "collectionCodeHash", "collectionRuntimeLength", "seaDropCodeHash", "explicitlyDenied",
    "drop", "mintStats", "feeRecipientAllowed", "simulation",
  ], label);
  if (value.chainId !== 4663) fail("WRONG_CHAIN", `${label} must bind Robinhood chain 4663`);
  const checkedAt = isoSeconds(value.checkedAt, `${label}.checkedAt`);
  const blockTimestamp = isoSeconds(value.blockTimestamp, `${label}.blockTimestamp`);
  if (checkedAt > nowSeconds || nowSeconds - checkedAt > maximumAgeSeconds
    || blockTimestamp > checkedAt || checkedAt - blockTimestamp > maximumAgeSeconds) {
    fail("STALE_EVIDENCE", `${label} is stale`);
  }
  const blockNumber = decimal(value.blockNumber, `${label}.blockNumber`);
  const collection = address(value.collection, `${label}.collection`);
  if (collection !== candidate.collection) fail("TARGET_CHANGED", `${label} collection changed`);
  const cloneRuntime = value.collectionCodeHash === CLONE_COLLECTION_RUNTIME_CODE_HASH
    && value.collectionRuntimeLength === 45;
  const studioRuntime = value.collectionCodeHash === STUDIO_COLLECTION_RUNTIME_CODE_HASH
    && value.collectionRuntimeLength === 19_658;
  if ((!cloneRuntime && !studioRuntime) || value.seaDropCodeHash !== SEA_DROP_CODE_HASH) {
    fail("CODE_MISMATCH", `${label} code does not match a reviewed OpenSea Studio path`);
  }
  if (value.explicitlyDenied !== false) fail("TARGET_DENIED", `${label} is explicitly denied`);

  exactKeys(value.drop, [
    "mintPriceWei", "startTime", "endTime", "maxTotalMintableByWallet",
    "restrictFeeRecipients",
  ], `${label}.drop`);
  const mintPrice = decimal(value.drop.mintPriceWei, `${label}.drop.mintPriceWei`);
  const startTime = decimal(value.drop.startTime, `${label}.drop.startTime`);
  const endTime = decimal(value.drop.endTime, `${label}.drop.endTime`);
  const walletMaximum = decimal(
    value.drop.maxTotalMintableByWallet,
    `${label}.drop.maxTotalMintableByWallet`,
  );
  if (mintPrice !== 0n || startTime > BigInt(blockTimestamp) || endTime < BigInt(blockTimestamp)
    || walletMaximum === 0n || typeof value.drop.restrictFeeRecipients !== "boolean") {
    fail("DROP_INELIGIBLE", `${label} public drop is not an active zero-price drop`);
  }
  if (typeof value.feeRecipientAllowed !== "boolean"
    || value.drop.restrictFeeRecipients && !value.feeRecipientAllowed) {
    fail("FEE_RECIPIENT_REJECTED", `${label} rejects the pinned fee recipient`);
  }

  exactKeys(value.mintStats, [
    "minterNumMinted", "currentTotalMinted", "maxSupply",
  ], `${label}.mintStats`);
  const minterNumMinted = decimal(
    value.mintStats.minterNumMinted,
    `${label}.mintStats.minterNumMinted`,
  );
  const currentTotalMinted = decimal(
    value.mintStats.currentTotalMinted,
    `${label}.mintStats.currentTotalMinted`,
  );
  const maxSupply = decimal(value.mintStats.maxSupply, `${label}.mintStats.maxSupply`);
  if (minterNumMinted >= walletMaximum || currentTotalMinted >= maxSupply) {
    fail("CAPACITY_EXHAUSTED", `${label} has no wallet or supply capacity`);
  }

  exactKeys(value.simulation, [
    "succeeded", "target", "valueWei", "selector", "tokenId", "gasEstimate",
  ], `${label}.simulation`);
  if (value.simulation.succeeded !== true
    || address(value.simulation.target, `${label}.simulation.target`) !== SEA_DROP
    || value.simulation.valueWei !== "0"
    || value.simulation.selector !== SEA_DROP_MINT_PUBLIC_SELECTOR) {
    fail("SIMULATION_FAILED", `${label} exact account simulation failed`);
  }
  const nextTokenId = decimal(value.simulation.tokenId, `${label}.simulation.tokenId`);
  const gasEstimate = decimal(value.simulation.gasEstimate, `${label}.simulation.gasEstimate`);
  if (nextTokenId !== currentTotalMinted + 1n || gasEstimate === 0n) {
    fail("SIMULATION_FAILED", `${label} simulated token or gas is invalid`);
  }
  return {
    chainId: 4663,
    checkedAt: value.checkedAt,
    blockNumber: blockNumber.toString(),
    blockHash: hash(value.blockHash, `${label}.blockHash`),
    blockTimestamp: value.blockTimestamp,
    collection,
    collectionCodeHash: value.collectionCodeHash,
    collectionRuntimeLength: value.collectionRuntimeLength,
    seaDropCodeHash: SEA_DROP_CODE_HASH,
    explicitlyDenied: false,
    drop: {
      mintPriceWei: "0",
      startTime: startTime.toString(),
      endTime: endTime.toString(),
      maxTotalMintableByWallet: walletMaximum.toString(),
      restrictFeeRecipients: value.drop.restrictFeeRecipients,
    },
    mintStats: {
      minterNumMinted: minterNumMinted.toString(),
      currentTotalMinted: currentTotalMinted.toString(),
      maxSupply: maxSupply.toString(),
    },
    feeRecipientAllowed: value.feeRecipientAllowed,
    simulation: {
      succeeded: true,
      target: SEA_DROP,
      valueWei: "0",
      selector: SEA_DROP_MINT_PUBLIC_SELECTOR,
      tokenId: nextTokenId.toString(),
      gasEstimate: gasEstimate.toString(),
    },
  };
}

function sha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function screenAutomatedSeaDropV3Candidate(
  candidateInput,
  primaryObservationInput,
  secondaryObservationInput,
  optionsInput,
) {
  const candidate = snapshot(candidateInput, "candidate");
  const options = snapshot(optionsInput, "options");
  exactKeys(candidate, [
    "collection", "opportunityId", "reasoningHash", "contractRiskScore", "tasteMatch",
    "metadataSanitized", "analysisComplete",
  ], "candidate");
  const normalizedCandidate = {
    collection: address(candidate.collection, "candidate.collection"),
    opportunityId: hash(candidate.opportunityId, "candidate.opportunityId"),
    reasoningHash: hash(candidate.reasoningHash, "candidate.reasoningHash"),
    contractRiskScore: integer(
      candidate.contractRiskScore, 0, 100, "candidate.contractRiskScore",
    ),
    tasteMatch: integer(candidate.tasteMatch, 0, 100, "candidate.tasteMatch"),
    metadataSanitized: candidate.metadataSanitized,
    analysisComplete: candidate.analysisComplete,
  };
  if (normalizedCandidate.metadataSanitized !== true
    || normalizedCandidate.analysisComplete !== true) {
    fail("ANALYSIS_INCOMPLETE", "candidate analysis and sanitized metadata are required");
  }
  exactKeys(options, [
    "nowSeconds", "maximumEvidenceAgeSeconds", "primaryOrigin", "secondaryOrigin",
  ], "options");
  const nowSeconds = integer(options.nowSeconds, 1, Number.MAX_SAFE_INTEGER, "options.nowSeconds");
  const maximumAge = integer(
    options.maximumEvidenceAgeSeconds,
    5,
    30,
    "options.maximumEvidenceAgeSeconds",
  );
  const providers = origins(options);
  const primary = normalizeObservation(
    primaryObservationInput,
    "primary",
    normalizedCandidate,
    nowSeconds,
    maximumAge,
  );
  const secondary = normalizeObservation(
    secondaryObservationInput,
    "secondary",
    normalizedCandidate,
    nowSeconds,
    maximumAge,
  );
  if (canonicalJson(primary) !== canonicalJson(secondary)) {
    fail("RPC_DISAGREEMENT", "distinct providers disagree on the exact screening evidence");
  }

  const walletRemaining = BigInt(primary.drop.maxTotalMintableByWallet)
    - BigInt(primary.mintStats.minterNumMinted);
  const supplyRemaining = BigInt(primary.mintStats.maxSupply)
    - BigInt(primary.mintStats.currentTotalMinted);
  const target = {
    collection: primary.collection,
    collectionCodeHash: primary.collectionCodeHash,
    collectionRuntimeLength: primary.collectionRuntimeLength,
    explicitlyDenied: false,
    dropActive: true,
    mintPriceWei: "0",
    walletRemaining: walletRemaining.toString(),
    supplyRemaining: supplyRemaining.toString(),
    nextTokenId: primary.simulation.tokenId,
    restrictFeeRecipients: primary.drop.restrictFeeRecipients,
    feeRecipientAllowed: primary.feeRecipientAllowed,
    contractRiskScore: normalizedCandidate.contractRiskScore,
    tasteMatch: normalizedCandidate.tasteMatch,
    metadataSanitized: true,
    analysisComplete: true,
    simulationSucceeded: true,
    simulationTarget: SEA_DROP,
    simulationValueWei: "0",
    simulationSelector: SEA_DROP_MINT_PUBLIC_SELECTOR,
    gasEstimate: primary.simulation.gasEstimate,
    opportunityId: normalizedCandidate.opportunityId,
    reasoningHash: normalizedCandidate.reasoningHash,
  };
  const evidence = {
    schema: AUTOMATED_V3_SCREEN_SCHEMA,
    version: 1,
    chainId: 4663,
    checkedAt: primary.checkedAt,
    blockNumber: primary.blockNumber,
    blockHash: primary.blockHash,
    providers: {
      primaryOrigin: providers[0].origin,
      secondaryOrigin: providers[1].origin,
      distinctRegistrableDomains: true,
      providerIndependenceVerified: false,
      transportProvenanceVerified: false,
    },
    target,
    safety: {
      humanTargetReviewRequired: false,
      suppliedDualRpcEvidenceAgrees: true,
      reviewedCollectionRuntime:
        primary.collectionRuntimeLength === 45 ? "ERC721_CLONE" : "ERC721_STANDARD",
      exactSeaDropRuntime: true,
      activeZeroPricePublicDrop: true,
      exactAccountSimulation: true,
      quantityOne: true,
      approvalsAllowed: false,
      arbitraryCalldataAllowed: false,
      submissionPerformed: false,
      chainStateWritten: false,
    },
  };
  return Object.freeze({ ...evidence, evidenceHash: sha256(evidence) });
}
