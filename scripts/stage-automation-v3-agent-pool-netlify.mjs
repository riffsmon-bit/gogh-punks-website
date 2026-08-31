import { execFileSync } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";

const KEYCHAIN_ACCOUNT = "gogh-punks-worker";

function readKey(lane) {
  return execFileSync("security", ["find-generic-password", "-w", "-a",
    KEYCHAIN_ACCOUNT, "-s", `gogh-punks-automation-v3-agent-lane-${lane}`], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function setNetlify(name, value, { context = "all", secret = false } = {}) {
  // Netlify cannot atomically change both metadata dimensions on an existing
  // variable. These pool variables are created and owned by this provisioning
  // task, so replace each one from its Keychain source to keep the operation
  // deterministic and idempotent.
  try {
    execFileSync("npx", ["netlify", "env:unset", name, "--force"], {
      cwd: process.cwd(), stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // Missing is the expected first-run state.
  }
  const argumentsList = ["netlify", "env:set", name, value, "--context", context,
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

const lanes = [];
for (let lane = 2; lane <= 6; lane += 1) {
  const key = readKey(lane);
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new TypeError(`Lane ${lane} key is invalid`);
  const address = privateKeyToAccount(key).address.toLowerCase();
  setNetlify(`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_ADDRESS`, address);
  setNetlify(`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_PRIVATE_KEY`, key,
    { context: "production", secret: true });
  setNetlify(`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_ENABLED`, "false");
  lanes.push({ lane, address, staged: true, enabled: false });
}
setNetlify("BROKER_AUTOMATION_V3_AGENT_POOL_ENABLED", "false");

console.log(JSON.stringify({ lanes, privateKeysPrinted: false,
  message: "Signer keys are staged in production Functions scope; all new lanes remain disabled." },
null, 2));
