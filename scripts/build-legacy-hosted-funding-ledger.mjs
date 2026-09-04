import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildLegacyHostedFundingLedger } from
  "./lib/legacy-hosted-funding-ledger.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

if (process.argv.includes("--broadcast") || process.argv.includes("--apply")) {
  throw new Error("This tool is permanently dry-run and has no broadcast mode.");
}
const inputPath = option("--input");
if (!inputPath) throw new Error("Usage: node scripts/build-legacy-hosted-funding-ledger.mjs --input SNAPSHOT.json [--output LEDGER.json]");
const snapshot = JSON.parse(await readFile(resolve(inputPath), "utf8"));
const ledger = buildLegacyHostedFundingLedger(snapshot);
const output = `${JSON.stringify(ledger, null, 2)}\n`;
const outputPath = option("--output");
if (outputPath) {
  await writeFile(resolve(outputPath), output, { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write(JSON.stringify({ dryRun: true, broadcastAuthorized: false,
    output: resolve(outputPath), entries: ledger.entries.length,
    finalSweepReady: ledger.finalSweepReady, totals: ledger.totals }, null, 2));
} else {
  process.stdout.write(output);
}
