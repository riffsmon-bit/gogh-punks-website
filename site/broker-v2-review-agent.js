const ADDRESS = /^0x[0-9a-f]{40}$/;
const TOKEN_ID = /^(?:0|[1-9][0-9]{0,3})$/;
const INTENT_HASH = /^0x[0-9a-f]{64}$/;
const OPPORTUNITY_ID = /^[a-zA-Z0-9:_-]{8,256}$/;
const MODES = new Set(["ASK", "ASSIST"]);
const SCREENING = new Set(["PENDING", "PASSED", "BLOCKED", "NEEDS_REVIEW"]);
const SIMULATION = new Set(["PENDING", "PASSED", "FAILED", "UNAVAILABLE"]);

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

function activeReviewAgent(agent, statuses) {
  if (!agent || agent.schema !== "GOGH_REVIEW_AGENT_V1" || agent.reviewOnly !== true
    || agent.authority !== "NONE" || !statuses.includes(agent.status)) {
    throw new TypeError("Review agent mission state is invalid");
  }
  return agent;
}

export function dispatchReviewAgent(agentValue, now = new Date()) {
  const agent = activeReviewAgent(agentValue, ["ACTIVE"]);
  const dailyLimit = Number(agent.intent.dailyMintLimit);
  const totalLimit = Number(agent.intent.totalMintLimit);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || !Number.isInteger(totalLimit)
    || totalLimit < 1) throw new TypeError("Review agent mission limit is invalid");
  const startedAt = timestamp(now, "mission start");
  return Object.freeze({ ...agent, status: "SCOUTING", updatedAt: startedAt,
    mission: Object.freeze({ targetMatches: Math.min(dailyLimit, totalLimit), checks: 0,
      checkedOpportunities: 0, foundContracts: Object.freeze([]), startedAt,
      lastCheckedAt: null }) });
}

export function recordReviewMissionRun(agentValue, run, now = new Date()) {
  const agent = activeReviewAgent(agentValue, ["SCOUTING"]);
  if (!run || typeof run !== "object" || !Array.isArray(run.opportunities)
    || !Number.isInteger(run.checkedCount) || run.checkedCount < 0) {
    throw new TypeError("Review agent mission run is invalid");
  }
  const found = new Set(agent.mission.foundContracts);
  for (const opportunity of run.opportunities) {
    if (opportunity.recommendationEligible === true) {
      found.add(address(opportunity.collectionContract, "matched collection contract"));
    }
  }
  const checkedAt = timestamp(now, "mission check");
  const foundContracts = Object.freeze([...found].sort());
  const mission = Object.freeze({ ...agent.mission, checks: agent.mission.checks + 1,
    checkedOpportunities: agent.mission.checkedOpportunities + run.checkedCount,
    foundContracts, lastCheckedAt: checkedAt });
  return Object.freeze({ ...agent,
    status: foundContracts.length >= mission.targetMatches ? "RETURNED" : "SCOUTING",
    mission, updatedAt: checkedAt });
}

export function pauseReviewAgent(agent, now = new Date()) {
  activeReviewAgent(agent, ["ACTIVE", "SCOUTING"]);
  return Object.freeze({ ...agent, status: "PAUSED", updatedAt: timestamp(now, "pause time") });
}

