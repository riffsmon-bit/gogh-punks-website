import {
  estimateSignedPunkAgentUserOperation,
  prepareSignedPunkAgentMint,
} from "./punk-agent-mint-operation.mjs";
import { punkAgentAccountReadiness } from "./punk-agent-account-manifest.mjs";
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

export async function runPunkAgentMissionOnce({
  deployment, client, bundler, signer, gas, now = new Date(),
  loadMission, loadCandidate, reserveOperation, markSubmitted, markFailed,
}) {
  const readiness = punkAgentAccountReadiness(deployment);
  if (!readiness.ready) return Object.freeze({ status: "LOCKED", submitted: false,
    blockers: readiness.blockers });
  functionValue(loadMission, "mission loader");
  functionValue(loadCandidate, "candidate loader");
  functionValue(reserveOperation, "operation reservation");
  functionValue(markSubmitted, "submission recorder");
  functionValue(markFailed, "failure recorder");
  await readPunkAgentBundlerReadiness({ bundler });
  const mission = await loadMission({ now });
  if (!mission) return Object.freeze({ status: "IDLE", submitted: false });
  const runtime = await readPunkAgentAccountRuntime({ client, deployment,
    tokenId: mission.tokenId, expectedOwner: mission.owner,
    expectedSessionKey: signer.address });
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
  const prepared = await prepareSignedPunkAgentMint({ client, signer, runtime,
    opportunity: candidate.opportunity, strategyHash: mission.strategyHash,
    tokenId: candidate.tokenId, simulationInputHash: candidate.simulationInputHash,
    gas, entryPointNonce, now });
  const gasEstimate = await estimateSignedPunkAgentUserOperation({ bundler,
    operation: prepared.operation });
  const reservation = await reserveOperation({ mission, runtime, candidate, prepared,
    gasEstimate, now });
  if (!reservation?.operationId) fail("RESERVATION_FAILED", "UserOperation was not reserved");
  try {
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
