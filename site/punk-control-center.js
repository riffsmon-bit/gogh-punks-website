import {
  buildWrappedNativeTransaction, decodeUint256, ROBINHOOD_WETH,
  simulateWrappedNativeTransaction, submitWrappedNativeTransaction, wrappedBalanceOfData,
} from "./wrapped-native.js";
import {
  fetchOwnerPolicyGate, prepareOwnerFunds, readOwnerPolicyState, submitOwnerAction,
} from "./owner-policy-controls.js";
import {
  preflightNftWithdrawal, submitNftWithdrawal, validateWithdrawableNftAssets,
  waitForNftWithdrawalReceipt,
} from "./nft-withdrawal.js";
import {
  agentVisualState, confirmedMintHash, showConfirmedMintToast,
} from "./agent-live-ui.js";
import {
  requestOwnerSetupArtifact, submitOwnerSetupTransactions,
} from "./owner-agent-activation.js";

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
  account: null, provider: null, walletRestoring: false, loading: false, error: null,
  punkCollection: null, nativeBalance: null, wrappedBalance: null,
  owned: false, activated: false, agentStatus: null, automation: null, assets: [],
  activity: [], timings: {}, revision: 0,
  punkHeartbeat: null, observedMintHash: null, mintBaselineReady: false,
  activityLoading: false,
  directedReviewId: null, directedIntentId: null, directedSourceUrl: null,
  fundingBusy: false, wrappedBusy: false, wrappedPlan: null,
  activationBusy: false, activationMessage: null,
  withdrawalAsset: null, withdrawalAmount: "1", withdrawalBusy: false,
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
    "[data-wrap-review]", "[data-schedule-save]"]) {
    const element = query(selector);
    if (element) element.disabled = !enabled;
  }
  const amount = query("[data-punk-fund-amount]");
  const confirmation = query("[data-punk-fund-confirm]");
  if (amount) amount.disabled = !enabled || state.fundingBusy;
  if (confirmation) confirmation.disabled = !enabled || state.fundingBusy;
  renderFundingAction();
  renderActivation();
}

function setupPurpose(value) {
  return ({ ACTIVATE_V3_PUNK_ACCOUNT: "Create Punk Wallet",
    CONFIGURE_ZERO_SPEND_AUTONOMOUS_POLICY: "Set Free-Mint Limits",
    AUTHORIZE_PUBLISHED_AGENT: "Authorize Art Broker" })[value]
    ?? "Confirm Art Broker Setup";
}

function renderActivation() {
  const button = query("[data-control-activate]");
  if (!button) return;
  const authorizationActive = state.automation?.punk?.active === true;
  const setupAvailable = state.automation?.setupTransactionAvailable === true;
  const title = authorizationActive ? "Art Broker Active" : state.activated
    ? "Reactivate This Art Broker" : "Activate This Art Broker";
  const copy = authorizationActive
    ? "This Punk is authorized and remains in the fair worker rotation. A temporary worker delay does not require reactivation."
    : state.activated
      ? "The Punk Wallet already exists. Confirm only the remaining bounded permission steps shown by your wallet."
      : "Create this Punk's wallet, set a free-mint limit, and authorize the hosted Art Broker. Your Gogh Punk stays in your main wallet.";
  setText("[data-control-activation-title]", title);
  setText("[data-control-activation-copy]", copy);
  setText("[data-control-activation-state]", state.activationMessage
    ?? (authorizationActive ? "Confirmed on-chain. No owner action is required."
      : setupAvailable ? "Ready. The site will label every required wallet transaction before it opens."
        : "The live setup service is not ready. Your Punk and assets remain safe."));
  button.hidden = authorizationActive;
  button.disabled = state.activationBusy || !state.owned || !setupAvailable || authorizationActive;
  button.textContent = state.activationBusy ? "ACTIVATION IN PROGRESS…"
    : state.activated ? "REACTIVATE ART BROKER" : "ACTIVATE ART BROKER";
  for (const selector of ["[data-control-activation-cap]", "[data-control-activation-days]"]) {
    const element = query(selector);
    if (element) element.disabled = state.activationBusy || !state.owned || authorizationActive;
  }
}

function renderFundingAction() {
  const button = query("[data-punk-fund-submit]");
  const confirmation = query("[data-punk-fund-confirm]");
  if (!button) return;
  button.disabled = !state.owned || !state.activated || state.fundingBusy
    || confirmation?.checked !== true;
  button.textContent = state.fundingBusy ? "CHECKING & SIMULATING…" : "FUND PUNK WALLET IN METAMASK";
}

