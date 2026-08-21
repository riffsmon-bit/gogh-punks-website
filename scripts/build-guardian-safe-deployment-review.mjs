#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  buildGuardianSafeDeploymentReview,
  GuardianSafeReviewError,
} from "./lib/guardian-safe-deployment-review.mjs";

export function parseGuardianSafeReviewArguments(argv) {
  const usage =
    "usage: node scripts/build-guardian-safe-deployment-review.mjs --owner <address> --owner <address> --owner <address> --threshold 2 --salt-nonce <32-byte-public-csprng-hex>";
  if (!Array.isArray(argv) || argv.length !== 10) {
    throw new GuardianSafeReviewError(
      "INVALID_ARGUMENTS",
      usage,
    );
  }
  const owners = [];
  let threshold;
  let saltNonce;
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      throw new GuardianSafeReviewError("INVALID_ARGUMENTS", usage);
    }
    if (name === "--owner") {
      owners.push(value);
    } else if (name === "--threshold" && threshold === undefined && value === "2") {
      threshold = 2;
    } else if (name === "--salt-nonce" && saltNonce === undefined) {
      saltNonce = value;
    } else {
      throw new GuardianSafeReviewError("INVALID_ARGUMENTS", usage);
    }
  }
  if (owners.length !== 3 || threshold !== 2 || saltNonce === undefined) {
    throw new GuardianSafeReviewError("INVALID_ARGUMENTS", usage);
  }
  return { owners, threshold, saltNonce };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseGuardianSafeReviewArguments(argv);
  const artifact = buildGuardianSafeDeploymentReview(options);
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
