#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createPublicClient, http, keccak256 } from "viem";

import { attestAutomatedSeaDropCandidateLive } from
  "../broker/src/discovery/automated-seadrop-live-screen.mjs";

const MAX_INPUT_BYTES = 256_000;
const ROBINHOOD_CHAIN = Object.freeze({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function args(argv) {
  const output = { confirmations: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--candidate", "--scope", "--confirmations"].includes(flag) || value === undefined) {
      fail("INVALID_ARGUMENTS", "use --candidate FILE --scope FILE [--confirmations 12..256]");
    }
    if (flag === "--candidate") output.candidate = value;
    if (flag === "--scope") output.scope = value;
    if (flag === "--confirmations") {
      if (!/^(?:1[2-9]|[2-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$/.test(value)) {
        fail("INVALID_ARGUMENTS", "confirmations must be 12 through 256");
      }
      output.confirmations = Number(value);
    }
    index += 1;
  }
  if (!output.candidate || !output.scope) {
    fail("INVALID_ARGUMENTS", "candidate and scope files are required");
  }
  return output;
}

async function readJson(pathValue, label) {
  const path = resolve(pathValue);
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > BigInt(MAX_INPUT_BYTES)) {
      fail("INVALID_FILE", `${label} must be a bounded nonempty regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
      if (before[key] !== after[key]) fail("FILE_CHANGED", `${label} changed while being read`);
    }
    if (BigInt(bytes.length) !== before.size) fail("FILE_CHANGED", `${label} was truncated`);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error?.code && !["ENOENT", "ELOOP"].includes(error.code)) throw error;
    fail("INVALID_FILE", `${label} could not be read safely`);
  } finally {
    await handle?.close();
  }
}

function endpointUrl(value, label) {
  if (typeof value !== "string" || value.length > 2_048) {
    fail("INVALID_PROVIDER", `${label} is missing or too long`);
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hash) throw new TypeError();
    return parsed.href;
  } catch {
    fail("INVALID_PROVIDER", `${label} must be an HTTPS RPC URL`);
  }
}

function readFacade(raw, configuredUrl) {
  let rawUrl;
  try {
    rawUrl = new URL(raw.transport.url).href;
  } catch {
    fail("INVALID_PROVIDER", "RPC client did not retain its transport URL");
  }
  if (rawUrl !== configuredUrl) fail("INVALID_PROVIDER", "RPC client transport URL changed");
  const getCodeEvidence = async (request) => {
    const value = (await raw.getCode(request)) ?? "0x";
    if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
      fail("INVALID_RPC_RESPONSE", "RPC returned empty or malformed runtime code");
    }
    const normalized = value.toLowerCase();
    return Object.freeze({
      codeHash: keccak256(normalized),
      length: (normalized.length - 2) / 2,
    });
  };
  return Object.freeze({
    transport: Object.freeze({ url: rawUrl }),
    getBlockNumber: raw.getBlockNumber.bind(raw),
    getBlock: raw.getBlock.bind(raw),
    getCodeEvidence,
    readContract: raw.readContract.bind(raw),
    simulateContract: raw.simulateContract.bind(raw),
    estimateContractGas: raw.estimateContractGas.bind(raw),
  });
}

export async function screenAutomatedSeaDropLiveFromFiles(argv, environment = process.env) {
  const input = args(argv);
  const primaryUrl = endpointUrl(environment.ROBINHOOD_RPC_URL, "ROBINHOOD_RPC_URL");
  const secondaryUrl = endpointUrl(
    environment.ROBINHOOD_SECONDARY_RPC_URL,
    "ROBINHOOD_SECONDARY_RPC_URL",
  );
  const [candidate, scope] = await Promise.all([
    readJson(input.candidate, "candidate"), readJson(input.scope, "scope"),
  ]);
  const primaryRaw = createPublicClient({ chain: ROBINHOOD_CHAIN, transport: http(primaryUrl) });
  const secondaryRaw = createPublicClient({ chain: ROBINHOOD_CHAIN, transport: http(secondaryUrl) });
  return attestAutomatedSeaDropCandidateLive(
    candidate,
    scope,
    { primaryUrl, secondaryUrl },
    { confirmations: input.confirmations, maximumEvidenceAgeSeconds: 30 },
    {
      primary: readFacade(primaryRaw, primaryUrl),
      secondary: readFacade(secondaryRaw, secondaryUrl),
    },
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  screenAutomatedSeaDropLiveFromFiles(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      process.stderr.write(`AUTOMATED_LIVE_SCREEN_FAIL [${error?.code ?? "FAILED"}]\n`);
      process.exitCode = 1;
    },
  );
}
