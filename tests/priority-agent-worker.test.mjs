import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileSubmittedPriorityAttempt, resolvePrioritySessionLane, runPunkPriorityWorker,
} from "../netlify/functions/broker-autonomy-v3-priority-worker.mjs";
import { V1_SHUTDOWN_AT_MS } from
  "../netlify/functions/_shared/broker-migration-state.mjs";

const BEFORE_CUTOFF = () => V1_SHUTDOWN_AT_MS - 1;

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
  BROKER_AUTOMATION_V3_WORKER_RELEASE: "a".repeat(40),
});

const ATTEMPT = Object.freeze({
  id: "22222222-2222-4222-8222-222222222222",
  leaseToken: "33333333-3333-4333-8333-333333333333",
  executable: true,
  reason: "CLAIMED",
  state: "CLAIMED",
});

test("priority worker performs no chain work when no Punk priority session is due", async () => {
  let ran = false;
  const result = await runPunkPriorityWorker({
    now: BEFORE_CUTOFF,
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
    now: BEFORE_CUTOFF,
    environment: ENVIRONMENT,
    nextSession: async () => SESSION,
    beginAttempt: async () => ATTEMPT,
    runOnce: async (options) => {
      runOptions = options;
      assert.equal((await options.beforeSubmission({
        account: "0x1111111111111111111111111111111111111111",
        collection: "0x2222222222222222222222222222222222222222",
        acquisitionNonce: "7",
      })).reserved, true);
      assert.equal((await options.afterSubmission(`0x${"a".repeat(64)}`)).noted, true);
      return { tokenId: "93", status: "MINT_CONFIRMED", submitted: 1,
        collection: "0x2222222222222222222222222222222222222222",
        transactionHash: `0x${"a".repeat(64)}`, gasUsed: "150000",
        effectiveGasPriceWei: "500000000", transactionGasCostWei: "75000000000000" };
    },
    reserveSubmission: async (attempt, submission) => {
      assert.equal(attempt, ATTEMPT);
      assert.equal(submission.acquisitionNonce, "7");
      return { reserved: true };
    },
    noteSubmission: async (attempt, transactionHash) => {
      assert.equal(attempt, ATTEMPT);
      assert.equal(transactionHash, `0x${"a".repeat(64)}`);
      return { noted: true };
    },
    recordAttempt: async (attempt, outcome) => {
      recorded = { attempt, outcome };
      return { recorded: true, state: "ACTIVE", completedMints: 1, requestedMints: 3 };
    },
  });
  assert.equal(runOptions.requestedTokenId, "93");
  assert.equal(runOptions.retainLease, false);
  assert.equal(recorded.attempt, ATTEMPT);
  assert.equal(recorded.outcome.status, "MINT_CONFIRMED");
  assert.equal(recorded.outcome.transactionGasCostWei, "75000000000000");
  assert.equal(result.prioritySession.completedMints, 1);
});

