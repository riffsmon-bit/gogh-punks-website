#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, http } from "viem";
import { ROBINHOOD } from "../broker/src/config.mjs";
import {
  attestCanaryMintReceipt,
  CANARY_MINT_RECEIPT_ATTESTATION_SCHEMA,
  CANARY_MINT_RECEIPT_PASS,
  CanaryMintReceiptAttestationError,
  DEFAULT_CANARY_MINT_CONFIRMATIONS,
} from "./canary-mint-receipt-attestation.mjs";
import { CanaryMintRpcError } from "./canary-mint-rpc-helper.mjs";

const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_ARTIFACT_BYTES = 8_000_000;
const projectRoot = resolve(import.meta.dirname, "..");
export const AUTHORITATIVE_CORE_MANIFEST = resolve(projectRoot, "deployments/robinhood.json");
export const AUTHORITATIVE_CANARY_MANIFEST = resolve(
  projectRoot,
  "deployments/robinhood-canary.json",
);

const INPUT_FLAGS = Object.freeze({
  "--proposal": "proposalArtifact",
  "--live-attestation": "liveAttestation",
  "--config-bundle": "configBundleArtifact",
  "--configuration-evidence": "configurationEvidenceArtifact",
  "--execution-artifact": "executionArtifact",
  "--execution-receipt-evidence": "executionReceiptEvidence",
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

export class CanaryMintReceiptRunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanaryMintReceiptRunnerError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryMintReceiptRunnerError(code, message);
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

export function parseCanaryMintReceiptArguments(argv) {
  if (!Array.isArray(argv) || argv.length % 2 !== 0) {
    fail("INVALID_ARGUMENTS", "mint receipt arguments must be flag/value pairs");
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (![...Object.keys(INPUT_FLAGS), "--confirmations"].includes(flag)
      || Object.hasOwn(parsed, flag) || typeof value !== "string" || value.startsWith("--")) {
      fail("INVALID_ARGUMENTS", "mint receipt arguments contain an unknown, duplicate, or empty flag");
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
    confirmations: confirmations(parsed["--confirmations"] ?? DEFAULT_CANARY_MINT_CONFIRMATIONS),
  });
}

export async function readStableCanaryMintJson(path, maximumBytes, label, openFile = open) {
  let handle;
  try {
    handle = await openFile(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
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
    if (error instanceof CanaryMintReceiptRunnerError) throw error;
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
    fetchOptions = { headers: { Authorization: `Basic ${Buffer.from(credentials).toString("base64")}` } };
  }
  return Object.freeze({ href: url.href, origin: url.origin, fetchOptions });
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

function assertReadOnlyResult(result, expectedConfirmations) {
  if (!result || typeof result !== "object" || Array.isArray(result)
    || result.schema !== CANARY_MINT_RECEIPT_ATTESTATION_SCHEMA
    || result.status !== CANARY_MINT_RECEIPT_PASS
    || result.chainId !== ROBINHOOD.chainId
    || result.confirmedPin?.confirmations !== expectedConfirmations
    || result.receipt?.status !== "success" || result.receipt?.logCount !== 4
    || result.safetyBoundary?.readOnly !== true
    || result.safetyBoundary?.transactionAuthorized !== false
    || result.safetyBoundary?.signingPerformed !== false
    || result.safetyBoundary?.submissionPerformed !== false
    || result.safetyBoundary?.chainWritePerformed !== false
    || result.safetyBoundary?.deploymentPerformed !== false
    || result.safetyBoundary?.walletMethodsPresent !== false) {
    fail("INVALID_ATTESTATION_RESULT", "attestor did not return the exact read-only pass boundary");
  }
  const exact = (value, keys, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
      fail("INVALID_ATTESTATION_RESULT", `${label} fields do not match the canonical schema`);
    }
  };
  exact(result, [
    "schema", "status", "chainId", "evidenceHashes", "transaction", "receipt",
    "confirmedPin", "events", "preMintState", "postMintState", "confirmedState",
    "continuity", "sourceVerification", "safetyBoundary",
  ], "attestation result");
  exact(result.safetyBoundary, [
    "readOnly", "transactionAuthorized", "signingPerformed", "submissionPerformed",
    "chainWritePerformed", "deploymentPerformed", "walletMethodsPresent",
  ], "attestation result safety boundary");
  exact(result.receipt, [
    "status", "blockNumber", "blockHash", "blockTimestamp", "parentBlockHash",
    "transactionIndex", "logCount", "firstLogIndex", "lastLogIndex",
  ], "attestation result receipt");
  for (const name of [
    "executionReceiptEvidenceSha256", "executionReceiptEvidenceArtifactSha256",
    "executionArtifactSha256", "coreManifestSha256", "canaryManifestSha256",
  ]) {
    if (!/^0x(?!0{64}$)[0-9a-f]{64}$/.test(result.evidenceHashes?.[name] ?? "")) {
      fail("INVALID_ATTESTATION_RESULT", `${name} is not a canonical nonzero hash`);
    }
  }
  return result;
}

export async function runCanaryMintReceiptAttestation(argv, dependencies = {}) {
  const allowed = new Set(["attestor", "clientFactory", "clock", "environment", "readJson"]);
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)
    || Reflect.ownKeys(dependencies).some((key) => typeof key !== "string" || !allowed.has(key))) {
    fail("INVALID_DEPENDENCIES", "runner dependencies contain an unknown field");
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(dependencies))) {
    fail("INVALID_DEPENDENCIES", "runner dependencies must have a plain prototype");
  }
  for (const key of Reflect.ownKeys(dependencies)) {
    const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
    if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, "value")) {
      fail("INVALID_DEPENDENCIES", `runner dependency ${String(key)} must be an own data field`);
    }
  }
  const args = parseCanaryMintReceiptArguments(argv);
  const clock = dependencies.clock ?? (() => Math.floor(Date.now() / 1_000));
  if (typeof clock !== "function") fail("INVALID_TIME", "runner clock must be a function");
  const environment = dependencies.environment ?? process.env;
  const primary = endpoint(environment.ROBINHOOD_RPC_URL, "ROBINHOOD_RPC_URL");
  const secondary = endpoint(
    environment.ROBINHOOD_SECONDARY_RPC_URL,
    "ROBINHOOD_SECONDARY_RPC_URL",
  );
  if (primary.origin === secondary.origin) {
    fail("DUPLICATE_RPC", "RPC endpoints must use different origins");
  }
  const readJson = dependencies.readJson ?? readStableCanaryMintJson;
  const entries = await Promise.all([
    readJson(AUTHORITATIVE_CORE_MANIFEST, MAX_MANIFEST_BYTES, "authoritative core manifest"),
    readJson(AUTHORITATIVE_CANARY_MANIFEST, MAX_MANIFEST_BYTES, "authoritative canary manifest"),
    ...Object.entries(args.paths).map(async ([name, path]) => [name,
      await readJson(path, MAX_ARTIFACT_BYTES, name)]),
  ]);
  const [coreManifest, canaryManifest, ...artifactPairs] = entries;
  const artifacts = Object.fromEntries(artifactPairs);
  const factory = dependencies.clientFactory ?? defaultFactory;
  const clients = {
    primaryClient: readOnlyClient(primary, factory),
    secondaryClient: readOnlyClient(secondary, factory),
    endpointOrigins: [primary.origin, secondary.origin],
  };
  const attestor = dependencies.attestor ?? attestCanaryMintReceipt;
  const result = await attestor({ ...artifacts, coreManifest, canaryManifest }, clients, {
    confirmations: args.confirmations,
  }, clock);
  return assertReadOnlyResult(result, args.confirmations);
}

export function sanitizedCanaryMintReceiptFailure(error) {
  const known = error instanceof CanaryMintReceiptRunnerError
    || error instanceof CanaryMintReceiptAttestationError
    || error instanceof CanaryMintRpcError;
  const code = known ? error.code : "CANARY_MINT_RECEIPT_FAILED";
  const message = known ? error.message : "canary mint receipt attestation failed closed";
  return `${code}: ${message.slice(0, 500)}`;
}

export async function main(argv = process.argv.slice(2)) {
  const result = await runCanaryMintReceiptAttestation(argv);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${sanitizedCanaryMintReceiptFailure(error)}\n`);
    process.exitCode = 1;
  });
}
