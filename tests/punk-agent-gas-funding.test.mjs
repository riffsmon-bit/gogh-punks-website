import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { decodeFunctionData, keccak256, parseAbi, toFunctionSelector } from "viem";
import { prepareAgentGasFunding, submitAgentGasFunding } from "../site/punk-agent-gas-funding.js";
import { getAgentGasFundingState, recoverAgentGasFunding, recheckAgentGasFunding } from "../site/punk-agent-gas-funding.js";
import { AGENT_RECOVERY_PINS as PINS, agentRecoveryProxyRuntime } from "../site/punk-agent-recovery.js";
import { CODE as PINNED_CODE } from "./fixtures/punk-agent-runtime.mjs";

const OWNER = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";
const PUNK = "0x06d5e0df2eb9512777403bf017031618f4713e19";
const AGENT = "0xcadcfd37e715bc031cf0cec7fa2335091c878c83";
const REGISTRY = "0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844";
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const CODE = "0x6001600055";
const HASH = `0x${"ab".repeat(32)}`;
const BLOCK_HASH = `0x${"cd".repeat(32)}`;
const SALT = `0x${"00".repeat(32)}`;
const addressResult = value => `0x${value.slice(2).padStart(64, "0")}`;
const EMPTY = `0x${"20".padStart(64, "0")}${"0".repeat(64)}`;
function context() {
  return { gate: { status: "READY_FOR_LIVE_OWNER_CHECK", capability: true, reason: null, checkedAt: new Date().toISOString(), bindings: {
    chainId: 4663, punkCollection: COLLECTION, accountImplementation: "0xb24199845ca42966e755b2dad7c8a9a490afeb13",
    accountRegistry: "0x7d4f654cd95104dc22c64fc8c70937f32fcbac52", punkTokenId: "93", account: PUNK, expectedOwner: OWNER,
    accountRuntimeCodeHash: keccak256(CODE), destination: OWNER, supportedStandards: ["ERC721", "ERC1155"],
  } }, agent: { ok: true, tokenId: "93", owner: OWNER, runtime: { accountCreated: true, account: AGENT, owner: OWNER } },
  funding: { ok: true, tokenId: "93", destination: PUNK, minimumReserveWei: "200000000000000" } };
}
function world() {
  const calls = [];
  const state = { owner: OWNER, chain: "0x1237", balance: 1200000000000000n, destination: AGENT, simulate: true,
    nonce: "0x7", ownerBalance: 10n ** 18n, registryCode: PINNED_CODE.registry, implementationCode: PINNED_CODE.implementation,
    agentCode: agentRecoveryProxyRuntime("93", SALT), punkCode: CODE, head: "0x10b" };
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  let tail = Promise.resolve();
  const locks = { request: (_key, _options, fn) => { const next = tail.then(fn); tail = next.catch(() => {}); return next; } };
  const provider = { request: async ({ method, params }) => {
    calls.push({ method, params });
    if (method === "eth_chainId") return state.chain;
    if (method === "eth_accounts") return [state.connected ?? state.owner];
    if (method === "eth_getBalance") return `0x${(params[0] === OWNER ? state.ownerBalance : state.balance).toString(16)}`;
    if (method === "eth_getTransactionCount") return params[1] === "pending" ? state.pendingNonce ?? state.nonce : state.nonce;
    if (method === "eth_getCode") return params[0] === REGISTRY ? state.registryCode : params[0] === PINS.implementation
      ? state.implementationCode : params[0] === AGENT ? state.agentCode : state.punkCode;
    if (method === "eth_estimateGas") return "0x10000";
    if (method === "eth_sendTransaction") {
      assert.equal(getAgentGasFundingState(OWNER, "93", { storage }).status, "WALLET_REQUESTED");
      state.transaction = { ...params[0], hash: HASH, input: params[0].data };
      if (state.sendError) throw state.sendError;
      return state.sendHash ?? HASH;
    }
    if (method === "eth_getTransactionByHash") return state.transaction ?? null;
    if (method === "eth_getTransactionReceipt") { if (state.receiptError) throw Error("offline"); return state.receipt ?? null; }
    if (method === "eth_getBlockByNumber") return { number: "0x100", hash: state.blockHash ?? BLOCK_HASH };
    if (method === "eth_blockNumber") return state.head;
    if (method === "eth_call") {
      const tx = params[0];
      if (tx.to === REGISTRY) {
        if (tx.data === "0x6c74921e") return SALT;
        assert.equal(tx.data.slice(0, 10), toFunctionSelector("account(uint256)"));
        assert.equal(BigInt(`0x${tx.data.slice(10)}`), 93n);
        return addressResult(state.destination);
      }
      if (tx.data === "0x8da5cb5b" || tx.to === COLLECTION) return addressResult(state.owner);
      if (!state.simulate) throw new Error("reverted");
      if (tx.to === PUNK && tx.data.startsWith("0x51945447")) return EMPTY;
      if (tx.to === AGENT && tx.data === "0x") return "0x";
    }
    throw new Error(`Unexpected RPC: ${method}`);
  } };
  const confirm = (status = "0x1") => { state.receipt = { transactionHash: HASH, blockNumber: "0x100", blockHash: BLOCK_HASH, status }; };
  return { calls, state, provider, storage, locks, confirm };
}
test("existing Punk ETH uses one owner execute with exact registered destination and zero outer value", async () => {
  const w = world(); const p = await prepareAgentGasFunding(w.provider, context(), "93", "PUNK", "0.0005");
  assert.equal(p.transaction.from, OWNER); assert.equal(p.transaction.to, PUNK); assert.equal(p.transaction.value, "0x0");
  const decoded = decodeFunctionData({ abi: parseAbi(["function execute(address,uint256,bytes,uint8) returns (bytes)"]), data: p.transaction.data });
  assert.equal(decoded.args[0].toLowerCase(), AGENT); assert.equal(decoded.args[1], 500000000000000n);
  assert.equal(decoded.args[2], "0x"); assert.equal(decoded.args[3], 0);
  assert.equal(w.calls.some(c => c.method === "eth_sendTransaction"), false);
  await submitAgentGasFunding(w.provider, p, { loadContext: async () => context(), isCurrent: () => true, storage: w.storage, locks: w.locks });
  assert.equal(w.calls.filter(c => c.method === "eth_sendTransaction").length, 1);
});
test("owner funding deposits directly without executing from the Punk", async () => {
  const w = world(); const p = await prepareAgentGasFunding(w.provider, context(), "93", "OWNER", "0.0005");
  assert.deepEqual(p.transaction, { chainId: "0x1237", nonce: "0x7", from: OWNER, to: AGENT, value: "0x1c6bf52634000", data: "0x" });
});
test("Punk gas transfer respects reserve and allows exactly the remaining balance", async () => {
  const w = world();
  await prepareAgentGasFunding(w.provider, context(), "93", "PUNK", "0.001");
  await assert.rejects(prepareAgentGasFunding(w.provider, context(), "93", "PUNK", "0.001000000000000001"), /reserve/);
  for (const reserve of [undefined, "-1", "1e3", "999999999999999999999999999999999999999999999999999999999999999999999999999999999"]) {
    const c = context(); c.funding.minimumReserveWei = reserve;
    await assert.rejects(prepareAgentGasFunding(w.provider, c, "93", "PUNK", "0.0005"));
  }
});
test("malformed amount, source, identity, destination and inactive account fail closed", async () => {
  for (const amount of ["0", "-1", ".1", "1e-3", "01", "1.000000000000000001"]) await assert.rejects(prepareAgentGasFunding(world().provider, context(), "93", "PUNK", amount));
  await assert.rejects(prepareAgentGasFunding(world().provider, context(), "93", "CUSTOM", "0.001"));
  for (const change of [c => c.agent.tokenId = "94", c => c.agent.owner = AGENT, c => c.agent.runtime.account = PUNK, c => c.agent.runtime.accountCreated = false, c => c.funding.destination = AGENT]) {
    const c = context(); change(c); await assert.rejects(prepareAgentGasFunding(world().provider, c, "93", "PUNK", "0.0005"));
  }
});
test("changed owner, chain, registered account and simulation reject without send", async () => {
  for (const change of [s => s.owner = AGENT, s => s.chain = "0x1", s => s.destination = PUNK, s => s.simulate = false]) {
    const w = world(); change(w.state);
    await assert.rejects(prepareAgentGasFunding(w.provider, context(), "93", "PUNK", "0.0005"));
    assert.equal(w.calls.some(c => c.method === "eth_sendTransaction"), false);
  }
});
test("submit resimulates and rejects altered plan, reserve, selection and balance", async () => {
  for (const kind of ["plan", "reserve", "selection", "balance"]) {
    const w = world(); let p = await prepareAgentGasFunding(w.provider, context(), "93", "PUNK", "0.0005");
    const c = context();
    if (kind === "plan") p = { ...p, transaction: { ...p.transaction, to: AGENT } };
    if (kind === "reserve") c.funding.minimumReserveWei = "300000000000000";
    if (kind === "balance") w.state.balance = 1n;
    await assert.rejects(submitAgentGasFunding(w.provider, p, { loadContext: async () => c, isCurrent: () => kind !== "selection", storage: w.storage, locks: w.locks }));
    assert.equal(w.calls.some(c => c.method === "eth_sendTransaction"), false);
  }
});
test("Fund page distinguishes balances, sources, readiness recheck and explicit confirmation", async () => {
  const html = await readFile(new URL("../site/broker/v2/index.html", import.meta.url), "utf8");
  for (const text of ["AGENT GAS FUND", "USE PUNK WALLET ETH", "ADD ETH FROM MY WALLET", "ENTRYPOINT GAS DEPOSIT", "RECHECK / SIGN IN", "data-agent-gas-confirm"]) assert.ok(html.includes(text));
  const js = await readFile(new URL("../site/broker-v2.js", import.meta.url), "utf8");
  assert.match(js, /submitAgentGasFunding/); assert.match(js, /state\.gasFundingBusy/);
  assert.match(js, /Funding does not activate a mission/);
});

