#!/usr/bin/env node

import { execFileSync } from "node:child_process";

import {
  createConfiguredPunkAgentBundler,
  readPunkAgentBundlerReadiness,
} from "../broker/src/agent-account/punk-agent-account-runtime.mjs";

const KEYCHAIN_ACCOUNT = "gogh-punks-worker";
const KEYCHAIN_SERVICE = "gogh-punk-agent-account-session-v1";
const SESSION_ADDRESS = "0xf20064ae9d41097669049bb059b2510ff1f62083";

function readKey() {
  const value = execFileSync("security", ["find-generic-password", "-w", "-a",
    KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError("macOS Keychain contains an invalid Punk Agent Account session key");
  }
  return value;
}

const bundler = createConfiguredPunkAgentBundler({
  PUNK_AGENT_BUNDLER_MODE: "DIRECT_PRIVATE_RELAY",
  PUNK_AGENT_DIRECT_RELAY_RPC_URL: "https://robinhood-rpc.publicnode.com",
  PUNK_AGENT_RECEIPT_LOOKBACK_BLOCKS: "120000",
  PUNK_AGENT_DIRECT_RELAY_MIN_BALANCE_WEI: "200000000000000",
  PUNK_AGENT_SESSION_ADDRESS: SESSION_ADDRESS,
  PUNK_AGENT_SESSION_PRIVATE_KEY: readKey(),
});
const readiness = await readPunkAgentBundlerReadiness({ bundler });

console.log(JSON.stringify({
  ...readiness,
  signerAddress: readiness.funding?.signerAddress ?? null,
  privateKeyPrinted: false,
}, null, 2));
