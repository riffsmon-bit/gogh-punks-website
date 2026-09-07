import { verifyOwnedPunkIds } from "./broker-v2-ownership.js";
import {
  fetchPunkWalletFundsGate, preflightPunkWalletFunds, readPunkWalletFundsState,
  submitPunkWalletFunds, waitForPunkWalletTransactionReceipt,
} from "./punk-wallet-funds.js";
import { buildWrappedNativeTransaction, decodeUint256, ROBINHOOD_WETH,
  simulateWrappedNativeTransaction, submitWrappedNativeTransaction,
  wrappedBalanceOfData } from "./wrapped-native.js";
import {
  preflightNftWithdrawal, submitNftWithdrawal, validateWithdrawableNftAssets,
  waitForNftWithdrawalReceipt,
} from "./nft-withdrawal.js";
import {
  activateReviewAgent, dispatchReviewAgent, normalizeReviewAgentRun,
  normalizeReviewAgentSnapshot, pauseReviewAgent, recordReviewMissionRun, reviewAgentKey,
  reviewInspectionPipeline,
} from "./broker-v2-review-agent.js";
import { activateReviewSkill, normalizeReviewSkill } from "./broker-v2-review-skill.js";
import {
  confirmOwnerAssistedMint, preflightOwnerAssistedMint, submitOwnerAssistedMint,
} from "./owner-assisted-seadrop-mint.js";

const PREVIEW = new URLSearchParams(location.search).get("preview") === "1";
const REVIEW_HOST = location.protocol === "https:" && /^(?:deploy-preview-[1-9][0-9]*--gogh-punks\.netlify\.app|deploy-preview-[1-9][0-9]*\.preview\.goghpunks\.xyz)$/.test(location.hostname);
const CHAIN_ID = 4663;
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const PREVIEW_OWNER = "0x1111111111111111111111111111111111111111";
const previewPunks = Object.freeze([
  { tokenId: "119", account: "0x1190119011901190119011901190119011901190",
    image: "/assets/collection/1.png", balanceEth: "0.0300", reserveEth: "0.0100", nfts: 27, mode: "ASK" },
  { tokenId: "546", account: "0x5460546054605460546054605460546054605460",
    image: "/assets/collection/26.png", balanceEth: "0.0142", reserveEth: "0.0050", nfts: 8, mode: "ASSIST" },
  { tokenId: "810", account: "0x8100810081008100810081008100810081008100",
    image: "/assets/collection/44.png", balanceEth: "0.0068", reserveEth: "0.0040", nfts: 3, mode: "ASK" },
]);
const previewGallery = Object.freeze([
  ["/assets/collection/7.png", "Neon Alley #481", "CURRENT ART BROKER · FREE MINT", "Matched pixel taste · 0.00017 ETH gas"],
  ["/assets/collection/13.png", "Odd Hours #77", "CURRENT ART BROKER · OWNER APPROVED", "Weird + experimental · simulation passed"],
  ["/assets/collection/38.png", "Blue Study #12", "EARLIER ART BROKER · ACQUIRED", "Historical Art Broker provenance"],
  ["/assets/collection/56.png", "Night Garden #208", "EARLIER ART BROKER · ACQUIRED", "Held by the canonical Punk Wallet"],
]);
const previewActivity = Object.freeze([
  ["11:42 AM", "FOUND SOMETHING", "NEON ALLEY · 95% MATCH", "Pixel · Free · 777 supply · X + website · screening and simulation passed"],
  ["10:18 AM", "SCREENED", "ODD HOURS", "Needs review · proxy implementation changed after discovery"],
  ["YESTERDAY", "COLLECTED", "BLUE STUDY #12", "Free mint · 0.00016 ETH gas · asset entered this Punk Wallet"],
]);

const state = { wallet: null, punks: [], selected: null, localStrategy: null, localSkill: null,
  dispatchAfterActivation: false,
  gallery: [], activity: [], hydratedTokenId: null, lastInspection: null,
  ownershipAccount: null, ownershipLoadingAccount: null, ownershipRequestId: 0,
  balanceRequestId: 0, galleryTokenId: null, galleryLoadingTokenId: null,
  fundingPlan: null, wrappedPlan: null, withdrawalAsset: null,
  withdrawalAmount: "1", withdrawalPlan: null, withdrawalBusy: false,
  reviewAgents: new Map(), reviewInspections: new Map(), reviewActivities: new Map(),
  reviewRuns: new Map(), reviewConversations: new Map(), reviewSkills: new Map(),
  reviewMissionPhases: new Map(), reviewDiscoveryBackoffs: new Map(),
  reviewMissionInFlight: new Set(), reviewMintOpportunityId: null,
  reviewMintArtifact: null, reviewMintPrepared: null, reviewMintBusy: false };
const REVIEW_MISSION_POLL_MS = 60_000;
const REVIEW_DISCOVERY_BACKOFF_MS = 5 * 60_000;
const REVIEW_SESSION_STORAGE_KEY = "gogh-art-broker-review-session-v1";
const REVIEW_BROWSER_STORAGE_KEY = "gogh-art-broker-review-browser-v2";
const REVIEW_MISSION_LEASE_KEY = "gogh-art-broker-review-mission-lease-v1";
const REVIEW_MISSION_LEASE_MS = 15_000;
const REVIEW_TAB_ID = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
let reviewMissionTimer = null;
const one = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const set = (selector, value) => { const target = one(selector); if (target) target.textContent = String(value); };
const short = (value) => typeof value === "string" && value.length === 42
  ? `${value.slice(0, 6)}…${value.slice(-4)}` : "NOT ACTIVATED";

function cleanImage(value, fallback = "/assets/gogh-punks-pfp.png") {
  if (typeof value !== "string") return fallback;
  if (/^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    && value.length <= 256_000) return value;
  try {
    const url = new URL(value, location.origin);
    if (url.origin === location.origin) return url.href;
    const seaDn = ["i.seadn.io", "raw2.seadn.io"].includes(url.hostname);
    const fixedIpfs = ["gateway.pinata.cloud", "ipfs.io"].includes(url.hostname)
      && /^\/ipfs\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(?:\/[A-Za-z0-9._~%-]+)*$/.test(url.pathname)
      && !url.search;
    return url.protocol === "https:" && (seaDn || fixedIpfs)
      && !url.username && !url.password && !url.port && !url.hash ? url.href : fallback;
  } catch { return fallback; }
}

function describeMatchBlocker(opportunity) {
  if (!opportunity) return "no current opportunity was available";
  const reasons = new Set(opportunity.blockingReasons ?? []);
  if (reasons.has("WEBSITE_OR_SOCIAL_REQUIRED")) {
    return "closest screened mint has neither a verified website nor social profile";
  }
  if (reasons.has("SIMULATION_NOT_PASSED")) return "closest mint has not passed simulation";
  if (reasons.has("SCREENING_NOT_PASSED")) return "closest mint has not passed contract screening";
  if (reasons.has("GAS_LIMIT_EXCEEDED")) return "closest mint exceeds your gas cap";
  if (reasons.has("DAILY_LIMIT_REACHED")) return "your daily mint limit is reached";
  if (reasons.has("TOTAL_LIMIT_REACHED")) return "your mission mint limit is reached";
  return [...reasons][0]?.replaceAll("_", " ").toLowerCase() ?? "no eligible match";
}

function previewData() {
  state.wallet = { account: PREVIEW_OWNER, chainId: CHAIN_ID, status: "owner" };
  state.punks = previewPunks.map((punk) => ({ ...punk }));
  state.selected = state.punks[0];
  state.gallery = [...previewGallery]; state.activity = [...previewActivity];
}

function selectedReviewKey() {
  if (!state.wallet?.account || !state.selected?.tokenId) return null;
  try { return reviewAgentKey(state.wallet.account, state.selected.tokenId); }
  catch { return null; }
}

function selectedReviewAgent() {
  const key = selectedReviewKey();
  return key ? state.reviewAgents.get(key) ?? null : null;
}

function selectedReviewRun() {
  const key = selectedReviewKey();
  return key ? state.reviewRuns.get(key) ?? null : null;
}

function selectedReviewSkills() {
  const key = selectedReviewKey();
  return key ? state.reviewSkills.get(key) ?? [] : [];
}

function selectedConversationHistory() {
  const key = selectedReviewKey();
  return key ? state.reviewConversations.get(key) ?? [] : [];
}

function selectedReviewSummary() {
  const agent = selectedReviewAgent();
  const run = selectedReviewRun();
  if (!agent && !run) return null;
  const leading = run?.opportunities.find(({ recommendationEligible }) => recommendationEligible) ?? null;
  return { checkedCount: run?.checkedCount ?? 0, eligibleCount: run?.eligibleCount ?? 0,
    leadingCollectionName: leading?.collectionName ?? null,
    leadingMatchScore: leading?.matchScore ?? null,
    missionStatus: agent?.status ?? "IDLE",
    missionTarget: agent?.mission?.targetMatches ?? 0,
    missionFound: agent?.mission?.foundContracts.length ?? 0,
    missionChecks: agent?.mission?.checks ?? 0,
    missionCheckedOpportunities: agent?.mission?.checkedOpportunities ?? 0 };
}

function reviewActivitySnapshot(value) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const limits = [24, 32, 200, 500];
  const entries = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 4
      || entry.some((field, index) => typeof field !== "string"
        || !field.trim() || field.length > limits[index])) return null;
    entries.push(Object.freeze([...entry]));
  }
  return Object.freeze(entries);
}

function persistReviewSessionState() {
  if (!REVIEW_HOST || PREVIEW) return;
  try {
    const agents = [...state.reviewAgents.entries()].slice(0, 100);
    const agentKeys = new Set(agents.map(([key]) => key));
    const activities = [...state.reviewActivities.entries()]
      .filter(([key]) => agentKeys.has(key)).slice(0, 100);
    const skills = [...state.reviewSkills.entries()]
      .filter(([key]) => agentKeys.has(key)).slice(0, 100);
    window.localStorage.setItem(REVIEW_BROWSER_STORAGE_KEY,
      JSON.stringify({ version: 2, agents, activities, skills }));
  } catch { /* Review state remains safely memory-only when browser storage is unavailable. */ }
}

function restoreReviewSessionState(storageValue = null) {
  if (!REVIEW_HOST || PREVIEW) return;
  let migratedFromSession = false;
  try {
    let raw = storageValue ?? window.localStorage.getItem(REVIEW_BROWSER_STORAGE_KEY);
    if (!raw) {
      raw = window.sessionStorage.getItem(REVIEW_SESSION_STORAGE_KEY);
      migratedFromSession = Boolean(raw);
    }
    if (!raw) return;
    const snapshot = JSON.parse(raw);
    if (!snapshot || ![1, 2].includes(snapshot.version) || !Array.isArray(snapshot.agents)
      || !Array.isArray(snapshot.activities) || snapshot.agents.length > 100
      || snapshot.activities.length > 100
      || snapshot.version === 2 && (!Array.isArray(snapshot.skills)
        || snapshot.skills.length > 100)) throw new TypeError("Review browser state is invalid");
    const restoredKeys = new Set();
    for (const entry of snapshot.agents) {
      try {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") continue;
        const agent = normalizeReviewAgentSnapshot(entry[1]);
        const key = reviewAgentKey(agent.owner, agent.punkTokenId);
        if (entry[0] !== key) continue;
        state.reviewAgents.set(key, agent); restoredKeys.add(key);
      } catch { /* One bad Punk snapshot cannot poison another Punk's review state. */ }
    }
    for (const entry of snapshot.activities) {
      if (!Array.isArray(entry) || entry.length !== 2 || !restoredKeys.has(entry[0])) continue;
      const activities = reviewActivitySnapshot(entry[1]);
      if (activities) state.reviewActivities.set(entry[0], activities);
    }
    for (const entry of snapshot.version === 2 ? snapshot.skills : []) {
      if (!Array.isArray(entry) || entry.length !== 2 || !restoredKeys.has(entry[0])
        || !Array.isArray(entry[1]) || entry[1].length > 8) continue;
      try {
        const agent = state.reviewAgents.get(entry[0]);
        const skills = entry[1].map((value) => normalizeReviewSkill(value));
        if (skills.some((skill) => skill.state !== "ACTIVE"
          || reviewAgentKey(skill.expectedOwner, skill.punkTokenId) !== entry[0]
          || skill.punkWallet !== agent.punkWallet)) continue;
        state.reviewSkills.set(entry[0], Object.freeze(skills));
      } catch { /* Invalid browser-carried skills never become active. */ }
    }
    if (migratedFromSession) {
      persistReviewSessionState();
      window.sessionStorage.removeItem(REVIEW_SESSION_STORAGE_KEY);
    }
  } catch {
    if (storageValue === null) {
      window.localStorage.removeItem(REVIEW_BROWSER_STORAGE_KEY);
      window.sessionStorage.removeItem(REVIEW_SESSION_STORAGE_KEY);
    }
  }
}

function reviewMissionLease() {
  try {
    const value = JSON.parse(window.localStorage.getItem(REVIEW_MISSION_LEASE_KEY) ?? "null");
    if (!value || typeof value !== "object" || typeof value.key !== "string"
      || typeof value.holder !== "string" || !Number.isFinite(value.expiresAt)) return null;
    return value;
  } catch { return null; }
}

