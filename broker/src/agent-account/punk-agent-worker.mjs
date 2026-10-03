import {
  estimateSignedPunkAgentUserOperation,
  prepareSignedPunkAgentMint,
} from "./punk-agent-mint-operation.mjs";
import { punkAgentAccountReadiness } from "./punk-agent-account-manifest.mjs";
import { verifyPunkAgentOwnershipContinuity } from "./punk-agent-ownership-continuity.mjs";
import {
  readPunkAgentAccountRuntime,
  readPunkAgentBundlerReadiness,
} from "./punk-agent-account-runtime.mjs";
import {
  readPunkAgentEntryPointNonce,
  submitPunkAgentUserOperation,
} from "./punk-agent-user-operation.mjs";

const MAX_EVIDENCE_AGE_MS = 120_000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function functionValue(value, label) {
  if (typeof value !== "function") fail("INVALID_WORKER", `${label} is unavailable`);
  return value;
}
function sameString(left, right) {
  return typeof left === "string" && typeof right === "string"
    && left.toLowerCase() === right.toLowerCase();
}
function persistedCheckpoint(value, expected) {
  if (!value || typeof value !== "object" || !sameString(value.sessionId, expected.sessionId)
    || !sameString(value.authorizationTransactionHash, expected.authorizationTransactionHash)
    || String(value.sessionGeneration) !== expected.sessionGeneration
    || String(value.blockNumber) !== expected.blockNumber
    || !sameString(value.blockHash, expected.blockHash)) {
    fail("OWNERSHIP_CONTINUITY_UNVERIFIED", "ownership checkpoint was not persisted exactly");
  }
  return Object.freeze({ ...expected });
}

export async function runPunkAgentMissionOnce({
  deployment, client, bundler, signer, gas, now = new Date(),
  loadMission, loadCandidate, reserveOperation, markSubmitted, markFailed,
  loadOwnershipCheckpoint = async () => null,
  persistOwnershipCheckpoint = async ({ checkpoint }) => checkpoint,
  assertLease = async () => {},
}) {
  const readiness = punkAgentAccountReadiness(deployment);
  if (!readiness.ready) return Object.freeze({ status: "LOCKED", submitted: false,
    blockers: readiness.blockers });
  functionValue(loadMission, "mission loader");
  functionValue(loadCandidate, "candidate loader");
  functionValue(reserveOperation, "operation reservation");
  functionValue(markSubmitted, "submission recorder");
  functionValue(markFailed, "failure recorder");
  functionValue(loadOwnershipCheckpoint, "ownership checkpoint loader");
  functionValue(persistOwnershipCheckpoint, "ownership checkpoint recorder");
  await readPunkAgentBundlerReadiness({ bundler });
  const mission = await loadMission({ now });
  if (!mission) return Object.freeze({ status: "IDLE", submitted: false });
  const blocked = async (error, reservation = null) => {
    const code = ["OWNER_CHANGED", "OWNERSHIP_CHANGED_SINCE_AUTHORIZATION",
      "OWNERSHIP_HISTORY_WINDOW_EXCEEDED", "SESSION_STATE_MISMATCH", "SESSION_KEY_MISMATCH"].includes(error?.code)
      ? error.code : "OWNERSHIP_CONTINUITY_UNVERIFIED";
    await markFailed({ mission, reservation, code,
      terminal: ["OWNER_CHANGED", "OWNERSHIP_CHANGED_SINCE_AUTHORIZATION",
        "OWNERSHIP_HISTORY_WINDOW_EXCEEDED", "SESSION_STATE_MISMATCH", "SESSION_KEY_MISMATCH"].includes(code), now });
    return Object.freeze({ status: code, submitted: false, tokenId: mission.tokenId });
  };
  let runtime, ownershipCheckpoint;
  const continuityGuard = async () => {
    const evidence = await verifyPunkAgentOwnershipContinuity({ client, mission, runtime,
      deployment, checkpoint: ownershipCheckpoint });
    if (evidence.checkpoint) {
      const stored = await persistOwnershipCheckpoint({ mission, checkpoint: evidence.checkpoint, now });
      ownershipCheckpoint = persistedCheckpoint(stored, evidence.checkpoint);
    }
    return evidence;
  };
  try {
    ownershipCheckpoint = await loadOwnershipCheckpoint({ mission, now });
    runtime = await readPunkAgentAccountRuntime({ client, deployment,
      tokenId: mission.tokenId, expectedOwner: mission.owner,
      expectedSessionKey: signer.address });
    await continuityGuard();
  } catch (error) { return blocked(error); }
  if (!runtime.sessionActive || runtime.session.generation !== BigInt(mission.sessionGeneration)
    || runtime.account !== mission.account || mission.strategy.operatingMode !== "AUTONOMOUS") {
    await markFailed({ mission, code: "SESSION_STATE_MISMATCH", terminal: true, now });
    return Object.freeze({ status: "SESSION_STATE_MISMATCH", submitted: false,
      tokenId: mission.tokenId });
  }
  const candidate = await loadCandidate({ mission, runtime, now });
  if (!candidate) return Object.freeze({ status: "NO_ELIGIBLE_MATCH", submitted: false,
    tokenId: mission.tokenId });
  const checkedAtMs = Date.parse(candidate.checkedAt);
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(checkedAtMs) || checkedAtMs > nowMs + 5_000
    || nowMs - checkedAtMs > MAX_EVIDENCE_AGE_MS) {
    fail("STALE_EXECUTION_EVIDENCE", "candidate evidence is not fresh enough to sign");
  }
  const entryPointNonce = await readPunkAgentEntryPointNonce({ client, account: runtime.account });
  // Candidate inspection can be slow. Recheck before the signer sees an operation.
  try { await continuityGuard(); }
  catch (error) { return blocked(error); }
  await assertLease();
  const prepared = await prepareSignedPunkAgentMint({ client, signer, runtime,
    opportunity: candidate.opportunity, strategyHash: mission.strategyHash,
    tokenId: candidate.tokenId, simulationInputHash: candidate.simulationInputHash,
    gas, entryPointNonce, now });
  const gasEstimate = await estimateSignedPunkAgentUserOperation({ bundler,
    operation: prepared.operation });
  const reservation = await reserveOperation({ mission, runtime, candidate, prepared,
    gasEstimate, now });
  if (!reservation?.operationId) fail("RESERVATION_FAILED", "UserOperation was not reserved");
  // Estimation/reservation is another race window. No submit after a detected transfer.
  try { await continuityGuard(); }
  catch (error) { return blocked(error, reservation); }
  try {
    await assertLease();
    const submitted = await submitPunkAgentUserOperation({ bundler,
      operation: prepared.operation, authorization: { ownerSessionActive: true,
        screeningPassed: true, simulationPassed: true,
        userOpHash: prepared.operation.userOpHash,
        opportunityId: prepared.intent.opportunityId,
        screeningInputHash: candidate.screeningInputHash,
        simulationInputHash: candidate.simulationInputHash } });
    await markSubmitted({ mission, candidate, prepared, reservation,
      userOpHash: submitted.userOpHash, now });
    return Object.freeze({ status: "SUBMITTED", submitted: true,
      tokenId: mission.tokenId, operationId: reservation.operationId,
      userOpHash: submitted.userOpHash });
  } catch (error) {
    await markFailed({ mission, candidate, reservation, prepared,
      code: error?.code ?? "SUBMISSION_FAILED", terminal: false, now });
    throw error;
  }
}
