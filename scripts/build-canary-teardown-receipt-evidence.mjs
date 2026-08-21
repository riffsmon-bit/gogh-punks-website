#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanaryTeardownReceiptEvidence,
} from "../broker/src/recommendation/canary-teardown-receipt-evidence.mjs";
import {
  canonicalConfigurationEvidenceSha256,
  validateCanaryConfigurationReceiptEvidence,
} from "../broker/src/recommendation/canary-configuration-receipt-evidence.mjs";
import {
  canonicalExecutionReceiptEvidenceSha256,
  validateCanaryExecutionReceiptEvidence,
} from "../broker/src/recommendation/canary-execution-receipt-evidence.mjs";
import { canonicalJson } from "../broker/src/scout/canonical-json.mjs";
import { canonicalSha256 } from
  "../broker/src/recommendation/owner-direct-free-mint-execution.mjs";
import {
  requireVerifiedManifestAdoption,
  sourceVerificationCanonicalSha256,
} from "../broker/src/recommendation/source-verification-adoption.mjs";
import { buildOwnerDirectCanaryConfigBundle } from
  "./build-owner-direct-canary-config-bundle.mjs";
import {
  canonicalCanaryMintAttestationSha256,
  validateCanaryMintReceiptAttestationArtifact,
} from
  "./canary-mint-receipt-attestation.mjs";
import {
  deriveMintAttestationTeardownExpectation,
  validateMintAttestationForTeardown,
} from
  "./canary-teardown-artifact-binding.mjs";

const CORE_NAMES = Object.freeze([
  "ArtAdapterRegistry", "ArtAgentRegistry", "BrokerPolicyModule",
  "GoghPunkAccountV1", "GoghPunkAccountRegistry",
]);
const CANARY_NAMES = Object.freeze([
  "GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter",
]);
const MAX_BYTES = 32_000_000;
const projectRoot = resolve(import.meta.dirname, "..");
export const AUTHORITATIVE_TEARDOWN_CORE_MANIFEST = resolve(
  projectRoot,
  "deployments/robinhood.json",
);
export const AUTHORITATIVE_TEARDOWN_CANARY_MANIFEST = resolve(
  projectRoot,
  "deployments/robinhood-canary.json",
);

class CanaryTeardownReceiptBuilderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanaryTeardownReceiptBuilderError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanaryTeardownReceiptBuilderError(code, message);
}

function exactPath(value, flag) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096
    || value.trim() !== value || value.includes("\0") || /[*?\[\]{}]/.test(value)
    || !basename(value).toLowerCase().endsWith(".json")) {
    fail("INVALID_PATH", `${flag} must be one exact JSON file path`);
  }
  return resolve(value);
}

export function parseCanaryTeardownReceiptArguments(argv) {
  const allowed = [
    "--proposal-artifact", "--live-attestation", "--config-bundle",
    "--configuration-evidence", "--execution-artifact", "--execution-evidence",
    "--mint-attestation", "--transactions",
  ];
  if (!Array.isArray(argv) || argv.length !== allowed.length * 2) {
    fail("INVALID_ARGUMENTS", "all eight exact artifact paths are required");
  }
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!allowed.includes(flag) || Object.hasOwn(values, flag)) {
      fail("INVALID_ARGUMENTS", "only one of each documented artifact path is accepted");
    }
    values[flag] = exactPath(argv[index + 1], flag);
  }
  for (const flag of allowed) {
    if (!values[flag]) fail("INVALID_ARGUMENTS", `${flag} is required`);
  }
  return Object.freeze(values);
}

