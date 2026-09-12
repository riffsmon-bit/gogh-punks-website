import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import { readFile } from "node:fs/promises";
import deployment from "../deployments/robinhood-punk-agent-account.json" with { type: "json" };
import { handleV2AgentAccount } from "../netlify/functions/broker-v2-agent-account.mjs";
import { readPunkAgentAccountRuntime } from "../broker/src/agent-account/punk-agent-account-runtime.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
const SIGNER = "0xfcad0b19bb29d4674531d6f115237e16afce377c";
const ZERO = `0x${"0".repeat(40)}`;
const CODE = "0x6001600055";
const environment = {
  // Public deterministic test key, never a production credential.
  PUNK_AGENT_SESSION_PRIVATE_KEY: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  PUNK_AGENT_SESSION_ADDRESS: SIGNER, PUNK_AGENT_BUNDLER_RPC_URL: "https://bundler.example",
  PUNK_AGENT_WORKER_ENABLED: "true", BACKGROUND_RPC_ALLOWED_TASKS: "PUNK_AGENT_WORKER",
};
function fixture({ active = false, key = ZERO } = {}) {
  const manifest = structuredClone(deployment);
  for (const contract of Object.values(manifest.contracts)) contract.runtimeBytecodeHash = keccak256(CODE);
  const session = { sessionKey: key, authorizingOwner: active ? OWNER : ZERO,
    adapter: active ? manifest.reusedContracts.AutomatedSeaDropStudioFreeMintAdapter : ZERO,
    venue: active ? manifest.reusedContracts.SeaDrop : ZERO, adapterCodeHash: `0x${"0".repeat(64)}`,
    targetCollection: ZERO, validAfter: 0n, validUntil: 0n, maxMintsPerDay: 0,
    remainingMints: 0, mintsToday: 0, day: 0, generation: 0,
    maxGasCostWei: 0n, minimumNativeReserveWei: 0n };
  const values = { account: ACCOUNT, owner: OWNER, entryPoint: manifest.entryPoint,
    adapterRegistry: manifest.reusedContracts.ArtAdapterRegistry, acquisitionNonce: 0n,
    sessionGeneration: 2n, entryPointDeposit: 0n, autonomousSession: session, isAutonomousSessionActive: active };
  const client = { getChainId: async () => 4663, getCode: async () => CODE,
    getBalance: async () => 0n, readContract: async ({ functionName }) => {
      assert.ok(Object.hasOwn(values, functionName)); return values[functionName];
    } };
  return { manifest, client };
}
async function status(options = {}, overrides = {}) {
  const { manifest, client } = fixture(options);
  const response = await handleV2AgentAccount(new Request("https://goghpunks.xyz/api/v2/punks/93/agent-account"), {
    manifest, client, environment, pool: { query: async () => ({ rows: [] }) },
    readAuthority: async () => ({ owner: OWNER, punkWallet: ACCOUNT }),
    requireSession: async () => ({ walletAddress: OWNER }),
    readBundlerReadiness: async () => ({ ready: true }), ...overrides,
  });
  return { response, body: await response.json() };
}
test("recalled zero-key session remains readable and owner setup is available, never execution", async () => {
  const { response, body } = await status();
  assert.equal(response.status, 200); assert.equal(body.runtime.sessionActive, false);
  assert.equal(body.readiness.setupAvailable, true);
  assert.equal(body.readiness.automaticExecutionReady, false);
  assert.ok(body.readiness.blockers.includes("SESSION_NOT_AUTHORIZED"));
  assert.ok(body.readiness.blockers.includes("AGENT_GAS_UNFUNDED"));
  assert.equal(body.readiness.blockers.includes("SESSION_KEY_MISMATCH"), false);
  assert.equal(body.transactionSubmitted, false);
  assert.equal(JSON.stringify(body).includes(environment.PUNK_AGENT_SESSION_PRIVATE_KEY), false);
});
test("active wrong-key session remains blocked and reports a specific reason", async () => {
  const { response, body } = await status({ active: true, key: OWNER });
  assert.equal(response.status, 200);
  assert.ok(body.readiness.blockers.includes("SESSION_KEY_MISMATCH"));
  assert.equal(body.readiness.setupAvailable, false);
  assert.equal(body.readiness.automaticExecutionReady, false);
});
test("worker runtime still rejects the cleared or wrong execution key", async () => {
  for (const options of [{}, { active: true, key: OWNER }]) {
    const { manifest, client } = fixture(options);
    await assert.rejects(readPunkAgentAccountRuntime({ client, deployment: manifest,
      tokenId: "93", expectedOwner: OWNER, expectedSessionKey: SIGNER }), { code: "SESSION_KEY_MISMATCH" });
  }
});
test("inactive session does not bypass infrastructure and database setup blockers", async () => {
  for (const overrides of [{ environment: {} }, { readBundlerReadiness: async () => { throw new Error("offline"); } }, { pool: { query: async () => { throw new Error("offline"); } } }]) {
    const { body } = await status({}, overrides);
    assert.equal(body.readiness.setupAvailable, false);
    assert.equal(body.readiness.automaticExecutionReady, false);
  }
});
test("UI does not label service failures as sign-in failures or display a fake zero balance", async () => {
  const source = await readFile(new URL("../site/broker-v2.js", import.meta.url), "utf8");
  assert.match(source, /\["V2_SESSION_REQUIRED", "V2_SESSION_EXPIRED"\]\.includes\(status\?\.code\)/);
  assert.match(source, /signInRequired \? "SIGN-IN REQUIRED" : "READINESS UNAVAILABLE"/);
  assert.match(source, /set\("\[data-agent-account-balance\]", "NOT VERIFIED"\)/);
});
