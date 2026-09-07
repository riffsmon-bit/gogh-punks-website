import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ENTRY_POINT_V08 } from "./punk-agent-account-setup.mjs";

const EMPTY_HEX = "0x";
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const SIGNATURE = /^0x[0-9a-f]{130}$/;
const UINT128_MAX = (2n ** 128n) - 1n;
const MAX_USER_OPERATION_GAS = 2_500_000n;
const DEFAULT_RECEIPT_LOOKBACK_BLOCKS = 120_000n;
const RECEIPT_CHUNK_BLOCKS = 10_000n;
const DEFAULT_MINIMUM_RELAY_BALANCE_WEI = 200_000_000_000_000n;

const PACKED_USER_OPERATION_COMPONENTS = Object.freeze([
  { name: "sender", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "initCode", type: "bytes" },
  { name: "callData", type: "bytes" },
  { name: "accountGasLimits", type: "bytes32" },
  { name: "preVerificationGas", type: "uint256" },
  { name: "gasFees", type: "bytes32" },
  { name: "paymasterAndData", type: "bytes" },
  { name: "signature", type: "bytes" },
]);

export const DIRECT_RELAY_ENTRY_POINT_ABI = Object.freeze([
  { type: "function", name: "getUserOpHash", stateMutability: "view",
    inputs: [{ name: "userOp", type: "tuple", components: PACKED_USER_OPERATION_COMPONENTS }],
    outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "handleOps", stateMutability: "nonpayable",
    inputs: [
      { name: "ops", type: "tuple[]", components: PACKED_USER_OPERATION_COMPONENTS },
      { name: "beneficiary", type: "address" },
    ], outputs: [] },
  { type: "event", name: "UserOperationEvent", anonymous: false, inputs: [
    { name: "userOpHash", type: "bytes32", indexed: true },
    { name: "sender", type: "address", indexed: true },
    { name: "paymaster", type: "address", indexed: true },
    { name: "nonce", type: "uint256", indexed: false },
    { name: "success", type: "bool", indexed: false },
    { name: "actualGasCost", type: "uint256", indexed: false },
    { name: "actualGasUsed", type: "uint256", indexed: false },
  ] },
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function address(value, label) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    fail("INVALID_DIRECT_RELAY_REQUEST", `${label} is invalid`);
  }
  return getAddress(value).toLowerCase();
}

function integer(value, label, maximum = (2n ** 256n) - 1n) {
  let parsed;
  try { parsed = typeof value === "bigint" ? value : BigInt(value); } catch {
    fail("INVALID_DIRECT_RELAY_REQUEST", `${label} is invalid`);
  }
  if (parsed < 0n || parsed > maximum) {
    fail("INVALID_DIRECT_RELAY_REQUEST", `${label} is out of range`);
  }
  return parsed;
}

function bytes(value, label, { signature = false } = {}) {
  const normalized = String(value ?? "").toLowerCase();
  const valid = signature ? SIGNATURE.test(normalized) : /^0x(?:[0-9a-f]{2})*$/.test(normalized);
  if (!valid) fail("INVALID_DIRECT_RELAY_REQUEST", `${label} is invalid`);
  return normalized;
}

function cleanHttpsUrl(value) {
  let endpoint;
  try { endpoint = new URL(value); } catch {
    fail("INVALID_DIRECT_RELAY", "direct relay RPC URL is invalid");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash
    || endpoint.href.length > 2_048) {
    fail("INVALID_DIRECT_RELAY", "direct relay RPC must be a clean HTTPS endpoint");
  }
  return endpoint;
}

function packedUserOperation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_DIRECT_RELAY_REQUEST", "UserOperation is invalid");
  }
  const expected = ["sender", "nonce", "callData", "callGasLimit", "verificationGasLimit",
    "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas", "signature"].sort();
  const supplied = Object.keys(value).sort();
  if (supplied.length !== expected.length
    || supplied.some((key, index) => key !== expected[index])) {
    fail("INVALID_DIRECT_RELAY_REQUEST", "UserOperation has an unexpected field set");
  }
  const verificationGasLimit = integer(value.verificationGasLimit,
    "verification gas", UINT128_MAX);
  const callGasLimit = integer(value.callGasLimit, "call gas", UINT128_MAX);
  const preVerificationGas = integer(value.preVerificationGas, "pre-verification gas");
  const maxFeePerGas = integer(value.maxFeePerGas, "maximum fee", UINT128_MAX);
  const maxPriorityFeePerGas = integer(value.maxPriorityFeePerGas,
    "maximum priority fee", UINT128_MAX);
  if ([verificationGasLimit, callGasLimit, preVerificationGas, maxFeePerGas]
    .some((item) => item === 0n) || maxPriorityFeePerGas > maxFeePerGas
    || verificationGasLimit + callGasLimit + preVerificationGas > MAX_USER_OPERATION_GAS) {
    fail("INVALID_DIRECT_RELAY_REQUEST", "UserOperation gas envelope is unsafe");
  }
  return Object.freeze({
    packed: Object.freeze({
      sender: address(value.sender, "UserOperation sender"),
      nonce: integer(value.nonce, "UserOperation nonce"),
      initCode: EMPTY_HEX,
      callData: bytes(value.callData, "UserOperation calldata"),
      accountGasLimits: toHex((verificationGasLimit << 128n) | callGasLimit, { size: 32 }),
      preVerificationGas,
      gasFees: toHex((maxPriorityFeePerGas << 128n) | maxFeePerGas, { size: 32 }),
      paymasterAndData: EMPTY_HEX,
      signature: bytes(value.signature, "UserOperation signature", { signature: true }),
    }),
    estimate: Object.freeze({ preVerificationGas: toHex(preVerificationGas),
      verificationGasLimit: toHex(verificationGasLimit), callGasLimit: toHex(callGasLimit) }),
    maximumGas: verificationGasLimit + callGasLimit + preVerificationGas,
  });
}

