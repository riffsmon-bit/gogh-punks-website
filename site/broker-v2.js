import { verifyOwnedPunkIds } from "./broker-v2-ownership.js";
import { createForgeControl } from './broker-v2-forge.js';
import { createOwnerRefresh } from "./broker-v2-owner-refresh.js";
import { prepareAgentGasFunding, submitAgentGasFunding } from "./punk-agent-gas-funding.js";
import { punkChatAction, agentChatStatus } from "./punk-chat-actions.js";
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
  fundingPlan: null, gasFundingPlan: null, gasFundingBusy: false, wrappedPlan: null, withdrawalAsset: null,
  withdrawalAmount: "1", withdrawalPlan: null, withdrawalBusy: false,
  reviewAgents: new Map(), reviewInspections: new Map(), reviewActivities: new Map(),
  reviewRuns: new Map(), reviewConversations: new Map(), reviewSkills: new Map(),
  reviewMissionPhases: new Map(), reviewDiscoveryBackoffs: new Map(),
  reviewMissionInFlight: new Set(), reviewMintOpportunityId: null,
  reviewMintArtifact: null, reviewMintPrepared: null, reviewMintBusy: false,
  agentAccounts: new Map(), agentAccountLoading: new Map(), fundAgentAccount: false };
const REVIEW_MISSION_POLL_MS = 60_000;
const REVIEW_DISCOVERY_BACKOFF_MS = 5 * 60_000;
const REVIEW_SESSION_STORAGE_KEY = "gogh-art-broker-review-session-v1";
const REVIEW_BROWSER_STORAGE_KEY = "gogh-art-broker-review-browser-v2";
const REVIEW_MISSION_LEASE_KEY = "gogh-art-broker-review-mission-lease-v1";
const REVIEW_MISSION_LEASE_MS = 15_000;
const REVIEW_TAB_ID = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
let reviewMissionTimer = null;
let forgeControl = null;
const one = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const set = (selector, value) => { const target = one(selector); if (target) target.textContent = String(value); };
const setAll = (selector, value) => all(selector).forEach((target) => { target.textContent = String(value); });
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

function selectedAgentAccount() {
  return state.selected?.tokenId
    ? state.agentAccounts.get(String(state.selected.tokenId)) ?? null : null;
}

function blockerLabel(value) {
  const continuity = {
    OWNERSHIP_CHANGED_SINCE_AUTHORIZATION: "Punk transferred since approval. Worker paused; review and authorize a new mission",
    OWNERSHIP_HISTORY_WINDOW_EXCEEDED: "Ownership-history check limit reached. Worker paused; fresh mission approval is required",
    OWNERSHIP_CONTINUITY_UNVERIFIED: "Ownership history could not be verified. This worker check did not submit a transaction",
  };
  if (Object.hasOwn(continuity, value)) return continuity[value];
  return String(value ?? "NOT_READY").replaceAll("_", " ");
}

async function loadAgentAccountStatus({ authenticate = false } = {}) {
  if (PREVIEW || !state.selected?.tokenId || !state.wallet?.account
    || state.wallet.chainId !== CHAIN_ID) return null;
  const tokenId = String(state.selected.tokenId);
  const owner = state.wallet.account;
  const pending = state.agentAccountLoading.get(tokenId);
  // An explicit sign-in supersedes an unsigned background read. Other callers
  // await the current read instead of consuming an old cached failure.
  if (pending && (!authenticate || pending.authenticate)) return pending.promise;
  const request = { authenticate, message: "Checking your wallet sign-in…", promise: null };
  state.agentAccountLoading.set(tokenId, request);
  const isCurrent = () => state.agentAccountLoading.get(tokenId) === request
    && state.wallet?.account === owner && state.wallet.chainId === CHAIN_ID
    && state.punks.some(punk => String(punk.tokenId) === tokenId);
  request.promise = Promise.resolve().then(async () => {
    try {
      if (authenticate) await ensureV2Session(message => {
        if (!isCurrent()) return;
        request.message = message; renderAgentAccount();
      });
      if (!isCurrent()) return null;
      request.message = "Checking autonomous readiness…";
      if (authenticate) renderAgentAccount();
      const status = await jsonRequest(`/api/v2/punks/${tokenId}/agent-account`);
      if (!isCurrent()) return null;
      state.agentAccounts.set(tokenId, status);
      if (Array.isArray(status.skills) && state.selected?.tokenId === tokenId && state.selected?.account) {
        const key = selectedReviewKey();
        if (key) state.reviewSkills.set(key, Object.freeze(status.skills.map((skill) =>
          Object.freeze({ ...skill, punkWallet: state.selected.account }))));
      }
      if (state.selected?.tokenId === tokenId) {
        renderReviewAgent(); renderMissionMonitor(); renderWelcomeMessage();
      }
      return status;
    } catch (error) {
      if (!isCurrent()) return null;
      state.agentAccounts.set(tokenId, { error: error?.message ?? "Readiness unavailable.",
        code: error?.code ?? "READINESS_UNAVAILABLE" });
      return null;
    } finally {
      if (state.agentAccountLoading.get(tokenId) === request) {
        state.agentAccountLoading.delete(tokenId);
        if (state.selected?.tokenId === tokenId) renderAgentAccount();
      }
    }
  });
  if (authenticate) renderAgentAccount();
  return request.promise;
}

function renderAgentAccount() {
  const status = selectedAgentAccount();
  const pending = state.agentAccountLoading.get(String(state.selected?.tokenId));
  const authenticating = pending?.authenticate === true;
  const signInRequired = ["V2_SESSION_REQUIRED", "V2_SESSION_EXPIRED"].includes(status?.code);
  const readinessButton = one("[data-open-agent-readiness]");
  if (readinessButton) {
    readinessButton.disabled = authenticating;
    readinessButton.textContent = authenticating ? "CHECKING…"
      : signInRequired ? "SIGN IN & CHECK AUTONOMY" : "CHECK AUTONOMOUS READINESS";
  }
  const recheckButton = one("[data-agent-gas-recheck]");
  if (recheckButton) recheckButton.disabled = authenticating;
  const fundButton = one("[data-fund-agent-account]");
  if (fundButton) fundButton.hidden = true;
  const modes = all('[data-operating-mode][value="AUTONOMOUS"]');
  const modeLabels = all("[data-autonomous-mode]");
  const setupAvailable = status?.readiness?.setupAvailable === true;
  renderAgentGasFunding(status);
  const active = status?.mission?.status === "ACTIVE";
  const available = !authenticating && (setupAvailable || active);
  modes.forEach((mode) => { mode.disabled = !available; });
  modeLabels.forEach((label) => { label.classList.toggle("mode-locked", !available); });
  setAll("[data-autonomous-mode-label]", authenticating ? "AUTONOMOUS · CHECKING"
    : signInRequired ? "AUTONOMOUS · SIGN IN"
      : available ? "AUTONOMOUS · PUNK AGENT ACCOUNT" : "AUTONOMOUS · LOCKED");
  setAll("[data-autonomous-mode-detail]", authenticating ? pending.message
    : signInRequired ? `Wallet connected. Sign in to this ${REVIEW_HOST ? "preview" : "broker"} to check autonomous readiness. No transaction is required.`
    : active
    ? "Owner-approved mission session is active. Per-mint wallet popups are not required."
    : setupAvailable ? "Ready for up to two owner-approved setup transactions."
      : status?.error ? `Readiness check failed: ${status.error}`
        : status ? `Blocked: ${(status.readiness?.blockers ?? []).map(blockerLabel).join(" · ") || "readiness unavailable"}. Check autonomous readiness.`
          : "Readiness not verified. Use CHECK AUTONOMOUS READINESS.");
  if (!status) {
    set("[data-agent-account-status]", "CHECKING READINESS");
    return;
  }
  if (status.error) {
    set("[data-agent-account-status]", signInRequired ? "SIGN-IN REQUIRED" : "READINESS UNAVAILABLE");
    set("[data-agent-account-detail]", signInRequired
      ? `${status.error} Use Check Autonomous Readiness to sign in and recheck.`
      : `${status.error} Recheck readiness. No deposit or mission signature can resolve a service error.`);
    set("[data-agent-account-address]", "NOT CONFIRMED");
    set("[data-agent-account-balance]", "NOT VERIFIED");
    set("[data-agent-account-mission]", "NOT VERIFIED");
    set("[data-agent-account-worker]", "NOT VERIFIED");
    return;
  }
  const blockers = status.readiness?.blockers ?? [];
  set("[data-agent-account-status]", active ? "OUT · AUTONOMOUS"
    : status.mission?.status === "COMPLETED" ? "RETURNED · MISSION COMPLETE"
      : setupAvailable ? "READY FOR OWNER SETUP" : "SAFELY LOCKED");
  set("[data-agent-account-detail]", active
    ? "The server worker may submit only an exact screened and simulated free mint inside your on-chain limits."
    : setupAvailable ? "Confirm the complete chat mission, then approve the account/session setup in your wallet."
      : `Blocked by ${blockers.slice(0, 3).map(blockerLabel).join(" · ") || "deployment readiness"}.`);
  set("[data-agent-account-address]", status.runtime?.account
    ? short(status.runtime.account) : "NOT ACTIVATED");
  set("[data-agent-account-balance]", status.runtime?.nativeBalance != null
    ? `${ethFromWei(status.runtime.nativeBalance)} ETH` : "0 ETH");
  set("[data-agent-account-mission]", status.mission
    ? `${status.mission.status} · ${status.mission.totalLimit} MAX` : "NOT AUTHORIZED");
  set("[data-agent-account-worker]", status.readiness?.automaticExecutionReady
    ? "LIVE" : "LOCKED");
  if (fundButton) fundButton.hidden = status.runtime?.accountCreated !== true;
}

