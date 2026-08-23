function shortAddress(value) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function setupAutonomousMinting({ windowObject, documentObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  const panel = browserDocument?.querySelector?.("[data-autonomous-minting]");
  if (!browserWindow || !panel) return null;
  const request = fetchFunction ?? browserWindow.fetch.bind(browserWindow);
  const status = panel.querySelector("[data-v2-status]");
  const punk = panel.querySelector("[data-v2-punk]");
  const account = panel.querySelector("[data-v2-account]");
  const setup = panel.querySelector("[data-v2-setup]");
  const stop = panel.querySelector("[data-v2-stop]");
  const state = { gate: null, selection: null };

  function render() {
    punk.textContent = state.selection?.tokenId ? `#${state.selection.tokenId}` : "Choose a Punk";
    account.textContent = state.gate?.bindings?.accountRegistry
      ? `Derived after V2 activation · ${shortAddress(state.gate.bindings.accountRegistry)}`
      : "V2 automation wallet not available";
    const ready = state.gate?.capability === true
      && state.gate?.setupTransactionAvailable === true && Boolean(state.selection);
    setup.disabled = !ready;
    stop.disabled = true;
    status.textContent = state.gate?.capability === true
      ? state.gate.reason === null ? "READY" : "FINAL UI GATE PENDING"
      : state.gate?.status === "DEPLOYED_AWAITING_LIVE_GATE"
        ? "DEPLOYED · LIVE GATE PENDING"
        : "V2 DEPLOYMENT IN PREPARATION";
    status.classList.toggle("off", !ready);
  }

  async function load() {
    try {
      const response = await request("/api/broker/autonomy-v2-status", {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true || typeof payload?.automation !== "object") {
        throw new Error("status unavailable");
      }
      state.gate = payload.automation;
    } catch {
      state.gate = null;
      status.textContent = "STATUS UNAVAILABLE";
    }
    render();
  }

  browserWindow.addEventListener("gogh:punk-selected", (event) => {
    state.selection = event.detail?.tokenId ? event.detail : null;
    render();
  });
  setup.addEventListener("click", () => {
    status.textContent = "One-time setup remains locked until every V2 deployment gate passes.";
  });
  stop.addEventListener("click", () => {});
  render();
  load();
  return Object.freeze({ refresh: load });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupAutonomousMinting();
}