export function normalizeReviewAgentSnapshot(value, now = new Date()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Review agent snapshot is invalid");
  }
  if (value.schema !== "GOGH_REVIEW_AGENT_V1" || value.reviewOnly !== true
    || value.authority !== "NONE") {
    throw new TypeError("Review agent snapshot authority is invalid");
  }
  const activatedAt = timestamp(value.activatedAt, "activation time");
  const base = activateReviewAgent({ intent: value.intent, intentHash: value.intentHash }, {
    owner: value.owner, punkTokenId: value.punkTokenId, punkWallet: value.punkWallet,
  }, new Date(activatedAt));
  if (Date.parse(base.intent.expiration) <= new Date(now).getTime()) {
    throw new TypeError("Review agent snapshot is expired");
  }
  const status = String(value.status ?? "");
  if (!["ACTIVE", "SCOUTING", "RETURNED", "PAUSED"].includes(status)
    || value.mode !== base.mode) {
    throw new TypeError("Review agent snapshot status is invalid");
  }
  const updatedAt = timestamp(value.updatedAt, "update time");
  if (Date.parse(updatedAt) < Date.parse(activatedAt)) {
    throw new TypeError("Review agent snapshot chronology is invalid");
  }
  let mission;
  if (Object.hasOwn(value, "mission")) {
    const source = value.mission;
    if (!source || typeof source !== "object" || Array.isArray(source)
      || source.targetMatches !== Math.min(base.intent.dailyMintLimit, base.intent.totalMintLimit)
      || !Number.isInteger(source.checks) || source.checks < 0 || source.checks > 100_000
      || !Number.isInteger(source.checkedOpportunities) || source.checkedOpportunities < 0
      || source.checkedOpportunities > 10_000_000 || !Array.isArray(source.foundContracts)
      || source.foundContracts.length > 10_000) {
      throw new TypeError("Review agent snapshot mission is invalid");
    }
    const foundContracts = [...new Set(source.foundContracts.map((contract) =>
      address(contract, "matched collection contract")))].sort();
    if (foundContracts.length !== source.foundContracts.length) {
      throw new TypeError("Review agent snapshot matches are invalid");
    }
    const startedAt = timestamp(source.startedAt, "mission start");
    const lastCheckedAt = source.lastCheckedAt === null ? null
      : timestamp(source.lastCheckedAt, "mission check");
    if ((source.checks === 0) !== (lastCheckedAt === null)
      || Date.parse(startedAt) < Date.parse(activatedAt)
      || lastCheckedAt !== null && Date.parse(lastCheckedAt) < Date.parse(startedAt)) {
      throw new TypeError("Review agent snapshot mission chronology is invalid");
    }
    mission = Object.freeze({ targetMatches: source.targetMatches, checks: source.checks,
      checkedOpportunities: source.checkedOpportunities,
      foundContracts: Object.freeze(foundContracts), startedAt, lastCheckedAt });
  }
  if (["SCOUTING", "RETURNED"].includes(status) && !mission
    || status === "ACTIVE" && mission
    || status === "SCOUTING" && mission.foundContracts.length >= mission.targetMatches
    || status === "RETURNED" && mission.foundContracts.length < mission.targetMatches) {
    throw new TypeError("Review agent snapshot mission state is invalid");
  }
  return Object.freeze({ ...base, status, updatedAt, ...(mission ? { mission } : {}) });
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

export function normalizeReviewAgentRun(value, expectedTokenId) {
  const expected = tokenId(expectedTokenId);
  const uint = (input, maximum = 100) => Number.isInteger(input) && input >= 0 && input <= maximum
    ? input : (() => { throw new TypeError("Review run count is invalid"); })();
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.ok !== true || value.reviewOnly !== true || value.authority !== "NONE"
    || tokenId(value.tokenId) !== expected || value.transactionPrepared !== false
    || value.executionAttemptCreated !== false || !Array.isArray(value.opportunities)
    || value.opportunities.length > 20) throw new TypeError("Review run is invalid");
  const checkedCount = uint(value.checkedCount);
  const eligibleCount = uint(value.eligibleCount);
  const screeningPassedCount = uint(value.screeningPassedCount);
  const simulationPassedCount = uint(value.simulationPassedCount);
  const testOpportunityCount = uint(value.testOpportunityCount ?? 0);
  const testMode = value.testMode === null || value.testMode === undefined ? null : value.testMode;
  if (eligibleCount > checkedCount || screeningPassedCount > checkedCount
    || simulationPassedCount > checkedCount || testOpportunityCount > checkedCount
    || ![null, "SAFE_FIXTURE"].includes(testMode)
    || (testMode === null && testOpportunityCount !== 0)
    || (testMode === "SAFE_FIXTURE" && testOpportunityCount !== 1)) {
    throw new TypeError("Review run totals are invalid");
  }
  const opportunities = value.opportunities.map((entry) => {
    const opportunity = entry?.opportunity; const match = entry?.match;
    const opportunityId = String(opportunity?.opportunityId ?? "");
    const collectionContract = address(opportunity?.collectionContract, "collection contract");
    const collectionName = String(opportunity?.collectionName ?? "").trim();
    const matchScore = Number(match?.matchScore);
    if (!OPPORTUNITY_ID.test(opportunityId) || !collectionName || collectionName.length > 160
      || !SCREENING.has(opportunity?.screeningStatus)
      || !SIMULATION.has(opportunity?.simulationStatus)
      || typeof match?.recommendationEligible !== "boolean" || !Number.isInteger(matchScore)
      || matchScore < 0 || matchScore > 100) throw new TypeError("Review opportunity is invalid");
    if (typeof entry.previewFixture !== "boolean") throw new TypeError("Review opportunity is invalid");
    return Object.freeze({ opportunityId, collectionContract, collectionName,
      previewFixture: entry.previewFixture,
      screeningStatus: opportunity.screeningStatus,
      simulationStatus: opportunity.simulationStatus,
      recommendationEligible: match.recommendationEligible, matchScore });
  });
  return Object.freeze({ checkedCount, eligibleCount, screeningPassedCount,
    simulationPassedCount, testMode, testOpportunityCount,
    opportunities: Object.freeze(opportunities) });
}
