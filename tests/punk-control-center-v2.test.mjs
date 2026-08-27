import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { activityMessage, normalizeAgentHeartbeat } from
  "../broker/src/control-center/agent-activity.mjs";
import { parseOpenSeaMintUrl, resolveOpenSeaDirectedMint,
  simulateDirectedPaidMint } from "../broker/src/control-center/directed-opensea.mjs";
import { assertPaidMintSimulation, evaluatePaidMint } from
  "../broker/src/control-center/paid-mint-policy.mjs";
import { InMemoryPaidSpendLedger } from
  "../broker/src/control-center/paid-spend-ledger.mjs";
import { buildAssetDeposit, buildFixedOwnerWithdrawal, buildNativeDeposit } from
  "../broker/src/control-center/asset-transfers.mjs";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const COLLECTION = "0x3333333333333333333333333333333333333333";
const MINT = "0x4444444444444444444444444444444444444444";
const ZERO = "0x0000000000000000000000000000000000000000";
const NOW = Date.parse("2026-08-27T12:00:00.000Z") / 1_000;

function policy(overrides = {}) {
  return {
    schema: "GOGH_PUNK_PAID_MINT_POLICY_V2", chainId: 4663, punkTokenId: "93",
    account: ACCOUNT, configuredBy: OWNER, currentOwner: OWNER, authorizationActive: true,
    freeMintsEnabled: true, paidMintsEnabled: true, dailyMintLimit: 5,
    dailySpendLimitWei: "25000000000000000", maxPerMintWei: "10000000000000000",
    authorizationValidUntil: 2_000_000_000, ...overrides,
  };
}

function usage(overrides = {}) {
  return { utcDay: "2026-08-27", amountSpentWei: "5000000000000000",
    paidMintCount: 1, totalMintCount: 1, ...overrides };
}

function candidate(priceWei = "4000000000000000", overrides = {}) {
  return { chainId: 4663, adapterId: "OPENSEA_STUDIO_V3", mintContract: MINT,
    collection: COLLECTION, recipient: ACCOUNT, priceWei, transactionValueWei: priceWei,
    quantity: 1, saleActive: true, runtimeSupported: true, ...overrides };
}

function simulation(priceWei = "4000000000000000", overrides = {}) {
  return { success: true, nativeSpentWei: priceWei, approvals: [], outgoingNfts: [],
    outgoingTokens: [], contractCreations: [],
    nftReceipts: [{ collection: COLLECTION, recipient: ACCOUNT, quantity: 1 }], ...overrides };
}

