import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  defineChain,
  http,
  keccak256,
  toFunctionSelector,
} from "viem";
import { ROBINHOOD, normalizeAddress } from "../broker/src/config.mjs";

export const EIP1967_SLOTS = Object.freeze({
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
});

const ZERO_WORD = `0x${"0".repeat(64)}`;
const MAX_ABI_RESPONSE_BYTES = 1_000_000;
const MAX_ABI_EVIDENCE_BYTES = 1_100_000;
const MAX_ABI_ITEMS = 5_000;
const MAX_ABI_PARAMETERS = 20_000;
const MAX_ABI_DEPTH = 8;
const DEFAULT_CONFIRMATIONS = 20;
const MIN_CONFIRMATIONS = 1;
const MAX_CONFIRMATIONS = 256;
const ASSET_STANDARDS = new Set(["ERC721", "ERC1155"]);
const ABI_ITEM_KEYS = new Set([
  "anonymous",
  "inputs",
  "name",
  "outputs",
  "stateMutability",
  "type",
]);
const ABI_PARAMETER_KEYS = new Set([
  "components",
  "indexed",
  "internalType",
  "name",
  "type",
]);
const MUTABILITIES = new Set(["pure", "view", "nonpayable", "payable"]);
const INSPECTION_OPTION_KEYS = new Set([
  "blockscoutAbiEvidence",
  "confirmations",
  "expectedAssetStandard",
  "expectedCollection",
  "expectedSelector",
  "target",
]);
const DEPENDENCY_KEYS = new Set(["publicClient"]);

const robinhoodChain = defineChain({
  id: ROBINHOOD.chainId,
  name: ROBINHOOD.name,
  nativeCurrency: ROBINHOOD.nativeCurrency,
  rpcUrls: { default: { http: [ROBINHOOD.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: ROBINHOOD.explorerUrl } },
});

function assertPlainObject(value, field) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${field} must be an object`);
  }
}

function rejectUnknownKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${field}.${key} is not allowed`);
  }
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function assertBoundedString(value, field, maximum = 256) {
  if (typeof value !== "string" || value.length > maximum) {
    throw new TypeError(`${field} must be a string of at most ${maximum} characters`);
  }
}

