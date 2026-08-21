import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, defineChain, http } from "viem";
import {
  ACTIVATION_CHAIN_ID,
  DEFAULT_ACTIVATION_CONFIRMATIONS,
  attestPunkAccountActivationReceipt,
  buildPunkAccountActivationReview,
} from "./punk-account-activation.mjs";

export const ACTIVATION_MAX_MANIFEST_BYTES = 500_000;
export const ACTIVATION_MAX_REVIEW_BYTES = 1_000_000;
export const ACTIVATION_MANIFEST_PATH = resolve(
  import.meta.dirname,
  "../deployments/robinhood.json",
);

const robinhoodChain = defineChain({
  id: ACTIVATION_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.robinhoodchain.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export class PunkAccountActivationRunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PunkAccountActivationRunnerError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PunkAccountActivationRunnerError(code, message);
}

function ownDataValue(value, name, label, { optional = false } = {}) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    fail("INVALID_DEPENDENCY", `${label} must be an object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor) {
    if (optional) return undefined;
    fail("INVALID_DEPENDENCY", `${label}.${name} is required`);
  }
  if (descriptor.get || descriptor.set) {
    fail("ACCESSOR_REJECTED", `${label}.${name} must be a data field`);
  }
  return descriptor.value;
}

function dependencies(value, allowed) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_DEPENDENCY", "runner dependencies must be an object");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) {
    fail("INVALID_DEPENDENCY", "runner dependencies contain an unknown field");
  }
  return Object.fromEntries(keys.map((key) => [key, ownDataValue(value, key, "dependencies")]));
}

function nextArgument(argv, index, flag) {
  const value = argv[index + 1];
  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    fail("INVALID_ARGUMENT", `${flag} requires a value`);
  }
  return value;
}

function safeArgv(argv) {
  if (!Array.isArray(argv) || argv.length > 12) {
    fail("INVALID_ARGUMENT", "arguments must be a bounded array");
  }
  for (const [index, value] of argv.entries()) {
    if (typeof value !== "string" || value.length === 0 || value.length > 4_096
      || /[\u0000-\u001f\u007f]/.test(value)) {
      fail("INVALID_ARGUMENT", `argument ${index} is malformed`);
    }
  }
}

export function parseActivationReviewArguments(argv) {
  safeArgv(argv);
  const result = {
    tokenId: undefined,
    expectedOwner: undefined,
    confirmations: String(DEFAULT_ACTIVATION_CONFIRMATIONS),
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!["--token-id", "--expected-owner", "--confirmations"].includes(flag)) {
      fail("UNKNOWN_ARGUMENT", "unsupported argument; private keys and RPC URLs are never accepted");
    }
    if (seen.has(flag)) fail("DUPLICATE_ARGUMENT", `${flag} was supplied more than once`);
    seen.add(flag);
    result[flag === "--token-id" ? "tokenId"
      : flag === "--expected-owner" ? "expectedOwner" : "confirmations"] =
      nextArgument(argv, index, flag);
  }
  if (!result.tokenId || !result.expectedOwner) {
    fail("MISSING_ARGUMENT", "--token-id and --expected-owner are required");
  }
  return Object.freeze(result);
}

export function parseActivationReceiptArguments(argv) {
  safeArgv(argv);
  const result = {
    reviewPath: undefined,
    transactionHash: undefined,
    confirmations: String(DEFAULT_ACTIVATION_CONFIRMATIONS),
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!["--review", "--transaction-hash", "--confirmations"].includes(flag)) {
      fail("UNKNOWN_ARGUMENT", "unsupported argument; private keys and RPC URLs are never accepted");
    }
    if (seen.has(flag)) fail("DUPLICATE_ARGUMENT", `${flag} was supplied more than once`);
    seen.add(flag);
    result[flag === "--review" ? "reviewPath"
      : flag === "--transaction-hash" ? "transactionHash" : "confirmations"] =
      nextArgument(argv, index, flag);
  }
  if (!result.reviewPath || !result.transactionHash) {
    fail("MISSING_ARGUMENT", "--review and --transaction-hash are required");
  }
  return Object.freeze(result);
}

export async function readActivationJsonFile(path, maximumBytes, label) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4_096
    || !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    fail("INVALID_FILE", `${label} path or size bound is invalid`);
  }
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) fail("INVALID_FILE", `${label} must be a regular file`);
    if (before.size <= 0n || before.size > BigInt(maximumBytes)) {
      fail("FILE_SIZE", `${label} is empty or exceeds ${maximumBytes} bytes`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || BigInt(bytes.length) !== before.size) {
      fail("FILE_CHANGED", `${label} changed while it was read`);
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("INVALID_JSON", `${label} is not strict JSON`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof PunkAccountActivationRunnerError) throw error;
    fail("FILE_READ_FAILED", `${label} could not be opened as a non-symlink regular file`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function environmentValue(environment, name) {
  if (!environment || (typeof environment !== "object" && typeof environment !== "function")) {
    fail("INVALID_ENVIRONMENT", "environment is unavailable");
  }
  const descriptor = Object.getOwnPropertyDescriptor(environment, name);
  if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== "string"
    || descriptor.value.trim().length === 0) {
    fail("MISSING_RPC", `${name} must be set in the process environment`);
  }
  return descriptor.value.trim();
}

function providerDomain(hostname) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return hostname;
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const compoundSuffix = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz"]);
  const lastTwo = labels.slice(-2).join(".");
  return compoundSuffix.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

export function readActivationRpcEndpoints(environment) {
  const values = [
    environmentValue(environment, "ROBINHOOD_RPC_URL"),
    environmentValue(environment, "ROBINHOOD_SECONDARY_RPC_URL"),
  ];
  const urls = values.map((value) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      fail("INVALID_RPC", "an RPC endpoint is not a valid URL");
    }
    if (parsed.protocol !== "https:" || parsed.hash || !parsed.hostname) {
      fail("INVALID_RPC", "RPC endpoints must be HTTPS URLs without fragments");
    }
    return parsed;
  });
  if (urls[0].origin === urls[1].origin
    || providerDomain(urls[0].hostname) === providerDomain(urls[1].hostname)) {
    fail("RPC_ENDPOINTS_NOT_DISTINCT",
      "RPC endpoints must use distinct HTTPS provider domains");
  }
  return Object.freeze({
    urls: Object.freeze(values),
    origins: Object.freeze(urls.map((url) => url.origin)),
  });
}

function defaultClientFactory({ url }) {
  const endpoint = new URL(url);
  let fetchOptions;
  if (endpoint.username || endpoint.password) {
    const credentials = `${decodeURIComponent(endpoint.username)}:${decodeURIComponent(endpoint.password)}`;
    endpoint.username = "";
    endpoint.password = "";
    fetchOptions = {
      headers: { Authorization: `Basic ${Buffer.from(credentials).toString("base64")}` },
    };
  }
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(endpoint.href, fetchOptions ? { fetchOptions } : undefined),
  });
}

export async function runActivationReview(argv, dependencyValue = {}) {
  const deps = dependencies(dependencyValue, ["env", "readJson", "clientFactory", "attestor"]);
  const options = parseActivationReviewArguments(argv);
  const readJson = deps.readJson ?? ((path, maximum, label) => (
    readActivationJsonFile(path, maximum, label)
  ));
  const manifest = await readJson(
    ACTIVATION_MANIFEST_PATH,
    ACTIVATION_MAX_MANIFEST_BYTES,
    "authoritative core manifest",
  );
  if (ownDataValue(manifest, "status", "authoritative core manifest") !== "DEPLOYED") {
    fail("CORE_NOT_DEPLOYED", "authoritative core manifest status must be DEPLOYED");
  }
  const environment = deps.env ?? process.env;
  const endpoints = readActivationRpcEndpoints(environment);
  const factory = deps.clientFactory ?? defaultClientFactory;
  if (typeof factory !== "function") fail("INVALID_DEPENDENCY", "clientFactory must be a function");
  const primaryClient = factory({ url: endpoints.urls[0], role: "primary" });
  const secondaryClient = factory({ url: endpoints.urls[1], role: "secondary" });
  const attestor = deps.attestor ?? buildPunkAccountActivationReview;
  if (typeof attestor !== "function") fail("INVALID_DEPENDENCY", "attestor must be a function");
  return attestor({
    manifest,
    tokenId: options.tokenId,
    expectedOwner: options.expectedOwner,
    confirmations: options.confirmations,
  }, {
    primaryClient,
    secondaryClient,
    endpointOrigins: endpoints.origins,
  });
}

export async function runActivationReceiptAttestation(argv, dependencyValue = {}) {
  const deps = dependencies(dependencyValue, ["env", "readJson", "clientFactory", "attestor"]);
  const options = parseActivationReceiptArguments(argv);
  const readJson = deps.readJson ?? ((path, maximum, label) => (
    readActivationJsonFile(path, maximum, label)
  ));
  const [manifest, reviewArtifact] = await Promise.all([
    readJson(ACTIVATION_MANIFEST_PATH, ACTIVATION_MAX_MANIFEST_BYTES,
      "authoritative core manifest"),
    readJson(resolve(options.reviewPath), ACTIVATION_MAX_REVIEW_BYTES,
      "activation review artifact"),
  ]);
  if (ownDataValue(manifest, "status", "authoritative core manifest") !== "DEPLOYED") {
    fail("CORE_NOT_DEPLOYED", "authoritative core manifest status must be DEPLOYED");
  }
  const environment = deps.env ?? process.env;
  const endpoints = readActivationRpcEndpoints(environment);
  const factory = deps.clientFactory ?? defaultClientFactory;
  if (typeof factory !== "function") fail("INVALID_DEPENDENCY", "clientFactory must be a function");
  const primaryClient = factory({ url: endpoints.urls[0], role: "primary" });
  const secondaryClient = factory({ url: endpoints.urls[1], role: "secondary" });
  const attestor = deps.attestor ?? attestPunkAccountActivationReceipt;
  if (typeof attestor !== "function") fail("INVALID_DEPENDENCY", "attestor must be a function");
  return attestor({
    manifest,
    reviewArtifact,
    transactionHash: options.transactionHash,
    confirmations: options.confirmations,
  }, {
    primaryClient,
    secondaryClient,
    endpointOrigins: endpoints.origins,
  });
}

export function sanitizedActivationFailure(error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{2,64}$/.test(error.code)
    ? error.code
    : "ACTIVATION_PREFLIGHT_FAILED";
  const known = error instanceof PunkAccountActivationRunnerError
    || error?.name === "PunkAccountActivationError";
  const message = known && typeof error.message === "string"
    ? error.message.replace(/https:\/\/[^\s]+/gi, "[redacted RPC]").slice(0, 500)
    : "activation validation failed closed";
  return `${code}: ${message}`;
}