function exactEntryPoint(value) {
  if (address(value, "EntryPoint") !== ENTRY_POINT_V08) {
    fail("DIRECT_RELAY_ENTRY_POINT_MISMATCH", "direct relay request targets the wrong EntryPoint");
  }
}

function transactionData(packed, beneficiary) {
  return encodeFunctionData({ abi: DIRECT_RELAY_ENTRY_POINT_ABI, functionName: "handleOps",
    args: [[packed], beneficiary] });
}

async function locateUserOperationEvent(reader, userOpHash, lookback) {
  const latest = await reader.getBlockNumber();
  const floor = latest > lookback ? latest - lookback : 0n;
  let toBlock = latest;
  while (toBlock >= floor) {
    const fromBlock = toBlock >= RECEIPT_CHUNK_BLOCKS - 1n
      ? toBlock - (RECEIPT_CHUNK_BLOCKS - 1n) : 0n;
    const boundedFrom = fromBlock < floor ? floor : fromBlock;
    const logs = await reader.getLogs({ address: ENTRY_POINT_V08,
      event: DIRECT_RELAY_ENTRY_POINT_ABI[2], args: { userOpHash },
      fromBlock: boundedFrom, toBlock });
    if (logs.length > 1) fail("DIRECT_RELAY_RECEIPT_AMBIGUOUS",
      "multiple UserOperation events have the same hash");
    if (logs.length === 1) return logs[0];
    if (boundedFrom === floor || boundedFrom === 0n) break;
    toBlock = boundedFrom - 1n;
  }
  return null;
}

