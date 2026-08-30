import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATION_V3_AGENT, readAutomationV3AgentDisplayState, readAutomationV3GlobalState,
} from "../netlify/functions/_shared/autonomy-v3-live.mjs";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const SEA_DROP = "0x00005ea00ac477b1030ce78506496e8c2de24bf5";

function globalClient(head, unpinnedBalance) {
  const requests = [];
  return {
    requests,
    async getBlockNumber() { return head; },
    async readContract(request) {
      requests.push(request);
      if (request.functionName === "adapterRecord") {
        return [1, true, SEA_DROP, ZERO_HASH, ZERO_HASH, ZERO_HASH, ZERO_HASH];
      }
      if (request.functionName === "featureFlags") {
        return [true, false, true, true, true, false, false];
      }
      if (request.functionName === "globalAgent") {
        return [true, 0n, 9_999_999_999n, ZERO_HASH, ZERO_HASH];
      }
      if (request.functionName === "globallyPaused") return false;
      throw new Error(`unexpected read ${request.functionName}`);
    },
    async getCode(request) {
      requests.push(request);
      return request.address.toLowerCase() === AUTOMATION_V3_AGENT ? "0x" : "0x01";
    },
    async getBalance(request) {
      requests.push(request);
      return request.blockNumber === undefined ? unpinnedBalance : 100n;
    },
  };
}

test("V3 global evidence compares both providers at one common confirmed block", async () => {
  const first = globalClient(100n, 101n);
  const second = globalClient(104n, 99n);
  const state = await readAutomationV3GlobalState({
    BROKER_AUTOMATION_V3_ENABLED: "false",
    ROBINHOOD_RPC_URL: "https://primary.example",
    ROBINHOOD_SECONDARY_RPC_URL: "https://secondary.example",
  }, { clients: [first, second], nowSeconds: 1_000 });
  assert.equal(state.agent.balanceWei, "100");
  assert.ok([...first.requests, ...second.requests].every(({ blockNumber }) => (
    blockNumber === 98n
  )));
});

test("V3 advisory agent display uses one lightweight provider without global reads", async () => {
  const requests = [];
  const state = await readAutomationV3AgentDisplayState({
    ROBINHOOD_RPC_URL: "https://primary.example",
    ROBINHOOD_SECONDARY_RPC_URL: "https://secondary.example",
  }, { client: {
    async getCode(request) { requests.push(["code", request]); return "0x"; },
    async getBalance(request) { requests.push(["balance", request]); return 123n; },
  } });
  assert.deepEqual(state, {
    address: AUTOMATION_V3_AGENT,
    validUntil: null,
    balanceWei: "123",
    codeFree: true,
  });
  assert.deepEqual(requests.map(([method]) => method), ["code", "balance"]);
});