function acquireReviewMissionLease(key) {
  if (!REVIEW_HOST || PREVIEW) return false;
  try {
    const current = reviewMissionLease();
    if (current && current.expiresAt > Date.now() && current.holder !== REVIEW_TAB_ID) return false;
    const candidate = { key, holder: REVIEW_TAB_ID, expiresAt: Date.now() + REVIEW_MISSION_LEASE_MS };
    window.localStorage.setItem(REVIEW_MISSION_LEASE_KEY, JSON.stringify(candidate));
    const confirmed = reviewMissionLease();
    return confirmed?.key === key && confirmed.holder === REVIEW_TAB_ID;
  } catch { return true; }
}

function releaseReviewMissionLease(key) {
  try {
    const current = reviewMissionLease();
    if (current?.key === key && current.holder === REVIEW_TAB_ID) {
      window.localStorage.removeItem(REVIEW_MISSION_LEASE_KEY);
    }
  } catch { /* An expired lease is harmless. */ }
}

function setReviewAgent(key, agent) {
  state.reviewAgents.set(key, agent);
  persistReviewSessionState();
}

function reviewModeForPunk(punk) {
  if (!punk || !state.wallet?.account) return punk?.mode ?? "ASK";
  try {
    const agent = state.reviewAgents.get(reviewAgentKey(state.wallet.account, punk.tokenId));
    return agent?.status === "PAUSED" ? "PAUSED" : agent?.mode ?? punk.mode ?? "ASK";
  } catch { return punk.mode ?? "ASK"; }
}

function addReviewActivity(type, title, detail) {
  const key = selectedReviewKey();
  if (!key) return;
  const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toUpperCase();
  const existing = state.reviewActivities.get(key) ?? [];
  if (existing[0]?.[1] === type && existing[0]?.[2] === title && existing[0]?.[3] === detail) {
    renderActivity();
    return;
  }
  state.reviewActivities.set(key, [[time, type, title, detail], ...existing].slice(0, 20));
  persistReviewSessionState();
  renderActivity();
}

function setReviewMissionPhase(key, phase, nextCheckAt = null) {
  state.reviewMissionPhases.set(key, { phase, nextCheckAt });
  renderMissionMonitor();
}

function hoodGreeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "HOOD MORNING";
  if (hour < 18) return "HOOD AFTERNOON";
  return "HOOD EVENING";
}

function renderWelcomeMessage() {
  const target = one("[data-welcome-message]");
  if (!target) return;
  const greeting = hoodGreeting();
  const agent = selectedReviewAgent();
  if (agent?.status === "SCOUTING") {
    target.textContent = `${greeting}. I’M OUT SCOUTING: ${agent.mission.foundContracts.length}/${agent.mission.targetMatches} MISSION MATCHES. Open Activity for my live status.`;
  } else if (agent?.status === "RETURNED") {
    target.textContent = `${greeting}. I’M BACK—MISSION COMPLETE WITH ${agent.mission.foundContracts.length}/${agent.mission.targetMatches} MATCHES.`;
  } else if (agent?.status === "PAUSED") {
    target.textContent = `${greeting}. I’M PAUSED. Tell me when you want to set a new mission.`;
  } else if (agent?.status === "ACTIVE") {
    target.textContent = `${greeting}. MY RULES ARE READY. Send me out when you’re ready.`;
  } else {
    target.textContent = `${greeting}. Give me a direction and I’ll turn it into rules you can review.`;
  }
}

function missionClock(value, fallback) {
  if (!value || !Number.isFinite(Date.parse(value))) return fallback;
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }).toUpperCase();
}

function renderMissionMonitor() {
  const monitor = one("[data-mission-monitor]");
  if (!monitor) return;
  const key = selectedReviewKey();
  const agent = selectedReviewAgent();
  if (!key || !agent) { monitor.hidden = true; return; }
  monitor.hidden = false;
  const mission = agent.mission ?? null;
  const livePhase = state.reviewMissionPhases.get(key) ?? null;
  const phase = livePhase?.phase ?? (agent.status === "SCOUTING" ? "WAITING" : agent.status);
  const phaseCopy = {
    ACTIVE: "READY TO BE SENT OUT",
    REFRESHING: "REFRESHING THE LIVE ROBINHOOD NFT OPPORTUNITY QUEUE",
    SCREENING: "SCREENING AND SIMULATING CURRENT CANDIDATES",
    WAITING: "WAITING FOR THE NEXT LIVE DISCOVERY CHECK",
    RETRY: "LAST CHECK FAILED SAFELY · RETRY SCHEDULED",
    RETURNED: "MISSION COMPLETE · PUNK RETURNED",
    PAUSED: "MISSION PAUSED BY OWNER",
  };
  set("[data-mission-status]", agent.status === "SCOUTING" ? "OUT · SCOUTING" : agent.status);
  set("[data-mission-phase]", phaseCopy[phase] ?? "MISSION STATE AVAILABLE");
  set("[data-mission-progress]", mission
    ? `${mission.foundContracts.length} / ${mission.targetMatches} MATCHES` : "NOT SENT");
  set("[data-mission-checked]", mission?.checkedOpportunities ?? 0);
  set("[data-mission-scans]", mission?.checks ?? 0);
  const discoveryBackoff = state.reviewDiscoveryBackoffs.get(key) ?? 0;
  set("[data-mission-queue]", phase === "REFRESHING" ? "REFRESHING LIVE"
    : discoveryBackoff > Date.now() ? "LAST CONFIRMED" : REVIEW_HOST ? "LIVE" : "NOT CONNECTED");
  set("[data-mission-last-check]", missionClock(mission?.lastCheckedAt, "NOT YET"));
  let nextCheck = "NOT SCHEDULED";
  if (agent.status === "SCOUTING") {
    const defaultNext = Date.parse(mission?.lastCheckedAt ?? mission?.startedAt ?? "") + REVIEW_MISSION_POLL_MS;
    const nextAt = livePhase?.nextCheckAt ?? defaultNext;
    const seconds = Math.max(0, Math.ceil((nextAt - Date.now()) / 1_000));
    nextCheck = ["REFRESHING", "SCREENING"].includes(phase) ? "CHECKING NOW"
      : seconds === 0 ? "DUE NOW" : `${seconds} SECOND${seconds === 1 ? "" : "S"}`;
  } else if (agent.status === "RETURNED") nextCheck = "MISSION COMPLETE";
  else if (agent.status === "PAUSED") nextCheck = "PAUSED";
  set("[data-mission-next-check]", nextCheck);
}

function renderReviewAgent() {
  const reviewSurface = PREVIEW || REVIEW_HOST;
  const consolePanel = one("[data-review-agent-console]");
  const strategyState = one("[data-review-strategy-state]");
  if (consolePanel) consolePanel.hidden = !reviewSurface;
  if (strategyState) strategyState.hidden = !reviewSurface;
  if (!reviewSurface) return;
  renderWelcomeMessage();
  const agent = selectedReviewAgent();
  const run = selectedReviewRun();
  const pipeline = reviewInspectionPipeline(state.lastInspection);
  set("[data-review-agent-status]", agent?.status ?? "IDLE");
  set("[data-review-agent-strategy]", agent
    ? `${agent.mode} · ${agent.status}` : "NOT STARTED");
  set("[data-review-agent-route]", run
    ? run.testMode ? "PREVIEW TEST LANE" : "ROBINHOOD NFT QUEUE" : "NOT DISPATCHED");
  set("[data-review-agent-discovery]", run
    ? `${run.checkedCount} CHECKED${run.testOpportunityCount ? " · 1 TEST" : ""}` : pipeline.discovery);
  const leading = run?.opportunities?.find(({ recommendationEligible }) => recommendationEligible)
    ?? run?.opportunities?.find(({ screeningStatus, simulationStatus }) => (
      screeningStatus === "PASSED" && simulationStatus === "PASSED"))
    ?? run?.opportunities?.find(({ screeningStatus }) => screeningStatus === "PASSED")
    ?? run?.opportunities?.[0] ?? null;
  set("[data-review-agent-contract]", leading
    ? short(leading.collectionContract) : pipeline.contract);
  set("[data-review-agent-screen]", run
    ? `${run.screeningPassedCount}/${run.checkedCount} ${run.testMode ? "TEST PASS" : "PASSED"}` : pipeline.screening);
  set("[data-review-agent-simulation]", run
    ? `${run.simulationPassedCount}/${run.checkedCount} ${run.testMode ? "TEST PASS" : "PASSED"}` : pipeline.simulation);
  set("[data-review-agent-decision]", run
    ? run.eligibleCount ? `${run.eligibleCount} ${run.testMode ? "TEST MATCH" : "MATCHED"}`
      : "NO ELIGIBLE MATCH" : pipeline.decision);
  const dailyLimit = one("[data-review-daily-limit]");
  const totalLimit = one("[data-review-total-limit]");
  const daily = agent?.intent.dailyMintLimit;
  const total = agent?.intent.totalMintLimit;
  if (dailyLimit) dailyLimit.textContent = agent
    ? `${daily} MINT${daily === 1 ? "" : "S"} / DAY` : "NOT SET";
  if (totalLimit) totalLimit.textContent = agent
    ? `${total} MINT${total === 1 ? "" : "S"} MAX` : "NOT SET";
  set("[data-review-limit-note]", agent
    ? "These are confirmed rules. To change them, tell your Punk in chat and approve the new complete draft."
    : "Set every mission parameter in chat. Your Punk will show one complete draft for review before anything changes.");
  const runButton = one("[data-review-agent-run]");
  const recallButton = one("[data-review-agent-recall]");
  const testButton = one("[data-review-agent-test]");
  const runBusy = runButton.dataset.busy === "true" || testButton.dataset.busy === "true";
  runButton.disabled = runBusy || !agent || agent.status !== "ACTIVE";
  recallButton.hidden = agent?.status !== "SCOUTING";
  recallButton.disabled = agent?.status !== "SCOUTING";
  testButton.disabled = runBusy || !agent || agent.status !== "ACTIVE";
  runButton.textContent = runBusy || agent?.status === "SCOUTING" ? "PUNK IS OUT…"
    : agent?.status === "RETURNED" ? "MISSION COMPLETE" : "SEND PUNK OUT";
  testButton.textContent = runBusy ? "TESTING…" : "RUN SAFE TEST";
  set("[data-review-agent-run-note]", !agent
    ? "Confirm an ASK or ASSIST strategy first."
    : agent.status === "SCOUTING"
      ? `Mission active: ${agent.mission.foundContracts.length}/${agent.mission.targetMatches} unique matches. Rechecks every minute while this preview is open in at least one tab.`
      : agent.status === "RETURNED"
        ? `Mission complete: ${agent.mission.foundContracts.length} unique matches found.`
        : agent.status !== "ACTIVE" ? "This review agent is paused."
      : run ? run.testMode
        ? `Safe test only: ${run.eligibleCount} test card matched; no live opportunity or transaction.`
        : run.eligibleCount ? `Last run checked ${run.checkedCount}; ${run.eligibleCount} matched.`
          : `No MetaMask request yet · ${describeMatchBlocker(leading)}.`
        : "Runs one read-only check against Robinhood NFT opportunities.");
  const eligibleMint = run?.testMode ? null
    : run?.opportunities?.find(({ recommendationEligible }) => recommendationEligible) ?? null;
  const mintPanel = one("[data-review-live-mint]");
  const mintAvailable = REVIEW_HOST && !PREVIEW && agent?.mode === "ASSIST" && eligibleMint;
  if (mintPanel) mintPanel.hidden = !mintAvailable;
  if (mintAvailable) {
    if (state.reviewMintOpportunityId !== eligibleMint.opportunityId) {
      state.reviewMintOpportunityId = eligibleMint.opportunityId;
      state.reviewMintArtifact = null; state.reviewMintPrepared = null;
      one("[data-review-mint-confirm]").checked = false;
      one("[data-review-mint-transaction]").hidden = true;
      set("[data-review-mint-status]", "One exact owner-approved mint can be reviewed. Nothing has been prepared or submitted.");
    }
    set("[data-review-mint-name]", eligibleMint.collectionName);
    set("[data-review-mint-detail]", `${eligibleMint.matchScore}% strategy match · 0 ETH mint · quantity 1 · NFT enters ${short(agent.punkWallet)}`);
    const mintButton = one("[data-review-mint-submit]");
    mintButton.disabled = state.reviewMintBusy;
    mintButton.textContent = state.reviewMintBusy ? "CHECKING LIVE STATE…"
      : state.reviewMintPrepared ? "SUBMIT IN METAMASK" : "REVIEW & SIMULATE";
  }
  set("[data-review-strategy-label]", agent
    ? `REVIEW AGENT ${agent.status}` : "NO REVIEW AGENT");
  set("[data-review-strategy-detail]", agent
    ? `${agent.mode} rules are remembered for this Punk in this browser. ${agent.status === "SCOUTING" ? "Mission is out scouting. " : ""}Authority: NONE.`
    : "Confirm a strategy draft to start this Punk in the review browser profile.");
  if (!agent) {
    set("[data-strategy-name]", "NOT CONFIGURED");
    set("[data-strategy-price]", "FREE ONLY");
    set("[data-strategy-gas]", "0.0005 ETH");
    set("[data-strategy-daily]", "1");
    set("[data-strategy-total]", "1");
    set("[data-strategy-reserve]", "0.0000 ETH");
    set("[data-strategy-presence]", "— WEBSITE + SOCIAL OPTIONAL");
    const tastes = one("[data-strategy-tastes]"); tastes.replaceChildren();
    const empty = document.createElement("span");
    empty.textContent = "Talk to your Punk to define explicit preferences."; tastes.append(empty);
    all('input[name="mode"]').forEach((input) => { input.checked = input.value === "ASK"; });
    return;
  }
  const intent = agent.intent;
  set("[data-strategy-name]", intent.preferences.prefer.length
    ? intent.preferences.prefer.map((style) => style.replaceAll("_", " ")).join(" + ")
    : "OPEN TASTE");
  set("[data-strategy-price]", intent.mintMode === "FREE_ONLY"
    ? "FREE ONLY" : `UP TO ${intent.maxMintPriceWei} WEI`);
  set("[data-strategy-gas]", `${ethFromWei(intent.maxGasPerMintWei)} ETH`);
  set("[data-strategy-daily]", intent.dailyMintLimit);
  set("[data-strategy-total]", intent.totalMintLimit);
  set("[data-strategy-reserve]", `${ethFromWei(intent.minimumReserveWei)} ETH`);
  const tastes = one("[data-strategy-tastes]"); tastes.replaceChildren();
  const entries = [
    ...intent.preferences.prefer.map((style) => [style, false]),
    ...intent.preferences.avoid.map((style) => [style, true]),
  ];
  if (!entries.length) {
    const empty = document.createElement("span"); empty.textContent = "OPEN TASTE"; tastes.append(empty);
  } else {
    for (const [style, avoided] of entries) {
      const tag = document.createElement("span");
      tag.textContent = `${avoided ? "AVOID " : ""}${style.replaceAll("_", " ")}`;
      if (avoided) tag.dataset.avoid = "true";
      tastes.append(tag);
    }
  }
  const presenceRule = intent.onlinePresenceRequirement === "WEBSITE_OR_SOCIAL"
    ? "✓ WEBSITE OR SOCIAL REQUIRED"
    : intent.requiresWebsite && intent.requiresSocial
      ? `✓ WEBSITE + ${intent.preferredSocialPlatforms.join(" + ") || "SOCIAL"} REQUIRED`
      : intent.requiresWebsite ? "✓ WEBSITE REQUIRED"
        : intent.requiresSocial
          ? `✓ ${intent.preferredSocialPlatforms.join(" + ") || "SOCIAL"} REQUIRED`
          : "— WEBSITE + SOCIAL OPTIONAL";
  set("[data-strategy-presence]", presenceRule);
  all('input[name="mode"]').forEach((input) => { input.checked = input.value === agent.mode; });
}

