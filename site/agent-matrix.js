const MAX_EVENTS = 100;
const REFRESH_INTERVAL_MS = 15_000;
const PREVIEW_REFRESH_INTERVAL_MS = 60_000;
const STATE_LEVEL = Object.freeze({
  MINTED: "success", READY: "success", ERROR: "error", PAUSED: "warning",
  SKIPPED: "warning", IDLE: "info", QUEUED: "info", SCANNING: "info",
  CANDIDATE_FOUND: "info", VERIFYING_CONTRACT: "info", CHECKING_PRICE: "info",
  CHECKING_ELIGIBILITY: "info", CHECKING_LIMITS: "info", SIMULATING: "info",
  SUBMITTING: "info", CONFIRMING: "info",
});

const STATE_CODE = Object.freeze({
  IDLE: "IDLE", QUEUED: "QUEUE", SCANNING: "SCAN_INIT",
  CANDIDATE_FOUND: "DISCOVERY", VERIFYING_CONTRACT: "VALIDATE",
  CHECKING_PRICE: "PRICE", CHECKING_ELIGIBILITY: "ELIGIBILITY",
  CHECKING_LIMITS: "POLICY", SIMULATING: "SIMULATE", READY: "READY",
  SUBMITTING: "SUBMIT", CONFIRMING: "CONFIRM", MINTED: "MINT_SUCCESS",
  SKIPPED: "SKIP", PAUSED: "PAUSED", ERROR: "ERROR",
});

const REASON_MESSAGE = Object.freeze({
  NO_ELIGIBLE_TARGETS: "Scan completed; no candidate passed every safety check.",
  NO_ANALYZED_ACTIVE_TARGETS: "Scan completed; no supported free mint is currently open.",
  NO_AUTONOMOUS_MANDATES: "No authorized Punk was due in this worker cycle.",
  WAITING_FOR_WORKER_CAPACITY: "Queued for the fair worker rotation.",
  MINT_CONFIRMED: "Mint confirmed and recorded in the Punk wallet.",
  SIMULATION_FAILED: "Candidate skipped because transaction simulation failed.",
  UNSUPPORTED_RUNTIME: "Candidate skipped because its contract runtime is unsupported.",
  PRICE_NOT_ZERO: "Candidate skipped because the current mint price is not zero.",
  DAILY_CAP_REACHED: "Scan stopped at the Punk's daily mint limit.",
  AUTHORIZATION_EXPIRED: "Agent authorization expired before execution.",
});

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function normalizeMatrixEvent(value) {
  const event = plainObject(value);
  const tokenId = String(event?.tokenId ?? "");
  const eventId = String(event?.eventId ?? "");
  const state = String(event?.state ?? "");
  const occurredAt = String(event?.occurredAt ?? "");
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(tokenId)
    || !/^[0-9A-Za-z:_-]{8,160}$/.test(eventId)
    || !Object.hasOwn(STATE_CODE, state)
    || !Number.isFinite(Date.parse(occurredAt))) return null;
  const reason = typeof event.reason === "string" && /^[A-Z0-9_]{3,64}$/.test(event.reason)
    ? event.reason : null;
  const collection = typeof event.collection === "string"
    && /^0x[0-9a-f]{40}$/.test(event.collection) ? event.collection : null;
  const transactionHash = typeof event.transactionHash === "string"
    && /^0x[0-9a-f]{64}$/.test(event.transactionHash) ? event.transactionHash : null;
  const source = new Set(["worker", "connector", "user", "scheduler"]).has(event?.source)
    ? event.source : "worker";
  return Object.freeze({ tokenId, eventId, state, reason, occurredAt, collection,
    transactionHash, source, level: STATE_LEVEL[state] ?? "info" });
}

export function matrixEventMessage(event) {
  if (event?.reason && REASON_MESSAGE[event.reason]) return REASON_MESSAGE[event.reason];
  if (event?.state === "MINTED") return "NFT collected by this Punk wallet.";
  if (event?.state === "SCANNING") return "Searching supported mint sources.";
  if (event?.state === "CANDIDATE_FOUND") return "A candidate reached contract review.";
  if (event?.state === "VERIFYING_CONTRACT") return "Verifying the mint contract runtime.";
  if (event?.state === "CHECKING_PRICE") return "Checking the current on-chain mint price.";
  if (event?.state === "CHECKING_ELIGIBILITY") return "Checking Punk-wallet eligibility.";
  if (event?.state === "CHECKING_LIMITS") return "Checking authorization and daily limits.";
  if (event?.state === "SIMULATING") return "Simulating the exact mint transaction.";
  if (event?.state === "SUBMITTING") return "Submitting the validated mint transaction.";
  if (event?.state === "CONFIRMING") return "Waiting for transaction confirmation.";
  if (event?.state === "QUEUED") return "Queued for a worker scan.";
  if (event?.state === "PAUSED") return "Automation is paused.";
  if (event?.state === "ERROR") return "The worker stopped safely and will retry.";
  if (event?.state === "SKIPPED") return "Candidate skipped by a safety or policy check.";
  return "Worker state recorded.";
}