test("one priority Punk failure is recorded without escaping into unrelated sessions", async () => {
  let recorded;
  const result = await runPunkPriorityWorker({
    now: BEFORE_CUTOFF,
    environment: ENVIRONMENT,
    nextSession: async () => SESSION,
    beginAttempt: async () => ATTEMPT,
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

test("an existing durable attempt prevents retry from executing the blockchain pipeline", async () => {
  let beginCalls = 0;
  let runCalls = 0;
  let recordCalls = 0;
  const dependencies = {
    now: BEFORE_CUTOFF,
    environment: ENVIRONMENT,
    nextSession: async () => SESSION,
    beginAttempt: async () => {
      beginCalls += 1;
      return beginCalls === 1 ? ATTEMPT : {
        ...ATTEMPT, executable: false, reason: "ATTEMPT_IN_PROGRESS",
      };
    },
    runOnce: async () => {
      runCalls += 1;
      return { tokenId: "93", status: "GLOBAL_V3_WORKER_BINDING_CLOSED", submitted: 0 };
    },
    recordAttempt: async () => {
      recordCalls += 1;
      throw Object.assign(new Error("database unavailable"), { code: "08006" });
    },
  };
  await assert.rejects(() => runPunkPriorityWorker(dependencies), /database unavailable/);
  const retry = await runPunkPriorityWorker(dependencies);
  assert.equal(retry.status, "PRIORITY_ATTEMPT_WAITING");
  assert.equal(runCalls, 1);
  assert.equal(recordCalls, 1);
});

test("a terminal or expired session claim stops without running automation", async () => {
  let ran = false;
  const result = await runPunkPriorityWorker({
    now: BEFORE_CUTOFF,
    environment: ENVIRONMENT,
    nextSession: async () => SESSION,
    beginAttempt: async () => ({ executable: false, reason: "SESSION_TERMINAL",
      sessionState: "EXPIRED" }),
    runOnce: async () => { ran = true; },
  });
  assert.equal(result.status, "PRIORITY_ATTEMPT_WAITING");
  assert.equal(ran, false);
});

test("a submitted attempt is receipt-reconciled without entering submission again", async () => {
  let ran = false;
  let recorded;
  const submittedAttempt = { ...ATTEMPT, executable: false,
    reason: "TRANSACTION_SUBMITTED_AWAITING_RECORD",
    state: "SUBMITTED", transactionHash: `0x${"b".repeat(64)}` };
  const result = await runPunkPriorityWorker({
    now: BEFORE_CUTOFF,
    environment: ENVIRONMENT,
    nextSession: async () => SESSION,
    beginAttempt: async () => submittedAttempt,
    runOnce: async () => { ran = true; },
    reconcileAttempt: async () => ({ settled: true, outcome: {
      status: "MINT_CONFIRMED", submitted: 1,
      transactionHash: submittedAttempt.transactionHash,
      gasUsed: "100", effectiveGasPriceWei: "6", transactionGasCostWei: "600",
    } }),
    recordAttempt: async (attempt, outcome) => {
      recorded = { attempt, outcome };
      return { recorded: true, state: "COMPLETE", completedMints: 1 };
    },
  });
  assert.equal(ran, false);
  assert.equal(recorded.attempt, submittedAttempt);
  assert.equal(recorded.outcome.transactionHash, submittedAttempt.transactionHash);
  assert.equal(result.reconciled, true);
});

test("shutdown cancels an unsubmitted priority attempt without entering execution", async () => {
  let ran = false;
  let recorded = null;
  const result = await runPunkPriorityWorker({
    now: () => V1_SHUTDOWN_AT_MS,
    environment: ENVIRONMENT,
    nextSession: async () => SESSION,
    beginAttempt: async () => ATTEMPT,
    runOnce: async () => { ran = true; },
    recordAttempt: async (attempt, outcome) => {
      recorded = { attempt, outcome };
      return { recorded: true, state: "CANCELLED" };
    },
  });
  assert.equal(ran, false);
  assert.equal(recorded.attempt, ATTEMPT);
  assert.equal(recorded.outcome.status, "V1_RETIRED");
  assert.equal(result.submitted, 0);
  assert.equal(result.prioritySession.state, "CANCELLED");
});

test("shutdown still reconciles a transaction submitted before cutoff", async () => {
  let ran = false;
  const submittedAttempt = { ...ATTEMPT, executable: false,
    reason: "TRANSACTION_SUBMITTED_AWAITING_RECORD",
    state: "SUBMITTED", transactionHash: `0x${"c".repeat(64)}` };
  const result = await runPunkPriorityWorker({
    now: () => V1_SHUTDOWN_AT_MS + 1,
    environment: ENVIRONMENT,
    nextSession: async () => SESSION,
    beginAttempt: async () => submittedAttempt,
    runOnce: async () => { ran = true; },
    reconcileAttempt: async () => ({ settled: true, outcome: {
      status: "MINT_CONFIRMED", submitted: 1,
      transactionHash: submittedAttempt.transactionHash,
      gasUsed: "100", effectiveGasPriceWei: "6", transactionGasCostWei: "600",
    } }),
    recordAttempt: async () => ({ recorded: true, state: "COMPLETE", completedMints: 1 }),
  });
  assert.equal(ran, false);
  assert.equal(result.reconciled, true);
  assert.equal(result.transactionHash, submittedAttempt.transactionHash);
});

function receiptClient(receipt) {
  return Object.freeze({ getTransactionReceipt: async () => receipt });
}

test("two matching success receipts settle with exact gas cost", async () => {
  const hash = `0x${"d".repeat(64)}`;
  const receipt = Object.freeze({ transactionHash: hash, blockHash: `0x${"e".repeat(64)}`,
    status: "success", gasUsed: 100n, effectiveGasPrice: 6n });
  const result = await reconcileSubmittedPriorityAttempt({ transactionHash: hash }, {}, {
    clients: [receiptClient(receipt), receiptClient(receipt)],
  });
  assert.equal(result.settled, true);
  assert.equal(result.outcome.status, "MINT_CONFIRMED");
  assert.equal(result.outcome.submitted, 1);
  assert.equal(result.outcome.transactionGasCostWei, "600");
});

test("conflicting receipt status cannot settle", async () => {
  const hash = `0x${"d".repeat(64)}`;
  const base = { transactionHash: hash, blockHash: `0x${"e".repeat(64)}`,
    gasUsed: 100n, effectiveGasPrice: 6n };
  const result = await reconcileSubmittedPriorityAttempt({ transactionHash: hash }, {}, {
    clients: [receiptClient({ ...base, status: "success" }),
      receiptClient({ ...base, status: "reverted" })],
  });
  assert.deepEqual(result, { settled: false, reason: "RECEIPT_NOT_DUALLY_CONFIRMED" });
});

test("single or empty receipt client arrays cannot settle", async () => {
  const hash = `0x${"d".repeat(64)}`;
  const receipt = { transactionHash: hash, blockHash: null,
    status: "success", gasUsed: 100n, effectiveGasPrice: 6n };
  const single = await reconcileSubmittedPriorityAttempt({ transactionHash: hash }, {}, {
    clients: [receiptClient(receipt)],
  });
  const empty = await reconcileSubmittedPriorityAttempt({ transactionHash: hash }, {}, {
    clients: [],
  });
  assert.deepEqual(single, { settled: false, reason: "RECEIPT_NOT_DUALLY_CONFIRMED" });
  assert.deepEqual(empty, { settled: false, reason: "RECEIPT_NOT_DUALLY_CONFIRMED" });
});

test("invalid transaction hashes do not touch RPC", async () => {
  let rpcCalls = 0;
  const result = await reconcileSubmittedPriorityAttempt({ transactionHash: "0x1" }, {}, {
    clients: [{ getTransactionReceipt: async () => { rpcCalls += 1; } }],
  });
  assert.deepEqual(result, { settled: false, reason: "TRANSACTION_HASH_UNAVAILABLE" });
  assert.equal(rpcCalls, 0);
});

test("priority lane resolves independently when the complete pool cannot parse", () => {
  const laneOne = "0x1111111111111111111111111111111111111111";
  const priority = "0x6666666666666666666666666666666666666666";
  const environment = {
    BROKER_AUTOMATION_V3_ENABLED: "true",
    BROKER_AUTOMATION_V3_AGENT_ADDRESS: laneOne,
    BROKER_AUTOMATION_V3_AGENT_POOL_ENABLED: "true",
    BROKER_AUTOMATION_V3_AGENT_LANE_2_ENABLED: "true",
    BROKER_AUTOMATION_V3_AGENT_LANE_2_ADDRESS: laneOne,
    BROKER_AUTOMATION_V3_AGENT_LANE_6_ENABLED: "true",
    BROKER_AUTOMATION_V3_AGENT_LANE_6_ADDRESS: priority,
  };
  const lane = resolvePrioritySessionLane({ agent: priority.toUpperCase() }, environment);
  assert.equal(lane.laneId, 6);
  assert.equal(lane.priority, true);
});
