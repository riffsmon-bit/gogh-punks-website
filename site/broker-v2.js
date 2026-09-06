import { verifyOwnedPunkIds } from "./broker-v2-ownership.js";
import { fetchOwnerPolicyGate, readOwnerPolicyState } from "./owner-policy-controls.js";
import {
  fetchPunkWalletFundsGate, preflightPunkWalletFunds, submitPunkWalletFunds,
} from "./punk-wallet-funds.js";
import { buildWrappedNativeTransaction, decodeUint256, ROBINHOOD_WETH,
  simulateWrappedNativeTransaction, submitWrappedNativeTransaction,
  wrappedBalanceOfData } from "./wrapped-native.js";

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
  fundingPlan: null, wrappedPlan: null };
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
    const mode = document.createElement("small"); mode.textContent = punk.mode ?? "ASK";
    label.append(name, mode); button.append(image, label);
    button.addEventListener("click", () => selectPunk(punk.tokenId));
    roster.append(button);
  }
}

function renderSelected() {
  const punk = state.selected;
  if (!punk) return;
  all("[data-punk-token], [data-talk-token], [data-chat-token]").forEach((node) => { node.textContent = punk.tokenId; });
  set("[data-hero-number]", punk.tokenId);
  set("[data-punk-mode]", punk.mode ?? "ASK");
  set("[data-strategy-mode]", `${punk.mode ?? "ASK"} MODE`);
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
  renderRoster(); renderGallery(); renderActivity();
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
  state.hydratedTokenId = null; state.galleryTokenId = null; state.galleryLoadingTokenId = null;
  state.fundingPlan = null; state.wrappedPlan = null;
  if (!PREVIEW) { state.gallery = []; state.activity = []; }
  renderSelected();
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
      const withdraw = document.createElement("a");
      withdraw.href = `/broker/punk/${state.selected.tokenId}?tab=assets`;
      withdraw.textContent = "WITHDRAW"; withdraw.setAttribute("aria-label", `Withdraw ${itemData.title}`);
      actions.append(withdraw); copy.append(actions);
    }
    item.append(image, copy); grid.append(item);
  }
}