test("paid mint policy passes only within every integer-denominated owner limit", () => {
  assert.equal(evaluatePaidMint({ policy: policy(), usage: usage(), candidate: candidate(),
    nowSeconds: NOW }).code, "ALLOWED");
  assert.equal(evaluatePaidMint({ policy: policy({ maxPerMintWei: "10000000000000000" }),
    usage: usage(), candidate: candidate("12000000000000000"),
    nowSeconds: NOW }).code, "PER_MINT_LIMIT");
  assert.equal(evaluatePaidMint({ policy: policy(),
    usage: usage({ amountSpentWei: "20000000000000000" }),
    candidate: candidate("9000000000000000"), nowSeconds: NOW }).code,
  "DAILY_SPEND_LIMIT");
  assert.equal(evaluatePaidMint({ policy: policy({ paidMintsEnabled: false }), usage: usage(),
    candidate: candidate(), nowSeconds: NOW }).code, "PAID_MODE_DISABLED");
  assert.equal(evaluatePaidMint({ policy: policy(), usage: usage(),
    candidate: candidate(undefined, { runtimeSupported: false }),
    nowSeconds: NOW }).code, "UNSUPPORTED_RUNTIME");
  assert.equal(evaluatePaidMint({ policy: policy({ currentOwner: ACCOUNT }), usage: usage(),
    candidate: candidate(), nowSeconds: NOW }).code, "OWNER_CHANGED");
  assert.equal(evaluatePaidMint({ policy: policy({ authorizationActive: false }), usage: usage(),
    candidate: candidate(), nowSeconds: NOW }).code, "AUTHORIZATION_INACTIVE");
  assert.equal(evaluatePaidMint({ policy: policy({ authorizationValidUntil: NOW }), usage: usage(),
    candidate: candidate(), nowSeconds: NOW }).code, "AUTHORIZATION_EXPIRED");
  assert.equal(evaluatePaidMint({ policy: policy({ dailyMintLimit: 1 }), usage: usage(),
    candidate: candidate(), nowSeconds: NOW }).code, "DAILY_MINT_LIMIT");
  assert.equal(evaluatePaidMint({ policy: policy(), usage: usage(),
    candidate: candidate("0"), nowSeconds: NOW }).code, "PRICE_VALUE_MISMATCH");
  assert.equal(evaluatePaidMint({ policy: policy(), usage: usage(),
    candidate: candidate(undefined, { recipient: OWNER }), nowSeconds: NOW }).code,
  "WRONG_RECIPIENT");
  assert.throws(() => evaluatePaidMint({ policy: policy({ paidMintsEnabled: 1 }), usage: usage(),
    candidate: candidate(), nowSeconds: NOW }), /boolean/);
  assert.equal(evaluatePaidMint({ policy: policy(), usage: usage({ utcDay: "2026-08-26" }),
    candidate: candidate(), nowSeconds: NOW }).code, "USAGE_DAY_MISMATCH");
});

test("paid mint simulation rejects every unexpected authority or asset effect", () => {
  assert.equal(assertPaidMintSimulation(simulation(), candidate(), ACCOUNT).safe, true);
  assert.throws(() => assertPaidMintSimulation(simulation(undefined, { success: false }),
    candidate(), ACCOUNT), /simulation failed/);
  assert.throws(() => assertPaidMintSimulation(simulation(undefined, { approvals: [MINT] }),
    candidate(), ACCOUNT), /approvals/);
  assert.throws(() => assertPaidMintSimulation(simulation(undefined,
    { outgoingNfts: [COLLECTION] }), candidate(), ACCOUNT), /outgoingNfts/);
  assert.throws(() => assertPaidMintSimulation(simulation(undefined,
    { outgoingTokens: [COLLECTION] }), candidate(), ACCOUNT), /outgoingTokens/);
  assert.throws(() => assertPaidMintSimulation(simulation(undefined,
    { contractCreations: [MINT] }), candidate(), ACCOUNT), /contractCreations/);
  assert.throws(() => assertPaidMintSimulation(simulation("5000000000000000"),
    candidate(), ACCOUNT), /spend differs/);
});

test("paid and directed boundaries snapshot inputs and reject accessors", async () => {
  let getterCalls = 0;
  const accessorPolicy = policy();
  Object.defineProperty(accessorPolicy, "paidMintsEnabled", { enumerable: true,
    get() { getterCalls += 1; return true; } });
  assert.throws(() => evaluatePaidMint({ policy: accessorPolicy, usage: usage(),
    candidate: candidate(), nowSeconds: NOW }), /data fields/);
  assert.equal(getterCalls, 0);

  const targetCandidate = candidate();
  const proxiedCandidate = new Proxy(targetCandidate, {
    get() { throw new Error("mutable read must not run"); },
  });
  assert.equal(evaluatePaidMint({ policy: policy(), usage: usage(),
    candidate: proxiedCandidate, nowSeconds: NOW }).code, "ALLOWED");

  const resolved = await resolveOpenSeaDirectedMint("https://opensea.io/collection/example", {
    recipient: ACCOUNT,
    lookup: async () => ({ chainId: 4663, collectionName: "Example", collection: COLLECTION,
      mintContract: MINT, saleStage: "Public", saleActive: true,
      priceWei: "4000000000000000", currency: ZERO, quantity: 1, eligibility: "ELIGIBLE",
      runtimeSupported: true, adapterId: "OPENSEA_STUDIO_V3", checkedBlockNumber: 42_000_000 }),
  });
  const execution = { resolved, policy: policy(), usage: usage(), nowSeconds: NOW,
    revalidate: async () => ({ candidate: resolved.candidate, eligibility: "ELIGIBLE",
      checkedBlockNumber: 42_000_001 }), readCurrentOwner: async () => OWNER,
    simulate: async () => simulation() };
  const proxiedExecution = new Proxy(execution, {
    get() { throw new Error("execution values must come from descriptors"); },
  });
  assert.equal((await simulateDirectedPaidMint(proxiedExecution)).ready, true);
});