function renderReviewSkills() {
  const list = one("[data-punk-skills]");
  if (!list) return;
  list.replaceChildren();
  const skills = selectedReviewSkills();
  set("[data-punk-skill-count]", skills.length);
  if (!skills.length) {
    const empty = document.createElement("li");
    empty.textContent = "No taught skills yet. Teach one in chat.";
    list.append(empty); return;
  }
  for (const skill of skills) {
    const item = document.createElement("li");
    const name = document.createElement("b"); name.textContent = skill.name;
    const detail = document.createElement("small");
    detail.textContent = `${skill.capabilities.map((value) => value.replaceAll("_", " ")).join(" · ")} · READ ONLY`;
    item.append(name, detail); list.append(item);
  }
}

function startReviewAgent(draft) {
  const key = selectedReviewKey();
  if (!key || !state.selected?.account) throw new Error("Select an owned Punk Wallet first.");
  const agent = activateReviewAgent(draft, { owner: state.wallet.account,
    punkTokenId: state.selected.tokenId, punkWallet: state.selected.account });
  setReviewAgent(key, agent);
  state.reviewRuns.delete(key);
  state.selected.mode = agent.mode;
  state.selected.reserveEth = ethFromWei(agent.intent.minimumReserveWei);
  renderSelected();
  addReviewActivity("READY", `${agent.mode} REVIEW AGENT STARTED`,
    "Structured rules active in this browser · production authority none");
  return agent;
}

function scheduleSelectedReviewMissionCheck() {
  if (reviewMissionTimer !== null) window.clearTimeout(reviewMissionTimer);
  reviewMissionTimer = null;
  const agent = selectedReviewAgent();
  if (!REVIEW_HOST || PREVIEW || agent?.status !== "SCOUTING") return;
  const key = selectedReviewKey();
  if (!key || state.reviewMissionInFlight.has(key) || !acquireReviewMissionLease(key)) return;
  const scheduled = key ? state.reviewMissionPhases.get(key)?.nextCheckAt : null;
  const previousCheck = agent.mission.lastCheckedAt ?? agent.mission.startedAt;
  const nextCheckAt = scheduled ?? Date.parse(previousCheck) + REVIEW_MISSION_POLL_MS;
  const delay = Math.max(0, nextCheckAt - Date.now());
  reviewMissionTimer = window.setTimeout(() => {
    reviewMissionTimer = null;
    void sendReviewAgentOut({ continueMission: true });
  }, delay);
}

function recallSelectedReviewAgent() {
  const key = selectedReviewKey(); const agent = selectedReviewAgent();
  if (!key || agent?.status !== "SCOUTING") return;
  if (reviewMissionTimer !== null) window.clearTimeout(reviewMissionTimer);
  reviewMissionTimer = null;
  const recalled = pauseReviewAgent(agent);
  setReviewAgent(key, recalled);
  setReviewMissionPhase(key, "PAUSED");
  releaseReviewMissionLease(key);
  state.selected.mode = "PAUSED";
  renderSelected();
  addReviewActivity("CALLED BACK", "PUNK CALLED BACK BY OWNER",
    `${recalled.mission.foundContracts.length}/${recalled.mission.targetMatches} mission matches · scouting stopped · no transaction submitted`);
  addMessage("punk", "I’M BACK. SCOUTING HAS STOPPED, THE MISSION TIMER IS OFF, AND NOTHING WAS SUBMITTED.");
}

async function sendReviewAgentOut({ testMode = false, continueMission = false } = {}) {
  let agent = selectedReviewAgent(); const key = selectedReviewKey();
  const button = testMode ? one("[data-review-agent-test]") : one("[data-review-agent-run]");
  if (!agent || !key || (testMode && agent.status !== "ACTIVE")
    || (!testMode && !["ACTIVE", "SCOUTING"].includes(agent.status))
    || (continueMission && agent.status !== "SCOUTING")) return;
  if (state.reviewMissionInFlight.has(key)) return;
  if (!REVIEW_HOST || PREVIEW) {
    addMessage("punk", "Shared V2 discovery is connected only on the hosted PR review. Nothing was dispatched.");
    return;
  }
  if (!testMode && !acquireReviewMissionLease(key)) {
    renderMissionMonitor();
    return;
  }
  state.reviewMissionInFlight.add(key);
  const tokenId = state.selected.tokenId;
  if (!testMode && agent.status === "ACTIVE") {
    agent = dispatchReviewAgent(agent);
    setReviewAgent(key, agent);
    addReviewActivity("OUT", "PUNK SENT TO ROBINHOOD NFT DISCOVERY",
      `Mission target · ${agent.mission.targetMatches} unique eligible match${agent.mission.targetMatches === 1 ? "" : "es"}`);
  }
  if (!testMode) setReviewMissionPhase(key, "REFRESHING");
  button.dataset.busy = "true"; button.disabled = true; renderReviewAgent();
  try {
    let refreshDegraded = false;
    const refreshAfter = state.reviewDiscoveryBackoffs.get(key) ?? 0;
    if (!testMode && Date.now() >= refreshAfter) {
      try {
        await jsonRequest("/api/v2/admin/discovery/ingest", {
          method: "POST", headers: { "content-type": "application/json" },
          body: "{}", timeoutMs: 45_000,
        });
        state.reviewDiscoveryBackoffs.delete(key);
      } catch {
        refreshDegraded = true;
        state.reviewDiscoveryBackoffs.set(key, Date.now() + REVIEW_DISCOVERY_BACKOFF_MS);
        addReviewActivity("DEGRADED", "LIVE QUEUE REFRESH RATE-LIMITED",
          "Scanning the last confirmed Robinhood NFT queue · live refresh will retry in five minutes");
      }
    } else if (!testMode) refreshDegraded = true;
    if (!testMode && selectedReviewAgent()?.status !== "SCOUTING") return;
    if (!testMode) setReviewMissionPhase(key, "SCREENING");
    const response = await jsonRequest("/api/v2/review/run", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({
        owner: agent.owner, tokenId, intent: agent.intent,
        ...(testMode ? { testMode: "SAFE_FIXTURE" } : {}),
      }), timeoutMs: 20_000 });
    const run = normalizeReviewAgentRun(response, tokenId);
    if (!testMode && selectedReviewAgent()?.status !== "SCOUTING") return;
    state.reviewRuns.set(key, run);
    const leading = run.opportunities.find(({ recommendationEligible }) => recommendationEligible);
    const closest = leading
      ?? run.opportunities.find(({ screeningStatus, simulationStatus }) => (
        screeningStatus === "PASSED" && simulationStatus === "PASSED"))
      ?? run.opportunities.find(({ screeningStatus }) => screeningStatus === "PASSED")
      ?? run.opportunities[0] ?? null;
    if (testMode) {
      addReviewActivity("SCOUTED", "SAFE PIPELINE TEST COMPLETED",
        `${run.checkedCount} checked · ${run.eligibleCount} eligible · no live mint`);
      addMessage("punk", leading
        ? `TEST COMPLETE. The non-live ${leading.collectionName} card matched at ${leading.matchScore}%. Ownership, rules, screen state, and simulation state flowed end to end. No live mint or transaction exists.`
        : "TEST COMPLETE. The non-live test card was rejected by the current rules. No live mint or transaction exists.");
    } else {
      agent = recordReviewMissionRun(agent, run);
      setReviewAgent(key, agent);
      const returned = agent.status === "RETURNED";
      setReviewMissionPhase(key, returned ? "RETURNED" : "WAITING",
        returned ? null : Date.parse(agent.mission.lastCheckedAt) + REVIEW_MISSION_POLL_MS);
      if (returned) releaseReviewMissionLease(key);
      addReviewActivity(returned ? "RETURNED" : "SCOUTING",
        returned ? "PUNK RETURNED · MISSION COMPLETE" : "PUNK REMAINS OUT SCOUTING",
        `${agent.mission.foundContracts.length}/${agent.mission.targetMatches} unique matches · ${agent.mission.checks} checks · ${run.checkedCount} checked this pass · ${run.screeningPassedCount} screened · ${run.simulationPassedCount} simulated${run.eligibleCount ? "" : ` · blocked: ${describeMatchBlocker(closest)}`}${refreshDegraded ? " · last confirmed queue" : " · live queue refreshed"}`);
      addMessage("punk", returned
        ? `I'M BACK. MISSION COMPLETE: ${agent.mission.foundContracts.length} UNIQUE ELIGIBLE MATCH${agent.mission.foundContracts.length === 1 ? "" : "ES"} FOUND.${leading ? ` Best current match: ${leading.collectionName}, ${leading.matchScore}%.` : ""} Nothing was submitted.`
        : leading
          ? `I FOUND ${leading.collectionName} AT ${leading.matchScore}% MATCH, BUT MY MISSION ISN'T COMPLETE. I'M STAYING OUT: ${agent.mission.foundContracts.length}/${agent.mission.targetMatches} UNIQUE MATCHES. Nothing was submitted.`
          : `STILL OUT. I CHECKED ${run.checkedCount} ROBINHOOD NFT OPPORTUNITIES AND FOUND NO NEW ELIGIBLE MATCH. NO METAMASK REQUEST YET: ${describeMatchBlocker(closest)}. I'LL CHECK AGAIN IN ONE MINUTE. Nothing was submitted.`);
    }
  } catch (error) {
    if (!testMode && agent.status === "SCOUTING") {
      setReviewMissionPhase(key, "RETRY", Date.now() + REVIEW_MISSION_POLL_MS);
      addReviewActivity("RETRY", "SCOUT CHECK FAILED · RETRY SCHEDULED",
        "The check failed safely · Punk remains out · next attempt in one minute · no transaction submitted");
    }
    addMessage("punk", `${error?.message ?? "Shared discovery is unavailable."} ${agent.status === "SCOUTING" ? "I'M STAYING OUT AND WILL RETRY. " : ""}Nothing was submitted or authorized.`);
  } finally {
    state.reviewMissionInFlight.delete(key);
    delete button.dataset.busy; renderReviewAgent();
    scheduleSelectedReviewMissionCheck();
  }
}

