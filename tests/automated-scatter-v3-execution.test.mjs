import assert from "node:assert/strict";
import test from "node:test";

import { decodeFunctionData } from "viem";

import { AUTOMATED_ACCOUNT_EXECUTION_ABI } from
  "../broker/src/recommendation/automated-seadrop-v3-execution-batch.mjs";
import {
  buildAutomatedScatterV3Execution, configuredScatterTargets,
} from "../broker/src/recommendation/automated-scatter-v3-execution.mjs";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const ADAPTER = "0x2222222222222222222222222222222222222222";
const ACCOUNT = "0x3333333333333333333333333333333333333333";
const AGENT = "0x4444444444444444444444444444444444444444";
const OWNER = "0x5555555555555555555555555555555555555555";
const HASH = `0x${"11".repeat(32)}`;
const KEY = `0x${"00".repeat(31)}07`;

function target() {
  return {
    collection: COLLECTION,
    adapter: ADAPTER,
    adapterCodeHash: HASH,
    publicInviteKey: KEY,
  };
}

test("Scatter targets are explicit, exact, unique, and bounded", () => {
  assert.deepEqual(configuredScatterTargets({}), []);
  assert.deepEqual(configuredScatterTargets({
    BROKER_AUTOMATION_V3_SCATTER_TARGETS_JSON: JSON.stringify([target()]),
  }), [target()]);
  assert.deepEqual(configuredScatterTargets({
    BROKER_AUTOMATION_V3_SCATTER_TARGETS_JSON: JSON.stringify([{
      ...target(), publicInviteKey: `0x${"00".repeat(32)}`,
    }]),
  })[0].publicInviteKey, `0x${"00".repeat(32)}`);

  assert.throws(() => configuredScatterTargets({
    BROKER_AUTOMATION_V3_SCATTER_TARGETS_JSON: JSON.stringify([{
      ...target(), unknown: true,
    }]),
  }), { code: "INVALID_SCATTER_TARGETS" });
  assert.throws(() => configuredScatterTargets({
    BROKER_AUTOMATION_V3_SCATTER_TARGETS_JSON: JSON.stringify([
      target(), { ...target(), adapter: AGENT },
    ]),
  }), { code: "INVALID_SCATTER_TARGETS" });
  assert.throws(() => configuredScatterTargets({
    BROKER_AUTOMATION_V3_SCATTER_TARGETS_JSON: JSON.stringify([{
      ...target(), publicInviteKey: `0x${"00".repeat(30)}0100`,
    }]),
  }), { code: "INVALID_SCATTER_TARGETS" });
});

test("Scatter execution rebuilds one exact zero-value autonomous intent", () => {
  const transaction = buildAutomatedScatterV3Execution({
    target: target(),
    account: ACCOUNT,
    agent: AGENT,
    expectedOwner: OWNER,
    nonce: "9",
    policyVersion: "12",
    tokenId: "42",
    createdAt: "1000",
    expiresAt: "1120",
    opportunityId: `0x${"22".repeat(32)}`,
    reasoningHash: `0x${"33".repeat(32)}`,
  });
  assert.equal(transaction.from, AGENT);
  assert.equal(transaction.to, ACCOUNT);
  assert.equal(transaction.value, "0");
  const decoded = decodeFunctionData({
    abi: AUTOMATED_ACCOUNT_EXECUTION_ABI,
    data: transaction.data,
  });
  assert.equal(decoded.functionName, "executeAutonomousAcquisition");
  assert.equal(decoded.args[1], "0x");
  assert.equal(decoded.args[0].adapter, ADAPTER);
  assert.equal(decoded.args[0].venue, COLLECTION);
  assert.equal(decoded.args[0].collection, COLLECTION);
  assert.equal(decoded.args[0].tokenId, 42n);
  assert.equal(decoded.args[0].expectedPrice, 0n);
  assert.equal(decoded.args[0].maxPrice, 0n);
});

test("Scatter execution rejects accessors without invoking them", () => {
  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, "target", {
    enumerable: true,
    get() { invoked = true; return target(); },
  });
  assert.throws(
    () => buildAutomatedScatterV3Execution(hostile),
    { code: "INVALID_SCATTER_EXECUTION" },
  );
  assert.equal(invoked, false);
});
