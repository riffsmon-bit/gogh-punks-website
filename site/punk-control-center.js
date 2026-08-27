const CHAIN_ID = 4663;
const OWNER_OF_SELECTOR = "0x6352211e";
const ADDRESS = /^0x[0-9a-f]{40}$/;
const TOKEN_ID = /^(?:0|[1-9][0-9]*)$/;
const DEMO_ACCOUNT = "0x0000000000000000000000000000000000000093";
const DEMO_OWNER = "0x0000000000000000000000000000000000000001";

const page = document.querySelector("[data-punk-control-center]");
if (!page) throw new Error("Punk Control Center root is missing");

const query = (selector) => document.querySelector(selector);
const queryAll = (selector) => [...document.querySelectorAll(selector)];
const formatAddress = (value) => ADDRESS.test(value ?? "")
  ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Unavailable";
const formatNative = (wei) => {
  const value = BigInt(wei ?? 0);
  const whole = value / 10n ** 18n;
  const fraction = String(value % 10n ** 18n).padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} ETH`;
};
const nowIso = () => new Date().toISOString();
const demo = new URL(location.href).searchParams.get("demo") === "1";

function routeTokenId() {
  const match = location.pathname.match(/^\/broker\/punk\/(\d+)\/?$/);
  const value = match?.[1] ?? new URL(location.href).searchParams.get("tokenId") ?? "";
  return TOKEN_ID.test(value) ? value : null;
}

const state = {
  tokenId: routeTokenId(), owner: null, account: null, provider: null,
  owned: false, activated: false, automation: null, assets: [],
  activity: [], timings: {}, revision: 0,
};

function metric(name, started) {
  state.timings[name] = Math.max(0, Math.round(performance.now() - started));
  renderDebug();
}

function renderDebug() {
  const target = query("[data-debug-metrics]");
  if (!target) return;
  target.replaceChildren(...Object.entries(state.timings).map(([name, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = name;
    detail.textContent = `${value}ms`;
    row.append(term, detail);
    return row;
  }));
}

function setText(selector, value) {
  const element = query(selector);
  if (element) element.textContent = value;
}

function setActionAvailability(enabled) {
  for (const selector of ["[data-agent-send]", "[data-agent-pause]", "[data-agent-resume]",
    "[data-agent-edit]", "[data-agent-revoke]", "[data-scout-simulate]"]) {
    const element = query(selector);
    if (element) element.disabled = !enabled;
  }
}

function renderIdentity() {
  setText("[data-control-token]", state.tokenId ?? "—");
  setText("[data-directed-punk]", state.tokenId ? `#${state.tokenId}` : "—");
  setText("[data-control-account]", state.account ?? "Waiting for live account…");
  const copy = query("[data-control-copy]");
  if (copy) copy.disabled = !ADDRESS.test(state.account ?? "");
  const explorer = query("[data-control-explorer]");
  if (explorer) explorer.href = state.account
    ? `https://robinhoodchain.blockscout.com/address/${state.account}`
    : "https://robinhoodchain.blockscout.com";
  setText("[data-directed-recipient]", state.account ? formatAddress(state.account) : "Unavailable");
  const status = state.owned ? (state.activated ? "🟢 ACTIVE" : "⚪ READY TO ACTIVATE")
    : state.owner ? "🔴 CONNECT THE CURRENT HOLDER" : "⚪ CONNECT WALLET";
  setText("[data-control-agent-state]", status);
  setText("[data-overview-status]", status.replace(/^[^ ]+ /, ""));
  setText("[data-overview-detail]", state.owned
    ? "Live Punk ownership was checked for the connected wallet."
    : "Controls remain locked until current ownership is verified live.");
  setActionAvailability(state.owned && state.activated);
}

function ownerOfData(tokenId) {
  return `${OWNER_OF_SELECTOR}${BigInt(tokenId).toString(16).padStart(64, "0")}`;
}

