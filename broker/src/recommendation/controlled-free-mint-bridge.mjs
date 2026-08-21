import { createHash } from "node:crypto";
import { ROBINHOOD, normalizeAddress } from "../config.mjs";
import { normalizeMintOpportunityDecisionEvidence } from "../mandate.mjs";
import { buildPerPunkMintDecisions } from "../scout/mint-decision.mjs";
import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";
import { buildOwnerReviewFreeMintProposal, FreeMintProposalError } from "./owner-approved-free-mint-proposal.mjs";

const CONTROLLED_SELECTOR = "0x40c10f19";
const MAX_UINT256 = (1n << 256n) - 1n;
const BINDING_FIELDS = new Set([
  "schema",
  "targetKind",
  "chainId",
  "punkCollection",
  "punkTokenId",
  "punkAccount",
  "expectedOwner",
  "opportunityId",
  "opportunityHash",
  "decisionHash",
  "recommendationId",
  "reasoningHash",
  "policyVersion",
  "mandateHash",
  "controlsHash",
  "personaKey",
  "decisionInputHash",
  "adapter",
  "adapterCodeHash",
  "venue",
  "collection",
  "collectionCodeHash",
  "mintSelector",
  "outputTokenId",
  "assetStandard",
]);

export class ControlledFreeMintBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ControlledFreeMintBridgeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ControlledFreeMintBridgeError(code, message);
}

