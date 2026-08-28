import {
  buildWrappedNativeTransaction, decodeUint256, ROBINHOOD_WETH, wrappedBalanceOfData,
} from "./wrapped-native.js";

const CHAIN_ID = 4663;
const OWNER_OF_SELECTOR = "0x6352211e";
const ADDRESS = /^0x[0-9a-f]{40}$/;
const TOKEN_ID = /^(?:0|[1-9][0-9]*)$/;
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
  tokenId: routeTokenId(), owner: null, walletAccount: null, walletChainId: null,
  account: null, provider: null, loading: false, error: null,
  punkCollection: null, nativeBalance: null, wrappedBalance: null,
  owned: false, activated: false, agentStatus: null, automation: null, assets: [],
  activity: [], timings: {}, revision: 0,
  directedReviewId: null,
};

async function localApi(path, options = {}) {
  const response = await fetch(path, {
    method: options.body ? "POST" : "GET",
    headers: options.body ? { accept: "application/json", "content-type": "application/json" }
      : { accept: "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.message ?? "Local simulation service is unavailable");
  }
  return payload;
}

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
    "[data-agent-edit]", "[data-agent-revoke]", "[data-scout-simulate]",
    "[data-directed-check]", "[data-paid-save]", "[data-add-native]",
    "[data-load-assets]", "[data-deposit-review]", "[data-activity-refresh]",
    "[data-wrap-review]"]) {
    const element = query(selector);
    if (element) element.disabled = !enabled;
  }
}

function controlPresentation() {
  if (!state.tokenId) return {
    status: "🔴 CHOOSE A PUNK", heading: "Punk not selected",
    detail: "Open My Art Brokers and choose a Punk before using its controls.",
    account: "Choose a Punk first",
  };
  if (!state.walletAccount) return {
    status: "⚪ CONNECT WALLET", heading: "Connect wallet",
    detail: "Connect the current Punk holder to load live account and agent state.",
    account: "Connect wallet to load",
  };
  if (state.walletChainId !== CHAIN_ID) return {
    status: "🟡 SWITCH NETWORK", heading: "Wrong network",
    detail: "Wallet connected. Switch to Robinhood Chain to verify this Punk.",
    account: "Switch to Robinhood Chain",
  };
  if (state.loading) return {
    status: "🔵 CHECKING OWNERSHIP", heading: "Checking live state",
    detail: `Verifying Punk #${state.tokenId} and its wallet on Robinhood Chain…`,
    account: "Loading Punk Wallet…",
  };
  if (state.error) return {
    status: "🔴 NEEDS ATTENTION", heading: "Live state unavailable",
    detail: state.error, account: state.account ?? "Punk Wallet unavailable",
  };
  if (state.owner && !state.owned) return {
    status: "🔴 CONNECT CURRENT HOLDER", heading: "Different holder required",
    detail: `The connected wallet does not currently hold Punk #${state.tokenId}.`,
    account: state.account ?? "Control locked",
  };
  if (state.owned) return {
    status: state.agentStatus === "SCANNING" || state.agentStatus === "MINTED"
      ? `🟢 ${state.agentStatus}` : state.activated ? "🟡 PAUSED" : "⚪ READY TO ACTIVATE",
    heading: state.agentStatus === "SCANNING" ? "Agent scanning"
      : state.agentStatus === "MINTED" ? "Mint confirmed"
        : state.activated ? "Agent paused" : "Ready to activate",
    detail: demo ? "Local Punk ownership fixture loaded; no chain authority is implied."
      : "Live Punk ownership was checked for the connected wallet.",
    account: state.account ?? "Loading Punk Wallet…",
  };
  return {
    status: "⚪ CONNECT WALLET", heading: "Connect wallet",
    detail: "Connect the current holder to verify this Punk.", account: "Connect wallet to load",
  };
}