function normalizeHash(value, field) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${field} must be a 32-byte hex value`);
  }
  return value.toLowerCase();
}

function normalizeSelector(value, field = "expectedSelector") {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(value)) {
    throw new TypeError(`${field} must be a 4-byte hex selector`);
  }
  const normalized = value.toLowerCase();
  if (normalized === "0x00000000") throw new TypeError(`${field} must not be zero`);
  return normalized;
}

function normalizeNonzeroAddress(value, field) {
  const normalized = normalizeAddress(value, field);
  if (normalized === "0x0000000000000000000000000000000000000000") {
    throw new TypeError(`${field} must not be zero`);
  }
  return normalized;
}

function normalizeConfirmations(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < MIN_CONFIRMATIONS
    || parsed > MAX_CONFIRMATIONS
  ) {
    throw new TypeError(
      `confirmations must be an integer from ${MIN_CONFIRMATIONS} through ${MAX_CONFIRMATIONS}`,
    );
  }
  return parsed;
}

function normalizeBytecode(value, field, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === "0x") {
    if (allowEmpty) return null;
    throw new TypeError(`${field} has no runtime bytecode at the pinned block`);
  }
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
    throw new TypeError(`${field} must be non-empty, byte-aligned runtime bytecode`);
  }
  return value.toLowerCase();
}

function normalizeStorageWord(value, field) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError(`${field} must be a 32-byte storage word`);
  }
  return value.toLowerCase();
}

function storageAddress(word, field) {
  if (word === ZERO_WORD) return null;
  if (!word.startsWith(`0x${"0".repeat(24)}`)) {
    throw new TypeError(`${field} does not contain a canonical EVM address`);
  }
  const address = `0x${word.slice(-40)}`;
  return address === "0x0000000000000000000000000000000000000000" ? null : address;
}

function canonicalParameterType(parameter, field, depth, budget) {
  if (depth > MAX_ABI_DEPTH) throw new TypeError(`${field} exceeds maximum component depth`);
  assertPlainObject(parameter, field);
  rejectUnknownKeys(parameter, ABI_PARAMETER_KEYS, field);
  budget.count += 1;
  if (budget.count > MAX_ABI_PARAMETERS) throw new TypeError("ABI has too many parameters");

  assertBoundedString(parameter.name ?? "", `${field}.name`);
  assertBoundedString(parameter.type, `${field}.type`, 128);
  if (parameter.internalType !== undefined) {
    assertBoundedString(parameter.internalType, `${field}.internalType`, 512);
  }
  if (parameter.indexed !== undefined && typeof parameter.indexed !== "boolean") {
    throw new TypeError(`${field}.indexed must be boolean`);
  }

  const tupleMatch = /^(tuple)((?:\[[0-9]*\])*)$/.exec(parameter.type);
  if (tupleMatch) {
    if (!Array.isArray(parameter.components)) {
      throw new TypeError(`${field}.components is required for tuple types`);
    }
    const components = parameter.components.map((component, index) => (
      canonicalParameterType(component, `${field}.components[${index}]`, depth + 1, budget)
    ));
    return `(${components.join(",")})${tupleMatch[2]}`;
  }
  if (parameter.components !== undefined) {
    throw new TypeError(`${field}.components is only allowed for tuple types`);
  }
  if (!/^[A-Za-z][A-Za-z0-9]*(?:\[[0-9]*\])*$/.test(parameter.type)) {
    throw new TypeError(`${field}.type is not a canonical ABI type`);
  }
  return parameter.type;
}

function validateAbiItem(item, index, budget) {
  const field = `ABI[${index}]`;
  assertPlainObject(item, field);
  rejectUnknownKeys(item, ABI_ITEM_KEYS, field);
  if (!["constructor", "error", "event", "fallback", "function", "receive"].includes(item.type)) {
    throw new TypeError(`${field}.type is unsupported`);
  }

  if (["error", "event", "function"].includes(item.type)) {
    assertBoundedString(item.name, `${field}.name`, 256);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(item.name)) {
      throw new TypeError(`${field}.name is not a valid ABI identifier`);
    }
  } else if (item.name !== undefined) {
    throw new TypeError(`${field}.name is not allowed for ${item.type}`);
  }

  if (item.inputs !== undefined && !Array.isArray(item.inputs)) {
    throw new TypeError(`${field}.inputs must be an array`);
  }
  const inputTypes = (item.inputs ?? []).map((parameter, parameterIndex) => (
    canonicalParameterType(parameter, `${field}.inputs[${parameterIndex}]`, 0, budget)
  ));

  if (item.outputs !== undefined && !Array.isArray(item.outputs)) {
    throw new TypeError(`${field}.outputs must be an array`);
  }
  const outputTypes = (item.outputs ?? []).map((parameter, parameterIndex) => (
    canonicalParameterType(parameter, `${field}.outputs[${parameterIndex}]`, 0, budget)
  ));

  if (item.type === "function" && !Array.isArray(item.outputs)) {
    throw new TypeError(`${field}.outputs is required for functions`);
  }
  if (item.type !== "function" && item.outputs !== undefined) {
    throw new TypeError(`${field}.outputs is only allowed for functions`);
  }
  if (["constructor", "fallback", "function", "receive"].includes(item.type)) {
    if (!MUTABILITIES.has(item.stateMutability)) {
      throw new TypeError(`${field}.stateMutability is invalid`);
    }
  } else if (item.stateMutability !== undefined) {
    throw new TypeError(`${field}.stateMutability is not allowed for ${item.type}`);
  }
  if (item.type === "event") {
    if (typeof item.anonymous !== "boolean") {
      throw new TypeError(`${field}.anonymous is required and must be boolean`);
    }
  } else if (item.anonymous !== undefined) {
    throw new TypeError(`${field}.anonymous is only allowed for events`);
  }

  if (["fallback", "receive"].includes(item.type) && inputTypes.length !== 0) {
    throw new TypeError(`${field}.inputs must be empty for ${item.type}`);
  }

  if (item.type !== "function") return null;
  const signature = `${item.name}(${inputTypes.join(",")})`;
  return Object.freeze({
    name: item.name,
    signature,
    selector: toFunctionSelector(signature).toLowerCase(),
    stateMutability: item.stateMutability,
    inputTypes: Object.freeze(inputTypes),
    outputTypes: Object.freeze(outputTypes),
  });
}

export function parseBlockscoutAbiResponse(response) {
  const serialized = typeof response === "string" ? response : JSON.stringify(response);
  if (typeof serialized !== "string" || byteLength(serialized) > MAX_ABI_RESPONSE_BYTES) {
    throw new TypeError(`Blockscout ABI response exceeds ${MAX_ABI_RESPONSE_BYTES} bytes`);
  }
  let envelope;
  try {
    envelope = typeof response === "string" ? JSON.parse(response) : response;
  } catch {
    throw new TypeError("Blockscout ABI response must be valid JSON");
  }
  assertPlainObject(envelope, "Blockscout ABI response");
  rejectUnknownKeys(envelope, new Set(["message", "result", "status"]), "Blockscout ABI response");
  if (envelope.status !== "0" && envelope.status !== "1") {
    throw new TypeError("Blockscout ABI response.status must be exactly 0 or 1");
  }
  if (envelope.message !== undefined) {
    assertBoundedString(envelope.message, "Blockscout ABI response.message", 256);
  }
  if (typeof envelope.result !== "string") {
    throw new TypeError("Blockscout ABI response.result must be a JSON string");
  }
  if (byteLength(envelope.result) > MAX_ABI_RESPONSE_BYTES) {
    throw new TypeError(`Blockscout ABI result exceeds ${MAX_ABI_RESPONSE_BYTES} bytes`);
  }
  if (envelope.status === "0") {
    return Object.freeze({ verified: false, functions: Object.freeze([]), itemCount: 0 });
  }

  let abi;
  try {
    abi = JSON.parse(envelope.result);
  } catch {
    throw new TypeError("Blockscout ABI result must contain valid JSON");
  }
  if (!Array.isArray(abi)) throw new TypeError("Blockscout ABI result must contain an array");
  if (abi.length > MAX_ABI_ITEMS) {
    throw new TypeError(`Blockscout ABI exceeds ${MAX_ABI_ITEMS} items`);
  }
  const budget = { count: 0 };
  const functions = abi
    .map((item, index) => validateAbiItem(item, index, budget))
    .filter(Boolean);
  return Object.freeze({
    verified: true,
    functions: Object.freeze(functions),
    itemCount: abi.length,
  });
}

export function parseBlockscoutAbiEvidence(evidence) {
  const serialized = typeof evidence === "string" ? evidence : JSON.stringify(evidence);
  if (typeof serialized !== "string" || byteLength(serialized) > MAX_ABI_EVIDENCE_BYTES) {
    throw new TypeError(`Blockscout ABI evidence exceeds ${MAX_ABI_EVIDENCE_BYTES} bytes`);
  }
  let envelope;
  try {
    envelope = typeof evidence === "string" ? JSON.parse(evidence) : evidence;
  } catch {
    throw new TypeError("Blockscout ABI evidence must be valid JSON");
  }
  assertPlainObject(envelope, "Blockscout ABI evidence");
  rejectUnknownKeys(
    envelope,
    new Set(["chainId", "response", "runtimeCodeHash", "target"]),
    "Blockscout ABI evidence",
  );
  if (envelope.chainId !== ROBINHOOD.chainId) {
    throw new TypeError(`Blockscout ABI evidence.chainId must be exactly ${ROBINHOOD.chainId}`);
  }
  const target = normalizeNonzeroAddress(envelope.target, "Blockscout ABI evidence.target");
  const runtimeCodeHash = normalizeHash(
    envelope.runtimeCodeHash,
    "Blockscout ABI evidence.runtimeCodeHash",
  );
  const abi = parseBlockscoutAbiResponse(envelope.response);
  return Object.freeze({ chainId: envelope.chainId, target, runtimeCodeHash, abi });
}

function expectation(value, normalizer, field) {
  if (value === undefined || value === null) return { value: null, status: "UNVERIFIED" };
  return { value: normalizer(value, field), status: "SUPPLIED_NOT_VERIFIED" };
}

async function inspectRelatedCode(publicClient, address, blockNumber) {
  if (!address) return { address: null, status: "NOT_SET", byteLength: null, codeHash: null };
  const bytecode = normalizeBytecode(
    await publicClient.getBytecode({ address, blockNumber }),
    `runtime bytecode for ${address}`,
    { allowEmpty: true },
  );
  if (!bytecode) return { address, status: "NO_CODE", byteLength: 0, codeHash: null };
  return {
    address,
    status: "CODE_PRESENT",
    byteLength: (bytecode.length - 2) / 2,
    codeHash: keccak256(bytecode),
  };
}

function evaluateNarrowShape(abi, expectedSelector) {
  if (!expectedSelector) {
    return {
      matches: false,
      status: "UNVERIFIED_SELECTOR_REQUIRED",
      selector: null,
      uniqueFunction: null,
      zeroCostSemantics: "UNVERIFIED",
    };
  }
  if (!abi?.verified) {
    return {
      matches: false,
      status: "UNVERIFIED_ABI_REQUIRED",
      selector: expectedSelector,
      uniqueFunction: null,
      zeroCostSemantics: "UNVERIFIED",
    };
  }
  const selectorFunctions = abi.functions.filter((entry) => entry.selector === expectedSelector);
  const uniqueFunction = selectorFunctions.length === 1 ? selectorFunctions[0] : null;
  const matches = Boolean(
    uniqueFunction
    && uniqueFunction.inputTypes.length === 2
    && uniqueFunction.inputTypes[0] === "address"
    && uniqueFunction.inputTypes[1] === "uint256"
    && ["nonpayable", "payable"].includes(uniqueFunction.stateMutability),
  );
  return {
    matches,
    status: matches
      ? "MATCHES_BOUND_VERIFIED_NARROW_CALL_SHAPE"
      : "DOES_NOT_MATCH_BOUND_VERIFIED_NARROW_CALL_SHAPE",
    selector: expectedSelector,
    uniqueFunction: matches ? {
      name: uniqueFunction.name,
      signature: uniqueFunction.signature,
      selector: uniqueFunction.selector,
      stateMutability: uniqueFunction.stateMutability,
    } : null,
    zeroCostSemantics: "UNVERIFIED",
  };
}

export async function inspectFreeMintTarget(options, dependencies = {}) {
  assertPlainObject(options, "options");
  rejectUnknownKeys(options, INSPECTION_OPTION_KEYS, "options");
  assertPlainObject(dependencies, "dependencies");
  rejectUnknownKeys(dependencies, DEPENDENCY_KEYS, "dependencies");
  const target = normalizeNonzeroAddress(options.target, "target");
  const confirmations = normalizeConfirmations(options.confirmations ?? DEFAULT_CONFIRMATIONS);
  const expectedCollection = expectation(
    options.expectedCollection,
    normalizeNonzeroAddress,
    "expectedCollection",
  );
  const expectedSelector = expectation(
    options.expectedSelector,
    normalizeSelector,
    "expectedSelector",
  );
  const expectedAssetStandard = expectation(
    options.expectedAssetStandard,
    (value, field) => {
      if (!ASSET_STANDARDS.has(value)) throw new TypeError(`${field} must be ERC721 or ERC1155`);
      return value;
    },
    "expectedAssetStandard",
  );
  const publicClient = dependencies.publicClient ?? createPublicClient({
    chain: robinhoodChain,
    transport: http(ROBINHOOD.rpcUrl),
  });
  for (const method of ["getChainId", "getBlockNumber", "getBlock", "getBytecode", "getStorageAt"]) {
    if (typeof publicClient?.[method] !== "function") {
      throw new TypeError(`publicClient.${method} is required`);
    }
  }

  const observedChainId = await publicClient.getChainId();
  if (observedChainId !== ROBINHOOD.chainId) {
    throw new Error(`refusing chain ${observedChainId}; Robinhood chain ${ROBINHOOD.chainId} is required`);
  }
  const head = await publicClient.getBlockNumber();
  if (typeof head !== "bigint" || head <= BigInt(confirmations)) {
    throw new Error("chain head is too low to pin the requested confirmed block");
  }
  const blockNumber = head - BigInt(confirmations);
  const block = await publicClient.getBlock({ blockNumber });
  if (!block || block.number !== blockNumber) throw new Error("RPC did not return the requested pinned block");
  const blockHash = normalizeHash(block.hash, "pinned block hash");
  if (typeof block.timestamp !== "bigint" || block.timestamp < 0n) {
    throw new TypeError("pinned block timestamp must be a non-negative bigint");
  }

  const runtimeBytecode = normalizeBytecode(
    await publicClient.getBytecode({ address: target, blockNumber }),
    "target",
  );
  const runtimeCodeHash = keccak256(runtimeBytecode);
  const slots = {};
  for (const [name, slot] of Object.entries(EIP1967_SLOTS)) {
    const rawValue = normalizeStorageWord(
      await publicClient.getStorageAt({ address: target, slot, blockNumber }),
      `EIP-1967 ${name} slot`,
    );
    const address = storageAddress(rawValue, `EIP-1967 ${name} slot`);
    slots[name] = {
      slot,
      rawValue,
      address,
      status: address ? "SET" : "EMPTY",
      runtime: await inspectRelatedCode(publicClient, address, blockNumber),
    };
  }

  let abi = null;
  let abiBinding = null;
  if (options.blockscoutAbiEvidence !== undefined) {
    const evidence = parseBlockscoutAbiEvidence(options.blockscoutAbiEvidence);
    if (evidence.target !== target) {
      throw new TypeError("Blockscout ABI evidence target does not match the inspected target");
    }
    if (evidence.runtimeCodeHash !== runtimeCodeHash) {
      throw new TypeError("Blockscout ABI evidence runtime code hash does not match pinned code");
    }
    abi = evidence.abi;
    abiBinding = {
      chainId: evidence.chainId,
      target: evidence.target,
      runtimeCodeHash: evidence.runtimeCodeHash,
      status: "BOUND_TO_PINNED_RUNTIME",
    };
  }
  const narrowShape = evaluateNarrowShape(abi, expectedSelector.value);
  const proxySignal = slots.implementation.address || slots.beacon.address
    ? "EIP1967_IMPLEMENTATION_OR_BEACON_SLOT_SET"
    : slots.admin.address
      ? "EIP1967_ADMIN_SLOT_SET"
      : "NO_STANDARD_EIP1967_SLOT_SIGNAL";
  const unverified = [
    "contract safety",
    "mint price and zero-cost semantics",
    "recipient and token-delivery semantics",
    "access control and pause state",
    "collection identity",
    "asset standard",
    "proxy absence when standard slots are empty",
  ];
  if (!expectedSelector.value) unverified.push("intended selector");
  if (!abi?.verified) unverified.push("verified contract ABI");
  unverified.push("independent RPC corroboration");

  const closingBlock = await publicClient.getBlock({ blockNumber });
  if (
    !closingBlock
    || closingBlock.number !== blockNumber
    || normalizeHash(closingBlock.hash, "closing pinned block hash") !== blockHash
  ) {
    throw new Error("pinned block hash changed during inspection");
  }

  return {
    schema: "GOGH_FREE_MINT_TARGET_INSPECTION_V1",
    mode: "READ_ONLY_FACTS",
    chain: { expectedChainId: ROBINHOOD.chainId, observedChainId },
    target,
    pinnedBlock: {
      number: blockNumber.toString(),
      hash: blockHash,
      timestamp: block.timestamp.toString(),
      confirmations,
      observedHead: head.toString(),
    },
    runtime: {
      byteLength: (runtimeBytecode.length - 2) / 2,
      codeHash: runtimeCodeHash,
    },
    eip1967: { ...slots, proxySignal },
    expectations: {
      collection: expectedCollection,
      selector: expectedSelector,
      assetStandard: expectedAssetStandard,
    },
    verifiedAbi: abi
      ? {
          status: abi.verified ? "BOUND_BLOCKSCOUT_GETABI_SUCCESS" : "UNVERIFIED",
          binding: abiBinding,
          itemCount: abi.itemCount,
          functionCount: abi.functions.length,
        }
      : { status: "UNVERIFIED", binding: null, itemCount: null, functionCount: null },
    narrowZeroCostAdapterShape: {
      ...narrowShape,
      caveat: "A runtime-bound verified ABI call-shape match does not establish safety, zero price, mint semantics, collection identity, access, or successful execution.",
    },
    unverified,
    security: {
      signingPerformed: false,
      submissionPerformed: false,
      deploymentPerformed: false,
      privateKeyAccepted: false,
    },
    provenance: {
      rpcCount: 1,
      status: "SINGLE_RPC_UNCORROBORATED",
      caveat: "Pinned-block consistency was checked twice on one RPC; independent RPC agreement remains UNVERIFIED.",
    },
  };
}

const VALUE_ARGUMENTS = new Map([
  ["--target", "target"],
  ["--expected-collection", "expectedCollection"],
  ["--expected-selector", "expectedSelector"],
  ["--expected-asset-standard", "expectedAssetStandard"],
  ["--confirmations", "confirmations"],
  ["--blockscout-abi-file", "blockscoutAbiFile"],
]);

export function parseInspectArguments(args) {
  if (!Array.isArray(args)) throw new TypeError("args must be an array");
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const field = VALUE_ARGUMENTS.get(argument);
    if (!field) throw new Error(`unknown argument: ${argument}`);
    if (Object.hasOwn(options, field)) throw new Error(`duplicate argument: ${argument}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
    options[field] = value;
    index += 1;
  }
  if (!Object.hasOwn(options, "target")) throw new Error("--target is required");
  options.target = normalizeNonzeroAddress(options.target, "target");
  if (options.expectedCollection !== undefined) {
    options.expectedCollection = normalizeNonzeroAddress(
      options.expectedCollection,
      "expectedCollection",
    );
  }
  if (options.expectedSelector !== undefined) {
    options.expectedSelector = normalizeSelector(options.expectedSelector);
  }
  if (
    options.expectedAssetStandard !== undefined
    && !ASSET_STANDARDS.has(options.expectedAssetStandard)
  ) {
    throw new TypeError("expectedAssetStandard must be ERC721 or ERC1155");
  }
  if (options.confirmations !== undefined) {
    options.confirmations = normalizeConfirmations(options.confirmations);
  }
  return options;
}

async function runCli(args) {
  const options = parseInspectArguments(args);
  if (options.blockscoutAbiFile !== undefined) {
    const abiPath = resolve(options.blockscoutAbiFile);
    const details = await stat(abiPath);
    if (!details.isFile() || details.size > MAX_ABI_RESPONSE_BYTES) {
      throw new TypeError(`Blockscout ABI file must be at most ${MAX_ABI_RESPONSE_BYTES} bytes`);
    }
    options.blockscoutAbiEvidence = await readFile(abiPath, "utf8");
    delete options.blockscoutAbiFile;
  }
  return inspectFreeMintTarget(options);
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  try {
    const report = await runCli(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(`FREE MINT TARGET INSPECTION ERROR: ${error.message}`);
    console.error([
      "Usage: node scripts/inspect-free-mint-target.mjs --target 0x...",
      "  [--expected-collection 0x...] [--expected-selector 0x12345678]",
      "  [--expected-asset-standard ERC721|ERC1155] [--confirmations 20]",
      "  [--blockscout-abi-file ./runtime-bound-blockscout-evidence.json]",
      "Read-only: this utility cannot accept keys, sign, send, or deploy.",
    ].join("\n"));
    process.exitCode = 2;
  }
}
