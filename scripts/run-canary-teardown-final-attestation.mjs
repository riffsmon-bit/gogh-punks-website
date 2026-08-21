#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, http } from "viem";
import { ROBINHOOD } from "../broker/src/config.mjs";
import {
  bindCanaryTeardownArtifacts,
  CanaryTeardownArtifactBindingError,
} from "./canary-teardown-artifact-binding.mjs";
import {
  attestCanaryFinalTeardown,
  CANARY_FINAL_TEARDOWN_ATTESTATION_SCHEMA,
  CANARY_FINAL_TEARDOWN_PASS,
  CanaryTeardownFinalAttestationError,
  DEFAULT_CANARY_TEARDOWN_CONFIRMATIONS,
  validateCanaryFinalTeardownAttestationHash,
} from "./canary-teardown-final-attestation.mjs";
import {
  CanaryMintRpcError,
  validateCanaryMintRpcDependencies,
} from "./canary-mint-rpc-helper.mjs";

const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_ARTIFACT_BYTES = 32_000_000;
const projectRoot = resolve(import.meta.dirname, "..");
export const AUTHORITATIVE_TEARDOWN_CORE_MANIFEST = resolve(
  projectRoot,
  "deployments/robinhood.json",
);
export const AUTHORITATIVE_TEARDOWN_CANARY_MANIFEST = resolve(
  projectRoot,
  "deployments/robinhood-canary.json",
);

const INPUT_FLAGS = Object.freeze({
  "--proposal": "proposalArtifact",
  "--live-attestation": "liveAttestation",
  "--config-bundle": "configBundleArtifact",
  "--configuration-evidence": "configurationEvidenceArtifact",
  "--execution-artifact": "executionArtifact",
  "--execution-receipt-evidence": "executionReceiptEvidenceArtifact",
  "--mint-attestation": "mintReceiptAttestationArtifact",
  "--teardown-receipt-evidence": "teardownReceiptEvidenceArtifact",
});
const READ_METHODS = Object.freeze([
  "getChainId", "getBlockNumber", "getBlock", "getTransaction", "getTransactionReceipt",
  "getCode", "getStorageAt", "getBalance", "getLogs", "readContract",
]);

const robinhoodChain = defineChain({
  id: ROBINHOOD.chainId,
  name: ROBINHOOD.name,
  nativeCurrency: ROBINHOOD.nativeCurrency,
  rpcUrls: { default: { http: [ROBINHOOD.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: ROBINHOOD.explorerUrl } },
});

export class CanaryTeardownFinalRunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanaryTeardownFinalRunnerError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryTeardownFinalRunnerError(code, message);
}

function exactPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096
    || value.trim() !== value || value.includes("\0") || /[*?\[\]{}]/.test(value)
    || !basename(value).toLowerCase().endsWith(".json")) {
    fail("INVALID_PATH", `${label} must be one exact JSON file path`);
  }
  return resolve(value);
}

function confirmations(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 12 || parsed > 128) {
    fail("INVALID_CONFIRMATIONS", "confirmations must be an integer from 12 through 128");
  }
  return parsed;
}

export function parseCanaryTeardownFinalArguments(argv) {
  if (!Array.isArray(argv) || argv.length % 2 !== 0) {
    fail("INVALID_ARGUMENTS", "final teardown arguments must be flag/value pairs");
  }
  const parsed = {};
  const allowed = [...Object.keys(INPUT_FLAGS), "--confirmations"];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.includes(flag) || Object.hasOwn(parsed, flag)
      || typeof value !== "string" || value.startsWith("--")) {
      fail("INVALID_ARGUMENTS", "arguments contain an unknown, duplicate, or empty flag");
    }
    parsed[flag] = value;
  }
  for (const flag of Object.keys(INPUT_FLAGS)) {
    if (!Object.hasOwn(parsed, flag)) fail("INVALID_ARGUMENTS", `${flag} <json> is required`);
  }
  return Object.freeze({
    paths: Object.freeze(Object.fromEntries(Object.entries(INPUT_FLAGS).map(([flag, name]) => [
      name, exactPath(parsed[flag], flag),
    ]))),
    confirmations: confirmations(parsed["--confirmations"]
      ?? DEFAULT_CANARY_TEARDOWN_CONFIRMATIONS),
  });
}