function renderIdentity() {
  const presentation = controlPresentation();
  setText("[data-control-token]", state.tokenId ?? "—");
  setText("[data-directed-punk]", state.tokenId ? `#${state.tokenId}` : "—");
  setText("[data-control-account]", presentation.account);
  setText("[data-control-live-state]", presentation.detail);
  const routeAlert = query("[data-control-route-alert]");
  if (routeAlert) routeAlert.hidden = Boolean(state.tokenId);
  const copy = query("[data-control-copy]");
  if (copy) copy.disabled = !ADDRESS.test(state.account ?? "");
  const explorer = query("[data-control-explorer]");
  if (explorer) {
    if (ADDRESS.test(state.account ?? "")) {
      explorer.href = `https://robinhoodchain.blockscout.com/address/${state.account}`;
      explorer.target = "_blank";
      explorer.rel = "noopener noreferrer";
      explorer.setAttribute("aria-disabled", "false");
    } else {
      explorer.removeAttribute("href");
      explorer.removeAttribute("target");
      explorer.removeAttribute("rel");
      explorer.setAttribute("aria-disabled", "true");
    }
  }
  setText("[data-directed-recipient]", state.account ? formatAddress(state.account) : "Unavailable");
  setText("[data-control-agent-state]", presentation.status);
  setText("[data-overview-status]", presentation.heading);
  setText("[data-overview-detail]", presentation.detail);
  setActionAvailability(state.owned && state.activated);
  const activityRefresh = query("[data-activity-refresh]");
  if (activityRefresh) activityRefresh.disabled = !state.owned;
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
  state.punkCollection = payload.collection.toLowerCase();
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
  state.agentStatus = label;
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
  const response = await fetch(`/api/broker/autonomy-v3-status?tokenId=${encodeURIComponent(state.tokenId)}`, {
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
  state.nativeBalance = BigInt(balance);
  const formatted = formatNative(BigInt(balance));
  setText("[data-summary-balance]", formatted);
  setText("[data-assets-native]", formatted);
  setText("[data-wrap-eth-balance]", formatted);
  metric("Wallet balance", started);
}

async function loadWrappedBalance() {
  if (!state.account) return;
  const started = performance.now();
  const result = await rpc("eth_call", [{ to: ROBINHOOD_WETH,
    data: wrappedBalanceOfData(state.account) }, "latest"]);
  state.wrappedBalance = decodeUint256(result);
  setText("[data-wrap-weth-balance]", formatNative(state.wrappedBalance).replace(" ETH", " WETH"));
  metric("WETH balance", started);
}

async function verifyCurrentOwner() {
  if (!state.punkCollection || !state.walletAccount) throw new Error("Live Punk owner is unavailable");
  const rawOwner = await rpc("eth_call", [{ to: state.punkCollection,
    data: ownerOfData(state.tokenId) }, "latest"]);
  if (typeof rawOwner !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(rawOwner)
    || `0x${rawOwner.slice(-40)}`.toLowerCase() !== state.walletAccount) {
    throw new Error("Punk ownership changed. Reconnect the current holder before continuing");
  }
}

async function reviewWrappedNative() {
  const output = query("[data-wrap-state]");
  if (!state.owned || !state.activated || !state.account || !state.walletAccount) {
    output.textContent = "Activate this Punk Wallet and connect its current holder first.";
    return;
  }
  if (!query("[data-wrap-confirm]").checked) {
    output.textContent = "Review and accept the exact Punk Wallet, direction, amount, and WETH contract first.";
    return;
  }
  try {
    const plan = buildWrappedNativeTransaction({
      direction: query("[data-wrap-direction]").value,
      punkWallet: state.account,
      currentOwner: state.walletAccount,
      amount: query("[data-wrap-amount]").value.trim(),
    });
    const available = plan.direction === "WRAP" ? state.nativeBalance : state.wrappedBalance;
    if (typeof available !== "bigint" || plan.amountWei > available) {
      throw new RangeError(`This Punk Wallet does not have enough ${plan.direction === "WRAP" ? "ETH" : "WETH"}`);
    }
    if (demo) {
      output.textContent = `${plan.direction === "WRAP" ? "Wrap" : "Unwrap"} review passed for ${query("[data-wrap-amount]").value} ${plan.direction === "WRAP" ? "ETH" : "WETH"}. Exact owner-only calldata was built; nothing was submitted.`;
      return;
    }
    output.textContent = "Rechecking the current holder and simulating the exact owner-only call…";
    await verifyCurrentOwner();
    await rpc("eth_call", [plan.transaction, "latest"]);
    output.textContent = `${plan.direction === "WRAP" ? "Wrap" : "Unwrap"} simulation passed. No transaction was submitted by this local build.`;
  } catch (error) {
    output.textContent = `${error.message}. Nothing was submitted.`;
  }
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
  const button = query("[data-activity-refresh]");
  if (!state.owned) {
    setText("[data-activity-state]", "Connect the current holder on Robinhood Chain to load Punk-specific activity.");
    return;
  }
  if (button) button.disabled = true;
  setText("[data-activity-state]", `Checking Punk #${state.tokenId}'s latest worker event…`);
  try {
    const endpoint = demo ? `/api/local-v2/activity?tokenId=${encodeURIComponent(state.tokenId)}`
      : `/api/broker/autonomy-v3-activity?tokenId=${encodeURIComponent(state.tokenId)}`;
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" }, cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) throw new Error("Activity is temporarily unavailable.");
    if (demo) {
      for (const entry of payload.activity ?? []) addActivity(entry);
      setText("[data-activity-state]", payload.activity?.length
        ? `Loaded ${payload.activity.length} local Punk #${state.tokenId} activity events.`
        : `No local activity has been recorded for Punk #${state.tokenId} yet.`);
      metric("Activity", started);
      return;
    }
    const heartbeat = payload.activity?.heartbeat;
    if (heartbeat && (!heartbeat.tokenId || String(heartbeat.tokenId) === state.tokenId)) {
      addActivity({ at: heartbeat.completedAt, state: heartbeat.status,
        message: heartbeatMessage(heartbeat) });
      setText("[data-activity-state]", `Latest Punk #${state.tokenId} worker event loaded.`);
    } else if (heartbeat) {
      setText("[data-activity-state]", `No recent Punk #${state.tokenId} worker event was found. The latest hosted event belongs to another Punk.`);
    } else {
      setText("[data-activity-state]", `No hosted worker event has been recorded for Punk #${state.tokenId} yet.`);
    }
    metric("Activity", started);
  } catch (error) {
    setText("[data-activity-state]", `${error.message} Try again in a moment.`);
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
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
  const collection = document.createElement("p");
  collection.className = "eyebrow";
  collection.textContent = asset.collectionName ?? "Collection name unavailable";
  const source = document.createElement("p");
  source.textContent = asset.source || "Received";
  const withdrawal = document.createElement("a");
  withdrawal.href = `/punk/${state.tokenId}#nft-withdrawal-title`;
  withdrawal.textContent = "Withdraw to current holder";
  card.append(image, collection, title, source, withdrawal);
  return card;
}

async function loadAssets() {
  if (!state.owned) throw new Error("Connect the current Punk holder first");
  const started = performance.now();
  const grid = query("[data-asset-grid]");
  grid.setAttribute("aria-busy", "true");
  grid.replaceChildren(Object.assign(document.createElement("p"), {
    className: "empty-state", textContent: `Loading Punk #${state.tokenId} NFT inventory…`,
  }));
  try {
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
      grid.replaceChildren(...state.assets.map(assetCard));
      metric("NFT inventory", started);
      return;
    }
    const response = await fetch(`/api/broker/nft-withdrawal-assets?tokenId=${encodeURIComponent(state.tokenId)}`, {
      headers: { accept: "application/json" }, cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload.assets?.items)) {
      throw new Error("NFT inventory is temporarily unavailable");
    }
    const items = payload.assets.items;
    state.assets = items;
    state.account = ADDRESS.test(payload?.assets?.account ?? "")
      ? payload.assets.account : state.account;
    setText("[data-summary-nfts]", String(items.length));
    setText("[data-assets-nft-count]", String(items.length));
    setText("[data-summary-tokens]", "0");
    setText("[data-assets-token-count]", "0 recognized");
    grid.replaceChildren(...(items.length ? items.map(assetCard) : [Object.assign(
      document.createElement("p"), { className: "empty-state",
        textContent: "No indexed NFTs are currently held by this Punk Wallet." })]));
    renderIdentity();
    metric("NFT inventory", started);
  } finally {
    grid.removeAttribute("aria-busy");
  }
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
  return `gogh.controlCenter.v2:${state.walletAccount ?? "guest"}:${state.tokenId ?? "none"}`;
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

async function savePaidPolicy() {
  const enabled = query("[data-paid-enabled]").checked;
  if (enabled && !query("[data-paid-confirm]").checked) {
    setText("[data-paid-state]", "Review and accept the paid-mode warning first.");
    return;
  }
  const policy = { enabled, daily: query("[data-paid-daily]").value,
    per: query("[data-paid-per]").value, count: query("[data-paid-count]").value };
  try {
    if (demo) await localApi("/api/local-v2/policy", { body: {
      tokenId: state.tokenId, enabled, dailyEth: policy.daily, perMintEth: policy.per,
      dailyMintLimit: Number(policy.count),
    } });
    localStorage.setItem(localPolicyKey(), JSON.stringify(policy));
    renderPaidPolicy(policy);
    setText("[data-paid-state]", enabled
      ? "Saved in this local test session. Production paid execution remains disabled."
      : "Paid mints are OFF. No production permission was changed.");
  } catch (error) {
    setText("[data-paid-state]", `${error.message}. No setting was saved.`);
  }
}

async function checkDirectedMint() {
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
  try {
    setText("[data-directed-state]", "Resolving the local mint fixture and verifying its exact recipient…");
    const payload = await localApi("/api/local-v2/directed/resolve", { body: {
      tokenId: state.tokenId, url: input, recipient: state.account,
    } });
    const policy = readPaidPolicy();
    const priceWei = BigInt(payload.review.candidate.priceWei);
    const gasWei = BigInt(payload.estimatedGasWei);
    state.directedReviewId = payload.reviewId;
    query("[data-directed-review]").hidden = false;
    setText("[data-directed-collection]", payload.review.collectionName);
    setText("[data-directed-price]", `${formatNative(priceWei)} · local fixture`);
    setText("[data-directed-gas]", `${formatNative(gasWei)} · simulated`);
    setText("[data-directed-maximum]", formatNative(priceWei + gasWei));
    setText("[data-directed-remaining]", `${policy.daily ?? "0.025"} ETH`);
    setText("[data-directed-state]", "Supported local fixture resolved and stored for exact simulation. Nothing was submitted.");
    await loadActivity();
    metric("Directed URL resolution", started);
  } catch (error) {
    state.directedReviewId = null;
    query("[data-directed-review]").hidden = true;
    setText("[data-directed-state]", `${error.message}. Nothing was submitted.`);
  }
}

async function simulateDirectedMint() {
  const started = performance.now();
  if (!state.directedReviewId) {
    setText("[data-directed-simulation]", "Check a supported local mint fixture first.");
    return;
  }
  try {
    setText("[data-directed-simulation]", "Rechecking policy, recipient, price, and simulated asset effects…");
    const payload = await localApi("/api/local-v2/directed/simulate", { body: {
      tokenId: state.tokenId, reviewId: state.directedReviewId,
    } });
    setText("[data-directed-simulation]", payload.result.ready
      ? "Simulation passed: exact spend, one expected NFT receipt, no approvals, outgoing assets, or contract creation. Nothing was broadcast."
      : `Simulation blocked safely: ${payload.result.decision.code}.`);
    await loadActivity();
    metric("Simulation", started);
  } catch (error) {
    setText("[data-directed-simulation]", `${error.message}. Nothing was submitted.`);
  }
}

function bindTabs() {
  const tabs = queryAll("[data-control-tab]");
  for (const tab of tabs) tab.addEventListener("click", () => {
    const name = tab.dataset.controlTab;
    for (const candidate of queryAll("[data-control-tab]")) {
      candidate.setAttribute("aria-selected", String(candidate === tab));
      candidate.tabIndex = candidate === tab ? 0 : -1;
    }
    for (const panel of queryAll("[data-control-panel]")) panel.hidden = panel.dataset.controlPanel !== name;
    history.replaceState(null, "", `#${name}`);
    if (name === "assets" && state.assets.length === 0) loadAssets().catch((error) => {
      query("[data-asset-grid]").replaceChildren(Object.assign(document.createElement("p"), {
        className: "empty-state", textContent: `${error.message}. Try again after live ownership is available.`,
      }));
    });
    if (name === "activity") loadActivity().catch(() => {});
  });
  for (const tab of tabs) tab.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(tab);
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (nextIndex === null) return;
    event.preventDefault();
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
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
  query("[data-paid-save]").addEventListener("click", () => savePaidPolicy());
  query("[data-directed-check]").addEventListener("click", () => checkDirectedMint());
  query("[data-directed-simulate]").addEventListener("click", () => simulateDirectedMint());
  query("[data-scout-simulate]").addEventListener("click", async () => {
    try {
      const payload = demo ? await localApi("/api/local-v2/scout", {
        body: { tokenId: state.tokenId },
      }) : null;
      setText("[data-scout-result]", payload
        ? "Local scout completed: no eligible fixture was selected. No transaction was needed."
        : "Scout review prepared. This local build did not submit a job or transaction.");
      if (demo) await loadActivity();
    } catch (error) {
      setText("[data-scout-result]", `${error.message}. No transaction was submitted.`);
    }
  });
  query("[data-deposit-review]").addEventListener("click", () => {
    const type = query("[data-deposit-type]").value;
    setText("[data-deposit-state]", state.account
      ? `Local review ready: ${type.toUpperCase()} would move from the connected wallet to ${formatAddress(state.account)}. Nothing was submitted.`
      : "Activate this Punk Wallet before reviewing a deposit.");
  });
  query("[data-add-native]").addEventListener("click", () => query("[data-deposit-type]").focus());
  query("[data-wrap-review]").addEventListener("click", reviewWrappedNative);
  query("[data-activity-refresh]").addEventListener("click", () => loadActivity().catch(() => {}));
  for (const button of queryAll("[data-agent-send], [data-agent-pause], [data-agent-resume], [data-agent-edit], [data-agent-revoke]")) {
    button.addEventListener("click", () => {
      setText("[data-agent-action-note]", "This local build prepared the action but did not request a signature or submit a transaction. Use the existing production owner flow only after separate review.");
    });
  }
}

async function applyWallet(wallet) {
  const revision = ++state.revision;
  state.walletAccount = wallet?.account?.toLowerCase?.() ?? null;
  state.walletChainId = wallet?.chainId ?? null;
  state.owner = null;
  state.provider = window.__GOGH_WALLET_PROVIDER__ ?? null;
  state.loading = false;
  state.error = null;
  state.owned = false;
  state.activated = false;
  state.agentStatus = null;
  state.account = null;
  state.punkCollection = null;
  state.nativeBalance = null;
  state.wrappedBalance = null;
  state.automation = null;
  state.assets = [];
  renderIdentity();
  renderPaidPolicy(readPaidPolicy());
  if (!state.tokenId || !wallet?.account || wallet.chainId !== CHAIN_ID || !state.provider) return;
  state.loading = true;
  renderIdentity();
  try {
    await loadOwnership(wallet);
    if (revision !== state.revision) return;
    state.loading = false;
    renderIdentity();
    if (!state.owned) return;
    state.loading = true;
    renderIdentity();
    await loadAutomation();
    if (revision !== state.revision) return;
    await Promise.all([loadBalance(), loadWrappedBalance()]).catch(() => {});
    if (query('[data-control-tab="assets"]')?.getAttribute("aria-selected") === "true") {
      await loadAssets().catch(() => {});
    }
  } catch (error) {
    state.error = error.message;
  } finally {
    if (revision === state.revision) {
      state.loading = false;
      renderIdentity();
    }
  }
}

async function loadDemo() {
  state.tokenId ||= "93";
  const payload = await localApi(`/api/local-v2/session?tokenId=${encodeURIComponent(state.tokenId)}`);
  state.owner = payload.session.owner;
  state.walletAccount = payload.session.owner;
  state.walletChainId = CHAIN_ID;
  state.account = payload.session.account;
  state.punkCollection = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
  state.nativeBalance = 41_200_000_000_000_000n;
  state.wrappedBalance = 12_000_000_000_000_000n;
  state.owned = true;
  state.activated = true;
  state.automation = { capability: true, punk: { tokenId: state.tokenId, account: state.account,
    created: true, active: true, maxAcquisitionsPerDay: 3, acquisitionsToday: 1,
    authorization: { validUntil: String(Math.floor(Date.now() / 1_000) + 7 * 86_400) } },
  usage: { confirmedMints: "191" },
  heartbeat: { status: "NO_ELIGIBLE_TARGETS", completedAt: nowIso() } };
  query("[data-local-demo]").hidden = false;
  setText("[data-summary-balance]", "0.0412 ETH");
  setText("[data-assets-native]", "0.0412 ETH");
  setText("[data-wrap-eth-balance]", "0.0412 ETH");
  setText("[data-wrap-weth-balance]", "0.012 WETH");
  setText("[data-summary-nfts]", "18");
  setText("[data-summary-tokens]", "3");
  setText("[data-summary-lifetime]", "191");
  renderAutomation();
  const serverPolicy = payload.session.policy;
  const localPolicy = { enabled: serverPolicy.paidMintsEnabled,
    daily: String(Number(serverPolicy.dailySpendLimitWei) / 1e18),
    per: String(Number(serverPolicy.maxPerMintWei) / 1e18),
    count: String(serverPolicy.dailyMintLimit) };
  const savedPolicy = readPaidPolicy();
  renderPaidPolicy(Object.keys(savedPolicy).length ? savedPolicy : localPolicy);
  renderDemoOwnerAssets();
  query("[data-directed-url]").value = "https://opensea.io/collection/local-demo-drop";
  await checkDirectedMint();
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
  loadDemo().then(openInitialTab).catch((error) => {
    state.error = error.message;
    renderIdentity();
  });
}
else {
  openInitialTab();
  window.addEventListener("gogh:wallet-state", (event) => applyWallet(event.detail));
  window.addEventListener("gogh:wallet-disconnected", () => applyWallet(null));
  applyWallet(window.__GOGH_WALLET_SNAPSHOT__ ?? null);
}