export function createPunkAgentDirectRelay({
  url,
  privateKey,
  expectedAddress,
  publicClient = null,
  walletClient = null,
  account = null,
  receiptLookbackBlocks = DEFAULT_RECEIPT_LOOKBACK_BLOCKS,
  minimumBalanceWei = DEFAULT_MINIMUM_RELAY_BALANCE_WEI,
} = {}) {
  const endpoint = cleanHttpsUrl(url);
  const signer = account ?? (PRIVATE_KEY.test(privateKey ?? "")
    ? privateKeyToAccount(privateKey) : null);
  if (!signer || typeof signer.address !== "string") {
    fail("DIRECT_RELAY_SIGNER_NOT_CONFIGURED", "direct relay signer is unavailable");
  }
  const signerAddress = address(signer.address, "direct relay signer");
  if (expectedAddress && signerAddress !== address(expectedAddress, "expected direct relay signer")) {
    fail("DIRECT_RELAY_SIGNER_MISMATCH", "direct relay key differs from its public binding");
  }
  const lookback = integer(receiptLookbackBlocks, "receipt lookback", 1_000_000n);
  const minimumBalance = integer(minimumBalanceWei, "minimum relay balance");
  if (lookback < RECEIPT_CHUNK_BLOCKS) {
    fail("INVALID_DIRECT_RELAY", "direct relay receipt lookback is too small");
  }
  const reader = publicClient ?? createPublicClient({
    transport: http(endpoint.toString(), { timeout: 12_000, retryCount: 1 }),
  });
  const writer = walletClient ?? createWalletClient({ account: signer,
    transport: http(endpoint.toString(), { timeout: 12_000, retryCount: 1 }) });
  const pendingTransactions = new Map();

  async function fundingState() {
    const balance = await reader.getBalance({ address: signerAddress });
    if (balance < minimumBalance) {
      fail("DIRECT_RELAY_UNFUNDED", "direct relay signer is below its minimum gas float");
    }
    return Object.freeze({ signerAddress, balanceWei: balance.toString(),
      minimumBalanceWei: minimumBalance.toString() });
  }

  async function estimateOperation(rpcOperation, entryPoint) {
    exactEntryPoint(entryPoint);
    const normalized = packedUserOperation(rpcOperation);
    const data = transactionData(normalized.packed, signerAddress);
    const gas = await reader.estimateGas({ account: signerAddress,
      to: ENTRY_POINT_V08, data });
    if (gas > normalized.maximumGas) {
      fail("DIRECT_RELAY_GAS_ENVELOPE_TOO_LOW",
        "EntryPoint transaction exceeds the signed UserOperation gas envelope");
    }
    return Object.freeze({ ...normalized, data, gas });
  }

  async function receipt(userOpHash) {
    const normalizedHash = String(userOpHash ?? "").toLowerCase();
    if (!HASH.test(normalizedHash)) {
      fail("INVALID_DIRECT_RELAY_REQUEST", "UserOperation hash is invalid");
    }
    let transactionReceipt = null;
    const pendingHash = pendingTransactions.get(normalizedHash);
    if (pendingHash) {
      try { transactionReceipt = await reader.getTransactionReceipt({ hash: pendingHash }); }
      catch { return null; }
    }
    const event = transactionReceipt ? null
      : await locateUserOperationEvent(reader, normalizedHash, lookback);
    if (!transactionReceipt && !event) return null;
    if (!transactionReceipt) {
      transactionReceipt = await reader.getTransactionReceipt({ hash: event.transactionHash });
    }
    const matchedEvent = event ?? (await reader.getLogs({ address: ENTRY_POINT_V08,
      event: DIRECT_RELAY_ENTRY_POINT_ABI[2], args: { userOpHash: normalizedHash },
      fromBlock: transactionReceipt.blockNumber, toBlock: transactionReceipt.blockNumber }))
      .find((item) => item.transactionHash === transactionReceipt.transactionHash);
    if (!matchedEvent?.args) {
      fail("DIRECT_RELAY_RECEIPT_INVALID", "transaction lacks the canonical UserOperation event");
    }
    return Object.freeze({ userOpHash: normalizedHash,
      sender: address(matchedEvent.args.sender, "receipt sender"),
      nonce: matchedEvent.args.nonce, success: matchedEvent.args.success === true,
      actualGasCost: matchedEvent.args.actualGasCost,
      actualGasUsed: matchedEvent.args.actualGasUsed,
      logs: transactionReceipt.logs,
      receipt: transactionReceipt });
  }

  return Object.freeze({ mode: "DIRECT_PRIVATE_RELAY", endpointOrigin: endpoint.origin,
    signerAddress, async request({ method, params = [] } = {}) {
      if (!Array.isArray(params)) fail("INVALID_DIRECT_RELAY_REQUEST", "params are invalid");
      if (method === "eth_chainId") return toHex(await reader.getChainId());
      if (method === "eth_supportedEntryPoints") {
        const code = await reader.getCode({ address: ENTRY_POINT_V08 });
        return code && code !== EMPTY_HEX ? [ENTRY_POINT_V08] : [];
      }
      if (method === "eth_estimateUserOperationGas") {
        if (params.length !== 2) fail("INVALID_DIRECT_RELAY_REQUEST", "estimate params are invalid");
        return (await estimateOperation(params[0], params[1])).estimate;
      }
      if (method === "eth_sendUserOperation") {
        if (params.length !== 2) fail("INVALID_DIRECT_RELAY_REQUEST", "send params are invalid");
        const estimated = await estimateOperation(params[0], params[1]);
        const gasPrice = await reader.getGasPrice();
        const bufferedGas = (estimated.gas * 120n + 99n) / 100n;
        const balance = await reader.getBalance({ address: signerAddress });
        if (balance < bufferedGas * gasPrice * 2n) {
          fail("DIRECT_RELAY_UNFUNDED", "direct relay signer cannot cover the outer transaction");
        }
        const userOpHash = String(await reader.readContract({ address: ENTRY_POINT_V08,
          abi: DIRECT_RELAY_ENTRY_POINT_ABI, functionName: "getUserOpHash",
          args: [estimated.packed] })).toLowerCase();
        if (!HASH.test(userOpHash)) fail("DIRECT_RELAY_HASH_INVALID",
          "EntryPoint returned an invalid UserOperation hash");
        const transactionHash = await writer.sendTransaction({ account: signer,
          to: ENTRY_POINT_V08, data: estimated.data,
          gas: bufferedGas });
        pendingTransactions.set(userOpHash, transactionHash);
        return userOpHash;
      }
      if (method === "eth_getUserOperationReceipt") {
        if (params.length !== 1) fail("INVALID_DIRECT_RELAY_REQUEST", "receipt params are invalid");
        return receipt(params[0]);
      }
      fail("DIRECT_RELAY_METHOD_FORBIDDEN", "direct relay method is not allowed");
    }, fundingState });
}