function controlPresentation() {
  if (!state.tokenId) return {
    status: "🔴 CHOOSE A PUNK", heading: "Punk not selected",
    detail: "Open My Art Brokers and choose a Punk before using its controls.",
    account: "Choose a Punk first",
  };
  if (state.walletRestoring && !state.walletAccount) return {
    status: "🔵 RESTORING WALLET", heading: "Restoring wallet",
    detail: "Restoring your existing wallet session. No signature or transaction is requested.",
    account: "Restoring Punk Wallet…",
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
    status: ["SCANNING", "MINTING", "MINTED", "ACTIVE"].includes(state.agentStatus)
      ? `🟢 ${state.agentStatus}`
      : ["WAITING", "QUEUED", "WAITING_FOR_WORKER"].includes(state.agentStatus)
        ? "🟡 WAITING FOR WORKER"
        : state.agentStatus === "PAUSED" ? "🟡 PAUSED"
          : state.agentStatus === "PUNK_ERROR" ? "🔴 NEEDS YOUR ATTENTION"
            : state.activated ? "🟡 CHECKING AUTHORIZATION" : "⚪ READY TO ACTIVATE",
    heading: state.agentStatus === "SCANNING" ? "Agent scanning"
      : state.agentStatus === "MINTING" ? "Mint in progress"
        : state.agentStatus === "MINTED" ? "Mint confirmed"
          : ["WAITING", "QUEUED", "WAITING_FOR_WORKER"].includes(state.agentStatus)
            ? "Waiting in worker rotation"
            : state.agentStatus === "PAUSED" ? "Agent paused"
              : state.agentStatus === "PUNK_ERROR" ? "Punk needs attention"
                : state.agentStatus === "ACTIVE" ? "Art Broker active"
                  : state.activated ? "Checking authorization" : "Ready to activate",
    detail: demo ? "Local Punk ownership fixture loaded; no chain authority is implied."
      : ["WAITING", "QUEUED", "WAITING_FOR_WORKER"].includes(state.agentStatus)
        ? "Your Punk is still activated. The hosted worker is temporarily delayed or this Punk is waiting for its fair turn. No owner action is required."
        : state.agentStatus === "PUNK_ERROR"
          ? "This Punk has a Punk-specific issue. Open Activity for the exact recorded reason."
          : "Live Punk ownership and authorization were checked independently.",
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
  setText("[data-terminal-punk]", state.tokenId ?? "—");
  setText("[data-directed-punk]", state.tokenId ? `#${state.tokenId}` : "—");
  setText("[data-control-account]", presentation.account);
  setText("[data-punk-fund-account]", presentation.account);
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
  const response = await fetch(
    `/api/broker/owner-punks?owner=${encodeURIComponent(wallet.account)}&view=indexed`, {
      headers: { accept: "application/json" }, cache: "no-cache",
    },
  );
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
  const globalHeartbeat = automation?.heartbeat;
  const heartbeat = state.punkHeartbeat ?? (globalHeartbeat?.tokenId === state.tokenId
    ? globalHeartbeat : null);
  const authorizationActive = punk?.active === true && state.owned && state.activated;
  const platformStatus = automation?.platformHealth?.status ?? null;
  const visual = authorizationActive ? agentVisualState(heartbeat, true) : "INACTIVE";
  const punkSpecificFailure = visual === "NEEDS_ATTENTION"
    && !new Set(["FAILED", "WORKER_RUN_FAILED", "DISCOVERY_SCAN_FAILED",
      "PROFILE_STATE_READ_FAILED", "PROVIDER_OWNER_DISAGREEMENT"]).has(
      String(heartbeat?.status ?? heartbeat?.reason ?? ""),
    );
  const label = !state.activated ? "INACTIVE"
    : !authorizationActive ? "PAUSED"
      : punkSpecificFailure ? "PUNK_ERROR"
        : ["SCANNING", "MINTING", "MINTED", "QUEUED"].includes(visual) ? visual
          : platformStatus && platformStatus !== "HEALTHY" ? "WAITING_FOR_WORKER"
            : visual === "NEEDS_ATTENTION" ? "WAITING_FOR_WORKER" : "ACTIVE";
  state.agentStatus = label;
  setText("[data-terminal-status]", label.replaceAll("_", " "));
  setText("[data-agent-status]", label);
  setText("[data-agent-free]", authorizationActive ? "ON" : "OFF");
  setText("[data-agent-mint-limit]", punk?.maxAcquisitionsPerDay
    ? `${punk.maxAcquisitionsPerDay} NFTs/day` : "Not configured");
  setText("[data-agent-expiry]", punk?.authorization?.validUntil
    ? new Date(Number(punk.authorization.validUntil) * 1000).toLocaleString() : "Not active");
  setText("[data-summary-mints]", punk
    ? `${punk.acquisitionsToday ?? 0} / ${punk.maxAcquisitionsPerDay ?? 0}` : "—");
  if (heartbeat?.completedAt) {
    setText("[data-agent-last-scan]", new Date(heartbeat.completedAt).toLocaleTimeString());
    setText("[data-agent-last-result]", heartbeatMessage(heartbeat));
    setText("[data-agent-next-scan]", platformStatus && platformStatus !== "HEALTHY"
      ? "Waiting for worker"
      : `~${new Date(Date.parse(heartbeat.completedAt) + 5 * 60_000).toLocaleTimeString()}`);
  }
  if (heartbeat && (!heartbeat.tokenId || heartbeat.tokenId === state.tokenId)) {
    addActivity({ at: heartbeat.completedAt, state: heartbeat.status,
      message: heartbeatMessage(heartbeat),
      action: heartbeat.status === "MINT_CONFIRMED" ? "OPEN_ASSETS" : null });
    renderDiscoverySummary(heartbeat.discoverySummary);
  }
  renderIdentity();
}

function heartbeatMessage(heartbeat) {
  const messages = {
    NO_ELIGIBLE_TARGETS: "No eligible supported mint was found in the latest scan.",
    MINT_CONFIRMED: "Mint successful. The NFT was sent to its Punk Wallet.",
    FAILED: "The worker stopped safely. This Punk stays activated and will retry after recovery.",
  };
  return messages[heartbeat?.status] ?? "The hosted agent completed a bounded check.";
}

function punkWorkerMessage(event) {
  const reasons = {
    NO_ELIGIBLE_TARGETS: "Scan complete — no mint passed every contract and policy check.",
    NO_ACTIVE_CANDIDATES: "Scan complete — no active mint candidate was available.",
    WAITING_FOR_WORKER_CAPACITY: "This Punk is enrolled and waiting in the worker rotation.",
    MINT_CONFIRMED: "Mint successful. The NFT was sent to this Punk Wallet.",
    ELIGIBLE_SIMULATION_PASSED: "A candidate passed simulation without being submitted.",
    PROFILE_STATE_READ_FAILED: "The live Punk state check failed safely.",
    PROVIDER_OWNER_DISAGREEMENT: "Ownership providers disagreed, so the scan stopped safely.",
    ACCOUNT_NOT_CREATED: "This Punk Wallet has not been created.",
  };
  return reasons[event?.reason] ?? (event?.state === "MINTED"
    ? "Mint successful. The NFT was sent to this Punk Wallet."
    : "The hosted agent completed a bounded scan for this Punk.");
}

function renderDiscoverySummary(summary) {
  const panel = query("[data-agent-discovery]");
  if (!panel) return;
  if (!summary || typeof summary !== "object") {
    panel.hidden = true;
    return;
  }
  const discovered = Number(summary.discovered ?? 0);
  const websites = Number(summary.withWebsite ?? 0);
  const xProfiles = Number(summary.withX ?? 0);
  const validated = Number(summary.sentToOnchainValidation ?? 0);
  setText("[data-agent-discovery-copy]", `${discovered} candidate${discovered === 1 ? "" : "s"} discovered · ${websites} with project websites · ${xProfiles} with X profiles · ${validated} sent into live contract safety checks.`);
  const candidates = Array.isArray(summary.candidates) ? summary.candidates.slice(0, 3) : [];
  setText("[data-agent-discovery-tier]", candidates[0]?.tier
    ? `${candidates[0].tier} discovery priority` : "No ranked candidate");
  const grid = query("[data-agent-candidate-grid]");
  grid.replaceChildren(...candidates.map((candidate) => {
    const card = document.createElement("article");
    if (candidate.imageUrl) {
      const image = document.createElement("img");
      image.src = candidate.imageUrl;
      image.alt = candidate.projectName ? `${candidate.projectName} artwork` : "Candidate collection artwork";
      image.loading = "lazy";
      image.decoding = "async";
      card.append(image);
    }
    const title = document.createElement("h3");
    const contract = document.createElement("code");
    const reasons = document.createElement("ul");
    title.textContent = candidate.projectName ?? `${candidate.tier} priority candidate`;
    contract.textContent = `${candidate.collection.slice(0, 8)}…${candidate.collection.slice(-6)}`;
    for (const reason of candidate.reasons ?? []) {
      const item = document.createElement("li");
      item.textContent = `✓ ${reason}`;
      reasons.append(item);
    }
    const links = document.createElement("div");
    links.className = "agent-candidate-links";
    for (const [label, href] of [["Website ↗", candidate.websiteUrl], ["X ↗", candidate.xUrl]]) {
      if (!href) continue;
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer nofollow";
      link.textContent = label;
      links.append(link);
    }
    card.append(title, contract, reasons, links);
    return card;
  }));
  if (candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No socially ranked candidate reached live contract validation in this scan.";
    grid.replaceChildren(empty);
  }
  panel.hidden = false;
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

async function waitForReceipt(hash, revision) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (revision !== state.revision) throw new Error("Page state changed while confirming");
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error("Transaction reverted");
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
  return null;
}

async function activateArtBroker() {
  if (state.activationBusy) return;
  if (demo) {
    state.activationMessage = "Local demo: the reviewed activation plan is available, but no wallet transaction was submitted.";
    renderActivation();
    return;
  }
  if (!state.owned || !state.provider || !state.walletAccount || !state.tokenId) {
    state.activationMessage = "Connect the wallet that currently owns this Punk on Robinhood Chain.";
    renderActivation();
    return;
  }
  if (state.automation?.setupTransactionAvailable !== true) {
    state.activationMessage = "The live setup service is temporarily unavailable. No transaction was requested.";
    renderActivation();
    return;
  }
  const revision = state.revision;
  const tokenId = state.tokenId;
  const owner = state.walletAccount;
  const isCurrent = () => revision === state.revision && state.tokenId === tokenId
    && state.walletAccount === owner && state.owned === true;
  const selection = Object.freeze({ tokenId, owner,
    cap: query("[data-control-activation-cap]").value,
    days: query("[data-control-activation-days]").value });
  state.activationBusy = true;
  state.activationMessage = "Preparing a live-checked activation plan for this Punk…";
  renderActivation();
  try {
    await verifyCurrentOwner();
    const artifact = await requestOwnerSetupArtifact((...args) => fetch(...args), selection);
    await submitOwnerSetupTransactions(state.provider, artifact, selection, {
      isCurrent,
      onProgress(progress) {
        const purpose = setupPurpose(progress.transaction.purpose);
        state.activationMessage = progress.phase === "wallet"
          ? `Transaction ${progress.index} of ${progress.total} — ${purpose}. Waiting for your wallet…`
          : progress.phase === "confirming"
            ? `Transaction ${progress.index} of ${progress.total} submitted — confirming ${purpose}…`
            : `Transaction ${progress.index} of ${progress.total} confirmed ✓ — ${purpose}`;
        renderActivation();
      },
    });
    if (!isCurrent()) throw new Error("The selected wallet or Punk changed after activation");
    state.activationMessage = "On-chain activation confirmed. Enrolling the agent and requesting its first scan…";
    renderActivation();
    const response = await fetch("/api/broker/autonomy-v3-run", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ tokenId }), cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      state.activationMessage = "Punk activated on-chain, but worker enrollment could not be confirmed. Your authorization remains intact; retry from Agent when the worker recovers.";
    } else {
      state.activationMessage = payload.run?.status === "RUN_IN_PROGRESS"
        ? "Art Broker active ✓ Enrolled and waiting in the fair worker rotation."
        : "Art Broker active ✓ Enrolled and first scan requested.";
    }
    await loadAutomation();
  } catch (error) {
    state.activationMessage = `${error?.message ?? "Activation stopped safely"}. No further transaction was submitted.`;
  } finally {
    state.activationBusy = false;
    renderActivation();
  }
}

