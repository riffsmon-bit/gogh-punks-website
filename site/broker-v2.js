import { verifyOwnedPunkIds } from "./broker-v2-ownership.js";

const PREVIEW = new URLSearchParams(location.search).get("preview") === "1";
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
  gallery: [], activity: [], hydratedTokenId: null };
const one = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const set = (selector, value) => { const target = one(selector); if (target) target.textContent = String(value); };
const short = (value) => typeof value === "string" && value.length === 42
  ? `${value.slice(0, 6)}…${value.slice(-4)}` : "NOT ACTIVATED";

function cleanImage(value, fallback = "/assets/gogh-punks-pfp.png") {
  if (typeof value !== "string") return fallback;
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin || ["i.seadn.io", "raw2.seadn.io"].includes(url.hostname)
      ? url.href : fallback;
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
  set("[data-punk-balance]", `${balance.toFixed(4)} ETH`);
  set("[data-fund-balance]", balance.toFixed(4));
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
  state.selected = punk; state.localStrategy = null; state.hydratedTokenId = null;
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
  for (const [imageSource, title, provenance, detail] of state.gallery) {
    const item = document.createElement("article"); item.className = "gallery-item";
    const image = document.createElement("img"); image.src = imageSource; image.alt = title;
    const copy = document.createElement("div"); const type = document.createElement("span"); type.textContent = provenance;
    const heading = document.createElement("h3"); heading.textContent = title;
    const text = document.createElement("p"); text.textContent = detail;
    copy.append(type, heading, text); item.append(image, copy); grid.append(item);
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
  if (!PREVIEW && ["strategy", "fund", "collection", "activity", "withdraw"].includes(name)) {
    void hydrateSelected(name);
  }
}

function ethFromWei(value) {
  if (!/^\d+$/.test(String(value ?? ""))) return "0.0000";
  const wei = BigInt(value); const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${fraction}`;
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
    await ensureV2Session();
    const profilePayload = state.hydratedTokenId === tokenId ? null
      : await jsonRequest(`/api/v2/punks/${tokenId}`);
    if (state.selected?.tokenId !== tokenId) return;
    if (profilePayload?.profile) {
      punk.account = profilePayload.profile.punkWallet;
      punk.balanceEth = ethFromWei(profilePayload.profile.nativeBalanceWei);
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
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    const error = new Error(payload?.message ?? "Art Broker request failed safely.");
    error.code = payload?.code ?? "V2_REQUEST_FAILED"; throw error;
  }
  return payload;
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
  activate.textContent = view.mode === "AUTONOMOUS" ? "AUTONOMOUS LOCKED" : "ACTIVATE STRATEGY";
  const dialog = one("[data-confirmation-dialog]");
  if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
}

async function loadOwnedPunks(account) {
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
  state.punks = ownership.tokenIds.map((ownedTokenId) => {
    const item = candidates.get(ownedTokenId) ?? {};
    return { tokenId: ownedTokenId,
      account: item.agentSummary?.account ?? null,
      image: item.artwork?.imageUrl ?? "/assets/gogh-punks-pfp.png",
      balanceEth: "0", reserveEth: "0",
      nfts: item.agentSummary?.lifetimeMints ?? 0, mode: "ASK" };
  });
  state.selected = state.punks[0] ?? null; state.gallery = []; state.activity = [];
  state.hydratedTokenId = null; renderRoster(); renderSelected();
}

function ethToWeiHex(value) {
  if (!/^(?:0|[1-9]\d*|\.\d+|\d+\.\d+)$/.test(value)) throw new TypeError("Enter a valid ETH amount.");
  const [whole, fraction = ""] = value.startsWith(".") ? ["0", value.slice(1)] : value.split(".");
  if (fraction.length > 18) throw new TypeError("Use no more than 18 decimals.");
  const wei = BigInt(whole) * 10n ** 18n + BigInt((fraction || "0").padEnd(18, "0"));
  if (wei <= 0n) throw new TypeError("Enter an amount above zero.");
  return `0x${wei.toString(16)}`;
}

function setup() {
  one("[data-preview-banner]").hidden = !PREVIEW;
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
    let draft;
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
    addMessage("punk", `GOT IT. ${(intent?.mintMode === "FREE_ONLY" || draft.free) ? "FREE ONLY. " : ""}${tastes.join(" + ")}. ${intent?.dailyMintLimit ?? draft.daily} MAX TODAY. REVIEW THE RULES BEFORE THEY CHANGE.`);
    showConfirmation(draft);
  });
  one("[data-link-form]").addEventListener("submit", async (event) => {
    event.preventDefault(); const value = one("#mint-link").value.trim(); const output = one("[data-link-result]");
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error();
      if (PREVIEW) {
        const response = await fetch("/api/local-art-broker-v2/inspect-link", { method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tokenId: state.selected.tokenId, url: value }) });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) throw new Error(payload?.message ?? "Link blocked");
        output.textContent = `${payload.inspection.link.kind.replaceAll("_", " ")} · ${payload.inspection.status} · no external calldata or wallet request accepted.`;
      } else {
        await ensureV2Session();
        const payload = await jsonRequest("/api/v2/inspect-url", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({
            tokenId: state.selected.tokenId, url: value,
          }) });
        output.textContent = `${payload.inspection.link.kind.replaceAll("_", " ")} · ${payload.inspection.status} · no external calldata or wallet request accepted.`;
      }
      addMessage("punk", "LINK IDENTIFIED. It is information only. Contract resolution, screening, and simulation still have to pass.");
    } catch { output.textContent = "BLOCKED · Paste a clean HTTPS project, marketplace, social, or explorer link."; }
  });
  one("[data-edit-strategy]").addEventListener("click", () => { one("[data-confirmation-dialog]").close(); one("#punk-prompt").focus(); });
  one("[data-activate-strategy]").addEventListener("click", async () => {
    if (!state.localStrategy) return;
    const mode = state.localStrategy.intent?.operatingMode ?? state.localStrategy.mode;
    if (mode === "AUTONOMOUS") return;
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
  one("[data-fund-form]").addEventListener("submit", async (event) => {
    event.preventDefault(); const output = one("[data-fund-result]");
    try {
      if (PREVIEW) { output.textContent = "LOCAL PREVIEW · funding transaction not requested."; return; }
      if (!state.selected?.account || !state.wallet?.account || state.wallet.chainId !== CHAIN_ID) {
        throw new Error("Connect the current owner on Robinhood Chain and select an activated Punk Wallet.");
      }
      await ensureV2Session();
      const funding = await jsonRequest(`/api/v2/punks/${state.selected.tokenId}/fund`);
      if (funding.destination !== state.selected.account && state.selected.account !== null) {
        throw new Error("The canonical Punk Wallet changed. Refresh before funding.");
      }
      state.selected.account = funding.destination;
      const provider = window.__GOGH_WALLET_PROVIDER__;
      if (!provider?.request) throw new Error("Wallet provider unavailable.");
      const value = ethToWeiHex(new FormData(event.currentTarget).get("amount")?.toString().trim() ?? "");
      output.textContent = "Review the direct Punk Wallet funding transaction in your wallet…";
      const hash = await provider.request({ method: "eth_sendTransaction", params: [{
        from: state.wallet.account, to: funding.destination, value,
      }] });
      output.textContent = `Funding submitted directly to this Punk Wallet · ${String(hash).slice(0, 10)}…`;
    } catch (error) { output.textContent = error?.message ?? "Funding was not submitted."; }
  });
  window.addEventListener("gogh:wallet-state", async (event) => {
    if (PREVIEW) return;
    state.wallet = event.detail;
    if (!state.wallet?.account || state.wallet.chainId !== CHAIN_ID) {
      state.punks = []; state.selected = null; renderRoster(); return;
    }
    try { await loadOwnedPunks(state.wallet.account); }
    catch { state.punks = []; state.selected = null; renderRoster(); set("[data-wallet-state]", "Ownership service unavailable · no authority assumed"); }
  });
  if (PREVIEW) { previewData(); renderRoster(); renderSelected(); }
  else renderRoster();
  const requestedTab = new URLSearchParams(location.search).get("tab");
  if (["talk", "strategy", "fund", "collection", "activity", "withdraw", "settings"].includes(requestedTab)) {
    activateTab(requestedTab);
  }
}

setup();
