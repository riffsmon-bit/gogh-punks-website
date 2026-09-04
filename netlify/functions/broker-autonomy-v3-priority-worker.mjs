import {
  runAutomationV3Once,
} from "./_shared/automation-v3-runner.mjs";
import {
  backgroundRpcDecision, logBackgroundRpcSkip,
} from "./_shared/background-rpc-policy.mjs";
import {
  beginPunkPrioritySessionAttempt, nextPunkPrioritySession,
  notePunkPrioritySubmission, recordPunkPrioritySessionAttempt,
  reservePunkPrioritySubmission,
} from "./_shared/supabase-operational-store.mjs";
import {
  automationV3AgentLane, automationV3LaneEnvironment, configuredAutomationV3AgentLanes,
} from "./_shared/automation-v3-agent-pool.mjs";
import { createPublicClient, http } from "viem";
import { resolveRobinhoodRpcPair } from
  "../../broker/src/infrastructure/robinhood-rpc-endpoints.mjs";
import { brokerMigrationState, V1_RETIRED_REASON } from
  "./_shared/broker-migration-state.mjs";

function failureCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,128}$/.test(error.code)
    ? error.code : "PRIORITY_RUN_FAILED";
}

function transactionHash(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)
    || /^0x0{64}$/i.test(value)) return null;
  return value.toLowerCase();
}

function blockHash(value) {
  return transactionHash(value);
}

export function receiptEvidence(receipt) {
  const hash = transactionHash(receipt?.transactionHash);
  if (!hash || receipt.gasUsed == null || receipt.effectiveGasPrice == null
    || !new Set(["success", "reverted"]).has(receipt.status)) return null;
  let gasUsed;
  let effectiveGasPrice;
  try {
    gasUsed = BigInt(receipt.gasUsed);
    effectiveGasPrice = BigInt(receipt.effectiveGasPrice);
  } catch {
    return null;
  }
  if (gasUsed < 0n || effectiveGasPrice < 0n) return null;
  return Object.freeze({
    transactionHash: hash,
    blockHash: blockHash(receipt.blockHash),
    status: receipt.status,
    gasUsed: gasUsed.toString(),
    effectiveGasPriceWei: effectiveGasPrice.toString(),
    transactionGasCostWei: (gasUsed * effectiveGasPrice).toString(),
  });
}

export function resolvePrioritySessionLane(session, environment = process.env) {
  const sessionAgent = typeof session?.agent === "string" ? session.agent.toLowerCase() : null;
  if (!sessionAgent) return null;
  try {
    return configuredAutomationV3AgentLanes(environment)
      .find(({ address }) => address.toLowerCase() === sessionAgent) ?? null;
  } catch {
    try {
      const priorityLane = automationV3AgentLane(environment, 6);
      return priorityLane.enabled === true && priorityLane.address.toLowerCase() === sessionAgent
        ? priorityLane : null;
    } catch {
      return null;
    }
  }
}

export async function reconcileSubmittedPriorityAttempt(attempt, environment = process.env,
  dependencies = {}) {
  const attemptHash = transactionHash(attempt?.transactionHash);
  if (!attemptHash) {
    return Object.freeze({ settled: false, reason: "TRANSACTION_HASH_UNAVAILABLE" });
  }
  let clients = dependencies.clients;
  if (clients === undefined) {
    const { primary, secondary } = resolveRobinhoodRpcPair(environment);
    clients = [primary, secondary].map((url) => createPublicClient({
      transport: http(url, { batch: false, retryCount: 1, timeout: 8_000 }),
    }));
  }
  const reads = await Promise.all(clients.map(async (client) => {
    try {
      return receiptEvidence(await client.getTransactionReceipt({
        hash: attemptHash,
      }));
    } catch {
      return null;
    }
  }));
  if (clients.length !== 2 || reads.some((value) => value === null)
    || JSON.stringify(reads[0]) !== JSON.stringify(reads[1])) {
    return Object.freeze({ settled: false, reason: "RECEIPT_NOT_DUALLY_CONFIRMED" });
  }
  const receipt = reads[0];
  const minted = receipt.status === "success";
  return Object.freeze({
    settled: true,
    outcome: Object.freeze({
      status: minted ? "MINT_CONFIRMED" : "AUTONOMOUS_MINT_REVERTED",
      submitted: minted ? 1 : 0,
      transactionHash: receipt.transactionHash,
      gasUsed: receipt.gasUsed,
      effectiveGasPriceWei: receipt.effectiveGasPriceWei,
      transactionGasCostWei: receipt.transactionGasCostWei,
    }),
  });
}

