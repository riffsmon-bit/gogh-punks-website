const STORAGE_KEY = "gogh.artBroker.setup.v1";
const VALID_STEPS = new Set(["choose", "wallet", "limits", "activate", "power", "success"]);
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
  if (!hostedGasReady) return "power";
  return automation.agentLive ? "success" : "power";
}

export function agentRosterPunks(punks) {
  if (!Array.isArray(punks)) return Object.freeze([]);
  return Object.freeze(punks.filter((punk) => punk && typeof punk === "object"
    && (Object.hasOwn(punk, "activated") && punk.activated === true
      || Object.hasOwn(punk, "automationConfigured") && punk.automationConfigured === true)));
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

export function setupAgentWizard({ windowObject, documentObject } = {}) {
  const browserWindow = windowObject ?? globalThis.window;
  const browserDocument = documentObject ?? globalThis.document;
  const root = browserDocument?.querySelector?.("[data-agent-wizard]");
  if (!root || !browserWindow) return null;
  const screens = [...root.querySelectorAll("[data-wizard-step]")];
  const progress = [...root.querySelectorAll("[data-wizard-progress]")];
  const punkCards = root.querySelector("[data-wizard-punks]");
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
  const stored = readState(browserWindow.localStorage);
  const state = {
    wallet: browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null,
    punks: browserWindow.__GOGH_OWNER_PUNKS__?.punks ?? [],
    automation: browserWindow.__GOGH_AUTOMATION_SNAPSHOT__ ?? null,
    selectedPunk: stored?.selectedPunk ?? null,
    step: stored?.step ?? "choose",
    dailyLimit: stored?.dailyLimit ?? 3,
    durationDays: stored?.durationDays ?? 7,
  };

  function selected() {
    return state.punks.find((item) => item.tokenId === state.selectedPunk) ?? null;
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
    const stepIndex = ["choose", "wallet", "limits", "activate", "power", "success"]
      .indexOf(state.step);
    for (const item of progress) {
      const index = Number(item.dataset.wizardProgress);
      item.classList.toggle("current", index === Math.min(stepIndex + 1, 5));
      item.classList.toggle("complete", index < stepIndex + 1);
    }
    writeState(browserWindow.localStorage, state);
  }

  function renderPunks() {
    punkCards.replaceChildren();
    empty.hidden = state.punks.length > 0 || !state.wallet?.account;
    for (const punk of state.punks) {
      const button = browserDocument.createElement("button");
      button.type = "button";
      button.className = "wizard-punk-card";
      button.dataset.tokenId = punk.tokenId;
      button.setAttribute("aria-pressed", String(punk.tokenId === state.selectedPunk));
      const imageUrl = trustedImage(punk.artwork?.imageUrl);
      if (imageUrl) {
        const image = browserDocument.createElement("img");
        image.src = imageUrl;
        image.alt = punk.artwork?.name ?? `Gogh Punk #${punk.tokenId}`;
        image.loading = "lazy";
        button.append(image);
      } else {
        const placeholder = browserDocument.createElement("span");
        placeholder.className = "wizard-punk-placeholder";
        placeholder.textContent = `#${punk.tokenId}`;
        button.append(placeholder);
      }
      const title = browserDocument.createElement("strong");
      title.textContent = `Punk #${punk.tokenId}`;
      const status = browserDocument.createElement("small");
      const sameAutomation = state.automation?.tokenId === punk.tokenId;
      status.textContent = sameAutomation && state.automation.agentLive ? "Active"
        : sameAutomation && state.automation.active ? "Paused or reconnecting"
          : punk.activated ? "Ready to configure" : "Ready to activate";
      button.append(title, status);
      button.addEventListener("click", () => {
        state.selectedPunk = punk.tokenId;
        selectUnderlyingPunk();
        showStep("wallet");
        render();
      });
      punkCards.append(button);
    }
  }

  function openAgent(tokenId) {
    state.selectedPunk = tokenId;
    selectUnderlyingPunk();
    render();
    browserDocument.querySelector("[data-advanced-workspace]")?.setAttribute("open", "");
    browserDocument.querySelector("#automation-title")?.setAttribute("open", "");
    browserDocument.querySelector("#automation-title")?.scrollIntoView({ behavior: "smooth" });
  }

  function formatExpiry(value) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) && seconds > 0
      ? new Date(seconds * 1_000).toLocaleString() : "Select to check";
  }

  function renderActiveAgents() {
    if (!agentGrid || !agentEmpty) return;
    const activeWallets = agentRosterPunks(state.punks);
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
      const status = browserDocument.createElement("strong");
      status.className = "agent-card-state";
      status.textContent = live?.agentLive ? "Active · scanning"
        : live?.active ? "Authorized · worker unavailable"
          : live ? "Wallet active · setup needed" : "Select to check live agent";
      if (!live && punk.automationConfigured) {
        status.textContent = "Configured · select to verify live";
      }
      const facts = browserDocument.createElement("dl");
      const entries = [
        ["Punk wallet", short(punk.account)],
        ["Today", live ? `${live.acquisitionsToday} / ${live.cap}` : "Select to check"],
        ["Authorization", live ? formatExpiry(live.authorizationValidUntil) : "Select to check"],
        ["Last worker check", live?.heartbeat?.completedAt
          ? new Date(live.heartbeat.completedAt).toLocaleString() : "Select to check"],
      ];
      for (const [term, description] of entries) {
        const dt = browserDocument.createElement("dt");
        const dd = browserDocument.createElement("dd");
        dt.textContent = term;
        dd.textContent = description;
        facts.append(dt, dd);
      }
      body.append(title, status, facts);
      const actions = browserDocument.createElement("div");
      actions.className = "active-agent-actions";
      const watch = browserDocument.createElement("button");
      watch.type = "button";
      watch.textContent = "Watch agent";
      watch.addEventListener("click", () => openAgent(punk.tokenId));
      const portfolio = browserDocument.createElement("a");
      portfolio.href = `/punk/${encodeURIComponent(punk.tokenId)}`;
      portfolio.textContent = "View portfolio";
      actions.append(watch, portfolio);
      card.append(visual, body, actions);
      agentGrid.append(card);
    }
  }

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
    const automation = state.automation?.tokenId === state.selectedPunk ? state.automation : null;
    const hostedGasReady = automation?.hostedGas?.ready === true;
    gasStatus.textContent = hostedGasReady ? "Ready ✓" : "Funding needed";
    fund.hidden = hostedGasReady;
    send.disabled = !automation?.active || !hostedGasReady || !automation?.agentLive;
    activate.disabled = !state.selectedPunk || retirement.checked !== true
      || Boolean(automation?.setupSubmission);
    if (automation?.setupSubmission) {
      stateText.textContent = automation.lastTransactionHash
        ? `Confirming setup ${automation.setupSubmission.index} of ${automation.setupSubmission.total}…`
        : "Waiting for wallet…";
    } else if (automation?.lastActionError) {
      stateText.textContent = automation.lastActionError;
    } else if (automation?.active) {
      stateText.textContent = "Agent activated ✓";
      if (["activate", "limits", "wallet"].includes(state.step)) showStep("power");
    } else {
      stateText.textContent = "Your wallet will show each required setup transaction here.";
    }
    const hash = automation?.lastTransactionHash;
    transactionLink.hidden = !/^0x[0-9a-fA-F]{64}$/.test(hash ?? "");
    if (!transactionLink.hidden) transactionLink.href = `https://robinhoodchain.blockscout.com/tx/${hash}`;
    writeState(browserWindow.localStorage, state);
  }

  root.querySelectorAll("[data-wizard-next]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.wizardNext;
      if (next === "limits" && state.automation?.tokenId === state.selectedPunk
        && state.automation.active) showStep("power");
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
    browserDocument.querySelector("[data-v3-run-now]")?.click();
    showStep("success");
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
    render();
  });
  browserWindow.addEventListener("pageshow", () => {
    const resumed = readState(browserWindow.localStorage);
    if (resumed) Object.assign(state, resumed);
    selectUnderlyingPunk();
    render();
  });
  browserDocument.addEventListener("visibilitychange", () => {
    if (browserDocument.visibilityState === "visible") {
      selectUnderlyingPunk();
      render();
    }
  });
  showStep(state.step);
  render();
  return Object.freeze({ render, state });
}

if (typeof window !== "undefined" && typeof document !== "undefined") setupAgentWizard();
