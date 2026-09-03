import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmPrepaidAgentGas as confirmPrepaidAgentGasRequest,
  fetchPrepaidAgentGasStatus, preflightPrepaidAgentGas, submitPrepaidAgentGas,
} from "../site/prepaid-agent-gas.js";
import {
  confirmPrepaidAgentGas, prepaidAgentGasStatus,
} from "../netlify/functions/broker-punk-agent-gas.mjs";
import prepaidAgentGasHandler from "../netlify/functions/broker-punk-agent-gas.mjs";
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
  BROKER_AUTOMATION_V3_ENABLED: "true",
  BROKER_AUTOMATION_V3_AGENT_ADDRESS: AUTOMATION_V3_AGENT,
  BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY: `0x${"a".repeat(64)}`,
  BROKER_PREPAID_AGENT_FUNDING_ENABLED: "true",
};

function poolEnvironment() {
  const result = { ...ENVIRONMENT, BROKER_AUTOMATION_V3_AGENT_POOL_ENABLED: "true" };
  for (let lane = 2; lane <= 6; lane += 1) {
    result[`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_ADDRESS`] =
      `0x${String(lane).repeat(40)}`;
    result[`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_PRIVATE_KEY`] =
      `0x${String(lane).repeat(64)}`;
    result[`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_ENABLED`] = "true";
  }
  return result;
}

function status() {
  return {
    tokenId: "93", owner: OWNER, agent: AUTOMATION_V3_AGENT,
    minimumWei: "100000000000000", maximumWei: "50000000000000000",
    recommendedWei: AMOUNT, availableWei: "0",
    fundingEnabled: true,
    recommendedWeiByMintLimit: { "1": AMOUNT, "3": "1500000000000000",
      "5": "2500000000000000", "10": "5000000000000000" },
  };
}

const SESSION = Object.freeze({ amountText: "0.0005", mintLimit: 1, durationDays: 7 });

function activePunk() {
  return { tokenId: "93", owner: OWNER, created: true, active: true };
}

test("Punk-specific gas preflight sends one exact native transfer to the fixed hosted signer", async () => {
  const calls = [];
  const provider = { request: async ({ method, params }) => {
    calls.push({ method, params });
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_accounts") return [OWNER];
    if (method === "eth_getBalance") return "0xde0b6b3a7640000";
    if (method === "eth_gasPrice") return "0x3b9aca00";
    if (method === "eth_call") return "0x";
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_sendTransaction") return HASH;
    throw new Error(`unexpected ${method}`);
  } };
  const plan = await preflightPrepaidAgentGas(provider, status(), "93", SESSION);
  assert.deepEqual(plan.transaction, {
    from: OWNER, to: AUTOMATION_V3_AGENT, value: `0x${BigInt(AMOUNT).toString(16)}`,
    data: "0x",
  });
  assert.equal(await submitPrepaidAgentGas(provider, plan), HASH);
  assert.deepEqual(calls.map(({ method }) => method), [
    "eth_chainId", "eth_accounts", "eth_getBalance", "eth_gasPrice",
    "eth_call", "eth_estimateGas", "eth_sendTransaction",
  ]);
});

test("priority preflight explains that the connected owner wallet—not the Punk wallet—needs funds", async () => {
  let sent = false;
  const provider = { request: async ({ method }) => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_accounts") return [OWNER];
    if (method === "eth_getBalance") return `0x${48941081714000n.toString(16)}`;
    if (method === "eth_gasPrice") return "0x3b9aca00";
    if (method === "eth_sendTransaction") sent = true;
    throw new Error(`unexpected ${method}`);
  } };
  await assert.rejects(
    () => preflightPrepaidAgentGas(provider, status(), "93", SESSION),
    (error) => error.code === "INSUFFICIENT_PAYER_BALANCE"
      && /Connected owner wallet has 0\.00004894 ETH/.test(error.message)
      && /not the Punk NFT Wallet/.test(error.message),
  );
  assert.equal(sent, false);
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
    () => preflightPrepaidAgentGas(provider, status(), "93", SESSION),
    (error) => error.code === "WRONG_CHAIN",
  );
  assert.equal(submitted, false);
});