export async function runPunkPriorityWorker(dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const lifecycle = brokerMigrationState(environment, { now: dependencies.now });
  const nextSession = dependencies.nextSession ?? nextPunkPrioritySession;
  const runOnce = dependencies.runOnce ?? runAutomationV3Once;
  const beginAttempt = dependencies.beginAttempt ?? beginPunkPrioritySessionAttempt;
  const reserveSubmission = dependencies.reserveSubmission ?? reservePunkPrioritySubmission;
  const noteSubmission = dependencies.noteSubmission ?? notePunkPrioritySubmission;
  const recordAttempt = dependencies.recordAttempt ?? recordPunkPrioritySessionAttempt;
  const reconcileAttempt = dependencies.reconcileAttempt
    ?? ((attemptValue) => reconcileSubmittedPriorityAttempt(attemptValue, environment));
  const session = await nextSession({ environment, database: dependencies.database });
  if (!session) return Object.freeze({ status: "NO_PRIORITY_SESSIONS", submitted: 0 });
  const lane = resolvePrioritySessionLane(session, environment);
  const attempt = await beginAttempt(session.id, lane?.laneId ?? 6, {
    environment, database: dependencies.database,
  });
  if (attempt.executable !== true) {
    if (attempt.reason === "TRANSACTION_SUBMITTED_AWAITING_RECORD"
      && attempt.transactionHash) {
      const reconciliation = await reconcileAttempt(attempt);
      if (reconciliation.settled === true) {
        const sessionResult = await recordAttempt(attempt, reconciliation.outcome, {
          environment, database: dependencies.database,
        });
        return Object.freeze({
          ...reconciliation.outcome,
          priorityAttempt: attempt,
          prioritySession: sessionResult,
          reconciled: true,
        });
      }
    }
    return Object.freeze({
      status: "PRIORITY_ATTEMPT_WAITING", submitted: 0, tokenId: session.tokenId,
      priorityAttempt: attempt,
    });
  }
  if (!lifecycle.hostedExecutionEnabled) {
    const result = Object.freeze({
      status: V1_RETIRED_REASON, submitted: 0, tokenId: session.tokenId,
    });
    const sessionResult = await recordAttempt(attempt, result, {
      environment, database: dependencies.database,
    });
    return Object.freeze({ ...result, priorityAttempt: attempt,
      prioritySession: sessionResult });
  }
  if (!lane) {
    const result = Object.freeze({
      status: "PRIORITY_AGENT_UNAVAILABLE", submitted: 0, tokenId: session.tokenId,
    });
    const sessionResult = await recordAttempt(attempt, result, {
      environment, database: dependencies.database,
    });
    return Object.freeze({ ...result, priorityAttempt: attempt, prioritySession: sessionResult });
  }
  const laneEnvironment = automationV3LaneEnvironment(environment, lane.laneId);

  let result;
  try {
    result = await runOnce({
      environment: laneEnvironment,
      laneId: lane.laneId,
      requestedTokenId: session.tokenId,
      retainLease: false,
      beforeSubmission: (submission) => reserveSubmission(attempt, submission, {
        environment, database: dependencies.database,
      }),
      afterSubmission: (transactionHash) => noteSubmission(attempt, transactionHash, {
        environment, database: dependencies.database,
      }),
    });
  } catch (error) {
    result = Object.freeze({
      tokenId: session.tokenId,
      status: failureCode(error),
      submitted: 0,
      collection: error?.collection ?? null,
      transactionHash: error?.transactionHash ?? null,
      gasUsed: error?.gasUsed ?? null,
      effectiveGasPriceWei: error?.effectiveGasPriceWei ?? null,
      transactionGasCostWei: error?.transactionGasCostWei ?? null,
    });
  }
  const sessionResult = await recordAttempt(attempt, result, {
    environment, database: dependencies.database,
  });
  return Object.freeze({ ...result, priorityAttempt: attempt, prioritySession: sessionResult });
}

export default async function handler() {
  // Use the already-reviewed worker task allowance. This lane changes scheduling
  // priority only; the exact same live ownership, authorization, adapter, price,
  // cap, simulation, and submission pipeline remains authoritative.
  const decision = backgroundRpcDecision(process.env, "AUTOMATION_V3_WORKER");
  if (!decision.enabled && decision.reason !== V1_RETIRED_REASON) {
    logBackgroundRpcSkip(decision);
    return;
  }
  const result = await runPunkPriorityWorker();
  console.log(JSON.stringify({ event: "AUTOMATION_V3_PRIORITY_WORKER", ...result }));
}

// A due priority Punk is checked every minute. With no active priority session,
// this performs one inexpensive operational-store read and no chain RPC call.
export const config = { schedule: "* * * * *" };
