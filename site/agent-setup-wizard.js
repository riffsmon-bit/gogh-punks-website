import { confirmedMintHash, showConfirmedMintToast } from "./agent-live-ui.js";

const STORAGE_KEY = "gogh.artBroker.setup.v1";
const STEP_ORDER = Object.freeze([
  "choose", "wallet", "limits", "activate", "power", "success",
]);
const VALID_STEPS = new Set(STEP_ORDER);
const SETUP_STEPS = new Set(["wallet", "limits", "activate"]);
const LIVE_STEPS = new Set(["power", "success"]);
const MIN_CAP = 1;
const MAX_CAP = 10;
const MIN_DAYS = 1;
const MAX_DAYS = 30;

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number : fallback;
}

export function safeWizardState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selectedPunk = typeof value.selectedPunk === "string"
    && /^(0|[1-9]\d{0,3})$/.test(value.selectedPunk) ? value.selectedPunk : null;
  const step = VALID_STEPS.has(value.step) ? value.step : "choose";
  const dailyLimit = boundedInteger(value.dailyLimit, MIN_CAP, MAX_CAP, 3);
  const durationDays = boundedInteger(value.durationDays, MIN_DAYS, MAX_DAYS, 7);
  return Object.freeze({ selectedPunk, step, dailyLimit, durationDays });
}

export function wizardResumeStep({ selectedPunk, automation, hostedGasReady = false }) {
  if (!selectedPunk) return "choose";
  if (!automation || automation.tokenId !== selectedPunk) return "wallet";
  if (!automation.active) return "limits";
  // Hosted gas is a shared operational pool. A holder may contribute, but an otherwise-live
  // Punk must never be sent back through setup or blocked because that holder did not fund it.
  return automation.agentLive ? "success" : "power";
}

export function wizardStepIndex(step) {
  const index = STEP_ORDER.indexOf(step);
  return index === -1 ? 0 : index;
}

// Resuming may only carry an owner forward past setup an agent has already completed. It must
// never pull someone backwards out of a screen they deliberately walked to.
export function forwardOnlyWizardStep(currentStep, resumedStep) {
  return wizardStepIndex(resumedStep) > wizardStepIndex(currentStep) ? resumedStep : currentStep;
}

export function agentRosterPunks(punks) {
  if (!Array.isArray(punks)) return Object.freeze([]);
  return Object.freeze(punks.filter((punk) => punk && typeof punk === "object"
    && (Object.hasOwn(punk, "activated") && punk.activated === true
      || Object.hasOwn(punk, "automationConfigured") && punk.automationConfigured === true
      || Object.hasOwn(punk, "automationCreated") && punk.automationCreated === true
      || punk.agentSummary?.configured === true || punk.agentSummary?.enrolled === true)));
}

export function agentCardPresentation(punk, live = null) {
  const summary = punk?.agentSummary ?? null;
  const labels = Object.freeze({
    ACTIVE: "Active · worker verified",
    SCANNING: "Scanning now",
    MINTING: "Minting now",
    QUEUED: "Queued for worker",
    WAITING_FOR_FIRST_SCAN: "Enrolled · waiting for first scan",
    NEEDS_ENROLLMENT: "Needs enrollment repair",
    NEEDS_AUTHORIZATION: "Needs authorization",
    PAUSED: "Paused",
    AUTOMATION_OFFLINE: "Automation offline",
    AWAITING_WORKER_EVIDENCE: "Awaiting worker evidence",
    RETRY_SCHEDULED: "Safe retry scheduled",
    NEEDS_ATTENTION: "Needs attention",
    READY: "Ready to activate",
  });
  if (live?.active === true) {
    const status = live.agentLive === true ? "ACTIVE"
      : summary?.status && labels[summary.status] ? summary.status : "AWAITING_WORKER_EVIDENCE";
    return Object.freeze({
      status,
      label: live.agentLive === true
        ? "Active · live authority verified" : "Authorized · worker not verified",
      authorization: "Active",
      today: Number.isInteger(live.cap) && Number.isInteger(live.acquisitionsToday)
        ? `${live.acquisitionsToday} / ${live.cap}` : "Live",
      lastWorkerCheck: live.heartbeat?.completedAt ?? summary?.lastActualScan ?? null,
    });
  }
  if (live && live.active !== true) {
    return Object.freeze({ status: "NEEDS_AUTHORIZATION", label: labels.NEEDS_AUTHORIZATION,
      authorization: "Needs setup", today: "—",
      lastWorkerCheck: summary?.lastActualScan ?? null });
  }
  const status = labels[summary?.status] ? summary.status
    : summary?.enrolled ? "WAITING_FOR_FIRST_SCAN"
      : summary?.configured ? "NEEDS_ENROLLMENT"
        : punk?.automationCreated ? "READY" : "READY";
  const workerVerified = ["ACTIVE", "SCANNING", "MINTING"].includes(status);
  return Object.freeze({
    status,
    label: labels[status],
    authorization: workerVerified ? "Verified at last scan"
      : status === "NEEDS_ENROLLMENT" ? "Configured; not enrolled"
        : status === "QUEUED" || status === "WAITING_FOR_FIRST_SCAN"
          || status === "RETRY_SCHEDULED"
          ? "Enrollment recorded" : "Open agent to verify",
    today: "Open agent for live usage",
    lastWorkerCheck: summary?.lastActualScan ?? summary?.updatedAt ?? null,
  });
}