function renderAgentGasFunding(status = selectedAgentAccount()) {
  const runtime = status?.runtime;
  const verified = runtime?.accountCreated === true && !status?.error;
  set("[data-agent-gas-punk-balance]", state.selected?.balanceLoaded === false
    ? "CHECKING…" : `${state.selected?.balanceEth ?? "—"} ETH`);
  set("[data-agent-gas-native]", verified && runtime.nativeBalance != null ? `${ethFromWei(runtime.nativeBalance)} ETH` : "NOT VERIFIED");
  set("[data-agent-gas-deposit]", verified && runtime.entryPointDeposit != null ? `${ethFromWei(runtime.entryPointDeposit)} ETH` : "NOT VERIFIED");
  set("[data-agent-gas-destination]", verified ? runtime.account : "NOT VERIFIED");
  set("[data-agent-gas-readiness]", status?.error
    ? `READINESS UNAVAILABLE · ${status.error} Use RECHECK / SIGN IN; gas funding and mission activation are separate.`
    : !status ? "Readiness has not been verified. Use RECHECK / SIGN IN."
      : `AUTONOMOUS ${status.readiness?.setupAvailable ? "SETUP AVAILABLE" : "LOCKED"} · ${(status.readiness?.blockers ?? []).map(blockerLabel).join(" · ") || "No reported blockers"}. Funding does not activate a mission.`);
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
  const serverMission = selectedAgentAccount()?.mission ?? null;
  if (!agent && !run && !serverMission) return null;
  const leading = run?.opportunities.find(({ recommendationEligible }) => recommendationEligible) ?? null;
  return { checkedCount: run?.checkedCount ?? 0, eligibleCount: run?.eligibleCount ?? 0,
    leadingCollectionName: leading?.collectionName ?? null,
    leadingMatchScore: leading?.matchScore ?? null,
    missionStatus: serverMission?.status === "ACTIVE" ? "SCOUTING"
      : ["PAUSED", "PENDING_RECEIPT"].includes(serverMission?.status) ? "PAUSED"
        : serverMission?.status === "COMPLETED" ? "RETURNED" : agent?.status ?? "ACTIVE",
    missionTarget: serverMission?.totalLimit ?? agent?.mission?.targetMatches ?? 0,
    missionFound: serverMission?.completedMints ?? agent?.mission?.foundContracts.length ?? 0,
    missionChecks: serverMission?.checks ?? agent?.mission?.checks ?? 0,
    missionCheckedOpportunities: serverMission?.opportunitiesChecked
      ?? agent?.mission?.checkedOpportunities ?? 0 };
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
    const serverMission = state.agentAccounts.get(String(punk.tokenId))?.mission;
    if (serverMission?.status === "ACTIVE") return "AUTONOMOUS";
    if (serverMission?.status === "PAUSED") return "PAUSED";
    if (serverMission?.status === "COMPLETED") return "RETURNED";
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
  let target = one("[data-welcome-message]");
  if (!target && state.selected) {
    const article = document.createElement("article"); article.className = "message punk-message";
    const image = document.createElement("img"); image.src = cleanImage(state.selected.image);
    image.alt = ""; image.dataset.chatAvatar = "";
    const copy = document.createElement("div"), label = document.createElement("b");
    const token = document.createElement("span"); token.dataset.chatToken = "";
    token.textContent = state.selected.tokenId; label.append("PUNK #", token);
    target = document.createElement("p"); target.dataset.welcomeMessage = "";
    copy.append(label, target); article.append(image, copy); one("[data-conversation]").prepend(article);
  }
  if (!target) return;
  const greeting = hoodGreeting();
  const agent = selectedReviewAgent();
  const serverMission = selectedAgentAccount()?.mission;
  if (serverMission?.status === "ACTIVE") {
    target.textContent = `${greeting}. I’M OUT ON MY OWNER-APPROVED MISSION: ${serverMission.completedMints}/${serverMission.totalLimit} MINTS COMPLETE. Open Activity for live checks and receipts.`;
  } else if (serverMission?.status === "COMPLETED") {
    target.textContent = `${greeting}. I’M BACK—MISSION COMPLETE WITH ${serverMission.completedMints}/${serverMission.totalLimit} MINTS.`;
  } else if (serverMission?.status === "PAUSED") {
    target.textContent = `${greeting}. I’M BACK. MY AUTONOMOUS SESSION IS NOT ACTIVE.`;
  } else if (agent?.status === "SCOUTING") {
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
  const serverMission = selectedAgentAccount()?.mission ?? null;
  if (!key || !agent && !serverMission) { monitor.hidden = true; return; }
  monitor.hidden = false;
  if (serverMission && (!agent || serverMission.status === "ACTIVE")) {
    const active = serverMission.status === "ACTIVE";
    const workerDisabled = selectedAgentAccount()?.worker?.enabled === false;
    const gasUnfunded = selectedAgentAccount()?.readiness?.blockers?.includes("AGENT_GAS_UNFUNDED");
    const checkFailed = serverMission.lastFailedAt && (!serverMission.lastCheckedAt
      || Date.parse(serverMission.lastFailedAt) > Date.parse(serverMission.lastCheckedAt));
    set("[data-mission-status]", active ? "OUT · AUTONOMOUS" : serverMission.status);
    set("[data-mission-phase]", active
      ? workerDisabled ? "AUTOMATIC CHECKS ARE DISABLED"
        : gasUnfunded ? "SCOUTING · FUND AGENT GAS TO ENABLE MINTING"
        : checkFailed ? "LAST CHECK FAILED · SEE ACTIVITY"
          : "WAITING FOR THE NEXT SERVER DISCOVERY CHECK" : "MISSION SESSION IS NOT ACTIVE");
    set("[data-mission-progress]", `${serverMission.completedMints} / ${serverMission.totalLimit} MINTS`);
    set("[data-mission-checked]", serverMission.opportunitiesChecked);
    set("[data-mission-scans]", serverMission.checks);
    set("[data-mission-queue]", active ? "SERVER WORKER" : "STOPPED");
    set("[data-mission-last-check]", missionClock(
      serverMission.lastCheckedAt, "NOT YET"));
    set("[data-mission-next-check]", active && !workerDisabled ? "SCHEDULED EVERY MINUTE" : "NOT SCHEDULED");
    set(".mission-monitor-note", active
      ? gasUnfunded ? "Your mission is authorized, but this agent account has no ETH for gas. Open Fund to fund the Punk Agent Account."
        : "Every candidate is contract-screened, live-simulated, policy-matched, submitted through the owner-approved account session, and receipt-reconciled."
      : "The worker cannot submit for this Punk while its mission session is inactive.");
    return;
  }
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
  set(".mission-monitor-note", "This displays discovery, screening, and simulation only. No mint transaction is submitted by the review agent.");
}

function renderReviewAgent() {
  renderAgentAccount();
  const agent = selectedReviewAgent();
  const serverMission = selectedAgentAccount()?.mission ?? null;
  renderWelcomeMessage();
  renderStrategySummary(agent, serverMission);
  const reviewSurface = PREVIEW;
  const consolePanel = one("[data-review-agent-console]");
  const strategyState = one("[data-review-strategy-state]");
  if (consolePanel) consolePanel.hidden = !reviewSurface;
  if (strategyState) strategyState.hidden = !reviewSurface;
  if (!reviewSurface) return;
  const run = selectedReviewRun();
  const pipeline = reviewInspectionPipeline(state.lastInspection);
  set("[data-review-agent-status]", serverMission?.status === "ACTIVE"
    ? "AUTONOMOUS · OUT" : agent?.status ?? "IDLE");
  set("[data-review-agent-strategy]", agent
    ? `${agent.mode} · ${agent.status}` : serverMission
      ? `AUTONOMOUS · ${serverMission.status}` : "NOT STARTED");
  set("[data-review-agent-route]", run
    ? run.testMode ? "PREVIEW TEST LANE" : "ROBINHOOD NFT QUEUE"
    : serverMission?.status === "ACTIVE" ? "SERVER WORKER" : "NOT DISPATCHED");
  set("[data-review-agent-discovery]", run
    ? `${run.checkedCount} CHECKED${run.testOpportunityCount ? " · 1 TEST" : ""}`
    : serverMission ? `${serverMission.opportunitiesChecked} CHECKED` : pipeline.discovery);
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
  const liveMission = serverMission;
  const runBusy = runButton.dataset.busy === "true" || testButton.dataset.busy === "true";
  runButton.disabled = runBusy || !agent || agent.status !== "ACTIVE";
  recallButton.hidden = agent?.status !== "SCOUTING" && liveMission?.status !== "ACTIVE";
  recallButton.disabled = recallButton.hidden;
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
    ? `REVIEW AGENT ${agent.status}` : serverMission
      ? `PUNK AGENT ACCOUNT ${serverMission.status}` : "NO REVIEW AGENT");
  set("[data-review-strategy-detail]", agent
    ? `${agent.mode} rules are remembered for this Punk in this browser. ${agent.status === "SCOUTING" ? "Mission is out scouting. " : ""}Authority: NONE.`
    : serverMission ? `Autonomous limits are persisted and owner-authorized on chain. ${serverMission.completedMints}/${serverMission.totalLimit} mints complete.`
      : "Confirm a strategy draft to start this Punk in the review browser profile.");
}

