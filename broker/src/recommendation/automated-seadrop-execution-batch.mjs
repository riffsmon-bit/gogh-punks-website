import { createHash } from "node:crypto";

import { decodeFunctionData, encodeFunctionData, keccak256 } from "viem";
import { canonicalJson } from "../scout/canonical-json.mjs";
import {
  AUTOMATED_RUN_PLAN_SCHEMA,
  buildAutomatedSeaDropRunPlan,
} from "./automated-seadrop-run-plan.mjs";

export const AUTOMATED_EXECUTION_BATCH_SCHEMA = "GOGH_AUTOMATED_SEADROP_EXECUTION_BATCH_V1";

export const AUTOMATED_ACCOUNT_EXECUTION_ABI = Object.freeze([{
  type: "function",
  name: "executeAutonomousAcquisition",
  stateMutability: "nonpayable",
  inputs: [
    {
      name: "intent",
      type: "tuple",
      components: [
        { name: "account", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "expectedOwner", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "policyVersion", type: "uint64" },
        { name: "opportunityType", type: "uint8" },
        { name: "assetStandard", type: "uint8" },
        { name: "adapter", type: "address" },
        { name: "venue", type: "address" },
        { name: "collection", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "assetAmount", type: "uint256" },
        { name: "currency", type: "address" },
        { name: "expectedPrice", type: "uint256" },
        { name: "maxPrice", type: "uint256" },
        { name: "maxSlippageBps", type: "uint16" },
        { name: "createdAt", type: "uint64" },
        { name: "expiresAt", type: "uint64" },
        { name: "opportunityId", type: "bytes32" },
        { name: "reasoningHash", type: "bytes32" },
        { name: "adapterCodeHash", type: "bytes32" },
      ],
    },
    { name: "adapterData", type: "bytes" },
  ],
  outputs: [{ name: "result", type: "bytes" }],
}]);

function sha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function encodedAction(action, agent) {
  const intent = {
    account: action.account,
    chainId: BigInt(action.chainId),
    expectedOwner: action.expectedOwner,
    nonce: BigInt(action.nonce),
    policyVersion: BigInt(action.policyVersion),
    opportunityType: 2,
    assetStandard: 0,
    adapter: action.adapter,
    venue: action.venue,
    collection: action.collection,
    tokenId: BigInt(action.tokenId),
    assetAmount: 1n,
    currency: action.currency,
    expectedPrice: 0n,
    maxPrice: 0n,
    maxSlippageBps: 0,
    createdAt: BigInt(action.createdAt),
    expiresAt: BigInt(action.expiresAt),
    opportunityId: action.opportunityId,
    reasoningHash: action.reasoningHash,
    adapterCodeHash: action.adapterCodeHash,
  };
  const data = encodeFunctionData({
    abi: AUTOMATED_ACCOUNT_EXECUTION_ABI,
    functionName: "executeAutonomousAcquisition",
    args: [intent, "0x"],
  });
  const decoded = decodeFunctionData({ abi: AUTOMATED_ACCOUNT_EXECUTION_ABI, data });
  if (decoded.functionName !== "executeAutonomousAcquisition"
    || decoded.args[1] !== "0x" || decoded.args[0].account.toLowerCase() !== action.account
    || decoded.args[0].collection.toLowerCase() !== action.collection
    || decoded.args[0].nonce !== BigInt(action.nonce)
    || decoded.args[0].expectedPrice !== 0n || decoded.args[0].maxPrice !== 0n
    || decoded.args[0].assetAmount !== 1n || decoded.args[0].opportunityType !== 2
    || decoded.args[0].assetStandard !== 0) {
    throw new TypeError("canonical autonomous calldata failed its decode-equality check");
  }
  return Object.freeze({
    sequence: action.sequence,
    from: agent,
    to: action.account,
    value: "0",
    data,
    dataKeccak256: keccak256(data),
    opportunityId: action.opportunityId,
    collection: action.collection,
    tokenId: action.tokenId,
    nonce: action.nonce,
    policyVersion: action.policyVersion,
    expiresAt: action.expiresAt,
    maximumGasCostWei: action.maximumGasCostWei,
  });
}

export function buildAutomatedSeaDropExecutionBatch(
  profileInput,
  liveStateInput,
  options = {},
) {
  const plan = buildAutomatedSeaDropRunPlan(profileInput, liveStateInput, options);
  if (plan.schema !== AUTOMATED_RUN_PLAN_SCHEMA) {
    throw new TypeError("automated plan schema mismatch");
  }
  const transactions = plan.actions.map((action) => encodedAction(action, plan.agent));
  const batch = {
    schema: AUTOMATED_EXECUTION_BATCH_SCHEMA,
    version: 1,
    chainId: plan.chainId,
    generatedAt: plan.generatedAt,
    checkedAt: plan.checkedAt,
    planHash: plan.planHash,
    profileHash: plan.profileHash,
    liveEvidenceHash: plan.liveEvidenceHash,
    punk: plan.punk,
    agent: plan.agent,
    limits: plan.limits,
    transactions,
    safety: {
      exactAccountEntryPointOnly: true,
      exactTypedIntentOnly: true,
      emptyAdapterDataOnly: true,
      transactionValueWei: "0",
      paidMintsAllowed: false,
      approvalsAllowed: false,
      arbitraryCalldataAllowed: false,
      signingPerformed: false,
      submissionPerformed: false,
      chainStateWritten: false,
      executionAuthorizedByThisArtifact: false,
      mandatoryNextGate:
        "RECHECK_EACH_ACTION_AT_LATEST_THEN_SIGN_SUBMIT_WAIT_RECEIPT_BEFORE_NEXT_NONCE",
    },
  };
  return deepFreeze({ ...batch, batchHash: sha256(batch) });
}
