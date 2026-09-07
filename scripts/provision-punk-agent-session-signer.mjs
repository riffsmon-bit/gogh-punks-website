#!/usr/bin/env node

import { execFileSync } from "node:child_process";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const KEYCHAIN_ACCOUNT = "gogh-punks-worker";
const KEYCHAIN_SERVICE = "gogh-punk-agent-account-session-v1";

function readKey() {
  try {
    return execFileSync("security", ["find-generic-password", "-w", "-a",
      KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function saveKey(privateKey) {
  execFileSync("security", ["add-generic-password", "-U", "-a", KEYCHAIN_ACCOUNT,
    "-s", KEYCHAIN_SERVICE, "-w", privateKey], {
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function validatedPrivateKey(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError("Keychain contains an invalid Punk Agent Account session key");
  }
  return value;
}

let key = readKey();
let created = false;
if (key === null) {
  key = generatePrivateKey();
  saveKey(key);
  created = true;
}
const account = privateKeyToAccount(validatedPrivateKey(key));

console.log(JSON.stringify({
  keychainAccount: KEYCHAIN_ACCOUNT,
  keychainService: KEYCHAIN_SERVICE,
  address: account.address.toLowerCase(),
  created,
  privateKeyPrinted: false,
}, null, 2));