export async function readStableTeardownJson(path, label) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > BigInt(MAX_BYTES)) {
      fail("INVALID_FILE", `${label} must be a bounded nonempty regular file`);
    }
    const data = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || BigInt(data.length) !== before.size) {
      fail("FILE_CHANGED", `${label} changed while it was read`);
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
    } catch {
      fail("INVALID_JSON", `${label} is not strict UTF-8 JSON`);
    }
  } catch (error) {
    if (error instanceof CanaryTeardownReceiptBuilderError) throw error;
    fail("FILE_READ_FAILED", `${label} could not be opened as one exact regular file`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function exactTransactions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== 1 || !Object.hasOwn(value, "transactions")
    || !Array.isArray(value.transactions)) {
    fail("INVALID_TRANSACTION_INPUT", "transaction input must contain only transactions");
  }
  return value.transactions;
}

export async function buildCanaryTeardownReceiptEvidenceFromFiles(argv) {
  const args = parseCanaryTeardownReceiptArguments(argv);
  const [core, canary, proposalArtifact, liveAttestation, config, configEvidenceArtifact,
    executionArtifact, executionEvidenceArtifact, mintAttestation,
    transactionInput] = await Promise.all([
    readStableTeardownJson(AUTHORITATIVE_TEARDOWN_CORE_MANIFEST, "authoritative core manifest"),
    readStableTeardownJson(AUTHORITATIVE_TEARDOWN_CANARY_MANIFEST,
      "authoritative canary manifest"),
    readStableTeardownJson(args["--proposal-artifact"], "owner-approved mint proposal"),
    readStableTeardownJson(args["--live-attestation"], "live configuration attestation"),
    readStableTeardownJson(args["--config-bundle"], "configuration bundle"),
    readStableTeardownJson(args["--configuration-evidence"], "configuration receipt evidence"),
    readStableTeardownJson(args["--execution-artifact"], "owner execution artifact"),
    readStableTeardownJson(args["--execution-evidence"], "execution receipt evidence"),
    readStableTeardownJson(args["--mint-attestation"], "mint receipt attestation"),
    readStableTeardownJson(args["--transactions"], "teardown transaction index"),
  ]);
  let expectedConfig;
  let configEvidence;
  let executionEvidence;
  let coreAdoption;
  let canaryAdoption;
  try {
    expectedConfig = buildOwnerDirectCanaryConfigBundle(core, canary);
    configEvidence = validateCanaryConfigurationReceiptEvidence(configEvidenceArtifact);
    executionEvidence = validateCanaryExecutionReceiptEvidence(
      executionEvidenceArtifact,
      executionArtifact,
    );
    validateCanaryMintReceiptAttestationArtifact(mintAttestation, {
      proposalArtifact,
      liveAttestation,
      coreManifest: core,
      canaryManifest: canary,
      configBundleArtifact: config,
      configurationEvidenceArtifact: configEvidenceArtifact,
      executionArtifact,
      executionReceiptEvidence: executionEvidenceArtifact,
    });
    coreAdoption = requireVerifiedManifestAdoption(core, CORE_NAMES);
    canaryAdoption = requireVerifiedManifestAdoption(canary, CANARY_NAMES);
  } catch (error) {
    fail(error?.code ?? "UPSTREAM_ARTIFACT_INVALID",
      error?.message ?? "an upstream artifact is invalid");
  }
  if (canonicalJson(config) !== canonicalJson(expectedConfig)
    || configEvidence.evidence.configBundleHash !== expectedConfig.bundleHash) {
    fail("CONFIG_BUNDLE_MISMATCH", "configuration artifacts do not match both manifests");
  }
  const execution = executionEvidence.evidence;
  const mint = validateMintAttestationForTeardown(mintAttestation,
    deriveMintAttestationTeardownExpectation({
      coreManifest: core,
      canaryManifest: canary,
      executionEvidence: execution,
      executionArtifact,
    }));
  if (mint.transaction.hash !== execution.transaction.hash
    || mint.transaction.from !== execution.transaction.from
    || mint.transaction.to !== execution.transaction.to
    || mint.transaction.data !== executionArtifact.transaction.data
    || mint.transaction.dataKeccak256 !== execution.transaction.dataKeccak256) {
    fail("MINT_TRANSACTION_MISMATCH", "mint attestation differs from execution receipt evidence");
  }
  const hashes = {
    coreManifestSha256: canonicalSha256(core),
    canaryManifestSha256: canonicalSha256(canary),
    coreSourceVerificationAdoptionSha256: sourceVerificationCanonicalSha256(coreAdoption),
    canarySourceVerificationAdoptionSha256: sourceVerificationCanonicalSha256(canaryAdoption),
    configBundleReviewHash: expectedConfig.bundleHash,
    configBundleArtifactSha256: canonicalSha256(config),
    configurationReceiptEvidenceHash: configEvidence.evidenceHash,
    configurationReceiptEvidenceArtifactSha256:
      canonicalConfigurationEvidenceSha256(configEvidenceArtifact),
    executionReceiptEvidenceHash: executionEvidence.evidenceSha256,
    executionReceiptEvidenceArtifactSha256:
      canonicalExecutionReceiptEvidenceSha256(executionEvidenceArtifact),
    mintReceiptAttestationArtifactSha256:
      canonicalCanaryMintAttestationSha256(mintAttestation),
  };
  const mintHashComparisons = {
    coreManifestSha256: hashes.coreManifestSha256,
    canaryManifestSha256: hashes.canaryManifestSha256,
    coreSourceVerificationAdoptionSha256: hashes.coreSourceVerificationAdoptionSha256,
    canarySourceVerificationAdoptionSha256: hashes.canarySourceVerificationAdoptionSha256,
    proposalSha256: canonicalSha256(proposalArtifact.proposal),
    proposalArtifactSha256: canonicalSha256(proposalArtifact),
    configBundleReviewKeccak256: hashes.configBundleReviewHash,
    configBundleArtifactSha256: hashes.configBundleArtifactSha256,
    configurationReceiptEvidenceSha256: hashes.configurationReceiptEvidenceHash,
    configurationReceiptEvidenceArtifactSha256:
      hashes.configurationReceiptEvidenceArtifactSha256,
    liveAttestationSha256: canonicalSha256(liveAttestation),
    executionArtifactSha256: execution.executionArtifactSha256,
    executionReceiptEvidenceSha256: hashes.executionReceiptEvidenceHash,
    executionReceiptEvidenceArtifactSha256: hashes.executionReceiptEvidenceArtifactSha256,
  };
  for (const [name, expected] of Object.entries(mintHashComparisons)) {
    if (mintAttestation.evidenceHashes[name]?.toLowerCase() !== expected.toLowerCase()) {
      fail("EVIDENCE_HASH_MISMATCH", `mint evidence ${name} does not match`);
    }
  }
  const transactions = exactTransactions(transactionInput);
  const calls = expectedConfig.review.teardownPlan.orderedCalls;
  if (transactions.length !== calls.length) {
    fail("INVALID_TRANSACTION_INPUT", "teardown transaction count does not match the plan");
  }
  for (let index = 0; index < calls.length; index += 1) {
    if (transactions[index]?.id !== calls[index].id
      || transactions[index]?.order !== calls[index].order) {
      fail("INVALID_TRANSACTION_INPUT", `teardown transaction ${index + 1} is not plan-bound`);
    }
  }
  return buildCanaryTeardownReceiptEvidence({
    bindings: hashes,
    mintReceipt: {
      transactionHash: mint.receipt.transactionHash,
      blockNumber: mint.receipt.blockNumber,
      blockHash: mint.receipt.blockHash,
      transactionIndex: mint.receipt.transactionIndex,
    },
    transactions,
  });
}

export async function main(argv = process.argv.slice(2)) {
  const artifact = await buildCanaryTeardownReceiptEvidenceFromFiles(argv);
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    const code = error?.code ?? "TEARDOWN_RECEIPT_EVIDENCE_FAILED";
    process.stderr.write(`${code}: ${String(error?.message ?? "failed closed").slice(0, 500)}\n`);
    process.exitCode = 1;
  });
}
