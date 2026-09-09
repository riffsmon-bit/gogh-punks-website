import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { decodeFunctionData, keccak256, parseAbi, toFunctionSelector } from "viem";
import { prepareAgentGasFunding, submitAgentGasFunding } from "../site/punk-agent-gas-funding.js";

const OWNER = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6";
const PUNK = "0x06d5e0df2eb9512777403bf017031618f4713e19";
const AGENT = "0xcadcfd37e715bc031cf0cec7fa2335091c878c83";
const REGISTRY = "0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844";
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const CODE = "0x6001600055";
const HASH = `0x${"ab".repeat(32)}`;
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
  const state = { owner: OWNER, chain: "0x1237", balance: 1200000000000000n, destination: AGENT, simulate: true };
  const provider = { request: async ({ method, params }) => {
    calls.push({ method, params });
    if (method === "eth_chainId") return state.chain;
    if (method === "eth_accounts") return [state.owner];
    if (method === "eth_getBalance") return `0x${state.balance.toString(16)}`;
    if (method === "eth_getCode") return CODE;
    if (method === "eth_estimateGas") return "0x10000";
    if (method === "eth_sendTransaction") return HASH;
    if (method === "eth_call") {
      const tx = params[0];
      if (tx.to === REGISTRY) {
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
  return { calls, state, provider };
}
test("existing Punk ETH uses one owner execute with exact registered destination and zero outer value", async () => {
  const w = world(); const p = await prepareAgentGasFunding(w.provider, context(), "93", "PUNK", "0.0005");
  assert.equal(p.transaction.from, OWNER); assert.equal(p.transaction.to, PUNK); assert.equal(p.transaction.value, "0x0");
  const decoded = decodeFunctionData({ abi: parseAbi(["function execute(address,uint256,bytes,uint8) returns (bytes)"]), data: p.transaction.data });
  assert.equal(decoded.args[0].toLowerCase(), AGENT); assert.equal(decoded.args[1], 500000000000000n);
  assert.equal(decoded.args[2], "0x"); assert.equal(decoded.args[3], 0);
  assert.equal(w.calls.some(c => c.method === "eth_sendTransaction"), false);
  await submitAgentGasFunding(w.provider, p, { loadContext: async () => context(), isCurrent: () => true });
  assert.equal(w.calls.filter(c => c.method === "eth_sendTransaction").length, 1);
});
test("owner funding deposits directly without executing from the Punk", async () => {
  const w = world(); const p = await prepareAgentGasFunding(w.provider, context(), "93", "OWNER", "0.0005");
  assert.deepEqual(p.transaction, { from: OWNER, to: AGENT, value: "0x1c6bf52634000", data: "0x" });
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
    await assert.rejects(submitAgentGasFunding(w.provider, p, { loadContext: async () => c, isCurrent: () => kind !== "selection" }));
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