test("server status exposes only an active Punk's fixed agent and isolated credit", async () => {
  const result = await prepaidAgentGasStatus("93", OWNER, {
    environment: ENVIRONMENT,
    readPunk: async () => activePunk(),
    getBalance: async () => ({ available: true, creditedWei: AMOUNT, spentWei: "0",
      spentTodayWei: "0", actualGasSpentWei: "74075738814000",
      actualGasSpentTodayWei: "74075738814000", meteringAvailable: true,
      availableWei: AMOUNT, updatedAt: null }),
  });
  assert.equal(result.tokenId, "93");
  assert.equal(result.agent, AUTOMATION_V3_AGENT);
  assert.equal(result.availableWei, AMOUNT);
  assert.equal(result.actualGasSpentTodayWei, "74075738814000");
  assert.equal(result.fundingEnabled, true);
  assert.equal(result.publicAgentLanes.length, 1);
  assert.equal(result.publicAgentLanes[0].address, AUTOMATION_V3_AGENT);
  assert.equal("privateKey" in result.publicAgentLanes[0], false);
});

test("retired prepaid funding remains readable but rejects every new credit before mutation", async () => {
  const environment = { ...ENVIRONMENT, BROKER_PREPAID_AGENT_FUNDING_ENABLED: "false" };
  const session = { id: "11111111-1111-4111-8111-111111111111", state: "COMPLETE",
    requestedMints: 1, completedMints: 1, durationDays: 1,
    startsAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-02T00:00:00.000Z",
    lastAttemptAt: "2026-09-01T00:01:00.000Z", lastResult: "MINT_CONFIRMED" };
  const result = await prepaidAgentGasStatus("93", OWNER, {
    environment,
    readPunk: async () => ({ ...activePunk(), active: false }),
    getBalance: async () => ({ available: true, creditedWei: AMOUNT, spentWei: "1",
      availableWei: String(BigInt(AMOUNT) - 1n), updatedAt: null, session,
      sessionHistory: [session] }),
  });
  assert.equal(result.fundingEnabled, false);
  assert.equal(result.fundingState, "LEGACY_READ_ONLY");
  assert.equal(result.sessionHistory.length, 1);

  let mutated = false;
  await assert.rejects(() => confirmPrepaidAgentGas({
    tokenId: "93", owner: OWNER, amountWei: AMOUNT, mintLimit: 1,
    durationDays: 7, transactionHash: HASH,
  }, {
    environment,
    readTransaction: async () => { mutated = true; },
    recordCredit: async () => { mutated = true; },
    runNow: async () => { mutated = true; },
  }), (error) => error.code === "PREPAID_FUNDING_RETIRED" && error.status === 410);
  assert.equal(mutated, false);
});

test("browser preflight cannot request a wallet transaction after funding retirement", async () => {
  let requested = false;
  await assert.rejects(() => preflightPrepaidAgentGas({
    request: async () => { requested = true; },
  }, { ...status(), fundingEnabled: false,
    fundingMessage: "Legacy funding is read-only" }, "93", SESSION),
  (error) => error.code === "PREPAID_FUNDING_RETIRED");
  assert.equal(requested, false);
});

test("legacy balance reads use the read-only route while stale funding clients fail closed", async () => {
  let requestedUrl;
  await fetchPrepaidAgentGasStatus(async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ ok: true, prepaidAgentGas: status() }) };
  }, "93", OWNER);
  assert.match(requestedUrl, /\?view=legacy&tokenId=93&owner=/);

  const response = await prepaidAgentGasHandler({
    method: "GET",
    url: `https://goghpunks.xyz/api/broker/punk-agent-gas?tokenId=93&owner=${OWNER}`,
  });
  assert.equal(response.status, 410);
  const payload = await response.json();
  assert.equal(payload.code, "PREPAID_FUNDING_RETIRED");
});

test("production prepayment cannot fund an enabled lane pool with a missing signer", async () => {
  const environment = poolEnvironment();
  environment.CONTEXT = "production";
  delete environment.BROKER_AUTOMATION_V3_AGENT_LANE_5_PRIVATE_KEY;
  await assert.rejects(
    () => prepaidAgentGasStatus("93", OWNER, {
      environment,
      readPunk: async () => activePunk(),
      lane: { laneId: 1, address: AUTOMATION_V3_AGENT },
      getBalance: async () => { throw new Error("balance must not be read"); },
    }),
    /lane 5 private key is invalid/,
  );
});

