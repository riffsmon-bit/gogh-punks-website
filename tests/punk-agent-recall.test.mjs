import assert from "node:assert/strict";
import test from "node:test";
import { toFunctionSelector } from "viem";
import { createPunkRecall } from "../site/punk-agent-recall.js";
import { punkChatAction } from "../site/punk-chat-actions.js";

const owner = `0x${"1".repeat(40)}`, account = `0x${"2".repeat(40)}`;
const hash = `0x${"3".repeat(64)}`;
const revoke = toFunctionSelector("revokeAutonomousSession()");
function fixture() {
  const calls = [], controller = createPunkRecall();
  const status = { ok: true, tokenId: "93", owner, readiness: { databaseReady: true },
    runtime: { accountCreated: true, account, sessionActive: true },
    mission: { status: "ACTIVE", sessionId: "session-93" } };
  const options = { owner, tokenId: "93", isCurrent: () => true,
    readStatus: async () => { calls.push("live status"); return status; },
    request: async (path, body) => {
      calls.push(body.action);
      if (body.action === "pause") {
        assert.equal(path, "/api/v2/punks/93/strategy");
        return { ok: true, strategy: { state: "PAUSED" } };
      }
      assert.equal(path, "/api/v2/agent-account/recall");
      assert.equal(body.owner, owner); assert.equal(body.tokenId, "93");
      if (body.action === "prepare") return { ok: true, tokenId: "93", sessionId: "session-93",
        transaction: { from: owner, to: account, value: "0x0", data: revoke } };
      assert.equal(body.transactionHash, hash);
      return { ok: true, tokenId: "93", sessionId: "session-93", status: "REVOKED",
        strategyPaused: true, transactionHash: hash };
    },
    provider: { request: async ({ method, params }) => {
      calls.push(method);
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_accounts") return [owner];
      assert.equal(method, "eth_sendTransaction");
      assert.deepEqual(params, [{ from: owner, to: account, value: "0x0", data: revoke }]);
      return hash;
    } },
    waitForReceipt: async (_provider, transactionHash) => {
      assert.equal(transactionHash, hash); calls.push("receipt");
    }, onSubmitted: transactionHash => { assert.equal(transactionHash, hash); calls.push("submitted"); },
  };
  return { calls, controller, status, options };
}

test("both reported commands revoke the freshly read live session and confirm its receipt", async () => {
  for (const message of ["ok recall please", "Pause for tonight."]) {
    assert.equal(punkChatAction(message)?.kind, "RECALL");
    const { controller, calls, options } = fixture();
    assert.deepEqual(await controller.run(options), { status: "REVOKED", tokenId: "93", transactionHash: hash });
    assert.deepEqual(calls, ["live status", "prepare", "eth_chainId", "eth_accounts",
      "eth_sendTransaction", "submitted", "receipt", "confirm"]);
  }
});
test("a paused or expired database session still takes the revocation path", async () => {
  for (const value of ["PAUSED", "EXPIRED", "INACTIVE"]) {
    const { controller, status, options, calls } = fixture();
    status.mission.status = value; status.runtime.sessionActive = false;
    assert.equal((await controller.run(options)).status, "REVOKED");
    assert.ok(!calls.includes("pause"));
  }
});
test("missing RPC, database, or identity evidence cannot fall back to strategy pause", async () => {
  for (const mutate of [() => null, s => ({ ...s, tokenId: "44" }), s => ({ ...s, owner: account }),
    s => ({ ...s, readiness: { databaseReady: false } }), s => ({ ...s, runtime: null })]) {
    const { controller, status, options, calls } = fixture();
    options.readStatus = async () => mutate(status);
    await assert.rejects(controller.run(options), /couldn’t verify/);
    assert.deepEqual(calls, []);
  }
});
test("a verified absent session pauses only the strategy, without a wallet transaction", async () => {
  const { controller, status, options, calls } = fixture();
  status.runtime.sessionActive = false; status.mission = null;
  assert.equal((await controller.run(options)).status, "PAUSED");
  assert.deepEqual(calls, ["live status", "pause"]);
});
test("duplicate requests cannot open a second wallet prompt", async () => {
  const { controller, options, calls } = fixture();
  const original = options.readStatus;
  let finish;
  options.readStatus = () => new Promise(resolve => { finish = () => resolve(original()); });
  const first = controller.run(options);
  assert.equal(controller.busy, true);
  assert.deepEqual(await controller.run(options), { status: "BUSY" });
  finish(); await first;
  assert.equal(calls.filter(c => c === "eth_sendTransaction").length, 1);
  assert.equal(controller.busy, false);
});
test("owner, Punk or network changes before the wallet request abort recall", async () => {
  for (const stage of ["live status", "prepare", "eth_accounts"]) {
    const { controller, options, calls } = fixture();
    options.isCurrent = () => !calls.includes(stage);
    await assert.rejects(controller.run(options), /changed/);
    assert.ok(!calls.includes("eth_sendTransaction"));
  }
});
test("wrong wallet chain or owner never submits", async () => {
  for (const badMethod of ["eth_chainId", "eth_accounts"]) {
    const { controller, options, calls } = fixture();
    const original = options.provider.request;
    options.provider.request = args => args.method === badMethod
      ? Promise.resolve(badMethod === "eth_chainId" ? "0x1" : [account]) : original(args);
    await assert.rejects(controller.run(options), /Connect the Punk owner/);
    assert.ok(!calls.includes("eth_sendTransaction"));
  }
});
test("a mismatched prepared transaction cannot reach the wallet", async () => {
  for (const change of [{ from: account }, { to: owner }, { value: "0x1" }, { data: "0x12345678" }]) {
    const { controller, options, calls } = fixture();
    const original = options.request;
    options.request = async (...args) => {
      const result = await original(...args); Object.assign(result.transaction, change); return result;
    };
    await assert.rejects(controller.run(options), /does not match/);
    assert.ok(!calls.includes("eth_sendTransaction"));
  }
});
test("wallet rejection never pauses or confirms and releases the busy state", async () => {
  const { controller, options, calls } = fixture();
  const original = options.provider.request;
  options.provider.request = args => args.method === "eth_sendTransaction"
    ? Promise.reject(new Error("User rejected request")) : original(args);
  await assert.rejects(controller.run(options), /User rejected/);
  assert.equal(controller.busy, false);
  assert.ok(!calls.includes("pause") && !calls.includes("confirm"));
});
test("receipt and reconciliation failures retain the original hash without reporting success", async () => {
  for (const stage of ["receipt", "confirm"]) {
    const { controller, options, calls } = fixture();
    if (stage === "receipt") options.waitForReceipt = async () => { throw new Error("RPC unavailable"); };
    else {
      const original = options.request;
      options.request = (path, body) => body.action === "confirm"
        ? Promise.resolve({ ok: true, status: "ACTIVE" }) : original(path, body);
    }
    await assert.rejects(controller.run(options), error => error.transactionHash === hash);
    assert.ok(!calls.includes("pause"));
    assert.equal(calls.filter(c => c === "eth_sendTransaction").length, 1);
  }
});
