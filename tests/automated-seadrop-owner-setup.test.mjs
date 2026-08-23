import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATED_OWNER_SETUP_INPUT_SCHEMA,
  AUTOMATED_OWNER_SETUP_SCHEMA,
  buildAutomatedSeaDropOwnerSetup,
} from "../broker/src/recommendation/automated-seadrop-owner-setup.mjs";
import { ROBINHOOD } from "../broker/src/config.mjs";

const now = 1_800_000_000;
const A = (digit) => `0x${digit.repeat(40)}`;

function fixture() {
  return {
    schema: AUTOMATED_OWNER_SETUP_INPUT_SCHEMA,
    version: 1,
    chainId: 4663,
    checkedAt: new Date((now - 2) * 1000).toISOString(),
    punk: {
      tokenId: "4242", collection: ROBINHOOD.canonicalCollection,
      expectedOwner: A("1"), account: A("2"), accountCreated: false,
    },
    infrastructure: {
      accountRegistry: A("3"), policyModule: A("4"), agentRegistry: A("5"), agent: A("6"),
    },
    limits: { maxMintsPerUtcDay: 3, authorizationDays: 7 },
    globalAgent: {
      approved: true, validAfter: String(now - 60), validUntil: String(now + (31 * 86_400)),
    },
  };
}

test("encodes the exact three-step setup and disable-first two-step stop", () => {
  const artifact = buildAutomatedSeaDropOwnerSetup(fixture(), { nowSeconds: now });
  assert.equal(artifact.schema, AUTOMATED_OWNER_SETUP_SCHEMA);
  assert.deepEqual(artifact.setupTransactions.map((item) => item.functionName), [
    "createAccount", "configureAutomatedSeaDropPolicy", "authorizeAgent",
  ]);
  assert.deepEqual(artifact.stopTransactions.map((item) => item.functionName), [
    "disableAutomatedSeaDropPolicy", "revokeAgent",
  ]);
  assert.equal(artifact.safety.walletPopupPerMintRequiredAfterSetup, false);
  assert.equal(artifact.safety.setupIsAtomic, false);
  assert.equal(artifact.safety.submissionPerformed, false);
  for (const tx of [...artifact.setupTransactions, ...artifact.stopTransactions]) {
    assert.equal(tx.from, fixture().punk.expectedOwner.toLowerCase());
    assert.equal(tx.value, "0");
    assert.match(tx.dataKeccak256, /^0x[0-9a-f]{64}$/);
  }
  assert.ok(Object.isFrozen(artifact));
});

test("omits activation only when the fresh evidence proves the V2 account exists", () => {
  const input = fixture();
  input.punk.accountCreated = true;
  const artifact = buildAutomatedSeaDropOwnerSetup(input, { nowSeconds: now });
  assert.deepEqual(artifact.setupTransactions.map((item) => item.functionName), [
    "configureAutomatedSeaDropPolicy", "authorizeAgent",
  ]);
});

test("rejects unsafe caps, stale evidence, expired agents, role collisions, and hostile input", () => {
  const mutations = [
    (value) => { value.limits.maxMintsPerUtcDay = 2; },
    (value) => { value.checkedAt = new Date((now - 31) * 1000).toISOString(); },
    (value) => { value.globalAgent.validUntil = String(now + 60); },
    (value) => { value.infrastructure.agent = value.punk.expectedOwner; },
    (value) => { value.chainId = 1; },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    assert.throws(() => buildAutomatedSeaDropOwnerSetup(input, { nowSeconds: now }));
  }

  let invoked = 0;
  const hostile = fixture();
  Object.defineProperty(hostile.limits, "authorizationDays", {
    enumerable: true, get() { invoked += 1; return 7; },
  });
  assert.throws(() => buildAutomatedSeaDropOwnerSetup(hostile, { nowSeconds: now }), {
    code: "INVALID_JSON",
  });
  assert.equal(invoked, 0);
});
