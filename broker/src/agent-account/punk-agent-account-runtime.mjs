import {
  decodeEventLog, getAddress, isAddress, keccak256, parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ENTRY_POINT_V08 } from "./punk-agent-account-setup.mjs";
import { createPunkAgentDirectRelay, DIRECT_RELAY_ENTRY_POINT_ABI } from "./punk-agent-direct-relay.mjs";
import {
  normalizePunkAgentAccountDeployment,
  punkAgentAccountReadiness,
} from "./punk-agent-account-manifest.mjs";

const EMPTY_CODE = "0x";
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const UINT256_MAX = (2n ** 256n) - 1n;
const SESSION_COMPONENTS = Object.freeze([
  { name: "sessionKey", type: "address" },
  { name: "authorizingOwner", type: "address" },
  { name: "adapter", type: "address" },
  { name: "venue", type: "address" },
  { name: "adapterCodeHash", type: "bytes32" },
  { name: "targetCollection", type: "address" },
  { name: "validAfter", type: "uint48" },
  { name: "validUntil", type: "uint48" },
  { name: "maxMintsPerDay", type: "uint32" },
  { name: "remainingMints", type: "uint32" },
  { name: "mintsToday", type: "uint32" },
  { name: "day", type: "uint32" },
  { name: "generation", type: "uint64" },
  { name: "maxGasCostWei", type: "uint256" },
  { name: "minimumNativeReserveWei", type: "uint256" },
]);

export const PUNK_AGENT_RUNTIME_ABI = Object.freeze([
  ...parseAbi([
    "function owner() view returns (address)",
    "function entryPoint() view returns (address)",
    "function adapterRegistry() view returns (address)",
    "function acquisitionNonce() view returns (uint256)",
    "function sessionGeneration() view returns (uint64)",
    "function entryPointDeposit() view returns (uint256)",
    "function isAutonomousSessionActive() view returns (bool)",
  ]),
  { type: "function", name: "autonomousSession", stateMutability: "view", inputs: [],
    outputs: [{ name: "session", type: "tuple", components: SESSION_COMPONENTS }] },
  { type: "event", name: "SessionAcquisitionExecuted", anonymous: false, inputs: [
    { name: "generation", type: "uint64", indexed: true },
    { name: "opportunityId", type: "bytes32", indexed: true },
    { name: "collection", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: false },
    { name: "nonce", type: "uint256", indexed: false },
    { name: "remainingMints", type: "uint32", indexed: false },
    { name: "state", type: "uint256", indexed: false },
  ] },
]);
export const PUNK_AGENT_REGISTRY_ABI = parseAbi([
  "function account(uint256 tokenId) view returns (address)",
]);
const ERC721_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function address(value, label, { zero = false } = {}) {
  const normalized = String(value ?? "").toLowerCase();
  if (!ADDRESS.test(normalized) || (!zero && /^0x0{40}$/.test(normalized))) {
    fail("INVALID_ADDRESS", `${label} is invalid`);
  }
  return normalized;
}

function hash(value, label) {
  const normalized = String(value ?? "").toLowerCase();
  if (!HASH.test(normalized)) fail("INVALID_HASH", `${label} is invalid`);
  return normalized;
}

function uint(value, label) {
  let output;
  try { output = typeof value === "bigint" ? value : BigInt(value); } catch {
    fail("INVALID_INTEGER", `${label} is invalid`);
  }
  if (output < 0n || output > UINT256_MAX) fail("INVALID_INTEGER", `${label} is invalid`);
  return output;
}

function normalizeSession(value) {
  if (!value || typeof value !== "object") fail("INVALID_SESSION", "session state is invalid");
  return Object.freeze({
    sessionKey: address(value.sessionKey, "session key", { zero: true }),
    authorizingOwner: address(value.authorizingOwner, "authorizing owner", { zero: true }),
    adapter: address(value.adapter, "session adapter", { zero: true }),
    venue: address(value.venue, "session venue", { zero: true }),
    adapterCodeHash: hash(value.adapterCodeHash, "session adapter code hash"),
    targetCollection: address(value.targetCollection, "target collection", { zero: true }),
    validAfter: uint(value.validAfter, "session valid-after"),
    validUntil: uint(value.validUntil, "session valid-until"),
    maxMintsPerDay: uint(value.maxMintsPerDay, "daily mint cap"),
    remainingMints: uint(value.remainingMints, "remaining mint cap"),
    mintsToday: uint(value.mintsToday, "today mint count"),
    day: uint(value.day, "session day"), generation: uint(value.generation, "generation"),
    maxGasCostWei: uint(value.maxGasCostWei, "maximum gas cost"),
    minimumNativeReserveWei: uint(value.minimumNativeReserveWei, "minimum reserve"),
  });
}

