import { displayEth, displayEthBudget } from "./broker-v2-amounts.js";
import { linkFindings, createLinkFindingsCard } from './broker-v2-link-findings.js';
import { mountAgentOptions } from "./broker-agent-options.js";
import { mountSwarm } from './broker-swarm.js';
import { mountSwarmWallet } from './swarm-wallet-panel.js';
import { createSwarmReviewGate } from './broker-swarm-review.js';
import { punkActivationStatus } from './broker-activation-status.js';
import { createMissionNotifications } from './broker-mission-notifications.js';
import { mountFeatureHelp } from './broker-feature-help.js';
import { renderActionFeedback } from './broker-action-feedback.js';
import { missionStatus, START_FREE_MINT_COMMAND, NEW_FREE_MINT_SEARCH_COMMAND } from './broker-mission-status.js';
import { createSelectedBurnPanel } from './forge-selected-burn-panel.js';
import { verifyOwnedPunkIds } from "./broker-v2-ownership.js";
import { createForgeControl } from './broker-v2-forge.js';
import { createForgeSkillAdminPanel } from './forge-skill-admin-panel.js';
import { createDirectedPaidPanel } from './directed-paid-panel.js';
import { createPublicDirectedPaidPanel } from './directed-paid-public-panel.js';
import { createErc20WithdrawalPanel } from './erc20-withdraw-panel.js';
import { createHolderBurnInspectionPanel } from './forge-holder-inspection-panel.js';
import { createMarketplacePurchasePanel } from './marketplace-purchase-panel.js';
import { createPersistentWatchMount } from './broker-persistent-watch-mount.js';
import { createAgentRecoveryPanel, recoveryEth } from './punk-agent-recovery-panel.js';
import { createOwnerRefresh } from "./broker-v2-owner-refresh.js";
import { createGasFundingRecovery } from "./punk-agent-gas-recovery-panel.js";
import { prepareAgentGasFunding, submitAgentGasFunding, recheckAgentGasFunding, getAgentGasFundingState } from "./punk-agent-gas-funding.js";
import { punkChatAction, agentChatStatus } from "./punk-chat-actions.js";
import { createPunkRecall } from "./punk-agent-recall.js";

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
const REQUESTED_PUNK = new URLSearchParams(location.search).get('tokenId');
let requestedRecovery = location.hash === '#agent-recovery';
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
  gallery: [], activity: [], activityLoaded: false, hydratedTokenId: null, lastInspection: null,
  ownershipAccount: null, ownershipLoadingAccount: null, ownershipRequestId: 0,
  galleryStatus: "idle", galleryNote: "", galleryRequestId: 0,
  chatRequestId: 0, linkRequestId: 0,
  balanceRequestId: 0, galleryTokenId: null, galleryLoadingTokenId: null,
  fundingPlan: null, gasFundingPlan: null, gasFundingBusy: false, swarmFundingContext: null, wrappedPlan: null, withdrawalAsset: null,
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
const punkRecall = createPunkRecall();
let reviewMissionTimer = null;
let gasFundingRecovery = null;
let brokerPreferences = null;
let forgeControl = null;
let forgeSkillAdminControl = null;
let directedPaidControl = null;
let publicPaidControl = null;
let erc20WithdrawalControl = null;
let holderBurnInspectionControl = null;
let marketplacePurchaseControl = null;
let marketplaceSelectionKey = '';
let marketplaceSelectionRevision = 0;
let persistentWatchControl = null;
let swarmControl = null;
let swarmWalletControl = null;
let swarmReviewGate = null;
let missionNotifications = null;
let agentRecoveryControl = null;
const one = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const set = (selector, value) => { const target = one(selector); if (target && target.textContent !== String(value)) target.textContent = String(value); };
const setAll = (selector, value) => all(selector).forEach((target) => { target.textContent = String(value); });
const short = (value) => typeof value === "string" && value.length === 42
  ? `${value.slice(0, 6)}…${value.slice(-4)}` : "NOT ACTIVATED";

function cleanImage(value, fallback = "/assets/nft-placeholder.svg") {
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
      state.agentAccounts.set(tokenId, { ...status, receivedAt: Date.now() });
      missionNotifications?.observe({ owner, tokenId, account: state.agentAccounts.get(tokenId) });
      if (one('[data-v2-tab="activity"]')?.getAttribute("aria-selected") === "true"
        && state.selected?.tokenId === tokenId) missionNotifications?.markRead({ owner, tokenId });
      if (Array.isArray(status.skills) && state.selected?.tokenId === tokenId && state.selected?.account) {
        const key = selectedReviewKey();
        if (key) state.reviewSkills.set(key, Object.freeze(status.skills.map((skill) =>
          Object.freeze({ ...skill, punkWallet: state.selected.account }))));
      }
      if (state.selected?.tokenId === tokenId) {
        renderReviewAgent(); renderMissionMonitor(); renderWelcomeMessage();
      }
      return state.agentAccounts.get(tokenId);
    } catch (error) {
      if (!isCurrent()) return null;
      state.agentAccounts.set(tokenId, { error: error?.message ?? "Readiness unavailable.",
        code: error?.code ?? "READINESS_UNAVAILABLE" });
      return null;
    } finally {
      if (state.agentAccountLoading.get(tokenId) === request) {
        state.agentAccountLoading.delete(tokenId);
        if (state.selected?.tokenId === tokenId) { renderAgentAccount(); renderMissionMonitor(); }
      }
    }
  });
  if (authenticate) renderAgentAccount();
  return request.promise;
}

function renderAgentAccount() {
  renderActivationGuide();
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
  const runButton = one("[data-run-agent-mission]");
  if (runButton) {
    runButton.hidden = status?.worker?.manualRunEnabled !== true;
    runButton.disabled = runButton.hasAttribute("aria-busy")
      || status?.readiness?.manualExecutionReady !== true || !status?.mission?.sessionId;
    const note = one("[data-agent-mission-run-status]");
    if (note) {
      note.hidden = runButton.hidden;
      if (!runButton.hasAttribute("aria-busy")) note.textContent = "Preview missions run when you click this button. One check may mint under your existing approved limits.";
    }
  }
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
    set("[data-agent-account-address]", "NOT VERIFIED");
    set("[data-agent-account-balance]", "NOT VERIFIED");
    set("[data-agent-account-mission]", "NOT VERIFIED");
    set("[data-agent-account-worker]", "NOT VERIFIED");
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
  const activation = activationForPunk(state.selected?.tokenId);
  set("[data-agent-account-status]", activation.label);
  set("[data-agent-account-detail]", activation.detail);
  set("[data-agent-account-address]", status.runtime?.account
    ? short(status.runtime.account) : "NOT ACTIVATED");
  set("[data-agent-account-balance]", status.runtime?.nativeBalance != null
    ? recoveryEth(status.runtime.nativeBalance) : "NOT VERIFIED");
  set("[data-agent-account-mission]", status.mission
    ? `${status.mission.status} · ${status.mission.totalLimit} MAX` : "NOT AUTHORIZED");
  set("[data-agent-account-worker]", activation.status === 'ACTIVE' ? 'RECENT CHECK VERIFIED' : activation.steps[4].detail);
  if (fundButton) fundButton.hidden = status.runtime?.accountCreated !== true;
}

function activationForPunk(tokenId) {
  return punkActivationStatus({ owner: state.wallet?.account, chainId: state.wallet?.chainId,
    tokenId: String(tokenId), account: state.agentAccounts.get(String(tokenId)),
    strategy: (String(state.selected?.tokenId) === String(tokenId) ? state.localStrategy : null)
      ?? state.punks.find(punk => String(punk.tokenId) === String(tokenId))?.strategy });
}

function renderActivationGuide() {
  const root = one('[data-activation-guide]');
  if (!root) return;
  const model = activationForPunk(state.selected?.tokenId);
  root.dataset.tone = model.tone;
  set('[data-activation-label]', model.label); set('[data-activation-detail]', model.detail);
  const list = one('[data-activation-steps]');
  const signature = JSON.stringify([model.steps, state.gasFundingBusy, state.agentAccountLoading.get(String(state.selected?.tokenId))?.authenticate === true]);
  if (list.dataset.signature !== signature) {
    list.dataset.signature = signature; list.replaceChildren();
    for (const step of model.steps) {
      const item = document.createElement('li'); item.dataset.status = step.status;
      const title = document.createElement('strong'); title.textContent = step.label;
      const status = document.createElement('small'); status.textContent = step.status === 'COMPLETE' ? 'DONE' : step.status === 'CURRENT' ? 'NEXT STEP' : step.status === 'BLOCKED' ? 'NEEDS ATTENTION' : 'TO DO';
      const detail = document.createElement('p'); detail.textContent = step.detail;
      item.append(status, title, detail);
      if (step.status !== 'COMPLETE' && (step.status !== 'PENDING' || step.id === 'FUND' && model.steps[1].status === 'COMPLETE')) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'outline-button';
        button.dataset.activationAction = step.action;
        button.textContent = { CHECK: 'CHECK STATUS / SIGN IN', SETUP: 'REVIEW AGENT SETUP', FUND: 'ADD AGENT GAS', MISSION: 'REVIEW MISSION', STATUS: 'VIEW ACTIVITY' }[step.action];
        button.disabled = state.gasFundingBusy || state.agentAccountLoading.get(String(state.selected?.tokenId))?.authenticate === true;
        item.append(button);
      }
      list.append(item);
    }
  }
  for (const node of all('[data-roster-activation]')) {
    const status = activationForPunk(node.dataset.rosterActivation);
    node.textContent = { UNKNOWN: 'CHECK SETUP', SETUP_REQUIRED: 'NOT ACTIVATED', SETUP_BLOCKED: 'NOT ACTIVATED', GAS_REQUIRED: 'NEEDS GAS', RESERVE_REACHED: 'LOW GAS', ACTIVE: 'HUNTING', MISSION_REQUIRED: 'NO MISSION' }[status.status] ?? 'CHECK STATUS';
    node.dataset.tone = status.tone; node.title = status.detail;
  }
}

function currentSwarmFunding() {
  const context = state.swarmFundingContext;
  if (!context) return null;
  const saved = swarmControl?.fundingContext(String(context.tokenId));
  if (!saved || saved.batchId !== context.batchId || saved.owner !== state.wallet?.account?.toLowerCase()
    || saved.chainId !== state.wallet?.chainId || saved.tokenId !== String(state.selected?.tokenId)
    || saved.amountWei !== context.amountWei || saved.amountEth !== context.amountEth) {
    throw Error('The Swarm funding plan changed. Return to Swarm and check the original transfer before continuing.');
  }
  return saved;
}

function renderAgentGasFunding(status = selectedAgentAccount()) {
  const allocation = state.swarmFundingContext;
  const notice = one('[data-swarm-funding-context]');
  if (notice) notice.hidden = !allocation;
  set('[data-swarm-funding-allocation]', allocation ? `Swarm allocation: ${allocation.amountEth} ETH to Punk #${allocation.tokenId}’s Agent wallet. Network fee is additional. This is one deposit; no refill permission is granted.` : '');
  for (const selector of ['#agent-gas-source', '#agent-gas-amount']) {
    const input = one(selector); if (input) input.disabled = !!allocation || state.gasFundingBusy;
  }
  const runtime = status?.runtime;
  const verified = runtime?.accountCreated === true && !status?.error;
  const needsSetup = runtime?.accountCreated === false && !status?.error && status?.readiness?.setupAvailable === true;
  const setup = one('[data-agent-gas-setup]'); if (setup) setup.hidden = !needsSetup;
  const submit = one('[data-agent-gas-form] button[type="submit"]');
  if (submit) submit.disabled = state.gasFundingBusy || !verified;
  set("[data-agent-gas-punk-balance]", state.selected?.balanceLoaded === false
    ? "CHECKING…" : `${state.selected?.balanceEth ?? "—"} ETH`);
  set("[data-agent-gas-native]", verified ? recoveryEth(runtime.nativeBalance) : "NOT VERIFIED");
  set("[data-agent-gas-deposit]", verified ? recoveryEth(runtime.entryPointDeposit) : "NOT VERIFIED");
  set("[data-agent-gas-destination]", verified ? runtime.account : "NOT VERIFIED");
  set("[data-agent-gas-readiness]", status?.error
    ? `READINESS UNAVAILABLE · ${status.error} Use RECHECK / SIGN IN; gas funding and mission activation are separate.`
    : needsSetup ? "Set up this Punk’s Agent Account before funding it. Review the mission below and approve account/session setup in your wallet, then return here to add gas. Your Punk Wallet ETH remains separate."
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

function renderWelcomeMessage() {
  renderCurrentMissionStatus();
}

function renderCurrentMissionStatus() {
  let view = missionStatus({ account: selectedAgentAccount(), intent: state.selected?.strategy?.intent ?? selectedReviewAgent()?.intent, preview: PREVIEW });
  const activation = activationForPunk(state.selected?.tokenId);
  // A recent worker timestamp alone is not proof that gas, reserve and ownership permit hunting.
  if (!PREVIEW && selectedAgentAccount()?.runtime?.sessionActive === true && activation.status !== 'ACTIVE') {
    view = { ...view, label: activation.label, detail: activation.detail, tone: activation.tone, canStart: false };
  }
  set('[data-hero-status]', view.label);
  set('[data-current-mission-status]', view.label);
  set('[data-current-mission-detail]', view.detail);
  set('[data-action-status]', view.detail);
  const root = one('[data-current-mission]');
  if (root) root.dataset.tone = view.tone;
  const start = one('[data-start-free-mission]');
  const hasTarget = Boolean((state.selected?.strategy?.intent ?? selectedReviewAgent()?.intent)?.allowedContracts?.length);
  if (start) { start.hidden = !view.canStart; start.textContent = hasTarget ? 'START WITH SAVED TARGET' : 'START FREE-MINT MISSION'; }
  const newSearch = one('[data-new-free-search]');
  if (newSearch) newSearch.hidden = !view.canStart || !hasTarget;
  const check = one('[data-current-mission-check]');
  if (check) check.disabled = state.agentAccountLoading.has(String(state.selected?.tokenId));
  const recall = one('[data-current-mission-recall]');
  if (recall) {
    recall.disabled = PREVIEW || !state.selected || !state.wallet?.account || state.wallet.chainId !== CHAIN_ID || punkRecall.busy;
    recall.textContent = punkRecall.busy ? 'RECALL IN PROGRESS…' : 'RECALL PUNK';
  }
  return view;
}

function missionClock(value, fallback) {
  if (!value || !Number.isFinite(Date.parse(value))) return fallback;
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: "numeric", minute: "2-digit" }).toUpperCase();
}

