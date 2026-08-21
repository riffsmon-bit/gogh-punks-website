#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runActivationReceiptAttestation,
  sanitizedActivationFailure,
} from "./punk-account-activation-runner.mjs";

export async function main(argv = process.argv.slice(2)) {
  const artifact = await runActivationReceiptAttestation(argv);
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${sanitizedActivationFailure(error)}\n`);
    process.exitCode = 1;
  });
}
