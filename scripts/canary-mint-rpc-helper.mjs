export const CANARY_MINT_MIN_CONFIRMATIONS = 12;
export const CANARY_MINT_MAX_CONFIRMATIONS = 128;
export const CANARY_MINT_MAX_HEAD_SKEW = 8n;

export class CanaryMintRpcError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanaryMintRpcError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryMintRpcError(code, message);
}

function providerDomain(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")) {
    return normalized;
  }
  const labels = normalized.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const compound = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz"]);
  const lastTwo = labels.slice(-2).join(".");
  return compound.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

function ownData(object, key, label) {
  if (!object || typeof object !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set || !Object.hasOwn(descriptor, "value")) {
    fail("ACCESSOR_REJECTED", `${label}.${key} must be an own data field`);
  }
  return descriptor.value;
}

function clientMethod(client, method, label) {
  const candidate = ownData(client, method, label);
  if (typeof candidate !== "function") {
    fail("INVALID_RPC_CLIENT", `${label} lacks ${method}`);
  }
  return candidate.bind(client);
}

function clientTransportOrigin(client, label) {
  const transport = ownData(client, "transport", label);
  if (!transport || typeof transport !== "object" || Array.isArray(transport)) {
    fail("RPC_PROVENANCE_MISSING", `${label} lacks an own transport object`);
  }
  const prototype = Object.getPrototypeOf(transport);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_RPC_CLIENT", `${label}.transport has a custom prototype`);
  }
  let raw = ownData(transport, "url", `${label}.transport`);
  if (raw === undefined) {
    const nested = ownData(transport, "value", `${label}.transport`);
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
      fail("RPC_PROVENANCE_MISSING", `${label} transport URL provenance is missing`);
    }
    const nestedPrototype = Object.getPrototypeOf(nested);
    if (nestedPrototype !== Object.prototype && nestedPrototype !== null) {
      fail("INVALID_RPC_CLIENT", `${label}.transport.value has a custom prototype`);
    }
    raw = ownData(nested, "url", `${label}.transport.value`);
  }
  let url;
  try { url = new URL(raw); } catch {
    fail("RPC_PROVENANCE_MISSING", `${label} transport URL provenance is invalid`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    fail("RPC_PROVENANCE_MISSING", `${label} transport URL must be HTTPS without userinfo or fragment`);
  }
  return url.origin;
}

function canonicalRpc(value, label, seen = new Set()) {
  if (value === undefined) return "u";
  if (value === null) return "n";
  if (typeof value === "string") return `s:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return value ? "b:1" : "b:0";
  if (typeof value === "bigint") return `i:${value}`;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_RPC_RESPONSE", `${label} has an unsafe number`);
    return `d:${value}`;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    fail("INVALID_RPC_RESPONSE", `${label} is not acyclic RPC data`);
  }
  seen.add(value);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) {
    fail("INVALID_RPC_RESPONSE", `${label} has a custom prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("INVALID_RPC_RESPONSE", `${label} has a symbol field`);
  }
  const dataKeys = array ? [...Array(value.length).keys()].map(String) : keys.sort();
  if (array && keys.some((key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key))) {
    fail("INVALID_RPC_RESPONSE", `${label} has an extended array`);
  }
  const encoded = [];
  for (const key of dataKeys) {
    if (!Object.hasOwn(value, key)) fail("INVALID_RPC_RESPONSE", `${label} has an array hole`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, "value")
      || !descriptor.enumerable) {
      fail("INVALID_RPC_RESPONSE", `${label}.${key} is not a data field`);
    }
    const child = canonicalRpc(descriptor.value, `${label}.${key}`, seen);
    encoded.push(array ? child : `${JSON.stringify(key)}=${child}`);
  }
  seen.delete(value);
  return `${array ? "a" : "o"}:[${encoded.join(",")}]`;
}

export function normalizeCanaryMintConfirmations(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < CANARY_MINT_MIN_CONFIRMATIONS
    || parsed > CANARY_MINT_MAX_CONFIRMATIONS) {
    fail("INVALID_CONFIRMATIONS", "confirmations must be an integer from 12 through 128");
  }
  return parsed;
}

