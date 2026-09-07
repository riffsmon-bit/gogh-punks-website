import { keccak256, stringToHex } from "viem";

import { canonicalJson } from "../scout/canonical-json.mjs";
import { normalizeV2Opportunity } from "../v4/opportunity.mjs";
import {
  buildPunkAgentUserOperation,
  signPunkAgentUserOperation,
  submitPunkAgentUserOperation,
} from "./punk-agent-user-operation.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_SIGNATURE = `0x${"00".repeat(64)}1b`;
const MAX_EVIDENCE_AGE_MS = 120_000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function uint(value, label) {
  let output;
  try { output = typeof value === "bigint" ? value : BigInt(value); } catch {
    fail("INVALID_INTEGER", `${label} is invalid`);
  }
  if (output < 0n) fail("INVALID_INTEGER", `${label} is invalid`);
  return output;
}

function bytes32Identity(value) {
  return keccak256(stringToHex(String(value)));
}

export function buildPunkAgentMintIntent({
  runtime, opportunity: opportunityValue, strategyHash, tokenId, simulationInputHash,
  now = new Date(), lifetimeSeconds = 300,
}) {
  const opportunity = normalizeV2Opportunity(opportunityValue, now);
  if (!runtime?.sessionActive || !runtime.accountCreated || !runtime.owner || !runtime.session
    || opportunity.screeningStatus !== "PASSED"
    || opportunity.simulationStatus !== "PASSED"
    || opportunity.priceWei !== "0" || opportunity.unexpectedApprovals
    || opportunity.unexpectedTransfers
    || opportunity.expectedNftReceiver !== null
      && opportunity.expectedNftReceiver !== runtime.account) {
    fail("AUTONOMOUS_CANDIDATE_REJECTED",
      "candidate lacks an active session, passed screen, or exact free-mint simulation");
  }
  if (opportunity.adapter !== runtime.session.adapter
    || opportunity.mintContract !== runtime.session.venue
    || opportunity.adapterCodeHash !== runtime.session.adapterCodeHash
    || runtime.session.targetCollection !== ZERO_ADDRESS
      && opportunity.collectionContract !== runtime.session.targetCollection) {
    fail("SESSION_POLICY_MISMATCH", "candidate differs from the owner-approved session envelope");
  }
  const createdAt = BigInt(Math.floor(new Date(now).getTime() / 1_000));
  if (createdAt <= 0n || !Number.isInteger(lifetimeSeconds)
    || lifetimeSeconds < 30 || lifetimeSeconds > 600) {
    fail("INVALID_INTENT_TIME", "mint intent lifetime is invalid");
  }
  let expiresAt = createdAt + BigInt(lifetimeSeconds);
  if (opportunity.endTime) {
    const opportunityEnd = BigInt(Math.floor(Date.parse(opportunity.endTime) / 1_000));
    if (opportunityEnd < expiresAt) expiresAt = opportunityEnd;
  }
  if (runtime.session.validUntil < expiresAt) expiresAt = runtime.session.validUntil;
  if (expiresAt <= createdAt) fail("OPPORTUNITY_EXPIRED", "candidate expires before submission");
  const reasoning = { strategyHash, opportunityId: opportunity.opportunityId,
    simulationInputHash, screeningStatus: opportunity.screeningStatus,
    simulationStatus: opportunity.simulationStatus, collection: opportunity.collectionContract,
    tokenId: uint(tokenId, "mint token ID").toString() };
  return Object.freeze({
    account: runtime.account, chainId: "4663", expectedOwner: runtime.owner,
    nonce: runtime.acquisitionNonce.toString(), policyVersion: runtime.session.generation.toString(),
    opportunityType: 2, assetStandard: 0, adapter: opportunity.adapter,
    venue: opportunity.mintContract, collection: opportunity.collectionContract,
    tokenId: uint(tokenId, "mint token ID").toString(), assetAmount: "1",
    currency: ZERO_ADDRESS, expectedPrice: "0", maxPrice: "0", maxSlippageBps: 0,
    createdAt: createdAt.toString(), expiresAt: expiresAt.toString(),
    opportunityId: bytes32Identity(opportunity.opportunityId),
    reasoningHash: bytes32Identity(canonicalJson(reasoning)),
    adapterCodeHash: opportunity.adapterCodeHash,
  });
}

