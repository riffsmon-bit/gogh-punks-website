import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  toHex,
} from "viem";

import { ENTRY_POINT_V08 } from "./punk-agent-account-setup.mjs";

export const PUNK_AGENT_USER_OPERATION_SCHEMA = "GOGH_PUNK_AGENT_USER_OPERATION_V1";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EMPTY_HEX = "0x";
const UINT32_MAX = (2n ** 32n) - 1n;
const UINT48_MAX = (2n ** 48n) - 1n;
const UINT64_MAX = (2n ** 64n) - 1n;
const UINT128_MAX = (2n ** 128n) - 1n;
const UINT256_MAX = (2n ** 256n) - 1n;

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

export const PUNK_AGENT_ACCOUNT_ABI = Object.freeze([{
  type: "function",
  name: "executeSessionAcquisition",
  stateMutability: "nonpayable",
  inputs: [
    { name: "intent", type: "tuple", components: INTENT_COMPONENTS },
    { name: "adapterData", type: "bytes" },
  ],
  outputs: [{ name: "result", type: "bytes" }],
}]);

export const ENTRY_POINT_ACCOUNT_ABI = Object.freeze([
  {
    type: "function",
    name: "getNonce",
    stateMutability: "view",
    inputs: [{ name: "sender", type: "address" }, { name: "key", type: "uint192" }],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserOpHash",
    stateMutability: "view",
    inputs: [{
      name: "userOp",
      type: "tuple",
      components: [
        { name: "sender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "initCode", type: "bytes" },
        { name: "callData", type: "bytes" },
        { name: "accountGasLimits", type: "bytes32" },
        { name: "preVerificationGas", type: "uint256" },
        { name: "gasFees", type: "bytes32" },
        { name: "paymasterAndData", type: "bytes" },
        { name: "signature", type: "bytes" },
      ],
    }],
    outputs: [{ name: "userOpHash", type: "bytes32" }],
  },
]);

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function address(value, label, { zero = false } = {}) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    fail("INVALID_ADDRESS", `${label} is invalid`);
  }
  const output = getAddress(value).toLowerCase();
  if (!zero && output === ZERO_ADDRESS) fail("INVALID_ADDRESS", `${label} cannot be zero`);
  return output;
}

function integer(value, label, maximum = UINT256_MAX) {
  let output;
  try {
    output = typeof value === "bigint" ? value : BigInt(value);
  } catch {
    fail("INVALID_INTEGER", `${label} is invalid`);
  }
  if (output < 0n || output > maximum) fail("INVALID_INTEGER", `${label} is out of range`);
  return output;
}

function bytes32(value, label) {
  const output = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(output) || /^0x0{64}$/.test(output)) {
    fail("INVALID_HASH", `${label} is invalid`);
  }
  return output;
}

function cloneIntent(value, expectedAccount) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_INTENT", "acquisition intent is invalid");
  }
  const expectedKeys = INTENT_COMPONENTS.map(({ name }) => name).sort();
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    fail("INVALID_INTENT", "acquisition intent fields are invalid");
  }
  const intent = {
    account: address(value.account, "intent.account"),
    chainId: integer(value.chainId, "intent.chainId"),
    expectedOwner: address(value.expectedOwner, "intent.expectedOwner"),
    nonce: integer(value.nonce, "intent.nonce"),
    policyVersion: integer(value.policyVersion, "intent.policyVersion", UINT64_MAX),
    opportunityType: Number(integer(value.opportunityType, "intent.opportunityType", 255n)),
    assetStandard: Number(integer(value.assetStandard, "intent.assetStandard", 255n)),
    adapter: address(value.adapter, "intent.adapter"),
    venue: address(value.venue, "intent.venue"),
    collection: address(value.collection, "intent.collection"),
    tokenId: integer(value.tokenId, "intent.tokenId"),
    assetAmount: integer(value.assetAmount, "intent.assetAmount"),
    currency: address(value.currency, "intent.currency", { zero: true }),
    expectedPrice: integer(value.expectedPrice, "intent.expectedPrice"),
    maxPrice: integer(value.maxPrice, "intent.maxPrice"),
    maxSlippageBps: Number(integer(value.maxSlippageBps, "intent.maxSlippageBps", 65_535n)),
    createdAt: integer(value.createdAt, "intent.createdAt", UINT64_MAX),
    expiresAt: integer(value.expiresAt, "intent.expiresAt", UINT64_MAX),
    opportunityId: bytes32(value.opportunityId, "intent.opportunityId"),
    reasoningHash: bytes32(value.reasoningHash, "intent.reasoningHash"),
    adapterCodeHash: bytes32(value.adapterCodeHash, "intent.adapterCodeHash"),
  };
  if (intent.account !== expectedAccount || intent.chainId !== 4663n
    || intent.opportunityType !== 2 || intent.assetStandard !== 0
    || intent.assetAmount !== 1n || intent.currency !== ZERO_ADDRESS
    || intent.expectedPrice !== 0n || intent.maxPrice !== 0n || intent.maxSlippageBps !== 0
    || intent.expiresAt < intent.createdAt) {
    fail("UNSAFE_INTENT", "Punk Agent Account accepts only a quantity-one free ERC-721 mint");
  }
  return Object.freeze(intent);
}