export function validateCanaryMintRpcDependencies(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_DEPENDENCIES", "dual-RPC dependencies must be an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_DEPENDENCIES", "dual-RPC dependencies must have a plain prototype");
  }
  const allowed = ["primaryClient", "secondaryClient", "endpointOrigins"];
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) {
    fail("INVALID_DEPENDENCIES", "dual-RPC dependencies contain an unknown field");
  }
  for (const key of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, "value")
      || !descriptor.enumerable) {
      fail("INVALID_DEPENDENCIES", `dual-RPC dependencies.${key} must be a data field`);
    }
  }
  const { primaryClient, secondaryClient, endpointOrigins } = value;
  if (primaryClient === secondaryClient) fail("DUPLICATE_RPC", "RPC clients must be distinct");
  if (!Array.isArray(endpointOrigins) || endpointOrigins.length !== 2) {
    fail("INVALID_RPC_ORIGINS", "exactly two endpoint origins are required");
  }
  if (Object.getPrototypeOf(endpointOrigins) !== Array.prototype
    || Reflect.ownKeys(endpointOrigins).length !== 3
    || !Object.hasOwn(endpointOrigins, 0) || !Object.hasOwn(endpointOrigins, 1)) {
    fail("INVALID_RPC_ORIGINS", "endpoint origins must be a dense plain two-item array");
  }
  const urls = endpointOrigins.map((origin, index) => {
    let url;
    try { url = new URL(origin); } catch { fail("INVALID_RPC_ORIGINS", `RPC ${index + 1} origin is invalid`); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.pathname !== "/" || url.origin !== origin) {
      fail("INVALID_RPC_ORIGINS", `RPC ${index + 1} origin must be credential-free HTTPS`);
    }
    return url;
  });
  if (urls[0].origin === urls[1].origin
    || providerDomain(urls[0].hostname) === providerDomain(urls[1].hostname)) {
    fail("DUPLICATE_RPC", "RPC origins must use distinct registrable provider domains");
  }
  const required = [
    "getChainId", "getBlockNumber", "getBlock", "getTransaction", "getTransactionReceipt",
    "getCode", "getStorageAt", "getBalance", "getLogs", "readContract",
  ];
  const forbidden = new Set([
    "deployContract", "sendCalls", "sendRawTransaction", "sendTransaction", "signMessage",
    "signTransaction", "signTypedData", "writeContract",
  ]);
  for (const [index, client] of [primaryClient, secondaryClient].entries()) {
    if (!client || typeof client !== "object" || Array.isArray(client)) {
      fail("INVALID_RPC_CLIENT", `RPC ${index + 1} must be an object`);
    }
    const clientPrototype = Object.getPrototypeOf(client);
    if (clientPrototype !== Object.prototype && clientPrototype !== null) {
      fail("INVALID_RPC_CLIENT", `RPC ${index + 1} has a custom prototype`);
    }
    for (const key of Reflect.ownKeys(client)) {
      if (typeof key !== "string") fail("INVALID_RPC_CLIENT", `RPC ${index + 1} has a symbol field`);
      const descriptor = Object.getOwnPropertyDescriptor(client, key);
      if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, "value")) {
        fail("ACCESSOR_REJECTED", `RPC ${index + 1}.${key} must be an own data field`);
      }
      if (forbidden.has(key) && typeof descriptor.value === "function") {
        fail("WRITE_CAPABLE_RPC_CLIENT", `RPC ${index + 1}.${key} is forbidden in read-only evidence`);
      }
    }
    for (const method of required) clientMethod(client, method, `RPC ${index + 1}`);
    const actualOrigin = clientTransportOrigin(client, `RPC ${index + 1}`);
    if (actualOrigin !== urls[index].origin) {
      fail("RPC_PROVENANCE_MISMATCH",
        `RPC ${index + 1} declared origin differs from its transport URL`);
    }
  }
  return Object.freeze({ primaryClient, secondaryClient, origins: urls.map((url) => url.origin) });
}

