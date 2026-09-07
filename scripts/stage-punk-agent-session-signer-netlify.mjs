#!/usr/bin/env node

import { execFileSync } from "node:child_process";

import { privateKeyToAccount } from "viem/accounts";

const KEYCHAIN_ACCOUNT = "gogh-punks-worker";
const KEYCHAIN_SERVICE = "gogh-punk-agent-account-session-v1";
const PUBLICNODE_ROBINHOOD_RPC = "https://robinhood-rpc.publicnode.com";

function readKey() {
  const key = execFileSync("security", ["find-generic-password", "-w", "-a",
    KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new TypeError("macOS Keychain contains an invalid Punk Agent Account session key");
  }
  return key;
}

function setNetlify(name, value, { secret = false } = {}) {
  // These variables are owned by this provisioning task and every sensitive value
  // is recoverable from macOS Keychain. Netlify cannot change an existing variable's
  // scope/secret metadata atomically, so replace it deterministically.
  try {
    execFileSync("npx", ["netlify", "env:unset", name, "--force"], {
      cwd: process.cwd(), stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // Missing is the expected first-run state.
  }
  const argumentsList = ["netlify", "env:set", name, value, "--context", "production",
    "--scope", "functions"];
  if (secret) argumentsList.push("--secret");
  try {
    execFileSync("npx", argumentsList, {
      cwd: process.cwd(), stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    throw new Error(`Netlify rejected the ${name} update; no value was printed.`);
  }
}

const key = readKey();
const address = privateKeyToAccount(key).address.toLowerCase();

setNetlify("PUNK_AGENT_SESSION_ADDRESS", address);
setNetlify("PUNK_AGENT_SESSION_PRIVATE_KEY", key, { secret: true });
setNetlify("PUNK_AGENT_BUNDLER_MODE", "DIRECT_PRIVATE_RELAY");
setNetlify("PUNK_AGENT_DIRECT_RELAY_RPC_URL", PUBLICNODE_ROBINHOOD_RPC);
setNetlify("PUNK_AGENT_RECEIPT_LOOKBACK_BLOCKS", "120000");
setNetlify("PUNK_AGENT_DIRECT_RELAY_MIN_BALANCE_WEI", "200000000000000");
setNetlify("PUNK_AGENT_WORKER_ENABLED", "false");
setNetlify("GOGH_V2_DISCOVERY_INGEST_ENABLED", "false");

console.log(JSON.stringify({
  address,
  keychainBackedUp: true,
  netlifyFunctionsSecretStaged: true,
  bundlerMode: "DIRECT_PRIVATE_RELAY",
  relayRpcOrigin: new URL(PUBLICNODE_ROBINHOOD_RPC).origin,
  discoveryEnabled: false,
  workerEnabled: false,
  privateKeyPrinted: false,
}, null, 2));
