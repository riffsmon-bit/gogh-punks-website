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
import { buildAssetDeposit, buildFixedOwnerWithdrawal, buildNativeDeposit,
  buildWrappedNativeOwnerExecution, ROBINHOOD_WETH } from
  "../broker/src/control-center/asset-transfers.mjs";
import { ROBINHOOD } from "../broker/src/config.mjs";
import { buildWrappedNativeTransaction, decodeUint256, parseEthAmount,
  simulateWrappedNativeTransaction, submitWrappedNativeTransaction,
  wrappedBalanceOfData } from "../site/wrapped-native.js";
import { localWalletConfiguration, localWalletReferer } from
  "../scripts/lib/v2-local-wallet-config.mjs";

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

test("wrapped native actions permit only canonical one-for-one WETH deposit or withdrawal", () => {
  assert.equal(ROBINHOOD.wrappedNativeToken, ROBINHOOD_WETH.toLowerCase());
  assert.equal(parseEthAmount("0.012"), 12_000_000_000_000_000n);
  assert.throws(() => parseEthAmount("1e-3"), /amount/i);
  assert.throws(() => parseEthAmount("0"), /greater than zero/);
  assert.match(wrappedBalanceOfData(ACCOUNT), /^0x70a08231/);
  assert.equal(decodeUint256(`0x${"0".repeat(63)}a`), 10n);

  const wrap = buildWrappedNativeOwnerExecution({ direction: "WRAP", punkWallet: ACCOUNT,
    currentOwner: OWNER, amountWei: "12000000000000000" });
  assert.equal(wrap.wrappedNative, ROBINHOOD_WETH);
  assert.equal(wrap.innerValue, 12_000_000_000_000_000n);
  assert.equal(wrap.innerData, "0xd0e30db0");
  assert.match(wrap.transaction.data, /^0x51945447/);

  const browserWrap = buildWrappedNativeTransaction({ direction: "WRAP", punkWallet: ACCOUNT,
    currentOwner: OWNER, amount: "0.012" });
  assert.equal(browserWrap.transaction.data, wrap.transaction.data);
  assert.deepEqual(browserWrap.transaction, {
    from: OWNER, to: ACCOUNT, value: "0x0", data: wrap.transaction.data,
  });

  const unwrap = buildWrappedNativeOwnerExecution({ direction: "UNWRAP", punkWallet: ACCOUNT,
    currentOwner: OWNER, amountWei: "12000000000000000" });
  assert.equal(unwrap.innerValue, 0n);
  assert.match(unwrap.innerData, /^0x2e1a7d4d/);
  assert.equal(buildWrappedNativeTransaction({ direction: "UNWRAP", punkWallet: ACCOUNT,
    currentOwner: OWNER, amount: "0.012" }).transaction.data, unwrap.transaction.data);
  assert.throws(() => buildWrappedNativeOwnerExecution({ direction: "SWAP", punkWallet: ACCOUNT,
    currentOwner: OWNER, amountWei: "1" }), /direction/);
  let getterCalls = 0;
  const hostile = { direction: "WRAP", punkWallet: ACCOUNT, currentOwner: OWNER };
  Object.defineProperty(hostile, "amount", { enumerable: true,
    get() { getterCalls += 1; return "0.012"; } });
  assert.throws(() => buildWrappedNativeTransaction(hostile), /data fields/);
  assert.equal(getterCalls, 0);
});

test("wrapped native submission re-simulates the exact reviewed transaction", async () => {
  const plan = buildWrappedNativeTransaction({ direction: "WRAP", punkWallet: ACCOUNT,
    currentOwner: OWNER, amount: "0.012" });
  const requests = [];
  const provider = { request: async ({ method, params }) => {
    requests.push({ method, params });
    if (method === "eth_call") return "0x";
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_sendTransaction") return `0x${"a".repeat(64)}`;
    throw new Error(`unexpected ${method}`);
  } };
  assert.deepEqual(await simulateWrappedNativeTransaction(provider, plan), {
    result: "0x", gas: "0x5208",
  });
  requests.length = 0;
  const submitted = await submitWrappedNativeTransaction(provider, plan,
    async () => buildWrappedNativeTransaction({ direction: "WRAP", punkWallet: ACCOUNT,
      currentOwner: OWNER, amount: "0.012" }), () => true);
  assert.equal(submitted.hash, `0x${"a".repeat(64)}`);
  assert.deepEqual(requests.map(({ method }) => method),
    ["eth_call", "eth_estimateGas", "eth_sendTransaction"]);
  assert.deepEqual(requests.at(-1).params, [plan.transaction]);
  await assert.rejects(submitWrappedNativeTransaction(provider, plan,
    async () => buildWrappedNativeTransaction({ direction: "WRAP", punkWallet: ACCOUNT,
      currentOwner: OWNER, amount: "0.013" }), () => true), /changed during review/);
});