export async function dualCanaryMintRead(clients, label, operation) {
  if (typeof operation !== "function") fail("INVALID_OPERATION", `${label} operation is invalid`);
  let values;
  try {
    values = await Promise.all([
      operation(clients.primaryClient, 0),
      operation(clients.secondaryClient, 1),
    ]);
  } catch (error) {
    if (error instanceof CanaryMintRpcError) throw error;
    fail("RPC_READ_FAILED", `${label} failed on at least one RPC`);
  }
  const primary = canonicalRpc(values[0], `${label} primary`);
  const secondary = canonicalRpc(values[1], `${label} secondary`);
  if (primary !== secondary) fail("RPC_DISAGREEMENT", `${label} differs across RPC providers`);
  return values[0];
}

function blockView(block, label) {
  if (typeof block?.number !== "bigint" || block.number < 0n
    || typeof block?.timestamp !== "bigint" || block.timestamp < 0n
    || typeof block?.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) {
    fail("INVALID_BLOCK", `${label} is malformed`);
  }
  return Object.freeze({
    number: block.number,
    hash: block.hash.toLowerCase(),
    timestamp: block.timestamp,
  });
}

export async function establishCanaryMintConfirmedPin(clients, confirmationValue) {
  const confirmations = normalizeCanaryMintConfirmations(confirmationValue);
  const chainIds = await Promise.all([
    clientMethod(clients.primaryClient, "getChainId", "primary RPC")(),
    clientMethod(clients.secondaryClient, "getChainId", "secondary RPC")(),
  ]).catch(() => fail("RPC_READ_FAILED", "chain ID read failed"));
  if (chainIds.some((chainId) => Number(chainId) !== 4663)) {
    fail("WRONG_CHAIN", "both RPC providers must report Robinhood chain 4663");
  }
  const heads = await Promise.all([
    clientMethod(clients.primaryClient, "getBlockNumber", "primary RPC")(),
    clientMethod(clients.secondaryClient, "getBlockNumber", "secondary RPC")(),
  ]).catch(() => fail("RPC_READ_FAILED", "chain head read failed"));
  if (heads.some((head) => typeof head !== "bigint" || head <= BigInt(confirmations))) {
    fail("UNCONFIRMED_CHAIN", "chain head is too shallow for the confirmation requirement");
  }
  const minimum = heads[0] < heads[1] ? heads[0] : heads[1];
  const maximum = heads[0] > heads[1] ? heads[0] : heads[1];
  if (maximum - minimum > CANARY_MINT_MAX_HEAD_SKEW) {
    fail("RPC_HEAD_SKEW", "RPC heads differ by more than eight blocks");
  }
  const number = minimum - BigInt(confirmations);
  const block = await dualCanaryMintRead(clients, "confirmed pin", (client) => (
    client.getBlock({ blockNumber: number, includeTransactions: false })
  ));
  const view = blockView(block, "confirmed pin");
  if (view.number !== number) fail("INVALID_BLOCK", "confirmed pin returned the wrong number");
  return Object.freeze({
    ...view,
    confirmations,
    primaryHead: heads[0],
    secondaryHead: heads[1],
    headSkew: maximum - minimum,
  });
}

export async function recheckCanaryMintBlock(clients, expected, label) {
  const block = await dualCanaryMintRead(clients, `${label} recheck`, (client) => (
    client.getBlock({ blockNumber: expected.number, includeTransactions: false })
  ));
  const view = blockView(block, `${label} recheck`);
  if (view.number !== expected.number || view.hash !== expected.hash
    || view.timestamp !== expected.timestamp) {
    fail("BLOCK_CHANGED", `${label} changed during attestation`);
  }
  return view;
}

export async function readCanaryMintBlock(clients, number, includeTransactions, label) {
  const block = await dualCanaryMintRead(clients, label, (client) => (
    client.getBlock({ blockNumber: number, includeTransactions })
  ));
  return { block, view: blockView(block, label) };
}

export function canonicalCanaryMintRpcValue(value, label) {
  return canonicalRpc(value, label);
}
