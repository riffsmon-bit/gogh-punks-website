import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanaryConfigurationReceiptEvidence,
} from "../broker/src/recommendation/canary-configuration-receipt-evidence.mjs";
import { buildOwnerDirectCanaryConfigBundle } from "./build-owner-direct-canary-config-bundle.mjs";

const MAX_INPUT_BYTES = 2_000_000;
const projectRoot = resolve(import.meta.dirname, "..");
const CORE_MANIFEST_PATH = resolve(projectRoot, "deployments/robinhood.json");
const CANARY_MANIFEST_PATH = resolve(projectRoot, "deployments/robinhood-canary.json");

function fail(message) {
  throw new Error(`Configuration evidence builder: ${message}`);
}

function exactPath(value, flag) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096
    || value.trim() !== value || value.includes("\0") || /[*?\[\]{}]/.test(value)
    || !basename(value).toLowerCase().endsWith(".json")) {
    fail(`${flag} must be one exact JSON file path`);
  }
  return resolve(value);
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) {
    fail("requires --config-bundle <json> --transactions <json>");
  }
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!["--config-bundle", "--transactions"].includes(flag) || Object.hasOwn(values, flag)) {
      fail("only one --config-bundle and one --transactions are accepted");
    }
    values[flag] = exactPath(argv[index + 1], flag);
  }
  if (!values["--config-bundle"] || !values["--transactions"]) {
    fail("both required artifact paths must be supplied");
  }
  return values;
}

async function readJson(path, label) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_INPUT_BYTES) {
      fail(`${label} must be a bounded nonempty regular file`);
    }
    return JSON.parse(await handle.readFile({ encoding: "utf8" }));
  } catch (error) {
    if (error?.message?.startsWith("Configuration evidence builder:")) throw error;
    fail(`${label} could not be read as exact JSON`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} fields do not match the canonical schema`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function buildReceiptEvidenceFromFiles(argv) {
  const args = parseArguments(argv);
  const [bundle, transactionInput, coreManifest, canaryManifest] = await Promise.all([
    readJson(args["--config-bundle"], "configuration bundle"),
    readJson(args["--transactions"], "transaction index"),
    readJson(CORE_MANIFEST_PATH, "authoritative core manifest"),
    readJson(CANARY_MANIFEST_PATH, "authoritative canary manifest"),
  ]);
  exactKeys(bundle, ["hashAlgorithm", "bundleHash", "review", "transactionAuthorized"],
    "configuration bundle");
  if (bundle.hashAlgorithm !== "KECCAK256_CANONICAL_JSON_V1"
    || bundle.transactionAuthorized !== false
    || typeof bundle.bundleHash !== "string") {
    fail("configuration bundle is not the canonical non-authorizing review artifact");
  }
  const expectedBundle = buildOwnerDirectCanaryConfigBundle(coreManifest, canaryManifest);
  if (canonicalJson(bundle) !== canonicalJson(expectedBundle)) {
    fail("configuration bundle is not rebuilt exactly from the authoritative manifests");
  }
  exactKeys(transactionInput, ["transactions"], "transaction index");
  const clean = canaryManifest?.provenanceGate?.cleanPreconfigurationState;
  if (!clean) fail("authoritative canary manifest lacks clean preconfiguration evidence");
  const artifact = buildCanaryConfigurationReceiptEvidence({
    configBundleHash: bundle.bundleHash,
    preconfigurationBlock: {
      number: clean.blockNumber,
      hash: clean.blockHash,
      timestamp: clean.blockTimestamp,
    },
    transactions: transactionInput.transactions,
  });
  const planned = bundle.review?.configurationPlan?.orderedCalls;
  if (!Array.isArray(planned) || planned.length !== artifact.evidence.transactions.length) {
    fail("configuration bundle does not contain the matching exact call plan");
  }
  for (let index = 0; index < planned.length; index += 1) {
    if (planned[index]?.id !== artifact.evidence.transactions[index].id
      || planned[index]?.order !== artifact.evidence.transactions[index].order) {
      fail(`transaction ${index + 1} id/order does not match the configuration bundle`);
    }
  }
  return artifact;
}

async function main() {
  try {
    const artifact = await buildReceiptEvidenceFromFiles(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message ?? "Configuration evidence builder failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