export function matrixWorkerEvidenceMessage(activity) {
  const heartbeat = plainObject(activity)?.heartbeat;
  const status = typeof heartbeat?.status === "string" && /^[A-Z_]{2,64}$/.test(heartbeat.status)
    ? heartbeat.status : null;
  const completedAt = typeof heartbeat?.completedAt === "string"
    && Number.isFinite(Date.parse(heartbeat.completedAt)) ? heartbeat.completedAt : null;
  if (!status || !completedAt) return null;
  const tokenId = /^(?:0|[1-9][0-9]{0,3})$/.test(String(heartbeat.tokenId ?? ""))
    ? `  [#${heartbeat.tokenId}]` : "";
  const failure = typeof heartbeat.failureCode === "string"
    && /^[A-Z0-9_]{3,64}$/.test(heartbeat.failureCode) ? ` · ${heartbeat.failureCode}` : "";
  return `SYSTEM${tokenId}  WORKER_${status}${failure} · verified ${timeLabel(completedAt)}`;
}

export function mergeMatrixEvents(current, incoming, maximum = MAX_EVENTS) {
  const byId = new Map();
  for (const value of [...(current ?? []), ...(incoming ?? [])]) {
    const event = normalizeMatrixEvent(value);
    if (event) byId.set(event.eventId, event);
  }
  return Object.freeze([...byId.values()]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
      || right.eventId.localeCompare(left.eventId))
    .slice(0, Math.max(1, Math.min(MAX_EVENTS, maximum))));
}

export function filterMatrixEvents(events, filter = "all", ownedTokenIds = [], punk = "") {
  const owned = new Set((ownedTokenIds ?? []).map(String));
  return (events ?? []).filter((event) => {
    if (punk && event.tokenId !== String(punk)) return false;
    if (filter === "mine" && !owned.has(event.tokenId)) return false;
    if (filter === "mints" && event.state !== "MINTED") return false;
    if (filter === "scans" && !new Set(["QUEUED", "SCANNING", "CANDIDATE_FOUND",
      "VERIFYING_CONTRACT", "CHECKING_PRICE", "CHECKING_ELIGIBILITY",
      "CHECKING_LIMITS", "SIMULATING", "SKIPPED"]).has(event.state)) return false;
    if (filter === "errors" && event.level !== "error" && event.level !== "warning") return false;
    return true;
  });
}

function timeLabel(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour12: false }) : "--:--:--";
}

function ownedTokenIds(windowObject) {
  return Array.isArray(windowObject.__GOGH_OWNER_PUNKS__?.tokenIds)
    ? windowObject.__GOGH_OWNER_PUNKS__.tokenIds.map(String) : [];
}

