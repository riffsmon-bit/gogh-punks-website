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
  activateReviewAgent, normalizeReviewAgentRun, pauseReviewAgent, reviewAgentKey,
  reviewInspectionPipeline,
} from "./broker-v2-review-agent.js";

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
  ["/assets/collection/7.png", "Neon Alley #481", "V2 · FREE MINT", "Matched pixel taste · 0.00017 ETH gas"],
  ["/assets/collection/13.png", "Odd Hours #77", "V2 · OWNER APPROVED", "Weird + experimental · simulation passed"],
  ["/assets/collection/38.png", "Blue Study #12", "V1 · ACQUIRED", "Historical Art Broker provenance"],
  ["/assets/collection/56.png", "Night Garden #208", "V1 · ACQUIRED", "Held by the canonical Punk Wallet"],
]);
const previewActivity = Object.freeze([
  ["11:42 AM", "FOUND SOMETHING", "NEON ALLEY · 95% MATCH", "Pixel · Free · 777 supply · X + website · screening and simulation passed"],
  ["10:18 AM", "SCREENED", "ODD HOURS", "Needs review · proxy implementation changed after discovery"],
  ["YESTERDAY", "COLLECTED", "BLUE STUDY #12", "Free mint · 0.00016 ETH gas · asset entered this Punk Wallet"],
]);

const state = { wallet: null, punks: [], selected: null, localStrategy: null,
  gallery: [], activity: [], hydratedTokenId: null, lastInspection: null,
  ownershipAccount: null, ownershipLoadingAccount: null, ownershipRequestId: 0,
  balanceRequestId: 0, galleryTokenId: null, galleryLoadingTokenId: null,
  fundingPlan: null, wrappedPlan: null, withdrawalAsset: null,
  withdrawalAmount: "1", withdrawalPlan: null, withdrawalBusy: false,
  reviewAgents: new Map(), reviewInspections: new Map(), reviewActivities: new Map(),
  reviewRuns: new Map() };
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
  state.reviewActivities.set(key, [[time, type, title, detail], ...existing].slice(0, 20));
  renderActivity();
}