export async function readStableCanaryTeardownJson(path, maximumBytes, label) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > BigInt(maximumBytes)) {
      fail("INVALID_FILE", `${label} must be a bounded nonempty regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || BigInt(bytes.length) !== before.size) {
      fail("FILE_CHANGED", `${label} changed while it was read`);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { fail("INVALID_JSON", `${label} is not strict UTF-8 JSON`); }
  } catch (error) {
    if (error instanceof CanaryTeardownFinalRunnerError) throw error;
    fail("FILE_READ_FAILED", `${label} could not be opened as one exact regular file`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function endpoint(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096
    || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("INVALID_RPC_ENDPOINT", `${label} must be a bounded HTTPS URL`);
  }
  let url;
  try { url = new URL(value); } catch { fail("INVALID_RPC_ENDPOINT", `${label} is invalid`); }
  if (url.protocol !== "https:" || url.hash || !url.hostname) {
    fail("INVALID_RPC_ENDPOINT", `${label} must be HTTPS without a fragment`);
  }
  let fetchOptions;
  if (url.username || url.password) {
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    url.username = "";
    url.password = "";
    fetchOptions = {
      headers: { Authorization: `Basic ${Buffer.from(credentials).toString("base64")}` },
    };
  }
  return Object.freeze({ href: url.href, origin: url.origin, fetchOptions });
}

function readOnlyClient(descriptor, factory) {
  const raw = factory(descriptor);
  if (!raw || typeof raw !== "object") fail("INVALID_RPC_CLIENT", "RPC client factory failed");
  const transportUrl = validatedTransportUrl(raw, descriptor);
  const facade = { transport: Object.freeze({ url: transportUrl }) };
  for (const method of READ_METHODS) {
    if (typeof raw[method] !== "function") fail("INVALID_RPC_CLIENT", `RPC client lacks ${method}`);
    facade[method] = raw[method].bind(raw);
  }
  return Object.freeze(facade);
}

function defaultFactory(descriptor) {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(descriptor.href, descriptor.fetchOptions
      ? { fetchOptions: descriptor.fetchOptions } : undefined),
  });
}

function ownTransportData(object, key, label) {
  const field = Object.getOwnPropertyDescriptor(object, key);
  if (!field || field.get || field.set || !Object.hasOwn(field, "value")) {
    fail("RPC_PROVENANCE_MISSING", `${label}.${key} must be an own data field`);
  }
  return field.value;
}

function validatedTransportUrl(raw, descriptor) {
  const transport = ownTransportData(raw, "transport", "RPC client");
  if (!transport || typeof transport !== "object" || Array.isArray(transport)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(transport))) {
    fail("RPC_PROVENANCE_MISSING", "RPC client transport must be a plain object");
  }
  let rawUrl = Object.hasOwn(transport, "url")
    ? ownTransportData(transport, "url", "RPC client transport") : undefined;
  if (rawUrl === undefined) {
    const value = ownTransportData(transport, "value", "RPC client transport");
    if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      fail("RPC_PROVENANCE_MISSING", "RPC transport value must be a plain object");
    }
    rawUrl = ownTransportData(value, "url", "RPC client transport value");
  }
  let parsed;
  try { parsed = new URL(rawUrl); } catch {
    fail("RPC_PROVENANCE_MISSING", "RPC client transport URL is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash
    || parsed.href !== descriptor.href || parsed.origin !== descriptor.origin) {
    fail("RPC_PROVENANCE_MISMATCH", "RPC client transport URL differs from its configured endpoint");
  }
  return parsed.href;
}

function assertResult(result, expectedConfirmations) {
  const validated = validateCanaryFinalTeardownAttestationHash(result);
  const expectedKeys = [
    "schema", "status", "readOnly", "transactionAuthorized", "signingPerformed",
    "submissionPerformed", "chainWritePerformed", "chainId", "evidenceHashes",
    "confirmedBlock", "latestFinalCheck", "punk", "acquisition", "teardownHistory",
    "finalState", "timing", "limitations", "attestationSha256",
  ].sort();
  const actualKeys = Object.keys(validated).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    fail("INVALID_ATTESTATION_RESULT", "attestor returned unknown or missing top-level fields");
  }
  if (validated.schema !== CANARY_FINAL_TEARDOWN_ATTESTATION_SCHEMA
    || validated.status !== CANARY_FINAL_TEARDOWN_PASS || validated.readOnly !== true
    || validated.transactionAuthorized !== false || validated.signingPerformed !== false
    || validated.submissionPerformed !== false || validated.chainWritePerformed !== false
    || validated.confirmedBlock?.confirmations !== expectedConfirmations
    || validated.teardownHistory?.transactionCount !== 11
    || validated.teardownHistory?.status
      !== "EXACT_11_ORDERED_TX_RECEIPTS_AND_TARGET_EVENTS_DUAL_RPC_VERIFIED") {
    fail("INVALID_ATTESTATION_RESULT", "attestor did not return the exact read-only pass boundary");
  }
  return validated;
}

export async function runCanaryTeardownFinalAttestation(argv, dependencies = {}) {
  const allowed = new Set(["attestor", "binder", "clientFactory", "environment", "readJson"]);
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(dependencies))
    || Reflect.ownKeys(dependencies).some((key) => typeof key !== "string" || !allowed.has(key))) {
    fail("INVALID_DEPENDENCIES", "runner dependencies contain an unknown field");
  }
  for (const key of Reflect.ownKeys(dependencies)) {
    const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
    if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, "value")
      || !descriptor.enumerable) {
      fail("INVALID_DEPENDENCIES", `runner dependencies.${key} must be enumerable data`);
    }
  }
  const args = parseCanaryTeardownFinalArguments(argv);
  const environment = dependencies.environment ?? process.env;
  const primary = endpoint(environment.ROBINHOOD_RPC_URL, "ROBINHOOD_RPC_URL");
  const secondary = endpoint(
    environment.ROBINHOOD_SECONDARY_RPC_URL,
    "ROBINHOOD_SECONDARY_RPC_URL",
  );
  if (primary.origin === secondary.origin) fail("DUPLICATE_RPC", "RPC origins must differ");
  const readJson = dependencies.readJson ?? readStableCanaryTeardownJson;
  const entries = await Promise.all([
    readJson(AUTHORITATIVE_TEARDOWN_CORE_MANIFEST, MAX_MANIFEST_BYTES,
      "authoritative core manifest"),
    readJson(AUTHORITATIVE_TEARDOWN_CANARY_MANIFEST, MAX_MANIFEST_BYTES,
      "authoritative canary manifest"),
    ...Object.entries(args.paths).map(async ([name, path]) => [name,
      await readJson(path, MAX_ARTIFACT_BYTES, name)]),
  ]);
  const [coreManifest, canaryManifest, ...artifactPairs] = entries;
  const artifacts = Object.fromEntries(artifactPairs);
  const binder = dependencies.binder ?? bindCanaryTeardownArtifacts;
  const teardownContext = binder({ ...artifacts, coreManifest, canaryManifest });
  const factory = dependencies.clientFactory ?? defaultFactory;
  const primaryClient = readOnlyClient(primary, factory);
  const secondaryClient = readOnlyClient(secondary, factory);
  validateCanaryMintRpcDependencies({
    primaryClient,
    secondaryClient,
    endpointOrigins: [primary.origin, secondary.origin],
  });
  const attestor = dependencies.attestor ?? attestCanaryFinalTeardown;
  const result = await attestor({
    teardownContext,
    primaryClient,
    secondaryClient,
    endpointOrigins: [primary.origin, secondary.origin],
    confirmations: args.confirmations,
  });
  return assertResult(result, args.confirmations);
}

export function sanitizedCanaryTeardownFinalFailure(error) {
  const known = error instanceof CanaryTeardownFinalRunnerError
    || error instanceof CanaryTeardownArtifactBindingError
    || error instanceof CanaryTeardownFinalAttestationError
    || error instanceof CanaryMintRpcError;
  const code = known ? error.code : "CANARY_FINAL_TEARDOWN_FAILED";
  const message = known ? error.message : "final teardown attestation failed closed";
  const redacted = String(message)
    .replace(/https?:\/\/[^\s)\]}]+/gi, "[redacted-rpc-url]")
    .replace(/(authorization|api[-_]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]");
  return `${code}: ${redacted.slice(0, 500)}`;
}

export async function main(argv = process.argv.slice(2)) {
  const result = await runCanaryTeardownFinalAttestation(argv);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${sanitizedCanaryTeardownFinalFailure(error)}\n`);
    process.exitCode = 1;
  });
}