export async function readPunkAgentAccountRuntime({
  client, deployment, tokenId, expectedOwner = null, expectedSessionKey = null,
}) {
  if (!client || typeof client.readContract !== "function" || typeof client.getCode !== "function"
    || typeof client.getBalance !== "function") {
    fail("INVALID_CLIENT", "Robinhood read client is unavailable");
  }
  const manifest = normalizePunkAgentAccountDeployment(deployment);
  const readiness = punkAgentAccountReadiness(manifest);
  if (manifest.status !== "DEPLOYED") {
    return Object.freeze({ deployment: readiness, account: null, accountCreated: false,
      session: null, sessionActive: false, blocker: "CONTRACTS_NOT_DEPLOYED" });
  }
  const registry = manifest.contracts.GoghPunkAgentAccountRegistry.address.toLowerCase();
  const implementation = manifest.contracts.GoghPunkAgentAccount.address.toLowerCase();
  const [chainId, implementationCode, registryCode, entryPointCode, adapterRegistryCode,
    adapterCode, venueCode, accountValue] = await Promise.all([
    client.getChainId(), client.getCode({ address: implementation }),
    client.getCode({ address: registry }), client.getCode({ address: manifest.entryPoint }),
    client.getCode({ address: manifest.reusedContracts.ArtAdapterRegistry }),
    client.getCode({ address: manifest.reusedContracts.AutomatedSeaDropStudioFreeMintAdapter }),
    client.getCode({ address: manifest.reusedContracts.SeaDrop }),
    client.readContract({ address: registry, abi: PUNK_AGENT_REGISTRY_ABI,
      functionName: "account", args: [uint(tokenId, "Punk token ID")] }),
  ]);
  if (Number(chainId) !== 4663) fail("WRONG_CHAIN", "read client is not on Robinhood Chain");
  const criticalCode = [implementationCode, registryCode, entryPointCode, adapterRegistryCode,
    adapterCode, venueCode];
  if (criticalCode.some((code) => typeof code !== "string" || code === EMPTY_CODE)) {
    fail("MISSING_RUNTIME", "Punk Agent Account infrastructure runtime is missing");
  }
  if (keccak256(implementationCode).toLowerCase()
      !== manifest.contracts.GoghPunkAgentAccount.runtimeBytecodeHash
    || keccak256(registryCode).toLowerCase()
      !== manifest.contracts.GoghPunkAgentAccountRegistry.runtimeBytecodeHash) {
    fail("RUNTIME_MISMATCH", "deployed Punk Agent Account runtime differs from the manifest");
  }
  const account = address(accountValue, "Punk Agent Account");
  const accountCode = await client.getCode({ address: account });
  if (!accountCode || accountCode === EMPTY_CODE) {
    return Object.freeze({ deployment: readiness, account, accountCreated: false,
      session: null, sessionActive: false, blocker: "ACCOUNT_NOT_ACTIVATED" });
  }
  const [ownerValue, entryPointValue, adapterRegistryValue, acquisitionNonce, sessionGeneration,
    entryPointDeposit, nativeBalance, sessionValue, activeValue] = await Promise.all([
    client.readContract({ address: account, abi: PUNK_AGENT_RUNTIME_ABI,
      functionName: "owner" }),
    client.readContract({ address: account, abi: PUNK_AGENT_RUNTIME_ABI,
      functionName: "entryPoint" }),
    client.readContract({ address: account, abi: PUNK_AGENT_RUNTIME_ABI,
      functionName: "adapterRegistry" }),
    client.readContract({ address: account, abi: PUNK_AGENT_RUNTIME_ABI,
      functionName: "acquisitionNonce" }),
    client.readContract({ address: account, abi: PUNK_AGENT_RUNTIME_ABI,
      functionName: "sessionGeneration" }),
    client.readContract({ address: account, abi: PUNK_AGENT_RUNTIME_ABI,
      functionName: "entryPointDeposit" }),
    client.getBalance({ address: account }),
    client.readContract({ address: account, abi: PUNK_AGENT_RUNTIME_ABI,
      functionName: "autonomousSession" }),
    client.readContract({ address: account, abi: PUNK_AGENT_RUNTIME_ABI,
      functionName: "isAutonomousSessionActive" }),
  ]);
  const owner = address(ownerValue, "live Punk owner");
  if (address(entryPointValue, "account EntryPoint") !== ENTRY_POINT_V08
    || address(adapterRegistryValue, "account adapter registry")
      !== manifest.reusedContracts.ArtAdapterRegistry.toLowerCase()) {
    fail("IMMUTABLE_BINDING_MISMATCH", "Punk Agent Account immutable bindings differ");
  }
  if (expectedOwner && owner !== address(expectedOwner, "expected owner")) {
    fail("OWNER_CHANGED", "the current Punk owner changed");
  }
  const session = normalizeSession(sessionValue);
  if (expectedSessionKey
    && session.sessionKey !== address(expectedSessionKey, "expected session key")) {
    fail("SESSION_KEY_MISMATCH", "owner-approved session key differs from the worker key");
  }
  const sessionActive = activeValue === true;
  return Object.freeze({ deployment: readiness, account, accountCreated: true, owner,
    acquisitionNonce: uint(acquisitionNonce, "acquisition nonce"),
    sessionGeneration: uint(sessionGeneration, "session generation"),
    entryPointDeposit: uint(entryPointDeposit, "EntryPoint deposit"),
    nativeBalance: uint(nativeBalance, "native balance"), session,
    sessionActive, blocker: sessionActive ? null : "SESSION_INACTIVE" });
}