function renderStrategySummary(agent, serverMission) {
  const intent = serverMission?.intent ?? agent?.intent ?? null;
  if (!intent) {
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
    all("[data-operating-mode]").forEach((input) => { input.checked = input.value === (serverMission?.status === "ACTIVE" ? "AUTONOMOUS" : "ASK"); });
    return;
  }
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
  const effectiveMode = serverMission?.status === "ACTIVE"
    ? "AUTONOMOUS" : agent?.mode ?? intent.operatingMode;
  all("[data-operating-mode]").forEach((input) => {
    input.checked = input.value === effectiveMode;
  });
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

async function recallSelectedReviewAgent() {
  const live = selectedAgentAccount();
  if (live?.mission?.status === "ACTIVE" && !PREVIEW) {
    const button = one("[data-review-agent-recall]");
    button.disabled = true; button.textContent = "PREPARING RECALL…";
    try {
      await ensureV2Session();
      const owner = state.wallet.account; const tokenId = String(state.selected.tokenId);
      const prepared = await jsonRequest("/api/v2/agent-account/recall", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({
          action: "prepare", owner, tokenId,
        }) });
      const provider = window.__GOGH_WALLET_PROVIDER__;
      if (!provider?.request) throw new Error("Wallet provider unavailable.");
      button.textContent = "CONFIRM IN WALLET";
      const hash = await provider.request({ method: "eth_sendTransaction", params: [{
        from: owner, to: prepared.transaction.to, value: "0x0",
        data: prepared.transaction.data,
      }] });
      await waitForPunkWalletTransactionReceipt(provider, hash);
      await jsonRequest("/api/v2/agent-account/recall", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({
          action: "confirm", owner, tokenId, transactionHash: hash,
        }) });
      state.agentAccounts.delete(tokenId);
      await loadAgentAccountStatus();
      await hydrateSelected("activity");
      state.selected.mode = "PAUSED"; renderSelected();
      addMessage("punk", "I’M BACK. THE MISSION SESSION IS REVOKED ON CHAIN, THE SERVER WORKER CANNOT SUBMIT FOR ME, AND THE RECALL IS RECORDED IN ACTIVITY.");
    } catch (error) {
      addMessage("punk", `${error?.message ?? "Recall stopped."} If a transaction was submitted, check its receipt before retrying.`);
    } finally { button.textContent = "CALL PUNK BACK"; renderReviewAgent(); }
    return;
  }
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
  forgeControl?.selectionChanged();
  const roster = one("[data-punk-roster]");
  roster.replaceChildren();
  set("[data-roster-count]", state.punks.length);
  one("[data-roster-empty]").hidden = state.punks.length > 0;
  one("[data-selected-stage]").hidden = state.punks.length === 0;
  if (!state.selected) {
    window.dispatchEvent(new CustomEvent('gogh:owner-snapshot', { detail: {
      address: state.wallet?.account ?? null, tokenId: null,
    } }));
    window.dispatchEvent(new CustomEvent('gogh:punk-selected', { detail: {
      owner: state.wallet?.account ?? null, tokenId: null,
    } }));
  }
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
  const agentRuntime = selectedAgentAccount()?.runtime;
  const fundingAgent = state.fundAgentAccount && agentRuntime?.accountCreated === true;
  const fundDestination = fundingAgent ? agentRuntime.account : punk.account;
  set("[data-fund-wallet]", short(fundDestination));
  set("[data-fund-balance-label]", fundingAgent
    ? "CURRENT PUNK AGENT GAS BALANCE" : "CURRENT PUNK WALLET BALANCE");
  set("[data-fund-destination-name]", fundingAgent
    ? "Punk Agent Account gas balance" : "selected Punk Wallet");
  const balance = Number(punk.balanceEth ?? 0); const reserve = Number(punk.reserveEth ?? 0);
  const available = Math.max(0, balance - reserve);
  const balanceKnown = punk.balanceLoaded !== false;
  const nativeDisplay = balanceKnown ? `${balance.toFixed(4)} ETH` : "CHECKING…";
  const wethDisplay = punk.wethBalanceEth == null ? "CHECKING…" : `${punk.wethBalanceEth} WETH`;
  set("[data-punk-balance]", nativeDisplay);
  set("[data-fund-balance]", fundingAgent
    ? ethFromWei(agentRuntime.nativeBalance ?? "0") : balanceKnown ? balance.toFixed(4) : "—");
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
  if (!PREVIEW && !state.agentAccounts.has(String(punk.tokenId))) {
    void loadAgentAccountStatus();
  }
}

