#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  buildGuardianSafeSigningDrill,
  GuardianSafeSigningDrillError,
} from "./lib/guardian-safe-signing-drill.mjs";

const USAGE = [
  "usage: node scripts/build-guardian-safe-signing-drill.mjs",
  "  --chain-id 4663 --safe-address <address> --safe-version 1.4.1",
  "  --owner <address> --owner <address> --owner <address>",
  "  --threshold 2 --safe-nonce 0",
  "  --review-only --no-signatures --no-chain-write",
].join(" ");

function invalidArguments() {
  throw new GuardianSafeSigningDrillError("INVALID_ARGUMENTS", USAGE);
}

export function parseGuardianSafeSigningDrillArguments(argv) {
  if (!Array.isArray(argv)) invalidArguments();
  const parsed = {
    owners: [],
    reviewOnly: false,
    acceptSignatures: null,
    chainWriteAuthorized: null,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--review-only" || name === "--no-signatures"
      || name === "--no-chain-write") {
      if (seen.has(name)) invalidArguments();
      seen.add(name);
      if (name === "--review-only") parsed.reviewOnly = true;
      if (name === "--no-signatures") parsed.acceptSignatures = false;
      if (name === "--no-chain-write") parsed.chainWriteAuthorized = false;
      continue;
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) invalidArguments();
    if (name === "--owner") {
      parsed.owners.push(value);
    } else {
      if (seen.has(name)) invalidArguments();
      seen.add(name);
      if (name === "--chain-id" && value === "4663") parsed.chainId = 4663;
      else if (name === "--safe-address") parsed.safeAddress = value;
      else if (name === "--safe-version" && value === "1.4.1") {
        parsed.safeVersion = value;
      } else if (name === "--threshold" && value === "2") parsed.threshold = 2;
      else if (name === "--safe-nonce" && value === "0") parsed.safeNonce = 0;
      else invalidArguments();
    }
    index += 1;
  }
  if (argv.length !== 19 || parsed.owners.length !== 3 || parsed.chainId !== 4663
    || parsed.safeAddress === undefined || parsed.safeVersion !== "1.4.1"
    || parsed.threshold !== 2 || parsed.safeNonce !== 0 || parsed.reviewOnly !== true
    || parsed.acceptSignatures !== false || parsed.chainWriteAuthorized !== false) {
    invalidArguments();
  }
  return parsed;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseGuardianSafeSigningDrillArguments(argv);
  const artifact = buildGuardianSafeSigningDrill(options);
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