function renderReviewAgent() {
  const reviewSurface = PREVIEW || REVIEW_HOST;
  const consolePanel = one("[data-review-agent-console]");
  const strategyState = one("[data-review-strategy-state]");
  if (consolePanel) consolePanel.hidden = !reviewSurface;
  if (strategyState) strategyState.hidden = !reviewSurface;
  if (!reviewSurface) return;
  const agent = selectedReviewAgent();
  const run = selectedReviewRun();
  const pipeline = reviewInspectionPipeline(state.lastInspection);
  set("[data-review-agent-status]", agent?.status ?? "IDLE");
  set("[data-review-agent-strategy]", agent
    ? `${agent.mode} · ${agent.status}` : "NOT STARTED");
  set("[data-review-agent-route]", run
    ? run.testMode ? "PREVIEW TEST LANE" : "SHARED V2 QUEUE" : "NOT DISPATCHED");
  set("[data-review-agent-discovery]", run
    ? `${run.checkedCount} CHECKED${run.testOpportunityCount ? " · 1 TEST" : ""}` : pipeline.discovery);
  const leading = run?.opportunities?.find(({ recommendationEligible }) => recommendationEligible)
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
  if (dailyLimit) dailyLimit.value = String(agent?.intent.dailyMintLimit ?? 1);
  if (totalLimit) totalLimit.value = String(agent?.intent.totalMintLimit ?? 1);
  set("[data-review-limit-note]", agent
    ? `Current confirmed limits: ${agent.intent.dailyMintLimit} per day, ${agent.intent.totalMintLimit} for this strategy. Editing creates a new draft.`
    : "Creates a strategy draft. Current rules stay active until you confirm it.");
  const runButton = one("[data-review-agent-run]");
  const testButton = one("[data-review-agent-test]");
  const runBusy = runButton.dataset.busy === "true" || testButton.dataset.busy === "true";
  runButton.disabled = runBusy || !agent || agent.status !== "ACTIVE";
  testButton.disabled = runBusy || !agent || agent.status !== "ACTIVE";
  runButton.textContent = runBusy ? "PUNK IS OUT…" : "SEND PUNK OUT";
  testButton.textContent = runBusy ? "TESTING…" : "RUN SAFE TEST";
  set("[data-review-agent-run-note]", !agent
    ? "Confirm an ASK or ASSIST strategy first."
    : agent.status !== "ACTIVE" ? "This review agent is paused."
      : run ? run.testMode
        ? `Safe test only: ${run.eligibleCount} test card matched; no live opportunity or transaction.`
        : `Last run checked ${run.checkedCount}; ${run.eligibleCount} matched.`
        : "Runs one read-only check against shared V2 opportunities.");
  set("[data-review-strategy-label]", agent
    ? `REVIEW AGENT ${agent.status}` : "NO REVIEW AGENT");
  set("[data-review-strategy-detail]", agent
    ? `${agent.mode} rules are remembered for this Punk in this browser tab. Authority: NONE.`
    : "Confirm a strategy draft to start this Punk in the current review tab.");
  if (!agent) {
    set("[data-strategy-name]", "NOT CONFIGURED");
    set("[data-strategy-price]", "FREE ONLY");
    set("[data-strategy-gas]", "0.0005 ETH");
    set("[data-strategy-daily]", "1");
    set("[data-strategy-total]", "1");
    set("[data-strategy-reserve]", "0.0000 ETH");
    set("[data-strategy-website]", "— WEBSITE OPTIONAL");
    set("[data-strategy-social]", "— SOCIAL OPTIONAL");
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
  set("[data-strategy-website]", intent.requiresWebsite ? "✓ WEBSITE REQUIRED" : "— WEBSITE OPTIONAL");
  set("[data-strategy-social]", intent.requiresSocial
    ? `✓ ${intent.preferredSocialPlatforms.join(" + ") || "SOCIAL"} REQUIRED` : "— SOCIAL OPTIONAL");
  all('input[name="mode"]').forEach((input) => { input.checked = input.value === agent.mode; });
}

function startReviewAgent(draft) {
  const key = selectedReviewKey();
  if (!key || !state.selected?.account) throw new Error("Select an owned Punk Wallet first.");
  const agent = activateReviewAgent(draft, { owner: state.wallet.account,
    punkTokenId: state.selected.tokenId, punkWallet: state.selected.account });
  state.reviewAgents.set(key, agent);
  state.reviewRuns.delete(key);
  state.selected.mode = agent.mode;
  state.selected.reserveEth = ethFromWei(agent.intent.minimumReserveWei);
  renderSelected();
  addReviewActivity("READY", `${agent.mode} REVIEW AGENT STARTED`,
    "Structured rules active in this tab · production authority none");
  return agent;
}

async function sendReviewAgentOut({ testMode = false } = {}) {
  const agent = selectedReviewAgent(); const key = selectedReviewKey();
  const button = testMode ? one("[data-review-agent-test]") : one("[data-review-agent-run]");
  if (!agent || agent.status !== "ACTIVE" || !key) return;
  if (!REVIEW_HOST || PREVIEW) {
    addMessage("punk", "Shared V2 discovery is connected only on the hosted PR review. Nothing was dispatched.");
    return;
  }
  button.dataset.busy = "true"; button.disabled = true; renderReviewAgent();
  try {
    const response = await jsonRequest("/api/v2/review/run", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({
        owner: state.wallet.account, tokenId: state.selected.tokenId, intent: agent.intent,
        ...(testMode ? { testMode: "SAFE_FIXTURE" } : {}),
      }), timeoutMs: 20_000 });
    const run = normalizeReviewAgentRun(response, state.selected.tokenId);
    state.reviewRuns.set(key, run);
    addReviewActivity("SCOUTED", testMode ? "SAFE PIPELINE TEST COMPLETED"
      : "PUNK RETURNED FROM SHARED DISCOVERY",
    `${run.checkedCount} checked · ${run.eligibleCount} eligible${testMode ? " · no live mint" : ""}`);
    const leading = run.opportunities.find(({ recommendationEligible }) => recommendationEligible);
    addMessage("punk", testMode
      ? leading
        ? `TEST COMPLETE. The non-live ${leading.collectionName} card matched at ${leading.matchScore}%. Ownership, rules, screen state, and simulation state flowed end to end. No live mint or transaction exists.`
        : `TEST COMPLETE. The non-live test card was rejected by the current rules. No live mint or transaction exists.`
      : leading
      ? `I'M BACK. ${run.eligibleCount} OF ${run.checkedCount} OPPORTUNITIES MATCHED. Best current match: ${leading.collectionName}, ${leading.matchScore}% match. Nothing was submitted.`
      : `I'M BACK. I CHECKED ${run.checkedCount} SHARED V2 OPPORTUNITIES AND FOUND NO ELIGIBLE MATCH UNDER YOUR RULES. Nothing was submitted.`);
  } catch (error) {
    addMessage("punk", `${error?.message ?? "Shared discovery is unavailable."} Nothing was submitted or authorized.`);
  } finally {
    delete button.dataset.busy; renderReviewAgent();
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
  renderRoster(); renderGallery(); renderActivity(); renderReviewAgent();
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
  state.selected = punk; state.localStrategy = null; state.lastInspection = null;
  const key = selectedReviewKey();
  state.lastInspection = key ? state.reviewInspections.get(key) ?? null : null;
  state.hydratedTokenId = null; state.galleryTokenId = null; state.galleryLoadingTokenId = null;
  state.fundingPlan = null; state.wrappedPlan = null; state.withdrawalAsset = null;
  state.withdrawalAmount = "1"; state.withdrawalPlan = null; state.withdrawalBusy = false;
  if (!PREVIEW) { state.gallery = []; state.activity = []; }
  renderSelected(); renderCollectionWithdrawal();
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
  const feed = one("[data-activity-feed]"); feed.replaceChildren();
  const key = selectedReviewKey();
  const entries = [...(key ? state.reviewActivities.get(key) ?? [] : []), ...state.activity];
  if (!entries.length) {
    const empty = document.createElement("li"); empty.className = "panel-empty";
    empty.textContent = PREVIEW ? "No activity yet." : "Open ACTIVITY to load V1 + V2 history.";
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
        `${holding.provenance} · ${holding.acquisitionType}`,
        `${holding.mintCostWei === "0" ? "FREE" : `${holding.mintCostWei} WEI`} · acquired ${dateLabel(holding.acquiredAt)}`,
      ]);
      renderGallery(); set("[data-gallery-count]", state.gallery.length);
    }
    if (tab === "activity") {
      const payload = await jsonRequest(`/api/v2/punks/${tokenId}/activity`);
      state.activity = payload.entries.map((entry) => [dateLabel(entry.occurredAt), entry.type,
        `${entry.provenance} · ${String(entry.type).replaceAll("_", " ")}`,
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
    website: intent.requiresWebsite,
    x: intent.preferredSocialPlatforms.includes("X"),
    free: intent.mintMode === "FREE_ONLY",
  } : draft;
  const values = [
    ["NETWORK", "ROBINHOOD CHAIN"], ["MODE", view.mode],
    ["MINT PRICE", view.free ? "FREE ONLY" : "NOT CHANGED"], ["LOOKING FOR", view.tastes.join(" · ")],
    ["REQUIRES", [view.website && "WEBSITE", view.x && "X", "SCREEN + SIMULATION"].filter(Boolean).join(" · ")],
    ["DAILY LIMIT", view.daily], ["TOTAL LIMIT", view.total], ["MAX GAS", `${view.gas} ETH`], ["MINIMUM RESERVE", `${view.reserve} ETH`],
    ["MAX SUPPLY", view.supply], ["STATUS", "PENDING OWNER CONFIRMATION"],
  ];
  const grid = one("[data-confirmation-grid]"); grid.replaceChildren();
  for (const [label, value] of values) {
    const row = document.createElement("div"); const name = document.createElement("span"); name.textContent = label;
    const output = document.createElement("b"); output.textContent = value; row.append(name, output); grid.append(row);
  }
  const activate = one("[data-activate-strategy]");
  activate.disabled = view.mode === "AUTONOMOUS";
  activate.textContent = view.mode === "AUTONOMOUS" ? "AUTONOMOUS LOCKED"
    : REVIEW_HOST ? "START REVIEW AGENT" : "ACTIVATE STRATEGY";
  set("[data-review-limit-note]",
    `Draft ready: ${view.daily} per day, ${view.total} for this strategy. Current rules stay active until confirmation.`);
  const dialog = one("[data-confirmation-dialog]");
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
  renderRoster(); renderSelected();
  const activeTab = all("[data-v2-tab]").find((button) => button.getAttribute("aria-selected") === "true")?.dataset.v2Tab;
  if (state.selected && activeTab) void hydrateSelected(activeTab);
}

function setup() {
  one("[data-preview-banner]").hidden = !PREVIEW && !REVIEW_HOST;
  if (REVIEW_HOST && !PREVIEW) {
    set("[data-review-title]", "PR REVIEW BUILD");
    set("[data-review-detail]", "Live ownership, assets, owner-approved wallet actions, and a tab-scoped ASK/ASSIST agent. Model chat uses AUTO only when a server provider is configured. No production strategy, autonomous execution, or deployment.");
  }
  one("[data-review-agent-run]").addEventListener("click", () => sendReviewAgentOut());
  one("[data-review-agent-test]").addEventListener("click", () => sendReviewAgentOut({ testMode: true }));
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
  one("[data-review-agent-limit-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const daily = Number(one("[data-review-daily-limit]").value);
    const total = Number(one("[data-review-total-limit]").value);
    const note = one("[data-review-limit-note]");
    if (!Number.isInteger(daily) || daily < 1 || daily > 100
      || !Number.isInteger(total) || total < 1 || total > 10_000) {
      note.textContent = "Use 1–100 per day and 1–10,000 for the strategy.";
      return;
    }
    if (!state.selected || !state.wallet?.account) {
      note.textContent = "Connect the current owner and select a Punk first.";
      return;
    }
    note.textContent = "Drafting this change through the Punk conversation…";
    chatInput.value = `Set my maximum to ${daily} mints per day and ${total} mints total for this strategy. Keep every existing collecting rule.`;
    activateTab("talk");
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
        if (!key || !agent || agent.status !== "ACTIVE") {
          addMessage("punk", "NO ACTIVE REVIEW STRATEGY TO PAUSE. Production remains unchanged.");
          return;
        }
        state.reviewAgents.set(key, pauseReviewAgent(agent));
        state.selected.mode = "PAUSED"; renderSelected();
        addReviewActivity("PAUSED", "REVIEW AGENT PAUSED",
          "Tab-scoped only · no production strategy changed");
        addMessage("punk", "PAUSED IN THIS REVIEW TAB. I will not evaluate new opportunities until you confirm another strategy.");
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
          ? `${run.eligibleCount} OF ${run.checkedCount} SHARED OPPORTUNITIES MATCHED. Best current match: ${leading.collectionName}, ${leading.matchScore}%.`
          : `I CHECKED ${run.checkedCount} SHARED OPPORTUNITIES. None passed every active rule.`);
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
        const inspection = state.lastInspection ? { kind: state.lastInspection.link.kind,
          status: state.lastInspection.status } : null;
        const requestOptions = {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: state.wallet.account, tokenId: state.selected.tokenId,
            message, ...(currentIntent ? { currentIntent } : {}),
            ...(inspection ? { inspection } : {}) }),
        };
        let payload;
        try { payload = await jsonRequest("/api/v2/review/chat", requestOptions); }
        catch (error) {
          if (!["V2_SESSION_REQUIRED", "V2_SESSION_EXPIRED"].includes(error?.code)) throw error;
          await ensureV2Session();
          payload = await jsonRequest("/api/v2/review/chat", requestOptions);
        }
        draft = payload.draft; reply = payload.reply;
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
  one("[data-edit-strategy]").addEventListener("click", () => { one("[data-confirmation-dialog]").close(); one("#punk-prompt").focus(); });
  one("[data-activate-strategy]").addEventListener("click", async () => {
    if (!state.localStrategy) return;
    const mode = state.localStrategy.intent?.operatingMode ?? state.localStrategy.mode;
    if (mode === "AUTONOMOUS") return;
    if (REVIEW_HOST && !PREVIEW) {
      try { startReviewAgent(state.localStrategy); }
      catch (error) {
        addMessage("punk", `${error?.message ?? "Review agent could not start."} Production remains unchanged.`);
        return;
      }
      one("[data-confirmation-dialog]").close();
      addMessage("punk", `${mode} REVIEW AGENT READY. I’ll remember these structured rules for this Punk in this tab. No production permissions were activated.`);
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
  const requestedTab = new URLSearchParams(location.search).get("tab");
  if (["talk", "strategy", "fund", "collection", "activity", "settings"].includes(requestedTab)) {
    activateTab(requestedTab);
  }
}

setup();