export function agentRotationCountdown(value, nowMs = Date.now()) {
  const target = Date.parse(value ?? "");
  if (!Number.isFinite(target) || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    return "Waiting for first assignment";
  }
  const remaining = target - nowMs;
  if (remaining <= 0) return "Due in fair rotation";
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `~${hours}h ${rest}m` : `~${minutes}m`;
}

function humanWorkerReason(reason) {
  const messages = Object.freeze({
    NO_ELIGIBLE_TARGETS: "No mint passed every check",
    NO_ACTIVE_CANDIDATES: "No active mint candidates",
    WAITING_FOR_WORKER_CAPACITY: "Waiting in the worker rotation",
    MINT_CONFIRMED: "Mint confirmed",
    ELIGIBLE_SIMULATION_PASSED: "Candidate simulation passed",
    PROFILE_STATE_READ_FAILED: "Live state check failed safely",
    PROVIDER_OWNER_DISAGREEMENT: "Ownership providers disagreed",
    ACCOUNT_NOT_CREATED: "Punk wallet is not created",
  });
  return messages[reason] ?? (reason ? "Scan stopped safely" : "Waiting for first scan");
}

function readState(storage) {
  try { return safeWizardState(JSON.parse(storage?.getItem?.(STORAGE_KEY) ?? "null")); } catch { return null; }
}

function writeState(storage, state) {
  try {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify({
      selectedPunk: state.selectedPunk,
      step: state.step,
      dailyLimit: state.dailyLimit,
      durationDays: state.durationDays,
    }));
  } catch {
    // Wizard persistence is a convenience and never authorization evidence.
  }
}

function trustedImage(value) {
  return typeof value === "string" && (value.startsWith("data:image/")
    || value.startsWith("https://i.seadn.io/") || value.startsWith("https://raw2.seadn.io/"))
    ? value : null;
}

function short(value) {
  return /^0x[0-9a-f]{40}$/.test(value ?? "")
    ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Preparing…";
}