function selectPunk(tokenId) {
  const punk = state.punks.find((item) => item.tokenId === tokenId);
  if (!punk) return;
  state.selected = punk; state.localStrategy = null; state.localSkill = null; state.lastInspection = null;
  const key = selectedReviewKey();
  state.lastInspection = key ? state.reviewInspections.get(key) ?? null : null;
  state.hydratedTokenId = null; state.galleryTokenId = null; state.galleryLoadingTokenId = null;
  state.fundingPlan = null; state.wrappedPlan = null; state.withdrawalAsset = null;
  state.gasFundingPlan = null;
  one("[data-agent-gas-confirm]").checked = false;
  one("[data-resume-chat-mission]").hidden = true;
  one("[data-agent-gas-form] button").textContent = "REVIEW & SIMULATE";
  one("[data-agent-gas-transaction]").hidden = true;
  set("[data-agent-gas-result]", "Review this Punk's source and gas amount. No funds move until MetaMask approval.");
  state.fundAgentAccount = false;
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

function activityDetail(entry) {
  const detail = entry.detail;
  if (typeof detail === "string") return detail;
  if (entry.type === "AGENT_SCOUTED") {
    const reasons = Object.keys(detail?.rejectionCounts ?? {});
    const explanation = reasons.length
      ? ` Blocked because ${describeMatchBlocker({ blockingReasons: reasons })}.` : "";
    return `Checked ${detail?.opportunitiesChecked ?? 0} screened candidates · ${detail?.liveSimulationsPassed ?? 0} live simulations passed. No eligible mint; nothing submitted.${explanation}`;
  }
  if (entry.type === "AGENT_CHECK_FAILED") {
    return `Check could not complete: ${blockerLabel(detail?.code ?? "CHECK_FAILED")}. Mint progress has not been increased.`;
  }
  if (entry.type === "USER_OPERATION_SUBMITTED") return "Mint submitted. Waiting for a verified transaction receipt before counting it as collected.";
  if (entry.type === "COLLECTED") return `Mint confirmed · NFT #${detail?.tokenId ?? "?"} · ${short(detail?.collection ?? "")} · held by the Punk Agent Account.`;
  if (entry.type === "AGENT_RECALLED") return "Owner recalled this Punk. Its on-chain mission session is revoked.";
  if (entry.type === "AGENT_MISSION_COMPLETED") return "Mission mint limit reached. The Punk has returned.";
  return JSON.stringify(detail ?? {});
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
  for (const [time, type, title, detail, transactionHash] of entries) {
    const item = document.createElement("li"); const when = document.createElement("time"); when.textContent = time;
    const copy = document.createElement("div"); const heading = document.createElement("h3"); heading.textContent = title;
    const text = document.createElement("p"); text.textContent = detail; copy.append(heading, text);
    if (/^0x[0-9a-f]{64}$/i.test(transactionHash ?? "")) {
      const receipt = document.createElement("a");
      receipt.href = `https://robinhoodchain.blockscout.com/tx/${transactionHash}`;
      receipt.textContent = "VIEW TRANSACTION ↗"; receipt.target = "_blank";
      receipt.rel = "noopener noreferrer"; copy.append(receipt);
    }
    const badge = document.createElement("b"); badge.textContent = type; item.append(when, copy, badge); feed.append(item);
  }
}

function activateTab(name) {
  if (name === 'forge') forgeControl?.selectionChanged();
  if (name === "fund") {
    one("[data-fund-gas-home]").append(one("[data-agent-gas-panel]"));
    one("[data-talk-gas-host]").hidden = true;
  }
  all("[data-v2-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.v2Tab === name)));
  all("[data-v2-panel]").forEach((panel) => { panel.hidden = panel.dataset.v2Panel !== name; });
  if (name === "activity") renderActivity();
  if (name === "forge") forgeControl?.selectionChanged();
  history.replaceState(null, "", `${location.pathname}?${new URLSearchParams({ ...(PREVIEW ? { preview: "1" } : {}), tab: name })}`);
  const reviewRead = REVIEW_HOST && ["fund", "collection", "activity"].includes(name);
  const productRead = !REVIEW_HOST && ["strategy", "fund", "collection", "activity"].includes(name);
  if (!PREVIEW && (reviewRead || productRead)) {
    void hydrateSelected(name);
  }
}

async function openChatGasReview(action = {}) {
  const punk = state.selected;
  if (!punk || state.gasFundingBusy) return;
  state.gasFundingPlan = null;
  one("[data-agent-gas-confirm]").checked = false;
  one("[data-agent-gas-form] button[type=submit]").textContent = "REVIEW & SIMULATE";
  one("[data-agent-gas-transaction]").hidden = true;
  one("#agent-gas-amount").value = action.amount ?? "";
  one("#agent-gas-source").value = action.source ?? "PUNK";
  set("[data-agent-gas-result]", "Review the exact source and amount below. Nothing is sent by chat; simulation and your separate MetaMask confirmation are required.");
  const host = one("[data-talk-gas-host]");
  host.append(one("[data-agent-gas-panel]")); host.hidden = false;
  one("[data-resume-chat-mission]").hidden = !state.localStrategy;
  activateTab("talk");
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
  await loadAgentAccountStatus({ authenticate: true });
  if (state.selected === punk) renderAgentAccount();
}

function ethFromWei(value) {
  if (!/^\d+$/.test(String(value ?? ""))) return "0.0000";
  const wei = BigInt(value); const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${fraction}`;
}

function parseEthAmount(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(text)) {
    throw new Error("Enter a valid ETH amount with no more than 18 decimals.");
  }
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 10n ** 18n + BigInt((fraction || "0").padEnd(18, "0"));
  if (amount <= 0n) throw new Error("Enter an ETH amount greater than zero.");
  return amount;
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
      else if (tab === "activity") {
        await ensureV2Session();
        const payload = await jsonRequest(`/api/v2/punks/${tokenId}/activity`);
        state.activity = payload.entries.map((entry) => [dateLabel(entry.occurredAt), entry.type,
          `CURRENT ART BROKER · ${String(entry.type).replaceAll("_", " ")}`,
          activityDetail(entry), entry.detail?.transactionHash]);
        renderActivity();
      }
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
      if (state.selected?.tokenId !== tokenId) return;
      state.gallery = payload.holdings.map((holding) => [
        cleanImage(holding.artwork?.imageUrl),
        holding.artwork?.name ?? `${short(holding.collection)} #${holding.tokenId}`,
        `${holding.provenance === "RECEIVED" ? "RECEIVED NFT" : holding.provenance === "V1" ? "EARLIER ART BROKER" : "CURRENT ART BROKER"} · ${holding.ownershipStatus === "LIVE_VERIFIED" ? "OWNERSHIP VERIFIED" : holding.acquisitionType}`,
        `${holding.mintCostWei == null ? "ACQUISITION COST UNKNOWN" : holding.mintCostWei === "0" ? "FREE" : `${holding.mintCostWei} WEI`} · ${holding.custodyType === "PUNK_AGENT_ACCOUNT" ? "held by Punk Agent Account" : "held by Punk Wallet"}${holding.acquiredAt ? ` · acquired ${dateLabel(holding.acquiredAt)}` : ""}`,
      ]);
      renderGallery(); set("[data-gallery-count]", state.gallery.length);
      const inventoryNote = document.createElement('p'); inventoryNote.className = 'panel-empty';
      inventoryNote.textContent = `${payload.inventoryNote ?? ''}${payload.ownershipChecksUnavailable ? ` ${payload.ownershipChecksUnavailable} ownership checks unavailable; retry to refresh.` : ''}`;
      one('[data-gallery-grid]').append(inventoryNote);
    }
    if (tab === "activity") {
      const payload = await jsonRequest(`/api/v2/punks/${tokenId}/activity`);
      state.activity = payload.entries.map((entry) => [dateLabel(entry.occurredAt), entry.type,
        `${entry.provenance === "V1" ? "EARLIER ART BROKER" : "CURRENT ART BROKER"} · ${String(entry.type).replaceAll("_", " ")}`,
        activityDetail(entry), entry.detail?.transactionHash]);
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

async function ensureV2Session(report = () => {}) {
  if (PREVIEW) return null;
  const owner = state.wallet?.account;
  const assertCurrent = () => {
    if (!owner || state.wallet?.account !== owner || state.wallet.chainId !== CHAIN_ID) {
      throw new Error("Connect the current owner on Robinhood Chain and retry.");
    }
  };
  assertCurrent();
  report("Checking the signed-in wallet session…");
  let current;
  try { current = await jsonRequest("/api/v2/session"); }
  catch (error) {
    if (!["V2_SESSION_REQUIRED", "V2_SESSION_EXPIRED"].includes(error?.code)) throw error;
  }
  assertCurrent();
  if (current?.walletAddress?.toLowerCase() === owner) {
    report("Wallet session confirmed.");
    return current;
  }
  report("Preparing a wallet sign-in message…");
  const prepared = await jsonRequest("/api/v2/session", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "prepare", walletAddress: owner }) });
  assertCurrent();
  const provider = window.__GOGH_WALLET_PROVIDER__;
  if (!provider?.request) throw new Error("Wallet provider unavailable.");
  report("Open your wallet and sign the free login message. No transaction is required.");
  const signature = await provider.request({ method: "personal_sign",
    params: [prepared.challenge.message, owner] });
  assertCurrent();
  report("Wallet-login signature received. Verifying it…");
  await jsonRequest("/api/v2/session", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "complete",
      challengeId: prepared.challenge.challengeId, walletAddress: owner, signature }) });
  assertCurrent();
  // Verify that this host received the HttpOnly cookie before claiming sign-in.
  const confirmed = await jsonRequest("/api/v2/session");
  assertCurrent();
  if (confirmed.walletAddress?.toLowerCase() !== owner) {
    throw new Error("The signed-in wallet changed. Sign in again with the current owner.");
  }
  return confirmed;
}