function reviewedSnapshot(value, label) {
  try {
    return parseCanonicalJson(canonicalJson(value));
  } catch (error) {
    fail("INVALID_INPUT", `${label} is not strict canonical JSON: ${error.message}`);
  }
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_INPUT", `${label} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_INPUT", `${label} must be a plain object`);
}

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function boundedString(value, field, maximum = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    fail("INVALID_BINDING", `${field} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function bytes32(value, field) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    fail("INVALID_BINDING", `${field} must be a nonzero bytes32 value`);
  }
  return value.toLowerCase();
}

function uint(value, field) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    fail("INVALID_BINDING", `${field} must be a non-negative integer`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) fail("INVALID_BINDING", `${field} exceeds uint256`);
  return parsed.toString();
}

function address(value, field) {
  try {
    const normalized = normalizeAddress(value, field);
    if (/^0x0{40}$/.test(normalized)) fail("INVALID_BINDING", `${field} cannot be zero`);
    return normalized;
  } catch (error) {
    if (error instanceof ControlledFreeMintBridgeError) throw error;
    fail("INVALID_BINDING", error.message);
  }
}

function exactBinding(binding) {
  plainObject(binding, "controlled binding");
  const keys = Reflect.ownKeys(binding);
  if (keys.some((key) => typeof key !== "string" || !BINDING_FIELDS.has(key))) {
    fail("INVALID_BINDING", "controlled binding contains unsupported fields");
  }
  for (const field of BINDING_FIELDS) {
    if (!Object.hasOwn(binding, field)) fail("INVALID_BINDING", `controlled binding is missing ${field}`);
  }
  if (binding.schema !== "GOGH_CONTROLLED_ONE_SHOT_CANARY_BINDING_V1") {
    fail("UNSUPPORTED_TARGET", "only the controlled one-shot canary binding is supported");
  }
  if (binding.targetKind !== "GoghOneShotCanaryArt+GoghOneShotCanaryMintAdapter") {
    fail("UNSUPPORTED_TARGET", "targetKind is not the reviewed controlled canary pair");
  }
  if (binding.chainId !== ROBINHOOD.chainId && binding.chainId !== String(ROBINHOOD.chainId)) {
    fail("WRONG_CHAIN", "binding chain is not Robinhood");
  }
  if (address(binding.punkCollection, "punkCollection") !== ROBINHOOD.canonicalCollection) {
    fail("NONCANONICAL_PUNK", "binding does not use the canonical Gogh Punks collection");
  }
  const venue = address(binding.venue, "venue");
  const collection = address(binding.collection, "collection");
  if (venue !== collection) fail("UNSUPPORTED_TARGET", "controlled canary venue and collection must be identical");
  if (String(binding.mintSelector).toLowerCase() !== CONTROLLED_SELECTOR) {
    fail("UNSUPPORTED_TARGET", "controlled canary must use mint(address,uint256)");
  }
  if (binding.assetStandard !== "ERC721") fail("UNSUPPORTED_TARGET", "controlled canary must be ERC721");
  return {
    ...binding,
    punkCollection: ROBINHOOD.canonicalCollection,
    punkTokenId: uint(binding.punkTokenId, "punkTokenId"),
    punkAccount: address(binding.punkAccount, "punkAccount"),
    expectedOwner: address(binding.expectedOwner, "expectedOwner"),
    opportunityId: boundedString(binding.opportunityId, "opportunityId"),
    opportunityHash: bytes32(binding.opportunityHash, "opportunityHash"),
    decisionHash: bytes32(binding.decisionHash, "decisionHash"),
    recommendationId: boundedString(binding.recommendationId, "recommendationId", 128),
    reasoningHash: bytes32(binding.reasoningHash, "reasoningHash"),
    policyVersion: uint(binding.policyVersion, "policyVersion"),
    mandateHash: bytes32(binding.mandateHash, "mandateHash"),
    controlsHash: bytes32(binding.controlsHash, "controlsHash"),
    personaKey: boundedString(binding.personaKey, "personaKey", 80),
    decisionInputHash: bytes32(binding.decisionInputHash, "decisionInputHash"),
    adapter: address(binding.adapter, "adapter"),
    adapterCodeHash: bytes32(binding.adapterCodeHash, "adapterCodeHash"),
    venue,
    collection,
    collectionCodeHash: bytes32(binding.collectionCodeHash, "collectionCodeHash"),
    mintSelector: CONTROLLED_SELECTOR,
    outputTokenId: uint(binding.outputTokenId, "outputTokenId"),
  };
}

function verifiedDecision(decisionProof, binding, opportunity, decisionInput) {
  plainObject(decisionInput, "decision input");
  const decisionInputJson = canonicalJson(decisionInput);
  const decisionInputHash = sha256(decisionInputJson);
  const reviewedDecisionInput = parseCanonicalJson(decisionInputJson);
  if (decisionInputHash !== binding.decisionInputHash) {
    fail("BINDING_MISMATCH", "binding decisionInputHash does not match the reviewed decision input");
  }
  if (reviewedDecisionInput.personaKey !== binding.personaKey) {
    fail("BINDING_MISMATCH", "binding personaKey does not match the reviewed decision input");
  }
  let recomputed;
  try {
    recomputed = buildPerPunkMintDecisions({ opportunity, punks: [reviewedDecisionInput] });
  } catch (error) {
    fail("INVALID_DECISION_INPUT", `reviewed decision input is invalid: ${error.message}`);
  }
  plainObject(decisionProof, "decision proof");
  if (decisionProof.hashAlgorithm !== "SHA256_CANONICAL_JSON_V1") fail("INVALID_DECISION_PROOF", "unexpected decision hash algorithm");
  plainObject(decisionProof.artifact, "decision artifact");
  if (decisionProof.artifact.schema !== "GOGH_LOCAL_PER_PUNK_MINT_DECISIONS_V1") {
    fail("INVALID_DECISION_PROOF", "unexpected decision artifact schema");
  }
  if (
    decisionProof.artifact.mode !== "READ_ONLY_LOCAL"
    || decisionProof.artifact.opportunityType !== "FREE_MINT"
    || !Array.isArray(decisionProof.artifact.decisions)
  ) fail("INVALID_DECISION_PROOF", "decision artifact is not a read-only free-mint proof");
  const security = decisionProof.artifact.security;
  if (
    !security
    || security.executionEnabled !== false
    || security.autonomyEnabled !== false
    || security.signingPerformed !== false
    || security.submissionPerformed !== false
    || security.chainWritePerformed !== false
    || security.rpcPerformed !== false
    || security.persistencePerformed !== false
    || security.identityEvidence !== "SUPPLIED_UNVERIFIED_LOCAL"
  ) fail("UNSAFE_DECISION", "decision proof security boundary is not read-only local");
  const computed = sha256(canonicalJson(decisionProof.artifact));
  if (computed !== bytes32(decisionProof.decisionHash, "decisionProof.decisionHash")) {
    fail("INVALID_DECISION_PROOF", "decision artifact hash does not match");
  }
  if (computed !== binding.decisionHash) fail("BINDING_MISMATCH", "binding decisionHash does not match the decision proof");
  if (
    recomputed.decisionHash !== computed
    || canonicalJson(recomputed.artifact) !== canonicalJson(decisionProof.artifact)
  ) {
    fail(
      "DECISION_RECOMPUTATION_MISMATCH",
      "decision proof does not match the reviewed opportunity, persona, mandate, and usage inputs",
    );
  }
  if (decisionProof.artifact.opportunityId !== binding.opportunityId) {
    fail("BINDING_MISMATCH", "binding opportunityId does not match the decision proof");
  }
  if (decisionProof.artifact.opportunityHash !== binding.opportunityHash) {
    fail("BINDING_MISMATCH", "binding opportunityHash does not match the decision proof");
  }
  const matches = decisionProof.artifact.decisions.filter(
    (entry) => entry.punkTokenId === binding.punkTokenId,
  );
  if (matches.length !== 1) fail("BINDING_MISMATCH", "decision proof does not uniquely contain the bound Punk");
  const decision = matches[0];
  if (
    decision.punk?.chainId !== ROBINHOOD.chainId
    || decision.punk?.collection !== binding.punkCollection
    || decision.punk?.tokenId !== binding.punkTokenId
    || decision.punk?.account !== binding.punkAccount
    || decision.punk?.expectedOwner !== binding.expectedOwner
  ) fail("BINDING_MISMATCH", "bound Punk identity/account/owner does not match the decision proof");
  if (decision.decision !== "PROPOSE" || decision.mintInterest?.decision !== "PROPOSE") {
    fail("OWNER_REVIEW_NOT_RECOMMENDED", "the bound Punk decision is not PROPOSE");
  }
  if (decision.recommendationId !== binding.recommendationId) fail("BINDING_MISMATCH", "recommendationId mismatch");
  if (decision.reasoningHash !== binding.reasoningHash) fail("BINDING_MISMATCH", "reasoningHash mismatch");
  if (String(decision.policyVersion) !== binding.policyVersion) fail("BINDING_MISMATCH", "policyVersion mismatch");
  if (decision.mandateHash !== binding.mandateHash) fail("BINDING_MISMATCH", "mandateHash mismatch");
  if (decision.controlsHash !== binding.controlsHash) fail("BINDING_MISMATCH", "controlsHash mismatch");
  if (decision.mintInterest.executionEnabled !== false || decision.mintInterest.autonomyEnabled !== false) {
    fail("UNSAFE_DECISION", "decision proof must keep execution and autonomy disabled");
  }
}

function verifyOpportunity(opportunity, binding) {
  plainObject(opportunity, "opportunity");
  const opportunityJson = canonicalJson(opportunity);
  opportunity = parseCanonicalJson(opportunityJson);
  if (opportunity.id !== binding.opportunityId) fail("BINDING_MISMATCH", "opportunity ID mismatch");
  let canonicalOpportunity;
  try {
    canonicalOpportunity = normalizeMintOpportunityDecisionEvidence(opportunity);
  } catch (error) {
    fail("INVALID_OPPORTUNITY", error.message);
  }
  const type = canonicalOpportunity.opportunityType;
  if (type !== "FREE_MINT") fail("PAID_PROPOSAL_UNSUPPORTED", "only FREE_MINT opportunities are supported");
  if (sha256(opportunityJson) !== binding.opportunityHash) {
    fail("BINDING_MISMATCH", "opportunity evidence does not match the decision proof");
  }
  const metadata = canonicalOpportunity.metadata ?? {};
  if (
    !Object.hasOwn(metadata, "actionableMint")
    || metadata.actionableMint !== true
    || !Object.hasOwn(metadata, "mintPriceStatus")
    || metadata.mintPriceStatus !== "KNOWN"
  ) {
    fail("UNVERIFIED_OPPORTUNITY", "free mint must be actionable with a known price");
  }
  const expectedPrice = uint(canonicalOpportunity.expectedPrice, "expectedPrice");
  const maxPrice = uint(canonicalOpportunity.maxPrice, "maxPrice");
  if (expectedPrice !== "0" || maxPrice !== "0") fail("PAID_PROPOSAL_UNSUPPORTED", "paid mint proposals are unsupported");
  if (canonicalOpportunity.collection !== binding.collection) {
    fail("BINDING_MISMATCH", "opportunity collection mismatch");
  }
  const venue = canonicalOpportunity.venue;
  if (address(venue, "mint contract") !== binding.venue) fail("BINDING_MISMATCH", "opportunity venue mismatch");
  const assetStandard = Object.hasOwn(metadata, "assetStandard")
    ? metadata.assetStandard
    : "ERC721";
  if (assetStandard !== "ERC721") fail("UNSUPPORTED_TARGET", "controlled canary output must be ERC721");
  if (uint(canonicalOpportunity.tokenId, "tokenId") !== binding.outputTokenId) {
    fail("BINDING_MISMATCH", "opportunity token ID mismatch");
  }
}

function assertProposalInput(input, binding) {
  const expected = {
    chainId: String(ROBINHOOD.chainId),
    punkCollection: binding.punkCollection,
    punkTokenId: binding.punkTokenId,
    punkAccount: binding.punkAccount,
    expectedOwner: binding.expectedOwner,
    opportunityType: "FREE_MINT",
    assetStandard: "ERC721",
    adapter: binding.adapter,
    venue: binding.venue,
    collection: binding.collection,
    mintSelector: binding.mintSelector,
    tokenId: binding.outputTokenId,
    assetAmount: "1",
    currency: "0x0000000000000000000000000000000000000000",
    expectedPrice: "0",
    maxPrice: "0",
    maxSlippageBps: "0",
    policyVersion: binding.policyVersion,
    opportunityId: sha256(binding.opportunityId),
    reasoningHash: binding.reasoningHash,
    adapterCodeHash: binding.adapterCodeHash,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (String(input[field]).toLowerCase() !== value.toLowerCase()) {
      fail("BINDING_MISMATCH", `proposal input ${field} does not match the controlled binding`);
    }
  }
  if (input.ownerReview !== true) fail("OWNER_REVIEW_REQUIRED", "proposal must request explicit owner review");
}

function assertBuiltProposal(result, binding) {
  const proposal = result?.proposal;
  const intent = proposal?.intent;
  const target = proposal?.humanReview?.target;
  const punk = proposal?.punk;
  if (
    !proposal
    || !intent
    || !target
    || !punk
    || punk.chainId !== ROBINHOOD.chainId
    || punk.collection !== binding.punkCollection
    || punk.tokenId !== binding.punkTokenId
    || punk.account !== binding.punkAccount
    || punk.expectedOwner !== binding.expectedOwner
    || intent.adapter !== binding.adapter
    || intent.venue !== binding.venue
    || intent.collection !== binding.collection
    || intent.tokenId !== binding.outputTokenId
    || intent.opportunityType !== "FREE_MINT"
    || intent.assetStandard !== "ERC721"
    || intent.expectedPrice !== "0"
    || intent.maxPrice !== "0"
    || intent.maxSlippageBps !== 0
    || target.adapter !== binding.adapter
    || target.venue !== binding.venue
    || target.collection !== binding.collection
    || target.mintSelector !== binding.mintSelector
    || proposal.authorization?.executionEnabled !== false
    || proposal.authorization?.autonomousMintsEnabled !== false
  ) fail("BUILT_PROPOSAL_MISMATCH", "built owner-review proposal diverges from the reviewed binding");
}

/**
 * Bridges one hash-bound PROPOSE decision to a local owner-review artifact for
 * the exact controlled one-shot canary only. Runtime-code evidence remains
 * owner-review material; this function does not attest live deployment state.
 */
export function buildControlledFreeMintOwnerReview({
  decisionProof,
  decisionInput,
  opportunity,
  binding,
  proposalInput,
}, options = {}) {
  decisionProof = reviewedSnapshot(decisionProof, "decisionProof");
  decisionInput = reviewedSnapshot(decisionInput, "decisionInput");
  opportunity = reviewedSnapshot(opportunity, "opportunity");
  binding = reviewedSnapshot(binding, "binding");
  proposalInput = reviewedSnapshot(proposalInput, "proposalInput");
  const normalizedBinding = exactBinding(binding);
  verifyOpportunity(opportunity, normalizedBinding);
  verifiedDecision(decisionProof, normalizedBinding, opportunity, decisionInput);
  plainObject(proposalInput, "proposal input");
  assertProposalInput(proposalInput, normalizedBinding);
  let proposal;
  try {
    proposal = buildOwnerReviewFreeMintProposal(proposalInput, options);
  } catch (error) {
    if (error instanceof FreeMintProposalError) {
      fail(error.code, error.message);
    }
    throw error;
  }
  assertBuiltProposal(proposal, normalizedBinding);
  const bridge = {
    schema: "GOGH_CONTROLLED_FREE_MINT_OWNER_REVIEW_BRIDGE_V1",
    stage: "LOCAL_OWNER_REVIEW_ONLY",
    decisionHash: normalizedBinding.decisionHash,
    opportunityHash: normalizedBinding.opportunityHash,
    recommendationId: normalizedBinding.recommendationId,
    reasoningHash: normalizedBinding.reasoningHash,
    mandateHash: normalizedBinding.mandateHash,
    controlsHash: normalizedBinding.controlsHash,
    personaKey: normalizedBinding.personaKey,
    decisionInputHash: normalizedBinding.decisionInputHash,
    collectionCodeHash: normalizedBinding.collectionCodeHash,
    adapterCodeHash: normalizedBinding.adapterCodeHash,
    proposalHash: proposal.proposalHash,
    liveDeploymentVerified: false,
    executionEnabled: false,
    autonomyEnabled: false,
    signingPerformed: false,
    submissionPerformed: false,
    chainWritePerformed: false,
  };
  return Object.freeze({
    hashAlgorithm: "SHA256_CANONICAL_JSON_V1",
    bridgeHash: sha256(canonicalJson(bridge)),
    bridge: Object.freeze(bridge),
    proposal,
  });
}