function renderMissionMonitor() {
  renderActivationGuide();
  const current = renderCurrentMissionStatus();
  const monitor = one("[data-mission-monitor]");
  if (!monitor) return;
  const key = selectedReviewKey();
  const agent = selectedReviewAgent();
  const serverMission = selectedAgentAccount()?.mission ?? null;
  if (!key || !agent && !serverMission) { monitor.hidden = true; return; }
  monitor.hidden = false;
  if (serverMission) {
    const active = serverMission.status === "ACTIVE";
    set('[data-mission-history-label]', active ? 'AUTHORIZED MINT MISSION' : 'LAST MINT MISSION');
    const workerDisabled = selectedAgentAccount()?.worker?.enabled === false;
    const gasUnfunded = selectedAgentAccount()?.readiness?.blockers?.includes("AGENT_GAS_UNFUNDED");
    const checkFailed = serverMission.lastFailedAt && (!serverMission.lastCheckedAt
      || Date.parse(serverMission.lastFailedAt) > Date.parse(serverMission.lastCheckedAt));
    set("[data-mission-status]", current.label);
    set("[data-mission-phase]", active
      ? workerDisabled ? "AUTOMATIC CHECKS ARE DISABLED"
        : gasUnfunded ? "SCOUTING · FUND AGENT GAS TO ENABLE MINTING"
        : checkFailed ? "LAST CHECK FAILED · SEE ACTIVITY"
          : current.detail : "LAST MINT MISSION · NOT A CURRENT SEARCH");
    set("[data-mission-progress]", `${serverMission.completedMints} / ${serverMission.totalLimit} MINTS`);
    set("[data-mission-checked]", serverMission.opportunitiesChecked);
    set("[data-mission-scans]", serverMission.checks);
    set("[data-mission-queue]", active && current.tone === 'active' ? "SERVER WORKER" : active ? "NEEDS CHECK" : "STOPPED");
    set("[data-mission-last-check]", missionClock(
      serverMission.lastCheckedAt, "NOT YET"));
    set("[data-mission-next-check]", active && !workerDisabled ? "SCHEDULED EVERY MINUTE" : "NOT SCHEDULED");
    set(".mission-monitor-note", active
      ? gasUnfunded ? "Your mission is authorized, but this agent account has no ETH for gas. Open Fund to fund the Punk Agent Account."
        : "Every candidate is contract-screened, live-simulated, policy-matched, submitted through the owner-approved account session, and receipt-reconciled."
      : current.detail);
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
  recallButton.hidden = agent?.status !== "SCOUTING"
    && !["ACTIVE", "PAUSED", "INACTIVE", "EXPIRED"].includes(liveMission?.status)
    && selectedAgentAccount()?.runtime?.sessionActive !== true;
  recallButton.disabled = recallButton.hidden || punkRecall.busy;
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
  const intent = state.selected?.strategy?.intent ?? agent?.intent ?? serverMission?.intent ?? null;
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
    ? "FREE ONLY" : `UP TO ${displayEth(intent.maxMintPriceWei)} ETH`);
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

function pauseSelectedBrowserReview() {
  const key = selectedReviewKey(); const agent = selectedReviewAgent();
  if (!key || !agent || !["ACTIVE", "SCOUTING"].includes(agent.status)) {
    throw new Error("No active browser review strategy to pause.");
  }
  if (reviewMissionTimer !== null) window.clearTimeout(reviewMissionTimer);
  reviewMissionTimer = null;
  setReviewAgent(key, pauseReviewAgent(agent));
  setReviewMissionPhase(key, "PAUSED");
  releaseReviewMissionLease(key);
  addReviewActivity("PAUSED", "REVIEW AGENT PAUSED", "Browser review only · no production strategy changed");
  return { ok: true, strategy: { state: "PAUSED" } };
}

async function recallSelectedReviewAgent() {
  if (punkRecall.busy) return;
  const punk = state.selected, owner = state.wallet?.account;
  const tokenId = String(punk?.tokenId ?? "");
  const provider = window.__GOGH_WALLET_PROVIDER__;
  const isCurrent = () => state.selected === punk && state.wallet?.account === owner
    && state.wallet?.chainId === CHAIN_ID && window.__GOGH_WALLET_PROVIDER__ === provider;
  const button = one("[data-review-agent-recall]");
  button.disabled = true; button.textContent = "CHECKING LIVE MISSION…";
  const recallButton = one('[data-current-mission-recall]');
  if (recallButton) { recallButton.disabled = true; recallButton.textContent = 'CHECKING MISSION…'; }
  const report = message => { if (isCurrent()) set('[data-current-recall-result]', message); };
  report(`Checking Punk #${tokenId}’s current mission. Recall is not confirmed yet.`);
  try {
    let result;
    if (PREVIEW) {
      pauseSelectedBrowserReview();
      result = { status: "PAUSED" };
    } else {
      result = await punkRecall.run({ owner, tokenId, isCurrent, provider,
        readStatus: () => loadAgentAccountStatus({ authenticate: true }),
        request: (path, body) => REVIEW_HOST && body.action === "pause"
          ? pauseSelectedBrowserReview()
          : jsonRequest(path, { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(body) }),
        waitForReceipt: waitForPunkWalletTransactionReceipt,
        onWallet: () => {
          button.textContent = "CONFIRM IN WALLET";
          report(`Confirm the recall for Punk #${tokenId} in MetaMask. Your connected wallet pays the network fee. Funds stay in the Punk’s wallets.`);
          addMessage("punk", `Confirm the recall for Punk #${tokenId} in your wallet. This revokes its mission session. It stays paused until you authorize a new mission.`);
        },
        onSubmitted: hash => {
          report(`Recall submitted for Punk #${tokenId}. Waiting for confirmation; do not submit again. Transaction: ${hash}`);
          if (isCurrent()) addMessage("punk", `Punk #${tokenId} recall submitted: ${hash}. Waiting for its receipt and mission confirmation.`);
        },
      });
    }
    if (!isCurrent() || result.status === "BUSY") return;
    punk.mode = "PAUSED"; renderSelected();
    report(result.status === 'REVOKED'
      ? `Punk #${tokenId} recalled. Its mission permission is revoked and its strategy is paused. Funds remain in its wallets. Already-submitted mints still need their receipts checked.`
      : `Punk #${tokenId}’s strategy is paused. No active mission permission was found. Funds remain in its wallets.`);
    addMessage("punk", result.status === "REVOKED"
      ? "I’M BACK. The mission session is revoked on chain and the strategy is paused. Any transaction already submitted still needs its receipt checked. I’ll stay paused until you authorize a new mission."
      : PREVIEW || REVIEW_HOST
        ? "PAUSED IN THIS REVIEW BROWSER. I will not evaluate new opportunities until you confirm another strategy."
        : "PAUSED. No new collection can be prepared under this strategy. I’ll stay paused until you authorize a new mission.");
    if (!PREVIEW) {
      state.agentAccounts.delete(tokenId);
      await loadAgentAccountStatus();
      if (isCurrent()) await hydrateSelected("activity");
    }
  } catch (error) {
    report(`${error?.message ?? 'Recall stopped.'} Recall is not confirmed.${error?.transactionHash
      ? ` Transaction: ${error.transactionHash}. Check this receipt before retrying.` : ' Check status and retry when your wallet is ready.'}`);
    if (isCurrent()) addMessage("punk", `${error?.message ?? "Recall stopped."} Recall is not confirmed.${error?.transactionHash
      ? ` Transaction: ${error.transactionHash}. Check this receipt before retrying.` : ""}`);
  } finally { button.textContent = "CALL PUNK BACK"; renderReviewAgent(); renderCurrentMissionStatus(); }
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

function syncMarketplaceSelection() {
  if (!marketplacePurchaseControl) return;
  const key = JSON.stringify([state.wallet?.account?.toLowerCase() ?? null,
    state.wallet?.chainId ?? null, state.selected?.tokenId ?? null, PREVIEW]);
  if (key === marketplaceSelectionKey) return;
  marketplaceSelectionKey = key;
  marketplaceSelectionRevision++;
  marketplacePurchaseControl.clear();
  void marketplacePurchaseControl.refresh();
}

function renderMissionBadges() {
  const owner = !PREVIEW && state.wallet?.chainId === CHAIN_ID ? state.wallet?.account : null;
  const owned = new Set(state.punks.map(punk => String(punk.tokenId)));
  const notices = (missionNotifications?.list({ owner }) ?? []).filter(item => owned.has(item.tokenId));
  const unread = notices.filter(item => !item.read);
  for (const badge of all('[data-roster-mission-badge]')) {
    const count = unread.filter(item => item.tokenId === badge.dataset.rosterMissionBadge).length;
    badge.hidden = count === 0; badge.textContent = String(count);
    badge.setAttribute('aria-label', `${count} unread mission update${count === 1 ? '' : 's'}`);
  }
  const selectedCount = unread.filter(item => item.tokenId === state.selected?.tokenId).length;
  const activityBadge = one('[data-activity-mission-badge]');
  if (activityBadge) { activityBadge.hidden = selectedCount === 0; activityBadge.textContent = String(selectedCount);
    activityBadge.setAttribute('aria-label', `${selectedCount} unread mission updates`); }
  const countNode = one('[data-mission-update-count]');
  if (countNode) { countNode.hidden = unread.length === 0; countNode.textContent = String(unread.length); }
  const host = one('[data-mission-updates]');
  if (host) host.hidden = !owner || !owned.size;
  const list = one('[data-mission-update-list]');
  if (!list) return;
  list.replaceChildren();
  const readButton = one('[data-mission-updates-read]');
  if (readButton) readButton.hidden = !unread.length;
  if (!notices.length) {
    const item = document.createElement('li');
    item.textContent = 'No mission updates yet. Check a Punk’s status to load its latest result.'; list.append(item); return;
  }
  for (const item of notices.slice(0, 20)) {
    const row = document.createElement('li'); row.dataset.tone = item.tone;
    const title = document.createElement('strong');
    title.textContent = `Punk #${item.tokenId} · ${item.title}${item.read ? '' : ' · NEW'}`;
    const detail = document.createElement('p'); detail.textContent = item.detail;
    const time = document.createElement('small'); time.textContent = `Checked ${new Date(item.observedAt).toLocaleString()}`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'outline-button';
    button.textContent = `VIEW PUNK #${item.tokenId}`;
    button.addEventListener('click', () => {
      if (state.wallet?.account?.toLowerCase() !== item.owner || state.wallet?.chainId !== CHAIN_ID
        || !state.punks.some(punk => String(punk.tokenId) === item.tokenId)) return;
      selectPunk(item.tokenId); activateTab('activity');
      one('[data-v2-panel="activity"]')?.scrollIntoView({ block: 'start' });
    });
    row.append(title, detail, time, button); list.append(row);
  }
}

function renderRoster() {
  void persistentWatchControl?.selectionChanged();
  brokerPreferences?.refresh();
  swarmWalletControl?.refresh();
  swarmReviewGate?.refresh();
  swarmControl?.refresh();
  forgeSkillAdminControl?.update();
  forgeControl?.selectionChanged();
  directedPaidControl?.selectionChanged();
  publicPaidControl?.selectionChanged();
  erc20WithdrawalControl?.selectionChanged();
  holderBurnInspectionControl?.refresh();
  agentRecoveryControl?.selectionChanged();
  syncMarketplaceSelection();
  const roster = one("[data-punk-roster]");
  const restoreFocus = roster.contains(document.activeElement);
  roster.setAttribute('aria-orientation', 'horizontal');
  roster.replaceChildren();
  set("[data-roster-count]", state.punks.length);
  one("[data-roster-empty]").hidden = state.punks.length > 0;
  if (!state.punks.length) {
    const empty = one('[data-roster-empty]'), account = state.wallet?.account;
    const verifiedEmpty = account && state.ownershipAccount === account && state.wallet?.chainId === CHAIN_ID;
    empty.querySelector('strong').textContent = verifiedEmpty ? 'No Gogh Punks found in this wallet.'
      : !account ? 'Your brokers enter here.' : state.wallet?.chainId !== CHAIN_ID ? 'Switch to Robinhood Chain.' : 'Checking your Gogh Punks…';
    empty.querySelector('span').textContent = verifiedEmpty
      ? 'Try another wallet, or refresh after a purchase or transfer.'
      : !account ? 'Connect the wallet that holds your Gogh Punks. Ownership is checked on Robinhood Chain.'
        : state.wallet?.chainId !== CHAIN_ID ? 'Use Switch network above to see your Punks.' : 'Your roster will appear after ownership is verified.';
  }
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
    button.tabIndex = punk.tokenId === state.selected?.tokenId ? 0 : -1;
    button.dataset.tokenId = punk.tokenId;
    const image = document.createElement("img"); image.alt = `Gogh Punk #${punk.tokenId}`;
    image.src = cleanImage(punk.image); image.loading = "lazy"; image.decoding = "async";
    const label = document.createElement("span");
    const name = document.createElement("b"); name.textContent = `#${punk.tokenId}`;
    const mode = document.createElement("small"); mode.textContent = reviewModeForPunk(punk);
    const notification = document.createElement("span"); notification.className = "mission-badge roster-mission-badge";
    notification.dataset.rosterMissionBadge = String(punk.tokenId); notification.hidden = true;
    const activation = document.createElement('small'); activation.className = 'roster-activation';
    activation.dataset.rosterActivation = String(punk.tokenId);
    label.append(name, mode); button.append(image, label, activation, notification);
    button.addEventListener("click", event => selectPunk(punk.tokenId, { focusRoster: event.detail === 0 }));
    button.addEventListener('keydown', event => {
      const index = state.punks.findIndex(item => item.tokenId === punk.tokenId);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? state.punks.length - 1
        : event.key === 'ArrowRight' ? (index + 1) % state.punks.length
          : event.key === 'ArrowLeft' ? (index - 1 + state.punks.length) % state.punks.length : null;
      if (next === null) return;
      event.preventDefault();
      if (next !== index) selectPunk(state.punks[next].tokenId, { focusRoster: true });
    });
    roster.append(button);
  }
  renderMissionBadges(); renderActivationGuide();
  if (restoreFocus) roster.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
}

function renderSelected() {
  swarmWalletControl?.refresh();
  swarmReviewGate?.refresh();
  swarmControl?.refresh();
  brokerPreferences?.refresh();
  gasFundingRecovery?.refresh();
  const punk = state.selected;
  if (!punk) return;
  const displayMode = reviewModeForPunk(punk);
  all("[data-punk-token], [data-talk-token], [data-chat-token]").forEach((node) => { node.textContent = punk.tokenId; });
  set("[data-hero-number]", punk.tokenId);
  set("[data-punk-mode]", displayMode);
  set("[data-mode-summary]", displayMode);
  set("[data-strategy-mode]", `${displayMode} MODE`);
  set("[data-punk-wallet]", short(punk.account));
  const agentRuntime = selectedAgentAccount()?.runtime;
  const fundingAgent = state.fundAgentAccount && agentRuntime?.accountCreated === true;
  const fundDestination = fundingAgent ? agentRuntime.account : punk.account;
  set("[data-fund-wallet]", short(fundDestination));
  set("[data-fund-balance-label]", fundingAgent
    ? "CURRENT PUNK AGENT GAS BALANCE" : "CURRENT V3 PUNK WALLET BALANCE");
  set("[data-fund-destination-name]", fundingAgent
    ? "Punk Agent Account gas balance" : "selected Punk Wallet");
  const balance = Number(punk.balanceEth ?? 0); const reserve = Number(punk.reserveEth ?? 0);
  const available = Math.max(0, balance - reserve);
  const balanceKnown = punk.balanceLoaded !== false && !punk.balanceError;
  const nativeDisplay = balanceKnown ? `${punk.balanceEth} ETH` : punk.balanceError ? "UNAVAILABLE" : "CHECKING…";
  const wethDisplay = punk.wethBalanceEth == null ? punk.balanceError ? "UNAVAILABLE" : "CHECKING…" : `${punk.wethBalanceEth} WETH`;
  set("[data-punk-balance]", nativeDisplay);
  set("[data-fund-balance]", fundingAgent
    ? ethFromWei(agentRuntime.nativeBalance ?? "0") : balanceKnown ? punk.balanceEth : "—");
  set("[data-wrap-eth-balance]", nativeDisplay);
  set("[data-wrap-weth-balance]", wethDisplay);
  set("[data-collection-eth]", nativeDisplay);
  set("[data-collection-weth]", wethDisplay);
  set("[data-punk-nfts]", punk.acquisitionCount ?? (PREVIEW ? punk.nfts : '—'));
  set("[data-gallery-count]", state.gallery.filter(entry => Array.isArray(entry) || entry.tokenId != null).length);
  set("[data-punk-reserve]", `${balanceKnown ? punk.reserveEth : "—"} ETH`);
  set("[data-fund-reserve]", `${balanceKnown ? punk.reserveEth : "—"} ETH`);
  set("[data-available-budget]", `${balanceKnown ? displayEthBudget(punk.balanceEth, punk.reserveEth) : "—"} ETH AVAILABLE`);
  set("[data-fund-available]", `${balanceKnown ? displayEthBudget(punk.balanceEth, punk.reserveEth) : "—"} ETH`);
  const meter = one("[data-budget-meter]");
  if (meter) {
    const meterKnown = balanceKnown && Number.isFinite(balance) && Number.isFinite(reserve);
    meter.hidden = !meterKnown;
    meter.style.width = `${meterKnown && balance > 0 ? Math.min(100, available / balance * 100) : 0}%`;
  }
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

function invalidateConversationRequests() {
  state.chatRequestId += 1; state.linkRequestId += 1;
  window.dispatchEvent(new Event('gogh:action-invalidated'));
  const result = one('[data-action-result]');
  result?.replaceChildren(); if (result) result.hidden = true;
  const link = one('[data-link-form]'); link?.removeAttribute('aria-busy');
  const check = link?.querySelector('button[type="submit"]');
  if (check) { check.disabled = false; check.textContent = 'CHECK LINK'; }
  set('[data-link-result]', 'Paste a link to check its project, mint details and available safety information.');
}

function selectPunk(tokenId, { focusRoster = false } = {}) {
  swarmReviewGate?.invalidate();
  const punk = state.punks.find((item) => item.tokenId === tokenId);
  if (!punk) return;
  invalidateConversationRequests();
  state.balanceRequestId += 1; state.balanceReads?.clear();
  set('[data-current-recall-result]', '');
  state.selected = punk; state.localStrategy = null; state.localSkill = null; state.lastInspection = null;
  const key = selectedReviewKey();
  state.lastInspection = key ? state.reviewInspections.get(key) ?? null : null;
  state.hydratedTokenId = null; resetGallery();
  state.fundingPlan = null; state.wrappedPlan = null; state.withdrawalAsset = null;
  state.gasFundingPlan = null; state.swarmFundingContext = null;
  one("[data-agent-gas-confirm]").checked = false;
  one("[data-resume-chat-mission]").hidden = true;
  one("[data-agent-gas-form] button").textContent = "REVIEW & SIMULATE";
  one("[data-agent-gas-transaction]").hidden = true;
  set("[data-agent-gas-result]", "Review this Punk's source and gas amount. No funds move until MetaMask approval.");
  state.fundAgentAccount = false;
  state.reviewMintOpportunityId = null; state.reviewMintArtifact = null;
  state.reviewMintPrepared = null; state.reviewMintBusy = false;
  state.withdrawalAmount = "1"; state.withdrawalPlan = null; state.withdrawalBusy = false;
  if (!PREVIEW) { state.gallery = []; state.activity = []; state.activityLoaded = false; }
  renderSelected(); renderCollectionWithdrawal(); scheduleSelectedReviewMissionCheck();
  const activeTab = one('[data-v2-tab][aria-selected="true"]')?.dataset.v2Tab;
  if (activeTab === 'activity') missionNotifications?.markRead({ owner: state.wallet?.account, tokenId: String(state.selected?.tokenId) });
  if (!PREVIEW && activeTab) void hydrateSelected(activeTab);
  if (focusRoster) {
    const option = one('[data-punk-roster] [aria-selected="true"]');
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } else one("[data-selected-stage]").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function resetGallery() {
  state.galleryRequestId += 1;
  state.galleryTokenId = null; state.galleryLoadingTokenId = null;
  state.galleryStatus = "idle"; state.galleryNote = "";
}

function beginCollectionRead(punk) {
  const owner = state.wallet?.account, requestId = ++state.galleryRequestId;
  state.galleryLoadingTokenId = punk.tokenId; state.galleryStatus = "loading";
  state.galleryNote = `Checking Punk #${punk.tokenId}’s collection…`;
  state.gallery = []; renderGallery();
  return () => state.galleryRequestId === requestId && state.selected?.tokenId === punk.tokenId
    && state.wallet?.account === owner && state.wallet?.chainId === CHAIN_ID;
}

function collectionFailed() {
  state.gallery = []; state.galleryStatus = "error";
  state.galleryNote = "Your collection couldn’t be loaded. Nothing was moved. Choose Refresh collection to try again.";
}

function renderGallery() {
  const grid = one("[data-gallery-grid]"); grid.replaceChildren();
  const loading = state.galleryStatus === "loading";
  grid.setAttribute("aria-busy", String(loading));
  const refresh = one('[data-collection-refresh]');
  if (refresh) { refresh.disabled = loading || !state.selected; refresh.textContent = loading ? 'REFRESHING…' : 'REFRESH COLLECTION'; }
  set('[data-gallery-status]', state.galleryNote);
  set('[data-gallery-count]', PREVIEW || state.galleryStatus === 'ready' ? state.gallery.length : '—');
  if (!state.gallery.length) {
    const empty = document.createElement("p"); empty.className = "panel-empty";
    empty.textContent = loading ? "Checking which NFTs your Punk holds. Artwork will appear when available."
      : state.galleryStatus === 'error' ? "Your NFTs remain in their wallets while the collection is unavailable."
      : PREVIEW ? "This Punk has no displayed pieces."
      : state.galleryStatus === 'ready' ? "No current NFTs were verified in this check. Refresh, or check a missing item using its OpenSea link."
      : "Your Punk’s verified NFTs will appear here.";
    grid.append(empty); return;
  }
  for (const entry of state.gallery) {
    const itemData = Array.isArray(entry) ? {
      image: entry[0], title: entry[1], provenance: entry[2], detail: entry[3],
    } : entry;
    const item = document.createElement("article"); item.className = "gallery-item";
    const image = document.createElement("img"); image.src = cleanImage(itemData.image); image.alt = itemData.title; image.loading = "lazy"; image.decoding = "async";
    const copy = document.createElement("div"); const type = document.createElement("span"); type.textContent = itemData.provenance;
    const heading = document.createElement("h3"); heading.textContent = itemData.title;
    const text = document.createElement("p"); text.textContent = itemData.detail;
    copy.append(type, heading, text);
    if (itemData.tokenId != null && state.selected) {
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
      if (itemData.custodyType === 'PUNK_AGENT_ACCOUNT') {
        if (itemData.ownershipStatus === 'LIVE_VERIFIED' && ['ERC721', 'ERC1155'].includes(itemData.standard)) {
          const recover = document.createElement('button'); recover.type = 'button'; recover.textContent = 'WITHDRAW NFT';
          recover.setAttribute('aria-label', `Review Agent withdrawal of ${itemData.title}`);
          recover.addEventListener('click', () => { activateTab('fund'); agentRecoveryControl?.openAsset(itemData);
            one('#agent-recovery')?.scrollIntoView({ block: 'start' }); });
          actions.append(recover);
        }
      } else if (itemData.withdrawControlUrl === `/broker/punk/${state.selected.tokenId}?tab=assets`) {
        const withdraw = document.createElement('a'); withdraw.textContent = 'MANAGE V3 NFT'; withdraw.href = itemData.withdrawControlUrl;
        actions.append(withdraw);
      } else if (!itemData.custodyType && ['ERC721', 'ERC1155'].includes(itemData.standard)) {
        const withdraw = document.createElement("button"); withdraw.type = "button";
        withdraw.textContent = "WITHDRAW"; withdraw.setAttribute("aria-label", `Withdraw ${itemData.title}`);
        withdraw.disabled = state.withdrawalBusy;
        withdraw.addEventListener("click", () => selectCollectionWithdrawal(itemData));
        actions.append(withdraw);
      }
      copy.append(actions);
    }
    item.append(image, copy); grid.append(item);
  }
}

function activityDetail(entry) {
  const detail = entry.detail;
  if (typeof detail === "string") return detail;
  if (entry.type === 'STRATEGY_ACTIVATED') return detail?.operatingMode === 'AUTONOMOUS'
    ? 'Automatic mint rules saved. Check the current mission for wallet permission and worker status.'
    : `Rules saved in ${detail?.operatingMode ?? 'review'} mode. Automatic minting has not started. Use Start free-mint mission to review its wallet permission.`;
  if (entry.type === 'PAID_MINT_COMPLETED') return `Paid mint confirmed · Peppies World #${detail?.tokenId??'?'} · delivered to #93’s Agent wallet.`;
  if (['PAID_MINT_SIGNED','PAID_MINT_SUBMITTED'].includes(entry.type)) return 'Paid mint transaction saved. Waiting for verified delivery.';
  if (['PAID_MINT_STOPPED','PAID_MINT_REVERTED'].includes(entry.type)) return 'Paid mint stopped. Recheck Directed Paid Mint in Talk to cancel the mission and withdraw unused funds.';
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
    empty.textContent = PREVIEW || state.activityLoaded ? "No activity yet. Choose a mission in Actions to get started." : "Loading your Punk's activity…";
    if (PREVIEW || state.activityLoaded) {
      const talk = document.createElement('button'); talk.type = 'button'; talk.className = 'outline-button'; talk.textContent = 'TALK TO MY PUNK';
      talk.addEventListener('click', () => { activateTab('talk'); one('[data-agent-options] select')?.focus(); });
      empty.append(document.createElement('br'), talk);
    }
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
  all("[data-v2-tab]").forEach((button) => {
    const selected = button.dataset.v2Tab === name;
    button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
    if (selected && matchMedia('(max-width: 720px)').matches) {
      const nav = button.parentElement;
      nav.scrollLeft += button.getBoundingClientRect().left - nav.getBoundingClientRect().left
        - (nav.clientWidth - button.offsetWidth) / 2;
    }
  });
  all("[data-v2-panel]").forEach((panel) => { panel.hidden = panel.dataset.v2Panel !== name; });
  if (name === "activity") {
    missionNotifications?.markRead({ owner: state.wallet?.account, tokenId: String(state.selected?.tokenId) });
    renderActivity();
  }
  if (name === "forge") forgeControl?.selectionChanged();
  history.replaceState(null, "", `${location.pathname}?${new URLSearchParams({ ...(PREVIEW ? { preview: "1" } : {}), tab: name,
    ...(state.selected?.tokenId || REQUESTED_PUNK ? { tokenId: state.selected?.tokenId ?? REQUESTED_PUNK } : {}) })}`);
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
  one("#agent-gas-amount").value = state.swarmFundingContext?.amountEth ?? action.amount ?? "";
  one("#agent-gas-source").value = state.swarmFundingContext ? "OWNER" : action.source ?? "PUNK";
  set("[data-agent-gas-result]", "Review the exact source and amount below. Nothing is sent by chat; simulation and your separate MetaMask confirmation are required.");
  const host = one("[data-talk-gas-host]");
  host.append(one("[data-agent-gas-panel]")); host.hidden = false;
  one("[data-resume-chat-mission]").hidden = !state.localStrategy;
  activateTab("talk");
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
  await loadAgentAccountStatus({ authenticate: true });
  if (state.selected === punk) renderAgentAccount();
}

function ethFromWei(value) { return displayEth(value); }

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
  state.balanceReads ??= new Map();
  const readKey = `${state.wallet.account}:${punk.tokenId}:${punk.account.toLowerCase()}`;
  if (state.balanceReads.has(readKey)) return state.balanceReads.get(readKey);
  const pending = read(); state.balanceReads.set(readKey, pending);
  try { return await pending; } finally { if (state.balanceReads.get(readKey) === pending) state.balanceReads.delete(readKey); }
  async function read() {
  const requestId = ++state.balanceRequestId; const owner = state.wallet?.account;
  const tokenId = punk.tokenId; const account = punk.account.toLowerCase();
  let timer;
  try {
  const [nativeRaw, wrappedRaw] = await Promise.race([Promise.all([
    provider.request({ method: "eth_getBalance", params: [account, "latest"] }),
    provider.request({ method: "eth_call", params: [{ to: ROBINHOOD_WETH,
      data: wrappedBalanceOfData(account) }, "latest"] }),
  ]), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Balance checks took too long. Refresh to try again.')), 10_000); })]);
  if (typeof nativeRaw !== "string" || !/^0x[0-9a-fA-F]+$/.test(nativeRaw)) {
    throw new Error("Punk ETH balance response is invalid.");
  }
  const nativeWei = BigInt(nativeRaw); const wrappedWei = decodeUint256(wrappedRaw);
  if (requestId !== state.balanceRequestId || state.wallet?.account !== owner
    || state.wallet?.chainId !== CHAIN_ID || state.selected?.tokenId !== tokenId
    || state.selected?.account?.toLowerCase() !== account) return;
  punk.nativeBalanceWei = nativeWei.toString(); punk.wethBalanceWei = wrappedWei.toString();
  punk.balanceEth = ethFromWei(punk.nativeBalanceWei);
  punk.wethBalanceEth = ethFromWei(punk.wethBalanceWei);
  punk.balanceLoaded = true; punk.balanceError = false; renderSelected();
  } catch (error) {
    if (requestId === state.balanceRequestId && state.wallet?.account === owner
      && state.wallet?.chainId === CHAIN_ID && state.selected === punk) {
      punk.balanceError = true; punk.wethBalanceEth = null; renderSelected();
    }
    throw error;
  } finally { clearTimeout(timer); }
  }
}

async function loadReviewCollection(punk, exactAsset = null) {
  if (!exactAsset && (state.galleryTokenId === punk.tokenId
    || state.galleryLoadingTokenId === punk.tokenId)) return;
  const tokenId = punk.tokenId; const isCurrent = beginCollectionRead(punk);
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
    if (!isCurrent()) return;
    const verifiedItems = validateWithdrawableNftAssets(assets, tokenId);
    punk.account = assets.account;
    state.gallery = verifiedItems.map((asset) => ({
      image: asset.imageUrl ?? "/assets/nft-placeholder.svg",
      title: asset.name ?? `${asset.collectionName ?? short(asset.collection)} #${asset.tokenId}`,
      provenance: `${asset.ownershipStatus.replaceAll("_", " ")} · ${asset.provenance.replaceAll("_", " ")} · ${asset.standard}`,
      detail: `${asset.collectionName ?? short(asset.collection)} · TOKEN #${asset.tokenId}${asset.acquiredAt ? ` · ${dateLabel(asset.acquiredAt)}` : ""}`,
      tokenId: asset.tokenId, collection: asset.collection, openSeaUrl: asset.openSeaUrl,
      standard: asset.standard, amount: asset.amount, collectionName: asset.collectionName,
    }));
    state.galleryTokenId = tokenId; state.galleryStatus = 'ready';
    state.galleryNote = 'Current ownership checked. Some NFTs may not be indexed yet.'; renderSelected();
  } catch {
    if (isCurrent()) collectionFailed();
  } finally {
    if (isCurrent()) { state.galleryLoadingTokenId = null; renderGallery(); }
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

async function loadProductionCollection(punk, { force = false } = {}) {
  if (state.galleryLoadingTokenId === punk.tokenId || (!force && state.galleryTokenId === punk.tokenId)) return;
  const tokenId = punk.tokenId, isCurrent = beginCollectionRead(punk);
  try {
    await ensureV2Session();
    if (!isCurrent()) return;
    const payload = await jsonRequest(`/api/v2/punks/${tokenId}/collection`, { timeoutMs: 25_000 });
    if (!isCurrent()) return;
    if (!Array.isArray(payload.holdings)) throw new Error('Collection response unavailable.');
      state.gallery = payload.holdings.map((holding) => ({
        image: cleanImage(holding.artwork?.imageUrl),
        title: holding.artwork?.name ?? `${short(holding.collection)} #${holding.tokenId}`,
        provenance: `${holding.provenance === "RECEIVED" ? "RECEIVED NFT" : holding.provenance === "V1" ? "EARLIER ART BROKER" : "CURRENT ART BROKER"} · ${holding.ownershipStatus === "LIVE_VERIFIED" ? "OWNERSHIP VERIFIED" : holding.acquisitionType}`,
        detail: `TOKEN #${holding.tokenId} · ${holding.mintCostWei == null ? "ACQUISITION COST UNKNOWN" : holding.mintCostWei === "0" ? "FREE" : `${ethFromWei(holding.mintCostWei)} ETH`} · ${holding.custodyType === "PUNK_AGENT_ACCOUNT" ? "held in this Punk’s Agent wallet" : "held in this Punk Wallet"}${holding.acquiredAt ? ` · acquired ${dateLabel(holding.acquiredAt)}` : ""}`,
        tokenId: holding.tokenId, collection: holding.collection, standard: holding.standard,
        custodyType: holding.custodyType, ownershipStatus: holding.ownershipStatus,
        withdrawControlUrl: holding.withdrawControlUrl, amount: holding.amount,
        openSeaUrl: /^0x[0-9a-f]{40}$/i.test(holding.collection) && /^(0|[1-9][0-9]*)$/.test(holding.tokenId)
          ? `https://opensea.io/item/robinhood/${holding.collection}/${holding.tokenId}` : null,
      }));
    state.galleryTokenId = tokenId; state.galleryStatus = 'ready';
    state.galleryNote = [payload.inventoryNote || 'Current ownership checked. Some NFTs may not be indexed yet.',
      payload.ownershipChecksUnavailable ? 'Some ownership checks are unavailable. Refresh to check again.' : '',
      payload.paidMintHistoryAvailable === false ? 'Recent mint history is temporarily unavailable.' : '',
      payload.discoverySourcesUnavailable?.length ? 'Some collection sources are still unavailable; verified NFTs are shown.' : '',
      payload.metadataUnavailable ? 'Some artwork is unavailable; verified NFTs are still shown.' : '',
    ].filter(Boolean).join(' ');
  } catch {
    if (isCurrent()) collectionFailed();
  } finally {
    if (isCurrent()) { state.galleryLoadingTokenId = null; renderGallery(); }
  }
}

async function hydrateSelected(tab) {
  const punk = state.selected; if (!punk) return;
  const tokenId = punk.tokenId, owner = state.wallet?.account;
  const isCurrent = () => state.selected === punk && state.wallet?.account === owner && state.wallet?.chainId === CHAIN_ID;
  if (!REVIEW_HOST && tab === 'collection') {
    void hydrateSelected('fund');
    return loadProductionCollection(punk);
  }
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
        await requireExistingV2Session();
        const payload = await jsonRequest(`/api/v2/punks/${tokenId}/activity`);
        if (!isCurrent()) return;
        state.activityLoaded = true;
      state.activity = payload.entries.map((entry) => [dateLabel(entry.occurredAt), entry.type,
          `CURRENT ART BROKER · ${String(entry.type).replaceAll("_", " ")}`,
          activityDetail(entry), entry.detail?.transactionHash]);
        renderActivity();
      }
      return;
    }
    await requireExistingV2Session();
    const profilePayload = state.hydratedTokenId === tokenId ? null
      : await jsonRequest(`/api/v2/punks/${tokenId}`);
    if (!isCurrent()) return;
    if (profilePayload?.profile) {
      punk.account = profilePayload.profile.punkWallet;
      punk.balanceEth = ethFromWei(profilePayload.profile.nativeBalanceWei);
      punk.nativeBalanceWei = profilePayload.profile.nativeBalanceWei;
      punk.balanceLoaded = true;
      punk.acquisitionCount = profilePayload.profile.collectionCount;
      punk.mode = profilePayload.profile.strategy?.state === "PAUSED" ? "PAUSED"
        : profilePayload.profile.strategy?.intent?.operatingMode ?? "ASK";
      const rules = profilePayload.profile.strategy;
      const walletRules = rules?.state === 'ACTIVE' && Date.parse(rules.expiresAt) > Date.now()
        && rules.intent?.expectedOwner === owner && rules.intent?.punkTokenId === tokenId
        && rules.intent?.punkWallet === punk.account?.toLowerCase();
      punk.strategy = walletRules ? rules : null;
      punk.reserveEth = walletRules ? ethFromWei(rules.intent.minimumReserveWei) : '0.0000';
      state.hydratedTokenId = tokenId; renderSelected();
    }
    if (tab === 'fund' && punk.account) void loadPunkBalances(punk).catch(() => {});
    if (tab === "activity") {
      const payload = await jsonRequest(`/api/v2/punks/${tokenId}/activity`);
      if (!isCurrent()) return;
      state.activityLoaded = true;
      state.activity = payload.entries.map((entry) => [dateLabel(entry.occurredAt), entry.type,
        `${entry.provenance === "V1" ? "EARLIER ART BROKER" : "CURRENT ART BROKER"} · ${String(entry.type).replaceAll("_", " ")}`,
        activityDetail(entry), entry.detail?.transactionHash]);
      renderActivity();
      if(payload.paidMintHistoryAvailable===false){const note=document.createElement('p');note.className='panel-empty';note.textContent='Paid-mint history is temporarily unavailable. Recheck the original paid mint in Actions.';one('[data-activity-feed]').append(note);}
    }
  } catch (error) {
    if (!isCurrent()) return;
    const message = error?.message ?? "Your Punk’s details couldn’t be loaded. Please try again.";
    if (tab === "collection") { collectionFailed(); renderGallery(); }
    if (tab === "activity") { state.activity = [["NOW", "UNAVAILABLE", "HISTORY NOT LOADED", message]]; renderActivity(); }
    if (!["collection", "activity"].includes(tab)) set("[data-wallet-state]", message);
  }
}

function addMessage(role, message, details = null) {
  renderActionFeedback(one('[data-action-result]'), role, message, details);
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

// Passive navigation may read an existing login, but must never open a wallet.
async function requireExistingV2Session() {
  const owner = state.wallet?.account, chainId = state.wallet?.chainId;
  const session = await jsonRequest('/api/v2/session');
  if (!owner || chainId !== CHAIN_ID || state.wallet?.account !== owner || state.wallet?.chainId !== chainId
    || session.walletAddress?.toLowerCase() !== owner) throw Error('Use Check status / Sign in to load your Punk’s private details.');
  return session;
}

const sessionRequests = new Map();
async function ensureV2Session(report = () => {}) {
  if (PREVIEW) return null;
  const key = `${state.wallet?.chainId}:${state.wallet?.account}`;
  if (sessionRequests.has(key)) return sessionRequests.get(key);
  const read = readV2Session(report);
  sessionRequests.set(key, read);
  try { return await read; }
  finally { if (sessionRequests.get(key) === read) sessionRequests.delete(key); }
}

async function readV2Session(report = () => {}) {
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
    void persistentWatchControl?.sessionChanged(current);
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
  void persistentWatchControl?.sessionChanged(confirmed);
  return confirmed;
}

async function activatePunkAgentMission(draft, report) {
  const selected = state.selected, owner = state.wallet?.account, tokenId = String(selected?.tokenId);
  const assertSelection = () => {
    if (state.selected !== selected || state.wallet?.account !== owner || state.wallet?.chainId !== CHAIN_ID
      || draft.intent?.expectedOwner !== owner || draft.intent?.punkTokenId !== tokenId) {
      throw Error('Punk or wallet changed. Check the original Punk’s mission status before continuing.');
    }
  };
  assertSelection();
  await ensureV2Session(report);
  assertSelection();
  report("Checking Punk Agent Account, bundler, signer, and worker readiness…");
  const status = await loadAgentAccountStatus({ authenticate: false });
  assertSelection();
  if (!status?.readiness?.setupAvailable) {
    throw Object.assign(new Error("Punk Agent Account infrastructure is not ready."),
      { code: "PUNK_AGENT_ACCOUNT_NOT_READY" });
  }
  const provider = window.__GOGH_WALLET_PROVIDER__;
  if (!provider?.request) throw new Error("Wallet provider unavailable.");
  const setup = await jsonRequest("/api/v2/agent-account/setup", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({
      owner, tokenId, intent: draft.intent,
    }), timeoutMs: 30_000 });
  assertSelection();
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
    const [walletChain, accounts] = await Promise.all([
      provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' }),
    ]);
    assertSelection();
    if (walletChain !== '0x1237' || accounts?.[0]?.toLowerCase() !== owner) throw Error('Reconnect the reviewed owner wallet on Robinhood Chain.');
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
    assertSelection();
  }
  report("Mission session confirmed on chain. Activating the server worker…");
  const receipt = await jsonRequest("/api/v2/agent-account/receipt", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, tokenId,
      sessionId: setup.sessionId, setupArtifactHash: setup.setup.artifactHash,
      authorizationTransactionHash }), timeoutMs: 30_000 });
  assertSelection();
  state.agentAccounts.delete(tokenId); state.hydratedTokenId = null;
  await loadAgentAccountStatus({ authenticate: false });
  await hydrateSelected("activity");
  assertSelection();
  return receipt;
}

