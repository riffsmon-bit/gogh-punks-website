import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmPrepaidAgentGas as confirmPrepaidAgentGasRequest,
  preflightPrepaidAgentGas, submitPrepaidAgentGas,
} from "../site/prepaid-agent-gas.js";
import {
  confirmPrepaidAgentGas, prepaidAgentGasStatus,
} from "../netlify/functions/broker-punk-agent-gas.mjs";
import {
  AUTOMATION_V3_AGENT,
} from "../netlify/functions/_shared/autonomy-v3-live.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"a".repeat(64)}`;
const RELEASE = "b".repeat(40);
const AMOUNT = "500000000000000";
const ENVIRONMENT = {
  BROKER_SUPABASE_QUEUE_MODE: "SHADOW",
  SUPABASE_DATABASE_URL: "postgresql://server-only:secret@db.example.invalid/postgres",
  BROKER_AUTOMATION_V3_WORKER_RELEASE: RELEASE,
  BROKER_AUTOMATION_V3_AGENT_ADDRESS: AUTOMATION_V3_AGENT,
};

function status() {
  return {
    tokenId: "93", owner: OWNER, agent: AUTOMATION_V3_AGENT,
    minimumWei: "100000000000000", maximumWei: "50000000000000000",
    recommendedWei: AMOUNT, availableWei: "0",
  };
}

function activePunk() {
  return { tokenId: "93", owner: OWNER, created: true, active: true };
}

test("Punk-specific gas preflight sends one exact native transfer to the fixed hosted signer", async () => {
  const calls = [];
  const provider = { request: async ({ method, params }) => {
    calls.push({ method, params });
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_accounts") return [OWNER];
    if (method === "eth_call") return "0x";
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_sendTransaction") return HASH;
    throw new Error(`unexpected ${method}`);
  } };
  const plan = await preflightPrepaidAgentGas(provider, status(), "93", "0.0005");
  assert.deepEqual(plan.transaction, {
    from: OWNER, to: AUTOMATION_V3_AGENT, value: `0x${BigInt(AMOUNT).toString(16)}`,
    data: "0x",
  });
  assert.equal(await submitPrepaidAgentGas(provider, plan), HASH);
  assert.deepEqual(calls.map(({ method }) => method), [
    "eth_chainId", "eth_accounts", "eth_call", "eth_estimateGas", "eth_sendTransaction",
  ]);
});

test("Punk-specific gas preflight fails before submission on owner or network drift", async () => {
  let submitted = false;
  const provider = { request: async ({ method }) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_accounts") return [OWNER];
    if (method === "eth_sendTransaction") submitted = true;
    return "0x";
  } };
  await assert.rejects(
    () => preflightPrepaidAgentGas(provider, status(), "93", "0.0005"),
    (error) => error.code === "WRONG_CHAIN",
  );
  assert.equal(submitted, false);
});

test("server status exposes only an active Punk's fixed agent and isolated credit", async () => {
  const result = await prepaidAgentGasStatus("93", OWNER, {
    environment: ENVIRONMENT,
    readPunk: async () => activePunk(),
    getBalance: async () => ({ available: true, availableWei: AMOUNT, updatedAt: null }),
  });
  assert.equal(result.tokenId, "93");
  assert.equal(result.agent, AUTOMATION_V3_AGENT);
  assert.equal(result.availableWei, AMOUNT);
});

test("confirmed exact deposit credits only its Punk and requests that Punk immediately", async () => {
  let credited;
  let requested;
  const result = await confirmPrepaidAgentGas({
    tokenId: "93", owner: OWNER, amountWei: AMOUNT, transactionHash: HASH,
  }, {
    environment: ENVIRONMENT,
    readPunk: async () => activePunk(),
    readTransaction: async () => ({ from: OWNER, to: AUTOMATION_V3_AGENT,
      value: AMOUNT, input: "0x", blockNumber: "51000000" }),
    recordCredit: async (evidence) => {
      credited = evidence;
      return { credited: true, availableWei: AMOUNT, jobId: "job-93" };
    },
    runNow: async (body) => {
      requested = body;
      return { tokenId: "93", status: "NO_ELIGIBLE_TARGETS", submitted: 0,
        collection: null, transactionHash: null };
    },
  });
  assert.equal(credited.tokenId, "93");
  assert.equal(credited.amountWei, AMOUNT);
  assert.deepEqual(requested, { tokenId: "93" });
  assert.equal(result.credit.availableWei, AMOUNT);
  assert.equal(result.run.status, "NO_ELIGIBLE_TARGETS");
});

test("mismatched funding evidence cannot create credit or run an agent", async () => {
  let mutated = false;
  await assert.rejects(() => confirmPrepaidAgentGas({
    tokenId: "93", owner: OWNER, amountWei: AMOUNT, transactionHash: HASH,
  }, {
    environment: ENVIRONMENT,
    readPunk: async () => activePunk(),
    readTransaction: async () => ({ from: OWNER,
      to: "0x2222222222222222222222222222222222222222",
      value: AMOUNT, input: "0x", blockNumber: "51000000" }),
    recordCredit: async () => { mutated = true; },
    runNow: async () => { mutated = true; },
  }), (error) => error.code === "FUNDING_MISMATCH");
  assert.equal(mutated, false);
});

test("browser confirmation never sends raw execution fields", async () => {
  let request;
  const response = await confirmPrepaidAgentGasRequest(async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ ok: true,
      prepaidAgentGas: { credit: { availableWei: AMOUNT }, run: { status: "QUEUED" } } }) };
  }, { tokenId: "93", owner: OWNER, amountWei: AMOUNT }, HASH);
  assert.equal(request.url, "/api/broker/punk-agent-gas");
  assert.deepEqual(Object.keys(request.body).sort(), [
    "amountWei", "owner", "tokenId", "transactionHash",
  ]);
  assert.equal(response.run.status, "QUEUED");
});
