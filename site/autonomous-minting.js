function shortAddress(value) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

const FUNDING_VALUES = new Set([
  "500000000000000", "1000000000000000", "2000000000000000",
]);

function canonicalAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value.toLowerCase();
}

export function formatAutomationGasBalance(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) return "— ETH";
  const padded = value.padStart(19, "0");
  const whole = padded.slice(0, -18).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-18).slice(0, 9).replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} ETH`;
}

export function buildAutomationGasFundingTransaction(fromValue, agentValue, amountWei) {
  const from = canonicalAddress(fromValue, "connected wallet");
  const to = canonicalAddress(agentValue, "hosted gas wallet");
  if (!FUNDING_VALUES.has(amountWei)) throw new TypeError("Choose a supported gas amount.");
  return Object.freeze({ from, to, value: `0x${BigInt(amountWei).toString(16)}`, data: "0x" });
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
  const agent = panel.querySelector("[data-v2-agent]");
  const agentFull = panel.querySelector("[data-v2-agent-full]");
  const agentBalance = panel.querySelector("[data-v2-agent-balance]");
  const agentBalanceLarge = panel.querySelector("[data-v2-agent-balance-large]");
  const agentCopy = panel.querySelector("[data-v2-agent-copy]");
  const agentFundAmount = panel.querySelector("[data-v2-agent-fund-amount]");
  const agentFundConfirm = panel.querySelector("[data-v2-agent-fund-confirm]");
  const agentFund = panel.querySelector("[data-v2-agent-fund]");
  const agentFundState = panel.querySelector("[data-v2-agent-fund-state]");
  const worker = panel.querySelector("[data-v2-worker]");
  const workerDetail = panel.querySelector("[data-v2-worker-detail]");
  const setup = panel.querySelector("[data-v2-setup]");
  const stop = panel.querySelector("[data-v2-stop]");
  const cap = panel.querySelector("[data-v2-cap]");
  const days = panel.querySelector("[data-v2-days]");
  const badge = panel.querySelector("[data-v2-badge]");
  const message = panel.querySelector("[data-v2-message]");
  const state = { gate: null, selection: null, funding: false };

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
    const gasAgent = state.gate?.agent;
    const gasReady = state.gate?.capability === true && gasAgent?.codeFree === true
      && /^0x[0-9a-f]{40}$/.test(gasAgent.address ?? "")
      && /^(?:0|[1-9][0-9]*)$/.test(gasAgent.balanceWei ?? "");
    const balanceLabel = formatAutomationGasBalance(gasAgent?.balanceWei);
    agent.textContent = gasReady ? shortAddress(gasAgent.address) : "UNAVAILABLE";
    agentFull.textContent = gasReady ? gasAgent.address : "Waiting for verified live status…";
    agentBalance.textContent = gasReady ? `${balanceLabel} available for worker gas`
      : "Live balance unavailable";
    agentBalanceLarge.textContent = balanceLabel;
    agentCopy.disabled = !gasReady;
    agentFundAmount.disabled = !gasReady || state.funding;
    agentFund.disabled = !gasReady || state.funding || !agentFundConfirm.checked;
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

  async function copyAgentAddress() {
    const value = state.gate?.agent?.address;
    if (!/^0x[0-9a-f]{40}$/.test(value ?? "")) return;
    try {
      await browserWindow.navigator?.clipboard?.writeText(value);
      agentFundState.textContent = "Hosted gas-wallet address copied. Verify it before sending.";
    } catch {
      agentFundState.textContent = `Copy unavailable. Select this exact address: ${value}`;
    }
  }

  async function fundAgent() {
    if (state.funding || !agentFundConfirm.checked) return;
    const provider = browserWindow.ethereum;
    if (!provider?.request) {
      agentFundState.textContent = "Connect MetaMask before funding automation gas.";
      return;
    }
    state.funding = true;
    render();
    let providerChanged = false;
    const changed = () => { providerChanged = true; };
    for (const eventName of ["accountsChanged", "chainChanged", "disconnect"]) {
      provider.on?.(eventName, changed);
    }
    try {
      const expectedAgent = canonicalAddress(state.gate?.agent?.address, "hosted gas wallet");
      if (state.gate?.agent?.codeFree !== true) throw new Error("Hosted gas wallet is not verified as code-free.");
      const chain = await rpc("eth_chainId");
      if (BigInt(chain) !== 4663n) throw new Error("Switch MetaMask to Robinhood Chain.");
      const accounts = await rpc("eth_requestAccounts");
      const from = canonicalAddress(accounts?.[0], "connected wallet");
      providerChanged = false;
      const transaction = buildAutomationGasFundingTransaction(
        from, expectedAgent, agentFundAmount.value,
      );
      const [code, gas] = await Promise.all([
        rpc("eth_getCode", [expectedAgent, "latest"]),
        rpc("eth_estimateGas", [transaction]),
      ]);
      if (code !== "0x" || typeof gas !== "string" || BigInt(gas) === 0n) {
        throw new Error("Hosted gas wallet failed the final live check.");
      }
      await rpc("eth_call", [transaction, "latest"]);
      const [finalChain, finalAccounts] = await Promise.all([
        rpc("eth_chainId"), rpc("eth_accounts"),
      ]);
      if (providerChanged || BigInt(finalChain) !== 4663n
        || canonicalAddress(finalAccounts?.[0], "connected wallet") !== from
        || state.gate?.agent?.address !== expectedAgent || !agentFundConfirm.checked) {
        throw new Error("Wallet, chain, or verified gas address changed. Nothing was submitted.");
      }
      agentFundState.textContent = "Confirm the fixed gas-wallet contribution in MetaMask.";
      const hash = await rpc("eth_sendTransaction", [transaction]);
      await receipt(hash);
      agentFundState.textContent = `Gas funding confirmed: ${hash}`;
      agentFundConfirm.checked = false;
      await load();
    } catch (error) {
      agentFundState.textContent = error?.message ?? "Gas funding was not submitted.";
    } finally {
      for (const eventName of ["accountsChanged", "chainChanged", "disconnect"]) {
        provider.removeListener?.(eventName, changed);
      }
      state.funding = false;
      render();
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
      const selectedState = state.gate?.punk?.tokenId === state.selection?.tokenId
        ? state.gate.punk : null;
      if (selectedState?.active === true
        && [1, 3, 5, 10].includes(selectedState.maxAcquisitionsPerDay)
        && (cap.dataset.liveToken !== selectedState.tokenId
          || cap.dataset.userEdited !== "true")) {
        cap.value = String(selectedState.maxAcquisitionsPerDay);
        cap.dataset.liveToken = selectedState.tokenId;
        cap.dataset.userEdited = "false";
      }
    } catch {
      state.gate = null;
      status.textContent = "STATUS UNAVAILABLE";
    }
    render();
  }

  browserWindow.addEventListener("gogh:punk-selected", (event) => {
    state.selection = event.detail?.tokenId ? event.detail : null;
    cap.dataset.userEdited = "false";
    cap.dataset.liveToken = "";
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
      cap.dataset.userEdited = "false";
      await load();
    } catch (error) {
      message.textContent = error?.message ?? "Setup stopped safely.";
    } finally {
      render();
    }
  });
  agentCopy.addEventListener("click", copyAgentAddress);
  agentFundConfirm.addEventListener("change", render);
  agentFund.addEventListener("click", fundAgent);
  cap.addEventListener("change", () => { cap.dataset.userEdited = "true"; });
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
