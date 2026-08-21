import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPerPunkMintDecisions } from "../broker/src/scout/mint-decision.mjs";

const MAX_INPUT_BYTES = 1_000_000;
const USAGE = "Usage: node scripts/build-punk-mint-decisions.mjs --opportunity FILE --punks FILE";

export function parseMintDecisionArguments(args) {
  if (!Array.isArray(args)) throw new TypeError("args must be an array");
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag !== "--opportunity" && flag !== "--punks") throw new Error(`unknown argument: ${flag}`);
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
    const key = flag === "--opportunity" ? "opportunityPath" : "punksPath";
    if (Object.hasOwn(parsed, key)) throw new Error(`duplicate argument: ${flag}`);
    parsed[key] = value;
  }
  if (!parsed.opportunityPath || !parsed.punksPath) throw new Error("both input files are required");
  return parsed;
}

async function boundedJson(path, label, read = readFile) {
  const bytes = await read(resolve(path));
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError(`${label} reader must return bytes`);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_INPUT_BYTES) {
    throw new TypeError(`${label} must be between 1 byte and ${MAX_INPUT_BYTES} bytes`);
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new TypeError(`${label} must contain valid JSON`);
  }
}

export async function runPunkMintDecisionCli(args, { read = readFile } = {}) {
  const parsed = parseMintDecisionArguments(args);
  const [opportunity, punks] = await Promise.all([
    boundedJson(parsed.opportunityPath, "opportunity file", read),
    boundedJson(parsed.punksPath, "punks file", read),
  ]);
  return buildPerPunkMintDecisions({ opportunity, punks });
}

function isMainModule() {
  return process.argv[1]
    && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  try {
    const result = await runPunkMintDecisionCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`MINT DECISION ERROR: ${error.message}\n${USAGE}\n`);
    process.exitCode = 2;
  }
}
