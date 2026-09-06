const ADDRESS = /^0x[0-9a-f]{40}$/;
const TOKEN_ID = /^(?:0|[1-9][0-9]{0,3})$/;
const INTENT_HASH = /^0x[0-9a-f]{64}$/;
const MODES = new Set(["ASK", "ASSIST"]);

function address(value, label) {
  const normalized = String(value ?? "").toLowerCase();
  if (!ADDRESS.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function tokenId(value) {
  const normalized = String(value ?? "");
  if (!TOKEN_ID.test(normalized)) throw new TypeError("Punk token ID is invalid");
  return normalized;
}

function timestamp(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${label} is invalid`);
  return date.toISOString();
}

function frozenSnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenSnapshot));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value)
      .map(([key, nested]) => [key, frozenSnapshot(nested)])));
  }
  return value;
}

export function reviewAgentKey(owner, punkTokenId) {
  return `${address(owner, "owner")}:${tokenId(punkTokenId)}`;
}

export function activateReviewAgent(draft, selection, now = new Date()) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)
    || !selection || typeof selection !== "object" || Array.isArray(selection)) {
    throw new TypeError("Review agent activation is invalid");
  }
  const owner = address(selection.owner, "owner");
  const punkWallet = address(selection.punkWallet, "Punk Wallet");
  const punkTokenId = tokenId(selection.punkTokenId);
  const intent = draft.intent;
  if (!intent || typeof intent !== "object" || Array.isArray(intent)
    || intent.schema !== "PUNK_COLLECTING_INTENT_V1" || intent.version !== 1
    || intent.chainId !== 4663 || tokenId(intent.punkTokenId) !== punkTokenId
    || address(intent.expectedOwner, "intent owner") !== owner
    || address(intent.punkWallet, "intent Punk Wallet") !== punkWallet
    || !MODES.has(intent.operatingMode)
    || typeof draft.intentHash !== "string" || !INTENT_HASH.test(draft.intentHash)) {
    throw new TypeError("Strategy draft does not match the selected Punk");
  }
  const expiresAt = timestamp(intent.expiration, "strategy expiration");
  const activatedAt = timestamp(now, "activation time");
  if (Date.parse(expiresAt) <= Date.parse(activatedAt)) {
    throw new TypeError("Strategy draft is expired");
  }
  return Object.freeze({ schema: "GOGH_REVIEW_AGENT_V1", reviewOnly: true,
    authority: "NONE", owner, punkTokenId, punkWallet, mode: intent.operatingMode,
    status: "ACTIVE", intentHash: draft.intentHash, intent: frozenSnapshot(intent),
    activatedAt, updatedAt: activatedAt });
}

export function pauseReviewAgent(agent, now = new Date()) {
  if (!agent || agent.schema !== "GOGH_REVIEW_AGENT_V1" || agent.reviewOnly !== true
    || agent.authority !== "NONE" || agent.status !== "ACTIVE") {
    throw new TypeError("Active review agent is required");
  }
  return Object.freeze({ ...agent, status: "PAUSED", updatedAt: timestamp(now, "pause time") });
}

export function reviewInspectionPipeline(inspection) {
  if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)
    || !inspection.link || typeof inspection.link !== "object") {
    return Object.freeze({ discovery: "WAITING", contract: "NOT IDENTIFIED",
      screening: "NOT RUN", simulation: "NOT RUN", decision: "NO OPPORTUNITY" });
  }
  const contractReference = inspection.link.kind === "ROBINHOOD_CONTRACT";
  const decision = inspection.status === "BLOCKED" ? "BLOCKED" : "NEEDS REVIEW";
  return Object.freeze({ discovery: "LINK NORMALIZED",
    contract: contractReference ? "REFERENCE IDENTIFIED" : "NOT IDENTIFIED",
    screening: "NOT RUN", simulation: "NOT RUN", decision });
}