async function runOwnerAssistedLiveMint() {
  if (state.reviewMintBusy || !REVIEW_HOST || PREVIEW) return;
  const agent = selectedReviewAgent(); const run = selectedReviewRun(); const punk = state.selected;
  const opportunity = run?.opportunities?.find(({ recommendationEligible, previewFixture }) => (
    recommendationEligible && !previewFixture));
  const confirmed = one("[data-review-mint-confirm]");
  const output = one("[data-review-mint-status]");
  const link = one("[data-review-mint-transaction]");
  if (!agent || agent.mode !== "ASSIST" || !punk?.account || !opportunity) {
    output.textContent = "A live eligible match under a confirmed ASSIST strategy is required.";
    return;
  }
  if (!confirmed.checked) {
    output.textContent = "Review the exact free-mint conditions and check the confirmation box first.";
    return;
  }
  const provider = window.__GOGH_WALLET_PROVIDER__;
  if (!provider?.request || !state.wallet?.account || state.wallet.chainId !== CHAIN_ID) {
    output.textContent = "Connect the current Punk owner on Robinhood Chain first.";
    return;
  }
  const selection = { owner: state.wallet.account, account: punk.account, tokenId: punk.tokenId };
  const stillCurrent = () => state.selected?.tokenId === selection.tokenId
    && state.selected?.account?.toLowerCase() === selection.account.toLowerCase()
    && state.wallet?.account === selection.owner && one("[data-review-mint-confirm]").checked
    && state.reviewMintOpportunityId === opportunity.opportunityId;
  state.reviewMintBusy = true; renderReviewAgent();
  let submittedHash = null;
  let chainConfirmed = false;
  try {
    if (!state.reviewMintPrepared) {
      await ensureV2Session();
      output.textContent = "Rechecking the live drop, contract code, Punk ownership, strategy limits, and exact quantity-one simulation…";
      const payload = await jsonRequest("/api/v2/review/mint", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({
          owner: agent.owner, tokenId: punk.tokenId, intent: agent.intent,
          opportunityId: opportunity.opportunityId,
        }), timeoutMs: 30_000 });
      if (payload.attemptId !== payload.mint?.attemptId) {
        throw new Error("The live mint reservation is inconsistent.");
      }
      if (!stillCurrent()) throw new Error("The selected Punk, owner, or match changed during review.");
      const recoveryPayload = await jsonRequest(
        `/api/broker/nft-withdrawal-status?tokenId=${encodeURIComponent(punk.tokenId)}`);
      if (!recoveryPayload.recovery?.capability) {
        throw new Error("The verified Punk Wallet recovery gate is unavailable.");
      }
      const prepared = await preflightOwnerAssistedMint(provider, payload.mint, selection,
        recoveryPayload.recovery);
      if (!stillCurrent()) throw new Error("The selected Punk, owner, or match changed before approval.");
      state.reviewMintArtifact = payload.mint; state.reviewMintPrepared = prepared;
      output.textContent = `SIMULATION PASSED · ${payload.mint.collectionName} · token #${payload.mint.expectedTokenId} · 0 ETH · quantity 1 · estimated gas ${ethFromWei(prepared.gasCostWei)} ETH. Review once more, then submit.`;
      addReviewActivity("SIMULATED", "LIVE MINT READY FOR OWNER",
        `${payload.mint.collectionName} · token #${payload.mint.expectedTokenId} · 0 ETH · quantity 1 · nothing submitted`);
      return;
    }
    output.textContent = "Re-simulating the exact call before opening MetaMask…";
    const recoveryPayload = await jsonRequest(
      `/api/broker/nft-withdrawal-status?tokenId=${encodeURIComponent(punk.tokenId)}`);
    const prepared = await preflightOwnerAssistedMint(provider, state.reviewMintArtifact,
      selection, recoveryPayload.recovery);
    if (!stillCurrent()) throw new Error("The selected Punk, owner, or match changed before submission.");
    output.textContent = "Waiting for MetaMask. Mint price is fixed at 0 ETH; your owner wallet pays network gas.";
    const hash = await submitOwnerAssistedMint(provider, prepared);
    submittedHash = hash;
    link.href = `https://robinhoodchain.blockscout.com/tx/${hash}`; link.hidden = false;
    output.textContent = "Mint submitted. Waiting for Robinhood Chain confirmation and NFT ownership verification…";
    addReviewActivity("SUBMITTED", "OWNER-APPROVED MINT SUBMITTED",
      `${prepared.mint.collectionName} · ${hash.slice(0, 10)}… · waiting for confirmation`);
    try {
      await jsonRequest("/api/v2/review/mint-receipt", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({
          attemptId: prepared.mint.attemptId, owner: selection.owner,
          tokenId: selection.tokenId, transactionHash: hash,
        }), timeoutMs: 20_000 });
    } catch { /* The confirmed receipt path below retries after wallet RPC catches up. */ }
    const receipt = await confirmOwnerAssistedMint(provider, prepared, hash);
    chainConfirmed = true;
    let recorded = false;
    let recordError = null;
    for (let attempt = 0; attempt < 3 && !recorded; attempt += 1) {
      try {
        const recordedReceipt = await jsonRequest("/api/v2/review/mint-receipt", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({
            attemptId: prepared.mint.attemptId, owner: selection.owner,
            tokenId: selection.tokenId, transactionHash: hash,
          }), timeoutMs: 20_000 });
        if (recordedReceipt.confirmed !== true) {
          throw new Error("The server is still waiting for the confirmed receipt.");
        }
        recorded = true;
      } catch (error) {
        recordError = error;
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
    }
    output.textContent = `MINT CONFIRMED ✓ ${prepared.mint.collectionName} #${receipt.tokenId} is held by Punk #${punk.tokenId}.`;
    addReviewActivity("COLLECTED", `MINT CONFIRMED · ${prepared.mint.collectionName}`,
      `Token #${receipt.tokenId} · 0 ETH · owner-approved MetaMask transaction${recorded ? " · server receipt verified" : " · receipt reconciliation pending"}`);
    addMessage("punk", `I'M BACK WITH ${prepared.mint.collectionName} #${receipt.tokenId}. THE NFT IS VERIFIED IN MY PUNK WALLET.`);
    if (!recorded) {
      output.textContent += ` The on-chain mint succeeded, but the activity receipt still needs server reconciliation: ${recordError?.message ?? "temporarily unavailable"}.`;
    }
    state.reviewMintArtifact = null; state.reviewMintPrepared = null;
    confirmed.checked = false;
    await loadReviewCollection(punk, { collection: receipt.collection, tokenId: receipt.tokenId });
  } catch (error) {
    state.reviewMintArtifact = null; state.reviewMintPrepared = null;
    output.textContent = submittedHash
      ? `${error?.message ?? "Confirmation could not be verified."} A transaction was submitted; check the linked Robinhood Chain receipt before trying again.`
      : `${error?.message ?? "The live mint stopped safely."} No transaction was submitted.`;
    addReviewActivity(chainConfirmed ? "RECONCILE" : "STOPPED",
      chainConfirmed ? "MINT CONFIRMED · RECEIPT RECONCILIATION NEEDED" : "LIVE MINT STOPPED SAFELY",
      submittedHash
        ? `${error?.code ?? "CONFIRMATION_FAILED"} · transaction ${submittedHash.slice(0, 10)}… may require review`
        : `${error?.code ?? "PRECHECK_FAILED"} · no transaction submitted`);
  } finally {
    state.reviewMintBusy = false; renderReviewAgent();
  }
}

function renderRoster() {
  const roster = one("[data-punk-roster]");
  roster.replaceChildren();
  set("[data-roster-count]", state.punks.length);
  one("[data-roster-empty]").hidden = state.punks.length > 0;
  one("[data-selected-stage]").hidden = state.punks.length === 0;
  for (const punk of state.punks) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "roster-slot"; button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(punk.tokenId === state.selected?.tokenId));
    button.dataset.tokenId = punk.tokenId;
    const image = document.createElement("img"); image.alt = `Gogh Punk #${punk.tokenId}`;
    image.src = cleanImage(punk.image);
    const label = document.createElement("span");
    const name = document.createElement("b"); name.textContent = `#${punk.tokenId}`;
    const mode = document.createElement("small"); mode.textContent = reviewModeForPunk(punk);
    label.append(name, mode); button.append(image, label);
    button.addEventListener("click", () => selectPunk(punk.tokenId));
    roster.append(button);
  }
}

function renderSelected() {
  const punk = state.selected;
  if (!punk) return;
  const displayMode = reviewModeForPunk(punk);
  all("[data-punk-token], [data-talk-token], [data-chat-token]").forEach((node) => { node.textContent = punk.tokenId; });
  set("[data-hero-number]", punk.tokenId);
  set("[data-punk-mode]", displayMode);
  set("[data-strategy-mode]", `${displayMode} MODE`);
  set("[data-punk-wallet]", short(punk.account));
  set("[data-fund-wallet]", short(punk.account));
  const balance = Number(punk.balanceEth ?? 0); const reserve = Number(punk.reserveEth ?? 0);
  const available = Math.max(0, balance - reserve);
  const balanceKnown = punk.balanceLoaded !== false;
  const nativeDisplay = balanceKnown ? `${balance.toFixed(4)} ETH` : "CHECKING…";
  const wethDisplay = punk.wethBalanceEth == null ? "CHECKING…" : `${punk.wethBalanceEth} WETH`;
  set("[data-punk-balance]", nativeDisplay);
  set("[data-fund-balance]", balanceKnown ? balance.toFixed(4) : "—");
  set("[data-wrap-eth-balance]", nativeDisplay);
  set("[data-wrap-weth-balance]", wethDisplay);
  set("[data-collection-eth]", nativeDisplay);
  set("[data-collection-weth]", wethDisplay);
  set("[data-punk-nfts]", punk.nfts ?? 0); set("[data-gallery-count]", state.gallery.length);
  set("[data-punk-reserve]", `${reserve.toFixed(4)} ETH`);
  set("[data-fund-reserve]", `${reserve.toFixed(4)} ETH`);
  set("[data-available-budget]", `${available.toFixed(4)} ETH AVAILABLE`);
  set("[data-fund-available]", `${available.toFixed(4)} ETH`);
  const meter = one("[data-budget-meter]"); if (meter) meter.style.width = `${balance ? Math.min(100, available / balance * 100) : 0}%`;
  all("[data-hero-art], [data-chat-avatar]").forEach((image) => { image.src = cleanImage(punk.image); });
  all("[data-legacy-vault]").forEach((link) => { link.href = `/broker/punk/${punk.tokenId}?tab=assets`; });
  renderRoster(); renderGallery(); renderActivity(); renderReviewAgent(); renderReviewSkills();
  window.dispatchEvent(new CustomEvent("gogh:owner-snapshot", { detail: {
    address: state.wallet?.account ?? null, tokenId: punk.tokenId,
  } }));
  window.dispatchEvent(new CustomEvent("gogh:punk-selected", { detail: {
    owner: state.wallet?.account ?? null, tokenId: punk.tokenId,
  } }));
}