function gasLimits(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_GAS", "gas limits are invalid");
  }
  const output = Object.freeze({
    verificationGasLimit: integer(value.verificationGasLimit, "verificationGasLimit", UINT128_MAX),
    callGasLimit: integer(value.callGasLimit, "callGasLimit", UINT128_MAX),
    preVerificationGas: integer(value.preVerificationGas, "preVerificationGas"),
    maxPriorityFeePerGas: integer(value.maxPriorityFeePerGas, "maxPriorityFeePerGas", UINT128_MAX),
    maxFeePerGas: integer(value.maxFeePerGas, "maxFeePerGas", UINT128_MAX),
  });
  if (Object.values(output).some((item) => item === 0n)
    || output.maxPriorityFeePerGas > output.maxFeePerGas) {
    fail("INVALID_GAS", "gas limits must be positive and priority fee cannot exceed max fee");
  }
  return output;
}

function signature(value) {
  const output = String(value ?? EMPTY_HEX).toLowerCase();
  if (output !== EMPTY_HEX && !/^0x[0-9a-f]{130}$/.test(output)) {
    fail("INVALID_SIGNATURE", "session signature must be exactly 65 bytes");
  }
  return output;
}

function packedOperation({ account, nonce, callData, gas, sessionSignature }) {
  return Object.freeze({
    sender: account,
    nonce,
    initCode: EMPTY_HEX,
    callData,
    accountGasLimits: toHex(
      (gas.verificationGasLimit << 128n) | gas.callGasLimit,
      { size: 32 },
    ),
    preVerificationGas: gas.preVerificationGas,
    gasFees: toHex((gas.maxPriorityFeePerGas << 128n) | gas.maxFeePerGas, { size: 32 }),
    paymasterAndData: EMPTY_HEX,
    signature: sessionSignature,
  });
}

function rpcOperation(operation, gas) {
  return Object.freeze({
    sender: operation.sender,
    nonce: toHex(operation.nonce),
    callData: operation.callData,
    callGasLimit: toHex(gas.callGasLimit),
    verificationGasLimit: toHex(gas.verificationGasLimit),
    preVerificationGas: toHex(gas.preVerificationGas),
    maxFeePerGas: toHex(gas.maxFeePerGas),
    maxPriorityFeePerGas: toHex(gas.maxPriorityFeePerGas),
    signature: operation.signature,
  });
}

