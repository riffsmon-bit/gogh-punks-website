import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assignedAutomationV3AgentLane,
  automationV3AgentLane,
  automationV3LaneEnvironment,
  automationV3LaneLockId,
  configuredAutomationV3AgentLanes,
  LEGACY_AUTOMATION_V3_AGENT,
} from "../netlify/functions/_shared/automation-v3-agent-pool.mjs";
import { runScheduledAutomationV3Lane } from
  "../netlify/functions/_shared/automation-v3-lane-handler.mjs";

const ADDRESSES = Object.freeze([
  LEGACY_AUTOMATION_V3_AGENT,
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
  "0x4444444444444444444444444444444444444444",
  "0x5555555555555555555555555555555555555555",
]);

function environment() {
  const result = {
    BROKER_AUTOMATION_V3_ENABLED: "true",
    BROKER_AUTOMATION_V3_AGENT_ADDRESS: ADDRESSES[0],
    BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY: `0x${"a".repeat(64)}`,
    BROKER_AUTOMATION_V3_AGENT_POOL_ENABLED: "true",
  };
  for (let lane = 2; lane <= 6; lane += 1) {
    result[`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_ADDRESS`] = ADDRESSES[lane - 1];
    result[`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_PRIVATE_KEY`] =
      `0x${String(lane).repeat(64)}`;
    result[`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_ENABLED`] = "true";
  }
  return result;
}

test("six configured lanes require six distinct signer addresses", () => {
  const lanes = configuredAutomationV3AgentLanes(environment());
  assert.equal(lanes.length, 6);
  assert.deepEqual(lanes.map(({ address }) => address), ADDRESSES);
  assert.equal(lanes[5].priority, true);

  const duplicate = environment();
  duplicate.BROKER_AUTOMATION_V3_AGENT_LANE_5_ADDRESS = ADDRESSES[1];
  assert.throws(() => configuredAutomationV3AgentLanes(duplicate), /distinct signer/);
});

test("regular Punk assignment excludes the dedicated priority lane", () => {
  const counts = new Map();
  for (let tokenId = 0; tokenId < 25; tokenId += 1) {
    const laneId = assignedAutomationV3AgentLane(tokenId, environment()).laneId;
    counts.set(laneId, (counts.get(laneId) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5 });
  assert.equal(counts.has(6), false);
});

test("lane environment remaps only the reviewed worker signer binding", () => {
  const base = environment();
  const selected = automationV3LaneEnvironment(base, 4);
  assert.equal(selected.BROKER_AUTOMATION_V3_AGENT_ADDRESS, ADDRESSES[3]);
  assert.equal(selected.BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY,
    base.BROKER_AUTOMATION_V3_AGENT_LANE_4_PRIVATE_KEY);
  assert.equal(selected.BROKER_AUTOMATION_V3_ACTIVE_LANE, "4");
  assert.equal(automationV3AgentLane(base, 4).laneId, 4);
});

test("new lanes remain disabled unless the pool and lane are explicitly enabled", () => {
  const base = environment();
  delete base.BROKER_AUTOMATION_V3_AGENT_POOL_ENABLED;
  assert.deepEqual(configuredAutomationV3AgentLanes(base).map(({ laneId }) => laneId), [1]);
});

test("enabled lanes fail closed without their own address and private key", () => {
  const missingAddress = environment();
  delete missingAddress.BROKER_AUTOMATION_V3_AGENT_LANE_3_ADDRESS;
  assert.throws(() => configuredAutomationV3AgentLanes(missingAddress),
    /lane 3 address is required/);

  const missingKey = environment();
  delete missingKey.BROKER_AUTOMATION_V3_AGENT_LANE_4_PRIVATE_KEY;
  assert.equal(configuredAutomationV3AgentLanes(missingKey).length, 6,
    "read-only public routing may omit production-only secrets");
  assert.throws(() => configuredAutomationV3AgentLanes(missingKey,
    { requirePrivateKeys: true }),
    /lane 4 private key is invalid/);
  assert.throws(() => automationV3LaneEnvironment(missingKey, 4),
    /lane 4 private key is invalid/);

  const priorityOnly = environment();
  priorityOnly.BROKER_AUTOMATION_V3_ENABLED = "false";
  for (let lane = 2; lane <= 5; lane += 1) {
    priorityOnly[`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_ENABLED`] = "false";
  }
  assert.throws(() => assignedAutomationV3AgentLane("93", priorityOnly),
    /No regular automation V3 signer lane/);
});

test("disabled regular lanes are excluded without changing enabled-lane balance", () => {
  const base = environment();
  base.BROKER_AUTOMATION_V3_AGENT_LANE_3_ENABLED = "false";
  const counts = new Map();
  for (let tokenId = 0; tokenId < 20; tokenId += 1) {
    const laneId = assignedAutomationV3AgentLane(tokenId, base).laneId;
    counts.set(laneId, (counts.get(laneId) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), { 1: 5, 2: 5, 4: 5, 5: 5 });
  assert.equal(counts.has(3), false);
  assert.equal(counts.has(6), false);
});

test("worker lane leases preserve the production lock and remain isolated", () => {
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => automationV3LaneLockId(index + 1)),
    [46_630_003, 46_630_004, 46_630_005, 46_630_006, 46_630_007, 46_630_008],
  );
});

test("every lane has a distinct key variable and scheduled invocation", async () => {
  const lanes = configuredAutomationV3AgentLanes(environment(), { requirePrivateKeys: true });
  assert.equal(new Set(lanes.map(({ keyName }) => keyName)).size, 6);
  const files = [
    "../netlify/functions/broker-autonomy-v3-worker.mjs",
    ...Array.from({ length: 4 }, (_, index) =>
      `../netlify/functions/broker-autonomy-v3-worker-lane-${index + 2}.mjs`),
  ];
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url),
    "utf8")));
  sources.forEach((source, index) => {
    assert.match(source, /schedule:\s*"[^"]+"/);
    if (index > 0) assert.match(source, new RegExp(`runScheduledAutomationV3Lane\\(${index + 1}\\)`));
  });
  const priority = await readFile(new URL(
    "../netlify/functions/broker-autonomy-v3-priority-worker.mjs", import.meta.url,
  ), "utf8");
  assert.match(priority, /schedule:\s*"\* \* \* \* \*"/);
});

test("a scheduled lane passes only its own signer binding to the worker", async () => {
  const calls = [];
  const result = await runScheduledAutomationV3Lane(5, {
    environment: { ...environment(), CONTEXT: "production" },
    runOnce: async (options) => {
      calls.push(options);
      return { status: "NO_ELIGIBLE_TARGETS", submitted: 0 };
    },
  });
  assert.equal(result.laneId, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].laneId, 5);
  assert.equal(calls[0].environment.BROKER_AUTOMATION_V3_AGENT_ADDRESS, ADDRESSES[4]);
  assert.equal(calls[0].environment.BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY,
    environment().BROKER_AUTOMATION_V3_AGENT_LANE_5_PRIVATE_KEY);
  assert.equal(calls[0].environment.BROKER_AUTOMATION_V3_ACTIVE_LANE, "5");
});