async function activatePunkAgentMission(draft, report) {
  await ensureV2Session(report);
  report("Checking Punk Agent Account, bundler, signer, and worker readiness…");
  const status = await loadAgentAccountStatus({ authenticate: false });
  if (!status?.readiness?.setupAvailable) {
    throw Object.assign(new Error("Punk Agent Account infrastructure is not ready."),
      { code: "PUNK_AGENT_ACCOUNT_NOT_READY" });
  }
  const provider = window.__GOGH_WALLET_PROVIDER__;
  if (!provider?.request) throw new Error("Wallet provider unavailable.");
  const owner = state.wallet.account;
  const tokenId = String(state.selected.tokenId);
  const setup = await jsonRequest("/api/v2/agent-account/setup", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({
      owner, tokenId, intent: draft.intent,
    }), timeoutMs: 30_000 });
  const transactions = setup.setup?.setupTransactions;
  if (!Array.isArray(transactions) || transactions.length < 1 || transactions.length > 2) {
    throw new Error("The reviewed Punk Agent Account setup is invalid.");
  }
  let authorizationTransactionHash = null;
  for (const [index, transaction] of transactions.entries()) {
    if (transaction.from !== owner || !/^0x[0-9a-f]{40}$/.test(transaction.to)
      || !/^0x[0-9a-f]+$/.test(transaction.data) || transaction.value !== "0") {
      throw new Error("The owner setup transaction changed after review.");
    }
    report(`Wallet approval ${index + 1} of ${transactions.length}: ${transaction.purpose.replaceAll("_", " ")}.`);
    const hash = await provider.request({ method: "eth_sendTransaction", params: [{
      from: owner, to: transaction.to, data: transaction.data, value: "0x0",
    }] });
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error("The wallet did not return a valid transaction hash.");
    }
    authorizationTransactionHash = hash.toLowerCase();
    report(`Approval ${index + 1} submitted. Waiting for Robinhood Chain confirmation…`);
    await waitForPunkWalletTransactionReceipt(provider, authorizationTransactionHash);
  }
  report("Mission session confirmed on chain. Activating the server worker…");
  const receipt = await jsonRequest("/api/v2/agent-account/receipt", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, tokenId,
      sessionId: setup.sessionId, setupArtifactHash: setup.setup.artifactHash,
      authorizationTransactionHash }), timeoutMs: 30_000 });
  state.agentAccounts.delete(tokenId);
  await loadAgentAccountStatus({ authenticate: false });
  await hydrateSelected("activity");
  return receipt;
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
  const autonomousAvailable = selectedAgentAccount()?.readiness?.setupAvailable === true;
  const activationLocked = view.mode === "AUTONOMOUS" && !autonomousAvailable
    || draft.state === "NEEDS_CLARIFICATION";
  activate.disabled = activationLocked;
  activate.textContent = view.mode === "AUTONOMOUS"
    ? autonomousAvailable ? "AUTHORIZE MISSION" : "AUTONOMOUS LOCKED"
    : REVIEW_HOST && !draft.version ? "ACTIVATE ONLY" : "ACTIVATE STRATEGY";
  activateAndSend.hidden = !REVIEW_HOST || PREVIEW || Boolean(draft.version);
  activateAndSend.disabled = activationLocked;
  set("[data-strategy-activation-status]", activationLocked
    ? view.mode === "AUTONOMOUS"
      ? "Punk Agent Account infrastructure is not ready. No wallet request can be made."
      : "This draft cannot be activated. Edit it before continuing."
    : "Ready for owner confirmation. No wallet request has been made.");
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

function clearTransferredPunkReview() {
  state.localStrategy = null; state.localSkill = null; state.lastInspection = null;
  state.fundingPlan = null; state.gasFundingPlan = null;
  state.wrappedPlan = null; state.withdrawalPlan = null;
  state.withdrawalAsset = null; state.fundAgentAccount = false;
  state.reviewMintOpportunityId = null; state.reviewMintArtifact = null; state.reviewMintPrepared = null;
  for (const dialog of all('dialog[open]')) dialog.close();
  all('[data-fund-confirm], [data-agent-gas-confirm], [data-weth-confirm]').forEach(input => { input.checked = false; });
  // Private conversation maps stay owner-scoped. Never attach the sold Punk's open
  // transcript or unsigned review to whichever Punk is selected next.
  one('[data-conversation]')?.replaceChildren();
}

