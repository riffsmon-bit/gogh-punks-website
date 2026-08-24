import {
  decodeFunctionData, encodeFunctionData, getAddress, isAddress, keccak256,
} from "viem";

import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";

export const SCATTER_MINT_SELECTOR = "0x4a21a2df";
export const SCATTER_PUBLIC_KEY_MAXIMUM = 255n;
export const SCATTER_MINT_ABI = Object.freeze([{
  type: "function",
  name: "mint",
  stateMutability: "payable",
  inputs: [{
    name: "auth",
    type: "tuple",
    components: [
      { name: "key", type: "bytes32" },
      { name: "proof", type: "bytes32[]" },
    ],
  }, {
    name: "quantity",
    type: "uint256",
  }, {
    name: "affiliate",
    type: "address",
  }, {
    name: "signature",
    type: "bytes",
  }],
  outputs: [],
}]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function snapshot(value, label) {
  try {
    return parseCanonicalJson(canonicalJson(value));
  } catch {
    fail("INVALID_JSON", `${label} must be plain canonical JSON`);
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
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    fail("INVALID_ADDRESS", `${label} must be an exact address`);
  }
  const normalized = getAddress(value).toLowerCase();
  if (normalized === ZERO_ADDRESS) fail("INVALID_ADDRESS", `${label} cannot be zero`);
  return normalized;
}

function decimalZero(value, label) {
  if (value !== "0") fail("NONZERO_PAYMENT", `${label} must be the canonical zero string`);
}

function bytes(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/.test(value)) {
    fail("INVALID_CALLDATA", `${label} must be lowercase even-length hex bytes`);
  }
  return value;
}

export function screenScatterMintApiResponse(requestInput, responseInput) {
  const request = snapshot(requestInput, "request");
  const response = snapshot(responseInput, "response");
  exactKeys(request, ["collectionAddress", "chainId", "minterAddress", "lists"], "request");
  if (request.chainId !== 4663) fail("WRONG_CHAIN", "Scatter request must target Robinhood");
  const collection = address(request.collectionAddress, "request.collectionAddress");
  const account = address(request.minterAddress, "request.minterAddress");
  if (!Array.isArray(request.lists) || request.lists.length !== 1) {
    fail("INVALID_LIST", "Scatter request must contain exactly one list");
  }
  exactKeys(request.lists[0], ["id", "quantity"], "request.lists[0]");
  if (typeof request.lists[0].id !== "string" || !/^[a-z0-9]{1,128}$/.test(request.lists[0].id)
    || request.lists[0].quantity !== 1) {
    fail("INVALID_LIST", "Scatter request must bind one canonical list ID and quantity one");
  }

  exactKeys(response, ["erc20s", "mintTransaction"], "response");
  if (!Array.isArray(response.erc20s) || response.erc20s.length !== 0) {
    fail("ERC20_UNSUPPORTED", "Scatter ERC-20 approvals are never supported");
  }
  exactKeys(response.mintTransaction, ["data", "to", "value"], "response.mintTransaction");
  const target = address(response.mintTransaction.to, "response.mintTransaction.to");
  if (target !== collection) fail("WRONG_TARGET", "Scatter mint target must equal the collection");
  decimalZero(response.mintTransaction.value, "response.mintTransaction.value");
  const data = bytes(response.mintTransaction.data, "response.mintTransaction.data");
  if (!data.startsWith(SCATTER_MINT_SELECTOR)) {
    fail("WRONG_SELECTOR", "Scatter calldata must use the reviewed mint function");
  }

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: SCATTER_MINT_ABI, data });
  } catch {
    fail("INVALID_CALLDATA", "Scatter calldata cannot be decoded as the reviewed mint function");
  }
  if (decoded.functionName !== "mint" || decoded.args.length !== 4) {
    fail("WRONG_SELECTOR", "Scatter calldata must use the reviewed mint function");
  }
  const [auth, quantity, affiliate, signature] = decoded.args;
  if (BigInt(auth.key) > SCATTER_PUBLIC_KEY_MAXIMUM || auth.proof.length !== 0) {
    fail("NONPUBLIC_LIST", "Scatter automation accepts only public keys 0 through 255");
  }
  if (quantity !== 1n) fail("INVALID_QUANTITY", "Scatter quantity must equal one");
  if (getAddress(affiliate).toLowerCase() !== ZERO_ADDRESS || signature !== "0x") {
    fail("AFFILIATE_UNSUPPORTED", "Scatter affiliate and signature must be empty");
  }
  const canonicalData = encodeFunctionData({
    abi: SCATTER_MINT_ABI,
    functionName: "mint",
    args: [{ key: auth.key, proof: [] }, 1n, ZERO_ADDRESS, "0x"],
  });
  if (canonicalData !== data) {
    fail("NONCANONICAL_CALLDATA", "Scatter calldata must exactly re-encode canonically");
  }

  return Object.freeze({
    schema: "GOGH_AUTOMATED_SCATTER_API_SCREEN_V1",
    version: 1,
    chainId: 4663,
    collection,
    account,
    listId: request.lists[0].id,
    publicInviteKey: auth.key,
    quantity: 1,
    valueWei: "0",
    selector: SCATTER_MINT_SELECTOR,
    calldataKeccak256: keccak256(data),
    erc20ApprovalsRequired: false,
    apiCalldataTrustedForExecution: false,
  });
}
