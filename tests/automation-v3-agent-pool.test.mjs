import assert from "node:assert/strict";
import test from "node:test";

import {
  assignedAutomationV3AgentLane,
  automationV3AgentLane,
  automationV3LaneEnvironment,
  configuredAutomationV3AgentLanes,
  LEGACY_AUTOMATION_V3_AGENT,
} from "../netlify/functions/_shared/automation-v3-agent-pool.mjs";

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
  const selected = new Set();
  for (let tokenId = 0; tokenId < 50; tokenId += 1) {
    selected.add(assignedAutomationV3AgentLane(tokenId, environment()).laneId);
  }
  assert.deepEqual([...selected].sort(), [1, 2, 3, 4, 5]);
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
