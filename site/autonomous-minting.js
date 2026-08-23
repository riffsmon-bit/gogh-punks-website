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
  const worker = panel.querySelector("[data-v2-worker]");
  const workerDetail = panel.querySelector("[data-v2-worker-detail]");
  const setup = panel.querySelector("[data-v2-setup]");
  const stop = panel.querySelector("[data-v2-stop]");
  const cap = panel.querySelector("[data-v2-cap]");
  const days = panel.querySelector("[data-v2-days]");
  const badge = panel.querySelector("[data-v2-badge]");
  const message = panel.querySelector("[data-v2-message]");
  const state = { gate: null, selection: null };

  function heartbeatLabel(value) {
    if (!value) return "No worker check recorded yet";
    const checked = new Date(value.completedAt);
    const outcome = value.status === "MINT_CONFIRMED" ? "Mint confirmed"
      : value.status === "NO_ELIGIBLE_TARGETS" ? "Scanned · no eligible target"
        : value.status === "NO_ANALYZED_ACTIVE_TARGETS" ? "Scanned · awaiting analyzed targets"
          : value.status === "NO_AUTONOMOUS_MANDATES" ? "Scanned · no active mandates"
            : "Worker check failed safely";
    return `${outcome} · ${checked.toLocaleString()}`;
  }

  async function rpc(method, params = []) {
    if (!browserWindow.ethereum?.request) throw new Error("Connect MetaMask first.");
    return browserWindow.ethereum.request({ method, params });
  }

  async function receipt(hash) {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const value = await rpc("eth_getTransactionReceipt", [hash]);
      if (value) {
        if (BigInt(value.status) !== 1n) throw new Error("A setup transaction reverted.");
        return value;
      }
      await new Promise((resolve) => browserWindow.setTimeout(resolve, 1_000));
    }
    throw new Error("The transaction is still pending. Check MetaMask before retrying.");
  }

  async function artifact() {
    const params = new URLSearchParams({
      tokenId: state.selection.tokenId,
      cap: cap.value,
      days: days.value,
    });
    const response = await request(`/api/broker/autonomy-v2-owner-setup?${params}`, {
      headers: { accept: "application/json" }, cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.message ?? "V2 setup is unavailable.");
    return payload.artifact;
  }

  async function submit(transactions, label) {
    const originalChain = await rpc("eth_chainId");
    if (BigInt(originalChain) !== 4663n) throw new Error("Switch MetaMask to Robinhood Chain.");
    const accounts = await rpc("eth_requestAccounts");
    for (let index = 0; index < transactions.length; index += 1) {
      const transaction = transactions[index];
      const [freshChain, freshAccounts] = await Promise.all([
        rpc("eth_chainId"), rpc("eth_accounts"),
      ]);
      if (freshChain !== originalChain || freshAccounts[0]?.toLowerCase() !== transaction.from) {
        throw new Error("Wallet or chain changed during setup. Nothing else was submitted.");
      }
      message.textContent = `${label} ${index + 1} of ${transactions.length}: confirm ${transaction.purpose.replaceAll("_", " ").toLowerCase()} in MetaMask.`;
      await rpc("eth_call", [{ from: transaction.from, to: transaction.to, value: "0x0", data: transaction.data }, "latest"]);
      const hash = await rpc("eth_sendTransaction", [{ from: transaction.from, to: transaction.to, value: "0x0", data: transaction.data }]);
      await receipt(hash);
    }
  }

  function render() {
    punk.textContent = state.selection?.tokenId ? `#${state.selection.tokenId}` : "Choose a Punk";
    const selectedState = state.gate?.punk?.tokenId === state.selection?.tokenId
      ? state.gate.punk : null;
    const active = selectedState?.active === true;
    const agentLive = active && state.gate?.capability === true
      && state.gate?.heartbeat?.online === true;
    account.textContent = selectedState?.account
      ? shortAddress(selectedState.account)
      : state.gate?.bindings?.accountRegistry
        ? `Derived after V2 activation · ${shortAddress(state.gate.bindings.accountRegistry)}`
      : "V2 automation wallet not available";
    const ready = state.gate?.capability === true
      && state.gate?.setupTransactionAvailable === true && Boolean(state.selection);
    setup.disabled = !ready;
    stop.disabled = !active;
    cap.disabled = state.gate?.capability !== true;
    days.disabled = state.gate?.capability !== true;
    setup.textContent = active ? "Update cap or agent authorization" : "Review one-time setup in wallet";
    badge.textContent = agentLive ? "AGENT LIVE" : active ? "AUTHORIZED · WORKER OFFLINE"
      : state.gate?.capability === true ? "READY" : "LOCKED";
    badge.classList.toggle("off", !agentLive && state.gate?.capability !== true);
    worker.textContent = state.gate?.heartbeat?.online === true ? "LIVE · SCANNING"
      : state.gate?.status === "WORKER_STARTING" ? "STARTING" : "OFFLINE";
    workerDetail.textContent = heartbeatLabel(state.gate?.heartbeat);
    status.textContent = agentLive
      ? "ACTIVE · SCANNING"
      : active ? "AUTHORIZED · WORKER OFFLINE"
      : state.gate?.capability === true
        ? state.gate.reason === null ? "READY" : "FINAL UI GATE PENDING"
      : state.gate?.status === "DEPLOYED_AWAITING_LIVE_GATE"
        ? "DEPLOYED · LIVE GATE PENDING"
        : state.gate?.status === "WORKER_STARTING"
          ? "WORKER STARTING"
        : state.gate?.status === "DEPLOYED_CONFIGURATION_PENDING"
          ? "DEPLOYED · GUARDIAN + WORKER PENDING"
          : state.gate?.status === "DEPLOYED_SOURCE_VERIFICATION_PENDING"
            ? "DEPLOYED · SOURCE ADOPTION PENDING"
        : "V2 DEPLOYMENT IN PREPARATION";
    status.classList.toggle("off", !agentLive && !ready);
    if (agentLive) {
      message.textContent = `Agent is live for Punk #${selectedState.tokenId}. ${heartbeatLabel(state.gate?.heartbeat)}. Today: ${selectedState.acquisitionsToday} of ${selectedState.maxAcquisitionsPerDay} mints.`;
    } else if (active) {
      message.textContent = `Punk #${selectedState.tokenId} remains authorized on-chain, but the hosted worker heartbeat is not current. Automatic submission is paused until it recovers. You can still stop and revoke it here.`;
    }
  }

  async function load() {
    try {
      const query = state.selection?.tokenId
        ? `?tokenId=${encodeURIComponent(state.selection.tokenId)}` : "";
      const response = await request(`/api/broker/autonomy-v2-status${query}`, {
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
    if (state.gate) state.gate = { ...state.gate, punk: null };
    render();
    void load();
  });
  setup.addEventListener("click", async () => {
    setup.disabled = true;
    try {
      const review = await artifact();
      account.textContent = shortAddress(review.punk.account);
      await submit(review.setupTransactions, "Setup");
      message.textContent = `Automation is active for Punk #${review.punk.tokenId} until ${new Date(Number(review.limits.authorizationValidUntil) * 1_000).toLocaleString()}. The agent remains bounded by the selected daily cap.`;
      await load();
    } catch (error) {
      message.textContent = error?.message ?? "Setup stopped safely.";
    } finally {
      render();
    }
  });
  stop.addEventListener("click", async () => {
    stop.disabled = true;
    try {
      const review = await artifact();
      await submit(review.stopTransactions, "Stop");
      message.textContent = "Automation was disabled and the hosted agent was revoked for this Punk.";
      await load();
    } catch (error) {
      message.textContent = error?.message ?? "Stop sequence halted; inspect the last confirmed transaction.";
    } finally {
      render();
    }
  });
  render();
  load();
  browserWindow.setInterval?.(() => { void load(); }, 60_000);
  return Object.freeze({ refresh: load });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupAutonomousMinting();
}