async function fundPunkWallet() {
  const output = query("[data-punk-fund-state]");
  const transactionLink = query("[data-punk-fund-transaction]");
  if (state.fundingBusy) return;
  if (demo) {
    output.textContent = "Local demo: the exact owner-to-Punk deposit can be reviewed, but no wallet request is submitted.";
    return;
  }
  if (!state.owned || !state.activated || !state.account || !state.walletAccount) {
    output.textContent = "Connect the current holder and select an activated Punk first.";
    return;
  }
  if (!query("[data-punk-fund-confirm]").checked) {
    output.textContent = "Review the selected Punk Wallet, amount, and direction first.";
    return;
  }
  const revision = state.revision;
  const tokenId = state.tokenId;
  const account = state.account;
  const selection = Object.freeze({
    tokenId, account, activated: true, owner: state.walletAccount,
  });
  state.fundingBusy = true;
  renderFundingAction();
  transactionLink.hidden = true;
  try {
    output.textContent = "Checking live ownership, Punk Wallet code, policy, and exact deposit simulation…";
    const gate = await fetchOwnerPolicyGate((...args) => fetch(...args));
    const prepared = await prepareOwnerFunds(state.provider, gate, selection, "deposit",
      query("[data-punk-fund-amount]").value.trim());
    if (revision !== state.revision || account !== state.account || tokenId !== state.tokenId) {
      throw new Error("Selected Punk changed during review");
    }
    output.textContent = "Waiting for MetaMask…";
    const submitted = await submitOwnerAction(state.provider, prepared, gate, selection,
      () => revision === state.revision && account === state.account && tokenId === state.tokenId);
    transactionLink.href = `https://robinhoodchain.blockscout.com/tx/${submitted.hash}`;
    transactionLink.hidden = false;
    output.textContent = "Transaction submitted. Waiting for confirmation…";
    const receipt = await waitForReceipt(submitted.hash, revision);
    if (!receipt) {
      output.textContent = "Transaction submitted; confirmation is taking longer than one minute. Use the transaction link to follow it.";
      return;
    }
    await loadBalance();
    output.textContent = `Confirmed. Punk #${tokenId}'s wallet balance has been refreshed.`;
    query("[data-punk-fund-confirm]").checked = false;
  } catch (error) {
    output.textContent = `${error?.message ?? "Funding was not submitted"}.`;
  } finally {
    state.fundingBusy = false;
    renderFundingAction();
  }
}

