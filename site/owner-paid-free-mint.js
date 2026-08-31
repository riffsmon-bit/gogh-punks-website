import { keccak256Hex } from "./keccak256.js";

const CHAIN_ID = 4663;
const EXECUTION_SCHEMA = "GOGH_OWNER_PAID_SEADROP_V3_EXECUTION_V1";
const EXECUTE_APPROVED_ACQUISITION_SELECTOR = "0x4402cb61";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CANONICAL_CALLDATA_LENGTH = 1_610;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DATA = /^0x(?:[0-9a-fA-F]{2})+$/;

export class OwnerPaidFreeMintError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OwnerPaidFreeMintError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new OwnerPaidFreeMintError(code, message);
}

function normalizedAddress(value, label) {
  if (!ADDRESS.test(value ?? "")) fail("INVALID_ARTIFACT", `${label} is invalid`);
  return value.toLowerCase();
}

function decimalUint(value, label) {
  const text = String(value ?? "");
  if (!/^(?:0|[1-9]\d*)$/.test(text)) fail("INVALID_ARTIFACT", `${label} is invalid`);
  return BigInt(text);
}

function decodeCanonicalOwnerPaidCalldata(data) {
  if (typeof data !== "string" || data !== data.toLowerCase()
    || data.length !== CANONICAL_CALLDATA_LENGTH
    || !DATA.test(data) || !data.startsWith(EXECUTE_APPROVED_ACQUISITION_SELECTOR)) {
    fail("INVALID_ARTIFACT", "transaction calldata is not the canonical owner-paid call");
  }
  const body = data.slice(10);
  const words = Array.from({ length: 25 }, (_, index) => body.slice(index * 64, (index + 1) * 64));
  const uint = (index) => BigInt(`0x${words[index]}`);
  const address = (index, label, { zero = false } = {}) => {
    if (!/^0{24}[0-9a-f]{40}$/.test(words[index])) {
      fail("INVALID_ARTIFACT", `${label} is not canonically encoded`);
    }
    return normalizedAddress(`0x${words[index].slice(24)}`, label, { zero });
  };
  if (uint(21) !== 0x2e0n || uint(22) !== 0x300n || uint(23) !== 0n || uint(24) !== 0n) {
    fail("INVALID_ARTIFACT", "adapter data and owner signature must both be empty");
  }
  return Object.freeze({
    account: address(0, "calldata Punk Wallet"),
    chainId: uint(1),
    expectedOwner: address(2, "calldata owner"),
    nonce: uint(3),
    policyVersion: uint(4),
    opportunityType: uint(5),
    assetStandard: uint(6),
    adapter: address(7, "calldata adapter"),
    venue: address(8, "calldata venue"),
    collection: address(9, "calldata collection"),
    tokenId: uint(10),
    assetAmount: uint(11),
    currency: address(12, "calldata currency", { zero: true }),
    expectedPrice: uint(13),
    maxPrice: uint(14),
    maxSlippageBps: uint(15),
    createdAt: uint(16),
    expiresAt: uint(17),
  });
}

async function rpc(provider, method, params = []) {
  if (!provider?.request) fail("WALLET_UNAVAILABLE", "wallet provider is unavailable");
  return provider.request({ method, params });
}

