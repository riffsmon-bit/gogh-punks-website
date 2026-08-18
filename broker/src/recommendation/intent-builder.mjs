import { FEATURE_DEFAULTS, ROBINHOOD, normalizeAddress } from "../config.mjs";

const MINT_TYPES = new Set(["MINT", "FREE_MINT", "EDITION", "ALLOWLIST_MINT", "COLLECTION_DROP"]);

export class IntentBuildError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IntentBuildError";
    this.code = code;
  }
}

export function buildAcquisitionIntent(request, controls = {}) {
  const flags = { ...FEATURE_DEFAULTS, ...(controls.featureFlags ?? {}) };
  if (request.arbitraryCalldata || request.calldata || request.target) {
    throw new IntentBuildError("ARBITRARY_CALLDATA_REJECTED", "Only typed acquisition fields are accepted");
  }
  if (!controls.ownerApproved && !flags.ENABLE_AUTONOMOUS_PURCHASES) {
    throw new IntentBuildError("AUTONOMY_DISABLED", "Autonomous purchases are disabled");
  }
  if (controls.ownerApproved && !flags.ENABLE_APPROVAL_PURCHASES) {
    throw new IntentBuildError("APPROVAL_DISABLED", "Approval purchases are disabled");
  }
  if (MINT_TYPES.has(request.opportunityType) && !controls.ownerApproved) {
    if (!flags.ENABLE_AUTONOMOUS_MINTS) {
      throw new IntentBuildError("AUTONOMOUS_MINT_DISABLED", "Autonomous minting is disabled");
    }
    if (!controls.systemAllowlistedMint && !controls.ownerAllowlistedMint) {
      throw new IntentBuildError("MINT_NOT_ALLOWLISTED", "Mint contract is not allowlisted");
    }
  }
  if (!controls.collectionAllowlisted && !controls.ownerApproved) {
    if (!flags.ENABLE_UNKNOWN_COLLECTION_EXECUTION) {
      throw new IntentBuildError("UNKNOWN_COLLECTION_DISABLED", "Unknown collection execution is disabled");
    }
  }
  const nowSeconds = BigInt(controls.nowSeconds ?? Math.floor(Date.now() / 1_000));
  const expiresAt = BigInt(request.expiresAt);
  if (expiresAt <= nowSeconds) throw new IntentBuildError("INTENT_EXPIRED", "Intent has expired");
  return Object.freeze({
    account: normalizeAddress(request.account, "account"),
    chainId: ROBINHOOD.chainId,
    expectedOwner: normalizeAddress(request.expectedOwner, "expectedOwner"),
    nonce: BigInt(request.nonce).toString(),
    policyVersion: Number(request.policyVersion),
    opportunityType: request.opportunityType,
    assetStandard: request.assetStandard,
    adapter: normalizeAddress(request.adapter, "adapter"),
    venue: normalizeAddress(request.venue, "venue"),
    collection: normalizeAddress(request.collection, "collection"),
    tokenId: BigInt(request.tokenId).toString(),
    assetAmount: BigInt(request.assetAmount ?? 1).toString(),
    currency: normalizeAddress(
      request.currency ?? "0x0000000000000000000000000000000000000000",
      "currency",
    ),
    expectedPrice: BigInt(request.expectedPrice).toString(),
    maxPrice: BigInt(request.maxPrice).toString(),
    maxSlippageBps: Number(request.maxSlippageBps),
    createdAt: Number(nowSeconds),
    expiresAt: Number(expiresAt),
    opportunityId: request.opportunityId,
    reasoningHash: request.reasoningHash,
    adapterCodeHash: request.adapterCodeHash,
  });
}
