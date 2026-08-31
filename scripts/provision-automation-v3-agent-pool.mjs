import { execFileSync } from "node:child_process";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const KEYCHAIN_ACCOUNT = "gogh-punks-worker";
const FIRST_NEW_LANE = 2;
const LAST_LANE = 6;

function service(lane) {
  return `gogh-punks-automation-v3-agent-lane-${lane}`;
}

function readKey(lane) {
  try {
    return execFileSync("security", ["find-generic-password", "-w", "-a",
      KEYCHAIN_ACCOUNT, "-s", service(lane)], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function saveKey(lane, privateKey) {
  execFileSync("security", ["add-generic-password", "-U", "-a", KEYCHAIN_ACCOUNT,
    "-s", service(lane), "-w", privateKey], {
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function privateKey(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError("Keychain contains an invalid automation signer key");
  }
  return value;
}

const result = [];
for (let lane = FIRST_NEW_LANE; lane <= LAST_LANE; lane += 1) {
  let key = readKey(lane);
  let created = false;
  if (key == null) {
    key = generatePrivateKey();
    saveKey(lane, key);
    created = true;
  }
  const account = privateKeyToAccount(privateKey(key));
  result.push(Object.freeze({ lane, address: account.address.toLowerCase(), created }));
}

console.log(JSON.stringify({
  keychainAccount: KEYCHAIN_ACCOUNT,
  lanes: result,
  privateKeysPrinted: false,
}, null, 2));