function setupAgentMatrix({ windowObject, documentObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  const root = browserDocument?.querySelector?.("[data-agent-matrix]");
  if (!browserWindow || !root) return null;
  const request = fetchFunction ?? browserWindow.fetch.bind(browserWindow);
  const list = root.querySelector("[data-matrix-events]");
  const stateText = root.querySelector("[data-matrix-state]");
  const liveDot = root.querySelector("[data-matrix-live]");
  const clock = root.querySelector("[data-matrix-clock]");
  const active = root.querySelector("[data-matrix-active]");
  const scanning = root.querySelector("[data-matrix-scanning]");
  const minted = root.querySelector("[data-matrix-minted]");
  const candidates = root.querySelector("[data-matrix-candidates]");
  const worker = root.querySelector("[data-matrix-worker]");
  const punkSelect = root.querySelector("[data-matrix-punk]");
  const pause = root.querySelector("[data-matrix-pause]");
  const jump = root.querySelector("[data-matrix-jump]");
  const earlier = root.querySelector("[data-matrix-earlier]");
  const details = root.querySelector("[data-matrix-details]");
  const state = { events: [], filter: "all", punk: "", paused: false, unseen: 0,
    loading: false, stopped: false, timer: null, historyComplete: false, lastActivity: null };

  function updatePunks() {
    if (!punkSelect) return;
    const ids = ownedTokenIds(browserWindow);
    const selected = ids.includes(state.punk) ? state.punk : "";
    const options = [browserDocument.createElement("option"), ...ids.map((tokenId) => {
      const option = browserDocument.createElement("option");
      option.value = tokenId;
      option.textContent = `Punk #${tokenId}`;
      return option;
    })];
    options[0].value = "";
    options[0].textContent = "All Punks";
    punkSelect.replaceChildren(...options);
    punkSelect.value = selected;
  }

  function showDetails(event) {
    if (!details || typeof details.showModal !== "function") return;
    details.querySelector("[data-matrix-detail-punk]").textContent = `Punk #${event.tokenId}`;
    details.querySelector("[data-matrix-detail-event]").textContent = STATE_CODE[event.state];
    details.querySelector("[data-matrix-detail-message]").textContent = matrixEventMessage(event);
    details.querySelector("[data-matrix-detail-time]").textContent = new Date(event.occurredAt).toLocaleString();
    details.querySelector("[data-matrix-detail-source]").textContent = event.source;
    details.querySelector("[data-matrix-detail-collection]").textContent =
      event.collection ?? "Not recorded";
    const transaction = details.querySelector("[data-matrix-detail-transaction]");
    transaction.hidden = !event.transactionHash;
    if (event.transactionHash) transaction.href = `https://robinhoodchain.blockscout.com/tx/${event.transactionHash}`;
    details.querySelector("[data-matrix-detail-punk-link]").href = `/broker/punk/${encodeURIComponent(event.tokenId)}#activity`;
    details.showModal();
  }

  function rowFor(event) {
    const item = browserDocument.createElement("li");
    item.className = "matrix-event-line matrix-event-enter";
    item.dataset.eventId = event.eventId;
    item.dataset.level = event.level;
    item.tabIndex = 0;
    const timestamp = browserDocument.createElement("time");
    timestamp.dateTime = event.occurredAt;
    timestamp.textContent = timeLabel(event.occurredAt);
    const punk = browserDocument.createElement("span");
    punk.className = "matrix-event-punk";
    punk.textContent = `[#${event.tokenId}]`;
    const code = browserDocument.createElement("strong");
    code.textContent = STATE_CODE[event.state];
    const message = browserDocument.createElement("span");
    message.className = "matrix-event-message";
    message.textContent = matrixEventMessage(event);
    item.append(timestamp, punk, code, message);
    item.addEventListener("click", () => showDetails(event));
    item.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Enter" || keyEvent.key === " ") {
        keyEvent.preventDefault();
        showDetails(event);
      }
    });
    return item;
  }

  function renderEvents() {
    const visible = filterMatrixEvents(state.events, state.filter,
      ownedTokenIds(browserWindow), state.punk).slice().reverse();
    const existing = new Map([...list.children].map((node) => [node.dataset.eventId, node]));
    const fragment = browserDocument.createDocumentFragment();
    for (const event of visible) fragment.append(existing.get(event.eventId) ?? rowFor(event));
    list.replaceChildren(fragment);
    if (!visible.length) {
      const empty = browserDocument.createElement("li");
      empty.className = "matrix-event-empty";
      empty.textContent = state.loading
        ? "SYSTEM  Loading persisted worker activity…"
        : matrixWorkerEvidenceMessage(state.lastActivity)
          ?? "SYSTEM  No recorded events match this view yet.";
      list.append(empty);
    }
    if (!state.paused) list.parentElement.scrollTop = list.parentElement.scrollHeight;
  }

  function renderHeader(activity = state.lastActivity) {
    if (activity) state.lastActivity = activity;
    const summaries = browserWindow.__GOGH_OWNER_PUNKS__?.punks ?? [];
    const agentSummaries = summaries.map((punk) => punk.agentSummary).filter(Boolean);
    const scanCount = agentSummaries.filter((summary) => summary.status === "SCANNING").length;
    const activeCount = agentSummaries.filter((summary) => summary.enrolled === true).length;
    const recentMints = state.events.filter((event) => event.state === "MINTED").length;
    const discovered = Number(activity?.heartbeat?.discoverySummary?.discovered ?? 0);
    active.textContent = String(activeCount);
    scanning.textContent = String(scanCount);
    minted.textContent = String(recentMints);
    if (candidates) candidates.textContent = Number.isSafeInteger(discovered) && discovered >= 0
      ? String(discovered) : "0";
    worker.textContent = activity?.online === true ? "ONLINE" : activity?.online === false ? "DEGRADED" : "PENDING";
    liveDot.dataset.online = activity?.online === true ? "true" : "false";
  }

  async function refresh() {
    if (state.loading || state.stopped || browserDocument.visibilityState === "hidden") return;
    state.loading = true;
    stateText.textContent = "Syncing persisted activity…";
    try {
      const response = await request("/api/broker/autonomy-v3-activity?limit=50&timeline=1", {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true || !plainObject(payload.activity)) {
        throw new Error("activity unavailable");
      }
      const previousIds = new Set(state.events.map((event) => event.eventId));
      state.events = mergeMatrixEvents(state.events, payload.activity.events, MAX_EVENTS);
      const added = state.events.filter((event) => !previousIds.has(event.eventId)).length;
      if (state.paused) state.unseen += added;
      renderHeader(payload.activity);
      renderEvents();
      stateText.textContent = payload.activity.online === true
        ? `Live persisted feed · ${new Date(payload.activity.checkedAt).toLocaleTimeString()}`
        : "Worker evidence is delayed; your Punk permissions remain on-chain.";
      jump.hidden = !state.paused || state.unseen === 0;
      if (!jump.hidden) jump.textContent = `${state.unseen} new ${state.unseen === 1 ? "event" : "events"} · Jump to live`;
    } catch {
      stateText.textContent = "Agent activity is temporarily unavailable. Your Punks remain safe.";
      liveDot.dataset.online = "false";
      renderEvents();
    } finally {
      state.loading = false;
    }
  }

  async function loadEarlier() {
    if (state.loading || state.historyComplete || !state.events.length) return;
    state.loading = true;
    earlier.disabled = true;
    stateText.textContent = "Loading earlier persisted events…";
    try {
      const cursor = state.events.at(-1)?.occurredAt;
      const response = await request(`/api/broker/autonomy-v3-activity?limit=50&timeline=1&before=${encodeURIComponent(cursor)}`, {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true || !plainObject(payload.activity)) {
        throw new Error("activity unavailable");
      }
      const older = Array.isArray(payload.activity.events) ? payload.activity.events : [];
      state.events = mergeMatrixEvents(state.events, older, MAX_EVENTS);
      state.historyComplete = older.length < 50 || state.events.length >= MAX_EVENTS;
      earlier.hidden = state.historyComplete;
      renderEvents();
      stateText.textContent = state.historyComplete
        ? "Showing the bounded recent activity window."
        : "Earlier persisted activity loaded.";
    } catch {
      stateText.textContent = "Earlier activity is temporarily unavailable.";
    } finally {
      state.loading = false;
      earlier.disabled = false;
    }
  }

  root.querySelectorAll("[data-matrix-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.matrixFilter;
      root.querySelectorAll("[data-matrix-filter]").forEach((item) => {
        item.setAttribute("aria-pressed", item === button ? "true" : "false");
      });
      renderEvents();
    });
  });
  punkSelect?.addEventListener("change", () => { state.punk = punkSelect.value; renderEvents(); });
  pause?.addEventListener("click", () => {
    state.paused = !state.paused;
    pause.textContent = state.paused ? "Resume scroll" : "Pause scroll";
    pause.setAttribute("aria-pressed", String(state.paused));
    root.dataset.paused = String(state.paused);
    if (!state.paused) { state.unseen = 0; jump.hidden = true; renderEvents(); }
  });
  jump?.addEventListener("click", () => {
    state.paused = false;
    state.unseen = 0;
    pause.textContent = "Pause scroll";
    pause.setAttribute("aria-pressed", "false");
    jump.hidden = true;
    renderEvents();
  });
  earlier?.addEventListener("click", loadEarlier);
  details?.querySelector("[data-matrix-close]")?.addEventListener("click", () => details.close());
  browserWindow.addEventListener("gogh:owner-punks", () => { updatePunks(); renderHeader(); renderEvents(); });
  browserWindow.addEventListener("gogh:matrix-focus", (event) => {
    const tokenId = String(event.detail?.tokenId ?? "");
    if (!/^(?:0|[1-9][0-9]{0,3})$/.test(tokenId)) return;
    state.punk = tokenId;
    updatePunks();
    punkSelect.value = tokenId;
    root.scrollIntoView({ behavior: "smooth", block: "start" });
    renderEvents();
  });
  browserDocument.addEventListener("visibilitychange", () => {
    root.dataset.visible = browserDocument.visibilityState === "hidden" ? "false" : "true";
    if (browserDocument.visibilityState === "visible") refresh();
  });
  updatePunks();
  if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour12: false });
  renderEvents();
  refresh();
  const isDeployPreview = /^(?:deploy-preview-[1-9][0-9]*--gogh-punks\.netlify\.app|deploy-preview-[1-9][0-9]*\.preview\.goghpunks\.xyz)$/
    .test(browserWindow.location?.hostname ?? "");
  state.timer = browserWindow.setInterval(refresh,
    isDeployPreview ? PREVIEW_REFRESH_INTERVAL_MS : REFRESH_INTERVAL_MS);
  const clockTimer = browserWindow.setInterval(() => {
    if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour12: false });
  }, 1_000);
  return Object.freeze({ refresh, loadEarlier, destroy() {
    state.stopped = true;
    browserWindow.clearInterval(state.timer);
    browserWindow.clearInterval(clockTimer);
  } });
}

export { setupAgentMatrix };

if (typeof window !== "undefined" && typeof document !== "undefined") setupAgentMatrix();