async function reviewWrappedNative() {
  const output = query("[data-wrap-state]");
  const transactionLink = query("[data-wrap-transaction]");
  if (state.wrappedBusy) return;
  if (!state.owned || !state.activated || !state.account || !state.walletAccount) {
    output.textContent = "Activate this Punk Wallet and connect its current holder first.";
    return;
  }
  if (!query("[data-wrap-confirm]").checked) {
    output.textContent = "Review and accept the exact Punk Wallet, direction, amount, and WETH contract first.";
    return;
  }
  const revision = state.revision;
  const tokenId = state.tokenId;
  const account = state.account;
  const direction = query("[data-wrap-direction]").value;
  const amount = query("[data-wrap-amount]").value.trim();
  const selection = Object.freeze({ tokenId, account, activated: true, owner: state.walletAccount });
  const isCurrent = () => revision === state.revision && tokenId === state.tokenId
    && account === state.account && direction === query("[data-wrap-direction]").value
    && amount === query("[data-wrap-amount]").value.trim();
  const prepare = async () => {
    const gate = await fetchOwnerPolicyGate((...args) => fetch(...args));
    const live = await readOwnerPolicyState(state.provider, gate, selection);
    const plan = buildWrappedNativeTransaction({ direction, punkWallet: live.account,
      currentOwner: live.owner, amount });
    const wrappedRaw = await rpc("eth_call", [{ to: ROBINHOOD_WETH,
      data: wrappedBalanceOfData(live.account) }, "latest"]);
    const wrapped = decodeUint256(wrappedRaw);
    const available = plan.direction === "WRAP" ? live.balanceWei : wrapped;
    if (plan.amountWei > available) {
      throw new RangeError(`This Punk Wallet does not have enough ${plan.direction === "WRAP" ? "ETH" : "WETH"}`);
    }
    await simulateWrappedNativeTransaction(state.provider, plan);
    return plan;
  };
  state.wrappedBusy = true;
  query("[data-wrap-review]").disabled = true;
  try {
    if (!state.wrappedPlan) {
      output.textContent = "Rechecking the current holder, verified Punk Wallet, balance, and exact WETH call…";
      const plan = demo ? buildWrappedNativeTransaction({ direction, punkWallet: account,
        currentOwner: state.walletAccount, amount }) : await prepare();
      if (!isCurrent()) throw new Error("Selected Punk or WETH action changed during review");
      state.wrappedPlan = plan;
      query("[data-wrap-review]").textContent = demo ? "Local Review Complete" : "Submit in MetaMask";
      output.textContent = demo
        ? `${direction === "WRAP" ? "Wrap" : "Unwrap"} review passed. Exact owner-only calldata was built; nothing was submitted.`
        : `${direction === "WRAP" ? "Wrap" : "Unwrap"} simulation passed. Review once more, then submit in MetaMask.`;
      return;
    }
    if (demo) return;
    output.textContent = "Rechecking every binding before opening MetaMask…";
    const submitted = await submitWrappedNativeTransaction(
      state.provider, state.wrappedPlan, prepare, isCurrent,
    );
    transactionLink.href = `https://robinhoodchain.blockscout.com/tx/${submitted.hash}`;
    transactionLink.hidden = false;
    output.textContent = "Transaction submitted. Waiting for confirmation…";
    const receipt = await waitForReceipt(submitted.hash, revision);
    if (!receipt) {
      output.textContent = "Transaction submitted; confirmation is taking longer than one minute. Follow it with the transaction link.";
      return;
    }
    state.wrappedPlan = null;
    query("[data-wrap-confirm]").checked = false;
    query("[data-wrap-review]").textContent = "Review & Simulate";
    await Promise.all([loadBalance(), loadWrappedBalance()]);
    output.textContent = `${direction === "WRAP" ? "Wrap" : "Unwrap"} confirmed ✓ Balances refreshed.`;
  } catch (error) {
    state.wrappedPlan = null;
    query("[data-wrap-review]").textContent = "Review & Simulate";
    output.textContent = `${error?.message ?? "WETH action stopped safely"}.`;
  } finally {
    state.wrappedBusy = false;
    query("[data-wrap-review]").disabled = !(state.owned && state.activated);
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
    if (item.action === "OPEN_ASSETS") {
      const action = document.createElement("button");
      action.type = "button";
      action.textContent = "View NFT / Withdraw";
      action.addEventListener("click", () => query('[data-control-tab="assets"]')?.click());
      row.append(action);
    }
    return row;
  }));
}

