const STATES = new Set(["IDLE", "QUEUED", "SCANNING", "CANDIDATE_FOUND",
  "VERIFYING_CONTRACT", "CHECKING_PRICE", "CHECKING_ELIGIBILITY", "CHECKING_LIMITS",
  "SIMULATING", "READY", "SUBMITTING", "CONFIRMING", "MINTED", "SKIPPED", "PAUSED",
  "ERROR"]);

const COPY = Object.freeze({
  IDLE: "Waiting for the next scheduled scan.", QUEUED: "Agent scan is queued.",
  SCANNING: "Searching supported mint sources.", CANDIDATE_FOUND: "A mint candidate was found.",
  VERIFYING_CONTRACT: "Checking whether the mint contract is supported.",
  CHECKING_PRICE: "Verifying the live on-chain mint price.",
  CHECKING_ELIGIBILITY: "Checking this Punk wallet's eligibility.",
  CHECKING_LIMITS: "Checking the Punk's mint and spending limits.",
  SIMULATING: "Simulating the exact mint transaction.", READY: "Mint passed every current check.",
  SUBMITTING: "Submitting the reviewed mint transaction.", CONFIRMING: "Waiting for confirmation.",
  MINTED: "Mint confirmed and delivered to the Punk wallet.",
  SKIPPED: "Candidate was skipped without submitting a transaction.",
  PAUSED: "Agent is paused and will not submit transactions.",
  ERROR: "Agent stopped safely after an operational error.",
});

const REASONS = Object.freeze({
  UNSUPPORTED_RUNTIME: "Mint skipped — this contract type isn't currently supported.",
  DAILY_SPEND_LIMIT: "Mint skipped — this Punk would exceed today's spending limit.",
  PER_MINT_LIMIT: "Mint skipped — the price exceeds this Punk's per-mint limit.",
  DAILY_MINT_LIMIT: "Mint skipped — this Punk reached its daily mint limit.",
  SIMULATION_REVERT: "Mint skipped — transaction simulation failed.",
  OWNER_CHANGED: "Agent paused — Gogh Punk ownership changed and permissions must be renewed.",
  NO_CANDIDATE: "No eligible supported mints were found in the latest scan.",
});

function timestamp(value) {
  if (typeof value !== "string") throw new TypeError("activity timestamp is invalid");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new TypeError("activity timestamp is invalid");
  }
  return value;
}

export function activityMessage(state, reason = null) {
  if (!STATES.has(state)) throw new TypeError("agent state is invalid");
  if (reason !== null && (typeof reason !== "string" || !/^[A-Z0-9_]{3,64}$/.test(reason))) {
    throw new TypeError("activity reason is invalid");
  }
  return REASONS[reason] ?? COPY[state];
}

export function normalizeAgentHeartbeat(value) {
  const expected = ["punkTokenId", "state", "jobId", "lastScheduledScan", "lastActualScan",
    "lastSuccessfulMint", "lastFailedCandidate", "nextScanEstimate", "reason"];
  value = snapshotExactRecord(value, expected, "heartbeat");
  if (typeof value.punkTokenId !== "string" || !/^(?:0|[1-9][0-9]{0,3})$/.test(value.punkTokenId)
    || !STATES.has(value.state)) throw new TypeError("heartbeat identity or state is invalid");
  const optionalTime = (entry) => entry === null ? null : timestamp(entry);
  const bounded = (entry) => entry === null ? null
    : typeof entry === "string" && entry.length <= 160 ? entry : (() => { throw new TypeError("heartbeat text is invalid"); })();
  return Object.freeze({
    punkTokenId: value.punkTokenId, state: value.state,
    jobId: bounded(value.jobId), lastScheduledScan: optionalTime(value.lastScheduledScan),
    lastActualScan: optionalTime(value.lastActualScan), lastSuccessfulMint: bounded(value.lastSuccessfulMint),
    lastFailedCandidate: bounded(value.lastFailedCandidate),
    nextScanEstimate: optionalTime(value.nextScanEstimate), reason: bounded(value.reason),
    message: activityMessage(value.state, value.reason),
  });
}

export { STATES as AGENT_ACTIVITY_STATES };
import { snapshotExactRecord } from "./strict-record.mjs";