function selectPunk(tokenId) {
  const punk = state.punks.find((item) => item.tokenId === tokenId);
  if (!punk) return;
  state.selected = punk; state.localStrategy = null; state.localSkill = null; state.lastInspection = null;
  const key = selectedReviewKey();
  state.lastInspection = key ? state.reviewInspections.get(key) ?? null : null;
  state.hydratedTokenId = null; state.galleryTokenId = null; state.galleryLoadingTokenId = null;
  state.fundingPlan = null; state.wrappedPlan = null; state.withdrawalAsset = null;
  state.reviewMintOpportunityId = null; state.reviewMintArtifact = null;
  state.reviewMintPrepared = null; state.reviewMintBusy = false;
  state.withdrawalAmount = "1"; state.withdrawalPlan = null; state.withdrawalBusy = false;
  if (!PREVIEW) { state.gallery = []; state.activity = []; }
  renderSelected(); renderCollectionWithdrawal(); scheduleSelectedReviewMissionCheck();
  one("[data-selected-stage]").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function renderGallery() {
  const grid = one("[data-gallery-grid]"); grid.replaceChildren();
  if (!state.gallery.length) {
    const empty = document.createElement("p"); empty.className = "panel-empty";
    empty.textContent = PREVIEW ? "This Punk has no displayed pieces." : "Open COLLECTION to load this Punk Wallet gallery.";
    grid.append(empty); return;
  }
  for (const entry of state.gallery) {
    const itemData = Array.isArray(entry) ? {
      image: entry[0], title: entry[1], provenance: entry[2], detail: entry[3],
    } : entry;
    const item = document.createElement("article"); item.className = "gallery-item";
    const image = document.createElement("img"); image.src = cleanImage(itemData.image); image.alt = itemData.title;
    const copy = document.createElement("div"); const type = document.createElement("span"); type.textContent = itemData.provenance;
    const heading = document.createElement("h3"); heading.textContent = itemData.title;
    const text = document.createElement("p"); text.textContent = itemData.detail;
    copy.append(type, heading, text);
    if (itemData.tokenId && state.selected) {
      const actions = document.createElement("div"); actions.className = "gallery-actions";
      if (typeof itemData.openSeaUrl === "string") {
        try {
          const openSea = new URL(itemData.openSeaUrl);
          if (openSea.protocol === "https:" && openSea.hostname === "opensea.io") {
            const view = document.createElement("a"); view.href = openSea.href; view.target = "_blank";
            view.rel = "noopener noreferrer"; view.textContent = "VIEW"; actions.append(view);
          }
        } catch { /* Invalid display links are omitted. */ }
      }
      const withdraw = document.createElement("button"); withdraw.type = "button";
      withdraw.textContent = "WITHDRAW"; withdraw.setAttribute("aria-label", `Withdraw ${itemData.title}`);
      withdraw.disabled = state.withdrawalBusy;
      withdraw.addEventListener("click", () => selectCollectionWithdrawal(itemData));
      actions.append(withdraw); copy.append(actions);
    }
    item.append(image, copy); grid.append(item);
  }
}

function renderActivity() {
  renderMissionMonitor();
  const feed = one("[data-activity-feed]"); feed.replaceChildren();
  const key = selectedReviewKey();
  const seen = new Set();
  const entries = [...(key ? state.reviewActivities.get(key) ?? [] : []), ...state.activity]
    .filter((entry) => {
      const signature = JSON.stringify(entry);
      if (seen.has(signature)) return false;
      seen.add(signature); return true;
    });
  if (!entries.length) {
    const empty = document.createElement("li"); empty.className = "panel-empty";
    empty.textContent = PREVIEW ? "No activity yet." : "Open ACTIVITY to load complete Art Broker history.";
    feed.append(empty); return;
  }
  for (const [time, type, title, detail] of entries) {
    const item = document.createElement("li"); const when = document.createElement("time"); when.textContent = time;
    const copy = document.createElement("div"); const heading = document.createElement("h3"); heading.textContent = title;
    const text = document.createElement("p"); text.textContent = detail; copy.append(heading, text);
    const badge = document.createElement("b"); badge.textContent = type; item.append(when, copy, badge); feed.append(item);
  }
}

function activateTab(name) {
  all("[data-v2-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.v2Tab === name)));
  all("[data-v2-panel]").forEach((panel) => { panel.hidden = panel.dataset.v2Panel !== name; });
  if (name === "activity") renderActivity();
  history.replaceState(null, "", `${location.pathname}?${new URLSearchParams({ ...(PREVIEW ? { preview: "1" } : {}), tab: name })}`);
  const reviewRead = REVIEW_HOST && ["fund", "collection"].includes(name);
  const productRead = !REVIEW_HOST && ["strategy", "fund", "collection", "activity"].includes(name);
  if (!PREVIEW && (reviewRead || productRead)) {
    void hydrateSelected(name);
  }
}

function ethFromWei(value) {
  if (!/^\d+$/.test(String(value ?? ""))) return "0.0000";
  const wei = BigInt(value); const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${fraction}`;
}

async function loadPunkBalances(punk) {
  if (!punk?.account || !state.wallet?.account || state.wallet.chainId !== CHAIN_ID) {
    throw new Error("Choose an activated Punk Wallet on Robinhood Chain.");
  }
  const provider = window.__GOGH_WALLET_PROVIDER__;
  if (!provider?.request) throw new Error("Wallet provider unavailable.");
  const requestId = ++state.balanceRequestId;
  const tokenId = punk.tokenId; const account = punk.account.toLowerCase();
  const [nativeRaw, wrappedRaw] = await Promise.all([
    provider.request({ method: "eth_getBalance", params: [account, "latest"] }),
    provider.request({ method: "eth_call", params: [{ to: ROBINHOOD_WETH,
      data: wrappedBalanceOfData(account) }, "latest"] }),
  ]);
  if (typeof nativeRaw !== "string" || !/^0x[0-9a-fA-F]+$/.test(nativeRaw)) {
    throw new Error("Punk ETH balance response is invalid.");
  }
  const nativeWei = BigInt(nativeRaw); const wrappedWei = decodeUint256(wrappedRaw);
  if (requestId !== state.balanceRequestId || state.selected?.tokenId !== tokenId
    || state.selected?.account?.toLowerCase() !== account) return;
  punk.nativeBalanceWei = nativeWei.toString(); punk.wethBalanceWei = wrappedWei.toString();
  punk.balanceEth = ethFromWei(punk.nativeBalanceWei);
  punk.wethBalanceEth = ethFromWei(punk.wethBalanceWei);
  punk.balanceLoaded = true; renderSelected();
}

async function loadReviewCollection(punk, exactAsset = null) {
  if (!exactAsset && (state.galleryTokenId === punk.tokenId
    || state.galleryLoadingTokenId === punk.tokenId)) return;
  const tokenId = punk.tokenId; state.galleryLoadingTokenId = tokenId;
  state.gallery = [{ image: punk.image, title: `LOADING PUNK #${tokenId}…`,
    provenance: "LIVE OWNERSHIP CHECK", detail: "Reading the current Punk Wallet inventory." }];
  renderGallery(); set("[data-gallery-count]", 0);
  try {
    const params = new URLSearchParams({ tokenId });
    if (exactAsset) {
      params.set("collection", exactAsset.collection);
      params.set("assetTokenId", exactAsset.tokenId);
    }
    const response = await fetch(`/api/broker/nft-withdrawal-assets?${params}`, {
      headers: { accept: "application/json" }, cache: "no-store",
    });
    const payload = await response.json(); const assets = payload?.assets;
    if (!response.ok || payload?.ok !== true || assets?.status !== "READY"
      || assets?.capability !== true || String(assets.punkTokenId) !== tokenId
      || assets.owner !== state.wallet?.account || !Array.isArray(assets.items)
      || (punk.account && assets.account !== punk.account.toLowerCase())) {
      throw new Error("The live-owned NFT inventory could not be verified.");
    }
    if (state.selected?.tokenId !== tokenId) return;
    const verifiedItems = validateWithdrawableNftAssets(assets, tokenId);
    punk.account = assets.account; punk.nfts = verifiedItems.length;
    state.gallery = verifiedItems.map((asset) => ({
      image: asset.imageUrl ?? "/assets/nft-placeholder.svg",
      title: asset.name ?? `${asset.collectionName ?? short(asset.collection)} #${asset.tokenId}`,
      provenance: `${asset.ownershipStatus.replaceAll("_", " ")} · ${asset.provenance.replaceAll("_", " ")} · ${asset.standard}`,
      detail: `${asset.collectionName ?? short(asset.collection)} · TOKEN #${asset.tokenId}${asset.acquiredAt ? ` · ${dateLabel(asset.acquiredAt)}` : ""}`,
      tokenId: asset.tokenId, collection: asset.collection, openSeaUrl: asset.openSeaUrl,
      standard: asset.standard, amount: asset.amount, collectionName: asset.collectionName,
    }));
    state.galleryTokenId = tokenId; renderSelected();
  } finally {
    if (state.galleryLoadingTokenId === tokenId) state.galleryLoadingTokenId = null;
  }
}

function collectionWithdrawalQuantityValid() {
  const asset = state.withdrawalAsset;
  return asset?.standard !== "ERC1155" || (/^[1-9]\d*$/.test(state.withdrawalAmount)
    && BigInt(state.withdrawalAmount) <= BigInt(asset.amount));
}

function renderCollectionWithdrawal() {
  const panel = one("[data-v2-withdrawal]"); const asset = state.withdrawalAsset;
  if (!panel) return;
  panel.hidden = !asset;
  if (!asset) return;
  const image = one("[data-v2-withdraw-image]");
  image.src = cleanImage(asset.image, "/assets/nft-placeholder.svg"); image.alt = asset.title;
  set("[data-v2-withdraw-name]", asset.title);
  set("[data-v2-withdraw-collection]", asset.collectionName ?? short(asset.collection));
  set("[data-v2-withdraw-from]", `PUNK #${state.selected?.tokenId ?? "—"} · ${short(state.selected?.account)}`);
  set("[data-v2-withdraw-to]", short(state.wallet?.account));
  set("[data-v2-withdraw-asset]", `${asset.standard} · TOKEN #${asset.tokenId}`);
  const quantityField = one("[data-v2-withdraw-quantity-field]");
  const quantity = one("[data-v2-withdraw-quantity]");
  quantityField.hidden = asset.standard !== "ERC1155"; quantity.max = asset.amount;
  if (quantity.value !== state.withdrawalAmount) quantity.value = state.withdrawalAmount;
  const confirm = one("[data-v2-withdraw-confirm]"); const submit = one("[data-v2-withdraw-submit]");
  confirm.disabled = state.withdrawalBusy; quantity.disabled = state.withdrawalBusy;
  submit.disabled = state.withdrawalBusy || !confirm.checked || !collectionWithdrawalQuantityValid();
  submit.textContent = state.withdrawalBusy ? "CHECKING LIVE STATE…"
    : state.withdrawalPlan ? "SUBMIT IN METAMASK" : "REVIEW & SIMULATE";
  one("[data-v2-withdraw-cancel]").disabled = state.withdrawalBusy;
}

function selectCollectionWithdrawal(asset) {
  state.withdrawalAsset = asset; state.withdrawalAmount = "1"; state.withdrawalPlan = null;
  one("[data-v2-withdraw-confirm]").checked = false;
  one("[data-v2-withdraw-transaction]").hidden = true;
  set("[data-v2-withdraw-state]", "Review the fixed current-owner destination, then confirm and simulate.");
  renderCollectionWithdrawal();
  one("[data-v2-withdrawal]").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
}

function cancelCollectionWithdrawal() {
  if (state.withdrawalBusy) return;
  state.withdrawalAsset = null; state.withdrawalAmount = "1"; state.withdrawalPlan = null;
  one("[data-v2-withdraw-confirm]").checked = false; renderCollectionWithdrawal();
}

async function fetchCollectionWithdrawalGate(tokenId) {
  const response = await fetch(`/api/broker/nft-withdrawal-status?tokenId=${encodeURIComponent(tokenId)}`, {
    headers: { accept: "application/json" }, cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) throw new Error("NFT withdrawal status is unavailable.");
  return payload.recovery;
}

async function withdrawCollectionAsset() {
  const asset = state.withdrawalAsset; const punk = state.selected;
  const owner = state.wallet?.account; const amount = state.withdrawalAmount;
  const output = one("[data-v2-withdraw-state]"); let submittedHash = null;
  try {
    if (PREVIEW) throw new Error("Local fixture mode cannot request wallet transactions.");
    if (!asset || !punk?.account || !owner || state.wallet.chainId !== CHAIN_ID) {
      throw new Error("Connect the current Punk owner on Robinhood Chain first.");
    }
    if (!one("[data-v2-withdraw-confirm]").checked || !collectionWithdrawalQuantityValid()) {
      throw new Error("Review and confirm the NFT, quantity, and fixed destination first.");
    }
    const provider = window.__GOGH_WALLET_PROVIDER__;
    if (!provider?.request) throw new Error("Wallet provider unavailable.");
    const tokenId = punk.tokenId; const account = punk.account.toLowerCase();
    const identity = `${asset.collection}:${asset.tokenId}:${asset.standard}:${amount}`;
    const isCurrent = () => state.selected?.tokenId === tokenId
      && state.selected?.account?.toLowerCase() === account
      && state.wallet?.account === owner && state.wallet?.chainId === CHAIN_ID
      && state.withdrawalAsset === asset
      && `${asset.collection}:${asset.tokenId}:${asset.standard}:${state.withdrawalAmount}` === identity
      && one("[data-v2-withdraw-confirm]").checked;
    state.withdrawalBusy = true; renderCollectionWithdrawal();
    if (!state.withdrawalPlan) {
      output.textContent = "Checking current owner, Punk Wallet runtime, NFT ownership, and exact transfer simulation…";
      const gate = await fetchCollectionWithdrawalGate(tokenId);
      const reviewed = await preflightNftWithdrawal(provider, gate, tokenId, {
        collection: asset.collection, standard: asset.standard, tokenId: asset.tokenId,
        amount: asset.standard === "ERC1155" ? amount : "1",
      });
      if (!isCurrent()) throw new Error("The wallet, Punk, NFT, or quantity changed during review.");
      state.withdrawalPlan = reviewed;
      output.textContent = `SIMULATION PASSED · ${reviewed.gas.toString()} gas units · destination ${short(owner)}. Review once more, then submit.`;
      return;
    }
    output.textContent = "Rechecking every ownership and transaction binding before opening MetaMask…";
    const result = await submitNftWithdrawal(provider, state.withdrawalPlan, {
      loadGate: fetchCollectionWithdrawalGate, isCurrent,
    });
    submittedHash = result.hash;
    const link = one("[data-v2-withdraw-transaction]");
    link.href = `https://robinhoodchain.blockscout.com/tx/${result.hash}`; link.hidden = false;
    output.textContent = "Withdrawal submitted. Waiting for Robinhood Chain confirmation…";
    await waitForNftWithdrawalReceipt(provider, result.hash);
    output.textContent = "NFT WITHDRAWN ✓ Collection and Punk balances are refreshing.";
    state.withdrawalAsset = null; state.withdrawalAmount = "1"; state.withdrawalPlan = null;
    one("[data-v2-withdraw-confirm]").checked = false; state.galleryTokenId = null;
    await Promise.all([loadReviewCollection(punk), loadPunkBalances(punk)]);
  } catch (error) {
    state.withdrawalPlan = null;
    output.textContent = submittedHash
      ? `${error?.message ?? "Confirmation is still pending."} Use the transaction link to follow it.`
      : `${error?.message ?? "NFT withdrawal stopped safely."} No transaction was submitted by the page.`;
  } finally {
    state.withdrawalBusy = false; renderCollectionWithdrawal();
  }
}

function exactOpenSeaAsset(value) {
  let url;
  try { url = new URL(String(value ?? "").trim()); }
  catch { throw new Error("Paste a valid OpenSea item link."); }
  const match = url.pathname.match(/^\/item\/robinhood\/(0x[0-9a-fA-F]{40})\/(0|[1-9][0-9]*)\/?$/);
  if (url.protocol !== "https:" || url.hostname !== "opensea.io" || url.port
    || url.username || url.password || url.hash || url.search || !match) {
    throw new Error("Use an exact Robinhood Chain OpenSea item link.");
  }
  return Object.freeze({ collection: match[1].toLowerCase(),
    tokenId: BigInt(match[2]).toString() });
}

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "UNKNOWN" : date.toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).toUpperCase();
}