async function loadActivity() {
  if (state.activityLoading) return;
  const started = performance.now();
  const button = query("[data-activity-refresh]");
  if (!state.owned) {
    setText("[data-activity-state]", "Connect the current holder on Robinhood Chain to load Punk-specific activity.");
    return;
  }
  state.activityLoading = true;
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
    const punkActivity = payload.activity?.punk;
    if (punkActivity?.heartbeat) {
      state.punkHeartbeat = punkActivity.heartbeat;
      const latestMintHash = confirmedMintHash(punkActivity.heartbeat);
      if (!state.mintBaselineReady) {
        state.observedMintHash = latestMintHash;
        state.mintBaselineReady = true;
      } else if (latestMintHash && latestMintHash !== state.observedMintHash) {
        state.observedMintHash = latestMintHash;
        showConfirmedMintToast({ documentObject: document, tokenId: state.tokenId,
          transactionHash: latestMintHash });
        void loadAssets().catch(() => {});
      }
      renderAutomation();
    }
    if (punkActivity?.events?.length) {
      for (const event of [...punkActivity.events].reverse()) {
        addActivity({ at: event.occurredAt, state: event.state,
          message: punkWorkerMessage(event),
          action: event.state === "MINTED" ? "OPEN_ASSETS" : null });
      }
      setText("[data-activity-state]",
        `Loaded ${punkActivity.events.length} Punk #${state.tokenId} worker event${punkActivity.events.length === 1 ? "" : "s"}.`);
      metric("Activity", started);
      return;
    }
    if (punkActivity?.heartbeat) {
      const event = punkActivity.heartbeat;
      addActivity({ at: event.lastActualScan ?? event.updatedAt, state: event.state,
        message: punkWorkerMessage(event),
        action: event.state === "MINTED" ? "OPEN_ASSETS" : null });
      setText("[data-activity-state]", `Latest Punk #${state.tokenId} worker state loaded.`);
      metric("Activity", started);
      return;
    }
    const heartbeat = payload.activity?.heartbeat;
    if (heartbeat && (!heartbeat.tokenId || String(heartbeat.tokenId) === state.tokenId)) {
      addActivity({ at: heartbeat.completedAt, state: heartbeat.status,
        message: heartbeatMessage(heartbeat),
        action: heartbeat.status === "MINT_CONFIRMED" ? "OPEN_ASSETS" : null });
      renderDiscoverySummary(heartbeat.discoverySummary);
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
    state.activityLoading = false;
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
  const validImage = /^https:\/\/(?:i|raw2)\.seadn\.io\//.test(asset.imageUrl ?? "")
    || /^https:\/\/ipfs\.io\/ipfs\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(?:\/[A-Za-z0-9._~%-]+)*$/.test(asset.imageUrl ?? "");
  image.src = validImage ? asset.imageUrl : "/assets/nft-placeholder.svg";
  image.addEventListener("error", () => {
    if (!image.src.endsWith("/assets/nft-placeholder.svg")) {
      image.src = "/assets/nft-placeholder.svg";
    }
  }, { once: true });
  const title = document.createElement("h3");
  title.textContent = asset.name || `NFT #${asset.tokenId}`;
  const collection = document.createElement("p");
  collection.className = "eyebrow";
  collection.textContent = asset.collectionName ?? "Collection name unavailable";
  const source = document.createElement("p");
  source.className = "control-asset-source";
  const origin = asset.provenance === "ART_BROKER" ? "Collected by this Punk"
    : "Received by this Punk Wallet";
  source.textContent = asset.floorPrice
    ? `${origin} · OpenSea collection floor ${asset.floorPrice.amount} ${asset.floorPrice.currency}`
    : `${origin} · floor unavailable`;
  const actions = document.createElement("div");
  actions.className = "control-asset-actions";
  const openSea = document.createElement("a");
  openSea.href = asset.openSeaUrl;
  openSea.target = "_blank";
  openSea.rel = "noopener noreferrer";
  openSea.textContent = "View on OpenSea ↗";
  const withdrawal = document.createElement("button");
  withdrawal.type = "button";
  withdrawal.textContent = "Withdraw to my wallet";
  withdrawal.disabled = !state.owned || state.withdrawalBusy;
  withdrawal.addEventListener("click", () => selectWithdrawalAsset(asset));
  actions.append(openSea, withdrawal);
  card.append(image, collection, title, source, actions);
  return card;
}

function withdrawalImage(asset) {
  return (/^https:\/\/(?:i|raw2)\.seadn\.io\//.test(asset?.imageUrl ?? "")
    || /^https:\/\/ipfs\.io\/ipfs\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(?:\/[A-Za-z0-9._~%-]+)*$/.test(asset?.imageUrl ?? ""))
    ? asset.imageUrl : "/assets/nft-placeholder.svg";
}

function floorLabel(asset) {
  return asset?.floorPrice
    ? `${asset.floorPrice.amount} ${asset.floorPrice.currency} · OpenSea collection estimate`
    : "Not available — this does not block withdrawal";
}

function renderWithdrawal() {
  const panel = query("[data-control-withdrawal]");
  const asset = state.withdrawalAsset;
  if (!panel) return;
  panel.hidden = !asset;
  if (!asset) return;
  query("[data-withdrawal-image]").src = withdrawalImage(asset);
  query("[data-withdrawal-image]").onerror = (event) => {
    const image = event.currentTarget;
    image.onerror = null;
    image.src = "/assets/nft-placeholder.svg";
  };
  query("[data-withdrawal-image]").alt = asset.name || `NFT #${asset.tokenId}`;
  setText("[data-withdrawal-name]", asset.name || `NFT #${asset.tokenId}`);
  setText("[data-withdrawal-collection]", asset.collectionName ?? "Collection name unavailable");
  setText("[data-withdrawal-punk]", state.tokenId ?? "—");
  setText("[data-withdrawal-owner]", state.owner ? formatAddress(state.owner) : "Current Punk holder");
  setText("[data-withdrawal-asset]", `${asset.standard} · token #${asset.tokenId}`);
  setText("[data-withdrawal-floor]", floorLabel(asset));
  const confirmation = query("[data-withdrawal-confirm]");
  const submit = query("[data-withdrawal-submit]");
  const quantityField = query("[data-withdrawal-quantity-field]");
  const quantity = query("[data-withdrawal-quantity]");
  quantityField.hidden = asset.standard !== "ERC1155";
  quantity.max = asset.amount;
  quantity.value = state.withdrawalAmount;
  const validQuantity = asset.standard !== "ERC1155"
    || (/^[1-9]\d*$/.test(state.withdrawalAmount)
      && BigInt(state.withdrawalAmount) <= BigInt(asset.amount));
  confirmation.disabled = !state.owned || state.withdrawalBusy;
  submit.disabled = !state.owned || state.withdrawalBusy || !confirmation.checked
    || !validQuantity;
  submit.textContent = state.withdrawalBusy
    ? "VERIFYING LIVE OWNERSHIP…" : "VERIFY & WITHDRAW IN METAMASK";
}

function selectWithdrawalAsset(asset) {
  state.withdrawalAsset = asset;
  state.withdrawalAmount = asset.standard === "ERC1155" ? "1" : asset.amount;
  const confirmation = query("[data-withdrawal-confirm]");
  confirmation.checked = false;
  query("[data-withdrawal-transaction]").hidden = true;
  setText("[data-withdrawal-state]", "Review the NFT and fixed current-holder destination, then confirm.");
  renderWithdrawal();
  query("[data-control-withdrawal]").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function cancelWithdrawal() {
  if (state.withdrawalBusy) return;
  state.withdrawalAsset = null;
  query("[data-withdrawal-confirm]").checked = false;
  renderWithdrawal();
}

async function fetchWithdrawalGate(token) {
  const response = await fetch(
    `/api/broker/nft-withdrawal-status?tokenId=${encodeURIComponent(token)}`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) throw new Error("NFT withdrawal status is unavailable");
  return payload.recovery;
}

async function withdrawSelectedAsset() {
  if (state.withdrawalBusy || !state.withdrawalAsset) return;
  if (demo) {
    setText("[data-withdrawal-state]", "Local demo: withdrawal was prepared but no wallet request was submitted.");
    return;
  }
  if (!state.owned || !state.provider || !state.tokenId) {
    setText("[data-withdrawal-state]", "Connect the current Punk holder on Robinhood Chain first.");
    return;
  }
  const revision = state.revision;
  const selectedToken = state.tokenId;
  const selectedAsset = state.withdrawalAsset;
  const selectedAmount = state.withdrawalAmount;
  const asset = Object.freeze({ ...selectedAsset,
    amount: selectedAsset.standard === "ERC1155"
      ? state.withdrawalAmount : state.withdrawalAsset.amount });
  state.withdrawalBusy = true;
  renderWithdrawal();
  setText("[data-withdrawal-state]", "Checking live holder, Punk Wallet code, NFT ownership, and transfer simulation…");
  try {
    const gate = await fetchWithdrawalGate(selectedToken);
    const initial = await preflightNftWithdrawal(state.provider, gate, selectedToken, asset);
    const result = await submitNftWithdrawal(state.provider, initial, {
      loadGate: fetchWithdrawalGate,
      isCurrent: () => revision === state.revision
        && state.withdrawalAsset === selectedAsset
        && state.withdrawalAmount === selectedAmount,
    });
    const link = query("[data-withdrawal-transaction]");
    link.href = `https://robinhoodchain.blockscout.com/tx/${result.hash}`;
    link.hidden = false;
    setText("[data-withdrawal-state]", "Transaction submitted. Waiting for Robinhood Chain confirmation…");
    await waitForNftWithdrawalReceipt(state.provider, result.hash);
    setText("[data-withdrawal-state]", "NFT withdrawn ✓ Portfolio refreshed for the current Punk holder.");
    query("[data-withdrawal-confirm]").checked = false;
    state.withdrawalAsset = null;
    window.dispatchEvent(new CustomEvent("gogh:portfolio-invalidated", { detail: {
      tokenId: selectedToken, owner: state.owner, transactionHash: result.hash,
    } }));
    await Promise.all([loadAssets(), loadActivity().catch(() => {})]);
  } catch (error) {
    setText("[data-withdrawal-state]", error?.message ?? "NFT withdrawal stopped safely.");
  } finally {
    state.withdrawalBusy = false;
    renderWithdrawal();
  }
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
        { name: "Demo Generative Study #441", collectionName: "Demo Studies",
          collection: "0x4444444444444444444444444444444444444444", standard: "ERC721",
          tokenId: "441", amount: "1", imageUrl: null, floorPrice: null,
          openSeaUrl: "https://opensea.io/item/robinhood/0x4444444444444444444444444444444444444444/441" },
        { name: "Demo Pixel Bloom #12", collectionName: "Demo Blooms",
          collection: "0x5555555555555555555555555555555555555555", standard: "ERC721",
          tokenId: "12", amount: "1", imageUrl: null, floorPrice: null,
          openSeaUrl: "https://opensea.io/item/robinhood/0x5555555555555555555555555555555555555555/12" },
        { name: "Demo Holder Pass #7", collectionName: "Demo Passes",
          collection: "0x6666666666666666666666666666666666666666", standard: "ERC721",
          tokenId: "7", amount: "1", imageUrl: null, floorPrice: null,
          openSeaUrl: "https://opensea.io/item/robinhood/0x6666666666666666666666666666666666666666/7" },
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
    const items = validateWithdrawableNftAssets(payload.assets, state.tokenId);
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
  try {
    setText("[data-directed-state]", demo
      ? "Resolving the local mint fixture and verifying its exact recipient…"
      : "Checking OpenSea drop details and live Punk ownership…");
    const payload = demo
      ? await localApi("/api/local-v2/directed/resolve", { body: {
        tokenId: state.tokenId, url: input, recipient: state.account,
      } })
      : await localApi("/api/broker/connector/opensea", { body: {
        action: "inspect", tokenId: state.tokenId, url: input,
        walletAddress: state.walletAccount,
      } });
    const policy = readPaidPolicy();
    const review = payload.review;
    state.directedReviewId = demo ? payload.reviewId : null;
    state.directedSourceUrl = input;
    query("[data-directed-review]").hidden = false;
    setText("[data-directed-collection]", review.collectionName);
    if (demo) {
      const priceWei = BigInt(review.candidate.priceWei);
      const gasWei = BigInt(payload.estimatedGasWei);
      setText("[data-directed-price]", `${formatNative(priceWei)} · local fixture`);
      setText("[data-directed-gas]", `${formatNative(gasWei)} · simulated`);
      setText("[data-directed-maximum]", formatNative(priceWei + gasWei));
    } else {
      setText("[data-directed-price]", "Prepare review to verify");
      setText("[data-directed-gas]", "Not simulated");
      setText("[data-directed-maximum]", "Not calculated");
      setText("[data-directed-badge]", review.chainVerified
        ? "ROBINHOOD DROP" : "CHAIN UNVERIFIED");
    }
    setText("[data-directed-remaining]", `${policy.daily ?? "0.025"} ETH`);
    setText("[data-directed-state]", demo
      ? "Supported local fixture resolved and stored for exact simulation. Nothing was submitted."
      : `${review.message} Nothing was signed or submitted.`);
    setText("[data-directed-simulation]", demo
      ? "Nothing has been submitted."
      : "Press Prepare Bounded Review to request and decode OpenSea's proposed mint call.");
    await loadActivity();
    metric("Directed URL resolution", started);
  } catch (error) {
    state.directedReviewId = null;
    state.directedSourceUrl = null;
    query("[data-directed-review]").hidden = true;
    setText("[data-directed-state]", `${error.message}. Nothing was submitted.`);
  }
}

async function simulateDirectedMint() {
  const started = performance.now();
  if ((demo && !state.directedReviewId) || (!demo && !state.directedSourceUrl)) {
    setText("[data-directed-simulation]", "Check a supported OpenSea mint first.");
    return;
  }
  try {
    setText("[data-directed-simulation]", demo
      ? "Rechecking policy, recipient, price, and simulated asset effects…"
      : "Requesting a quantity-one OpenSea proposal and decoding its exact call…");
    if (demo) {
      const payload = await localApi("/api/local-v2/directed/simulate", { body: {
        tokenId: state.tokenId, reviewId: state.directedReviewId,
      } });
      setText("[data-directed-simulation]", payload.result.ready
        ? "Simulation passed: exact spend, one expected NFT receipt, no approvals, outgoing assets, or contract creation. Nothing was broadcast."
        : `Simulation blocked safely: ${payload.result.decision.code}.`);
    } else {
      const payload = await localApi("/api/broker/connector/opensea", { body: {
        action: "prepare", tokenId: state.tokenId, url: state.directedSourceUrl,
        walletAddress: state.walletAccount,
      } });
      const review = payload.review;
      state.directedReviewId = review.reviewId;
      state.directedIntentId = review.intentId;
      setText("[data-directed-collection]", review.collectionName);
      setText("[data-directed-price]", `${formatNative(review.proposal.valueWei)} · ${review.proposal.priceKind.toLowerCase()}`);
      setText("[data-directed-gas]", "Not simulated");
      setText("[data-directed-maximum]", `${formatNative(review.proposal.valueWei)} + gas`);
      setText("[data-directed-badge]", review.proposal.currentFreeAdapterCompatible
        ? "CALL SHAPE MATCH" : "BLOCKED SAFELY");
      setText("[data-directed-simulation]", `${review.message} No signature or transaction was requested.`);
      const button = query("[data-directed-simulate]");
      button.textContent = review.intentId ? "Revalidate Mint Intent" : "Prepare Bounded Review";
    }
    await loadActivity();
    metric("Simulation", started);
  } catch (error) {
    setText("[data-directed-simulation]", `${error.message}. Nothing was submitted.`);
  }
}

async function revalidateDirectedMintIntent() {
  if (demo || !state.directedIntentId) return simulateDirectedMint();
  try {
    setText("[data-directed-simulation]", "Rechecking live ownership, recipient, price, and exact SeaDrop call…");
    const payload = await localApi("/api/broker/connector/opensea", { body: {
      action: "execute", tokenId: state.tokenId, intentId: state.directedIntentId,
      walletAddress: state.walletAccount,
    } });
    state.directedIntentId = null;
    query("[data-directed-simulate]").textContent = "Prepare New Review";
    setText("[data-directed-simulation]", `${payload.review.message} Nothing was signed or submitted.`);
  } catch (error) {
    state.directedIntentId = null;
    query("[data-directed-simulate]").textContent = "Prepare New Review";
    setText("[data-directed-simulation]", `${error.message}. Check the mint again.`);
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
  query("[data-control-activate]").addEventListener("click", activateArtBroker);
  query("[data-paid-save]").addEventListener("click", () => savePaidPolicy());
  query("[data-schedule-save]").addEventListener("click", () => saveScoutingSchedule());
  query("[data-directed-check]").addEventListener("click", () => checkDirectedMint());
  query("[data-directed-simulate]").addEventListener("click", () => (
    state.directedIntentId ? revalidateDirectedMintIntent() : simulateDirectedMint()
  ));
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
  query("[data-add-native]").addEventListener("click", () => query("[data-punk-fund-amount]").focus());
  query("[data-punk-fund-confirm]").addEventListener("change", renderFundingAction);
  query("[data-punk-fund-submit]").addEventListener("click", fundPunkWallet);
  query("[data-wrap-review]").addEventListener("click", reviewWrappedNative);
  for (const control of queryAll("[data-wrap-direction], [data-wrap-amount], [data-wrap-confirm]")) {
    control.addEventListener("input", () => {
      state.wrappedPlan = null;
      query("[data-wrap-review]").textContent = "Review & Simulate";
      query("[data-wrap-transaction]").hidden = true;
    });
  }
  query("[data-withdrawal-confirm]").addEventListener("change", renderWithdrawal);
  query("[data-withdrawal-quantity]").addEventListener("input", (event) => {
    state.withdrawalAmount = event.target.value;
    query("[data-withdrawal-confirm]").checked = false;
    renderWithdrawal();
  });
  query("[data-withdrawal-submit]").addEventListener("click", withdrawSelectedAsset);
  query("[data-withdrawal-cancel]").addEventListener("click", cancelWithdrawal);
  query("[data-activity-refresh]").addEventListener("click", () => loadActivity().catch(() => {}));
  for (const button of queryAll("[data-agent-send], [data-agent-pause], [data-agent-resume], [data-agent-edit], [data-agent-revoke]")) {
    button.addEventListener("click", () => {
      setText("[data-agent-action-note]", "This local build prepared the action but did not request a signature or submit a transaction. Use the existing production owner flow only after separate review.");
    });
  }
}

function localDateTimeValue(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function initializeScheduleDefaults() {
  const start = new Date(Date.now() + 5 * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  query("[data-schedule-start]").value ||= localDateTimeValue(start);
  query("[data-schedule-end]").value ||= localDateTimeValue(end);
}

function applyScoutingSchedule(schedule) {
  if (!schedule) {
    setText("[data-schedule-state]", "No window saved; this Punk uses the normal worker rotation.");
    return;
  }
  query("[data-schedule-enabled]").checked = schedule.enabled === true;
  query("[data-schedule-start]").value = localDateTimeValue(new Date(schedule.startAt));
  query("[data-schedule-end]").value = localDateTimeValue(new Date(schedule.endAt));
  setText("[data-schedule-state]", schedule.enabled
    ? `Scheduled: ${new Date(schedule.startAt).toLocaleString()} through ${new Date(schedule.endAt).toLocaleString()}. Outside this UTC-bound window, the worker skips this Punk.`
    : "Scheduled scouting is stopped for this Punk. Re-enable and save a future window to resume scheduled runs.");
}

async function loadScoutingSchedule() {
  if (!state.tokenId || demo) return;
  const response = await fetch(
    `/api/broker/scouting-schedule?tokenId=${encodeURIComponent(state.tokenId)}`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) throw new Error("Scouting schedule is temporarily unavailable");
  applyScoutingSchedule(payload.schedule);
}

async function saveScoutingSchedule() {
  try {
    if (!state.owned || !state.provider || !state.walletAccount) {
      throw new Error("Connect the current Punk holder on Robinhood Chain first");
    }
    const start = new Date(query("[data-schedule-start]").value);
    const end = new Date(query("[data-schedule-end]").value);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error("Choose both dates");
    const schedule = { schema: "GOGH_SCOUTING_SCHEDULE_V1", tokenId: state.tokenId,
      startAt: start.toISOString(), endAt: end.toISOString(), timezone: "UTC",
      enabled: query("[data-schedule-enabled]").checked };
    if (demo) {
      const { schema: _schema, ...localSchedule } = schedule;
      const payload = await localApi("/api/local-v2/schedule", { body: localSchedule });
      applyScoutingSchedule(payload.schedule);
      return;
    }
    const expectedAccount = state.walletAccount;
    const expectedTokenId = state.tokenId;
    setText("[data-schedule-state]", "Preparing a free owner signature for this exact UTC window…");
    const preparedResponse = await fetch("/api/broker/scouting-schedule", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ action: "prepare", walletAddress: expectedAccount, schedule }),
    });
    const prepared = await preparedResponse.json().catch(() => null);
    if (!preparedResponse.ok || prepared?.ok !== true) {
      throw new Error(prepared?.message ?? "The schedule could not be prepared");
    }
    const signature = await state.provider.request({ method: "personal_sign",
      params: [prepared.message, expectedAccount] });
    const [accounts, chainRaw] = await Promise.all([
      state.provider.request({ method: "eth_accounts" }),
      state.provider.request({ method: "eth_chainId" }),
    ]);
    if (!Array.isArray(accounts) || accounts[0]?.toLowerCase() !== expectedAccount
      || Number.parseInt(chainRaw, 16) !== CHAIN_ID || state.tokenId !== expectedTokenId) {
      throw new Error("Wallet account, network, or selected Punk changed before saving");
    }
    const completeResponse = await fetch("/api/broker/scouting-schedule", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ action: "complete", challengeId: prepared.challengeId,
        walletAddress: expectedAccount, signature }),
    });
    const completed = await completeResponse.json().catch(() => null);
    if (!completeResponse.ok || completed?.ok !== true) {
      throw new Error(completed?.message ?? "The schedule could not be saved");
    }
    applyScoutingSchedule(completed.schedule);
  } catch (error) {
    setText("[data-schedule-state]", `${error.message}. No schedule was saved.`);
  }
}

