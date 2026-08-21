import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOwnerDirectFreeMintExecutionArtifact,
  OwnerDirectExecutionArtifactError,
} from "../broker/src/recommendation/owner-direct-free-mint-execution.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
export const AUTHORITATIVE_CORE_MANIFEST_PATH = resolve(projectRoot, "deployments/robinhood.json");
export const AUTHORITATIVE_CANARY_MANIFEST_PATH = resolve(
  projectRoot,
  "deployments/robinhood-canary.json",
);
export const MAX_OWNER_REVIEW_PROPOSAL_BYTES = 1_000_000;
export const MAX_LIVE_ATTESTATION_BYTES = 500_000;
export const MAX_EXECUTION_MANIFEST_BYTES = 500_000;
export const MAX_CONFIG_BUNDLE_BYTES = 2_000_000;
export const MAX_CONFIGURATION_EVIDENCE_BYTES = 250_000;

class OwnerDirectExecutionCliError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OwnerDirectExecutionCliError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new OwnerDirectExecutionCliError(code, message);
}

function exactDependencies(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_DEPENDENCIES", "dependencies must be a plain object");
  }
  const allowed = new Set(["cwd", "nowSeconds", "readJson"]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail("INVALID_DEPENDENCIES", `dependencies.${String(key)} is not allowed`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("INVALID_DEPENDENCIES", `dependencies.${key} must be plain data`);
    }
  }
}

function exactJsonPath(value, flag) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096
    || value.trim() !== value || value.includes("\0") || /[*?\[\]{}]/.test(value)
    || !basename(value).toLowerCase().endsWith(".json")) {
    fail("INVALID_ARGUMENTS", `${flag} must name one exact JSON file`);
  }
  return value;
}

export function parseOwnerDirectExecutionArguments(argv) {
  if (!Array.isArray(argv)) fail("INVALID_ARGUMENTS", "arguments must be an array");
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--proposal", "--attestation", "--config-bundle", "--configuration-evidence"].includes(flag)) {
      fail("INVALID_ARGUMENTS", "only proposal, attestation, config-bundle, and configuration-evidence are accepted");
    }
    if (value === undefined || typeof value !== "string" || value.startsWith("--")) {
      fail("INVALID_ARGUMENTS", `${flag} requires a value`);
    }
    if (Object.hasOwn(parsed, flag)) fail("INVALID_ARGUMENTS", `${flag} was supplied twice`);
    parsed[flag] = exactJsonPath(value, flag);
  }
  if (["--proposal", "--attestation", "--config-bundle", "--configuration-evidence"]
    .some((flag) => !Object.hasOwn(parsed, flag))) {
    fail("INVALID_ARGUMENTS", "proposal, attestation, config-bundle, and configuration-evidence are required");
  }
  const paths = ["--proposal", "--attestation", "--config-bundle", "--configuration-evidence"]
    .map((flag) => resolve(parsed[flag]));
  if (new Set(paths).size !== paths.length) {
    fail("INVALID_ARGUMENTS", "all four input artifacts must be separate files");
  }
  return Object.freeze({
    proposal: parsed["--proposal"],
    attestation: parsed["--attestation"],
    configBundle: parsed["--config-bundle"],
    configurationEvidence: parsed["--configuration-evidence"],
  });
}

export async function readBoundedExecutionJson(path, maximumBytes, label) {
  if (typeof path !== "string" || !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    fail("INVALID_FILE_READ", "bounded JSON read parameters are invalid");
  }
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const details = await handle.stat();
    if (!details.isFile() || details.size <= 0 || details.size > maximumBytes) {
      fail("INVALID_FILE", `${label} must be a nonempty regular file within its size limit`);
    }
    const contents = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(contents, "utf8") > maximumBytes) {
      fail("INVALID_FILE", `${label} exceeds its size limit`);
    }
    try {
      return JSON.parse(contents);
    } catch {
      fail("INVALID_JSON", `${label} is not valid JSON`);
    }
  } catch (error) {
    if (error instanceof OwnerDirectExecutionCliError) throw error;
    fail("FILE_READ_FAILED", `${label} could not be read as one exact regular file`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function runOwnerDirectExecutionArtifactCli(argv, dependencies = {}) {
  exactDependencies(dependencies);
  const args = parseOwnerDirectExecutionArguments(argv);
  const cwd = dependencies.cwd ?? process.cwd();
  if (typeof cwd !== "string" || cwd.length === 0) fail("INVALID_DEPENDENCIES", "cwd is invalid");
  const nowSeconds = dependencies.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    fail("INVALID_DEPENDENCIES", "nowSeconds is invalid");
  }
  const readJson = dependencies.readJson ?? readBoundedExecutionJson;
  if (typeof readJson !== "function") fail("INVALID_DEPENDENCIES", "readJson must be a function");

  const [proposalArtifact, liveAttestation, configBundleArtifact,
    configurationEvidenceArtifact, coreManifest, canaryManifest] = await Promise.all([
    readJson(resolve(cwd, args.proposal), MAX_OWNER_REVIEW_PROPOSAL_BYTES, "owner-review proposal"),
    readJson(resolve(cwd, args.attestation), MAX_LIVE_ATTESTATION_BYTES, "live attestation"),
    readJson(resolve(cwd, args.configBundle), MAX_CONFIG_BUNDLE_BYTES,
      "configuration bundle artifact"),
    readJson(resolve(cwd, args.configurationEvidence), MAX_CONFIGURATION_EVIDENCE_BYTES,
      "configuration receipt evidence artifact"),
    readJson(AUTHORITATIVE_CORE_MANIFEST_PATH, MAX_EXECUTION_MANIFEST_BYTES,
      "authoritative core manifest"),
    readJson(AUTHORITATIVE_CANARY_MANIFEST_PATH, MAX_EXECUTION_MANIFEST_BYTES,
      "authoritative canary manifest"),
  ]);
  return buildOwnerDirectFreeMintExecutionArtifact({
    proposalArtifact,
    liveAttestation,
    coreManifest,
    canaryManifest,
    configBundleArtifact,
    configurationEvidenceArtifact,
  }, { nowSeconds });
}

export function renderOwnerDirectExecutionFailure(error) {
  const code = error instanceof OwnerDirectExecutionArtifactError
    || error instanceof OwnerDirectExecutionCliError ? error.code : "UNEXPECTED_FAILURE";
  return `ENCODING_ONLY_FAIL [${code}]: owner-direct execution artifact was not created\n`;
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  try {
    const artifact = await runOwnerDirectExecutionArtifactCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(renderOwnerDirectExecutionFailure(error));
    process.exitCode = 2;
  }
}
