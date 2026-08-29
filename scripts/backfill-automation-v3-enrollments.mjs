#!/usr/bin/env node
import { createPublicClient, defineChain, getAddress, http, parseAbiItem } from "viem";

import { ROBINHOOD } from "../broker/src/config.mjs";
import automationManifest from "../deployments/robinhood-automation-v3.json" with { type: "json" };
import { backfillAutomationV3Enrollments } from
  "../netlify/functions/_shared/automation-v3-backfill.mjs";

const APPLY_CONFIRMATION = "ENROLL_ALREADY_AUTHORIZED_V3_PUNKS";
const LOG_WINDOW = 5_000n;
const ACTIVATION_EVENT = parseAbiItem(
  "event GoghPunkAccountActivated(address indexed account,uint256 indexed chainId,address indexed collection,uint256 tokenId,address owner,address implementation,uint256 implementationVersion)",
);

export function backfillMode(argumentsList) {
  if (!Array.isArray(argumentsList) || argumentsList.length > 1
    || (argumentsList.length === 1 && !["--dry-run", "--apply"].includes(argumentsList[0]))) {
    throw new TypeError("Usage: backfill-automation-v3-enrollments.mjs [--dry-run|--apply]");
  }
  return argumentsList[0] === "--apply" ? "APPLY" : "DRY_RUN";
}

function rpcUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new TypeError("ROBINHOOD_RPC_URL is unavailable");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new TypeError("ROBINHOOD_RPC_URL is invalid");
  }
  return parsed.href;
}

export function activationTokenIds(logs) {
  if (!Array.isArray(logs) || logs.length > 200) {
    throw new TypeError("V3 activation log set is invalid");
  }
  const implementation = getAddress(
    automationManifest.contracts.GoghPunkAccountV3.address,
  ).toLowerCase();
  const collection = getAddress(ROBINHOOD.canonicalCollection).toLowerCase();
  const output = [];
  for (const log of logs) {
    try {
      const value = log?.args;
      const selected = value?.tokenId;
      if (BigInt(value?.chainId ?? -1) !== BigInt(ROBINHOOD.chainId)
        || getAddress(value?.collection).toLowerCase() !== collection
        || getAddress(value?.implementation).toLowerCase() !== implementation
        || BigInt(value?.implementationVersion ?? -1) !== 3n
        || typeof selected !== "bigint" || selected < 0n || selected > 9_999n) continue;
      output.push(selected.toString());
    } catch {
      // Activation logs are discovery hints only. Malformed or foreign logs are ignored and can
      // never bypass the dual-provider Punk-state check performed before enrollment.
    }
  }
  return Object.freeze([...new Set(output)].sort((left, right) => Number(left) - Number(right)));
}

async function firstSuccessful(clients, operation) {
  let latestError = null;
  for (const client of clients) {
    try {
      return await operation(client);
    } catch (error) {
      latestError = error;
    }
  }
  throw latestError ?? new TypeError("V3 activation discovery is unavailable");
}

async function discoverActivations(clients) {
  const registry = getAddress(
    automationManifest.contracts.GoghPunkAccountRegistryV3.address,
  );
  const deploymentBlock = BigInt(
    automationManifest.contracts.GoghPunkAccountRegistryV3.deploymentBlock,
  );
  const head = await firstSuccessful(clients, (client) => client.getBlockNumber());
  const confirmed = head > 20n ? head - 20n : 0n;
  if (confirmed < deploymentBlock) return Object.freeze([]);
  const logs = [];
  for (let fromBlock = deploymentBlock; fromBlock <= confirmed; fromBlock += LOG_WINDOW) {
    const toBlock = fromBlock + LOG_WINDOW - 1n > confirmed
      ? confirmed : fromBlock + LOG_WINDOW - 1n;
    logs.push(...await firstSuccessful(clients, (client) => client.getLogs({
      address: registry, event: ACTIVATION_EVENT, fromBlock, toBlock,
    })));
  }
  return activationTokenIds(logs);
}

export async function main(argumentsList = process.argv.slice(2), environment = process.env) {
  const mode = backfillMode(argumentsList);
  if (mode === "APPLY" && environment.BROKER_AUTOMATION_V3_BACKFILL_CONFIRM !== APPLY_CONFIRMATION) {
    throw new TypeError(
      `Set BROKER_AUTOMATION_V3_BACKFILL_CONFIRM=${APPLY_CONFIRMATION} to apply the reviewed backfill`,
    );
  }
  const primary = rpcUrl(environment.ROBINHOOD_RPC_URL ?? environment.RPC_URL);
  const secondary = rpcUrl(environment.ROBINHOOD_SECONDARY_RPC_URL);
  if (new URL(primary).hostname === new URL(secondary).hostname) {
    throw new TypeError("V3 backfill requires two distinct RPC hosts");
  }
  const chain = defineChain({
    id: ROBINHOOD.chainId,
    name: ROBINHOOD.name,
    nativeCurrency: ROBINHOOD.nativeCurrency,
    rpcUrls: { default: { http: [primary] } },
  });
  const clients = [primary, secondary].map((url) => createPublicClient({
    chain, transport: http(url, { retryCount: 2, retryDelay: 500, timeout: 8_000 }),
  }));
  const tokenIds = await discoverActivations(clients);
  return backfillAutomationV3Enrollments(tokenIds, { apply: mode === "APPLY" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(() => {
    // RPC/provider errors commonly embed credential-bearing endpoint URLs. The operator receives
    // only a stable fail-closed code; no URL, API key, database detail, or provider body is logged.
    process.stderr.write("Backfill failed safely (LIVE_EVIDENCE_UNAVAILABLE)\n");
    process.exitCode = 1;
  });
}
