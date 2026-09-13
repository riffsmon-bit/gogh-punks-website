import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { keccak256 } from "viem";
import { StatelessV2Executor } from "../broker/src/v4/executor.mjs";
import { PostgresV2ExecutionStore } from "../broker/src/v4/postgres-execution-store.mjs";
import { checkV2ExecutionReadiness } from "../broker/src/v4/execution-readiness.mjs";
import { ROBINHOOD } from "../broker/src/config.mjs";

const OWNER = `0x${"1".repeat(40)}`, WALLET = `0x${"2".repeat(40)}`;
const MINT = `0x${"3".repeat(40)}`, ADAPTER = `0x${"4".repeat(40)}`;
const HASH = `0x${"a".repeat(64)}`, OTHER_HASH = `0x${"b".repeat(64)}`;
const NOW = new Date("2026-09-13T16:00:00Z");

function fixture() {
  const f = {
    now: NOW, reads: 0, builds: 0, simulations: 0, transitions: [], reservations: new Map(),
    authority: { chainId: 4663, collection: ROBINHOOD.canonicalCollection, tokenId: "93",
      owner: OWNER, punkWallet: WALLET, activated: true, nativeBalanceWei: "2000", blockNumber: "88", blockHash: HASH },
    input: { intent: { schema: "PUNK_COLLECTING_INTENT_V1", version: 1, chainId: 4663,
      punkTokenId: "93", expectedOwner: OWNER, punkWallet: WALLET, operatingMode: "ASSIST",
      mintMode: "FREE_ONLY", maxMintPriceWei: "0", maxGasPerMintWei: "500",
      dailyMintLimit: 3, totalMintLimit: 10, minimumReserveWei: "1000", maximumCollectionSupply: 2000,
      preferences: { prefer: ["PIXEL_ART"], avoid: [] }, requiresWebsite: true, requiresSocial: true,
      preferredSocialPlatforms: ["X"], blockedContracts: [], allowedContracts: [], blockedCollections: [],
      allowedAdapters: [ADAPTER], riskThreshold: 20, requireSimulation: true,
      expiration: "2026-09-20T00:00:00.000Z", userSubmittedLinksAllowed: true, discoveryEnabled: true },
    opportunity: { schema: "GOGH_NORMALIZED_OPPORTUNITY_V2", version: 2,
      opportunityId: "seadrop:neon:public", chainId: 4663, collectionContract: MINT, mintContract: MINT,
      adapter: ADAPTER, mintStage: "PUBLIC", mintMethod: "mintPublic(address,uint256)",
      priceWei: "0", estimatedGasCostWei: "100", supply: 777, walletLimit: 1,
      startTime: "2026-09-06T00:00:00.000Z", endTime: "2026-09-20T00:00:00.000Z",
      website: "https://neon.example", socialUrls: { x: "https://x.com/neon", discord: null, farcaster: null },
      sourceUrls: ["https://opensea.io/collection/neon"], artStyles: ["PIXEL_ART"], imageReference: null,
      collectionName: "Neon", contractCodeHash: HASH, adapterCodeHash: HASH, screeningStatus: "PASSED",
      simulationStatus: "PASSED", riskLevel: "LOW", riskScore: 5, expectedNftReceiver: WALLET,
      unexpectedApprovals: false, unexpectedTransfers: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
    strategyVersion: 7, accountNonce: "1", usage: { dailyMints: 0, totalMints: 0 } },
    transaction: { envelope: { to: MINT, valueWei: "0", data: "0x12345678" },
      screening: { allowedSelectors: ["0x12345678"], adapterRecognized: true, chainCodePinned: true,
        proxyChanged: false, containsDelegatecall: false, requestsApproval: false, requestsAssetTransfer: false } },
    evidence: { success: true, reverted: false, valueWei: "0", nftReceiver: WALLET, estimatedGasWei: "100",
      approvals: [], unexpectedTransfers: [], postCallVerified: true },
  };
  f.executor = new StatelessV2Executor({ clock: () => f.now,
    readAuthority: async () => { f.reads++; await f.onRead?.(); return f.authority; },
    attemptStore: {
      reserve: async (value) => {
        await f.onReserve?.();
        if (f.reservations.has(value.idempotencyKey)) return { replayed: true, result: {
          idempotencyKey: value.idempotencyKey, status: "OWNER_APPROVAL_PENDING",
          submitted: false, productionAuthorized: false } };
        f.reservations.set(value.idempotencyKey, value); return { replayed: false };
      },
      transition: async (key, state, detail) => { f.transitions.push({ key, state, detail }); },
    },
    buildKnownSafeMint: async (context) => { f.builds++; await f.onBuild?.(context); return f.transaction; },
    simulate: async (context) => { f.simulations++; await f.onSimulate?.(context); return f.evidence; },
  });
  return f;
}

async function rejected(f, code, reason = null) {
  await assert.rejects(f.executor.prepare(f.input), (error) => error.code === code
    && (!reason || error.message.includes(reason)));
  assert.deepEqual(f.transitions.map((entry) => entry.state), ["REJECTED"]);
}

test("actual simulation gas must leave the owner reserve even when cached gas fits", async () => {
  const f = fixture(); f.authority.nativeBalanceWei = "1100"; f.evidence.estimatedGasWei = "500";
  await rejected(f, "POLICY_REJECTED", "MINIMUM_RESERVE_VIOLATION");
  assert.equal(f.reads, 2);
});

test("paid preparation includes mint value as well as actual gas in the remaining reserve", async () => {
  const f = fixture(); f.authority.nativeBalanceWei = "1750"; f.evidence.estimatedGasWei = "500";
  f.input.intent.mintMode = "PAID_UP_TO_LIMIT"; f.input.intent.maxMintPriceWei = "300";
  f.input.opportunity.priceWei = "300"; f.evidence.valueWei = "300"; f.transaction.envelope.valueWei = "300";
  await rejected(f, "POLICY_REJECTED", "MINIMUM_RESERVE_VIOLATION");
});

test("gas above the per-mint cap rejects even with a large wallet balance", async () => {
  const f = fixture(); f.evidence.estimatedGasWei = "501";
  await rejected(f, "GAS_LIMIT_EXCEEDED");
});

test("actual gas at the owner cap and exact reserve boundary returns those reviewed costs", async () => {
  const f = fixture(); f.authority.nativeBalanceWei = "1500"; f.evidence.estimatedGasWei = "500";
  const result = await f.executor.prepare(f.input);
  assert.equal(result.policyMatch.requiredBalanceWei, "1500");
  assert.equal(result.policyMatch.opportunity.estimatedGasCostWei, "500");
  assert.equal(result.transaction.data, "0x12345678");
  assert.equal(result.productionAuthorized, false); assert.equal(result.submitted, false);
  assert.equal(f.reservations.get(result.idempotencyKey).opportunity.estimatedGasCostWei, "100");
  const replay = await f.executor.prepare(f.input);
  assert.equal(replay.idempotencyKey, result.idempotencyKey); assert.equal(replay.replayed, true);
  assert.equal(f.reservations.size, 1); assert.equal(f.builds, 1);
});

for (const phase of ["onReserve", "onBuild", "onSimulate"]) {
  for (const [field, value, code] of [["owner", MINT, "OWNERSHIP_CHANGED"],
    ["punkWallet", MINT, "OWNERSHIP_CHANGED"], ["nativeBalanceWei", "1000", "POLICY_REJECTED"]]) {
    test(`fresh authority rejects ${field} changes during ${phase}`, async () => {
      const f = fixture(); f[phase] = async () => { f.authority[field] = value; };
      await rejected(f, code);
      assert.equal(f.reads, 2);
    });
  }
}

test("simulation receives frozen exact bytes and detached owner context", async () => {
  const f = fixture(); let reviewed;
  f.onSimulate = async (context) => {
    reviewed = context.envelope;
    assert.notEqual(reviewed, f.transaction.envelope); assert.notEqual(context.authority, f.authority);
    for (const item of [context, context.envelope, context.authority, context.opportunity, context.opportunity.socialUrls]) {
      assert.equal(Object.isFrozen(item), true);
    }
    assert.throws(() => { context.envelope.data = "0x1234567800"; }, TypeError);
    assert.throws(() => { context.authority.owner = MINT; }, TypeError);
    assert.throws(() => { context.pinnedBlock = "89"; }, TypeError);
  };
  const result = await f.executor.prepare(f.input);
  assert.equal(result.transaction, reviewed);
  f.transaction.envelope.data = "0x12345678ff";
  assert.equal(result.transaction.data, "0x12345678");
});

test("an uncaught simulator mutation rejects the durable reservation", async () => {
  const f = fixture(); f.onSimulate = async (context) => { context.envelope.data += "00"; };
  await assert.rejects(f.executor.prepare(f.input), TypeError);
  assert.deepEqual(f.transitions.map((entry) => entry.state), ["REJECTED"]);
  assert.deepEqual(f.transitions[0].detail.reasons, ["PREPARATION_FAILED"]);
});

test("a failed final authority read cannot return the prior review", async () => {
  const f = fixture(); f.onRead = async () => { if (f.reads === 2) throw Error("offline provider failure"); };
  await assert.rejects(f.executor.prepare(f.input), /offline provider failure/);
  assert.deepEqual(f.transitions.map((entry) => entry.state), ["REJECTED"]);
});

for (const mutate of [
  (f) => { f.transaction.envelope.data += "00"; },
  (f) => { f.transaction.envelope.to = ADAPTER; },
  (f) => { f.transaction.screening.chainCodePinned = false; },
  (f) => { f.transaction.screening.allowedSelectors.push("0xffffffff"); },
]) {
  test("adapter-retained transaction or screening changes invalidate the review", async () => {
    const f = fixture(); f.onSimulate = async () => mutate(f);
    await rejected(f, "EXECUTION_CONTEXT_CHANGED");
  });
}

test("adapter changes during the final authority read also invalidate the review", async () => {
  const f = fixture(); f.onRead = async () => { if (f.reads === 2) f.transaction.envelope.data += "00"; };
  await rejected(f, "EXECUTION_CONTEXT_CHANGED");
});

test("an accessor cannot change the transaction bytes between screening and simulation", async () => {
  const f = fixture(); let reads = 0;
  Object.defineProperty(f.transaction.envelope, "data", { enumerable: true, get: () => { reads++; return "0x12345678"; } });
  await rejected(f, "EXECUTION_CONTEXT_CHANGED");
  assert.equal(reads, 0); assert.equal(f.simulations, 0);
});

for (const update of [{ chainId: 1 }, { collection: MINT }, { tokenId: "94" },
  { activated: false }, { authorityEpoch: "pretend-epoch" }, { blockNumber: "87" },
  { blockNumber: 88n, blockHash: OTHER_HASH }]) {
  test(`fresh authority rejects changed identity or snapshot ${JSON.stringify(update, (_, v) => typeof v === "bigint" ? String(v) : v)}`, async () => {
    const f = fixture(); f.onSimulate = async () => Object.assign(f.authority, update);
    await rejected(f, "EXECUTION_CONTEXT_CHANGED");
  });
}

test("an advancing authority block with the same Punk binding remains reviewable", async () => {
  const f = fixture(); f.onSimulate = async () => Object.assign(f.authority, { blockNumber: "89", blockHash: OTHER_HASH });
  assert.equal((await f.executor.prepare(f.input)).status, "OWNER_APPROVAL_REQUIRED");
});

test("a fresh reader cannot omit binding evidence present in the initial authority", async () => {
  for (const key of ["chainId", "collection", "tokenId", "activated", "blockHash"]) {
    const f = fixture(); f.onSimulate = async () => { delete f.authority[key]; };
    await rejected(f, "EXECUTION_CONTEXT_CHANGED");
  }
});

for (const [kind, mutate] of [["strategy", (f) => { f.now = new Date(f.input.intent.expiration); }],
  ["mint", (f) => { f.input.opportunity.endTime = "2026-09-13T16:00:01Z";
    f.onSimulate = async () => { f.now = new Date("2026-09-13T16:00:02Z"); }; }]]) {
  test(`a ${kind} window ending during simulation cannot return an approval`, async () => {
    const f = fixture();
    if (kind === "strategy") f.onSimulate = async () => mutate(f); else mutate(f);
    await rejected(f, "POLICY_REJECTED", kind === "strategy" ? "STRATEGY_EXPIRED" : "MINT_ENDED");
  });
}

test("replay checks authority again after a delayed durable reservation", async () => {
  const f = fixture(); await f.executor.prepare(f.input);
  f.onReserve = async () => { f.authority.owner = MINT; };
  await assert.rejects(f.executor.prepare(f.input), { code: "OWNERSHIP_CHANGED" });
  assert.equal(f.reservations.size, 1); assert.equal(f.builds, 1);
  assert.deepEqual(f.transitions.map((entry) => entry.state), ["SIMULATED", "OWNER_APPROVAL_PENDING"]);
});

for (const key of ["dailyMints", "totalMints", "opportunityMints"]) {
  test(`unknown ${key} cannot become an unused budget`, async () => {
    for (const value of [null, undefined, "0", false, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const f = fixture(); f.input.usage[key] = value;
      await assert.rejects(f.executor.prepare(f.input), TypeError);
      assert.equal(f.reservations.size, 0);
    }
  });
}

test("generic preparation keeps autonomous and production execution blocked", async () => {
  for (const [changes, code] of [[{ production: true }, "V2_PRODUCTION_AUTHORIZATION_REQUIRED"],
    [{ autonomous: true }, "SELF_FUNDED_AUTONOMOUS_GAS_UNSUPPORTED_BY_DEPLOYED_ACCOUNT"]]) {
    const f = fixture(); if (changes.autonomous) f.input.intent.operatingMode = "AUTONOMOUS";
    else f.input.production = true;
    await assert.rejects(f.executor.prepare(f.input), { code });
    assert.equal(f.reservations.size, 0); assert.equal(f.builds, 0);
  }
});

test("store retains transition CAS while giving pending approvals the existing 90-second expiry", async () => {
  const calls = [], key = "a".repeat(64);
  const store = new PostgresV2ExecutionStore({ query: async (sql, values) => {
    calls.push({ sql, values }); return { rows: [{ attempt_id: "attempt" }] };
  } });
  assert.deepEqual(await store.transition(key, "SIMULATED"), { attemptId: "attempt", state: "SIMULATED" });
  await store.transition(key, "OWNER_APPROVAL_PENDING");
  assert.deepEqual(calls.map((call) => call.values), [["SIMULATED", null, key, "RESERVED"],
    ["OWNER_APPROVAL_PENDING", null, key, "SIMULATED"]]);
  assert.match(calls[1].sql, /approval_expires_at = CASE WHEN \$1 = 'OWNER_APPROVAL_PENDING'\s+THEN clock_timestamp\(\) \+ INTERVAL '90 seconds' ELSE approval_expires_at END/);
  const failed = new PostgresV2ExecutionStore({ query: async () => ({ rows: [] }) });
  await assert.rejects(failed.transition(key, "OWNER_APPROVAL_PENDING"), /transition was rejected/);
});

function historyFixture() {
  const code = "0x6001600055", calls = [], clients = [];
  const block = (number = 50000n) => ({ number, hash: HASH, timestamp: BigInt(NOW.getTime() / 1000) });
  for (let index = 0; index < 2; index++) {
    clients.push({
      getChainId: async () => { calls.push([index, "chain"]); return 4663; },
      getBlock: async ({ blockNumber } = {}) => { calls.push([index, "block", blockNumber]); return block(blockNumber); },
      getCode: async (args) => { calls.push([index, "code", args]); return code; },
      readContract: async (args) => { calls.push([index, "contract", args]); return OWNER; },
      getLogs: async (args) => { calls.push([index, "logs", args]); return []; },
    });
  }
  const environment = { ROBINHOOD_ARCHIVE_RPC_URL: "https://primary.example/private-secret?key=secret-key",
    ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL: "https://secondary.example/private-secret?key=secret-key" };
  let created = 0;
  return { calls, clients, block, options: { environment, now: () => NOW.getTime(),
    release: { chainId: 4663, tokenId: "93", collection: ROBINHOOD.canonicalCollection, collectionCodeHash: keccak256(code) },
    createClient: () => clients[created++] } };
}

test("readiness uses both providers and the existing bounded archive validator without granting continuity", async () => {
  const f = historyFixture(); const result = await checkV2ExecutionReadiness(f.options);
  assert.equal(result.status, "READY"); assert.equal(result.verifiedProviders, 2);
  assert.equal(result.productionAuthorized, false); assert.equal(result.continuityVerified, false);
  assert.equal(result.databaseWrites, 0); assert.equal(result.publicTransactions, 0);
  const logs = f.calls.filter((entry) => entry[1] === "logs"); assert.equal(logs.length, 22);
  for (const index of [0, 1]) {
    const pages = logs.filter(([provider]) => provider === index).map(([, , args]) =>
      [args.fromBlock, args.toBlock]);
    assert.deepEqual(pages, [[30000n, 31999n], [32000n, 33999n], [34000n, 35999n], [36000n, 37999n],
      [38000n, 39999n], [40000n, 41999n], [42000n, 43999n], [44000n, 45999n], [46000n, 47999n],
      [48000n, 49999n], [50000n, 50000n]]);
  }
  for (const [, , args] of logs) {
    assert.equal(args.address, ROBINHOOD.canonicalCollection); assert.equal(args.args.tokenId, 93n);
    assert.equal(args.strict, true);
  }
  assert.doesNotMatch(JSON.stringify(result), /private-secret|secret-key|https:/);
});

test("archive failures retain safe numeric diagnostics and redact authenticated provider errors", async () => {
  const f = historyFixture();
  f.clients[0].getCode = async () => { throw Object.assign(Error(f.options.environment.ROBINHOOD_ARCHIVE_RPC_URL),
    { status: 403, cause: { code: -32001, message: "secret-key" } }); };
  const result = await checkV2ExecutionReadiness(f.options);
  assert.equal(result.status, "UNAVAILABLE"); assert.equal(result.code, "PAID_HISTORY_UNAVAILABLE");
  assert.equal(result.verifiedProviders, 0);
  assert.deepEqual(result.providerStatus.find((item) => item.provider === "PRIMARY"),
    { provider: "PRIMARY", status: "UNAVAILABLE", stage: "ARCHIVE", httpStatus: 403, rpcCode: -32001 });
  assert.doesNotMatch(JSON.stringify(result), /private-secret|secret-key|https:/);
});

for (const [name, change] of [
  ["wrong chain", (f) => { f.clients[1].getChainId = async () => 1; }],
  ["different history", (f) => { f.clients[1].getLogs = async () => [{ tokenId: 93n }]; }],
  ["changed block hash", (f) => { f.clients[1].getBlock = async (args) => ({ ...f.block(args?.blockNumber), hash: OTHER_HASH }); }],
  ["wrong runtime", (f) => { f.clients[1].getCode = async () => "0x6002"; }],
  ["stale head", (f) => { f.clients[1].getBlock = async () => ({ ...f.block(), timestamp: 1n }); }],
  ["failed head", (f) => { f.clients[1].getBlock = async () => { throw Error("secret-key"); }; }],
]) {
  test(`archive readiness rejects ${name}`, async () => {
    const f = historyFixture(); change(f); const result = await checkV2ExecutionReadiness(f.options);
    assert.equal(result.status, "UNAVAILABLE"); assert.equal(result.verifiedProviders, 0);
    assert.doesNotMatch(JSON.stringify(result), /secret-key|https:/);
  });
}

for (const url of ["http://secondary.example/secret-key", "https://primary.example/other?key=secret-key",
  "https://user:secret-key@secondary.example", "not-a-url-secret-key"]) {
  test("invalid or duplicate provider configuration is rejected before network reads", async () => {
    const f = historyFixture(); f.options.environment.ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL = url;
    const result = await checkV2ExecutionReadiness(f.options);
    assert.equal(result.code, "RPC_CONFIGURATION_INVALID"); assert.equal(f.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /secret-key|https:/);
  });
}

test("CLI requires exactly --read-only and emits only safe configuration failure output", () => {
  const script = new URL("../scripts/check-v2-execution-readiness.mjs", import.meta.url);
  for (const args of [[], ["--read-only", "secret-key"], ["--read-only"]]) {
    const run = spawnSync(process.execPath, [script.pathname, ...args], { encoding: "utf8", timeout: 10000,
      env: { PATH: process.env.PATH, ROBINHOOD_ARCHIVE_RPC_URL: "http://invalid.example/secret-key" } });
    assert.equal(run.status, args.length === 1 ? 1 : 2);
    assert.doesNotMatch(run.stdout + run.stderr, /secret-key|invalid.example/);
    if (args.length === 1) assert.equal(JSON.parse(run.stdout).code, "RPC_CONFIGURATION_INVALID");
  }
});
