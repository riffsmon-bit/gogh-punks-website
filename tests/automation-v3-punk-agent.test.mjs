import assert from "node:assert/strict";
import test from "node:test";

import { resolveAutomationV3PunkAgent } from
  "../netlify/functions/_shared/automation-v3-punk-agent.mjs";
import { LEGACY_AUTOMATION_V3_AGENT } from
  "../netlify/functions/_shared/automation-v3-agent-pool.mjs";

const ADDRESSES = [
  LEGACY_AUTOMATION_V3_AGENT,
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
  "0x4444444444444444444444444444444444444444",
  "0x5555555555555555555555555555555555555555",
];

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

function punk(tokenId, agent, active = true) {
  return Object.freeze({ tokenId: String(tokenId), created: true, active,
    authorization: { agent } });
}

test("a persisted Punk assignment is sticky and only reads its exact lane", async () => {
  const reads = [];
  const result = await resolveAutomationV3PunkAgent("93", environment(), {
    assignment: async () => ({ tokenId: "93", lane: 4, agent: ADDRESSES[3] }),
    readPunk: async (tokenId, agent) => {
      reads.push(agent);
      return punk(tokenId, agent);
    },
  });
  assert.equal(result.assigned, true);
  assert.equal(result.lane.laneId, 4);
  assert.deepEqual(reads, [ADDRESSES[3]]);
});

test("an unavailable persisted assignment fails without falling back to lane 1", async () => {
  const base = environment();
  base.BROKER_AUTOMATION_V3_AGENT_LANE_4_ENABLED = "false";
  let reads = 0;
  await assert.rejects(() => resolveAutomationV3PunkAgent("93", base, {
    assignment: async () => ({ tokenId: "93", lane: 4, agent: ADDRESSES[3] }),
    readPunk: async () => { reads += 1; },
  }), (error) => error.code === "PUNK_AGENT_LANE_UNAVAILABLE");
  assert.equal(reads, 0);
});

test("an unassigned legacy authorization is adopted before modulo assignment", async () => {
  const reads = [];
  const result = await resolveAutomationV3PunkAgent("93", environment(), {
    assignment: async () => null,
    readPunk: async (tokenId, agent) => {
      reads.push(agent);
      return punk(tokenId, agent, agent === LEGACY_AUTOMATION_V3_AGENT);
    },
  });
  assert.equal(result.assigned, false);
  assert.equal(result.lane.laneId, 1);
  assert.equal(reads.includes(ADDRESSES[5]), false);
});
