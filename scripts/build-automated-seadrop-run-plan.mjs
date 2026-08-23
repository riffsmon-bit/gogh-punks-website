#!/usr/bin/env node

import { constants, open } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  buildAutomatedSeaDropRunPlan,
} from "../broker/src/recommendation/automated-seadrop-run-plan.mjs";

const MAXIMUM_BYTES = 1_000_000n;

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function path(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096
    || value.trim() !== value || value.includes("\0") || /[*?\[\]{}]/.test(value)
    || !basename(value).toLowerCase().endsWith(".json")) {
    fail("INVALID_PATH", `${label} must be one exact JSON file path`);
  }
  return resolve(value);
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) {
    fail("INVALID_ARGUMENTS", "requires --profile <json> --live-state <json>");
  }
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!["--profile", "--live-state"].includes(flag) || Object.hasOwn(parsed, flag)) {
      fail("INVALID_ARGUMENTS", "only one profile and one live-state file are accepted");
    }
    parsed[flag] = path(argv[index + 1], flag);
  }
  if (!parsed["--profile"] || !parsed["--live-state"]
    || parsed["--profile"] === parsed["--live-state"]) {
    fail("INVALID_ARGUMENTS", "two distinct input files are required");
  }
  return parsed;
}

async function readJson(filePath, label) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > MAXIMUM_BYTES) {
      fail("INVALID_FILE", `${label} must be a bounded nonempty regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || BigInt(bytes.length) !== before.size) {
      fail("FILE_CHANGED", `${label} changed while it was read`);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error?.code && String(error.code).startsWith("INVALID_")
      || error?.code === "FILE_CHANGED") throw error;
    fail("FILE_READ_FAILED", `${label} could not be read as strict JSON`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function buildAutomatedSeaDropRunPlanFromFiles(argv, now = () => Date.now()) {
  const args = parseArgs(argv);
  const [profile, liveState] = await Promise.all([
    readJson(args["--profile"], "profile"),
    readJson(args["--live-state"], "live state"),
  ]);
  return buildAutomatedSeaDropRunPlan(profile, liveState, {
    nowSeconds: Math.floor(now() / 1_000),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await buildAutomatedSeaDropRunPlanFromFiles(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`AUTOMATED_RUN_PLAN_FAIL [${error?.code ?? "INVALID_INPUT"}]\n`);
    process.exitCode = 1;
  }
}