test("local demo relays only the public Reown identifier for exact Control Center origins", async () => {
  assert.equal(localWalletReferer("http://127.0.0.1:8888/broker/punk/93?demo=1", 8888),
    "http://127.0.0.1:8888");
  for (const path of ["/broker/", "/broker/punk/93", "/punk/93", "/discover/"]) {
    assert.equal(localWalletReferer(`http://127.0.0.1:8888${path}`, 8888),
      "http://127.0.0.1:8888");
  }
  assert.equal(localWalletReferer("http://127.0.0.1:8888/", 8888), null);
  assert.equal(localWalletReferer("http://127.0.0.1:8888/broker/admin", 8888), null);
  assert.equal(localWalletReferer("https://evil.test/broker/punk/93", 8888), null);
  let calls = 0;
  const wallet = await localWalletConfiguration({ origin: "http://127.0.0.1:8888",
    environment: {}, fetchFunction: async (url, options) => {
      calls += 1;
      assert.equal(url, "https://goghpunks.xyz/api/broker/wallet-config");
      assert.equal(options.method, "GET");
      return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({
        ok: true, wallet: { configured: true, projectId: "a".repeat(32) },
      }) };
    } });
  assert.equal(calls, 1);
  assert.deepEqual(wallet, { configured: true, projectId: "a".repeat(32),
    metadataUrl: "http://127.0.0.1:8888", reason: null });
  await assert.rejects(localWalletConfiguration({ origin: "https://goghpunks.xyz",
    environment: { NEXT_PUBLIC_REOWN_PROJECT_ID: "a".repeat(32) } }), /origin/);
});