export function validateOwnerPaidFreeMintExecution(execution, expected) {
  if (!execution || typeof execution !== "object" || Array.isArray(execution)
    || execution.schema !== EXECUTION_SCHEMA || execution.version !== 1
    || execution.chainId !== CHAIN_ID || !HASH.test(execution.executionHash ?? "")) {
    fail("INVALID_ARTIFACT", "the owner-paid mint plan is invalid");
  }
  const expectedOwner = normalizedAddress(expected?.owner, "expected owner");
  const expectedAccount = normalizedAddress(expected?.account, "expected Punk Wallet");
  const punk = execution.punk;
  const transaction = execution.transaction;
  const safety = execution.safety;
  const decoded = decodeCanonicalOwnerPaidCalldata(transaction?.data);
  const collection = normalizedAddress(execution.collection, "plan collection");
  const expectedTokenId = decimalUint(execution.expectedTokenId, "plan token ID");
  if (String(punk?.tokenId) !== String(expected?.tokenId)
    || normalizedAddress(punk?.expectedOwner, "plan owner") !== expectedOwner
    || normalizedAddress(punk?.account, "plan Punk Wallet") !== expectedAccount
    || normalizedAddress(transaction?.from, "transaction sender") !== expectedOwner
    || normalizedAddress(transaction?.to, "transaction destination") !== expectedAccount
    || transaction?.value !== "0" || !HASH.test(transaction?.dataKeccak256 ?? "")
    || transaction.dataKeccak256.toLowerCase() !== keccak256Hex(transaction.data)
    || decoded.account !== expectedAccount || decoded.expectedOwner !== expectedOwner
    || decoded.chainId !== BigInt(CHAIN_ID) || decoded.collection !== collection
    || decoded.tokenId !== expectedTokenId || decoded.opportunityType !== 2n
    || decoded.assetStandard !== 0n || decoded.assetAmount !== 1n
    || decoded.currency !== ZERO_ADDRESS || decoded.expectedPrice !== 0n
    || decoded.maxPrice !== 0n || decoded.maxSlippageBps !== 0n
    || decoded.createdAt >= decoded.expiresAt
    || safety?.currentOwnerOnly !== true || safety?.exactAccountEntryPointOnly !== true
    || safety?.ownerSignatureBytesEmpty !== true || safety?.adapterDataEmpty !== true
    || safety?.mintPriceWei !== "0" || safety?.quantity !== "1"
    || normalizedAddress(safety?.recipient, "mint recipient") !== expectedAccount
    || safety?.approvalsAllowed !== false || safety?.arbitraryCalldataAllowed !== false
    || safety?.submissionPerformed !== false) {
    fail("INVALID_ARTIFACT", "the owner-paid mint plan does not match this Punk and its fixed safety limits");
  }
  const expiresAt = Number(execution.expiresAt);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || expiresAt > nowSeconds + 180) {
    fail("EXPIRED_ARTIFACT", "the owner-paid mint plan expired; check the mint again");
  }
  if (decoded.expiresAt !== BigInt(expiresAt)) {
    fail("INVALID_ARTIFACT", "calldata expiry does not match the reviewed plan");
  }
  return Object.freeze({
    from: expectedOwner,
    to: expectedAccount,
    value: "0x0",
    data: transaction.data,
  });
}

export async function requestOwnerPaidFreeMint(fetchFunction, tokenId) {
  const response = await fetchFunction("/api/broker/autonomy-v3-owner-run", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ tokenId: String(tokenId) }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    fail(payload?.code ?? "PREPARATION_FAILED", payload?.message
      ?? "the immediate mint could not be prepared safely");
  }
  return payload.run;
}

export async function preflightOwnerPaidFreeMint(provider, execution, expected) {
  const transaction = validateOwnerPaidFreeMintExecution(execution, expected);
  const [chainId, accounts] = await Promise.all([
    rpc(provider, "eth_chainId"),
    rpc(provider, "eth_accounts"),
  ]);
  if (BigInt(chainId) !== BigInt(CHAIN_ID)) fail("WRONG_CHAIN", "switch to Robinhood Chain");
  const selected = Array.isArray(accounts) ? normalizedAddress(accounts[0], "connected wallet") : null;
  if (selected !== transaction.from) {
    fail("OWNER_MISMATCH", "connect the wallet that currently holds this Gogh Punk");
  }
  const [simulation, gas] = await Promise.all([
    rpc(provider, "eth_call", [transaction, "latest"]),
    rpc(provider, "eth_estimateGas", [transaction]),
  ]);
  if (typeof simulation !== "string" || !/^0x[0-9a-fA-F]*$/.test(simulation)
    || BigInt(gas) <= 0n) {
    fail("SIMULATION_FAILED", "the exact free-mint transaction did not simulate successfully");
  }
  return transaction;
}

export async function submitOwnerPaidFreeMint(provider, transaction) {
  const hash = await rpc(provider, "eth_sendTransaction", [transaction]);
  if (!HASH.test(hash ?? "")) fail("SUBMISSION_UNCONFIRMED", "wallet did not return a transaction hash");
  return hash;
}