async function hydrateSelected(tab) {
  const punk = state.selected; if (!punk) return;
  const tokenId = punk.tokenId;
  try {
    if (REVIEW_HOST) {
      if (tab === "collection") {
        const [balances, collection] = await Promise.allSettled([
          loadPunkBalances(punk), loadReviewCollection(punk),
        ]);
        if (balances.status === "rejected") {
          set("[data-collection-eth]", "UNAVAILABLE"); set("[data-collection-weth]", "UNAVAILABLE");
        }
        if (collection.status === "rejected") throw collection.reason;
      } else if (tab === "fund") await loadPunkBalances(punk);
      return;
    }
    await ensureV2Session();
    const profilePayload = state.hydratedTokenId === tokenId ? null
      : await jsonRequest(`/api/v2/punks/${tokenId}`);
    if (state.selected?.tokenId !== tokenId) return;
    if (profilePayload?.profile) {
      punk.account = profilePayload.profile.punkWallet;
      punk.balanceEth = ethFromWei(profilePayload.profile.nativeBalanceWei);
      punk.nativeBalanceWei = profilePayload.profile.nativeBalanceWei;
      punk.balanceLoaded = true;
      punk.nfts = profilePayload.profile.collectionCount;
      punk.mode = profilePayload.profile.strategy?.state === "PAUSED" ? "PAUSED"
        : profilePayload.profile.strategy?.intent?.operatingMode ?? "ASK";
      if (profilePayload.profile.strategy?.intent?.minimumReserveWei) {
        punk.reserveEth = ethFromWei(profilePayload.profile.strategy.intent.minimumReserveWei);
      }
      state.hydratedTokenId = tokenId; renderSelected();
    }
    if (tab === "collection") {
      const payload = await jsonRequest(`/api/v2/punks/${tokenId}/collection`);
      state.gallery = payload.holdings.map((holding) => [
        cleanImage(holding.artwork?.imageUrl),
        holding.artwork?.name ?? `${short(holding.collection)} #${holding.tokenId}`,
        `${holding.provenance === "V1" ? "EARLIER ART BROKER" : "CURRENT ART BROKER"} · ${holding.acquisitionType}`,
        `${holding.mintCostWei === "0" ? "FREE" : `${holding.mintCostWei} WEI`} · acquired ${dateLabel(holding.acquiredAt)}`,
      ]);
      renderGallery(); set("[data-gallery-count]", state.gallery.length);
    }
    if (tab === "activity") {
      const payload = await jsonRequest(`/api/v2/punks/${tokenId}/activity`);
      state.activity = payload.entries.map((entry) => [dateLabel(entry.occurredAt), entry.type,
        `${entry.provenance === "V1" ? "EARLIER ART BROKER" : "CURRENT ART BROKER"} · ${String(entry.type).replaceAll("_", " ")}`,
        typeof entry.detail === "string" ? entry.detail : JSON.stringify(entry.detail ?? {})]);
      renderActivity();
    }
  } catch (error) {
    const message = `${error?.message ?? "V2 data unavailable."} No authority was assumed.`;
    if (tab === "collection") { state.gallery = [["/assets/gogh-punks-pfp.png", "GALLERY UNAVAILABLE", "SAFE FAILURE", message]]; renderGallery(); }
    if (tab === "activity") { state.activity = [["NOW", "UNAVAILABLE", "HISTORY NOT LOADED", message]]; renderActivity(); }
    if (!["collection", "activity"].includes(tab)) set("[data-wallet-state]", message);
  }
}

function addMessage(role, message) {
  const conversation = one("[data-conversation]"); const article = document.createElement("article");
  article.className = `message ${role === "owner" ? "owner-message" : "punk-message"}`;
  if (role !== "owner") {
    const image = document.createElement("img"); image.src = cleanImage(state.selected?.image); image.alt = ""; article.append(image);
  }
  const copy = document.createElement("div"); const label = document.createElement("b");
  label.textContent = role === "owner" ? "OWNER" : `PUNK #${state.selected?.tokenId ?? "—"}`;
  const text = document.createElement("p"); text.textContent = message; copy.append(label, text); article.append(copy);
  conversation.append(article); conversation.scrollTop = conversation.scrollHeight;
  const key = selectedReviewKey();
  if (key && typeof message === "string" && message.trim()) {
    const existing = state.reviewConversations.get(key) ?? [];
    state.reviewConversations.set(key, [...existing, Object.freeze({
      role: role === "owner" ? "OWNER" : "PUNK", content: message.trim().slice(0, 1_200),
    })].slice(-12));
  }
}

async function jsonRequest(path, options = {}) {
  const { timeoutMs = 20_000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store",
      ...fetchOptions, signal: controller.signal });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) {
      const error = new Error(payload?.message ?? "Art Broker request failed safely.");
      error.code = payload?.code ?? "V2_REQUEST_FAILED"; throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The review service timed out. Try again.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function ensureV2Session() {
  if (PREVIEW) return null;
  if (!state.wallet?.account || state.wallet.chainId !== CHAIN_ID) {
    throw new Error("Connect the current owner on Robinhood Chain first.");
  }
  try {
    const current = await jsonRequest("/api/v2/session");
    if (current.walletAddress === state.wallet.account) return current;
  } catch { /* prepare a new current-wallet session */ }
  const prepared = await jsonRequest("/api/v2/session", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "prepare", walletAddress: state.wallet.account }) });
  const provider = window.__GOGH_WALLET_PROVIDER__;
  if (!provider?.request) throw new Error("Wallet provider unavailable.");
  const signature = await provider.request({ method: "personal_sign",
    params: [prepared.challenge.message, state.wallet.account] });
  return jsonRequest("/api/v2/session", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "complete",
      challengeId: prepared.challenge.challengeId, walletAddress: state.wallet.account, signature }) });
}

function showConfirmation(draft) {
  state.localStrategy = draft;
  const intent = draft.intent ?? null;
  const view = intent ? {
    mode: intent.operatingMode,
    daily: intent.dailyMintLimit,
    total: intent.totalMintLimit,
    reserve: `${(Number(intent.minimumReserveWei) / 1e18).toFixed(4)}`,
    gas: `${(Number(intent.maxGasPerMintWei) / 1e18).toFixed(4)}`,
    supply: intent.maximumCollectionSupply ?? "NO LIMIT",
    tastes: intent.preferences.prefer.map((value) => value.replaceAll("_", " ")),
    presence: intent.onlinePresenceRequirement === "WEBSITE_OR_SOCIAL"
      ? "WEBSITE OR SOCIAL"
      : [intent.requiresWebsite && "WEBSITE",
        intent.requiresSocial && (intent.preferredSocialPlatforms.join(" + ") || "SOCIAL")]
        .filter(Boolean).join(" + "),
    target: intent.allowedContracts?.length === 1
      ? short(intent.allowedContracts[0]) : "ALL ROBINHOOD NFTS",
    free: intent.mintMode === "FREE_ONLY",
  } : draft;
  const values = [
    ["NETWORK", "ROBINHOOD CHAIN"], ["MODE", view.mode],
    ["MINT PRICE", view.free ? "FREE ONLY" : "NOT CHANGED"], ["LOOKING FOR", view.tastes.join(" · ")],
    ["REQUIRES", [view.presence, "SCREEN + SIMULATION"].filter(Boolean).join(" · ")],
    ["DAILY LIMIT", view.daily], ["TOTAL LIMIT", view.total], ["MAX GAS", `${view.gas} ETH`], ["MINIMUM RESERVE", `${view.reserve} ETH`],
    ["MAX SUPPLY", view.supply], ["TARGET", view.target],
    ["STATUS", "PENDING OWNER CONFIRMATION"],
  ];
  const grid = one("[data-confirmation-grid]"); grid.replaceChildren();
  for (const [label, value] of values) {
    const row = document.createElement("div"); const name = document.createElement("span"); name.textContent = label;
    const output = document.createElement("b"); output.textContent = value; row.append(name, output); grid.append(row);
  }
  const activate = one("[data-activate-strategy]");
  const activateAndSend = one("[data-activate-send-strategy]");
  const activationLocked = view.mode === "AUTONOMOUS"
    || draft.state === "NEEDS_CLARIFICATION";
  activate.disabled = activationLocked;
  activate.textContent = view.mode === "AUTONOMOUS" ? "AUTONOMOUS LOCKED"
    : REVIEW_HOST ? "ACTIVATE ONLY" : "ACTIVATE STRATEGY";
  activateAndSend.hidden = !REVIEW_HOST || PREVIEW;
  activateAndSend.disabled = activationLocked;
  const dialog = one("[data-confirmation-dialog]");
  if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
}

function showSkillConfirmation(skill) {
  state.localSkill = skill;
  const values = [
    ["SKILL", skill.name],
    ["ROUTINE", skill.description],
    ["CAPABILITIES", skill.capabilities.map((value) => value.replaceAll("_", " ")).join(" · ")],
    ["AUTHORITY", "READ ONLY"],
    ["POLICY EFFECT", "NONE"],
    ["STATUS", "PENDING OWNER CONFIRMATION"],
  ];
  const grid = one("[data-skill-confirmation-grid]"); grid.replaceChildren();
  for (const [label, value] of values) {
    const row = document.createElement("div"); const name = document.createElement("span");
    name.textContent = label; const output = document.createElement("b"); output.textContent = value;
    row.append(name, output); grid.append(row);
  }
  const dialog = one("[data-skill-dialog]");
  if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
}

