import { createHash } from "node:crypto";

import { decodeFunctionData, encodeFunctionData, keccak256 } from "viem";

import { canonicalJson } from "../scout/canonical-json.mjs";
import {
  AUTOMATED_RUN_PLAN_SCHEMA,
  buildAutomatedSeaDropV3RunPlan,
} from "./automated-seadrop-v3-run-plan.mjs";

export const OWNER_PAID_EXECUTION_SCHEMA = "GOGH_OWNER_PAID_SEADROP_V3_EXECUTION_V1";

const INTENT_COMPONENTS = Object.freeze([
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
]);

export const OWNER_PAID_ACCOUNT_EXECUTION_ABI = Object.freeze([{
  type: "function",
  name: "executeApprovedAcquisition",
  stateMutability: "nonpayable",
  inputs: [
    { name: "intent", type: "tuple", components: INTENT_COMPONENTS },
    { name: "adapterData", type: "bytes" },
    { name: "ownerSignature", type: "bytes" },
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

export function buildOwnerPaidSeaDropV3Execution(profileInput, liveStateInput, options = {}) {
  const plan = buildAutomatedSeaDropV3RunPlan(profileInput, liveStateInput, {
    ...options,
    gasPayer: "OWNER",
  });
  if (plan.schema !== AUTOMATED_RUN_PLAN_SCHEMA || plan.actions.length !== 1) {
    throw new TypeError("owner-paid execution requires exactly one reviewed action");
  }
  const action = plan.actions[0];
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
    abi: OWNER_PAID_ACCOUNT_EXECUTION_ABI,
    functionName: "executeApprovedAcquisition",
    args: [intent, "0x", "0x"],
  });
  const decoded = decodeFunctionData({ abi: OWNER_PAID_ACCOUNT_EXECUTION_ABI, data });
  if (decoded.functionName !== "executeApprovedAcquisition"
    || decoded.args[1] !== "0x" || decoded.args[2] !== "0x"
    || decoded.args[0].account.toLowerCase() !== action.account
    || decoded.args[0].expectedOwner.toLowerCase() !== action.expectedOwner
    || decoded.args[0].collection.toLowerCase() !== action.collection
    || decoded.args[0].nonce !== BigInt(action.nonce)
    || decoded.args[0].expectedPrice !== 0n || decoded.args[0].maxPrice !== 0n
    || decoded.args[0].assetAmount !== 1n) {
    throw new TypeError("owner-paid calldata failed its decode-equality check");
  }
  const execution = {
    schema: OWNER_PAID_EXECUTION_SCHEMA,
    version: 1,
    chainId: plan.chainId,
    generatedAt: plan.generatedAt,
    expiresAt: action.expiresAt,
    punk: plan.punk,
    collection: action.collection,
    expectedTokenId: action.tokenId,
    transaction: {
      from: plan.punk.expectedOwner,
      to: plan.punk.account,
      value: "0",
      data,
      dataKeccak256: keccak256(data),
      maximumGasCostWei: action.maximumGasCostWei,
    },
    safety: {
      currentOwnerOnly: true,
      exactAccountEntryPointOnly: true,
      ownerSignatureBytesEmpty: true,
      adapterDataEmpty: true,
      mintPriceWei: "0",
      quantity: "1",
      recipient: plan.punk.account,
      approvalsAllowed: false,
      arbitraryCalldataAllowed: false,
      submissionPerformed: false,
    },
  };
  return deepFreeze({ ...execution, executionHash: sha256(execution) });
}
