import assert from "node:assert/strict";
import test from "node:test";

import {
  runPunkPriorityWorker,
} from "../netlify/functions/broker-autonomy-v3-priority-worker.mjs";

const SESSION = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  tokenId: "93",
  owner: "0x1111111111111111111111111111111111111111",
  requestedMints: 3,
  completedMints: 0,
  durationDays: 7,
  startsAt: "2026-08-31T12:00:00.000Z",
  expiresAt: "2026-09-07T12:00:00.000Z",
  agent: "0x3bb2ebf6b3c4d7f5e5781cdf2091428f7750af7d",
});

const ENVIRONMENT = Object.freeze({
  CONTEXT: "production",
  BROKER_AUTOMATION_V3_ENABLED: "true",
  BROKER_AUTOMATION_V3_AGENT_ADDRESS:
    "0x3bb2ebf6b3c4d7f5e5781cdf2091428f7750af7d",
  BROKER_AUTOMATION_V3_AGENT_PRIVATE_KEY: `0x${"a".repeat(64)}`,
});

test("priority worker performs no chain work when no Punk priority session is due", async () => {
  let ran = false;
  const result = await runPunkPriorityWorker({
    environment: {},
    nextSession: async () => null,
    runOnce: async () => { ran = true; },
  });
  assert.deepEqual(result, { status: "NO_PRIORITY_SESSIONS", submitted: 0 });
  assert.equal(ran, false);
});

test("priority worker sends exactly the due Punk through the reviewed worker pipeline", async () => {
  let runOptions;
  let recorded;
  const result = await runPunkPriorityWorker({
    environment: ENVIRONMENT,
    nextSession: async () => SESSION,
    runOnce: async (options) => {
      runOptions = options;
      return { tokenId: "93", status: "MINT_CONFIRMED", submitted: 1,
        collection: "0x2222222222222222222222222222222222222222",
        transactionHash: `0x${"a".repeat(64)}`, gasUsed: "150000",
        effectiveGasPriceWei: "500000000", transactionGasCostWei: "75000000000000" };
    },
    recordAttempt: async (id, outcome) => {
      recorded = { id, outcome };
      return { recorded: true, state: "ACTIVE", completedMints: 1, requestedMints: 3 };
    },
  });
  assert.equal(runOptions.requestedTokenId, "93");
  assert.equal(runOptions.retainLease, false);
  assert.equal(recorded.id, SESSION.id);
  assert.equal(recorded.outcome.status, "MINT_CONFIRMED");
  assert.equal(recorded.outcome.transactionGasCostWei, "75000000000000");
  assert.equal(result.prioritySession.completedMints, 1);
});

test("one priority Punk failure is recorded without escaping into unrelated sessions", async () => {
  let recorded;
  const result = await runPunkPriorityWorker({
    environment: ENVIRONMENT,
    nextSession: async () => SESSION,
    runOnce: async () => {
      const error = new Error("authorization changed");
      error.code = "PUNK_NOT_AUTHORIZED";
      throw error;
    },
    recordAttempt: async (_id, outcome) => {
      recorded = outcome;
      return { recorded: true, state: "CANCELLED" };
    },
  });
  assert.equal(recorded.status, "PUNK_NOT_AUTHORIZED");
  assert.equal(result.prioritySession.state, "CANCELLED");
});