function showConfirmation(draft) {
  state.localStrategy = draft;
  const intent = draft.intent ?? null;
  const view = intent ? {
    mode: intent.operatingMode,
    daily: intent.dailyMintLimit,
    total: intent.totalMintLimit,
    reserve: displayEth(intent.minimumReserveWei),
    gas: displayEth(intent.maxGasPerMintWei),
    supply: intent.maximumCollectionSupply ?? "NO LIMIT",
    tastes: intent.preferences.prefer.map((value) => value.replaceAll("_", " ")),
    presence: intent.onlinePresenceRequirement === "WEBSITE_OR_SOCIAL"
      ? "WEBSITE OR SOCIAL"
      : [intent.requiresWebsite && "WEBSITE",
        intent.requiresSocial && (intent.preferredSocialPlatforms.join(" + ") || "SOCIAL")]
        .filter(Boolean).join(" + "),
    target: intent.allowedContracts?.length
      ? intent.allowedContracts.join(' · ') : "SUPPORTED COLLECTIONS MATCHING YOUR RULES",
    free: intent.mintMode === "FREE_ONLY",
    maximumPrice: displayEth(intent.maxMintPriceWei),
  } : draft;
  const values = [
    ["NETWORK", "ROBINHOOD CHAIN"], ["MODE", view.mode],
    ["MINT PRICE", view.free ? "FREE ONLY" : `UP TO ${view.maximumPrice ?? "—"} ETH`], ["LOOKING FOR", view.tastes.join(" · ")],
    ["REQUIRES", [view.presence, "SCREEN + SIMULATION"].filter(Boolean).join(" · ")],
    ["DAILY LIMIT", view.daily], ["TOTAL LIMIT", view.total], ["MAX GAS", `${view.gas} ETH`], ["MINIMUM RESERVE", `${view.reserve} ETH`],
    ["MAX SUPPLY", view.supply], ["COLLECTIONS", view.target],
    ["PERMISSION EXPIRES", intent?.expiration ? new Date(intent.expiration).toLocaleString() : "See wallet permission"],
    ["STATUS", "PENDING OWNER CONFIRMATION"],
  ];
  const grid = one("[data-confirmation-grid]"); grid.replaceChildren();
  for (const [label, value] of values) {
    const row = document.createElement("div"); const name = document.createElement("span"); name.textContent = label;
    const output = document.createElement("b"); output.textContent = value; row.append(name, output); grid.append(row);
  }
  const activate = one("[data-activate-strategy]");
  const activateAndSend = one("[data-activate-send-strategy]");
  const accountStatus = selectedAgentAccount();
  const autonomousAvailable = accountStatus?.readiness?.setupAvailable === true;
  const setupBlockers = (accountStatus?.readiness?.blockers ?? [])
    .filter(value => !["ACCOUNT_NOT_ACTIVATED", "SESSION_NOT_AUTHORIZED", "AGENT_GAS_UNFUNDED"].includes(value))
    .map(blockerLabel).join(" · ");
  const activationLocked = view.mode === "AUTONOMOUS" && !autonomousAvailable
    || draft.state === "NEEDS_CLARIFICATION"
    || !!intent && (view.gas === "—" || view.reserve === "—" || !view.free && view.maximumPrice === "—");
  activate.disabled = activationLocked;
  activate.textContent = view.mode === "AUTONOMOUS"
    ? autonomousAvailable ? "AUTHORIZE MISSION" : "AUTONOMOUS LOCKED"
    : REVIEW_HOST && !draft.version ? "ACTIVATE ONLY" : "ACTIVATE STRATEGY";
  activateAndSend.hidden = !REVIEW_HOST || PREVIEW || Boolean(draft.version);
  activateAndSend.disabled = activationLocked;
  set("[data-strategy-activation-status]", activationLocked
    ? view.mode === "AUTONOMOUS"
      ? `Autonomous setup unavailable: ${accountStatus?.error || setupBlockers || "readiness not verified"}. Use Check Autonomous Readiness to retry.`
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

const rosterArtworkCache = new Map();
const rosterArtworkPending = new Map();

async function hydrateRosterArtwork() {
  if (PREVIEW || !state.wallet?.account || state.wallet.chainId !== CHAIN_ID) return;
  const owner = state.wallet.account;
  const missing = state.punks.filter(punk => !punk.image);
  const apply = (tokenId, imageUrl) => {
    if (!imageUrl || state.wallet?.account !== owner || state.wallet.chainId !== CHAIN_ID) return;
    const punk = state.punks.find(item => item.tokenId === tokenId);
    if (!punk) return;
    punk.image = imageUrl;
    const image = one(`[data-punk-roster] [data-token-id="${tokenId}"] img`);
    if (image) image.src = imageUrl;
    if (state.selected?.tokenId === tokenId) {
      all('[data-hero-art], [data-chat-avatar]').forEach(node => { node.src = imageUrl; });
    }
  };
  const uncached = [];
  for (const punk of missing) {
    const entry = rosterArtworkCache.get(punk.tokenId);
    if (entry?.expiresAt > Date.now()) apply(punk.tokenId, entry.image);
    else if (rosterArtworkPending.has(punk.tokenId)) {
      void rosterArtworkPending.get(punk.tokenId).then(() => apply(punk.tokenId, rosterArtworkCache.get(punk.tokenId)?.image));
    } else uncached.push(punk.tokenId);
  }
  // At most two batches per refresh. Large rosters remain usable while pictures fill in.
  await Promise.all([uncached.slice(0, 32), uncached.slice(32, 64)].filter(ids => ids.length).map(ids => {
    const read = (async () => {
      let entries = [];
      try {
        const payload = await jsonRequest(`/api/broker/punk-artwork?tokenIds=${ids.join(',')}`, { timeoutMs: 15_000 });
        if (payload.chainId !== CHAIN_ID || payload.collection !== COLLECTION || !Array.isArray(payload.artworks)
          || payload.artworks.length !== ids.length || new Set(payload.artworks.map(item => item?.tokenId)).size !== ids.length
          || payload.artworks.some(item => !ids.includes(item?.tokenId))) throw new Error('Artwork response mismatch.');
        entries = payload.artworks;
      } catch { /* Artwork cannot grant authority or remove a verified owned Punk. */ }
      for (const id of ids) {
        const image = cleanImage(entries.find(item => item.tokenId === id)?.artwork?.imageUrl, null);
        rosterArtworkCache.set(id, { image, expiresAt: Date.now() + (image ? 3_600_000 : 15_000) });
        apply(id, image);
      }
      while (rosterArtworkCache.size > 512) rosterArtworkCache.delete(rosterArtworkCache.keys().next().value);
    })();
    for (const id of ids) rosterArtworkPending.set(id, read);
    return read.finally(() => { for (const id of ids) if (rosterArtworkPending.get(id) === read) rosterArtworkPending.delete(id); });
  }));
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
      image: item.artwork?.imageUrl ?? null,
      balanceEth: "0", reserveEth: "0", balanceLoaded: false, wethBalanceEth: null,
      acquisitionCount: null, mode: "ASK" };
  });
}