export function setupAgentWizard({ windowObject, documentObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? globalThis.window;
  const browserDocument = documentObject ?? globalThis.document;
  const root = browserDocument?.querySelector?.("[data-agent-wizard]");
  if (!root || !browserWindow) return null;
  const request = fetchFunction ?? browserWindow.fetch?.bind(browserWindow);
  const screens = [...root.querySelectorAll("[data-wizard-step]")];
  const progress = [...root.querySelectorAll("[data-wizard-progress]")];
  const punkPicker = root.querySelector("[data-wizard-punks]");
  const punkSearch = root.querySelector("[data-wizard-punk-search]");
  const punkResults = root.querySelector("[data-wizard-punk-results]");
  const punkCount = root.querySelector("[data-wizard-punk-count]");
  const empty = root.querySelector("[data-wizard-empty]");
  const selectedImages = [...root.querySelectorAll("[data-wizard-punk-image]")];
  const selectedLabels = [...root.querySelectorAll("[data-wizard-punk-label]")];
  const accountLabels = [...root.querySelectorAll("[data-wizard-punk-wallet]")];
  const summaryCap = [...root.querySelectorAll("[data-wizard-summary-cap]")];
  const summaryDays = [...root.querySelectorAll("[data-wizard-summary-days]")];
  const stateText = root.querySelector("[data-wizard-state]");
  const activate = root.querySelector("[data-wizard-activate]");
  const retirement = root.querySelector("[data-wizard-retirement]");
  const fund = root.querySelector("[data-wizard-fund]");
  const send = root.querySelector("[data-wizard-send]");
  const gasStatus = root.querySelector("[data-wizard-gas-status]");
  const transactionLink = root.querySelector("[data-wizard-transaction]");
  const customCap = root.querySelector("[data-wizard-custom-cap]");
  const customDays = root.querySelector("[data-wizard-custom-days]");
  const gasAmount = root.querySelector("[data-wizard-gas-amount]");
  const agentGrid = browserDocument.querySelector("[data-active-agent-grid]");
  const agentEmpty = browserDocument.querySelector("[data-active-agent-empty]");
  const agentHealth = browserDocument.querySelector("[data-agent-health-summary]");
  const stored = readState(browserWindow.localStorage);
  const state = {
    wallet: browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null,
    punks: browserWindow.__GOGH_OWNER_PUNKS__?.punks ?? [],
    automation: browserWindow.__GOGH_AUTOMATION_SNAPSHOT__ ?? null,
    selectedPunk: stored?.selectedPunk ?? null,
    step: stored?.step ?? "choose",
    dailyLimit: stored?.dailyLimit ?? 3,
    durationDays: stored?.durationDays ?? 7,
    restarting: new Set(),
    observedMintHashes: new Map(),
  };

  function selected() {
    return state.punks.find((item) => item.tokenId === state.selectedPunk) ?? null;
  }

  // The automation snapshot only ever describes one Punk, so it is evidence about the current
  // selection exactly when the token ids agree.
  function selectedAutomation() {
    return state.automation?.tokenId === state.selectedPunk ? state.automation : null;
  }

  function alreadyActive() {
    return selectedAutomation()?.active === true;
  }

  function resume() {
    const automation = selectedAutomation();
    const resumed = wizardResumeStep({
      selectedPunk: state.selectedPunk,
      automation,
      hostedGasReady: automation?.hostedGas?.ready === true,
    });
    // Only setup an agent has already finished may move someone on its own. The picker and the
    // setup screens stay under the owner's control.
    if (LIVE_STEPS.has(resumed)) showStep(forwardOnlyWizardStep(state.step, resumed));
  }

  function selectUnderlyingPunk() {
    if (!state.selectedPunk) return;
    browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:select-punk-request", {
      detail: Object.freeze({ tokenId: state.selectedPunk }),
    }));
  }

  function showStep(step) {
    state.step = VALID_STEPS.has(step) ? step : "choose";
    for (const screen of screens) screen.hidden = screen.dataset.wizardStep !== state.step;
    const stepIndex = wizardStepIndex(state.step);
    for (const item of progress) {
      const index = Number(item.dataset.wizardProgress);
      item.classList.toggle("current", index === Math.min(stepIndex + 1, 5));
      item.classList.toggle("complete", index < stepIndex + 1);
    }
    writeState(browserWindow.localStorage, state);
  }

  function renderPunks() {
    const placeholder = browserDocument.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.punks.length
      ? "Choose a Gogh Punk"
      : "No wallet-owned Punks found";
    punkPicker.replaceChildren(placeholder, ...state.punks.map((punk) => {
      const option = browserDocument.createElement("option");
      option.value = punk.tokenId;
      const sameAutomation = state.automation?.tokenId === punk.tokenId;
      const status = sameAutomation && state.automation.agentLive ? "active"
        : sameAutomation && state.automation.active ? "authorized"
          : punk.activated ? "wallet active" : "ready to activate";
      option.textContent = `Punk #${punk.tokenId} · ${status}`;
      return option;
    }));
    punkPicker.disabled = state.punks.length === 0;
    if (state.punks.some(({ tokenId }) => tokenId === state.selectedPunk)) {
      punkPicker.value = state.selectedPunk;
    }
    if (punkSearch) punkSearch.disabled = state.punks.length === 0;
    if (punkResults) {
      const query = String(punkSearch?.value ?? "").trim().replace(/^#/, "");
      const matches = state.punks.filter(({ tokenId }) => !query || String(tokenId).includes(query));
      const visible = matches.slice(0, 24);
      punkResults.replaceChildren(...visible.map((punk) => {
        const button = browserDocument.createElement("button");
        button.type = "button";
        button.dataset.tokenId = punk.tokenId;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", punk.tokenId === state.selectedPunk ? "true" : "false");
        const imageUrl = trustedImage(punk.artwork?.imageUrl);
        if (imageUrl) {
          const image = browserDocument.createElement("img");
          image.src = imageUrl;
          image.alt = "";
          image.loading = "lazy";
          button.append(image);
        }
        const label = browserDocument.createElement("span");
        label.textContent = `Punk #${punk.tokenId}`;
        const live = state.automation?.tokenId === punk.tokenId ? state.automation : null;
        const detail = browserDocument.createElement("small");
        detail.textContent = live?.agentLive ? "Agent live" : live?.active
          ? "Authorized" : punk.activated ? "Wallet active" : "Ready to activate";
        button.append(label, detail);
        button.addEventListener("click", () => {
          punkPicker.value = punk.tokenId;
          punkPicker.dispatchEvent(new browserWindow.Event("change", { bubbles: true }));
        });
        return button;
      }));
      punkResults.hidden = visible.length === 0;
      if (punkCount) punkCount.textContent = !state.punks.length
        ? "No wallet-owned Punks found."
        : query
          ? `${matches.length} matching Punk${matches.length === 1 ? "" : "s"}.`
          : `${state.punks.length} wallet-owned Punks loaded. Showing ${visible.length}; search by number to narrow the list.`;
    }
    empty.hidden = state.punks.length > 0 || !state.wallet?.account;
  }

  punkPicker.addEventListener("change", () => {
    const tokenId = String(punkPicker.value ?? "");
    if (!state.punks.some((punk) => punk.tokenId === tokenId)) return;
    state.selectedPunk = tokenId;
    selectUnderlyingPunk();
    showStep(alreadyActive() ? "power" : "wallet");
    render();
  });
  punkSearch?.addEventListener("input", renderPunks);

  function openAgent(tokenId) {
    state.selectedPunk = tokenId;
    selectUnderlyingPunk();
    render();
    try {
      const url = new URL(browserWindow.location?.href ?? "/broker/", "https://goghpunks.xyz");
      url.pathname = "/broker/";
      url.searchParams.set("punk", tokenId);
      url.hash = "automation-title";
      browserWindow.history?.replaceState?.({}, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // URL decoration is a navigation convenience and never authorization evidence.
    }
    browserDocument.querySelector("[data-advanced-workspace]")?.setAttribute("open", "");
    browserDocument.querySelector("#automation-title")?.setAttribute("open", "");
    browserDocument.querySelector("#automation-title")?.scrollIntoView({ behavior: "smooth" });
  }

  async function restartAgent(tokenId, button, status) {
    if (!request || state.restarting.has(tokenId)) return;
    state.restarting.add(tokenId);
    button.disabled = true;
    button.textContent = "Restarting…";
    status.textContent = "Re-enrolling and requesting a scan…";
    try {
      const response = await request("/api/broker/autonomy-v3-run", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ tokenId }),
        cache: "no-store",
      });
      const payload = await response.json();
      if ((!response.ok && response.status !== 202) || payload?.ok !== true) {
        throw new Error(payload?.message ?? "The agent could not be restarted safely.");
      }
      status.textContent = payload.run?.status === "MINT_CONFIRMED"
        ? "Mint confirmed"
        : payload.run?.status === "RUN_IN_PROGRESS"
          ? "Queued · worker is finishing another scan"
          : "Restarted · scan completed safely";
      selectUnderlyingPunk();
    } catch (error) {
      status.textContent = error?.message ?? "Restart stopped safely. No transaction was sent.";
    } finally {
      state.restarting.delete(tokenId);
      button.disabled = false;
      button.textContent = "Restart agent";
    }
  }

  function formatExpiry(value) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) && seconds > 0
      ? new Date(seconds * 1_000).toLocaleString() : "Select to check";
  }

  function renderActiveAgents() {
    if (!agentGrid || !agentEmpty) return;
    const activeWallets = agentRosterPunks(state.punks);
    const presentations = activeWallets.map((punk) => agentCardPresentation(
      punk, state.automation?.tokenId === punk.tokenId ? state.automation : null,
    ));
    if (agentHealth) {
      const counts = presentations.reduce((output, item, index) => {
        if (activeWallets[index]?.agentSummary?.enrolled === true) output.enrolled += 1;
        if (["ACTIVE", "SCANNING", "MINTING"].includes(item.status)) output.active += 1;
        if (item.status === "SCANNING") output.scanning += 1;
        if (item.status === "MINTING") output.minting += 1;
        if (["NEEDS_ENROLLMENT", "NEEDS_AUTHORIZATION", "NEEDS_ATTENTION",
          "AUTOMATION_OFFLINE"].includes(item.status)) output.attention += 1;
        if (item.status === "AUTOMATION_OFFLINE") output.workerOnline = false;
        if (activeWallets[index]?.agentSummary?.lastActualScan) output.workerEvidence = true;
        return output;
      }, { enrolled: 0, active: 0, scanning: 0, minting: 0, attention: 0,
        workerOnline: true, workerEvidence: false });
      const globalHeartbeat = state.automation?.heartbeat ?? null;
      const globalWorkerOnline = state.automation?.workerOnline === true
        || globalHeartbeat?.online === true;
      const latestWorkerResult = globalHeartbeat?.status === "MINT_CONFIRMED"
        ? `Mint · Punk #${globalHeartbeat.tokenId ?? "?"}`
        : globalHeartbeat?.status === "RUN_IN_PROGRESS" ? "Processing" : "Online";
      const values = [
        ["Enrolled", counts.enrolled], ["Per-Punk verified", counts.workerEvidence ? counts.active : "—"],
        ["Scanning", counts.scanning], ["Minting", counts.minting],
        ["Needs attention", counts.attention],
        ["Production worker", !activeWallets.length ? "—" : globalWorkerOnline
          ? latestWorkerResult : !counts.workerOnline ? "Degraded" : "Pending evidence"],
      ];
      agentHealth.replaceChildren(...values.map(([label, value]) => {
        const item = browserDocument.createElement("span");
        const strong = browserDocument.createElement("strong");
        const small = browserDocument.createElement("small");
        strong.textContent = String(value);
        small.textContent = label;
        item.append(strong, small);
        return item;
      }));
    }
    agentGrid.replaceChildren();
    agentEmpty.hidden = activeWallets.length > 0;
    agentEmpty.textContent = state.wallet?.account
      ? "No activated Punk wallets were found for this address."
      : "Connect your wallet to see active Punk agents.";
    for (const punk of activeWallets) {
      const live = state.automation?.tokenId === punk.tokenId ? state.automation : null;
      const card = browserDocument.createElement("article");
      card.className = "active-agent-card";
      const imageUrl = trustedImage(punk.artwork?.imageUrl);
      const visual = browserDocument.createElement(imageUrl ? "img" : "span");
      if (imageUrl) {
        visual.src = imageUrl;
        visual.alt = punk.artwork?.name ?? `Gogh Punk #${punk.tokenId}`;
        visual.loading = "lazy";
      } else {
        visual.className = "agent-card-placeholder";
        visual.textContent = `#${punk.tokenId}`;
      }
      const body = browserDocument.createElement("div");
      const title = browserDocument.createElement("h3");
      title.textContent = `Punk #${punk.tokenId}`;
      const presentation = agentCardPresentation(punk, live);
      card.dataset.agentState = presentation.status;
      const status = browserDocument.createElement("strong");
      status.className = "agent-card-state";
      status.textContent = presentation.label;
      status.dataset.agentState = presentation.status;
      const mintHash = confirmedMintHash(punk.agentSummary);
      if (!state.observedMintHashes.has(punk.tokenId)) {
        state.observedMintHashes.set(punk.tokenId, mintHash);
      } else if (mintHash && state.observedMintHashes.get(punk.tokenId) !== mintHash) {
        state.observedMintHashes.set(punk.tokenId, mintHash);
        showConfirmedMintToast({ documentObject: browserDocument,
          tokenId: punk.tokenId, transactionHash: mintHash });
      }
      const facts = browserDocument.createElement("dl");
      // Only an authorized agent has an on-chain cap and expiry to report. Anything else keeps
      // the placeholder rather than dressing a local default up as chain state.
      const entries = [
        ["Punk wallet", short(punk.account)],
        ["Today", presentation.today],
        ["Authorization", live?.active === true
          ? formatExpiry(live.authorizationValidUntil) : presentation.authorization],
        ["Last worker check", presentation.lastWorkerCheck
          ? new Date(presentation.lastWorkerCheck).toLocaleString() : "Waiting for first scan"],
        ["Next worker turn", agentRotationCountdown(punk.agentSummary?.nextScanEstimate)],
        ["Last result", humanWorkerReason(punk.agentSummary?.reason)],
      ];
      for (const [term, description] of entries) {
        const dt = browserDocument.createElement("dt");
        const dd = browserDocument.createElement("dd");
        dt.textContent = term;
        dd.textContent = description;
        if (term === "Next worker turn") {
          dd.dataset.agentNextScan = punk.agentSummary?.nextScanEstimate ?? "";
          dd.title = punk.agentSummary?.nextScanEstimate
            ? `Advisory estimate: ${new Date(punk.agentSummary.nextScanEstimate).toLocaleString()}`
            : "A turn will be assigned by the fair production rotation.";
        }
        facts.append(dt, dd);
      }
      body.append(title, status, facts);
      const actions = browserDocument.createElement("div");
      actions.className = "active-agent-actions";
      const watch = browserDocument.createElement("a");
      watch.href = `/broker/?punk=${encodeURIComponent(punk.tokenId)}#automation-title`;
      watch.textContent = "Watch agent";
      watch.addEventListener("click", (event) => {
        event?.preventDefault?.();
        openAgent(punk.tokenId);
      });
      const wallet = browserDocument.createElement("a");
      wallet.href = `/broker/punk/${encodeURIComponent(punk.tokenId)}#assets`;
      wallet.textContent = "Open wallet";
      const restart = browserDocument.createElement("button");
      restart.type = "button";
      restart.textContent = "Restart agent";
      restart.disabled = punk.serverVerifiedReadOnly === true
        || punk.ownershipMode === "SERVER_VERIFIED_READ_ONLY";
      if (restart.disabled) restart.title = "Robinhood wallet access is required to change this agent.";
      restart.addEventListener("click", () => restartAgent(punk.tokenId, restart, status));
      actions.append(watch, wallet, restart);
      card.append(visual, body, actions);
      agentGrid.append(card);
    }
  }

  function updateRotationTimers() {
    if (browserDocument.visibilityState === "hidden") return;
    browserDocument.querySelectorAll?.("[data-agent-next-scan]").forEach((item) => {
      item.textContent = agentRotationCountdown(item.dataset.agentNextScan);
    });
  }

  browserWindow.setInterval?.(updateRotationTimers, 30_000);

  function render() {
    if (!state.wallet?.account) {
      state.selectedPunk = null;
      showStep("choose");
    }
    renderPunks();
    renderActiveAgents();
    const punk = selected();
    for (const label of selectedLabels) label.textContent = punk ? `Punk #${punk.tokenId}` : "Choose a Punk";
    for (const image of selectedImages) {
      const imageUrl = trustedImage(punk?.artwork?.imageUrl);
      image.hidden = !imageUrl;
      if (imageUrl) {
        image.src = imageUrl;
        image.alt = punk.artwork?.name ?? `Gogh Punk #${punk.tokenId}`;
      }
    }
    const account = state.automation?.tokenId === state.selectedPunk
      ? state.automation.account : null;
    for (const label of accountLabels) {
      label.textContent = short(account);
      label.title = account ?? "";
    }
    for (const label of summaryCap) label.textContent = `${state.dailyLimit} per day`;
    for (const label of summaryDays) label.textContent = state.durationDays === 1
      ? "24 hours" : `${state.durationDays} days`;
    root.querySelectorAll("[data-wizard-cap]").forEach((button) => {
      button.classList.toggle("selected", Number(button.dataset.wizardCap) === state.dailyLimit);
    });
    root.querySelectorAll("[data-wizard-days]").forEach((button) => {
      button.classList.toggle("selected", Number(button.dataset.wizardDays) === state.durationDays);
    });
    if (customCap) customCap.value = String(state.dailyLimit);
    if (customDays) customDays.value = String(state.durationDays);
    const automation = selectedAutomation();
    const active = automation?.active === true;
    const readOnly = punk?.serverVerifiedReadOnly === true
      || punk?.ownershipMode === "SERVER_VERIFIED_READ_ONLY";
    const hostedGasReady = automation?.hostedGas?.ready === true;
    gasStatus.textContent = hostedGasReady
      ? "Ready — no payment required ✓" : "No payment required to launch";
    fund.hidden = false;
    fund.disabled = readOnly;
    send.disabled = readOnly || !active || automation?.version !== 3
      || automation?.running === true;
    send.textContent = automation?.running === true ? "Sending agent…" : "Send Agent";
    activate.disabled = readOnly || !state.selectedPunk || active || retirement.checked !== true
      || Boolean(automation?.setupSubmission);
    activate.textContent = active ? "Agent already active" : "Activate Agent";
    retirement.disabled = active || readOnly;
    if (readOnly) {
      stateText.textContent = "Ownership is server-verified in read-only mode. Use a wallet provider that supports Robinhood Chain to activate or change this Punk.";
    } else if (automation?.setupSubmission) {
      stateText.textContent = automation.lastTransactionHash
        ? `Confirming setup ${automation.setupSubmission.index} of ${automation.setupSubmission.total}…`
        : "Waiting for wallet…";
    } else if (automation?.lastActionError) {
      stateText.textContent = automation.lastActionError;
    } else if (active) {
      stateText.textContent = "Agent activated ✓";
    } else {
      stateText.textContent = "Your wallet will show each required setup transaction here.";
    }
    // Kept out of the message chain above: a recorded error must still be readable, but it must
    // never strand an already-authorized agent on a setup screen.
    if (active && !automation.setupSubmission && SETUP_STEPS.has(state.step)) showStep("power");
    const hash = automation?.lastTransactionHash;
    transactionLink.hidden = !/^0x[0-9a-fA-F]{64}$/.test(hash ?? "");
    if (!transactionLink.hidden) transactionLink.href = `https://robinhoodchain.blockscout.com/tx/${hash}`;
    writeState(browserWindow.localStorage, state);
  }

  function selectedIsReadOnly() {
    const punk = selected();
    return punk?.serverVerifiedReadOnly === true
      || punk?.ownershipMode === "SERVER_VERIFIED_READ_ONLY";
  }

  root.querySelectorAll("[data-wizard-next]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.wizardNext;
      // An authorized agent must never be walked back through any setup screen, no matter how
      // late the live snapshot arrives relative to the owner tapping Continue.
      if (alreadyActive() && SETUP_STEPS.has(next)) showStep("power");
      else showStep(next);
      render();
    });
  });
  root.querySelectorAll("[data-wizard-back]").forEach((button) => {
    button.addEventListener("click", () => { showStep(button.dataset.wizardBack); render(); });
  });
  root.querySelectorAll("[data-wizard-cap]").forEach((button) => {
    button.addEventListener("click", () => { state.dailyLimit = Number(button.dataset.wizardCap); render(); });
  });
  root.querySelectorAll("[data-wizard-days]").forEach((button) => {
    button.addEventListener("click", () => { state.durationDays = Number(button.dataset.wizardDays); render(); });
  });
  root.querySelector("[data-wizard-custom-cap-toggle]")?.addEventListener("click", () => {
    customCap.hidden = false;
    customCap.focus();
  });
  root.querySelector("[data-wizard-custom-days-toggle]")?.addEventListener("click", () => {
    customDays.hidden = false;
    customDays.focus();
  });
  customCap?.addEventListener("input", () => {
    state.dailyLimit = boundedInteger(customCap.value, MIN_CAP, MAX_CAP, state.dailyLimit);
    render();
  });
  customDays?.addEventListener("input", () => {
    state.durationDays = boundedInteger(customDays.value, MIN_DAYS, MAX_DAYS, state.durationDays);
    render();
  });
  retirement.addEventListener("change", render);
  activate.addEventListener("click", () => {
    // The advanced panel disables its own retirement disclosure for an active Punk, and this
    // handler force-checks that box. Without this guard a stale button re-runs the whole
    // owner-setup batch against an agent that is already authorized.
    if (!state.selectedPunk || selectedIsReadOnly() || alreadyActive()) {
      showStep(state.selectedPunk ? "power" : "choose");
      render();
      return;
    }
    const cap = browserDocument.querySelector("[data-v2-cap]");
    const days = browserDocument.querySelector("[data-v2-days]");
    const disclosure = browserDocument.querySelector("[data-retirement-confirm]");
    if (!cap || !days || !disclosure) return;
    cap.value = String(state.dailyLimit);
    days.value = String(state.durationDays);
    cap.dataset.userEdited = "true";
    disclosure.checked = true;
    cap.dispatchEvent(new browserWindow.Event("change", { bubbles: true }));
    days.dispatchEvent(new browserWindow.Event("change", { bubbles: true }));
    disclosure.dispatchEvent(new browserWindow.Event("change", { bubbles: true }));
    stateText.textContent = "Waiting for wallet…";
    browserDocument.querySelector("[data-v2-setup]")?.click();
    render();
  });
  fund.addEventListener("click", () => {
    if (selectedIsReadOnly()) return;
    const confirm = browserDocument.querySelector("[data-v2-agent-fund-confirm]");
    const amount = browserDocument.querySelector("[data-v2-agent-fund-amount]");
    if (amount && gasAmount) {
      amount.value = gasAmount.value;
      amount.dispatchEvent(new browserWindow.Event("change", { bubbles: true }));
    }
    if (confirm) {
      confirm.checked = true;
      confirm.dispatchEvent(new browserWindow.Event("change", { bubbles: true }));
    }
    browserDocument.querySelector("[data-v2-agent-fund]")?.click();
  });
  send.addEventListener("click", () => {
    if (selectedIsReadOnly()) return;
    browserDocument.querySelector("[data-v3-run-now]")?.click();
    render();
  });
  root.querySelector("[data-wizard-watch]")?.addEventListener("click", () => {
    if (state.selectedPunk) openAgent(state.selectedPunk);
  });
  root.querySelector("[data-wizard-portfolio]")?.addEventListener("click", () => {
    browserDocument.querySelector("[data-advanced-workspace]")?.setAttribute("open", "");
    browserDocument.querySelector("#nft-portfolio-title")?.setAttribute("open", "");
    browserDocument.querySelector("#nft-portfolio-title")?.scrollIntoView({ behavior: "smooth" });
  });
  root.querySelector("[data-wizard-another]")?.addEventListener("click", () => {
    state.selectedPunk = null;
    showStep("choose");
    render();
  });
  root.querySelector("[data-wizard-exit]")?.addEventListener("click", () => {
    browserDocument.querySelector("[data-advanced-workspace]")?.setAttribute("open", "");
    browserDocument.querySelector("[data-advanced-workspace]")?.scrollIntoView({ behavior: "smooth" });
  });

  browserWindow.addEventListener("gogh:wallet-state", (event) => {
    state.wallet = event.detail;
    render();
  });
  browserWindow.addEventListener("gogh:owner-punks", (event) => {
    state.punks = Array.isArray(event.detail?.punks) ? event.detail.punks : [];
    if (state.selectedPunk && !state.punks.some((punk) => punk.tokenId === state.selectedPunk)) {
      state.selectedPunk = null;
    }
    if (!state.selectedPunk && state.punks.length === 1) state.selectedPunk = state.punks[0].tokenId;
    render();
  });
  browserWindow.addEventListener("gogh:automation-state", (event) => {
    state.automation = event.detail;
    resume();
    render();
  });
  browserWindow.addEventListener("pageshow", () => {
    const resumed = readState(browserWindow.localStorage);
    if (resumed) Object.assign(state, resumed);
    selectUnderlyingPunk();
    resume();
    render();
  });
  browserDocument.addEventListener("visibilitychange", () => {
    if (browserDocument.visibilityState === "visible") {
      selectUnderlyingPunk();
      render();
    }
  });
  showStep(state.step);
  resume();
  render();
  return Object.freeze({ render, state });
}

if (typeof window !== "undefined" && typeof document !== "undefined") setupAgentWizard();
