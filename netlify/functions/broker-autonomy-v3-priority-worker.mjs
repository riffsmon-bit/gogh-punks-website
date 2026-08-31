import {
  runAutomationV3Once,
} from "./_shared/automation-v3-runner.mjs";
import {
  backgroundRpcDecision, logBackgroundRpcSkip,
} from "./_shared/background-rpc-policy.mjs";
import {
  nextPunkPrioritySession, recordPunkPrioritySessionAttempt,
} from "./_shared/supabase-operational-store.mjs";
import {
  automationV3LaneEnvironment, configuredAutomationV3AgentLanes,
} from "./_shared/automation-v3-agent-pool.mjs";

function failureCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,128}$/.test(error.code)
    ? error.code : "PRIORITY_RUN_FAILED";
}

export async function runPunkPriorityWorker(dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const nextSession = dependencies.nextSession ?? nextPunkPrioritySession;
  const runOnce = dependencies.runOnce ?? runAutomationV3Once;
  const recordAttempt = dependencies.recordAttempt ?? recordPunkPrioritySessionAttempt;
  const session = await nextSession({ environment, database: dependencies.database });
  if (!session) return Object.freeze({ status: "NO_PRIORITY_SESSIONS", submitted: 0 });
  const lane = configuredAutomationV3AgentLanes(environment)
    .find(({ address }) => address === session.agent);
  if (!lane) {
    const result = Object.freeze({
      status: "PRIORITY_AGENT_UNAVAILABLE", submitted: 0, tokenId: session.tokenId,
    });
    const sessionResult = await recordAttempt(session.id, result, {
      environment, database: dependencies.database,
    });
    return Object.freeze({ ...result, prioritySession: sessionResult });
  }
  const laneEnvironment = automationV3LaneEnvironment(environment, lane.laneId);

  let result;
  try {
    result = await runOnce({
      environment: laneEnvironment,
      laneId: lane.laneId,
      requestedTokenId: session.tokenId,
      retainLease: false,
    });
  } catch (error) {
    result = Object.freeze({
      tokenId: session.tokenId,
      status: failureCode(error),
      submitted: 0,
      collection: error?.collection ?? null,
      transactionHash: error?.transactionHash ?? null,
    });
  }
  const sessionResult = await recordAttempt(session.id, result, {
    environment, database: dependencies.database,
  });
  return Object.freeze({ ...result, prioritySession: sessionResult });
}

export default async function handler() {
  // Use the already-reviewed worker task allowance. This lane changes scheduling
  // priority only; the exact same live ownership, authorization, adapter, price,
  // cap, simulation, and submission pipeline remains authoritative.
  const decision = backgroundRpcDecision(process.env, "AUTOMATION_V3_WORKER");
  if (!decision.enabled) {
    logBackgroundRpcSkip(decision);
    return;
  }
  const result = await runPunkPriorityWorker();
  console.log(JSON.stringify({ event: "AUTOMATION_V3_PRIORITY_WORKER", ...result }));
}

// A due priority Punk is checked every minute. With no active priority session,
// this performs one inexpensive operational-store read and no chain RPC call.
export const config = { schedule: "* * * * *" };
