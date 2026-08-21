#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanaryExecutionReceiptEvidence,
  CanaryExecutionReceiptEvidenceError,
} from "../broker/src/recommendation/canary-execution-receipt-evidence.mjs";

const MAX_EXECUTION_ARTIFACT_BYTES = 4_000_000;
const MAX_TRANSACTION_INPUT_BYTES = 16_384;

class ExecutionReceiptEvidenceRunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExecutionReceiptEvidenceRunnerError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ExecutionReceiptEvidenceRunnerError(code, message);
}

function exactPath(value, flag) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096
    || value.trim() !== value || value.includes("\0") || /[*?\[\]{}]/.test(value)
    || !basename(value).toLowerCase().endsWith(".json")) {
    fail("INVALID_PATH", `${flag} must be one exact JSON file path`);
  }
  return resolve(value);
}

export function parseExecutionReceiptEvidenceArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) {
    fail("INVALID_ARGUMENTS", "requires --execution-artifact <json> --transaction <json>");
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!["--execution-artifact", "--transaction"].includes(flag)
      || Object.hasOwn(parsed, flag)) {
      fail("INVALID_ARGUMENTS", "only one execution artifact and transaction file are accepted");
    }
    parsed[flag] = exactPath(argv[index + 1], flag);
  }
  if (!parsed["--execution-artifact"] || !parsed["--transaction"]) {
    fail("INVALID_ARGUMENTS", "both exact JSON paths are required");
  }
  return Object.freeze(parsed);
}

export async function readStableExecutionJson(path, maximumBytes, label) {
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
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail("INVALID_JSON", `${label} is not strict UTF-8 JSON`);
    }
  } catch (error) {
    if (error instanceof ExecutionReceiptEvidenceRunnerError) throw error;
    fail("FILE_READ_FAILED", `${label} could not be opened as one exact regular file`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function transactionHashFromInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== 1 || !Object.hasOwn(value, "transactionHash")
    || typeof value.transactionHash !== "string") {
    fail("INVALID_TRANSACTION_INPUT", "transaction file must contain only transactionHash");
  }
  return value.transactionHash;
}

export async function buildExecutionReceiptEvidenceFromFiles(argv) {
  const args = parseExecutionReceiptEvidenceArguments(argv);
  const [executionArtifact, transactionInput] = await Promise.all([
    readStableExecutionJson(
      args["--execution-artifact"],
      MAX_EXECUTION_ARTIFACT_BYTES,
      "owner execution artifact",
    ),
    readStableExecutionJson(
      args["--transaction"],
      MAX_TRANSACTION_INPUT_BYTES,
      "mint transaction input",
    ),
  ]);
  return buildCanaryExecutionReceiptEvidence({
    executionArtifact,
    transactionHash: transactionHashFromInput(transactionInput),
  });
}

export function sanitizedExecutionReceiptEvidenceFailure(error) {
  const code = error instanceof ExecutionReceiptEvidenceRunnerError
    || error instanceof CanaryExecutionReceiptEvidenceError
    ? error.code : "EXECUTION_RECEIPT_EVIDENCE_FAILED";
  const message = error instanceof ExecutionReceiptEvidenceRunnerError
    || error instanceof CanaryExecutionReceiptEvidenceError
    ? error.message : "execution receipt evidence failed closed";
  return `${code}: ${message.slice(0, 500)}`;
}

export async function main(argv = process.argv.slice(2)) {
  const artifact = await buildExecutionReceiptEvidenceFromFiles(argv);
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${sanitizedExecutionReceiptEvidenceFailure(error)}\n`);
    process.exitCode = 1;
  });
}