export function createPunkAgentSessionSigner(environment = process.env) {
  const privateKey = environment.PUNK_AGENT_SESSION_PRIVATE_KEY;
  if (typeof privateKey !== "string" || !PRIVATE_KEY.test(privateKey)) {
    fail("SESSION_SIGNER_NOT_CONFIGURED", "Punk Agent Account session signer is unavailable");
  }
  const signer = privateKeyToAccount(privateKey);
  const expected = environment.PUNK_AGENT_SESSION_ADDRESS;
  if (expected && signer.address.toLowerCase() !== address(expected, "session signer address")) {
    fail("SESSION_SIGNER_ADDRESS_MISMATCH", "session signer key does not match its public binding");
  }
  return signer;
}

export function createPunkAgentBundler({ url, fetchImpl = globalThis.fetch, timeoutMs = 12_000 }) {
  if (typeof fetchImpl !== "function" || !Number.isInteger(timeoutMs)
    || timeoutMs < 1_000 || timeoutMs > 30_000) {
    fail("INVALID_BUNDLER", "bundler transport configuration is invalid");
  }
  let endpoint;
  try { endpoint = new URL(url); } catch { fail("INVALID_BUNDLER", "bundler URL is invalid"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password
    || endpoint.hash || endpoint.href.length > 2_048) {
    fail("INVALID_BUNDLER", "bundler URL must be a clean HTTPS endpoint");
  }
  let id = 0;
  return Object.freeze({ endpointOrigin: endpoint.origin, async request({ method, params = [] }) {
    if (typeof method !== "string" || !/^eth_[A-Za-z0-9]{1,64}$/.test(method)
      || !Array.isArray(params)) fail("INVALID_BUNDLER_REQUEST", "bundler request is invalid");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const requestId = ++id;
    let response;
    try {
      response = await fetchImpl(endpoint, { method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({
          jsonrpc: "2.0", id: requestId, method, params,
        }) });
    } catch { fail("BUNDLER_UNAVAILABLE", "bundler request failed"); }
    finally { clearTimeout(timer); }
    if (!response?.ok) fail("BUNDLER_UNAVAILABLE", "bundler returned an HTTP error");
    let payload;
    try { payload = await response.json(); } catch {
      fail("BUNDLER_INVALID_RESPONSE", "bundler returned invalid JSON");
    }
    if (payload?.jsonrpc !== "2.0" || payload.id !== requestId || payload.error
      || !Object.hasOwn(payload ?? {}, "result")) {
      fail("BUNDLER_RPC_ERROR", "bundler rejected the request");
    }
    return payload.result;
  } });
}

export function createConfiguredPunkAgentBundler(environment = process.env) {
  const mode = environment.PUNK_AGENT_BUNDLER_MODE ?? "HTTPS";
  if (mode === "DIRECT_PRIVATE_RELAY") {
    return createPunkAgentDirectRelay({
      url: environment.PUNK_AGENT_DIRECT_RELAY_RPC_URL,
      privateKey: environment.PUNK_AGENT_SESSION_PRIVATE_KEY,
      expectedAddress: environment.PUNK_AGENT_SESSION_ADDRESS,
      receiptLookbackBlocks: environment.PUNK_AGENT_RECEIPT_LOOKBACK_BLOCKS ?? "120000",
      minimumBalanceWei: environment.PUNK_AGENT_DIRECT_RELAY_MIN_BALANCE_WEI
        ?? "200000000000000",
    });
  }
  if (mode !== "HTTPS") fail("INVALID_BUNDLER", "Punk Agent bundler mode is invalid");
  return createPunkAgentBundler({ url: environment.PUNK_AGENT_BUNDLER_RPC_URL });
}

export async function readPunkAgentBundlerReadiness({ bundler, entryPoint = ENTRY_POINT_V08 }) {
  if (!bundler || typeof bundler.request !== "function") {
    fail("INVALID_BUNDLER", "bundler transport is unavailable");
  }
  const [chainId, supported] = await Promise.all([
    bundler.request({ method: "eth_chainId" }),
    bundler.request({ method: "eth_supportedEntryPoints" }),
  ]);
  if (uint(chainId, "bundler chain ID") !== 4663n || !Array.isArray(supported)
    || !supported.some((item) => String(item).toLowerCase() === ENTRY_POINT_V08)) {
    fail("BUNDLER_BINDING_MISMATCH", "bundler does not support canonical Robinhood EntryPoint");
  }
  const funding = typeof bundler.fundingState === "function"
    ? await bundler.fundingState() : null;
  return Object.freeze({ ready: true, chainId: 4663, entryPoint: getAddress(entryPoint),
    mode: bundler.mode ?? "HTTPS", endpointOrigin: bundler.endpointOrigin ?? null,
    ...(funding ? { funding } : {}) });
}

export async function readPunkAgentUserOperationReceipt({ bundler, userOpHash }) {
  const value = await bundler.request({ method: "eth_getUserOperationReceipt",
    params: [hash(userOpHash, "UserOperation hash")] });
  if (value === null) return null;
  if (!value || typeof value !== "object") {
    fail("INVALID_USER_OPERATION_RECEIPT", "bundler receipt is invalid");
  }
  return value;
}

export async function verifyPunkAgentMintReceipt({
  client, receipt, userOpHash, account, opportunityId, collection, tokenId,
  sessionGeneration = null, acquisitionNonce = null,
}) {
  const expectedHash = hash(userOpHash, "UserOperation hash");
  const expectedAccount = address(account, "Punk Agent Account");
  const expectedOpportunity = hash(opportunityId, "opportunity ID");
  const expectedCollection = address(collection, "collection");
  const expectedTokenId = uint(tokenId, "minted token ID");
  if (!receipt || hash(receipt.userOpHash, "receipt UserOperation hash") !== expectedHash
    || address(receipt.sender, "receipt sender") !== expectedAccount
    || receipt.success !== true || !receipt.receipt || receipt.receipt.status !== "success"
    && receipt.receipt.status !== "0x1" && receipt.receipt.status !== 1
    && receipt.receipt.status !== 1n) {
    fail("USER_OPERATION_FAILED", "UserOperation did not confirm successfully");
  }
  // The bundler locates the transaction; chain RPC supplies authoritative evidence.
  const transactionHash = hash(receipt.receipt.transactionHash, "transaction hash");
  const chainReceipt = await client.getTransactionReceipt({ hash: transactionHash });
  if (!chainReceipt || chainReceipt.status !== "success"
    || hash(chainReceipt.transactionHash, "chain transaction hash") !== transactionHash
    || hash(chainReceipt.blockHash, "chain block hash") !== hash(receipt.receipt.blockHash, "bundler block hash")
    || uint(chainReceipt.blockNumber, "chain block number") !== uint(receipt.receipt.blockNumber, "bundler block number")) {
    fail("RECEIPT_CHAIN_MISMATCH", "bundler receipt differs from the chain receipt");
  }
  const block = await client.getBlock({ blockNumber: chainReceipt.blockNumber });
  if (!block || hash(block.hash, "canonical block hash") !== chainReceipt.blockHash.toLowerCase()) {
    fail("RECEIPT_CHAIN_MISMATCH", "receipt block is no longer canonical");
  }
  const operations = [];
  for (const log of chainReceipt.logs ?? []) {
    if (String(log.address ?? "").toLowerCase() !== ENTRY_POINT_V08 || log.removed) continue;
    try {
      const event = decodeEventLog({ abi: DIRECT_RELAY_ENTRY_POINT_ABI,
        data: log.data, topics: log.topics, strict: true });
      if (event.eventName === "UserOperationEvent"
        && String(event.args.userOpHash).toLowerCase() === expectedHash) operations.push(event.args);
    } catch { /* Ignore unrelated EntryPoint logs. */ }
  }
  if (operations.length !== 1 || operations[0].success !== true
    || String(operations[0].sender).toLowerCase() !== expectedAccount) {
    fail("USER_OPERATION_EVENT_MISMATCH", "chain receipt lacks the successful exact UserOperation");
  }
  const events = [];
  for (const log of chainReceipt.logs ?? []) {
    if (log.removed) continue;
    if (String(log.address ?? "").toLowerCase() !== expectedAccount) continue;
    try {
      const decoded = decodeEventLog({ abi: PUNK_AGENT_RUNTIME_ABI, data: log.data,
        topics: log.topics, strict: true });
      if (decoded.eventName === "SessionAcquisitionExecuted") {
        events.push({ args: decoded.args, logIndex: log.logIndex });
      }
    } catch { /* Ignore unrelated account logs. */ }
  }
  if (events.length !== 1
    || String(events[0].args.opportunityId).toLowerCase() !== expectedOpportunity
    || String(events[0].args.collection).toLowerCase() !== expectedCollection
    || uint(events[0].args.tokenId, "event token ID") !== expectedTokenId
    || sessionGeneration !== null && uint(events[0].args.generation, "event generation") !== uint(sessionGeneration, "expected generation")
    || acquisitionNonce !== null && uint(events[0].args.nonce, "event nonce") !== uint(acquisitionNonce, "expected nonce")) {
    fail("ACQUISITION_EVENT_MISMATCH", "receipt lacks the exact Punk acquisition event");
  }
  const liveOwner = address(await client.readContract({ address: expectedCollection,
    abi: ERC721_ABI, functionName: "ownerOf", args: [expectedTokenId] }), "NFT owner");
  if (liveOwner !== expectedAccount) {
    fail("NFT_POSTCONDITION_FAILED", "minted NFT is not held by the Punk Agent Account");
  }
  return Object.freeze({ confirmed: true, userOpHash: expectedHash,
    transactionHash,
    account: expectedAccount, collection: expectedCollection,
    tokenId: expectedTokenId.toString(), opportunityId: expectedOpportunity,
    generation: uint(events[0].args.generation, "session generation").toString(),
    acquisitionNonce: uint(events[0].args.nonce, "acquisition nonce").toString(),
    remainingMints: uint(events[0].args.remainingMints, "remaining mints").toString(),
    stateSequence: uint(events[0].args.state, "account state").toString(),
    logIndex: Number(uint(events[0].logIndex, "event log index")),
    blockNumber: uint(receipt.receipt.blockNumber, "receipt block number").toString(),
    blockHash: hash(receipt.receipt.blockHash, "receipt block hash"),
    actualGasCostWei: uint(operations[0].actualGasCost, "actual gas cost").toString(),
    actualGasUsed: uint(operations[0].actualGasUsed, "actual gas used").toString() });
}
