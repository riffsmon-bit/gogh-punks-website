import assert from "node:assert/strict";
import test from "node:test";
import {
  submitOwnerSetupTransactions, submitOwnerStopTransactions, validateOwnerSetupArtifact,
} from "../site/owner-agent-activation.js";

const A = (digit) => `0x${digit.repeat(40)}`;
const owner = A("1");
const transaction = Object.freeze({ purpose: "AUTHORIZE_PUBLISHED_AGENT", from: owner,
  to: A("2"), value: "0", data: `0x${"12".repeat(36)}` });
const stopTransaction = Object.freeze({ purpose: "REVOKE_PUBLISHED_AGENT", from: owner,
  to: A("3"), value: "0x0", data: `0x${"34".repeat(36)}` });
const artifact = Object.freeze({ punk: { tokenId: "93", expectedOwner: owner },
  setupTransactions: [transaction], stopTransactions: [stopTransaction] });

test("owner activation rejects plans that do not bind the selected Punk and owner", () => {
  assert.throws(() => validateOwnerSetupArtifact(artifact, { tokenId: "94", owner }),
    /did not match/);
  assert.throws(() => validateOwnerSetupArtifact({ ...artifact,
    setupTransactions: [{ ...transaction, value: "1" }] }, { tokenId: "93", owner }),
  /transaction was invalid/);
});

test("owner activation simulates and sends only the reviewed exact transaction", async () => {
  const calls = [];
  const provider = { async request(call) {
    calls.push(call);
    if (call.method === "eth_chainId") return "0x1237";
    if (call.method === "eth_requestAccounts" || call.method === "eth_accounts") return [owner];
    if (call.method === "eth_call") return "0x";
    if (call.method === "eth_sendTransaction") return `0x${"ab".repeat(32)}`;
    throw new Error(`unexpected ${call.method}`);
  } };
  const progress = [];
  const result = await submitOwnerSetupTransactions(provider, artifact,
    { tokenId: "93", owner }, {
      waitForReceipt: async () => ({ status: "0x1" }),
      isCurrent: () => true,
      onProgress: (event) => progress.push(event.phase),
    });
  assert.equal(result.hashes.length, 1);
  const simulation = calls.find((call) => call.method === "eth_call");
  const send = calls.find((call) => call.method === "eth_sendTransaction");
  assert.deepEqual(simulation.params[0], { from: owner, to: A("2"), value: "0x0",
    data: transaction.data });
  assert.deepEqual(send.params[0], simulation.params[0]);
  assert.deepEqual(Object.keys(send.params[0]).sort(), ["data", "from", "to", "value"]);
  assert.deepEqual(progress, ["wallet", "confirming", "confirmed"]);
});

test("owner activation stops before simulation when account identity changes", async () => {
  let accountsReads = 0;
  const methods = [];
  const provider = { async request(call) {
    methods.push(call.method);
    if (call.method === "eth_chainId") return "0x1237";
    if (call.method === "eth_requestAccounts") return [owner];
    if (call.method === "eth_accounts") {
      accountsReads += 1;
      return accountsReads ? [A("3")] : [owner];
    }
    throw new Error(`unexpected ${call.method}`);
  } };
  await assert.rejects(submitOwnerSetupTransactions(provider, artifact,
    { tokenId: "93", owner }), /changed during activation/);
  assert.equal(methods.includes("eth_call"), false);
  assert.equal(methods.includes("eth_sendTransaction"), false);
});

test("owner activation never sends when exact simulation fails", async () => {
  const methods = [];
  const provider = { async request(call) {
    methods.push(call.method);
    if (call.method === "eth_chainId") return "0x1237";
    if (call.method === "eth_requestAccounts" || call.method === "eth_accounts") return [owner];
    if (call.method === "eth_call") throw new Error("simulation reverted");
    throw new Error(`unexpected ${call.method}`);
  } };
  await assert.rejects(submitOwnerSetupTransactions(provider, artifact,
    { tokenId: "93", owner }), /simulation reverted/);
  assert.equal(methods.includes("eth_sendTransaction"), false);
});

test("owner stop simulates and sends only the server-reviewed stop transaction", async () => {
  const calls = [];
  const provider = { async request(call) {
    calls.push(call);
    if (call.method === "eth_chainId") return "0x1237";
    if (call.method === "eth_requestAccounts" || call.method === "eth_accounts") return [owner];
    if (call.method === "eth_call") return "0x";
    if (call.method === "eth_sendTransaction") return `0x${"cd".repeat(32)}`;
    throw new Error(`unexpected ${call.method}`);
  } };
  const labels = [];
  const result = await submitOwnerStopTransactions(provider, artifact,
    { tokenId: "93", owner }, {
      waitForReceipt: async () => ({ status: "0x1" }),
      isCurrent: () => true,
      onProgress: (event) => labels.push(event.label),
    });
  assert.equal(result.hashes.length, 1);
  const simulation = calls.find((call) => call.method === "eth_call");
  const send = calls.find((call) => call.method === "eth_sendTransaction");
  assert.deepEqual(send.params[0], simulation.params[0]);
  assert.equal(send.params[0].to, stopTransaction.to);
  assert.equal(send.params[0].data, stopTransaction.data);
  assert.deepEqual(labels, ["stop", "stop", "stop"]);
});

test("owner stop rejects hostile value before opening the wallet", async () => {
  const hostile = { ...artifact, stopTransactions: [{ ...stopTransaction, value: "1" }] };
  await assert.rejects(submitOwnerStopTransactions({ request() {
    throw new Error("provider should not be called");
  } }, hostile, { tokenId: "93", owner }), /stop transaction was invalid/);
});