export function buildPunkAgentUserOperation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_INPUT", "UserOperation input is invalid");
  }
  const account = address(input.account, "Punk Agent Account");
  const sessionKey = address(input.sessionKey, "session key");
  const entryPoint = address(input.entryPoint, "EntryPoint");
  if (entryPoint !== ENTRY_POINT_V08) fail("WRONG_ENTRY_POINT", "wrong EntryPoint");
  if (input.adapterData !== EMPTY_HEX) fail("UNSAFE_ADAPTER_DATA", "adapter data must be empty");
  const intent = cloneIntent(input.intent, account);
  const gas = gasLimits(input.gas);
  const sessionSignature = signature(input.signature);
  const nonce = integer(input.entryPointNonce, "EntryPoint nonce");
  const callData = encodeFunctionData({
    abi: PUNK_AGENT_ACCOUNT_ABI,
    functionName: "executeSessionAcquisition",
    args: [intent, EMPTY_HEX],
  }).toLowerCase();
  const decoded = decodeFunctionData({ abi: PUNK_AGENT_ACCOUNT_ABI, data: callData });
  if (decoded.functionName !== "executeSessionAcquisition") {
    fail("ENCODING_MISMATCH", "session acquisition encoding failed");
  }
  const packed = packedOperation({ account, nonce, callData, gas, sessionSignature });
  const maximumGasCostWei = (
    gas.verificationGasLimit + gas.callGasLimit + gas.preVerificationGas
  ) * gas.maxFeePerGas;
  return Object.freeze({
    schema: PUNK_AGENT_USER_OPERATION_SCHEMA,
    version: 1,
    chainId: 4663,
    entryPoint,
    account,
    sessionKey,
    opportunityId: intent.opportunityId,
    maximumGasCostWei,
    packed,
    rpc: rpcOperation(packed, gas),
  });
}

export async function readPunkAgentEntryPointNonce({ client, account }) {
  if (!client || typeof client.readContract !== "function") {
    fail("INVALID_CLIENT", "public client is unavailable");
  }
  return integer(await client.readContract({
    address: ENTRY_POINT_V08,
    abi: ENTRY_POINT_ACCOUNT_ABI,
    functionName: "getNonce",
    args: [address(account, "Punk Agent Account"), 0n],
  }), "EntryPoint nonce");
}

export async function signPunkAgentUserOperation({ client, signer, operation }) {
  if (!client || typeof client.readContract !== "function") {
    fail("INVALID_CLIENT", "public client is unavailable");
  }
  if (!signer || typeof signer.signMessage !== "function") {
    fail("INVALID_SIGNER", "session signer is unavailable");
  }
  const signerAddress = address(signer.address, "session signer");
  if (signerAddress !== operation?.sessionKey) {
    fail("WRONG_SESSION_SIGNER", "signer does not match the owner-approved session key");
  }
  const userOpHash = String(await client.readContract({
    address: ENTRY_POINT_V08,
    abi: ENTRY_POINT_ACCOUNT_ABI,
    functionName: "getUserOpHash",
    args: [operation?.packed],
  }) ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(userOpHash)) fail("INVALID_USER_OP_HASH", "UserOperation hash is invalid");
  const sessionSignature = signature(await signer.signMessage({ message: { raw: userOpHash } }));
  const signedPacked = Object.freeze({ ...operation.packed, signature: sessionSignature });
  return Object.freeze({
    ...operation,
    sessionSigner: signerAddress,
    userOpHash,
    packed: signedPacked,
    rpc: Object.freeze({ ...operation.rpc, signature: sessionSignature }),
  });
}

export async function submitPunkAgentUserOperation({ bundler, operation, authorization }) {
  if (!bundler || typeof bundler.request !== "function") {
    fail("INVALID_BUNDLER", "bundler transport is unavailable");
  }
  if (!operation || !/^0x[0-9a-f]{64}$/.test(operation.userOpHash ?? "")
    || operation.packed?.signature === EMPTY_HEX) {
    fail("UNSIGNED_USER_OPERATION", "signed UserOperation is required");
  }
  if (!authorization || authorization.ownerSessionActive !== true
    || authorization.screeningPassed !== true || authorization.simulationPassed !== true
    || authorization.userOpHash !== operation.userOpHash
    || authorization.opportunityId !== operation.opportunityId) {
    fail("SUBMISSION_NOT_AUTHORIZED", "fresh session, screening, and simulation evidence is required");
  }
  const submittedHash = String(await bundler.request({
    method: "eth_sendUserOperation",
    params: [operation.rpc, ENTRY_POINT_V08],
  }) ?? "").toLowerCase();
  if (submittedHash !== operation.userOpHash) {
    fail("BUNDLER_HASH_MISMATCH", "bundler returned a different UserOperation hash");
  }
  return Object.freeze({ userOpHash: submittedHash, submitted: true });
}
