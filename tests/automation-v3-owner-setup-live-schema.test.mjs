import assert from "node:assert/strict";
import test from "node:test";

import { ROBINHOOD } from "../broker/src/config.mjs";
import { buildAutomatedSeaDropV3OwnerSetup } from
  "../broker/src/recommendation/automated-seadrop-v3-owner-setup.mjs";
import { assembleLiveOwnerSetupInput } from
  "../netlify/functions/_shared/autonomy-v3-live.mjs";
import {
  ownerSetupArtifactBuilderAvailable,
  ownerSetupTransactionAvailable,
} from "../netlify/functions/broker-autonomy-v3-status.mjs";

const nowSeconds = 1_800_000_000;
const A = (digit) => `0x${digit.repeat(40)}`;

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
