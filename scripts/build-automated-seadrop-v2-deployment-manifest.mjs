import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
} from "viem";

import { canonicalJson } from "../broker/src/scout/canonical-json.mjs";

export const AUTOMATION_V2_DEPLOYMENT_ORDER = Object.freeze([
  "AutomatedSeaDropFreeMintAdapter",
  "BrokerPolicyModuleV2",
  "GoghPunkAccountV2",
  "GoghPunkAccountRegistryV2",
]);

const BROADCAST_CONTRACT_NAMES = Object.freeze([
  "AutomatedSeaDropFreeMintAdapter",
  "BrokerPolicyModuleV2",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistryV2",
]);
const ARTIFACT_PATHS = Object.freeze({
  AutomatedSeaDropFreeMintAdapter:
    "contracts/out/AutomatedSeaDropFreeMintAdapter.sol/AutomatedSeaDropFreeMintAdapter.json",
  BrokerPolicyModuleV2: "contracts/out/BrokerPolicyModuleV2.sol/BrokerPolicyModuleV2.json",
  GoghPunkAccountV2: "contracts/out/GoghPunkAccountV1.sol/GoghPunkAccountV1.json",
  GoghPunkAccountRegistryV2:
    "contracts/out/GoghPunkAccountRegistryV2.sol/GoghPunkAccountRegistryV2.json",
});
const COMPILER_INPUT_PATHS = Object.freeze([
  "contracts/src",
  "contracts/script/DeployAutomatedSeaDropV2.s.sol",
  "foundry.toml",
  "remappings.txt",
  "package.json",
  "package-lock.json",
]);
const CHAIN_ID = 4663;
const MIN_CONFIRMATIONS = 20;
const MAX_CONFIRMATIONS = 256;
const MAX_HEAD_SKEW = 128n;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"0".repeat(64)}`;
const GUARDIAN = "0x2b05E3BB4895A00d52894B98839Ae421d4139Ec8";
const ADAPTER_REGISTRY = "0x421D51709Fe21736a35fFa2a86B157Df1b030EE2";
const AGENT_REGISTRY = "0xbffbccd20E796e0f3E745B274De60EF17a485Dde";
const SEA_DROP = "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5";
const SEA_DROP_HASH =
  "0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c";
const CLONE_IMPLEMENTATION = "0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A";
const CLONE_IMPLEMENTATION_HASH =
  "0xda60742d810ae5de9c087af2e82b05fb84e9112cfade927fca0db6490ea52519";
const COLLECTION_RUNTIME_HASH =
  "0xe3e252831cdd0c11e1327d04a57ddd9bfa11ef49d50edb524040d98bfb228bc4";
const CANONICAL_COLLECTION = "0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6";
const CANONICAL_ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const projectRoot = resolve(import.meta.dirname, "..");
const broadcastRoot = resolve(
  projectRoot,
  "broadcast/DeployAutomatedSeaDropV2.s.sol/4663",
);
const execFileAsync = promisify(execFile);

export class AutomationV2ManifestError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "AutomationV2ManifestError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AutomationV2ManifestError(code, message);
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  return value;
}

function own(value, key, label) {
  if (!Object.hasOwn(value, key)) fail("INVALID_SCHEMA", `${label}.${key} is required`);
  return value[key];
}

function snapshot(value, maximum = MAX_FILE_BYTES, label = "value") {
  let text;
  try {
    text = canonicalJson(value);
  } catch {
    fail("INVALID_SCHEMA", `${label} must be strict canonical JSON`);
  }
  if (Buffer.byteLength(text) > maximum) fail("INPUT_TOO_LARGE", `${label} is too large`);
  return JSON.parse(text);
}

function address(value, label, { zero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)
    || (!zero && /^0x0{40}$/i.test(value))) fail("INVALID_ADDRESS", `${label} is invalid`);
  return getAddress(value);
}

function hash(value, label, { zero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)
    || (!zero && /^0x0{64}$/i.test(value))) fail("INVALID_HASH", `${label} is invalid`);
  return value.toLowerCase();
}

function commit(value, label, { foundry = false } = {}) {
  const pattern = foundry ? /^[0-9a-f]{7,40}$/ : /^[0-9a-f]{40}$/;
  if (typeof value !== "string" || !pattern.test(value)) fail("INVALID_COMMIT", `${label} is invalid`);
  return value;
}

function uint(value, label) {
  try {
    const parsed = typeof value === "bigint" ? value : BigInt(value);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    fail("INVALID_INTEGER", `${label} is invalid`);
  }
}

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalSha256(value) {
  return sha256(canonicalJson(value));
}

function normalizeHex(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    fail("INVALID_HEX", `${label} is invalid`);
  }
  return value.toLowerCase();
}

function rpcComparable(value, seen = new Set()) {
  if (value === undefined) return ["undefined"];
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      fail("INVALID_RPC_RESPONSE", "RPC response contains an unsafe number");
    }
    return ["number", String(value)];
  }
  if (typeof value !== "object" || seen.has(value)) {
    fail("INVALID_RPC_RESPONSE", "RPC response is not deterministic data");
  }
  seen.add(value);
  let normalized;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail("INVALID_RPC_RESPONSE", "RPC response contains a custom array");
    }
    normalized = value.map((item) => rpcComparable(item, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("INVALID_RPC_RESPONSE", "RPC response contains a custom object");
    }
    normalized = {};
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        fail("INVALID_RPC_RESPONSE", "RPC response contains an accessor");
      }
      normalized[key] = rpcComparable(descriptor.value, seen);
    }
  }
  seen.delete(value);
  return normalized;
}

function successfulReceipt(status) {
  return status === "success" || status === 1 || status === 1n || status === "0x1";
}

function codeBytes(value, label) {
  const normalized = normalizeHex(value, label);
  if (normalized === "0x") fail("MISSING_CODE", `${label} is empty`);
  return normalized;
}

function registrableDomain(hostname) {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz"]).has(lastTwo)
    ? labels.slice(-3).join(".") : lastTwo;
}

function normalizeEndpointEntries(entries) {
  if (!Array.isArray(entries) || entries.length !== 2) {
    fail("INSUFFICIENT_READ_CLIENTS", "exactly two read clients are required");
  }
  const clients = new Set();
  const origins = new Set();
  const domains = new Set();
  return entries.map((entry, index) => {
    plain(entry, `readEndpoints[${index}]`);
    const client = own(entry, "client", `readEndpoints[${index}]`);
    let declared;
    let transport;
    try {
      declared = new URL(own(entry, "origin", `readEndpoints[${index}]`));
      transport = new URL(client?.transport?.url);
    } catch {
      fail("INVALID_RPC_ORIGIN", `read endpoint ${index + 1} has invalid provenance`);
    }
    if (declared.protocol !== "https:" || declared.username || declared.password
      || declared.origin !== entry.origin || transport.origin !== declared.origin) {
      fail("INVALID_RPC_ORIGIN", `read endpoint ${index + 1} is not bound to its HTTPS origin`);
    }
    const domain = registrableDomain(declared.hostname);
    if (clients.has(client) || origins.has(declared.origin) || domains.has(domain)) {
      fail("DUPLICATE_RPC_PROVIDER", "read clients must use distinct provider domains");
    }
    for (const method of [
      "getChainId", "getBlockNumber", "getBlock", "getTransaction", "getTransactionReceipt",
      "getCode", "readContract",
    ]) if (typeof client?.[method] !== "function") {
      fail("INVALID_READ_CLIENT", `read endpoint ${index + 1} lacks ${method}`);
    }
    clients.add(client);
    origins.add(declared.origin);
    domains.add(domain);
    return { client, origin: declared.origin, providerDomain: domain };
  });
}

function maskRuntime(code, references, label) {
  const bytes = Buffer.from(code.slice(2), "hex");
  const ranges = [];
  for (const items of Object.values(references ?? {})) {
    if (!Array.isArray(items)) fail("INVALID_ARTIFACT", `${label} immutable references are invalid`);
    for (const item of items) {
      plain(item, `${label} immutable reference`);
      if (!Number.isInteger(item.start) || item.start < 0 || item.length !== 32
        || item.start + item.length > bytes.length) {
        fail("INVALID_ARTIFACT", `${label} immutable reference is invalid`);
      }
      ranges.push([item.start, item.start + item.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index][0] < ranges[index - 1][1]) fail("INVALID_ARTIFACT", `${label} immutables overlap`);
  }
  for (const [start, end] of ranges) bytes.fill(0, start, end);
  return `0x${bytes.toString("hex")}`;
}

function normalizeCompiled(name, raw) {
  const artifact = snapshot(raw, MAX_FILE_BYTES, `${name} artifact`);
  plain(artifact, `${name} artifact`);
  if (!Array.isArray(artifact.abi) || typeof artifact.rawMetadata !== "string") {
    fail("INVALID_ARTIFACT", `${name} artifact lacks ABI or raw metadata`);
  }
  let metadata;
  try { metadata = JSON.parse(artifact.rawMetadata); } catch {
    fail("INVALID_ARTIFACT", `${name} raw metadata is invalid`);
  }
  const settings = plain(metadata.settings, `${name} compiler settings`);
  if (metadata.compiler?.version !== "0.8.34+commit.80d5c536"
    || settings.evmVersion !== "cancun" || settings.viaIR !== true
    || settings.optimizer?.enabled !== true || settings.optimizer?.runs !== 500
    || settings.metadata?.bytecodeHash !== "none") {
    fail("WRONG_COMPILER", `${name} was not built with the reviewed compiler profile`);
  }
  const creation = codeBytes(artifact.bytecode?.object, `${name} creation bytecode`);
  const deployed = codeBytes(artifact.deployedBytecode?.object, `${name} deployed bytecode`);
  const references = artifact.deployedBytecode?.immutableReferences ?? {};
  const sources = plain(metadata.sources, `${name} metadata sources`);
  const sourceHashes = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))
    .map(([path, item]) => [path, hash(item?.keccak256, `${name} source ${path}`)]));
  const constructors = artifact.abi.filter((item) => item?.type === "constructor");
  if (constructors.length !== 1 || !Array.isArray(constructors[0].inputs)) {
    fail("INVALID_ARTIFACT", `${name} constructor ABI is invalid`);
  }
  return {
    name,
    abi: artifact.abi,
    constructorInputs: constructors[0].inputs,
    creation,
    deployed,
    immutableReferences: references,
    creationBytecodeHash: keccak256(creation),
    deployedBytecodeTemplateHash: keccak256(deployed),
    maskedDeployedBytecodeHash: keccak256(maskRuntime(deployed, references, name)),
    rawMetadataSha256: sha256(artifact.rawMetadata),
    sourceSetSha256: canonicalSha256(sourceHashes),
    compilerSettingsSha256: canonicalSha256(settings),
    abiSha256: canonicalSha256(artifact.abi),
  };
}

function constructorArguments(compiled, values, label) {
  if (!Array.isArray(values) || values.length !== compiled.constructorInputs.length) {
    fail("CONSTRUCTOR_MISMATCH", `${label} constructor arguments are invalid`);
  }
  let encoded;
  try { encoded = encodeAbiParameters(compiled.constructorInputs, values).toLowerCase(); } catch {
    fail("CONSTRUCTOR_MISMATCH", `${label} constructor arguments cannot be encoded`);
  }
  return { values, encoded, initcode: `${compiled.creation}${encoded.slice(2)}` };
}

function parseBroadcast(artifact, compiled, releaseCommit) {
  const value = snapshot(artifact, MAX_FILE_BYTES, "broadcast artifact");
  if (value.chain !== CHAIN_ID || !Array.isArray(value.transactions)
    || !Array.isArray(value.receipts) || value.transactions.length !== 4
    || value.receipts.length !== 4 || !Array.isArray(value.pending) || value.pending.length !== 0
    || !Array.isArray(value.libraries) || value.libraries.length !== 0) {
    fail("INVALID_BROADCAST", "broadcast artifact is not the exact four-CREATE V2 run");
  }
  const foundryCommit = commit(value.commit, "Foundry artifact commit", { foundry: true });
  if (!releaseCommit.startsWith(foundryCommit)) fail("COMMIT_MISMATCH", "broadcast commit differs");
  let deployer;
  const records = AUTOMATION_V2_DEPLOYMENT_ORDER.map((name, index) => {
    const tx = plain(value.transactions[index], `transaction ${index + 1}`);
    const receipt = plain(value.receipts[index], `receipt ${index + 1}`);
    if (tx.transactionType !== "CREATE" || tx.contractName !== BROADCAST_CONTRACT_NAMES[index]
      || tx.function !== null || !Array.isArray(tx.additionalContracts)
      || tx.additionalContracts.length !== 0 || tx.isFixedGasLimit !== false) {
      fail("INVALID_BROADCAST", `transaction ${index + 1} is not the expected CREATE`);
    }
    const inner = plain(tx.transaction, `transaction ${index + 1} envelope`);
    const from = address(inner.from, `transaction ${index + 1} from`);
    deployer ??= from;
    if (from !== deployer || uint(inner.value, "transaction value") !== 0n
      || uint(inner.chainId, "transaction chain") !== BigInt(CHAIN_ID)
      || uint(inner.nonce, "transaction nonce") !== uint(value.transactions[0].transaction.nonce,
        "initial nonce") + BigInt(index)) {
      fail("INVALID_BROADCAST", `transaction ${index + 1} envelope is wrong`);
    }
    const args = constructorArguments(compiled[name], tx.arguments, name);
    if (normalizeHex(inner.input, `${name} initcode`) !== args.initcode.toLowerCase()) {
      fail("INITCODE_MISMATCH", `${name} initcode differs from the clean build`);
    }
    const transactionHash = hash(tx.hash, `${name} transaction hash`);
    if (hash(receipt.transactionHash, `${name} receipt transaction`) !== transactionHash
      || receipt.status !== "0x1" || receipt.to !== null
      || address(receipt.from, `${name} receipt from`) !== deployer
      || address(receipt.contractAddress, `${name} receipt contract`) !== address(
        tx.contractAddress, `${name} contract address`)) {
      fail("FAILED_DEPLOYMENT", `${name} broadcast receipt is invalid`);
    }
    return {
      name,
      address: address(tx.contractAddress, `${name} address`),
      transactionHash,
      deploymentBlock: Number(uint(receipt.blockNumber, `${name} deployment block`)),
      deploymentBlockHash: hash(receipt.blockHash, `${name} block hash`),
      transactionIndex: Number(uint(receipt.transactionIndex, `${name} transaction index`)),
      deployer,
      nonce: uint(inner.nonce, `${name} nonce`),
      constructorArguments: tx.arguments,
      initcode: args.initcode,
    };
  });
  return { records, deployer, foundryCommit };
}

const view = (name, outputs, inputs = []) => [{
  type: "function", name, stateMutability: "view", inputs, outputs,
}];
const addressOutput = [{ type: "address" }];
const bytes32Output = [{ type: "bytes32" }];
const uintOutput = [{ type: "uint256" }];

async function dualRead(endpoints, call, label) {
  let values;
  try { values = await Promise.all(endpoints.map(({ client }) => call(client))); } catch {
    fail("LIVE_READ_FAILED", `${label} failed`);
  }
  if (canonicalJson(rpcComparable(values[0])) !== canonicalJson(rpcComparable(values[1]))) {
    fail("RPC_DISAGREEMENT", `${label} differs between providers`);
  }
  return values[0];
}

async function verifyCriticalBindings(endpoints, blockNumber, addresses) {
  const read = (contract, functionName, outputs = addressOutput) => dualRead(
    endpoints,
    (client) => client.readContract({
      address: contract,
      abi: view(functionName, outputs),
      functionName,
      blockNumber,
    }),
    `${functionName} at ${contract}`,
  );
  const bindings = {
    adapter: {
      expectedSeaDropCodeHash: await read(addresses.AutomatedSeaDropFreeMintAdapter,
        "expectedSeaDropCodeHash", bytes32Output),
      expectedCloneImplementationCodeHash: await read(addresses.AutomatedSeaDropFreeMintAdapter,
        "expectedCloneImplementationCodeHash", bytes32Output),
      expectedCollectionRuntimeCodeHash: await read(addresses.AutomatedSeaDropFreeMintAdapter,
        "expectedCollectionRuntimeCodeHash", bytes32Output),
    },
    policy: {
      owner: await read(addresses.BrokerPolicyModuleV2, "owner"),
      pendingOwner: await read(addresses.BrokerPolicyModuleV2, "pendingOwner"),
      adapterRegistry: await read(addresses.BrokerPolicyModuleV2, "adapterRegistry"),
      automatedSeaDropAdapter: await read(addresses.BrokerPolicyModuleV2,
        "automatedSeaDropAdapter"),
    },
    accountImplementation: {
      collection: await read(addresses.GoghPunkAccountV2, "GOGH_PUNKS"),
      chainId: (await read(addresses.GoghPunkAccountV2, "ROBINHOOD_CHAIN_ID", uintOutput)).toString(),
      policyModule: await read(addresses.GoghPunkAccountV2, "policyModule"),
      agentRegistry: await read(addresses.GoghPunkAccountV2, "agentRegistry"),
      adapterRegistry: await read(addresses.GoghPunkAccountV2, "adapterRegistry"),
    },
    registry: {
      implementation: await read(addresses.GoghPunkAccountRegistryV2, "implementation"),
      accountSalt: await read(addresses.GoghPunkAccountRegistryV2, "accountSalt", bytes32Output),
      canonicalRegistry: await read(addresses.GoghPunkAccountRegistryV2, "canonicalRegistry"),
    },
  };
  if (hash(bindings.adapter.expectedSeaDropCodeHash, "SeaDrop immutable") !== SEA_DROP_HASH
    || hash(bindings.adapter.expectedCloneImplementationCodeHash, "clone immutable")
      !== CLONE_IMPLEMENTATION_HASH
    || hash(bindings.adapter.expectedCollectionRuntimeCodeHash, "collection immutable")
      !== COLLECTION_RUNTIME_HASH
    || address(bindings.policy.owner, "policy owner") !== getAddress(GUARDIAN)
    || address(bindings.policy.pendingOwner, "policy pending owner", { zero: true }) !== ZERO_ADDRESS
    || address(bindings.policy.adapterRegistry, "policy adapter registry")
      !== getAddress(ADAPTER_REGISTRY)
    || address(bindings.policy.automatedSeaDropAdapter, "policy adapter")
      !== addresses.AutomatedSeaDropFreeMintAdapter
    || address(bindings.accountImplementation.collection, "account collection")
      !== getAddress(CANONICAL_COLLECTION)
    || bindings.accountImplementation.chainId !== String(CHAIN_ID)
    || address(bindings.accountImplementation.policyModule, "account policy")
      !== addresses.BrokerPolicyModuleV2
    || address(bindings.accountImplementation.agentRegistry, "account agent registry")
      !== getAddress(AGENT_REGISTRY)
    || address(bindings.accountImplementation.adapterRegistry, "account adapter registry")
      !== getAddress(ADAPTER_REGISTRY)
    || address(bindings.registry.implementation, "registry implementation")
      !== addresses.GoghPunkAccountV2
    || hash(bindings.registry.accountSalt, "registry salt", { zero: true }) !== ZERO_HASH
    || address(bindings.registry.canonicalRegistry, "canonical registry")
      !== getAddress(CANONICAL_ERC6551_REGISTRY)) {
    fail("IMMUTABLE_BINDING_MISMATCH", "critical live V2 binding differs from the release");
  }
  return bindings;
}

async function verifyLive(records, compiled, endpointValues, confirmations) {
  const endpoints = normalizeEndpointEntries(endpointValues);
  const heads = await Promise.all(endpoints.map(async ({ client }, index) => {
    const chainId = await client.getChainId();
    if (Number(chainId) !== CHAIN_ID) fail("WRONG_CHAIN", `read endpoint ${index + 1} is wrong`);
    return uint(await client.getBlockNumber(), `read endpoint ${index + 1} head`);
  }));
  const minimumHead = heads[0] < heads[1] ? heads[0] : heads[1];
  const maximumHead = heads[0] > heads[1] ? heads[0] : heads[1];
  if (maximumHead - minimumHead > MAX_HEAD_SKEW || minimumHead <= BigInt(confirmations)) {
    fail("RPC_HEAD_SKEW", "read endpoints are too skewed or too shallow");
  }
  const pinnedNumber = minimumHead - BigInt(confirmations);
  const pinned = await dualRead(endpoints, (client) => client.getBlock({ blockNumber: pinnedNumber }),
    "common pinned block");
  const addresses = Object.fromEntries(records.map((record) => [record.name, record.address]));
  const evidence = {};
  for (const record of records) {
    const item = compiled[record.name];
    const [transaction, receipt, code, deploymentBlock] = await Promise.all([
      dualRead(endpoints, (client) => client.getTransaction({ hash: record.transactionHash }),
        `${record.name} transaction`),
      dualRead(endpoints, (client) => client.getTransactionReceipt({ hash: record.transactionHash }),
        `${record.name} receipt`),
      dualRead(endpoints, (client) => client.getCode({ address: record.address,
        blockNumber: pinnedNumber }), `${record.name} code`),
      dualRead(endpoints, (client) => client.getBlock({ blockNumber: BigInt(record.deploymentBlock) }),
        `${record.name} deployment block`),
    ]);
    const liveCode = codeBytes(code, `${record.name} live code`);
    const maskedLive = maskRuntime(liveCode, item.immutableReferences, `${record.name} live code`);
    const confirmationsObserved = minimumHead - BigInt(record.deploymentBlock) + 1n;
    if (hash(transaction.hash, `${record.name} live transaction`) !== record.transactionHash
      || address(transaction.from, `${record.name} live from`) !== record.deployer
      || transaction.to !== null || uint(transaction.value, "live value") !== 0n
      || uint(transaction.chainId, "live chain") !== BigInt(CHAIN_ID)
      || uint(transaction.nonce, "live nonce") !== record.nonce
      || normalizeHex(transaction.input, "live initcode") !== record.initcode.toLowerCase()
      || !successfulReceipt(receipt.status) || receipt.to !== null
      || address(receipt.contractAddress, "live receipt contract") !== record.address
      || Number(receipt.blockNumber) !== record.deploymentBlock
      || hash(receipt.blockHash, "live receipt block hash") !== record.deploymentBlockHash
      || Number(receipt.transactionIndex) !== record.transactionIndex
      || hash(deploymentBlock.hash, "deployment block hash") !== record.deploymentBlockHash
      || hash(deploymentBlock.transactions[record.transactionIndex], "deployment block transaction")
        !== record.transactionHash
      || liveCode.length !== item.deployed.length
      || keccak256(maskedLive) !== item.maskedDeployedBytecodeHash
      || confirmationsObserved < BigInt(confirmations)) {
      fail("LIVE_DEPLOYMENT_MISMATCH", `${record.name} live deployment differs from the release`);
    }
    evidence[record.name] = {
      deploymentTransaction: record.transactionHash,
      deploymentBlock: record.deploymentBlock,
      deploymentBlockHash: record.deploymentBlockHash,
      transactionIndex: record.transactionIndex,
      confirmationsObserved: Number(confirmationsObserved),
      runtimeBytecodeHash: keccak256(liveCode),
      compiledCreationBytecodeHash: item.creationBytecodeHash,
      compiledDeployedBytecodeTemplateHash: item.deployedBytecodeTemplateHash,
      compiledMaskedDeployedBytecodeHash: item.maskedDeployedBytecodeHash,
      rawMetadataSha256: item.rawMetadataSha256,
      sourceSetSha256: item.sourceSetSha256,
      compilerSettingsSha256: item.compilerSettingsSha256,
      abiSha256: item.abiSha256,
    };
  }
  const bindings = await verifyCriticalBindings(endpoints, pinnedNumber, addresses);
  const closing = await dualRead(endpoints, (client) => client.getBlock({ blockNumber: pinnedNumber }),
    "closing pinned block");
  if (closing.hash !== pinned.hash || closing.timestamp !== pinned.timestamp) {
    fail("REORG_DETECTED", "common pinned block changed while evidence was collected");
  }
  return {
    commonPinnedBlock: {
      number: Number(pinnedNumber),
      hash: hash(pinned.hash, "pinned block hash"),
      timestamp: Number(pinned.timestamp),
      confirmationsRequired: confirmations,
      observedHeads: heads.map(Number),
    },
    rpcOrigins: endpoints.map(({ origin, providerDomain }) => ({ origin, providerDomain })),
    evidence,
    bindings,
  };
}

async function defaultRunner(executable, args, options) {
  return execFileAsync(executable, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_FILE_BYTES,
  });
}

export async function verifyAutomationV2SourceProvenance({
  releaseGitCommit,
  foundryArtifactCommit,
  cwd = projectRoot,
  runProgram = defaultRunner,
}) {
  const release = commit(releaseGitCommit, "release commit");
  const foundry = commit(foundryArtifactCommit, "Foundry commit", { foundry: true });
  const run = async (program, args, label) => {
    try { return await runProgram(program, args, { cwd }); } catch {
      fail("SOURCE_PROVENANCE_FAILED", `${label} failed closed`);
    }
  };
  const inspect = async () => {
    const [head, resolvedArtifact, status] = await Promise.all([
      run("git", ["rev-parse", "--verify", "HEAD^{commit}"], "HEAD resolution"),
      run("git", ["rev-parse", "--verify", `${foundry}^{commit}`], "artifact commit resolution"),
      run("git", ["status", "--porcelain=v1", "--untracked-files=all", "--",
        ...COMPILER_INPUT_PATHS], "compiler input status"),
    ]);
    const headCommit = commit(head.stdout.trim(), "resolved HEAD");
    const artifactResolvedCommit = commit(resolvedArtifact.stdout.trim(), "resolved artifact commit");
    if (headCommit !== release || artifactResolvedCommit !== release
      || status.stdout.trim() !== "") fail("DIRTY_RELEASE", "release source is not the exact clean commit");
    return { headCommit, artifactResolvedCommit };
  };
  await inspect();
  await run("forge", ["build", "--offline", "--force"], "offline release build");
  const resolved = await inspect();
  return {
    releaseGitCommit: release,
    headCommit: resolved.headCommit,
    artifactResolvedCommit: resolved.artifactResolvedCommit,
    foundryArtifactCommit: foundry,
    compilerInputsClean: true,
    offlineBuildCompleted: true,
    offlineBuildCommand: ["forge", "build", "--offline", "--force"],
  };
}

export async function buildAutomatedSeaDropV2DeploymentManifestProposal(input) {
  plain(input, "input");
  const releaseCommit = commit(input.releaseGitCommit, "release commit");
  const confirmations = input.confirmations ?? MIN_CONFIRMATIONS;
  if (!Number.isInteger(confirmations) || confirmations < MIN_CONFIRMATIONS
    || confirmations > MAX_CONFIRMATIONS) fail("INVALID_CONFIRMATIONS", "confirmations must be 20..256");
  const compiled = Object.fromEntries(AUTOMATION_V2_DEPLOYMENT_ORDER.map((name) => [
    name, normalizeCompiled(name, own(input.compiledArtifacts, name, "compiledArtifacts")),
  ]));
  const broadcast = parseBroadcast(input.broadcastArtifact, compiled, releaseCommit);
  const provenance = snapshot(input.sourceProvenance, 100_000, "source provenance");
  if (provenance.releaseGitCommit !== releaseCommit
    || provenance.foundryArtifactCommit !== broadcast.foundryCommit
    || provenance.compilerInputsClean !== true || provenance.offlineBuildCompleted !== true) {
    fail("SOURCE_PROVENANCE_MISMATCH", "source provenance differs from the release");
  }
  const live = await verifyLive(
    broadcast.records,
    compiled,
    input.readEndpoints,
    confirmations,
  );
  const contracts = Object.fromEntries(broadcast.records.map((record) => [record.name, {
    address: record.address,
    deploymentTransaction: record.transactionHash,
    deploymentBlock: record.deploymentBlock,
    deploymentBlockHash: record.deploymentBlockHash,
    receiptStatus: "SUCCESS",
    confirmationsRequired: confirmations,
    confirmationsObserved: live.evidence[record.name].confirmationsObserved,
    deployer: record.deployer,
    constructorArguments: record.constructorArguments,
    creationBytecodeHash: compiled[record.name].creationBytecodeHash,
    runtimeBytecodeHash: live.evidence[record.name].runtimeBytecodeHash,
    gitCommit: releaseCommit,
    verificationStatus: "NOT_SUBMITTED",
  }]));
  const manifest = {
    schema: "GOGH_AUTOMATED_SEADROP_V2_DEPLOYMENT_MANIFEST",
    version: 1,
    status: "DEPLOYED",
    chainId: CHAIN_ID,
    gitCommit: releaseCommit,
    compiler: "0.8.34",
    evmVersion: "cancun",
    optimizerRuns: 500,
    sourceVerificationAdoption: null,
    protocolGuardian: getAddress(GUARDIAN),
    contracts,
    reusedContracts: {
      ArtAdapterRegistry: getAddress(ADAPTER_REGISTRY),
      ArtAgentRegistry: getAddress(AGENT_REGISTRY),
    },
    infrastructure: {
      seaDrop: getAddress(SEA_DROP),
      seaDropRuntimeCodeHash: SEA_DROP_HASH,
      cloneImplementation: getAddress(CLONE_IMPLEMENTATION),
      cloneImplementationRuntimeCodeHash: CLONE_IMPLEMENTATION_HASH,
      collectionRuntimeCodeHash: COLLECTION_RUNTIME_HASH,
    },
    configuration: {
      adapterRegistered: false,
      featureFlagsEnabled: false,
      globalAgentApproved: false,
      workerEnabled: false,
    },
    authorization: {
      deploymentAuthorized: true,
      configurationAuthorized: false,
      agentAuthorizationGranted: false,
      automaticSubmissionEnabled: false,
    },
    notes: "Immutable V2 deployment proposal from a clean release build and exact four-CREATE broadcast. Two distinct RPC provider domains agreed on final receipts, transaction inclusion, runtime code, and critical immutable/module bindings at one common confirmed block. Source verification remains NOT_SUBMITTED. No adapter registration, feature enablement, account activation, agent authorization, worker enablement, or mint is authorized by this proposal.",
  };
  return {
    schema: "GOGH_AUTOMATED_SEADROP_V2_DEPLOYMENT_MANIFEST_PROPOSAL_V1",
    proposalStatus: "AUTOMATION_V2_MANIFEST_PROPOSAL_SOURCE_VERIFICATION_PENDING",
    trustBindings: {
      chainId: CHAIN_ID,
      releaseGitCommit: releaseCommit,
      foundryArtifactCommit: broadcast.foundryCommit,
      sourceProvenance: provenance,
      deploymentOrder: AUTOMATION_V2_DEPLOYMENT_ORDER,
      commonConfirmedBlock: live.commonPinnedBlock,
      rpcOrigins: live.rpcOrigins,
      providerIndependence: "UNVERIFIED_BEYOND_DISTINCT_REGISTRABLE_PROVIDER_DOMAINS",
      contractEvidence: live.evidence,
      immutableBindings: live.bindings,
      blockscoutSourceVerification: "NOT_SUBMITTED",
      transactionCapability: "NONE_READ_ONLY_PROPOSAL",
    },
    manifest,
  };
}

export function renderAutomatedSeaDropV2DeploymentManifestProposal(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function readBoundedJsonFile(path, maximum = MAX_FILE_BYTES, label = "JSON") {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > BigInt(maximum)) {
      fail("INVALID_FILE", `${label} is not a bounded nonempty regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || before.size !== BigInt(bytes.length)) fail("FILE_CHANGED", `${label} changed during read`);
    try { return snapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      maximum, label); } catch (error) {
      if (error instanceof AutomationV2ManifestError) throw error;
      fail("INVALID_JSON", `${label} is not valid UTF-8 JSON`);
    }
  } catch (error) {
    if (error instanceof AutomationV2ManifestError) throw error;
    fail("FILE_READ_FAILED", `${label} could not be read`);
  } finally { await handle?.close().catch(() => {}); }
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--artifact", "--git-commit", "--confirmations"].includes(flag)
      || typeof value !== "string" || !value || value.startsWith("--")
      || Object.hasOwn(parsed, flag)) fail("INVALID_ARGUMENTS", "invalid V2 manifest arguments");
    parsed[flag] = value;
  }
  for (const flag of ["--artifact", "--git-commit"]) {
    if (!Object.hasOwn(parsed, flag)) fail("INVALID_ARGUMENTS", `${flag} is required`);
  }
  return parsed;
}