test("Control Center is progressive, mobile, and keeps mint execution disabled", async () => {
  const [html, browser, css, netlify, connector, scheduleFunction, scheduleMigration] = await Promise.all([
    readFile(new URL("../site/broker/punk/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/punk-control-center.js", import.meta.url), "utf8"),
    readFile(new URL("../site/broker.css", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-connector-opensea.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-scouting-schedule.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/database/migrations/20260829023000_create_scouting_schedules.sql", import.meta.url), "utf8"),
  ]);
  for (const label of ["Punk Control Center", "Overview", "Agent", "Mint", "Assets",
    "Activity", "Disconnect Wallet", "Paid Mint Settings", "Direct Your Punk to a Mint", "Add Assets",
    "Wrap or Unwrap ETH", "Add Funds to This Punk", "Fund Punk Wallet in MetaMask",
    "Collected NFTs", "Verify &amp; Withdraw in MetaMask"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(netlify, /from = "\/broker\/punk\/\*"/);
  assert.match(browser, /STAGED · BROADCAST LOCKED/);
  assert.match(browser, /\/api\/broker\/connector\/opensea/);
  assert.match(html, /Prepare Bounded Review/);
  assert.match(browser, /nft-withdrawal-assets\?\$\{params\}/);
  assert.match(browser, /preflightNftWithdrawal/);
  assert.match(browser, /submitNftWithdrawal/);
  assert.match(browser, /state\.withdrawalAsset === selectedAsset/);
  assert.match(browser, /state\.withdrawalAmount === selectedAmount/);
  assert.doesNotMatch(browser, /state\.withdrawalAsset === asset/);
  assert.match(browser, /nft-placeholder\.svg/);
  assert.match(css, /\.withdrawal-quantity\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(html, /Withdraw to my wallet/);
  assert.match(html, /destination is always the wallet that currently owns this Gogh Punk/);
  assert.match(browser, /OPENSEA_COLLECTION_FLOOR|OpenSea collection floor/);
  assert.match(html, /What your Punk considered/);
  assert.match(html, /data-agent-rarity-priority/);
  assert.match(html, /data-overview-rarity/);
  assert.match(html, /How rarity affects the hosted rotation/);
  assert.match(browser, /OpenRarity #\$\{rank\.toLocaleString\(\)\} · \$\{headStart\}/);
  assert.match(browser, /Rarity changes hosted queue priority only/);
  assert.match(browser, /Website and X links affect discovery priority only|sent into live contract safety checks/);
  assert.match(browser, /View NFT \/ Withdraw/);
  assert.match(browser, /eth_call/);
  assert.match(browser, /preflightPunkWalletFunds/);
  assert.match(browser, /submitPunkWalletFunds/);
  assert.match(browser, /fetchPunkWalletFundsGate/);
  assert.doesNotMatch(browser, /prepareOwnerFunds/);
  assert.doesNotMatch(browser, /submitOwnerAction/);
  assert.match(browser, /Selected Punk changed during review/);
  assert.match(browser, /waitForReceipt/);
  assert.match(browser, /submitWrappedNativeTransaction/);
  assert.match(browser, /submitOwnerStopTransactions/);
  assert.match(browser, /\/api\/broker\/autonomy-v3-run/);
  assert.match(browser, /UPDATE FREE-MINT LIMITS/);
  assert.match(browser, /activationDraftDirty/,
    "live status refreshes must preserve an owner's unsaved limit draft");
  assert.match(browser,
    /!state\.activationBusy && !state\.activationDraftDirty && capControl/,
    "on-chain limits hydrate the form only until the owner starts editing");
  assert.match(browser, /if \(edit\) edit\.disabled = busy \|\| !canOpenEditor/,
    "the local limit editor remains available during transient setup-service delays");
  assert.match(browser, /Sending Punk #\$\{state\.tokenId\} into the fair worker queue/);
  assert.match(browser, /Autonomous minting is disabled and agent permission is revoked/);
  assert.doesNotMatch(browser, /This local build prepared the action/);
  assert.match(browser, /\/api\/broker\/scouting-schedule/);
  assert.match(browser, /personal_sign/);
  assert.match(html, /Save Scouting Window/);
  assert.match(html, /data-wrap-transaction/);
  assert.match(scheduleFunction, /requireLiveOwner/);
  assert.match(scheduleFunction, /verifyWalletSignature/);
  assert.match(scheduleFunction, /pg_advisory_xact_lock/);
  assert.match(scheduleFunction, /aggregateBy: \["ip"\]/);
  assert.match(scheduleMigration, /broker_scouting_schedules/);
  assert.match(scheduleMigration, /broker_scouting_schedule_challenges/);
  assert.match(browser,
    /await Promise\.all\(\[loadOwnership\(wallet\), loadAutomation\(\)\]\);[\s\S]*?state\.loading = false;[\s\S]*?renderAutomation\(\);/,
    "active state must be recomputed after both parallel authority reads settle");
  assert.doesNotMatch(browser, /eth_sendTransaction|wallet_sendCalls|sendRawTransaction/);
  const demoServer = await readFile(new URL("../scripts/run-v2-local-demo.mjs", import.meta.url), "utf8");
  assert.match(demoServer, /localWalletConfiguration/);
  assert.doesNotMatch(demoServer, /privateKey|eth_send|wallet_send|sendRawTransaction/);
  assert.doesNotMatch(connector, /privateKey|eth_send|wallet_send|sendRawTransaction/);
  assert.match(connector, /submissionPerformed/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("Control Center fails clearly across route, wallet, network, and worker states", async () => {
  const [html, browser, css] = await Promise.all([
    readFile(new URL("../site/broker/punk/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/punk-control-center.js", import.meta.url), "utf8"),
    readFile(new URL("../site/broker.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /data-control-route-alert/);
  assert.match(html, /Choose a Gogh Punk first/);
  assert.match(html, /class="mobile-app-nav"/);
  assert.match(html, /aria-controls="control-panel-overview"/);
  assert.match(html, /id="control-panel-activity"[^>]+aria-labelledby="control-tab-activity"/);
  assert.match(html, /data-agent-send disabled/);
  assert.equal((html.match(/data-prepaid-agent-gas-open/g) ?? []).length, 3,
    "the Punk-specific prepaid action must be available in activation, overview, and Mint");
  assert.match(html, /data-prepaid-agent-gas-card/);
  assert.match(html, /unused credit remains assigned to this Punk/);
  assert.match(html, /Activation gas/);
  assert.match(html, /No gas deposit is required to join the normal hosted rotation/);
  assert.match(html, /1 mint\/day[\s\S]*0\.0005 ETH/);
  assert.match(html, /3 mints\/day[\s\S]*0\.0015 ETH/);
  assert.match(html, /5 mints\/day[\s\S]*0\.0025 ETH/);
  assert.match(html, /10 mints\/day[\s\S]*0\.005 ETH/);
  assert.match(html, /not activation fees, mint prices, or guaranteed mint counts/);
  assert.match(html, /connected owner wallet pays the reserve plus its displayed transfer fee/i);
  assert.match(html, /ETH already inside the Punk NFT Wallet cannot pay hosted-worker gas/);
  assert.match(html, /data-prepaid-agent-payer-balance/);
  assert.match(browser, /INSUFFICIENT_PAYER_BALANCE|payerBalanceWei/);
  assert.match(html, /Daily free-mint limit \(1–10\)/);
  assert.match(html, /Authorization duration in days \(1–30\)/);
  assert.match(browser, /for \(const button of queryAll\("\[data-prepaid-agent-gas-open\]"\)\)/);
  assert.match(browser, /function setPrepaidAgentGasMessage/);
  assert.match(browser, /prepayAgentGasAndRun/);
  assert.match(browser, /confirmPrepaidAgentGas/);
  assert.match(html, /data-directed-check disabled/);
  assert.match(html, /data-activity-state aria-live="polite"/);
  assert.match(browser, /state\.walletChainId !== CHAIN_ID/);
  assert.match(browser, /RESTORING WALLET/);
  assert.match(browser, /wallet\?\.restoring === true/);
  assert.match(browser, /SWITCH NETWORK/);
  assert.match(browser, /server-verified read-only mode, but controls must stay locked/);
  assert.match(browser, /CHECKING OWNERSHIP/);
  assert.match(browser, /Different holder required/);
  assert.match(browser, /autonomy-v3-activity\?tokenId=/);
  assert.match(browser, /latest hosted event belongs to another Punk/);
  assert.match(browser, /NFT inventory is temporarily unavailable/);
  assert.match(browser, /aria-busy/);
  assert.match(browser, /event\.key === "ArrowRight"/);
  assert.match(css, /control-actions a\[aria-disabled="true"\]/);
});
