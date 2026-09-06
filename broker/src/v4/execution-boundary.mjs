import { createHash } from "node:crypto";

export const V2_EXECUTION_CAPABILITIES = Object.freeze({
  ASK: Object.freeze({ available: true, ownerConfirmation: true, submits: false }),
  ASSIST: Object.freeze({ available: true, ownerConfirmation: true, submits: false }),
  AUTONOMOUS: Object.freeze({
    available: false,
    ownerConfirmation: false,
    submits: false,
    blocker: "SELF_FUNDED_AUTONOMOUS_GAS_UNSUPPORTED_BY_DEPLOYED_ACCOUNT",
  }),
});

const TRANSITIONS = Object.freeze({
  RESERVED: Object.freeze(["SIMULATED", "REJECTED", "CANCELLED"]),
  SIMULATED: Object.freeze(["OWNER_APPROVAL_PENDING", "REJECTED", "CANCELLED"]),
  OWNER_APPROVAL_PENDING: Object.freeze(["OWNER_APPROVED", "CANCELLED", "EXPIRED"]),
  OWNER_APPROVED: Object.freeze(["SUBMISSION_RESERVED", "CANCELLED", "EXPIRED"]),
  SUBMISSION_RESERVED: Object.freeze(["SUBMITTED", "REJECTED"]),
  SUBMITTED: Object.freeze(["CONFIRMED", "REVERTED", "RECONCILIATION_REQUIRED"]),
  RECONCILIATION_REQUIRED: Object.freeze(["CONFIRMED", "REVERTED"]),
});

function text(value, label, pattern, maximum = 512) {
  const output = String(value ?? "").toLowerCase();
  if (output.length > maximum || !pattern.test(output)) throw new TypeError(`${label} is invalid`);
  return output;
}

export function v2ExecutionIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.chainId !== 4663) {
    throw new TypeError("execution identity is invalid");
  }
  const account = text(value.punkWallet, "Punk Wallet", /^0x[0-9a-f]{40}$/);
  const opportunity = text(value.opportunityId, "opportunity", /^[a-z0-9:_-]{8,256}$/);
  const strategy = text(value.strategyHash, "strategy hash", /^0x[0-9a-f]{64}$/);
  const nonce = text(value.accountNonce, "account nonce", /^(?:0|[1-9][0-9]{0,77})$/);
  const mode = String(value.operatingMode ?? "");
  if (!Object.hasOwn(V2_EXECUTION_CAPABILITIES, mode)) throw new TypeError("mode is invalid");
  return createHash("sha256").update([
    "GOGH_V2_EXECUTION_ATTEMPT_V1", "4663", account, opportunity, strategy, nonce, mode,
  ].join("|")).digest("hex");
}

export function assertV2ExecutionCapability(mode, { production = false } = {}) {
  const capability = V2_EXECUTION_CAPABILITIES[mode];
  if (!capability) throw new TypeError("execution mode is invalid");
  if (!capability.available) {
    const error = new Error("Autonomous V2 execution is unavailable with the deployed account boundary.");
    error.code = capability.blocker;
    throw error;
  }
  if (production) {
    const error = new Error("V2 production transaction submission requires separate authorization.");
    error.code = "V2_PRODUCTION_AUTHORIZATION_REQUIRED";
    throw error;
  }
  return capability;
}

export function transitionV2ExecutionAttempt(attempt, nextState, at = new Date()) {
  if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)
    || typeof attempt.idempotencyKey !== "string" || !/^[0-9a-f]{64}$/.test(attempt.idempotencyKey)
    || typeof attempt.state !== "string") throw new TypeError("execution attempt is invalid");
  const allowed = TRANSITIONS[attempt.state] ?? [];
  if (!allowed.includes(nextState)) throw new TypeError(`invalid execution transition ${attempt.state} -> ${nextState}`);
  const changedAt = new Date(at);
  if (!Number.isFinite(changedAt.getTime())) throw new TypeError("execution transition time is invalid");
  return Object.freeze({ ...attempt, state: nextState, updatedAt: changedAt.toISOString() });
}