async function applyWallet(wallet) {
  const revision = ++state.revision;
  state.walletAccount = wallet?.account?.toLowerCase?.() ?? null;
  state.walletChainId = wallet?.chainId ?? null;
  state.walletRestoring = wallet?.restoring === true || wallet?.status === "pending";
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
  state.fundingBusy = false;
  state.activationBusy = false;
  state.activationMessage = null;
  state.wrappedBusy = false;
  state.wrappedPlan = null;
  state.automation = null;
  state.assets = [];
  state.withdrawalAsset = null;
  state.withdrawalAmount = "1";
  state.withdrawalBusy = false;
  state.directedIntentId = null;
  renderWithdrawal();
  renderIdentity();
  renderPaidPolicy(readPaidPolicy());
  if (!state.tokenId || !wallet?.account || wallet.chainId !== CHAIN_ID || !state.provider) return;
  state.walletRestoring = false;
  state.loading = true;
  renderIdentity();
  try {
    // Ownership and public agent status are independent reads. Start them together so the
    // Control Center does not serialize two network round trips. Authority still depends only
    // on the live ownerOf result below.
    await Promise.all([loadOwnership(wallet), loadAutomation()]);
    if (revision !== state.revision) return;
    state.loading = false;
    // Automation and live ownership are intentionally fetched in parallel. The automation
    // response can finish before ownerOf, so its first render may not yet have enough authority
    // evidence to call the agent active. Recompute after both reads settle to avoid leaving a
    // genuinely active Punk mislabeled as PAUSED solely because of response ordering.
    renderAutomation();
    if (!state.owned) return;
    await Promise.all([loadBalance(), loadWrappedBalance(), loadScoutingSchedule()]).catch(() => {});
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
initializeScheduleDefaults();
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
  window.setInterval(() => {
    if (document.visibilityState === "visible" && state.owned) {
      void loadActivity().catch(() => {});
    }
  }, 20_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.owned) {
      void loadActivity().catch(() => {});
    }
  });
}