function normalizeGasEstimate(value) {
  if (!value || typeof value !== "object") fail("INVALID_GAS_ESTIMATE", "bundler estimate is invalid");
  const estimate = Object.freeze({
    preVerificationGas: uint(value.preVerificationGas, "estimated pre-verification gas"),
    verificationGasLimit: uint(value.verificationGasLimit, "estimated verification gas"),
    callGasLimit: uint(value.callGasLimit, "estimated call gas"),
  });
  if (Object.values(estimate).some((item) => item === 0n)) {
    fail("INVALID_GAS_ESTIMATE", "bundler estimate must be positive");
  }
  return estimate;
}

export async function estimateSignedPunkAgentUserOperation({ bundler, operation }) {
  if (!operation?.rpc || operation.rpc.signature === ZERO_SIGNATURE
    || !/^0x[0-9a-f]{130}$/.test(operation.rpc.signature ?? "")) {
    fail("UNSIGNED_USER_OPERATION", "signed UserOperation is required for estimation");
  }
  const estimate = normalizeGasEstimate(await bundler.request({
    method: "eth_estimateUserOperationGas", params: [operation.rpc, operation.entryPoint],
  }));
  const envelope = {
    preVerificationGas: uint(operation.rpc.preVerificationGas, "pre-verification gas"),
    verificationGasLimit: uint(operation.rpc.verificationGasLimit, "verification gas"),
    callGasLimit: uint(operation.rpc.callGasLimit, "call gas"),
  };
  for (const key of Object.keys(envelope)) {
    if (estimate[key] > envelope[key]) {
      fail("USER_OPERATION_GAS_ENVELOPE_TOO_LOW", `${key} exceeds the signed gas envelope`);
    }
  }
  return estimate;
}

export async function prepareSignedPunkAgentMint({
  client, signer, runtime, opportunity, strategyHash, tokenId, simulationInputHash,
  gas, entryPointNonce, now = new Date(), lifetimeSeconds = 300,
}) {
  const intent = buildPunkAgentMintIntent({ runtime, opportunity, strategyHash, tokenId,
    simulationInputHash, now, lifetimeSeconds });
  const unsigned = buildPunkAgentUserOperation({ account: runtime.account,
    sessionKey: runtime.session.sessionKey, entryPoint: runtime.deployment.entryPoint,
    entryPointNonce, intent, adapterData: "0x", signature: "0x", gas });
  const signed = await signPunkAgentUserOperation({ client, signer, operation: unsigned });
  return Object.freeze({ intent, operation: signed });
}

export async function submitPreparedPunkAgentMint({
  bundler, prepared, screeningInputHash, simulationInputHash, checkedAt, now = new Date(),
}) {
  const checkedAtMs = Date.parse(checkedAt);
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(checkedAtMs) || checkedAtMs > nowMs + 5_000
    || nowMs - checkedAtMs > MAX_EVIDENCE_AGE_MS || typeof screeningInputHash !== "string"
    || typeof simulationInputHash !== "string") {
    fail("STALE_EXECUTION_EVIDENCE", "screening and simulation evidence must be fresh");
  }
  await estimateSignedPunkAgentUserOperation({ bundler, operation: prepared.operation });
  return submitPunkAgentUserOperation({ bundler, operation: prepared.operation,
    authorization: { ownerSessionActive: true, screeningPassed: true,
      simulationPassed: true, userOpHash: prepared.operation.userOpHash,
      opportunityId: prepared.intent.opportunityId, screeningInputHash, simulationInputHash } });
}

export const PUNK_AGENT_ESTIMATION_SIGNATURE = ZERO_SIGNATURE;