function renderActivity() {
  const feed = one("[data-activity-feed]"); feed.replaceChildren();
  if (!state.activity.length) {
    const empty = document.createElement("li"); empty.className = "panel-empty";
    empty.textContent = PREVIEW ? "No activity yet." : "Open ACTIVITY to load V1 + V2 history.";
    feed.append(empty); return;
  }
  for (const [time, type, title, detail] of state.activity) {
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
    punk.account = assets.account; punk.nfts = assets.items.length;
    state.gallery = assets.items.map((asset) => ({
      image: asset.imageUrl ?? "/assets/nft-placeholder.svg",
      title: asset.name ?? `${asset.collectionName ?? short(asset.collection)} #${asset.tokenId}`,
      provenance: `${asset.ownershipStatus.replaceAll("_", " ")} · ${asset.provenance.replaceAll("_", " ")} · ${asset.standard}`,
      detail: `${asset.collectionName ?? short(asset.collection)} · TOKEN #${asset.tokenId}${asset.acquiredAt ? ` · ${dateLabel(asset.acquiredAt)}` : ""}`,
      tokenId: asset.tokenId, collection: asset.collection, openSeaUrl: asset.openSeaUrl,
    }));
    state.galleryTokenId = tokenId; renderSelected();
  } finally {
    if (state.galleryLoadingTokenId === tokenId) state.galleryLoadingTokenId = null;
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

function reviewQuestionReply(message) {
  if (!REVIEW_HOST || PREVIEW || !/^(?:is|was|are|does|do|can|could|should|would|what|why|how|tell|explain)\b/i.test(message)) {
    return null;
  }
  const inspection = state.lastInspection;
  if (!inspection) {
    return "I CAN DRAFT COLLECTING RULES IN THIS REVIEW BUILD. General conversation needs provider-backed Gogh Intelligence, which is not active in Preview 42 yet.";
  }
  const kind = inspection.link.kind.replaceAll("_", " ");
  return `I IDENTIFIED IT AS ${kind}. I CAN'T CALL IT GOOD OR SAFE YET. Current verdict: ${inspection.status.replaceAll("_", " ")}. Contract resolution, security screening, and mint simulation still have to pass.`;
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
    ["DAILY LIMIT", view.daily], ["MAX GAS", `${view.gas} ETH`], ["MINIMUM RESERVE", `${view.reserve} ETH`],
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
    : REVIEW_HOST ? "TEST DRAFT" : "ACTIVATE STRATEGY";
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
  state.gallery = []; state.activity = [];
  state.hydratedTokenId = null; state.galleryTokenId = null; state.galleryLoadingTokenId = null;
  renderRoster(); renderSelected();
}

function setup() {
  one("[data-preview-banner]").hidden = !PREVIEW && !REVIEW_HOST;
  if (REVIEW_HOST && !PREVIEW) {
    set("[data-review-title]", "PR REVIEW BUILD");
    set("[data-review-detail]", "Live ownership and asset reads. Funding or WETH actions require exact simulation, a second confirmation, and MetaMask. No strategy persistence, AI provider charge, or autonomous execution.");
  }
  all("[data-v2-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.v2Tab)));
  all("[data-suggestion]").forEach((button) => button.addEventListener("click", () => {
    const input = one("#punk-prompt"); input.value = button.dataset.suggestion; input.focus();
  }));
  all("[data-show-link]").forEach((button) => button.addEventListener("click", () => {
    one("[data-link-form]").hidden = false; one("#mint-link").focus();
  }));
  const chatForm = one("[data-chat-form]");
  const chatInput = one("#punk-prompt");
  chatInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    chatForm.requestSubmit();
  });
  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault(); const input = one("#punk-prompt"); const message = input.value.trim();
    if (!message) return; addMessage("owner", message); input.value = "";
    if (/pause/i.test(message)) {
      if (PREVIEW) addMessage("punk", "Paused in this local preview. No active production strategy was changed.");
      else if (REVIEW_HOST) {
        state.selected.mode = "PAUSED"; renderSelected();
        addMessage("punk", "PAUSED IN THIS REVIEW TAB. No saved or production strategy was changed.");
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
    const contextualReply = reviewQuestionReply(message);
    if (contextualReply) { addMessage("punk", contextualReply); return; }
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
        addMessage("punk", `${error?.message ?? "LOCAL INTELLIGENCE UNAVAILABLE"} Existing rules remain unchanged.`);
        return;
      }
    } else if (REVIEW_HOST) {
      try {
        const payload = await jsonRequest("/api/v2/review/chat", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: state.wallet.account,
            tokenId: state.selected.tokenId, message }),
        });
        draft = payload.draft; reply = payload.reply;
        set("[data-intelligence-status]", "GOGH INTELLIGENCE · REVIEW PARSER");
      } catch (error) {
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
        addMessage("punk", `${error?.message ?? "GOGH INTELLIGENCE TEMPORARILY UNAVAILABLE"} Existing safety rules remain active.`);
        return;
      }
    }
    const intent = draft.intent;
    const tastes = intent ? intent.preferences.prefer.map((value) => value.replaceAll("_", " ")) : draft.tastes;
    addMessage("punk", reply
      ?? `GOT IT. ${(intent?.mintMode === "FREE_ONLY" || draft.free) ? "FREE ONLY. " : ""}${tastes.join(" + ")}. ${intent?.dailyMintLimit ?? draft.daily} MAX TODAY. REVIEW THE RULES BEFORE THEY CHANGE.`);
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
      const kind = inspection.link.kind.replaceAll("_", " ");
      const status = inspection.status.replaceAll("_", " ");
      output.textContent = `${kind} · ${status} · no external calldata or wallet request accepted.`;
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
  one("[data-edit-strategy]").addEventListener("click", () => { one("[data-confirmation-dialog]").close(); one("#punk-prompt").focus(); });
  one("[data-activate-strategy]").addEventListener("click", async () => {
    if (!state.localStrategy) return;
    const mode = state.localStrategy.intent?.operatingMode ?? state.localStrategy.mode;
    if (mode === "AUTONOMOUS") return;
    if (REVIEW_HOST && !PREVIEW) {
      state.selected.mode = mode; one("[data-confirmation-dialog]").close(); renderSelected();
      addMessage("punk", "DRAFT TESTED IN THIS REVIEW TAB. Nothing was saved, signed, funded, or activated.");
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
      : "Strategy activation needs an owner-signed server challenge. No unsigned change was accepted.");
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
    const punk = state.selected; const owner = state.wallet?.account;
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
      state.fundingPlan = null; one("[data-fund-confirm]").checked = false;
      fundButton.textContent = "REVIEW & SIMULATE";
      output.textContent = `Funding submitted directly to Punk #${tokenId}. Follow the transaction while it confirms.`;
    } catch (error) {
      state.fundingPlan = null; fundButton.textContent = "REVIEW & SIMULATE";
      output.textContent = `${error?.message ?? "Funding was not submitted."} No transaction was submitted by the page.`;
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
    const output = one("[data-weth-state]"); const punk = state.selected;
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
        const gate = await fetchOwnerPolicyGate((...args) => fetch(...args));
        const live = await readOwnerPolicyState(provider, gate, selection);
        const plan = buildWrappedNativeTransaction({ direction, punkWallet: live.account,
          currentOwner: live.owner, amount });
        const wrappedRaw = await provider.request({ method: "eth_call", params: [{
          to: ROBINHOOD_WETH, data: wrappedBalanceOfData(live.account),
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
      state.wrappedPlan = null; one("[data-weth-confirm]").checked = false;
      button.textContent = "REVIEW & SIMULATE";
      output.textContent = `${direction} submitted. Follow the transaction while it confirms.`;
    } catch (error) {
      state.wrappedPlan = null; button.textContent = "REVIEW & SIMULATE";
      output.textContent = `${error?.message ?? "WETH review stopped safely"} No transaction was submitted by the page.`;
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