function applyOwnedPunks(punks) {
  const selectedTokenId = state.selected?.tokenId ?? REQUESTED_PUNK;
  state.punks = punks;
  state.selected = punks.find((punk) => punk.tokenId === selectedTokenId) ?? punks[0] ?? null;
  const reviewKey = selectedReviewKey();
  state.lastInspection = reviewKey ? state.reviewInspections.get(reviewKey) ?? null : null;
  state.gallery = []; state.activity = []; state.activityLoaded = false;
  state.hydratedTokenId = null; resetGallery();
  renderRoster(); renderSelected(); scheduleSelectedReviewMissionCheck();
  void hydrateRosterArtwork();
  const activeTab = all("[data-v2-tab]").find((button) => button.getAttribute("aria-selected") === "true")?.dataset.v2Tab;
  if (state.selected && activeTab) void hydrateSelected(activeTab);
  if (requestedRecovery && state.selected?.tokenId === REQUESTED_PUNK && agentRecoveryControl) {
    requestedRecovery = false; one('#agent-recovery')?.scrollIntoView({ block: 'start' });
  }
}

function clearTransferredPunkReview() {
  set('[data-current-recall-result]', '');
  invalidateConversationRequests();
  state.localStrategy = null; state.localSkill = null; state.lastInspection = null;
  state.fundingPlan = null; state.gasFundingPlan = null; state.swarmFundingContext = null;
  state.wrappedPlan = null; state.withdrawalPlan = null;
  state.withdrawalAsset = null; state.fundAgentAccount = false;
  state.reviewMintOpportunityId = null; state.reviewMintArtifact = null; state.reviewMintPrepared = null;
  for (const dialog of all('dialog[open]')) dialog.close();
  all('[data-fund-confirm], [data-agent-gas-confirm], [data-weth-confirm]').forEach(input => { input.checked = false; });
  // Private conversation maps stay owner-scoped. Never attach the sold Punk's open
  // transcript or unsigned review to whichever Punk is selected next.
  const result = one('[data-action-result]'); result?.replaceChildren(); if (result) result.hidden = true;
}