function setup() {
  restoreReviewSessionState();
  const ownerRefresh = createOwnerRefresh({
    getContext: () => ({ owner: PREVIEW ? null : state.wallet?.account, chainId: state.wallet?.chainId,
      visible: !document.hidden, loading: Boolean(state.ownershipLoadingAccount) }),
    getPunks: () => state.punks,
    readOwned: fetchOwnedPunks,
    onChanged: punks => {
      const retained = new Set(punks.map(punk => punk.tokenId));
      const removed = state.punks.filter(punk => !retained.has(punk.tokenId));
      for (const punk of removed) {
        state.agentAccounts.delete(punk.tokenId);
        state.agentAccountLoading.delete(punk.tokenId);
        const key = reviewAgentKey(state.wallet.account, punk.tokenId);
        state.reviewAgents.delete(key); state.reviewInspections.delete(key);
      }
      if (state.selected && !retained.has(state.selected.tokenId)) clearTransferredPunkReview();
      state.ownershipAccount = state.wallet.account;
      // Keep already-loaded balances/preferences for still-owned Punks; new purchases
      // are hydrated from token-bound account state, never the seller's cached policy.
      const prior = new Map(state.punks.map(punk => [punk.tokenId, punk]));
      applyOwnedPunks(punks.map(punk => prior.get(punk.tokenId) ?? punk));
      set('[data-ownership-sync]', 'Original NFT ownership refreshed automatically. No claim or migration needed.');
    },
    onUnavailable: () => {
      clearTransferredPunkReview(); state.agentAccounts.clear(); state.agentAccountLoading.clear();
      state.ownershipAccount = null; applyOwnedPunks([]);
      set('[data-roster-count]', '—');
      set('[data-ownership-sync]', 'Ownership could not be verified. Controls are hidden; retrying automatically.');
    },
  });
  window.addEventListener('focus', () => void ownerRefresh.refresh());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void ownerRefresh.refresh();
  });
  window.setInterval(() => void ownerRefresh.refresh(), 30_000);
  one("[data-preview-banner]").hidden = !PREVIEW && !REVIEW_HOST;
  if (REVIEW_HOST && !PREVIEW) {
    set("[data-review-title]", "PR REVIEW BUILD");
    set("[data-review-detail]", "Live ownership, assets, chat, and wallet-approved actions. Punk Agent Account autonomy appears only when verified contracts, database, bundler, signer, worker, and explicit release authorization are all ready.");
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
  one("[data-fund-agent-account]").addEventListener("click", () => {
    state.fundAgentAccount = false; state.fundingPlan = null;
    one("[data-fund-confirm]").checked = false;
    activateTab("fund"); renderSelected();
    one("#agent-gas-amount").focus();
  });
  one("[data-agent-gas-recheck]").addEventListener("click", async () => {
    set("[data-agent-gas-readiness]", "Checking readiness; MetaMask may request a sign-in message, not a funding transaction…");
    await loadAgentAccountStatus({ authenticate: true });
    renderAgentAccount();
  });
  one("[data-open-agent-readiness]").addEventListener("click", () => {
    void loadAgentAccountStatus({ authenticate: true });
  });
  one("[data-resume-chat-mission]").addEventListener("click", async () => {
    const punk = state.selected, draft = state.localStrategy;
    if (!draft) return;
    await loadAgentAccountStatus({ authenticate: true });
    if (state.selected === punk && state.localStrategy === draft) showConfirmation(draft);
  });
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
  all("[data-operating-mode]").forEach((input) => input.addEventListener("change", () => {
    if (!input.checked) return;
    chatInput.value = input.value === "AUTONOMOUS"
      ? "Use my Punk Agent Account autonomously. Keep every existing collecting rule and show me the complete mission for approval."
      : input.value === "ASSIST" ? "Switch to assist mode. Keep every existing collecting rule."
        : "Ask me first. Keep every existing collecting rule.";
    activateTab("talk");
    chatForm.requestSubmit();
  }));
  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault(); const input = one("#punk-prompt"); const message = input.value.trim();
    if (!message || chatForm.hasAttribute("aria-busy")) return;
    addMessage("owner", message); input.value = "";
    const chatAction = punkChatAction(message);
    if (chatAction?.kind === 'FORGE') {
      activateTab('forge');
      addMessage('punk', 'The Forge research lab is open. Sign in there to test available read-only tools. Learning, equipping and burning are not live yet.');
      return;
    }
    if (chatAction?.kind === "GAS" || chatAction?.kind === "STATUS") {
      const punk = state.selected;
      setChatBusy(true);
      try {
        if (chatAction.kind === "GAS") {
          addMessage("punk", "Let's review gas funding here. Choose the source and exact amount, simulate, then approve in MetaMask. Funding won't start a mission.");
          await openChatGasReview(chatAction);
        } else {
          const status = await loadAgentAccountStatus({ authenticate: true });
          if (state.selected === punk) addMessage("punk", agentChatStatus(status));
        }
      } finally { setChatBusy(false); }
      return;
    }
    if (chatAction?.kind === "RECALL") {
      if (selectedAgentAccount()?.mission?.status === "ACTIVE") {
        await recallSelectedReviewAgent();
        return;
      }
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
    } else {
      try {
        const punk = state.selected, owner = state.wallet?.account;
        await ensureV2Session();
        await loadAgentAccountStatus({ authenticate: true });
        if (state.selected !== punk || state.wallet?.account !== owner) {
          setChatBusy(false); return;
        }
        const payload = await jsonRequest(`/api/v2/punks/${punk.tokenId}/chat`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ message }),
        });
        if (state.selected !== punk || state.wallet?.account !== owner) {
          setChatBusy(false); return;
        }
        draft = payload.draft; reply = payload.reply;
        if (payload.responseKind === "CONVERSATION") {
          set("[data-intelligence-status]", payload.providerAvailable
            ? `GOGH INTELLIGENCE · ${payload.provider.provider}`
            : "GOGH INTELLIGENCE · SAFE FALLBACK");
        }
      } catch (error) {
        setChatBusy(false);
        addMessage("punk", `${error?.message ?? "GOGH INTELLIGENCE TEMPORARILY UNAVAILABLE"} Existing safety rules remain active.`);
        return;
      }
    }
    setChatBusy(false);
    if (!draft) { addMessage("punk", reply); return; }
    if (draft.intent?.operatingMode === "AUTONOMOUS") {
      await loadAgentAccountStatus({ authenticate: false });
      const runtime = selectedAgentAccount()?.runtime;
      if (runtime?.accountCreated && runtime.nativeBalance === "0" && runtime.entryPointDeposit === "0") {
        state.localStrategy = draft;
        addMessage("punk", "Your mission draft is saved, but my Agent gas is empty. Review funding here first, then use REVIEW SAVED MISSION. Neither step grants the other permission.");
        await openChatGasReview();
        return;
      }
    }
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
  one("[data-learn-skill]").addEventListener("click", async () => {
    const key = selectedReviewKey();
    if (!key || !state.localSkill || !state.selected?.account || !state.wallet?.account) return;
    try {
      let skill = activateReviewSkill(state.localSkill, { owner: state.wallet.account,
        punkTokenId: state.selected.tokenId, punkWallet: state.selected.account });
      if (!PREVIEW) {
        await ensureV2Session();
        const persisted = await jsonRequest("/api/v2/skill", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({
            owner: state.wallet.account, tokenId: String(state.selected.tokenId),
            skill: state.localSkill,
          }) });
        skill = Object.freeze({ ...persisted.skill, punkWallet: state.selected.account });
      }
      const current = state.reviewSkills.get(key) ?? [];
      const next = [skill, ...current.filter(({ skillId }) => skillId !== skill.skillId)].slice(0, 8);
      state.reviewSkills.set(key, next); state.localSkill = null;
      one("[data-skill-dialog]").close(); renderReviewSkills();
      addReviewActivity("LEARNED", `SKILL · ${skill.name}`,
        "Read-only routine · no policy or wallet authority");
      addMessage("punk", `SKILL LEARNED: ${skill.name}. I can use it for scouting and explanations.${PREVIEW ? " It is saved in this local review session." : " It is saved to this Punk’s owner-confirmed playbook."} Your policy and all safety gates still win.`);
    } catch (error) {
      addMessage("punk", `${error?.message ?? "Skill activation failed."} Nothing was learned or authorized.`);
    }
  });
  one("[data-activate-strategy]").addEventListener("click", async () => {
    if (!state.localStrategy) return;
    const activateButton = one("[data-activate-strategy]");
    const activateAndSendButton = one("[data-activate-send-strategy]");
    if (activateButton.dataset.busy === "true") return;
    const report = (message) => set("[data-strategy-activation-status]", message);
    const unlock = () => {
      delete activateButton.dataset.busy;
      activateButton.disabled = false;
      activateAndSendButton.disabled = false;
    };
    activateButton.dataset.busy = "true";
    activateButton.disabled = true;
    activateAndSendButton.disabled = true;
    const dispatchAfterActivation = state.dispatchAfterActivation;
    state.dispatchAfterActivation = false;
    const mode = state.localStrategy.intent?.operatingMode ?? state.localStrategy.mode;
    if (mode === "AUTONOMOUS") {
      try {
        await activatePunkAgentMission(state.localStrategy, report);
        state.selected.mode = "AUTONOMOUS";
        one("[data-confirmation-dialog]").close();
        renderSelected();
        addMessage("punk", "I’M OUT. MY OWNER-APPROVED PUNK AGENT ACCOUNT SESSION IS ACTIVE. I’ll use only my deposited ETH for gas, only for eligible free mints inside these limits, and every result will appear in Activity.");
      } catch (error) {
        report(`AUTONOMOUS SETUP STOPPED · ${error?.message ?? "No mission was activated."}`);
        addMessage("punk", `${error?.message ?? "Autonomous setup stopped safely."} No unapproved mint was submitted.`);
      }
      unlock();
      return;
    }
    if (REVIEW_HOST && !PREVIEW && !state.localStrategy.version) {
      try {
        if (mode === "ASSIST") {
          await ensureV2Session(report);
          report("Saving the complete owner-bound ASSIST strategy…");
          const persisted = await jsonRequest("/api/v2/review/strategy-draft", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ owner: state.wallet.account,
              tokenId: state.selected.tokenId, intent: state.localStrategy.intent }),
          });
          report("Preparing the strategy-activation message…");
          const prepared = await jsonRequest(`/api/v2/punks/${state.selected.tokenId}/strategy`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "prepare_activation",
              intentHash: persisted.draft.intentHash }),
          });
          const provider = window.__GOGH_WALLET_PROVIDER__;
          if (!provider?.request) throw new Error("MetaMask provider is unavailable. Reconnect the wallet and retry.");
          report("MetaMask should be open now. Sign the free strategy-activation message.");
          const signature = await provider.request({ method: "personal_sign",
            params: [prepared.challenge.message, state.wallet.account] });
          report("Strategy signature received. Activating the mission…");
          await jsonRequest(`/api/v2/punks/${state.selected.tokenId}/strategy`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "complete_activation",
              challengeId: prepared.challenge.challengeId, signature }),
          });
          startReviewAgent({ ...state.localStrategy, intentHash: persisted.draft.intentHash });
        } else startReviewAgent(state.localStrategy);
      }
      catch (error) {
        report(`ACTIVATION STOPPED · ${error?.message ?? "The review agent could not start."}`);
        addMessage("punk", `${error?.message ?? "Review agent could not start."} No mint authority was granted.`);
        unlock();
        return;
      }
      report("Strategy activated. Starting the first live discovery check…");
      one("[data-confirmation-dialog]").close();
      addMessage("punk", mode === "ASSIST"
        ? dispatchAfterActivation
          ? "ASSIST REVIEW AGENT READY. I'M HEADING TO THE ROBINHOOD NFT QUEUE NOW. Your signed strategy is active, but only MetaMask can approve a mint."
          : "ASSIST REVIEW AGENT READY. Your signed strategy is active. I can scout and simulate; only MetaMask can approve a mint."
        : dispatchAfterActivation
          ? "ASK REVIEW AGENT READY. I'M HEADING TO THE ROBINHOOD NFT QUEUE NOW. No mint authority was activated."
          : "ASK REVIEW AGENT READY. I’ll remember these read-only rules in this browser. No mint authority was activated.");
      if (dispatchAfterActivation) await sendReviewAgentOut();
      unlock();
      return;
    }
    if (PREVIEW && state.localStrategy.intentHash) {
      const response = await fetch("/api/local-art-broker-v2/strategy/activate", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({
          tokenId: state.selected.tokenId, intentHash: state.localStrategy.intentHash,
        }) });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true) {
        report(`ACTIVATION STOPPED · ${payload?.message ?? "Strategy activation failed."}`);
        addMessage("punk", `${payload?.message ?? "Strategy activation failed."} Existing rules remain unchanged.`);
        unlock();
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
        report(`ACTIVATION STOPPED · ${error?.message ?? "Strategy activation failed."}`);
        addMessage("punk", `${error?.message ?? "Strategy activation failed."} Existing rules remain unchanged.`);
        unlock();
        return;
      }
    }
    state.selected.mode = mode; one("[data-confirmation-dialog]").close(); renderSelected();
    addMessage("punk", PREVIEW ? "Strategy activated in local preview state only. Nothing was saved remotely."
      : "STRATEGY ACTIVATED WITH YOUR WALLET SIGNATURE. No unsigned change was accepted.");
    unlock();
  });
  const gasForm = one("[data-agent-gas-form]");
  const gasButton = gasForm.querySelector("button[type=submit]");
  const resetGasReview = () => { state.gasFundingPlan = null; gasButton.textContent = "REVIEW & SIMULATE"; };
  gasForm.addEventListener("input", resetGasReview);
  one("[data-agent-gas-confirm]").addEventListener("change", resetGasReview);
  gasForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (state.gasFundingBusy) return;
    const punk = state.selected, owner = state.wallet?.account;
    const source = one("#agent-gas-source").value, amount = one("#agent-gas-amount").value.trim();
    const output = one("[data-agent-gas-result]");
    let submittedHash = null;
    const isCurrent = () => state.selected === punk && state.wallet?.account === owner
      && state.wallet?.chainId === CHAIN_ID && one("#agent-gas-source").value === source
      && one("#agent-gas-amount").value.trim() === amount && one("[data-agent-gas-confirm]").checked;
    try {
      if (PREVIEW) throw new Error("Local preview cannot fund a real account.");
      if (!punk || !owner || !isCurrent()) throw new Error("Connect the owner on Robinhood Chain and check the gas-funding confirmation.");
      state.gasFundingBusy = true; gasButton.disabled = true;
      const provider = window.__GOGH_WALLET_PROVIDER__;
      const loadContext = async () => {
        await ensureV2Session();
        const [gate, agent, funding] = await Promise.all([
          fetchPunkWalletFundsGate((...args) => fetch(...args), punk.tokenId),
          jsonRequest(`/api/v2/punks/${punk.tokenId}/agent-account`),
          jsonRequest(`/api/v2/punks/${punk.tokenId}/fund`),
        ]);
        return { gate, agent, funding };
      };
      if (!state.gasFundingPlan) {
        output.textContent = "Verifying both accounts, current ownership, reserve and exact transfer simulation…";
        const prepared = await prepareAgentGasFunding(provider, await loadContext(), punk.tokenId, source, amount);
        if (!isCurrent()) throw new Error("Selection changed during review.");
        state.gasFundingPlan = prepared; gasButton.textContent = "SUBMIT IN METAMASK";
        output.textContent = `SIMULATION PASSED · Move ${amount} ETH from ${source === "PUNK" ? "this Punk Wallet" : "your connected wallet"} to Agent Account ${prepared.destination}. Your connected wallet pays the transfer fee. No mission is activated.`;
        return;
      }
      output.textContent = "Rechecking funding before MetaMask…";
      const submitted = await submitAgentGasFunding(provider, state.gasFundingPlan, { loadContext, isCurrent });
      submittedHash = submitted.hash; state.gasFundingPlan = null;
      if (state.selected === punk) {
        const link = one("[data-agent-gas-transaction]"); link.href = `https://robinhoodchain.blockscout.com/tx/${submittedHash}`; link.hidden = false;
        output.textContent = "Gas funding submitted. Waiting for confirmation; do not submit again.";
      }
      await waitForPunkWalletTransactionReceipt(provider, submittedHash);
      if (state.selected === punk) {
        one("[data-agent-gas-confirm]").checked = false;
        await Promise.all([loadAgentAccountStatus(), loadPunkBalances(punk)]);
        if (state.selected === punk) {
          renderSelected(); output.textContent = "GAS FUNDING CONFIRMED ✓ Review and approve your mission separately.";
          one("[data-resume-chat-mission]").hidden = !state.localStrategy;
          addMessage("punk", `GAS FUNDING CONFIRMED. ${amount} ETH moved to my Agent Account. No mission was activated. ${state.localStrategy ? "Use REVIEW SAVED MISSION to continue." : "Tell me your mission and I'll show its limits for approval."}`);
        }
      }
    } catch (error) {
      state.gasFundingPlan = null;
      if (state.selected === punk) output.textContent = submittedHash
        ? "Funding confirmation is pending. Check the linked transaction before retrying."
        : `${error?.message ?? "Gas funding stopped."} Check wallet activity before retrying if MetaMask opened.`;
    } finally { state.gasFundingBusy = false; gasButton.disabled = false; if (!state.gasFundingPlan) gasButton.textContent = "REVIEW & SIMULATE"; }
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
      const tokenId = punk.tokenId;
      const agentStatus = selectedAgentAccount();
      const agentFunding = state.fundAgentAccount && agentStatus?.runtime?.accountCreated === true;
      const account = (agentFunding ? agentStatus.runtime.account : punk.account).toLowerCase();
      const isCurrent = () => state.selected?.tokenId === tokenId
        && (agentFunding ? state.fundAgentAccount
          && selectedAgentAccount()?.runtime?.account?.toLowerCase() === account
          : state.selected?.account?.toLowerCase() === account)
        && state.wallet?.account === owner && state.wallet?.chainId === CHAIN_ID
        && one("#fund-amount").value.trim() === amount
        && one("[data-fund-confirm]").checked;
      fundButton.disabled = true;
      if (!state.fundingPlan) {
        output.textContent = agentFunding
          ? "Checking current ownership, verified Punk Agent Account runtime, and the exact gas deposit…"
          : "Checking current ownership, verified Punk Wallet code, and the exact deposit simulation…";
        let prepared;
        if (agentFunding) {
          const fresh = await loadAgentAccountStatus({ authenticate: true });
          const amountWei = parseEthAmount(amount);
          if (!fresh?.runtime?.accountCreated || fresh.runtime.account !== account
            || fresh.owner !== owner || fresh.runtime.owner !== owner) {
            throw new Error("Punk Agent Account ownership or runtime changed.");
          }
          const transaction = { from: owner, to: account,
            value: `0x${amountWei.toString(16)}`, data: "0x" };
          await provider.request({ method: "eth_estimateGas", params: [transaction] });
          prepared = Object.freeze({ kind: "AGENT_GAS", tokenId, owner, account,
            amountWei: amountWei.toString(), transaction });
        } else {
          const gate = await fetchPunkWalletFundsGate((...args) => fetch(...args), tokenId);
          prepared = await preflightPunkWalletFunds(provider, gate, tokenId, "deposit", amount);
        }
        if (!isCurrent()) throw new Error("The owner, Punk, or amount changed during review.");
        state.fundingPlan = prepared; fundButton.textContent = "SUBMIT IN METAMASK";
        output.textContent = `SIMULATION PASSED · ${amount} ETH goes directly to ${agentFunding ? "the Punk Agent Account" : `Punk #${tokenId}`} at ${short(account)}. Review once more, then submit.`;
        return;
      }
      output.textContent = "Rechecking every binding before opening MetaMask…";
      let submitted;
      if (state.fundingPlan.kind === "AGENT_GAS") {
        const fresh = await loadAgentAccountStatus({ authenticate: true });
        if (!fresh?.runtime?.accountCreated || fresh.runtime.account !== account
          || fresh.owner !== owner || fresh.runtime.owner !== owner || !isCurrent()) {
          throw new Error("Punk Agent Account ownership or destination changed.");
        }
        await provider.request({ method: "eth_estimateGas",
          params: [state.fundingPlan.transaction] });
        const hash = await provider.request({ method: "eth_sendTransaction",
          params: [state.fundingPlan.transaction] });
        submitted = { hash };
      } else {
        submitted = await submitPunkWalletFunds(provider, state.fundingPlan, {
          loadGate: (freshTokenId) => fetchPunkWalletFundsGate((...args) => fetch(...args), freshTokenId),
          isCurrent,
        });
      }
      const link = one("[data-fund-transaction]");
      link.href = `https://robinhoodchain.blockscout.com/tx/${submitted.hash}`; link.hidden = false;
      submittedHash = submitted.hash;
      state.fundingPlan = null; one("[data-fund-confirm]").checked = false;
      fundButton.textContent = "REVIEW & SIMULATE";
      output.textContent = `Funding submitted directly to ${agentFunding ? "the Punk Agent Account" : `Punk #${tokenId}`}. Waiting for Robinhood Chain confirmation…`;
      await waitForPunkWalletTransactionReceipt(provider, submitted.hash);
      if (agentFunding) {
        state.agentAccounts.delete(String(tokenId));
        await loadAgentAccountStatus(); renderSelected();
      } else {
        punk.balanceLoaded = false; renderSelected(); await loadPunkBalances(punk);
      }
      output.textContent = `FUNDING CONFIRMED ✓ ${agentFunding ? "Punk Agent Account gas" : `Punk #${tokenId} balance`} refreshed.`;
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
    const previousAccount = state.wallet?.account ?? null;
    const previousChain = state.wallet?.chainId;
    if (account !== previousAccount || wallet.chainId !== previousChain) {
      state.agentAccounts.clear(); state.agentAccountLoading.clear();
    }
    const verifiedSameAccount = account && state.ownershipAccount === account;
    state.wallet = { ...wallet, account };
    if (account !== previousAccount || wallet.chainId !== previousChain) {
      ownerRefresh.invalidate(); clearTransferredPunkReview();
    }
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
    if (!PREVIEW && state.selected && state.wallet?.account && state.wallet.chainId === CHAIN_ID) {
      void loadAgentAccountStatus();
    }
  }, 30_000);
  window.setInterval(() => {
    const key = selectedReviewKey(); const agent = selectedReviewAgent();
    if (key && agent?.status === "SCOUTING" && acquireReviewMissionLease(key)) {
      scheduleSelectedReviewMissionCheck();
    }
  }, 5_000);
  const requestedTab = new URLSearchParams(location.search).get("tab");
  forgeControl = createForgeControl({ root: one('[data-v2-panel="forge"]'),
    getSelection: () => state.selected ? { tokenId: String(state.selected.tokenId),
      owner: state.wallet?.account ?? null, chainId: state.wallet?.chainId, preview: PREVIEW } : null,
    ensureSession: ensureV2Session, request: jsonRequest });
  if (["talk", "strategy", "fund", "collection", "activity", "forge", "settings"].includes(requestedTab)) {
    activateTab(requestedTab);
  }
}

setup();