async function rpc(method, params) {
  if (!state.provider?.request) throw new Error("Wallet provider unavailable");
  return state.provider.request({ method, params });
}

async function loadOwnership(wallet) {
  const started = performance.now();
  const response = await fetch(`/api/broker/owner-punks?owner=${encodeURIComponent(wallet.account)}`, {
    headers: { accept: "application/json" }, cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true || !ADDRESS.test(payload.collection ?? "")) {
    throw new Error("Punk ownership service unavailable");
  }
  const rawOwner = await rpc("eth_call", [{ to: payload.collection,
    data: ownerOfData(state.tokenId) }, "latest"]);
  if (typeof rawOwner !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(rawOwner)) {
    throw new Error("Live Punk ownership response was invalid");
  }
  const owner = `0x${rawOwner.slice(-40)}`.toLowerCase();
  state.owner = owner;
  state.owned = owner === wallet.account.toLowerCase();
  const decoration = payload.candidatePunks?.find((item) => String(item?.tokenId) === state.tokenId);
  const image = decoration?.artwork?.imageUrl;
  if (/^https:\/\/(?:i|raw2)\.seadn\.io\//.test(image ?? "")) {
    query("[data-control-punk-image]").src = image;
  }
  metric("Ownership read", started);
}

function renderAutomation() {
  const automation = state.automation;
  const punk = automation?.punk;
  state.account = [punk?.account, punk?.wallet, punk?.nftWallet]
    .find((value) => ADDRESS.test(value ?? ""))?.toLowerCase() ?? state.account;
  state.activated = punk?.created === true;
  const heartbeat = automation?.heartbeat;
  const active = automation?.capability === true && punk?.active === true
    && state.owned && state.activated;
  const label = active ? heartbeat?.status === "MINT_CONFIRMED" ? "MINTED" : "SCANNING"
    : state.activated ? "PAUSED" : "INACTIVE";
  setText("[data-agent-status]", label);
  setText("[data-agent-free]", active ? "ON" : "OFF");
  setText("[data-agent-mint-limit]", punk?.maxAcquisitionsPerDay
    ? `${punk.maxAcquisitionsPerDay} NFTs/day` : "Not configured");
  setText("[data-agent-expiry]", punk?.authorization?.validUntil
    ? new Date(Number(punk.authorization.validUntil) * 1000).toLocaleString() : "Not active");
  setText("[data-summary-mints]", punk
    ? `${punk.acquisitionsToday ?? 0} / ${punk.maxAcquisitionsPerDay ?? 0}` : "—");
  if (heartbeat?.completedAt) {
    setText("[data-agent-last-scan]", new Date(heartbeat.completedAt).toLocaleTimeString());
    setText("[data-agent-last-result]", heartbeatMessage(heartbeat));
    setText("[data-agent-next-scan]", heartbeat.online === false ? "Waiting for worker"
      : `~${new Date(Date.parse(heartbeat.completedAt) + 5 * 60_000).toLocaleTimeString()}`);
  }
  if (heartbeat && (!heartbeat.tokenId || heartbeat.tokenId === state.tokenId)) addActivity({ at: heartbeat.completedAt, state: heartbeat.status,
    message: heartbeatMessage(heartbeat) });
  renderIdentity();
}

function heartbeatMessage(heartbeat) {
  const messages = {
    NO_ELIGIBLE_TARGETS: "No eligible supported mint was found in the latest scan.",
    MINT_CONFIRMED: "Mint successful. The NFT was sent to its Punk Wallet.",
    FAILED: "The worker stopped safely and will require attention before execution.",
  };
  return messages[heartbeat?.status] ?? "The hosted agent completed a bounded check.";
}

async function loadAutomation() {
  const started = performance.now();
  const response = await fetch(`/api/broker/autonomy-v3/status?tokenId=${encodeURIComponent(state.tokenId)}`, {
    headers: { accept: "application/json" }, cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) throw new Error("Agent status unavailable");
  state.automation = payload.automation;
  renderAutomation();
  metric("Agent state", started);
}

async function loadBalance() {
  if (!state.account) return;
  const started = performance.now();
  const balance = await rpc("eth_getBalance", [state.account, "latest"]);
  const formatted = formatNative(BigInt(balance));
  setText("[data-summary-balance]", formatted);
  setText("[data-assets-native]", formatted);
  metric("Wallet balance", started);
}

function addActivity(entry) {
  if (!entry?.message || state.activity.some((item) => item.at === entry.at
    && item.message === entry.message)) return;
  state.activity.unshift(Object.freeze(entry));
  state.activity = state.activity.slice(0, 20);
  const timeline = query("[data-agent-timeline]");
  timeline.replaceChildren(...state.activity.map((item) => {
    const row = document.createElement("article");
    const time = document.createElement("time");
    const message = document.createElement("p");
    time.dateTime = item.at ?? nowIso();
    time.textContent = new Date(item.at ?? Date.now()).toLocaleTimeString();
    message.textContent = item.message;
    row.append(time, message);
    return row;
  }));
}

async function loadActivity() {
  const started = performance.now();
  const response = await fetch("/api/broker/autonomy-v3-activity", {
    headers: { accept: "application/json" }, cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) throw new Error("Activity unavailable");
  if (payload.activity?.heartbeat) addActivity({ at: payload.activity.heartbeat.completedAt,
    state: payload.activity.heartbeat.status, message: heartbeatMessage(payload.activity.heartbeat) });
  metric("Activity", started);
}

function assetCard(asset) {
  const card = document.createElement("article");
  card.className = "control-asset-card";
  const image = document.createElement("img");
  image.loading = "lazy";
  image.decoding = "async";
  image.alt = asset.name || `NFT #${asset.tokenId}`;
  image.src = /^https:\/\/(?:i|raw2)\.seadn\.io\//.test(asset.imageUrl ?? "")
    ? asset.imageUrl : "/assets/gogh-punks-pfp.png";
  const title = document.createElement("h3");
  title.textContent = asset.name || `NFT #${asset.tokenId}`;
  const source = document.createElement("p");
  source.textContent = asset.source || "Received";
  const withdrawal = document.createElement("a");
  withdrawal.href = `/punk/${state.tokenId}#nft-withdrawal-title`;
  withdrawal.textContent = "Withdraw to current holder";
  card.append(image, title, source, withdrawal);
  return card;
}

async function loadAssets() {
  if (!state.owned) throw new Error("Connect the current Punk holder first");
  const started = performance.now();
  if (demo) {
    state.assets = [
      { name: "Demo Generative Study #441", tokenId: "441", source: "Directed Mint" },
      { name: "Demo Pixel Bloom #12", tokenId: "12", source: "Art Broker" },
      { name: "Demo Holder Pass #7", tokenId: "7", source: "Deposited" },
    ];
    setText("[data-summary-nfts]", String(state.assets.length));
    setText("[data-assets-nft-count]", String(state.assets.length));
    setText("[data-summary-tokens]", "3");
    setText("[data-assets-token-count]", "3 recognized");
    query("[data-asset-grid]").replaceChildren(...state.assets.map(assetCard));
    metric("NFT inventory", started);
    return;
  }
  const response = await fetch(`/api/broker/nft-withdrawal-assets?tokenId=${encodeURIComponent(state.tokenId)}`, {
    headers: { accept: "application/json" }, cache: "no-store",
  });
  const payload = await response.json();
  const items = payload?.ok === true && Array.isArray(payload.assets?.items)
    ? payload.assets.items : [];
  state.assets = items;
  state.account = ADDRESS.test(payload?.assets?.account ?? "")
    ? payload.assets.account : state.account;
  setText("[data-summary-nfts]", String(items.length));
  setText("[data-assets-nft-count]", String(items.length));
  setText("[data-summary-tokens]", "0");
  setText("[data-assets-token-count]", "0 recognized");
  const grid = query("[data-asset-grid]");
  grid.replaceChildren(...(items.length ? items.map(assetCard) : [Object.assign(
    document.createElement("p"), { className: "empty-state",
      textContent: "No indexed NFTs are currently held by this Punk Wallet." })]));
  renderIdentity();
  metric("NFT inventory", started);
}

function renderDemoOwnerAssets() {
  const grid = query("[data-owner-asset-grid]");
  if (!grid || !demo) return;
  grid.replaceChildren(...[
    { name: "Demo Wallet NFT #88", tokenId: "88", contract: "0x4444444444444444444444444444444444444444" },
    { name: "Demo Access Pass #3", tokenId: "3", contract: "0x5555555555555555555555555555555555555555" },
  ].map((asset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-owner-asset";
    const image = document.createElement("img");
    image.src = "/assets/gogh-punks-pfp.png";
    image.alt = "Local demo asset placeholder";
    const label = document.createElement("span");
    label.textContent = asset.name;
    button.append(image, label);
    button.addEventListener("click", () => {
      query("[data-deposit-type]").value = "erc721";
      query("[data-deposit-contract]").value = asset.contract;
      query("[data-deposit-value]").value = asset.tokenId;
      queryAll("[data-owner-asset-grid] button").forEach((item) => item.setAttribute(
        "aria-pressed", String(item === button)));
    });
    return button;
  }));
}

function localPolicyKey() {
  return `gogh.controlCenter.v2:${state.owner ?? "guest"}:${state.tokenId ?? "none"}`;
}

function renderPaidPolicy(policy) {
  query("[data-paid-enabled]").checked = policy.enabled === true;
  query("[data-paid-daily]").value = policy.daily ?? "0.025";
  query("[data-paid-per]").value = policy.per ?? "0.01";
  query("[data-paid-count]").value = policy.count ?? "3";
  setText("[data-agent-paid]", policy.enabled ? "ON · LOCAL SIMULATION" : "OFF");
  setText("[data-agent-spend-limit]", `${policy.daily ?? "0.025"} ETH/day · simulated`);
  setText("[data-agent-per-limit]", `${policy.per ?? "0.01"} ETH · simulated`);
  setText("[data-summary-spent]", `0 / ${policy.daily ?? "0.025"} ETH`);
}

function readPaidPolicy() {
  try { return JSON.parse(localStorage.getItem(localPolicyKey()) ?? "null") ?? {}; }
  catch { return {}; }
}

function savePaidPolicy() {
  const enabled = query("[data-paid-enabled]").checked;
  if (enabled && !query("[data-paid-confirm]").checked) {
    setText("[data-paid-state]", "Review and accept the paid-mode warning first.");
    return;
  }
  const policy = { enabled, daily: query("[data-paid-daily]").value,
    per: query("[data-paid-per]").value, count: query("[data-paid-count]").value };
  localStorage.setItem(localPolicyKey(), JSON.stringify(policy));
  renderPaidPolicy(policy);
  setText("[data-paid-state]", enabled
    ? "Saved locally for simulation. Production paid execution remains disabled."
    : "Paid mints are OFF. No production permission was changed.");
}

function checkDirectedMint() {
  const started = performance.now();
  const input = query("[data-directed-url]").value.trim();
  let url;
  try { url = new URL(input); } catch { setText("[data-directed-state]", "Enter a valid OpenSea mint URL."); return; }
  const path = url.pathname.match(/^\/(?:collection|drops)\/([a-z0-9][a-z0-9-]{0,99})(?:\/overview)?\/?$/);
  if (url.protocol !== "https:" || url.hostname !== "opensea.io" || !path
    || url.search || url.hash || url.username || url.password) {
    setText("[data-directed-state]", "We couldn't safely recognize this OpenSea mint URL.");
    query("[data-directed-review]").hidden = true;
    return;
  }
  if (!demo) {
    setText("[data-directed-state]", "URL recognized. Authoritative contract and price resolution is local-only in this build, so execution is blocked.");
    query("[data-directed-review]").hidden = true;
    return;
  }
  const policy = readPaidPolicy();
  query("[data-directed-review]").hidden = false;
  setText("[data-directed-collection]", path[1].split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "));
  setText("[data-directed-price]", "0.004 ETH · authoritative demo fixture");
  setText("[data-directed-gas]", "0.0002 ETH · simulated");
  setText("[data-directed-maximum]", "0.0042 ETH");
  setText("[data-directed-remaining]", `${policy.daily ?? "0.025"} ETH`);
  setText("[data-directed-state]", "Supported local fixture resolved. No transaction has been submitted.");
  addActivity({ at: nowIso(), state: "VERIFYING_CONTRACT",
    message: "Candidate found. The local resolver is checking its contract, price, and limits." });
  metric("Directed URL resolution", started);
}

function simulateDirectedMint() {
  const started = performance.now();
  const policy = readPaidPolicy();
  const passed = policy.enabled === true && Number(policy.per ?? 0) >= 0.004
    && Number(policy.daily ?? 0) >= 0.004;
  setText("[data-directed-simulation]", passed
    ? "Simulation passed: supported runtime, exact 0.004 ETH spend, one expected NFT receipt, no approvals or outgoing assets. Nothing was broadcast."
    : "Simulation blocked: enable local paid mode and set limits that cover 0.004 ETH.");
  addActivity({ at: nowIso(), state: passed ? "READY" : "SKIPPED",
    message: passed ? "Simulation passed. The local directed mint is ready for review."
      : "Mint skipped because its price is outside this Punk's simulated spending limits." });
  metric("Simulation", started);
}

function bindTabs() {
  for (const tab of queryAll("[data-control-tab]")) tab.addEventListener("click", () => {
    const name = tab.dataset.controlTab;
    for (const candidate of queryAll("[data-control-tab]")) {
      candidate.setAttribute("aria-selected", String(candidate === tab));
    }
    for (const panel of queryAll("[data-control-panel]")) panel.hidden = panel.dataset.controlPanel !== name;
    history.replaceState(null, "", `#${name}`);
    if (name === "assets" && state.assets.length === 0) loadAssets().catch((error) => {
      query("[data-asset-grid]").textContent = error.message;
    });
    if (name === "activity") loadActivity().catch(() => {});
  });
}

function openInitialTab() {
  const requested = new URL(location.href).searchParams.get("tab")
    ?? location.hash.replace(/^#/, "");
  if (["overview", "agent", "mint", "assets", "activity"].includes(requested)) {
    query(`[data-control-tab="${requested}"]`)?.click();
  }
}

function bindActions() {
  query("[data-control-copy]").addEventListener("click", async () => {
    if (state.account) await navigator.clipboard.writeText(state.account);
  });
  query("[data-load-assets]").addEventListener("click", () => loadAssets().catch((error) => {
    query("[data-asset-grid]").textContent = error.message;
  }));
  query("[data-paid-save]").addEventListener("click", savePaidPolicy);
  query("[data-directed-check]").addEventListener("click", checkDirectedMint);
  query("[data-directed-simulate]").addEventListener("click", simulateDirectedMint);
  query("[data-scout-simulate]").addEventListener("click", () => {
    setText("[data-scout-result]", "Local scout completed: no supported fixture was selected. No transaction was needed.");
    addActivity({ at: nowIso(), state: "SCANNING", message: "Searching supported mint sources in local simulation." });
  });
  query("[data-deposit-review]").addEventListener("click", () => {
    const type = query("[data-deposit-type]").value;
    setText("[data-deposit-state]", state.account
      ? `Local review ready: ${type.toUpperCase()} would move from the connected wallet to ${formatAddress(state.account)}. Nothing was submitted.`
      : "Activate this Punk Wallet before reviewing a deposit.");
  });
  query("[data-add-native]").addEventListener("click", () => query("[data-deposit-type]").focus());
  query("[data-activity-refresh]").addEventListener("click", () => loadActivity().catch(() => {}));
  for (const button of queryAll("[data-agent-send], [data-agent-pause], [data-agent-resume], [data-agent-edit], [data-agent-revoke]")) {
    button.addEventListener("click", () => {
      setText("[data-agent-action-note]", "This local build prepared the action but did not request a signature or submit a transaction. Use the existing production owner flow only after separate review.");
    });
  }
}

async function applyWallet(wallet) {
  const revision = ++state.revision;
  state.owner = wallet?.account?.toLowerCase?.() ?? null;
  state.provider = window.__GOGH_WALLET_PROVIDER__ ?? null;
  state.owned = false;
  state.activated = false;
  state.account = null;
  state.automation = null;
  state.assets = [];
  renderIdentity();
  renderPaidPolicy(readPaidPolicy());
  if (!state.tokenId || !wallet?.account || wallet.chainId !== CHAIN_ID || !state.provider) return;
  try {
    await loadOwnership(wallet);
    if (revision !== state.revision) return;
    renderIdentity();
    if (!state.owned) return;
    await loadAutomation();
    if (revision !== state.revision) return;
    await loadBalance().catch(() => {});
    if (query('[data-control-tab="assets"]')?.getAttribute("aria-selected") === "true") {
      await loadAssets().catch(() => {});
    }
  } catch (error) {
    setText("[data-overview-status]", "Needs attention");
    setText("[data-overview-detail]", error.message);
  }
}

function loadDemo() {
  state.tokenId ||= "93";
  state.owner = DEMO_OWNER;
  state.account = DEMO_ACCOUNT;
  state.owned = true;
  state.activated = true;
  state.automation = { capability: true, punk: { tokenId: state.tokenId, account: DEMO_ACCOUNT,
    created: true, active: true, maxAcquisitionsPerDay: 3, acquisitionsToday: 1,
    authorization: { validUntil: String(Math.floor(Date.now() / 1_000) + 7 * 86_400) } },
  usage: { confirmedMints: "191" },
  heartbeat: { status: "NO_ELIGIBLE_TARGETS", completedAt: nowIso() } };
  query("[data-local-demo]").hidden = false;
  setText("[data-summary-balance]", "0.0412 ETH");
  setText("[data-assets-native]", "0.0412 ETH");
  setText("[data-summary-nfts]", "18");
  setText("[data-summary-tokens]", "3");
  setText("[data-summary-lifetime]", "191");
  renderAutomation();
  renderPaidPolicy(readPaidPolicy());
  renderDemoOwnerAssets();
  query("[data-directed-url]").value = "https://opensea.io/collection/local-demo-drop";
  checkDirectedMint();
  for (const [offset, stateName, message] of [
    [180_000, "SCANNING", "Searching for eligible supported mints…"],
    [120_000, "CANDIDATE_FOUND", "Candidate found: Local Demo Drop."],
    [90_000, "VERIFYING_CONTRACT", "The supported runtime and live price are being checked."],
    [30_000, "SKIPPED", "Mint skipped because paid mode is disabled in this local session."],
  ]) addActivity({ at: new Date(Date.now() - offset).toISOString(), state: stateName, message });
  state.timings["Control Center initial render"] = Math.round(performance.now());
  renderDebug();
}

bindTabs();
bindActions();
renderIdentity();
renderPaidPolicy(readPaidPolicy());
if (demo) {
  loadDemo();
  openInitialTab();
}
else {
  openInitialTab();
  window.addEventListener("gogh:wallet-state", (event) => applyWallet(event.detail));
  window.addEventListener("gogh:wallet-disconnected", () => applyWallet(null));
  applyWallet(window.__GOGH_WALLET_SNAPSHOT__ ?? null);
}