function assertBroadcastPath(path) {
  const resolved = resolve(path);
  const within = relative(broadcastRoot, resolved);
  if (within.startsWith(`..${sep}`) || within === ".." || within.includes(sep)
    || !/^run-(?:latest|\d+)\.json$/.test(basename(resolved))) {
    fail("INVALID_ARTIFACT_PATH", "broadcast artifact must be the fixed V2 chain-4663 run file");
  }
  return resolved;
}

async function loadCompiledArtifacts() {
  return Object.fromEntries(await Promise.all(AUTOMATION_V2_DEPLOYMENT_ORDER.map(async (name) => [
    name,
    await readBoundedJsonFile(resolve(projectRoot, ARTIFACT_PATHS[name]), MAX_FILE_BYTES,
      `${name} compiled artifact`),
  ])));
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const artifactPath = assertBroadcastPath(args["--artifact"]);
  const broadcastArtifact = await readBoundedJsonFile(artifactPath, MAX_FILE_BYTES,
    "V2 broadcast artifact");
  const releaseGitCommit = commit(args["--git-commit"], "release commit");
  const foundryArtifactCommit = commit(broadcastArtifact.commit, "Foundry artifact commit",
    { foundry: true });
  const sourceProvenance = await verifyAutomationV2SourceProvenance({
    releaseGitCommit,
    foundryArtifactCommit,
  });
  const compiledArtifacts = await loadCompiledArtifacts();
  const primary = process.env.ROBINHOOD_RPC_URL;
  const secondary = process.env.ROBINHOOD_SECONDARY_RPC_URL;
  if (!primary || !secondary) fail("MISSING_RPC", "both Robinhood RPC URLs are required");
  const endpoints = [primary, secondary].map((url) => ({
    origin: new URL(url).origin,
    client: createPublicClient({ transport: http(url) }),
  }));
  const proposal = await buildAutomatedSeaDropV2DeploymentManifestProposal({
    releaseGitCommit,
    confirmations: args["--confirmations"] ? Number(args["--confirmations"]) : MIN_CONFIRMATIONS,
    broadcastArtifact,
    compiledArtifacts,
    sourceProvenance,
    readEndpoints: endpoints,
  });
  process.stdout.write(renderAutomatedSeaDropV2DeploymentManifestProposal(proposal));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof AutomationV2ManifestError
      ? error.message : "AUTOMATION_V2_MANIFEST_FAILED: unexpected read-only failure"}\n`);
    process.exitCode = 1;
  });
}