test("spend ledger serializes concurrent reservations and keeps retries idempotent", async () => {
  const ledger = new InMemoryPaidSpendLedger();
  const base = { punkTokenId: "93", utcDay: "2026-08-27",
    priceWei: "8000000000000000", dailyLimitWei: "10000000000000000", dailyMintLimit: 5 };
  const settled = await Promise.allSettled([
    ledger.reserve({ ...base, jobId: "punk93:job:0001" }),
    ledger.reserve({ ...base, jobId: "punk93:job:0002" }),
  ]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
  const accepted = settled.find((item) => item.status === "fulfilled").value;
  assert.deepEqual(await ledger.reserve({ ...base, jobId: accepted.jobId }), accepted);
  await ledger.confirm(accepted.jobId, `0x${"ab".repeat(32)}`);
  assert.deepEqual(await ledger.usage("93", "2026-08-27"), {
    punkTokenId: "93", utcDay: "2026-08-27", reservedWei: "0",
    confirmedWei: "8000000000000000", reservedMints: 0, confirmedMints: 1,
  });
});

test("OpenSea resolver accepts only clean links and authoritative exact mint evidence", async () => {
  assert.deepEqual(parseOpenSeaMintUrl("https://opensea.io/collection/example/overview"), {
    platform: "opensea", kind: "collection", slug: "example",
    canonicalUrl: "https://opensea.io/collection/example",
  });
  for (const url of ["http://opensea.io/collection/example",
    "https://evil.test/collection/example", "https://opensea.io/assets/ethereum/0x1/1",
    "https://opensea.io/collection/example?recipient=evil"]) {
    assert.throws(() => parseOpenSeaMintUrl(url));
  }
  const resolved = await resolveOpenSeaDirectedMint("https://opensea.io/collection/example", {
    recipient: ACCOUNT,
    lookup: async () => ({ chainId: 4663, collectionName: "Example", collection: COLLECTION,
      mintContract: MINT, saleStage: "Public", saleActive: true,
      priceWei: "4000000000000000", currency: ZERO, quantity: 1, eligibility: "ELIGIBLE",
      runtimeSupported: true, adapterId: "OPENSEA_STUDIO_V3", checkedBlockNumber: 42_000_000 }),
  });
  const checked = await simulateDirectedPaidMint({ resolved, policy: policy(), usage: usage(),
    nowSeconds: NOW, revalidate: async () => ({ candidate: resolved.candidate,
      eligibility: "ELIGIBLE", checkedBlockNumber: 42_000_001 }),
    readCurrentOwner: async () => OWNER, simulate: async () => simulation() });
  assert.equal(checked.ready, true);
  assert.equal(checked.simulation.recipient, ACCOUNT);
});

test("directed mint fails closed on expired, sold-out, allowlist, price drift, and changed limits", async () => {
  const evidence = { chainId: 4663, collectionName: "Example", collection: COLLECTION,
    mintContract: MINT, saleStage: "Public", saleActive: true,
    priceWei: "4000000000000000", currency: ZERO, quantity: 1, eligibility: "ELIGIBLE",
    runtimeSupported: true, adapterId: "OPENSEA_STUDIO_V3", checkedBlockNumber: 42_000_000 };
  await assert.rejects(resolveOpenSeaDirectedMint("https://opensea.io/collection/example", {
    recipient: ACCOUNT, lookup: async () => ({ ...evidence, saleActive: false }) }));
  const allowlist = await resolveOpenSeaDirectedMint("https://opensea.io/collection/example", {
    recipient: ACCOUNT, lookup: async () => ({ ...evidence, eligibility: "UNABLE_TO_VERIFY" }) });
  assert.equal(allowlist.eligibility, "UNABLE_TO_VERIFY");
  await assert.rejects(simulateDirectedPaidMint({ resolved: allowlist, policy: policy(),
    usage: usage(), nowSeconds: NOW, revalidate: async () => ({ candidate: allowlist.candidate,
      eligibility: "UNABLE_TO_VERIFY", checkedBlockNumber: 42_000_001 }),
    readCurrentOwner: async () => OWNER, simulate: async () => simulation() }), /eligibility/i);
  const eligible = await resolveOpenSeaDirectedMint("https://opensea.io/collection/example", {
    recipient: ACCOUNT, lookup: async () => evidence });
  await assert.rejects(simulateDirectedPaidMint({ resolved: eligible, policy: policy(),
    usage: usage(), nowSeconds: NOW, revalidate: async () => ({
      candidate: candidate("12000000000000000"), eligibility: "ELIGIBLE",
      checkedBlockNumber: 42_000_001 }),
    readCurrentOwner: async () => OWNER,
    simulate: async () => simulation("12000000000000000") }), /changed/);
  const ownerChanged = await simulateDirectedPaidMint({ resolved: eligible, policy: policy(),
    usage: usage(), nowSeconds: NOW, revalidate: async () => ({ candidate: eligible.candidate,
      eligibility: "ELIGIBLE", checkedBlockNumber: 42_000_001 }),
    readCurrentOwner: async () => ACCOUNT, simulate: async () => simulation() });
  assert.equal(ownerChanged.decision.code, "OWNER_CHANGED");
});

test("agent heartbeat exposes a human-readable state without secrets", () => {
  const heartbeat = normalizeAgentHeartbeat({ punkTokenId: "93", state: "SKIPPED",
    jobId: "job_12345678", lastScheduledScan: "2026-08-27T00:00:00.000Z",
    lastActualScan: "2026-08-27T00:00:01.000Z", lastSuccessfulMint: null,
    lastFailedCandidate: "Example Collection", nextScanEstimate: "2026-08-27T00:05:00.000Z",
    reason: "DAILY_SPEND_LIMIT" });
  assert.match(heartbeat.message, /spending limit/);
  assert.match(activityMessage("SIMULATING"), /Simulating/);
  assert.doesNotMatch(JSON.stringify(heartbeat), /private|secret|token=/i);
  let getterCalls = 0;
  const hostile = { punkTokenId: "93", state: "SCANNING", jobId: "job_12345678",
    lastScheduledScan: "2026-08-27T00:00:00.000Z",
    lastActualScan: "2026-08-27T00:00:01.000Z", lastSuccessfulMint: null,
    lastFailedCandidate: null, nextScanEstimate: "2026-08-27T00:05:00.000Z" };
  Object.defineProperty(hostile, "reason", { enumerable: true,
    get() { getterCalls += 1; return null; } });
  assert.throws(() => normalizeAgentHeartbeat(hostile), /data fields/);
  assert.equal(getterCalls, 0);
});

test("per-Punk heartbeat and activity schema is sanitized and restart-resistant", async () => {
  const sql = await readFile(new URL(
    "../netlify/database/migrations/20260827011000_create_punk_agent_activity.sql",
    import.meta.url), "utf8");
  assert.match(sql, /PRIMARY KEY \(chain_id, punk_token_id\)/);
  assert.match(sql, /event_id TEXT PRIMARY KEY/);
  assert.match(sql, /transaction_hash TEXT UNIQUE/);
  assert.match(sql, /last_scheduled_scan/);
  assert.match(sql, /next_scan_estimate/);
  assert.doesNotMatch(sql, /private_key|signature|auth_token/i);
});

test("local V2 migration binds idempotent jobs and transaction hashes", async () => {
  const [sql, repository] = await Promise.all([readFile(new URL(
    "../netlify/database/migrations/20260827010000_create_paid_mint_spend_ledger.sql",
    import.meta.url), "utf8"), readFile(new URL(
      "../broker/src/control-center/postgres-paid-spend-ledger.mjs", import.meta.url), "utf8")]);
  assert.match(sql, /job_id TEXT PRIMARY KEY/);
  assert.match(sql, /transaction_hash TEXT UNIQUE/);
  assert.match(sql, /CHECK \(chain_id = 4663\)/);
  assert.match(sql, /'RESERVED'.*'CONFIRMED'.*'REORGED'/s);
  assert.match(repository, /pg_advisory_xact_lock/);
  assert.match(repository, /status IN \('RESERVED', 'CONFIRMED'\)/);
  assert.match(repository, /BEGIN/);
  assert.match(repository, /ROLLBACK/);
  assert.match(repository, /transaction_hash = \$2/);
});

test("asset transfers are deterministic and bind only the Punk or current owner", () => {
  const owner = "0x1111111111111111111111111111111111111111";
  const punk = "0x2222222222222222222222222222222222222222";
  const collection = "0x3333333333333333333333333333333333333333";
  assert.deepEqual(buildNativeDeposit({ punkWallet: punk, amountWei: "100" }), {
    to: "0x2222222222222222222222222222222222222222", value: 100n, data: "0x",
  });
  const nft = buildAssetDeposit({ standard: "ERC721", currentOwner: owner,
    punkWallet: punk, contract: collection, tokenId: "441" });
  assert.equal(nft.to.toLowerCase(), collection);
  assert.match(nft.data, /^0x42842e0e/);
  assert.match(nft.data, new RegExp(punk.slice(2)));
  const token = buildFixedOwnerWithdrawal({ standard: "ERC20", punkWallet: punk,
    currentOwner: owner, contract: collection, amount: "12" });
  assert.equal(token.fixedDestination.toLowerCase(), owner);
  assert.match(token.callData, /^0xa9059cbb/);
  assert.match(token.callData, new RegExp(owner.slice(2)));
  assert.throws(() => buildAssetDeposit({ standard: "ERC721", currentOwner: owner,
    punkWallet: punk, contract: collection, tokenId: "01" }), /canonical/);
  assert.throws(() => buildFixedOwnerWithdrawal({ standard: "ARBITRARY", punkWallet: punk,
    currentOwner: owner, contract: collection }), /unsupported/);
  let getterCalls = 0;
  const hostile = { standard: "ERC721", currentOwner: owner, punkWallet: punk,
    contract: collection };
  Object.defineProperty(hostile, "tokenId", { enumerable: true,
    get() { getterCalls += 1; return "441"; } });
  assert.throws(() => buildAssetDeposit(hostile), /data fields/);
  assert.equal(getterCalls, 0);
});

test("Control Center is a dedicated progressive mobile route and remains local-only", async () => {
  const [html, browser, css, netlify] = await Promise.all([
    readFile(new URL("../site/broker/punk/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/punk-control-center.js", import.meta.url), "utf8"),
    readFile(new URL("../site/broker.css", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
  ]);
  for (const label of ["Punk Control Center", "Overview", "Agent", "Mint", "Assets",
    "Activity", "Paid Mint Settings", "Direct Your Punk to a Mint", "Add Assets"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(netlify, /from = "\/broker\/punk\/\*"/);
  assert.match(browser, /LOCAL SIMULATION/);
  assert.match(browser, /nft-withdrawal-assets\?tokenId=/);
  assert.doesNotMatch(browser, /eth_sendTransaction|wallet_sendCalls|sendRawTransaction/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});