function setup() {
  missionNotifications = createMissionNotifications({ onChange: renderMissionBadges });
  one('[data-mission-updates-read]')?.addEventListener('click', () => {
    if (state.wallet?.chainId === CHAIN_ID) missionNotifications.markRead({ owner: state.wallet?.account });
  });
  restoreReviewSessionState();
  // AI and model discovery are disabled. Keep holder onboarding local.
  let welcomeDismissed = false;
  brokerPreferences = { preference: () => 'AUTO', refresh: () => {
    const welcome = one('[data-broker-welcome]');
    welcome.hidden = welcomeDismissed || !state.wallet?.account || !state.selected;
    const token = welcome.querySelector('[data-welcome-token]');
    if (token) token.textContent = state.selected?.tokenId ?? '';
  } };
  all('[data-welcome-action]').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.welcomeAction)));
  one('[data-welcome-dismiss]').addEventListener('click', () => { welcomeDismissed = true; brokerPreferences.refresh(); });
  brokerPreferences.refresh();
  document.addEventListener('error', event => {
    const image = event.target;
    if (image instanceof HTMLImageElement && !image.src.endsWith('/assets/nft-placeholder.svg')) {
      image.src = '/assets/nft-placeholder.svg';
    }
  }, true);
  one('[data-collection-refresh]')?.addEventListener('click', () => {
    if (!state.selected || PREVIEW) return;
    if (state.selected.account) void loadPunkBalances(state.selected).catch(() => {});
    if (REVIEW_HOST) { state.galleryTokenId = null; void loadReviewCollection(state.selected); }
    else void loadProductionCollection(state.selected, { force: true });
  });
  const ownerRefresh = createOwnerRefresh({
    getContext: () => ({ owner: PREVIEW ? null : state.wallet?.account, chainId: state.wallet?.chainId,
      visible: !document.hidden, loading: Boolean(state.ownershipLoadingAccount) }),
    getPunks: () => state.punks,
    readOwned: async account => { const punks = await fetchOwnedPunks(account);
      if (state.wallet?.account === account) void hydrateRosterArtwork(); return punks; },
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
      applyOwnedPunks(punks.map(punk => ({ ...punk, ...prior.get(punk.tokenId), image: punk.image ?? prior.get(punk.tokenId)?.image ?? null })));
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
  one("[data-current-mission-recall]").addEventListener("click", recallSelectedReviewAgent);
  one("[data-review-agent-test]").addEventListener("click", () => sendReviewAgentOut({ testMode: true }));
  one("[data-fund-agent-account]").addEventListener("click", () => {
    state.fundAgentAccount = false; state.fundingPlan = null;
    one("[data-fund-confirm]").checked = false;
    activateTab("fund"); renderSelected();
    one("#agent-gas-amount").focus();
  });
  one("[data-agent-gas-recheck]").addEventListener("click", async () => {
    if (state.selected?.account) void loadPunkBalances(state.selected).catch(() => {});
    set("[data-agent-gas-readiness]", "Checking readiness; MetaMask may request a sign-in message, not a funding transaction…");
    await loadAgentAccountStatus({ authenticate: true });
    renderAgentAccount();
  });
  one("[data-open-agent-readiness]").addEventListener("click", () => {
    void loadAgentAccountStatus({ authenticate: true });
  });
  one("[data-run-agent-mission]").addEventListener("click", async (event) => {
    const button = event.currentTarget, punk = state.selected, owner = state.wallet?.account;
    const sessionId = selectedAgentAccount()?.mission?.sessionId;
    if (button.disabled || button.hasAttribute("aria-busy") || !punk || !sessionId) return;
    button.setAttribute("aria-busy", "true"); button.disabled = true;
    const current = () => state.selected === punk && state.wallet?.account === owner;
    set("[data-agent-mission-run-status]", "Checking this approved mission once…");
    try {
      await ensureV2Session();
      if (!current()) return;
      const result = await jsonRequest(`/api/v2/punks/${punk.tokenId}/agent-account/run`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }), timeoutMs: 60_000,
      });
      if (!current()) return;
      const outcome = result.submitted ? "Mint submitted under your approved mission. Check Activity for its receipt."
        : result.status === "NO_ELIGIBLE_MATCH" ? "One check completed. No mint passed every approved rule. Check Activity for the reasons."
          : `Mission check: ${blockerLabel(result.status)}. Check Activity for the latest result.`;
      set("[data-agent-mission-run-status]", outcome); addMessage("punk", outcome);
      await loadAgentAccountStatus({ authenticate: false });
    } catch (error) {
      if (current()) {
        const message = `${error?.message ?? "Mission check could not finish."} Check Activity before retrying; a pending transaction must be reconciled first.`;
        set("[data-agent-mission-run-status]", message); addMessage("punk", message);
      }
    } finally {
      button.removeAttribute("aria-busy");
      button.disabled = !current() || selectedAgentAccount()?.readiness?.manualExecutionReady !== true;
    }
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
  const actionTabs = all('[data-v2-tab]');
  one('.broker-tabs').setAttribute('role', 'tablist');
  actionTabs.forEach((button, index) => {
    const name = button.dataset.v2Tab, panel = one(`[data-v2-panel="${name}"]`);
    button.setAttribute('role', 'tab'); button.id = `punk-tab-${name}`;
    button.setAttribute('aria-controls', `punk-panel-${name}`);
    button.tabIndex = button.getAttribute('aria-selected') === 'true' ? 0 : -1;
    panel.id = `punk-panel-${name}`; panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => activateTab(name));
    button.addEventListener('keydown', event => {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? actionTabs.length - 1
        : event.key === 'ArrowRight' ? (index + 1) % actionTabs.length
          : event.key === 'ArrowLeft' ? (index - 1 + actionTabs.length) % actionTabs.length : null;
      if (next === null) return;
      event.preventDefault();
      actionTabs.forEach((tab, at) => { tab.tabIndex = at === next ? 0 : -1; });
      actionTabs[next].focus();
    });
  });
  all("[data-suggestion]").forEach((button) => button.addEventListener("click", () => {
    void runAgentAction(button.dataset.suggestion);
  }));
  all("[data-show-link]").forEach((button) => button.addEventListener("click", () => {
    one("[data-link-form]").hidden = false; one("#mint-link").focus();
  }));
  mountFeatureHelp(document);
  let actionBusy = false;
  one('[data-current-mission-check]').addEventListener('click', () => { void loadAgentAccountStatus({ authenticate: true }); });
  one('[data-start-free-mission]').addEventListener('click', () => {
    activateTab('talk');
    void runAgentAction(START_FREE_MINT_COMMAND);
  });
  one('[data-new-free-search]').addEventListener('click', () => {
    activateTab('talk');
    void runAgentAction(NEW_FREE_MINT_SEARCH_COMMAND);
  });
  one('[data-agent-gas-setup]').addEventListener('click', () => {
    activateTab('talk'); void runAgentAction(START_FREE_MINT_COMMAND);
  });
  const openPromptPanel = (panel) => {
    if (panel === "link") {
      activateTab("talk"); one("[data-link-form]").hidden = false; one("#mint-link").focus();
    } else {
      activateTab(panel);
      const heading = one(`[data-v2-panel="${panel}"] h2`);
      heading?.setAttribute("tabindex", "-1"); heading?.focus();
    }
  };
  const agentOptions = mountAgentOptions({ root: one('[data-agent-options]'),
    canAutomate: () => !one('[data-operating-mode][value="AUTONOMOUS"]').disabled,
    submit: command => { void runAgentAction(command); } });
  all('[data-agent-navigate]').forEach(button => button.addEventListener('click', () => {
    const target = button.dataset.agentNavigate;
    if (target === 'options') one('[data-agent-options]').scrollIntoView({ block: 'start' });
    else if (target === 'mint') { one('[data-public-paid-panel]').scrollIntoView({ block: 'start' }); one('[data-public-paid-panel] input')?.focus({ preventScroll: true }); }
    else openPromptPanel(target);
  }));
  const setChatBusy = (busy) => {
    actionBusy = busy;
    one('[data-agent-options]').toggleAttribute('aria-busy', busy);
    all('[data-suggestion], [data-start-free-mission], [data-new-free-search]').forEach(button => { button.disabled = busy; });
    agentOptions.setBusy(busy);
  };
  window.addEventListener('gogh:action-invalidated', () => setChatBusy(false));
  all("[data-operating-mode]").forEach((input) => input.addEventListener("change", () => {
    if (!input.checked) return;
    const command = input.value === "AUTONOMOUS"
      ? "Use my Punk Agent Account autonomously. Keep every existing collecting rule and show me the complete mission for approval."
      : input.value === "ASSIST" ? "Switch to assist mode. Keep every existing collecting rule."
        : "Ask me first. Keep every existing collecting rule.";
    activateTab("talk");
    void runAgentAction(command);
  }));
  const runAgentAction = async (command) => {
    const message = command.trim();
    if (!message || actionBusy || !state.selected) return;
    const selected = state.selected, selectedOwner = state.wallet?.account, selectedChain = state.wallet?.chainId;
    const requestId = ++state.chatRequestId;
    const isCurrent = () => requestId === state.chatRequestId && state.selected === selected
      && state.wallet?.account === selectedOwner && state.wallet?.chainId === selectedChain;
    const setBusy = busy => { if (isCurrent()) setChatBusy(busy); };
    const failed = error => {
      if (!isCurrent()) return;
      setBusy(false);
      addMessage('punk', `${error?.message ?? 'The action could not finish.'} Your rules have not changed. Choose the options again to retry.`);
    };
    addMessage("owner", message);
    const chatAction = punkChatAction(message);
    if (chatAction?.kind === "NAVIGATE") {
      openPromptPanel(chatAction.panel);
      return;
    }
    if (chatAction?.kind === 'FORGE') {
      activateTab('forge');
      addMessage('punk', 'The Forge shows training credits, learned skills and your equipped loadout. Open a skill to see what it can do. Burn practice runs on a disposable test chain during final testing.');
      return;
    }
    if (chatAction?.kind === "GAS" || chatAction?.kind === "STATUS") {
      const punk = state.selected;
      setBusy(true);
      try {
        if (chatAction.kind === "GAS") {
          addMessage("punk", "Let's review gas funding here. Choose the source and exact amount, simulate, then approve in MetaMask. Funding won't start a mission.");
          await openChatGasReview(chatAction);
        } else {
          const status = await loadAgentAccountStatus({ authenticate: true });
          if (isCurrent()) addMessage("punk", agentChatStatus(status));
        }
      } catch (error) { failed(error); } finally { setBusy(false); }
      return;
    }
    if (chatAction?.kind === "RECALL") {
      setBusy(true);
      try { await recallSelectedReviewAgent(); }
      catch (error) { failed(error); }
      finally { setBusy(false); }
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
    setBusy(true);
    let draft;
    let reply = null;
    if (PREVIEW) {
      try {
        const response = await fetch("/api/local-art-broker-v2/chat", { method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tokenId: state.selected.tokenId, message }) });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) throw new Error(payload?.message ?? "Local strategy draft failed.");
        if (!isCurrent()) return;
        draft = payload.draft;
      } catch (error) {
        failed(error);
        return;
      }
    } else {
      try {
        const punk = state.selected, owner = state.wallet?.account;
        await ensureV2Session();
        await loadAgentAccountStatus({ authenticate: true });
        if (!isCurrent()) {
          setBusy(false); return;
        }
        const payload = await jsonRequest(`/api/v2/punks/${punk.tokenId}/chat`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, providerPreference: brokerPreferences.preference() }),
        });
        if (!isCurrent()) {
          setBusy(false); return;
        }
        draft = payload.draft; reply = payload.reply;
        if (payload.responseKind === 'PUBLIC_PAID_MINT_REVIEW') {
          setBusy(false); addMessage('punk', reply);
          await publicPaidControl?.openDraft(payload.paidDraft);
          return;
        }
        if (payload.responseKind === 'PAID_MINT_REVIEW') {
          setBusy(false); addMessage('punk',reply);
          await directedPaidControl?.openDraft(payload.paidDraft);
          return;
        }
        if (payload.responseKind === "SKILL_DRAFT") {
          const skill = normalizeReviewSkill(payload.skillDraft);
          if (skill.punkTokenId !== punk.tokenId || skill.expectedOwner !== owner
            || skill.punkWallet !== punk.account.toLowerCase() || skill.state !== "DRAFT") {
            throw new Error("The skill draft no longer matches this Punk and owner.");
          }
          setBusy(false); addMessage("punk", reply); showSkillConfirmation(skill);
          return;
        }
        if (payload.responseKind === "CONVERSATION") {
          set("[data-intelligence-status]", payload.providerAvailable
            ? "RULE-BASED AGENT" : "RULE-BASED AGENT");
        }
      } catch (error) {
        failed(error);
        return;
      }
    }
    if (!isCurrent()) return;
    setBusy(false);
    if (!draft) { addMessage("punk", reply); return; }
    if (draft.intent?.operatingMode === "AUTONOMOUS") {
      await loadAgentAccountStatus({ authenticate: false });
      if (!isCurrent()) return;
      const runtime = selectedAgentAccount()?.runtime;
      if (runtime?.accountCreated && runtime.nativeBalance === "0" && runtime.entryPointDeposit === "0") {
        state.localStrategy = draft;
        addMessage("punk", "Your mission draft is saved, but my Agent gas is empty. Review funding here first, then use REVIEW SAVED MISSION. Neither step grants the other permission.");
        await openChatGasReview();
        return draft;
      }
    }
    const intent = draft.intent;
    const tastes = intent ? intent.preferences.prefer.map((value) => value.replaceAll("_", " ")) : draft.tastes;
    addMessage("punk", reply
      ?? `GOT IT. ${(intent?.mintMode === "FREE_ONLY" || draft.free) ? "FREE ONLY. " : ""}${tastes.join(" + ")}. ${intent?.dailyMintLimit ?? draft.daily} MAX TODAY. ${intent?.totalMintLimit ?? draft.total ?? 1} MAX FOR THIS STRATEGY. REVIEW THE RULES BEFORE THEY CHANGE.`);
    addReviewActivity("DRAFT", "STRATEGY DRAFT CREATED",
      "Awaiting owner confirmation · Punk has not been sent out");
    showConfirmation(draft);
    return draft;
  };
  swarmWalletControl = mountSwarmWallet({ root: one('[data-swarm-wallet-panel]'),
    getContext: () => ({ owner: state.wallet?.account, chainId: state.wallet?.chainId, preview: PREVIEW }),
    getPunks: () => PREVIEW ? [] : state.punks, getProvider: () => window.__GOGH_WALLET_PROVIDER__,
  });
  one('[data-swarm-wallet-details]').hidden = one('[data-swarm-wallet-panel]').hidden;
  one('[data-open-swarm-wallet]').hidden = one('[data-swarm-wallet-panel]').hidden;
  one('[data-open-swarm-wallet]').addEventListener('click', () => {
    const details = one('[data-swarm-wallet-details]');
    details.open = true; details.scrollIntoView({ block: 'start' });
  });
  swarmReviewGate = createSwarmReviewGate({ dialog: one('[data-swarm-review-dialog]'),
    getContext: () => ({ owner: state.wallet?.account, chainId: state.wallet?.chainId }),
    isOwned: tokenId => state.punks.some(punk => String(punk.tokenId) === tokenId),
  });
  swarmControl = mountSwarm({ root: one('[data-swarm-panel]'),
    getContext: () => ({ owner: state.wallet?.account, chainId: state.wallet?.chainId }),
    getPunks: () => PREVIEW ? [] : state.punks,
    openReview: async ({ tokenId, command, options }) => {
      if (PREVIEW || actionBusy || one('[data-activate-strategy]').dataset.busy === 'true'
        || one('[data-confirmation-dialog]').open) throw Error('Finish the current review before opening another Punk.');
      const confirmed = await swarmReviewGate.review({ tokenId, command, options });
      if (!confirmed) return { cancelled: true };
      selectPunk(tokenId); activateTab('talk');
      return runAgentAction(command);
    },
    getFundingState: tokenId => getAgentGasFundingState(state.wallet?.account?.toLowerCase(), String(tokenId)),
    openFunding: async allocation => {
      if (PREVIEW || actionBusy || state.gasFundingBusy || one('[data-confirmation-dialog]').open) throw Error('Finish the current wallet review first.');
      selectPunk(allocation.tokenId);
      state.swarmFundingContext = { ...allocation };
      currentSwarmFunding();
      one('#agent-gas-source').value = 'OWNER'; one('#agent-gas-amount').value = allocation.amountEth;
      one('[data-agent-gas-confirm]').checked = false;
      activateTab('fund'); renderAgentGasFunding();
      one('[data-agent-gas-panel]').scrollIntoView({ block: 'start' });
      await loadAgentAccountStatus({ authenticate: false });
    },
    openStatus: tokenId => { selectPunk(tokenId); activateTab('activity'); void loadAgentAccountStatus({ authenticate: true }); },
  });
  const openSwarm = () => {
    activateTab('talk'); one('[data-swarm-details]').open = true;
    one('[data-swarm-details]').scrollIntoView({ block: 'start' }); swarmControl.refresh();
  };
  one('[data-open-swarm]').addEventListener('click', openSwarm);
  one('[data-swarm-funding-back]').addEventListener('click', openSwarm);
  one('[data-swarm-funding-leave]').addEventListener('click', () => {
    if (state.gasFundingBusy) return;
    state.swarmFundingContext = null; state.gasFundingPlan = null;
    one('[data-agent-gas-confirm]').checked = false;
    one('[data-agent-gas-form] button[type=submit]').textContent = 'REVIEW & SIMULATE';
    renderAgentGasFunding();
  });
  one('[data-activation-guide]').addEventListener('click', event => {
    const action = event.target.closest('[data-activation-action]')?.dataset.activationAction;
    if (!action || state.gasFundingBusy) return;
    if (action === 'CHECK') void loadAgentAccountStatus({ authenticate: true });
    else if (action === 'FUND') {
      state.gasFundingPlan = null; one('[data-agent-gas-confirm]').checked = false;
      one('[data-agent-gas-form] button[type=submit]').textContent = 'REVIEW & SIMULATE';
      activateTab('fund'); one('#agent-gas-source').value = 'OWNER';
      renderAgentGasFunding(); one('[data-agent-gas-panel]').scrollIntoView({ block: 'start' });
    } else if (action === 'STATUS') {
      activateTab('activity'); void loadAgentAccountStatus({ authenticate: true });
    } else {
      activateTab('talk');
      if (state.localStrategy?.intent?.operatingMode === 'AUTONOMOUS') showConfirmation(state.localStrategy);
      else void runAgentAction(START_FREE_MINT_COMMAND);
    }
  });
  one("[data-link-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const value = one("#mint-link").value.trim();
    const output = one("[data-link-result]"); const button = form.querySelector("button[type=submit]");
    const punk = state.selected, owner = state.wallet?.account, chainId = state.wallet?.chainId;
    const requestId = ++state.linkRequestId;
    const isCurrent = () => state.linkRequestId === requestId && state.selected === punk
      && state.wallet?.account === owner && state.wallet?.chainId === chainId;
    output.textContent = 'Identifying the project and checking its link…';
    form.setAttribute("aria-busy", "true"); button.disabled = true; button.textContent = "CHECKING…";
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error();
      let inspection;
      output.textContent = 'Finding the project, chain and mint details…';
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
        if (!isCurrent()) return;
        const payload = await jsonRequest("/api/v2/inspect-url", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({
            tokenId: state.selected.tokenId, url: value,
          }) });
        inspection = payload.inspection;
      }
      if (!isCurrent()) return;
      state.lastInspection = inspection;
      const reviewKey = selectedReviewKey();
      if (reviewKey) state.reviewInspections.set(reviewKey, inspection);
      const kind = inspection.link.kind.replaceAll("_", " ");
      const status = inspection.status.replaceAll("_", " ");
      output.textContent = `${kind} · ${status}. See the review below for available contract checks and simulation. Nothing was submitted.`;
      addReviewActivity("DISCOVERED", kind, `${status} · transaction data ignored`);
      renderReviewAgent();
      const findings = linkFindings(inspection);
      addMessage("punk", findings?.summary ?? `LINK IDENTIFIED 👀 ${kind}. CURRENT VERDICT: ${status}. Contract details, safety checks and simulation still need review.`, createLinkFindingsCard(findings));
    } catch (error) {
      if (!isCurrent()) return;
      const invalid = error instanceof TypeError || !error?.message;
      output.textContent = invalid
        ? "BLOCKED · Paste a clean HTTPS project, marketplace, social, or explorer link."
        : `CHECK FAILED · ${error.message} No transaction was prepared.`;
      addMessage("punk", invalid
        ? "I COULDN'T READ THAT LINK. Paste a clean HTTPS project, marketplace, social, or explorer URL."
        : `I COULDN'T FINISH THE CHECK. ${error.message} Nothing was signed or prepared.`);
    } finally {
      if (isCurrent()) { form.removeAttribute("aria-busy"); button.disabled = false; button.textContent = "CHECK LINK"; }
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
    one("[data-confirmation-dialog]").close(); one('[data-agent-options] select')?.focus();
  });
  one("[data-activate-send-strategy]").addEventListener("click", () => {
    state.dispatchAfterActivation = true;
    one("[data-activate-strategy]").click();
  });
  one("[data-edit-skill]").addEventListener("click", () => {
    one("[data-skill-dialog]").close(); one('[data-agent-options] select')?.focus();
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
      const swarmIdentity = { tokenId: String(state.selected?.tokenId), intentHash: state.localStrategy.intentHash };
      try {
        swarmControl?.authorization(swarmIdentity, 'AUTHORIZING');
        await activatePunkAgentMission(state.localStrategy, report);
        swarmControl?.authorization(swarmIdentity, 'AUTHORIZED');
        state.selected.mode = "AUTONOMOUS";
        one("[data-confirmation-dialog]").close();
        renderSelected();
        addMessage("punk", "Mission permission confirmed. Check the status strip for live worker readiness. If Agent gas is empty, open Fund to add gas before minting can begin. Only eligible free mints inside your approved limits can run; results appear in Activity.");
      } catch (error) {
        try { swarmControl?.authorization(swarmIdentity, 'CHECK_STATUS'); } catch { /* Original wallet result remains recoverable. */ }
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
    state.selected.mode = mode; state.hydratedTokenId = null;
    one("[data-confirmation-dialog]").close(); renderSelected();
    if (!PREVIEW) await hydrateSelected('strategy');
    addMessage("punk", PREVIEW ? "Strategy activated in local preview state only. Nothing was saved remotely."
      : "STRATEGY ACTIVATED WITH YOUR WALLET SIGNATURE. No unsigned change was accepted.");
    unlock();
  });
  const gasForm = one("[data-agent-gas-form]");
  const gasButton = gasForm.querySelector("button[type=submit]");
  const gasRecoveryRoot = document.createElement('section'); gasRecoveryRoot.className = 'gas-funding-recovery';
  one('[data-agent-gas-panel]').append(gasRecoveryRoot);
  gasFundingRecovery = createGasFundingRecovery({ root: gasRecoveryRoot,
    getSelection: () => ({ owner: state.wallet?.account, tokenId: state.selected?.tokenId, chainId: state.wallet?.chainId }),
    provider: () => window.__GOGH_WALLET_PROVIDER__,
    onConfirmed: async selection => {
      const punk = state.selected;
      if (punk?.tokenId !== selection.tokenId || state.wallet?.account !== selection.owner) return;
      swarmWalletControl?.refresh();
      swarmReviewGate?.refresh();
      swarmControl?.refresh();
      await Promise.all([loadAgentAccountStatus(), loadPunkBalances(punk)]);
      if (state.selected === punk && state.wallet?.account === selection.owner) renderSelected();
    } });
  gasFundingRecovery.refresh();
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
    const allocation = state.swarmFundingContext;
    const allocationCurrent = () => !allocation ? !state.swarmFundingContext : currentSwarmFunding()?.batchId === allocation.batchId
      && source === "OWNER" && amount === allocation.amountEth;
    const isSelected = () => state.selected === punk && state.wallet?.account === owner && state.wallet?.chainId === CHAIN_ID;
    const isCurrent = () => isSelected() && allocationCurrent() && one("#agent-gas-source").value === source
      && one("#agent-gas-amount").value.trim() === amount && one("[data-agent-gas-confirm]").checked;
    try {
      if (PREVIEW) throw new Error("Local preview cannot fund a real account.");
      if (!punk || !owner || !isCurrent()) throw new Error("Connect the owner on Robinhood Chain and check the gas-funding confirmation.");
      state.gasFundingBusy = true; gasButton.disabled = true;
      const provider = window.__GOGH_WALLET_PROVIDER__;
      const loadContext = async () => {
        await ensureV2Session();
        if (!isCurrent()) throw new Error('Funding selection changed. Review again.');
        if (source === 'OWNER') {
          const agent = await jsonRequest(`/api/v2/punks/${punk.tokenId}/agent-account`);
          return { agent, ownerBinding: { owner, tokenId: punk.tokenId, chainId: CHAIN_ID, collection: COLLECTION } };
        }
        const [gate, agent, funding] = await Promise.all([
          fetchPunkWalletFundsGate((...args) => fetch(...args), punk.tokenId),
          jsonRequest(`/api/v2/punks/${punk.tokenId}/agent-account`),
          jsonRequest(`/api/v2/punks/${punk.tokenId}/fund`),
        ]);
        return { gate, agent, funding };
      };
      if (!state.gasFundingPlan) {
        output.textContent = source === 'OWNER'
          ? "Checking your ownership, the Agent wallet and the exact funding transfer…"
          : "Checking both wallets, your reserve and the exact funding transfer…";
        const prepared = await prepareAgentGasFunding(provider, await loadContext(), punk.tokenId, source, amount);
        if (!isCurrent()) throw new Error("Selection changed during review.");
        if (allocation) swarmControl.fundingPrepared({ batchId: allocation.batchId, tokenId: punk.tokenId, prepared });
        state.gasFundingPlan = prepared; gasButton.textContent = "SUBMIT IN METAMASK";
        output.textContent = `SIMULATION PASSED · Move ${amount} ETH from ${source === "PUNK" ? "this Punk Wallet" : "your connected wallet"} to Agent Account ${prepared.destination}. Your connected wallet pays the transfer fee. No mission is activated.`;
        return;
      }
      output.textContent = "Rechecking funding before MetaMask…";
      if (allocation) swarmControl.fundingPrepared({ batchId: allocation.batchId, tokenId: punk.tokenId, prepared: state.gasFundingPlan });
      const submitted = await submitAgentGasFunding(provider, state.gasFundingPlan, { loadContext, isCurrent });
      submittedHash = submitted.hash; state.gasFundingPlan = null; gasFundingRecovery.refresh();
      if (isSelected()) {
        const link = one("[data-agent-gas-transaction]"); link.href = `https://robinhoodchain.blockscout.com/tx/${submittedHash}`; link.hidden = false;
        output.textContent = "Gas funding submitted. Waiting for confirmation; do not submit again.";
      }
      await waitForPunkWalletTransactionReceipt(provider, submittedHash);
      const result = await recheckAgentGasFunding(provider, owner, punk.tokenId, { isCurrent: isSelected });
      gasFundingRecovery.refresh();
      if (result?.status !== 'CONFIRMED') {
        if (isSelected()) output.textContent =
          'Funding is awaiting confirmation. Use Recheck funding below; nothing will be sent again.';
        return;
      }
      if (isSelected()) {
        one("[data-agent-gas-confirm]").checked = false;
        await Promise.all([loadAgentAccountStatus(), loadPunkBalances(punk)]);
        if (isSelected()) {
          renderSelected(); output.textContent = "GAS FUNDING CONFIRMED ✓ Review and approve your mission separately.";
          one("[data-resume-chat-mission]").hidden = !state.localStrategy;
          addMessage("punk", `GAS FUNDING CONFIRMED. ${amount} ETH moved to my Agent Account. No mission was activated. ${state.localStrategy ? "Use REVIEW SAVED MISSION to continue." : "Tell me your mission and I'll show its limits for approval."}`);
        }
      }
    } catch (error) {
      state.gasFundingPlan = null;
      if (isSelected()) output.textContent = submittedHash
        ? "Funding confirmation could not be checked. Use Recheck funding below to verify the original transaction before trying again."
        : `${error?.message ?? "Gas funding stopped."} Check wallet activity before retrying if MetaMask opened.`;
    } finally { state.gasFundingBusy = false; renderAgentGasFunding(); gasFundingRecovery.refresh(); swarmControl?.refresh(); if (!state.gasFundingPlan) gasButton.textContent = "REVIEW & SIMULATE"; }
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
    // Invalidate watch drafts before any pending/wrong-chain early return.
    void persistentWatchControl?.selectionChanged();
    swarmWalletControl?.refresh();
    if (account !== previousAccount || wallet.chainId !== previousChain) swarmReviewGate?.invalidate();
    renderMissionBadges(); renderActivationGuide();
    forgeSkillAdminControl?.update();
    brokerPreferences?.refresh(); gasFundingRecovery?.refresh();
    if (account !== previousAccount || wallet.chainId !== previousChain) {
      ownerRefresh.invalidate(); clearTransferredPunkReview();
      resetGallery(); state.gallery = []; state.activity = []; state.activityLoaded = false; state.balanceRequestId += 1; state.balanceReads?.clear(); state.hydratedTokenId = null;
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
  window.setInterval(() => {
    if (!PREVIEW && !document.hidden && state.selected && state.wallet?.account && state.wallet.chainId === CHAIN_ID) {
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
  directedPaidControl = createDirectedPaidPanel({root:one('[data-directed-paid-panel]'),
    getSelection:()=>state.selected?{tokenId:String(state.selected.tokenId),owner:state.wallet?.account??null,chainId:state.wallet?.chainId,preview:PREVIEW}:null,
    ensureSession:ensureV2Session,request:jsonRequest,autoLoad:false});
  const holderSelection = () => state.selected ? { tokenId: String(state.selected.tokenId),
    owner: state.wallet?.account ?? null, chainId: state.wallet?.chainId, preview: PREVIEW } : null;
  const legacyBurn = createSelectedBurnPanel({ root: one('[data-forge-selected-burn]'),
    getSelection: holderSelection, ensureSession: ensureV2Session, request: jsonRequest, recoveryOnly: true });
  let legacyRecoveryIdentity = null;
  const refreshLegacyRecovery = () => {
    const identity = JSON.stringify(holderSelection());
    if (identity === legacyRecoveryIdentity) return;
    legacyRecoveryIdentity = identity;
    legacyBurn.selectionChanged();
    const details = one('[data-legacy-burn-recovery]');
    details.hidden = one('[data-forge-selected-burn]').hidden;
    details.open = false;
    directedPaidControl.selectionChanged();
    const paid = one('[data-legacy-paid-recovery]');
    paid.hidden = one('[data-directed-paid-panel]').hidden;
    paid.open = false;
  };
  window.addEventListener('gogh:punk-selected', refreshLegacyRecovery);
  refreshLegacyRecovery();
  publicPaidControl = createPublicDirectedPaidPanel({ root: one('[data-public-paid-panel]'),
    getSelection: holderSelection, ensureSession: ensureV2Session, request: jsonRequest,
    getProvider: () => window.__GOGH_WALLET_PROVIDER__ });
  erc20WithdrawalControl = createErc20WithdrawalPanel({ root: one('[data-erc20-withdraw-panel]'),
    getSelection: holderSelection, ensureSession: ensureV2Session, request: jsonRequest,
    getProvider: () => window.__GOGH_WALLET_PROVIDER__ });
  holderBurnInspectionControl = createHolderBurnInspectionPanel({ root: one('[data-holder-burn-inspection]'),
    getSelection: holderSelection, getOwnedPunks: () => state.punks,
    ensureSession: ensureV2Session, request: jsonRequest });
  publicPaidControl.selectionChanged(); erc20WithdrawalControl.selectionChanged(); holderBurnInspectionControl.refresh();
  one('[data-open-token-withdrawal]').addEventListener('click', () => {
    activateTab('collection'); one('[data-erc20-withdraw-panel]').scrollIntoView({ block: 'start' });
  });
  let marketplaceStorage = null;
  try { marketplaceStorage = window.localStorage; } catch { /* Saved purchases fail closed if storage is unavailable. */ }
  forgeSkillAdminControl = createForgeSkillAdminPanel({
    root: one('[data-forge-skill-admin]'),
    getSelection: () => ({ owner: state.wallet?.account, chainId: state.wallet?.chainId, preview: PREVIEW }),
    ensureSession: ensureV2Session, request: jsonRequest,
    getProvider: () => window.__GOGH_WALLET_PROVIDER__, storage: marketplaceStorage,
  });
  marketplacePurchaseControl = createMarketplacePurchasePanel({
    container: one('[data-marketplace-purchase-panel]'),
    getSelected: () => state.selected ? { tokenId: String(state.selected.tokenId),
      owner: state.wallet?.account, chainId: state.wallet?.chainId, preview: PREVIEW } : null,
    getOwner: () => state.wallet?.account,
    getProvider: () => window.__GOGH_WALLET_PROVIDER__,
    // No reviewed public purchase release exists. Never infer one from API data.
    purchaseRelease: null,
    storage: marketplaceStorage,
    authenticate: ensureV2Session,
    api: async (path, options) => {
      if (options?.method === 'POST') {
        const revision = marketplaceSelectionRevision, key = marketplaceSelectionKey;
        await ensureV2Session();
        const currentKey = JSON.stringify([state.wallet?.account?.toLowerCase() ?? null,
          state.wallet?.chainId ?? null, state.selected?.tokenId ?? null, PREVIEW]);
        if (revision !== marketplaceSelectionRevision || key !== currentKey) {
          throw new Error('PURCHASE_SELECTION_CHANGED');
        }
      }
      return jsonRequest(path, options);
    },
    onSettled: ({ owner, punkId, chainId }) => {
      if (owner !== state.wallet?.account?.toLowerCase() || chainId !== state.wallet?.chainId
        || punkId !== String(state.selected?.tokenId)) return;
      state.galleryTokenId = null;
      void loadAgentAccountStatus();
    },
  });
  syncMarketplaceSelection();
  const recoveryRoot = document.createElement('section'); one('[data-v2-panel="fund"]').append(recoveryRoot);
  agentRecoveryControl = createAgentRecoveryPanel({ root: recoveryRoot,
    getSelection: () => state.selected ? { tokenId: String(state.selected.tokenId), owner: state.wallet?.account,
      chainId: state.wallet?.chainId, preview: PREVIEW } : null, ensureSession: ensureV2Session });
  persistentWatchControl = createPersistentWatchMount({ root: one('[data-persistent-watch]'),
    getSelection: () => {
      const context = REVIEW_HOST ? 'DEPLOY_PREVIEW' : location.protocol === 'https:'
        && ['goghpunks.xyz', 'www.goghpunks.xyz', 'gogh-punks.netlify.app'].includes(location.hostname) ? 'PRODUCTION' : null;
      return { owner: state.wallet?.account, chainId: state.wallet?.chainId, context, preview: PREVIEW,
        tokenId: state.ownershipAccount === state.wallet?.account && state.selected?.tokenId != null
          ? String(state.selected.tokenId) : null };
    },
    request: jsonRequest, ensureSession: ensureV2Session,
    onFund: () => activateTab('fund'),
    onReviewPermission: () => { activateTab('strategy'); one('[data-agent-account-status]')?.scrollIntoView({ block: 'center' }); },
  });
  void persistentWatchControl.selectionChanged();
  window.addEventListener('gogh:v2-session', event => { void persistentWatchControl?.sessionChanged(event.detail); });
  // The profile count is acquisition history; live custody is shown in Collection.
  const acquisitionValue = one('[data-punk-nfts]');
  if (acquisitionValue) {
    acquisitionValue.closest('div').querySelector('dt').textContent = 'ACQUISITION HISTORY';
    acquisitionValue.parentNode.replaceChildren(acquisitionValue, document.createTextNode(' RECORDS'));
  }
  for (const [selector, label] of [['[data-punk-wallet]', 'V3 PUNK WALLET'], ['[data-punk-balance]', 'V3 WALLET ETH']]) {
    one(selector)?.closest('div').querySelector('dt')?.replaceChildren(document.createTextNode(label));
  }
  for (const [selector, label] of [['[data-collection-eth]', 'V3 WALLET ETH'], ['[data-collection-weth]', 'V3 WALLET WETH']]) {
    one(selector)?.closest('article').querySelector('span')?.replaceChildren(document.createTextNode(label));
  }
  const recoveryLink = document.createElement('a'); recoveryLink.href = '#agent-recovery'; recoveryLink.textContent = 'MANAGE AGENT ETH · GAS · NFTS';
  recoveryLink.addEventListener('click', event => { event.preventDefault(); activateTab('fund');
    recoveryRoot.scrollIntoView({ block: 'start' }); recoveryRoot.querySelector('h3').focus(); });
  one('.collection-recovery')?.append(recoveryLink);
  if (["talk", "strategy", "fund", "collection", "activity", "forge", "settings"].includes(requestedTab)) {
    activateTab(requestedTab);
  }
}

setup();
