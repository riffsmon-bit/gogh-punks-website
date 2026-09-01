import assert from "node:assert/strict";
import test from "node:test";

import { ROBINHOOD } from "../broker/src/config.mjs";
import { buildAutomatedSeaDropV3OwnerSetup } from
  "../broker/src/recommendation/automated-seadrop-v3-owner-setup.mjs";
import { assembleLiveOwnerSetupInput, selectAutomationV3OwnerSetupLane } from
  "../netlify/functions/_shared/autonomy-v3-live.mjs";
import {
  ownerSetupArtifactBuilderAvailable,
  ownerSetupTransactionAvailable,
} from "../netlify/functions/broker-autonomy-v3-status.mjs";

const nowSeconds = 1_800_000_000;
const A = (digit) => `0x${digit.repeat(40)}`;

function poolEnvironment() {
  const environment = {
    BROKER_AUTOMATION_V3_ENABLED: "true",
    BROKER_AUTOMATION_V3_AGENT_ADDRESS: A("a"),
    BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY: `0x${"a".repeat(64)}`,
    BROKER_AUTOMATION_V3_AGENT_POOL_ENABLED: "true",
  };
  for (let lane = 2; lane <= 6; lane += 1) {
    environment[`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_ADDRESS`] = A(String(lane));
    environment[`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_PRIVATE_KEY`] =
      `0x${String(lane).repeat(64)}`;
    environment[`BROKER_AUTOMATION_V3_AGENT_LANE_${lane}_ENABLED`] = "true";
  }
  return environment;
}

test("live V3 owner setup input satisfies the strict owner-setup schema", () => {
  const input = assembleLiveOwnerSetupInput({
    tokenId: "93",
    checkedAt: new Date(nowSeconds * 1_000).toISOString(),
    owner: A("1"),
    account: A("2"),
    accountCreated: true,
    registry: A("3"),
    lane: { address: A("4"), laneId: "lane-4" },
    global: {
      agent: {
        validAfter: String(nowSeconds - 1),
        validUntil: String(nowSeconds + (31 * 86_400)),
      },
    },
  }, { maxMintsPerUtcDay: 3, authorizationDays: 7 });

  assert.equal(input.punk.collection, ROBINHOOD.canonicalCollection);
  assert.deepEqual(Object.keys(input.infrastructure).sort(), [
    "accountRegistry", "agent", "agentRegistry", "policyModule",
  ]);
  assert.equal("agentLane" in input.infrastructure, false);

  const artifact = buildAutomatedSeaDropV3OwnerSetup(input, { nowSeconds });
  assert.equal(artifact.schema, "GOGH_AUTOMATED_SEADROP_V3_OWNER_SETUP_V1");
  assert.equal(artifact.punk.tokenId, "93");
  assert.equal(artifact.setupTransactions.length, 2);
});

test("V3 status advertises owner setup only when artifact construction is healthy", () => {
  assert.equal(ownerSetupArtifactBuilderAvailable(nowSeconds * 1_000), true);
  assert.equal(ownerSetupTransactionAvailable(true, true), true);
  assert.equal(ownerSetupTransactionAvailable(true, false), false);
  assert.equal(ownerSetupTransactionAvailable(false, true), false);
});

test("owner setup reuses a persisted regular lane and never probes another signer", async () => {
  let reads = 0;
  const selected = await selectAutomationV3OwnerSetupLane("93", poolEnvironment(), {
    assignment: async () => ({ tokenId: "93", lane: 3, agent: A("3") }),
    readPunk: async () => { reads += 1; },
  });
  assert.equal(selected.lane.laneId, 3);
  assert.equal(selected.lane.address, A("3"));
  assert.equal(selected.assigned, true);
  assert.equal(reads, 0);
});

test("owner setup modulo assignment excludes the priority lane", async () => {
  const selected = await selectAutomationV3OwnerSetupLane("99", poolEnvironment(), {
    assignment: async () => null,
    readPunk: async () => ({ active: false }),
  });
  assert.equal(selected.lane.laneId, 5);
  assert.equal(selected.lane.priority, false);
});

test("production owner setup fails closed before authorizing an enabled lane without its signer", async () => {
  const environment = poolEnvironment();
  environment.CONTEXT = "production";
  delete environment.BROKER_AUTOMATION_V3_AGENT_LANE_4_PRIVATE_KEY;
  await assert.rejects(
    () => selectAutomationV3OwnerSetupLane("93", environment, {
      assignment: async () => null,
      readPunk: async () => ({ active: false }),
    }),
    /lane 4 private key is invalid/,
  );
});