async function fetchOwnedPunks(account) {
  const response = await fetch(`/api/broker/owner-punks?owner=${encodeURIComponent(account)}&view=indexed`, {
    headers: { accept: "application/json" }, cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true || payload.owner !== account
    || payload.chainId !== CHAIN_ID || payload.collection !== COLLECTION
    || !Array.isArray(payload.candidateTokenIds)
    || !Array.isArray(payload.candidatePunks)) throw new Error("Ownership candidates are unavailable.");
  const ownership = await verifyOwnedPunkIds(window.__GOGH_WALLET_PROVIDER__, payload.collection,
    account, payload.candidateTokenIds);
  const candidates = new Map(payload.candidatePunks.map((item) => [String(item.tokenId), item]));
  return ownership.tokenIds.map((ownedTokenId) => {
    const item = candidates.get(ownedTokenId) ?? {};
    return { tokenId: ownedTokenId,
      account: item.agentSummary?.account ?? null,
      image: item.artwork?.imageUrl ?? "/assets/gogh-punks-pfp.png",
      balanceEth: "0", reserveEth: "0", balanceLoaded: false, wethBalanceEth: null,
      nfts: item.agentSummary?.lifetimeMints ?? 0, mode: "ASK" };
  });
}

function applyOwnedPunks(punks) {
  const selectedTokenId = state.selected?.tokenId ?? null;
  state.punks = punks;
  state.selected = punks.find((punk) => punk.tokenId === selectedTokenId) ?? punks[0] ?? null;
  const reviewKey = selectedReviewKey();
  state.lastInspection = reviewKey ? state.reviewInspections.get(reviewKey) ?? null : null;
  state.gallery = []; state.activity = [];
  state.hydratedTokenId = null; state.galleryTokenId = null; state.galleryLoadingTokenId = null;
  renderRoster(); renderSelected(); scheduleSelectedReviewMissionCheck();
  const activeTab = all("[data-v2-tab]").find((button) => button.getAttribute("aria-selected") === "true")?.dataset.v2Tab;
  if (state.selected && activeTab) void hydrateSelected(activeTab);
}

function setup() {
  restoreReviewSessionState();
  one("[data-preview-banner]").hidden = !PREVIEW && !REVIEW_HOST;
  if (REVIEW_HOST && !PREVIEW) {
    set("[data-review-title]", "PR REVIEW BUILD");
    set("[data-review-detail]", "Live ownership, assets, owner-approved wallet actions, and a browser-persistent ASK/ASSIST agent. Model chat uses AUTO only when a server provider is configured. No production strategy, autonomous execution, or deployment.");
    window.addEventListener("storage", (event) => {
      if (event.key !== REVIEW_BROWSER_STORAGE_KEY || !event.newValue) return;
      restoreReviewSessionState(event.newValue);
      renderSelected();
      scheduleSelectedReviewMissionCheck();
    });
  }
  one("[data-review-agent-run]").addEventListener("click", () => sendReviewAgentOut());
  one("[data-review-agent-recall]").addEventListener("click", recallSelectedReviewAgent);
  one("[data-review-agent-test]").addEventListener("click", () => sendReviewAgentOut({ testMode: true }));
  one("[data-review-mint-submit]").addEventListener("click", runOwnerAssistedLiveMint);
  one("[data-review-mint-confirm]").addEventListener("change", () => {
    if (!one("[data-review-mint-confirm]").checked && state.reviewMintPrepared) {
      state.reviewMintArtifact = null; state.reviewMintPrepared = null;
      set("[data-review-mint-status]", "Confirmation cleared. Prepare a fresh live review before submitting.");
      renderReviewAgent();
    }
  });
  all("[data-v2-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.v2Tab)));
  all("[data-suggestion]").forEach((button) => button.addEventListener("click", () => {
    const input = one("#punk-prompt"); input.value = button.dataset.suggestion; input.focus();
  }));
  all("[data-show-link]").forEach((button) => button.addEventListener("click", () => {
    one("[data-link-form]").hidden = false; one("#mint-link").focus();
  }));
  const chatForm = one("[data-chat-form]");
  const chatInput = one("#punk-prompt");
  const chatButton = chatForm.querySelector("button[type=submit]");
  const setChatBusy = (busy) => {
    chatForm.toggleAttribute("aria-busy", busy); chatButton.disabled = busy;
    chatButton.textContent = busy ? "THINKING…" : "SEND ↗";
  };
  chatInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    chatForm.requestSubmit();
  });
  all('input[name="mode"]').forEach((input) => input.addEventListener("change", () => {
    if (!input.checked || input.value === "AUTONOMOUS") return;
    chatInput.value = input.value === "ASSIST"
      ? "Switch to assist mode. Keep every existing collecting rule."
      : "Ask me first. Keep every existing collecting rule.";
    activateTab("talk");
    chatForm.requestSubmit();
  }));
  if (REVIEW_HOST && !PREVIEW) {
    const providerSetting = one("#provider-setting");
    for (const option of providerSetting.options) {
      option.disabled = option.textContent !== "AUTO";
    }
    providerSetting.options[0].textContent = "AUTO · REVIEW CHAT";
  }
  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault(); const input = one("#punk-prompt"); const message = input.value.trim();
    if (!message || chatForm.hasAttribute("aria-busy")) return;
    addMessage("owner", message); input.value = "";
    if (/pause/i.test(message)) {
      if (PREVIEW || REVIEW_HOST) {
        const key = selectedReviewKey(); const agent = selectedReviewAgent();
        if (!key || !agent || !["ACTIVE", "SCOUTING"].includes(agent.status)) {
          addMessage("punk", "NO ACTIVE REVIEW STRATEGY TO PAUSE. Production remains unchanged.");
          return;
        }
        setReviewAgent(key, pauseReviewAgent(agent));
        releaseReviewMissionLease(key);
        scheduleSelectedReviewMissionCheck();
        state.selected.mode = "PAUSED"; renderSelected();
        addReviewActivity("PAUSED", "REVIEW AGENT PAUSED",
          "Browser review only · no production strategy changed");
        addMessage("punk", "PAUSED IN THIS REVIEW BROWSER. I will not evaluate new opportunities until you confirm another strategy.");
      }
      else {
        try {
          await ensureV2Session();
          await jsonRequest(`/api/v2/punks/${state.selected.tokenId}/strategy`, { method: "POST",
            headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }) });
          state.selected.mode = "PAUSED"; renderSelected(); addMessage("punk", "PAUSED. No new collection can be prepared under this strategy.");
        } catch (error) { addMessage("punk", `${error?.message ?? "Pause failed."} No permissions were broadened.`); }
      }
      return;
    }
    if (/\bshow\b.*\b(?:found|discover(?:y|ies|ed)?)\b/i.test(message)) {
      const run = selectedReviewRun();
      if (run) {
        const leading = run.opportunities.find(({ recommendationEligible }) => recommendationEligible);
        addMessage("punk", leading
          ? `${run.eligibleCount} OF ${run.checkedCount} ROBINHOOD NFT OPPORTUNITIES MATCHED. Best current match: ${leading.collectionName}, ${leading.matchScore}%.`
          : `I CHECKED ${run.checkedCount} ROBINHOOD NFT OPPORTUNITIES. None passed every active rule.`);
      } else if (!state.lastInspection) {
        addMessage("punk", "NOTHING IN THE REVIEW QUEUE YET. Paste a mint or project link and I’ll normalize it without accepting its transaction data.");
      } else {
        const pipeline = reviewInspectionPipeline(state.lastInspection);
        addMessage("punk", `ONE LINK IN REVIEW. ${pipeline.discovery}. CONTRACT: ${pipeline.contract}. SCREEN: ${pipeline.screening}. SIMULATION: ${pipeline.simulation}. DECISION: ${pipeline.decision}.`);
      }
      renderReviewAgent();
      return;
    }
    setChatBusy(true);
    let draft;
    let reply = null;
    if (PREVIEW) {
      try {
        const response = await fetch("/api/local-art-broker-v2/chat", { method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tokenId: state.selected.tokenId, message }) });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) throw new Error(payload?.message ?? "Local strategy draft failed.");
        draft = payload.draft;
      } catch (error) {
        setChatBusy(false);
        addMessage("punk", `${error?.message ?? "LOCAL INTELLIGENCE UNAVAILABLE"} Existing rules remain unchanged.`);
        return;
      }
    } else if (REVIEW_HOST) {
      try {
        const currentIntent = selectedReviewAgent()?.intent ?? null;
        const skills = selectedReviewSkills();
        const inspection = state.lastInspection ? { kind: state.lastInspection.link.kind,
          status: state.lastInspection.status,
          ...(state.lastInspection.link.identity
            ? { identity: state.lastInspection.link.identity } : {}) } : null;
        const history = selectedConversationHistory().slice(0, -1).slice(-8);
        const review = selectedReviewSummary();
        const requestOptions = {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: state.wallet.account, tokenId: state.selected.tokenId,
            message, ...(currentIntent ? { currentIntent } : {}),
            ...(inspection ? { inspection } : {}), ...(history.length ? { history } : {}),
            ...(review ? { review } : {}), ...(skills.length ? { skills } : {}) }),
        };
        let payload;
        try { payload = await jsonRequest("/api/v2/review/chat", requestOptions); }
        catch (error) {
          if (!["V2_SESSION_REQUIRED", "V2_SESSION_EXPIRED"].includes(error?.code)) throw error;
          await ensureV2Session();
          payload = await jsonRequest("/api/v2/review/chat", requestOptions);
        }
        draft = payload.draft; reply = payload.reply;
        if (payload.responseKind === "SKILL_DRAFT") {
          setChatBusy(false); addMessage("punk", reply); showSkillConfirmation(payload.skillDraft);
          return;
        }
        set("[data-intelligence-status]", payload.responseKind === "CONVERSATION"
          ? payload.providerAvailable
            ? `GOGH INTELLIGENCE · ${payload.provider.provider}`
            : "GOGH INTELLIGENCE · SAFE FALLBACK"
          : "GOGH INTELLIGENCE · REVIEW PARSER");
      } catch (error) {
        setChatBusy(false);
        addMessage("punk", `${error?.message ?? "REVIEW PARSER UNAVAILABLE"} Existing rules remain unchanged.`);
        return;
      }
    } else {
      try {
        await ensureV2Session();
        const payload = await jsonRequest(`/api/v2/punks/${state.selected.tokenId}/chat`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ message }),
        });
        draft = payload.draft;
      } catch (error) {
        setChatBusy(false);
        addMessage("punk", `${error?.message ?? "GOGH INTELLIGENCE TEMPORARILY UNAVAILABLE"} Existing safety rules remain active.`);
        return;
      }
    }
    setChatBusy(false);
    if (!draft) { addMessage("punk", reply); return; }
    const intent = draft.intent;
    const tastes = intent ? intent.preferences.prefer.map((value) => value.replaceAll("_", " ")) : draft.tastes;
    addMessage("punk", reply
      ?? `GOT IT. ${(intent?.mintMode === "FREE_ONLY" || draft.free) ? "FREE ONLY. " : ""}${tastes.join(" + ")}. ${intent?.dailyMintLimit ?? draft.daily} MAX TODAY. ${intent?.totalMintLimit ?? draft.total ?? 1} MAX FOR THIS STRATEGY. REVIEW THE RULES BEFORE THEY CHANGE.`);
    addReviewActivity("DRAFT", "STRATEGY DRAFT CREATED",
      "Awaiting owner confirmation · Punk has not been sent out");
    showConfirmation(draft);
  });
  one("[data-link-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const value = one("#mint-link").value.trim();
    const output = one("[data-link-result]"); const button = form.querySelector("button[type=submit]");
    output.textContent = "CHECKING… No wallet request will be accepted.";
    form.setAttribute("aria-busy", "true"); button.disabled = true; button.textContent = "CHECKING…";
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error();
      let inspection;
      if (PREVIEW) {
        const response = await fetch("/api/local-art-broker-v2/inspect-link", { method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tokenId: state.selected.tokenId, url: value }) });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) throw new Error(payload?.message ?? "Link blocked");
        inspection = payload.inspection;
      } else if (REVIEW_HOST) {
        const payload = await jsonRequest("/api/v2/review/inspect-url", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({
            owner: state.wallet.account, tokenId: state.selected.tokenId, url: value,
          }), timeoutMs: 20_000 });
        inspection = payload.inspection;
      } else {
        await ensureV2Session();
        const payload = await jsonRequest("/api/v2/inspect-url", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({
            tokenId: state.selected.tokenId, url: value,
          }) });
        inspection = payload.inspection;
      }
      state.lastInspection = inspection;
      const reviewKey = selectedReviewKey();
      if (reviewKey) state.reviewInspections.set(reviewKey, inspection);
      const kind = inspection.link.kind.replaceAll("_", " ");
      const status = inspection.status.replaceAll("_", " ");
      output.textContent = `${kind} · ${status} · no external calldata or wallet request accepted.`;
      addReviewActivity("DISCOVERED", kind, `${status} · transaction data ignored`);
      renderReviewAgent();
      addMessage("punk", `LINK IDENTIFIED 👀 ${kind}. CURRENT VERDICT: ${status}. I can't call it safe yet—contract resolution, screening, and simulation still have to pass.`);
    } catch (error) {
      const invalid = error instanceof TypeError || !error?.message;
      output.textContent = invalid
        ? "BLOCKED · Paste a clean HTTPS project, marketplace, social, or explorer link."
        : `CHECK FAILED · ${error.message} No transaction was prepared.`;
      addMessage("punk", invalid
        ? "I COULDN'T READ THAT LINK. Paste a clean HTTPS project, marketplace, social, or explorer URL."
        : `I COULDN'T FINISH THE CHECK. ${error.message} Nothing was signed or prepared.`);
    } finally {
      form.removeAttribute("aria-busy"); button.disabled = false; button.textContent = "CHECK LINK";
    }
  });
  one("[data-exact-nft-form]").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget;
    const output = one("[data-exact-nft-state]"); const button = form.querySelector("button");
    try {
      if (PREVIEW) throw new Error("Connect on Preview 42 to verify a live-held NFT.");
      if (!state.selected || !state.wallet?.account || state.wallet.chainId !== CHAIN_ID) {
        throw new Error("Connect the current owner and select a Punk first.");
      }
      const exact = exactOpenSeaAsset(one("#exact-nft-link").value);
      form.setAttribute("aria-busy", "true"); button.disabled = true;
      output.textContent = "VERIFYING LIVE ERC-721 OWNERSHIP…";
      await loadReviewCollection(state.selected, exact);
      const found = state.gallery.some((asset) => asset.collection === exact.collection
        && asset.tokenId === exact.tokenId);
      output.textContent = found
        ? `VERIFIED · NFT #${exact.tokenId} was added to this Punk's collection.`
        : "NOT FOUND · This NFT is not currently owned by the selected Punk Wallet.";
    } catch (error) {
      output.textContent = error?.message ?? "The NFT could not be verified.";
    } finally {
      form.removeAttribute("aria-busy"); button.disabled = false;
    }
  });
  one("[data-v2-withdraw-confirm]").addEventListener("change", renderCollectionWithdrawal);
  one("[data-v2-withdraw-quantity]").addEventListener("input", (event) => {
    state.withdrawalAmount = event.target.value; state.withdrawalPlan = null;
    one("[data-v2-withdraw-confirm]").checked = false; renderCollectionWithdrawal();
  });
  one("[data-v2-withdraw-submit]").addEventListener("click", withdrawCollectionAsset);
  one("[data-v2-withdraw-cancel]").addEventListener("click", cancelCollectionWithdrawal);
  one("[data-edit-strategy]").addEventListener("click", () => {
    state.dispatchAfterActivation = false;
    one("[data-confirmation-dialog]").close(); one("#punk-prompt").focus();
  });
  one("[data-activate-send-strategy]").addEventListener("click", () => {
    state.dispatchAfterActivation = true;
    one("[data-activate-strategy]").click();
  });
  one("[data-edit-skill]").addEventListener("click", () => {
    one("[data-skill-dialog]").close(); one("#punk-prompt").focus();
  });
  one("[data-learn-skill]").addEventListener("click", () => {
    const key = selectedReviewKey();
    if (!key || !state.localSkill || !state.selected?.account || !state.wallet?.account) return;
    try {
      const skill = activateReviewSkill(state.localSkill, { owner: state.wallet.account,
        punkTokenId: state.selected.tokenId, punkWallet: state.selected.account });
      const current = state.reviewSkills.get(key) ?? [];
      const next = [skill, ...current.filter(({ skillId }) => skillId !== skill.skillId)].slice(0, 8);
      state.reviewSkills.set(key, next); state.localSkill = null;
      one("[data-skill-dialog]").close(); renderReviewSkills();
      addReviewActivity("LEARNED", `SKILL · ${skill.name}`,
        "Read-only routine · no policy or wallet authority");
      addMessage("punk", `SKILL LEARNED: ${skill.name}. I can use it for scouting and explanations. Your policy and all safety gates still win.`);
    } catch (error) {
      addMessage("punk", `${error?.message ?? "Skill activation failed."} Nothing was learned or authorized.`);
    }
  });
  one("[data-activate-strategy]").addEventListener("click", async () => {
    if (!state.localStrategy) return;
    const dispatchAfterActivation = state.dispatchAfterActivation;
    state.dispatchAfterActivation = false;
    const mode = state.localStrategy.intent?.operatingMode ?? state.localStrategy.mode;
    if (mode === "AUTONOMOUS") return;
    if (REVIEW_HOST && !PREVIEW) {
      try {
        if (mode === "ASSIST") {
          await ensureV2Session();
          const persisted = await jsonRequest("/api/v2/review/strategy-draft", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ owner: state.wallet.account,
              tokenId: state.selected.tokenId, intent: state.localStrategy.intent }),
          });
          const prepared = await jsonRequest(`/api/v2/punks/${state.selected.tokenId}/strategy`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "prepare_activation",
              intentHash: persisted.draft.intentHash }),
          });
          const provider = window.__GOGH_WALLET_PROVIDER__;
          const signature = await provider.request({ method: "personal_sign",
            params: [prepared.challenge.message, state.wallet.account] });
          await jsonRequest(`/api/v2/punks/${state.selected.tokenId}/strategy`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "complete_activation",
              challengeId: prepared.challenge.challengeId, signature }),
          });
          startReviewAgent({ ...state.localStrategy, intentHash: persisted.draft.intentHash });
        } else startReviewAgent(state.localStrategy);
      }
      catch (error) {
        addMessage("punk", `${error?.message ?? "Review agent could not start."} No mint authority was granted.`);
        return;
      }
      one("[data-confirmation-dialog]").close();
      addMessage("punk", mode === "ASSIST"
        ? dispatchAfterActivation
          ? "ASSIST REVIEW AGENT READY. I'M HEADING TO THE ROBINHOOD NFT QUEUE NOW. Your signed strategy is active, but only MetaMask can approve a mint."
          : "ASSIST REVIEW AGENT READY. Your signed strategy is active. I can scout and simulate; only MetaMask can approve a mint."
        : dispatchAfterActivation
          ? "ASK REVIEW AGENT READY. I'M HEADING TO THE ROBINHOOD NFT QUEUE NOW. No mint authority was activated."
          : "ASK REVIEW AGENT READY. I’ll remember these read-only rules in this browser. No mint authority was activated.");
      if (dispatchAfterActivation) await sendReviewAgentOut();
      return;
    }
    if (PREVIEW && state.localStrategy.intentHash) {
      const response = await fetch("/api/local-art-broker-v2/strategy/activate", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({
          tokenId: state.selected.tokenId, intentHash: state.localStrategy.intentHash,
        }) });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true) {
        addMessage("punk", `${payload?.message ?? "Strategy activation failed."} Existing rules remain unchanged.`);
        return;
      }
      startReviewAgent(state.localStrategy);
    } else if (!PREVIEW && state.localStrategy.intentHash) {
      try {
        await ensureV2Session();
        const prepared = await jsonRequest(`/api/v2/punks/${state.selected.tokenId}/strategy`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "prepare_activation",
            intentHash: state.localStrategy.intentHash }),
        });
        const provider = window.__GOGH_WALLET_PROVIDER__;
        const signature = await provider.request({ method: "personal_sign",
          params: [prepared.challenge.message, state.wallet.account] });
        await jsonRequest(`/api/v2/punks/${state.selected.tokenId}/strategy`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "complete_activation",
            challengeId: prepared.challenge.challengeId, signature }),
        });
      } catch (error) {
        addMessage("punk", `${error?.message ?? "Strategy activation failed."} Existing rules remain unchanged.`);
        return;
      }
    }
    state.selected.mode = mode; one("[data-confirmation-dialog]").close(); renderSelected();
    addMessage("punk", PREVIEW ? "Strategy activated in local preview state only. Nothing was saved remotely."
      : "STRATEGY ACTIVATED WITH YOUR WALLET SIGNATURE. No unsigned change was accepted.");
  });
  const fundForm = one("[data-fund-form]");
  const fundButton = fundForm.querySelector("button[type=submit]");
  const resetFundingReview = () => {
    state.fundingPlan = null; fundButton.textContent = "REVIEW & SIMULATE";
    one("[data-fund-transaction]").hidden = true;
  };
  fundForm.addEventListener("input", resetFundingReview);
  fundForm.addEventListener("submit", async (event) => {
    event.preventDefault(); const output = one("[data-fund-result]");
    const amount = new FormData(fundForm).get("amount")?.toString().trim() ?? "";
    const punk = state.selected; const owner = state.wallet?.account; let submittedHash = null;
    try {
      if (PREVIEW) {
        output.textContent = "LOCAL PREVIEW · funding review only. No wallet transaction can be requested.";
        return;
      }
      if (!punk?.account || !owner || state.wallet.chainId !== CHAIN_ID) {
        throw new Error("Connect the current owner on Robinhood Chain and select an activated Punk Wallet.");
      }
      if (!one("[data-fund-confirm]").checked) {
        throw new Error("Review the real ETH amount and selected Punk Wallet, then check the confirmation box.");
      }
      const provider = window.__GOGH_WALLET_PROVIDER__;
      if (!provider?.request) throw new Error("Wallet provider unavailable.");
      const tokenId = punk.tokenId; const account = punk.account.toLowerCase();
      const isCurrent = () => state.selected?.tokenId === tokenId
        && state.selected?.account?.toLowerCase() === account
        && state.wallet?.account === owner && state.wallet?.chainId === CHAIN_ID
        && one("#fund-amount").value.trim() === amount
        && one("[data-fund-confirm]").checked;
      fundButton.disabled = true;
      if (!state.fundingPlan) {
        output.textContent = "Checking current ownership, verified Punk Wallet code, and the exact deposit simulation…";
        const gate = await fetchPunkWalletFundsGate((...args) => fetch(...args), tokenId);
        const prepared = await preflightPunkWalletFunds(provider, gate, tokenId, "deposit", amount);
        if (!isCurrent()) throw new Error("The owner, Punk, or amount changed during review.");
        state.fundingPlan = prepared; fundButton.textContent = "SUBMIT IN METAMASK";
        output.textContent = `SIMULATION PASSED · ${amount} ETH goes directly to Punk #${tokenId} at ${short(account)}. Review once more, then submit.`;
        return;
      }
      output.textContent = "Rechecking every binding before opening MetaMask…";
      const submitted = await submitPunkWalletFunds(provider, state.fundingPlan, {
        loadGate: (freshTokenId) => fetchPunkWalletFundsGate((...args) => fetch(...args), freshTokenId),
        isCurrent,
      });
      const link = one("[data-fund-transaction]");
      link.href = `https://robinhoodchain.blockscout.com/tx/${submitted.hash}`; link.hidden = false;
      submittedHash = submitted.hash;
      state.fundingPlan = null; one("[data-fund-confirm]").checked = false;
      fundButton.textContent = "REVIEW & SIMULATE";
      output.textContent = `Funding submitted directly to Punk #${tokenId}. Waiting for Robinhood Chain confirmation…`;
      await waitForPunkWalletTransactionReceipt(provider, submitted.hash);
      punk.balanceLoaded = false; renderSelected(); await loadPunkBalances(punk);
      output.textContent = `FUNDING CONFIRMED ✓ Punk #${tokenId} balance refreshed.`;
    } catch (error) {
      state.fundingPlan = null; fundButton.textContent = "REVIEW & SIMULATE";
      output.textContent = submittedHash
        ? `${error?.message ?? "Funding confirmation is pending."} Use the transaction link to follow it.`
        : `${error?.message ?? "Funding was not submitted."} No transaction was submitted by the page.`;
    } finally { fundButton.disabled = false; }
  });
  const wethForm = one("[data-weth-form]");
  const wethButton = wethForm.querySelector("button[type=submit]");
  const resetWrappedReview = () => {
    state.wrappedPlan = null; wethButton.textContent = "REVIEW & SIMULATE";
    one("[data-weth-transaction]").hidden = true;
  };
  wethForm.addEventListener("input", resetWrappedReview);
  wethForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const button = form.querySelector("button[type=submit]");
    const output = one("[data-weth-state]"); const punk = state.selected; let submittedHash = null;
    const direction = new FormData(form).get("direction")?.toString() ?? "";
    const amount = new FormData(form).get("amount")?.toString().trim() ?? "";
    form.setAttribute("aria-busy", "true"); button.disabled = true; button.textContent = "SIMULATING…";
    try {
      if (!punk?.account || !state.wallet?.account || state.wallet.chainId !== CHAIN_ID) {
        throw new Error("Choose an activated Punk Wallet on Robinhood Chain.");
      }
      if (!one("[data-weth-confirm]").checked) {
        throw new Error("Review the Punk Wallet, WETH action, and amount, then check the confirmation box.");
      }
      if (PREVIEW) {
        buildWrappedNativeTransaction({ direction, punkWallet: punk.account,
          currentOwner: state.wallet.account, amount });
        output.textContent = `${direction} REVIEW BUILT · exact canonical WETH call · local preview submitted nothing.`;
        return;
      }
      const tokenId = punk.tokenId; const account = punk.account.toLowerCase();
      const owner = state.wallet.account; const provider = window.__GOGH_WALLET_PROVIDER__;
      const selection = Object.freeze({ tokenId, account, activated: true, owner });
      const isCurrent = () => state.selected?.tokenId === tokenId
        && state.selected?.account?.toLowerCase() === account
        && state.wallet?.account === owner && state.wallet?.chainId === CHAIN_ID
        && one("#weth-direction").value === direction
        && one("#weth-amount").value.trim() === amount
        && one("[data-weth-confirm]").checked;
      const prepare = async () => {
        const gate = await fetchPunkWalletFundsGate((...args) => fetch(...args), tokenId);
        const live = await readPunkWalletFundsState(provider, gate, tokenId);
        if (live.bindings.account !== selection.account
          || live.bindings.expectedOwner !== selection.owner) {
          throw new Error("Selected Punk Wallet identity or owner changed.");
        }
        const plan = buildWrappedNativeTransaction({ direction, punkWallet: live.bindings.account,
          currentOwner: live.bindings.expectedOwner, amount });
        const wrappedRaw = await provider.request({ method: "eth_call", params: [{
          to: ROBINHOOD_WETH, data: wrappedBalanceOfData(live.bindings.account),
        }, "latest"] });
        const available = direction === "WRAP" ? live.balanceWei : decodeUint256(wrappedRaw);
        if (plan.amountWei > available) {
          throw new Error(`This Punk Wallet does not have enough ${direction === "WRAP" ? "ETH" : "WETH"}.`);
        }
        const simulation = await simulateWrappedNativeTransaction(provider, plan);
        return Object.freeze({ plan, gas: simulation.gas });
      };
      if (!state.wrappedPlan) {
        output.textContent = "Checking current ownership, verified Punk Wallet code, balance, and exact WETH simulation…";
        const reviewed = await prepare();
        if (!isCurrent()) throw new Error("The owner, Punk, or WETH action changed during review.");
        state.wrappedPlan = reviewed.plan; button.textContent = "SUBMIT IN METAMASK";
        output.textContent = `${direction} SIMULATION PASSED · estimated gas ${BigInt(reviewed.gas).toString()} units. Review once more, then submit.`;
        return;
      }
      output.textContent = "Rechecking every binding before opening MetaMask…";
      const submitted = await submitWrappedNativeTransaction(provider, state.wrappedPlan,
        async () => (await prepare()).plan, isCurrent);
      const link = one("[data-weth-transaction]");
      link.href = `https://robinhoodchain.blockscout.com/tx/${submitted.hash}`; link.hidden = false;
      submittedHash = submitted.hash;
      state.wrappedPlan = null; one("[data-weth-confirm]").checked = false;
      button.textContent = "REVIEW & SIMULATE";
      output.textContent = `${direction} submitted. Waiting for Robinhood Chain confirmation…`;
      await waitForPunkWalletTransactionReceipt(provider, submitted.hash);
      punk.balanceLoaded = false; punk.wethBalanceEth = null; renderSelected();
      await loadPunkBalances(punk);
      output.textContent = `${direction} CONFIRMED ✓ ETH and WETH balances refreshed.`;
    } catch (error) {
      state.wrappedPlan = null; button.textContent = "REVIEW & SIMULATE";
      output.textContent = submittedHash
        ? `${error?.message ?? "WETH confirmation is pending."} Use the transaction link to follow it.`
        : `${error?.message ?? "WETH review stopped safely"} No transaction was submitted by the page.`;
    } finally {
      form.removeAttribute("aria-busy"); button.disabled = false;
    }
  });
  window.addEventListener("gogh:wallet-state", async (event) => {
    if (PREVIEW) return;
    const wallet = event.detail ?? {};
    const account = typeof wallet.account === "string" ? wallet.account.toLowerCase() : null;
    const verifiedSameAccount = account && state.ownershipAccount === account;
    state.wallet = { ...wallet, account };
    if (!account) {
      if (wallet.restoring || wallet.status === "pending") return;
      state.ownershipRequestId += 1; state.ownershipAccount = null;
      state.ownershipLoadingAccount = null; state.punks = []; state.selected = null;
      renderRoster(); return;
    }
    if (wallet.chainId !== CHAIN_ID) {
      if (verifiedSameAccount && (wallet.chainId == null || wallet.status === "pending")) return;
      state.ownershipRequestId += 1; state.ownershipAccount = null;
      state.ownershipLoadingAccount = null; state.punks = []; state.selected = null;
      renderRoster(); return;
    }
    if (verifiedSameAccount || state.ownershipLoadingAccount === account) return;
    const requestId = ++state.ownershipRequestId;
    state.ownershipLoadingAccount = account;
    if (state.ownershipAccount && state.ownershipAccount !== account) {
      state.ownershipAccount = null; state.punks = []; state.selected = null; renderRoster();
    }
    try {
      const punks = await fetchOwnedPunks(account);
      if (requestId !== state.ownershipRequestId || state.wallet?.account !== account
        || state.wallet?.chainId !== CHAIN_ID) return;
      state.ownershipAccount = account; applyOwnedPunks(punks);
    } catch {
      if (requestId !== state.ownershipRequestId) return;
      state.punks = []; state.selected = null; renderRoster();
      set("[data-wallet-state]", "Ownership service unavailable · no authority assumed");
    } finally {
      if (requestId === state.ownershipRequestId) state.ownershipLoadingAccount = null;
    }
  });
  if (PREVIEW) { previewData(); renderRoster(); renderSelected(); }
  else renderRoster();
  window.setInterval(renderMissionMonitor, 1_000);
  window.setInterval(renderWelcomeMessage, 60_000);
  window.setInterval(() => {
    const key = selectedReviewKey(); const agent = selectedReviewAgent();
    if (key && agent?.status === "SCOUTING" && acquireReviewMissionLease(key)) {
      scheduleSelectedReviewMissionCheck();
    }
  }, 5_000);
  const requestedTab = new URLSearchParams(location.search).get("tab");
  if (["talk", "strategy", "fund", "collection", "activity", "settings"].includes(requestedTab)) {
    activateTab(requestedTab);
  }
}

setup();