test("confirmed exact deposit credits only its Punk and requests that Punk immediately", async () => {
  let credited;
  let requested;
  const result = await confirmPrepaidAgentGas({
    tokenId: "93", owner: OWNER, amountWei: AMOUNT, mintLimit: 1,
    durationDays: 7, transactionHash: HASH,
  }, {
    environment: ENVIRONMENT,
    readPunk: async () => activePunk(),
    readTransaction: async () => ({ from: OWNER, to: AUTOMATION_V3_AGENT,
      value: AMOUNT, input: "0x", blockNumber: "51000000" }),
    recordCredit: async (evidence) => {
      credited = evidence;
      return { credited: true, availableWei: AMOUNT,
        session: { id: "11111111-1111-4111-8111-111111111111" }, jobId: "job-93" };
    },
    runNow: async (body) => {
      requested = body;
      return { tokenId: "93", status: "NO_ELIGIBLE_TARGETS", submitted: 0,
        collection: null, transactionHash: null };
    },
    recordAttempt: async () => ({ recorded: true }),
  });
  assert.equal(credited.tokenId, "93");
  assert.equal(credited.amountWei, AMOUNT);
  assert.deepEqual(requested, { tokenId: "93" });
  assert.equal(result.credit.availableWei, AMOUNT);
  assert.equal(result.run.status, "NO_ELIGIBLE_TARGETS");
});

test("prepaid gas targets the Punk's persisted lane and exposes every public lane", async () => {
  const environment = poolEnvironment();
  const lane = { laneId: 4, address: environment.BROKER_AUTOMATION_V3_AGENT_LANE_4_ADDRESS };
  const result = await prepaidAgentGasStatus("93", OWNER, {
    environment,
    resolvePunk: async () => ({ punk: activePunk(), lane, assigned: true }),
    getBalance: async () => ({ available: true, creditedWei: "0", spentWei: "0",
      availableWei: "0", updatedAt: null }),
  });
  assert.equal(result.agentLane, 4);
  assert.equal(result.agent, lane.address);
  assert.equal(result.publicAgentLanes.length, 6);
  assert.equal(result.publicAgentLanes[5].priority, true);
  assert.equal(result.publicAgentLanes.some((item) => "privateKey" in item), false);
});

test("mismatched funding evidence cannot create credit or run an agent", async () => {
  let mutated = false;
  await assert.rejects(() => confirmPrepaidAgentGas({
    tokenId: "93", owner: OWNER, amountWei: AMOUNT, mintLimit: 1,
    durationDays: 7, transactionHash: HASH,
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
  }, { tokenId: "93", owner: OWNER, amountWei: AMOUNT,
    mintLimit: 1, durationDays: 7 }, HASH);
  assert.equal(request.url, "/api/broker/punk-agent-gas");
  assert.deepEqual(Object.keys(request.body).sort(), [
    "amountWei", "durationDays", "mintLimit", "owner", "tokenId", "transactionHash",
  ]);
  assert.equal(response.run.status, "QUEUED");
});

test("browser confirmation retries provider propagation without requesting another payment", async () => {
  let requests = 0;
  let waited = 0;
  const response = await confirmPrepaidAgentGasRequest(async () => {
    requests += 1;
    if (requests === 1) return { ok: false, status: 409, json: async () => ({
      ok: false, code: "TRANSACTION_PENDING", message: "Providers are catching up",
    }) };
    return { ok: true, status: 200, json: async () => ({ ok: true,
      prepaidAgentGas: { credit: { availableWei: AMOUNT }, run: { status: "QUEUED" } } }) };
  }, { tokenId: "93", owner: OWNER, amountWei: AMOUNT,
    mintLimit: 1, durationDays: 7 }, HASH, {
    attempts: 2,
    wait: async () => { waited += 1; },
  });
  assert.equal(requests, 2);
  assert.equal(waited, 1);
  assert.equal(response.credit.availableWei, AMOUNT);
});

test("preview gas credit uses immutable deploy commit when worker release is absent", async () => {
  const queries = [];
  await confirmPrepaidAgentGas({
    tokenId: "93", owner: OWNER, amountWei: AMOUNT, mintLimit: 1,
    durationDays: 7, transactionHash: HASH,
  }, {
    environment: {
      ...ENVIRONMENT,
      BROKER_AUTOMATION_V3_WORKER_RELEASE: undefined,
      COMMIT_REF: RELEASE,
    },
    readPunk: async () => activePunk(),
    readTransaction: async () => ({ from: OWNER, to: AUTOMATION_V3_AGENT,
      value: AMOUNT, input: "0x", blockNumber: "51000000" }),
    database: { query: async (text, values) => {
      queries.push({ text, values });
      return { rows: [{ credited: true, available_wei: AMOUNT,
        session_id: "11111111-1111-4111-8111-111111111111", session_state: "ACTIVE",
        completed_mints: 0, expires_at: "2026-09-07T00:00:00.000Z", job_id: null }] };
    } },
    runNow: async () => ({ tokenId: "93", status: "QUEUED", submitted: 0 }),
    recordAttempt: async () => ({ recorded: true }),
  });
  assert.equal(queries[0].values[7], RELEASE);
});