const ownerContext = () => ({ agent: context().agent,
  ownerBinding: { chainId: 4663, collection: COLLECTION, tokenId: "93", owner: OWNER } });
const options = (w, extra = {}) => ({ storage: w.storage, locks: w.locks, isCurrent: () => true,
  loadContext: async () => ownerContext(), ...extra });
const ownerPlan = w => prepareAgentGasFunding(w.provider, ownerContext(), "93", "OWNER", "0.0005");

test("OWNER funds a verified Agent with an inactive V3 without requesting any V3 state", async () => {
  const w = world(); w.state.punkCode = "0x";
  const prepared = await ownerPlan(w);
  assert.equal(prepared.punkWallet, null);
  assert.equal(prepared.reserveWei, "0");
  assert.equal(w.calls.some(call => JSON.stringify(call.params).includes(PUNK)), false);
  assert.equal(w.calls.some(call => call.method === "eth_sendTransaction"), false);
  await submitAgentGasFunding(w.provider, prepared, options(w));
  assert.equal(w.calls.filter(call => call.method === "eth_sendTransaction").length, 1);
  assert.equal(w.state.transaction.to, AGENT);
  assert.equal(w.state.transaction.value, prepared.transaction.value);
});
test("legacy OWNER context ignores a disabled V3 gate, but PUNK funding still requires activation", async () => {
  const w = world(), c = context(); c.gate.status = "BLOCKED"; c.gate.capability = false; w.state.punkCode = "0x";
  await prepareAgentGasFunding(w.provider, c, "93", "OWNER", "0.0005");
  await assert.rejects(prepareAgentGasFunding(w.provider, c, "93", "PUNK", "0.0005"));
});
for (const [name, mutate] of [
  ["chain", c => c.ownerBinding.chainId = 1], ["collection", c => c.ownerBinding.collection = AGENT],
  ["token", c => c.ownerBinding.tokenId = "94"], ["owner", c => c.ownerBinding.owner = AGENT],
  ["missing binding", c => delete c.ownerBinding], ["Agent token", c => c.agent.tokenId = "94"],
  ["inactive Agent", c => c.agent.runtime.accountCreated = false],
]) test(`OWNER rejects invalid captured ${name}`, async () => {
  const w = world(), c = ownerContext(); mutate(c);
  await assert.rejects(prepareAgentGasFunding(w.provider, c, "93", "OWNER", "0.0005"));
  assert.equal(w.calls.some(call => call.method === "eth_sendTransaction"), false);
});
for (const [name, mutate] of [
  ["current owner", s => s.owner = AGENT], ["connected account", s => s.connected = AGENT],
  ["chain", s => s.chain = "0x1"], ["registry address result", s => s.destination = PUNK],
  ["registry runtime", s => s.registryCode = "0x6000"], ["implementation runtime", s => s.implementationCode = "0x6000"],
  ["Agent runtime", s => s.agentCode = CODE], ["Agent token footer", s => s.agentCode = agentRecoveryProxyRuntime("94", SALT)],
  ["owner balance", s => s.ownerBalance = 1n], ["simulation", s => s.simulate = false],
  ["pending owner nonce", s => s.pendingNonce = "0x8"],
]) test(`OWNER fresh verification blocks changed ${name}`, async () => {
  const w = world(), prepared = await ownerPlan(w); mutate(w.state);
  await assert.rejects(submitAgentGasFunding(w.provider, prepared, options(w)));
  assert.equal(w.calls.some(call => call.method === "eth_sendTransaction"), false);
});
test("altered displayed amount, destination, nonce or extra transaction field cannot submit", async () => {
  for (const mutate of [p => p.amount = "0.0006", p => p.transaction.to = PUNK,
    p => p.transaction.nonce = "0x8", p => p.transaction.data = "0xdeadbeef", p => p.transaction.gas = "0x1"]) {
    const w = world(), p = JSON.parse(JSON.stringify(await ownerPlan(w))); mutate(p);
    await assert.rejects(submitAgentGasFunding(w.provider, p, options(w)));
    assert.equal(w.calls.some(call => call.method === "eth_sendTransaction"), false);
  }
});
test("OWNER's displayed nonce changing while reviewing requires a new explicit review", async () => {
  const w = world(), prepared = await ownerPlan(w); w.state.nonce = "0x8";
  await assert.rejects(submitAgentGasFunding(w.provider, prepared, options(w)), { code: "AGENT_GAS_REVIEW_CHANGED" });
});
test("ambiguous wallet result survives reload and amount/source changes without resend", async () => {
  const w = world(), prepared = await ownerPlan(w); w.state.sendError = Error("connection lost");
  await assert.rejects(submitAgentGasFunding(w.provider, prepared, options(w)), { code: "AGENT_GAS_WALLET_RESULT_UNKNOWN" });
  assert.equal(getAgentGasFundingState(OWNER, "93", { storage: w.storage }).status, "WALLET_REQUESTED");
  const changed = await prepareAgentGasFunding(w.provider, context(), "93", "PUNK", "0.0001");
  await assert.rejects(submitAgentGasFunding(w.provider, changed, options(w, { loadContext: async () => context() })), { code: "AGENT_GAS_FUNDING_PENDING" });
  assert.equal((await recheckAgentGasFunding(w.provider, OWNER, "93", options(w))).status, "WALLET_REQUESTED");
  assert.equal(w.calls.filter(call => call.method === "eth_sendTransaction").length, 1);
});
test("two tabs request funding only once under the same owner/Punk lock", async () => {
  const w = world(), prepared = await ownerPlan(w);
  const settled = await Promise.allSettled([submitAgentGasFunding(w.provider, prepared, options(w)), submitAgentGasFunding(w.provider, prepared, options(w))]);
  assert.equal(settled.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(w.calls.filter(call => call.method === "eth_sendTransaction").length, 1);
});
test("displayed review is copied before waiting for another tab", async () => {
  const w = world(), prepared = JSON.parse(JSON.stringify(await ownerPlan(w)));
  let release;
  const wait = new Promise(resolve => release = resolve);
  const attempt = submitAgentGasFunding(w.provider, prepared, options(w, {
    locks: { request: async (_key, _opts, fn) => { await wait; return fn(); } },
  }));
  prepared.amount = "0.0006"; prepared.transaction.value = "0x221b262dd8000";
  release(); await attempt;
  assert.equal(w.state.transaction.value, "0x1c6bf52634000");
});
test("missing Web Locks or unavailable durable storage prevents any wallet request", async () => {
  for (const overrides of [{ locks: null }, { storage: { getItem() { throw Error("private mode"); } } },
    { storage: { getItem() { return null; }, setItem() { throw Error("full"); } } },
    { storage: { getItem() { return null; }, setItem() {} } }]) {
    const w = world();
    await assert.rejects(submitAgentGasFunding(w.provider, await ownerPlan(w), options(w, overrides)));
    assert.equal(w.calls.some(call => call.method === "eth_sendTransaction"), false);
  }
});
test("a recoverable storage verification failure before the wallet opens does not strand a pending request", async () => {
  const w = world(), originalRead = w.storage.getItem;
  let reads = 0;
  w.storage.getItem = key => { if (++reads === 2) throw Error("temporary storage read failure"); return originalRead(key); };
  await assert.rejects(submitAgentGasFunding(w.provider, await ownerPlan(w), options(w)), { code: "AGENT_GAS_STORAGE_UNAVAILABLE" });
  assert.equal(getAgentGasFundingState(OWNER, "93", { storage: w.storage }).status, "REJECTED");
  assert.equal(w.calls.some(call => call.method === "eth_sendTransaction"), false);
  await submitAgentGasFunding(w.provider, await ownerPlan(w), options(w));
  assert.equal(w.calls.filter(call => call.method === "eth_sendTransaction").length, 1);
});
test("explicit wallet rejection permits a new user review; invalid wallet hash remains pending", async () => {
  const w = world(); w.state.sendError = Object.assign(Error("cancelled"), { code: 4001 });
  await assert.rejects(submitAgentGasFunding(w.provider, await ownerPlan(w), options(w)), { code: "AGENT_GAS_WALLET_REJECTED" });
  assert.equal(getAgentGasFundingState(OWNER, "93", { storage: w.storage }).status, "REJECTED");
  delete w.state.sendError; w.state.sendHash = "0x";
  await assert.rejects(submitAgentGasFunding(w.provider, await ownerPlan(w), options(w)), { code: "AGENT_GAS_WALLET_RESULT_UNKNOWN" });
  assert.equal(getAgentGasFundingState(OWNER, "93", { storage: w.storage }).status, "WALLET_REQUESTED");
});
test("original hash recovery saves identity before transient receipt failure and completes without send", async () => {
  const w = world(); w.state.sendError = Error("lost result");
  await assert.rejects(submitAgentGasFunding(w.provider, await ownerPlan(w), options(w)));
  w.confirm(); w.state.receiptError = true;
  await assert.rejects(recoverAgentGasFunding(w.provider, OWNER, "93", HASH, options(w)), { code: "AGENT_GAS_READ_UNAVAILABLE" });
  assert.equal(getAgentGasFundingState(OWNER, "93", { storage: w.storage }).transactionHash, HASH);
  w.state.receiptError = false;
  assert.equal((await recheckAgentGasFunding(w.provider, OWNER, "93", options(w))).status, "CONFIRMED");
  assert.equal(w.calls.filter(call => call.method === "eth_sendTransaction").length, 1);
});
test("unrelated recovered hash cannot bind a pending funding record", async () => {
  for (const field of ["from", "to", "chainId", "nonce", "value", "input", "hash"]) {
    const w = world(); w.state.sendError = Error("lost result");
    await assert.rejects(submitAgentGasFunding(w.provider, await ownerPlan(w), options(w)));
    w.state.transaction[field] = ["from", "to"].includes(field) ? PUNK
      : field === "hash" ? BLOCK_HASH : field === "input" ? "0x00" : "0x1";
    await assert.rejects(recoverAgentGasFunding(w.provider, OWNER, "93", HASH, options(w)), { code: "AGENT_GAS_TRANSACTION_MISMATCH" });
    assert.equal(getAgentGasFundingState(OWNER, "93", { storage: w.storage }).transactionHash, null);
  }
});
test("confirmation waits for canonical receipt and 12 blocks; verified revert permits a new review", async () => {
  const w = world(); await submitAgentGasFunding(w.provider, await ownerPlan(w), options(w));
  w.confirm(); w.state.head = "0x100";
  assert.equal((await recheckAgentGasFunding(w.provider, OWNER, "93", options(w))).status, "SUBMITTED");
  w.state.head = "0x10b"; w.state.blockHash = HASH;
  await assert.rejects(recheckAgentGasFunding(w.provider, OWNER, "93", options(w)), { code: "AGENT_GAS_RECEIPT_INVALID" });
  delete w.state.blockHash; w.confirm("0x0");
  assert.equal((await recheckAgentGasFunding(w.provider, OWNER, "93", options(w))).status, "REVERTED");
  w.state.nonce = "0x8"; await submitAgentGasFunding(w.provider, await ownerPlan(w), options(w));
  assert.equal(w.calls.filter(call => call.method === "eth_sendTransaction").length, 2);
});
