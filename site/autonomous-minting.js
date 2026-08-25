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

export function automationPunkWalletOpenSeaUrl(value) {
  return `https://opensea.io/${canonicalAddress(value, "Punk NFT wallet")}`;
}

export function selectAutomationGeneration(v3Gate, v2Gate, tokenId) {
  const v3Ready = v3Gate?.capability === true
    && v3Gate?.setupTransactionAvailable === true;
  const selectedV3Punk = tokenId && v3Gate?.punk?.tokenId === tokenId
    ? v3Gate.punk : null;
  const selectedV3Deployed = selectedV3Punk?.created === true
    || selectedV3Punk?.active === true;
  if (v3Ready || selectedV3Deployed) {
    return Object.freeze({ version: 3, gate: v3Gate });
  }
  return Object.freeze({ version: 2, gate: v2Gate });
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
  const accountCopy = panel.querySelector("[data-v3-account-copy]");
  const accountOpenSea = panel.querySelector("[data-v3-account-opensea]");
  const accountCopyState = panel.querySelector("[data-v3-account-copy-state]");
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
  const refresh = panel.querySelector("[data-v2-refresh]");
  const refreshed = panel.querySelector("[data-v2-refreshed]");
  const setup = panel.querySelector("[data-v2-setup]");
  const runNow = panel.querySelector("[data-v3-run-now]");
  const runState = panel.querySelector("[data-v3-run-state]");
  const stop = panel.querySelector("[data-v2-stop]");
  const preset = panel.querySelector("[data-v2-preset]");
  const cap = panel.querySelector("[data-v2-cap]");
  const days = panel.querySelector("[data-v2-days]");
  const confirmationPlan = panel.querySelector("[data-v2-confirmation-plan]");
  const progressSummary = panel.querySelector("[data-v2-progress-summary]");
  const progressSteps = Object.fromEntries([...panel.querySelectorAll("[data-v2-progress-step]")]
    .map((element) => [element.dataset.v2ProgressStep, element]));
  const badge = panel.querySelector("[data-v2-badge]");
  const message = panel.querySelector("[data-v2-message]");
  const v3Upgrade = panel.querySelector("[data-v3-upgrade]");
  const usageMints = panel.querySelector("[data-v3-usage-mints]");
  const usageMintsDetail = panel.querySelector("[data-v3-usage-mints-detail]");
  const usagePunks = panel.querySelector("[data-v3-usage-punks]");
  const usageWallets = panel.querySelector("[data-v3-usage-wallets]");
  const state = {
    gate: null, v3Gate: null, version: 2, selection: null, funding: false, running: false,
    refreshing: false, setupSubmission: null,
    lastSyncedAt: null, lastRefreshFailedAt: null, loadSequence: 0,
  };

  function heartbeatLabel(value) {
    if (!value) return "No worker check recorded yet";
    const checked = new Date(value.completedAt);
    const outcome = value.status === "MINT_CONFIRMED" ? "Mint completed"
      : value.status === "NO_ELIGIBLE_TARGETS" ? "Scan finished — no mint passed all checks"
        : value.status === "NO_ANALYZED_ACTIVE_TARGETS" ? "Scan finished — no supported free mint is open"
          : value.status === "NO_AUTONOMOUS_MANDATES" ? "Scan finished — no Punk agent is enrolled"
            : "Scan stopped safely";
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
    const response = await request(`/api/broker/autonomy-v${state.version}-owner-setup?${params}`, {
      headers: { accept: "application/json" }, cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.message ?? `V${state.version} setup is unavailable.`);
    }
    return payload.artifact;
  }

  async function submit(transactions, label) {
    const originalChain = await rpc("eth_chainId");
    if (BigInt(originalChain) !== 4663n) throw new Error("Switch MetaMask to Robinhood Chain.");
    const accounts = await rpc("eth_requestAccounts");
    for (let index = 0; index < transactions.length; index += 1) {
      const transaction = transactions[index];
      if (label === "Setup") {
        state.setupSubmission = { index: index + 1, total: transactions.length };
        render();
      }
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
    const publicUsage = state.v3Gate?.usage;
    usageMints.textContent = publicUsage?.confirmedMints ?? "—";
    usagePunks.textContent = publicUsage?.mintingPunks ?? "—";
    usageWallets.textContent = publicUsage?.autonomousPreferenceWallets ?? "—";
    usageMintsDetail.textContent = publicUsage?.trackedSince
      ? `Hosted history tracked since ${new Date(publicUsage.trackedSince).toLocaleDateString()}`
      : "Aggregate hosted-worker history becomes available after its first recorded run";
    if (v3Upgrade) {
      v3Upgrade.textContent = state.version === 3 && state.gate?.capability === true
        ? "V3 is active: exact reviewed OpenSea Studio clone and full-contract runtimes are supported."
        : state.version === 3
          ? "This Punk’s V3 wallet is active on-chain. Autonomous submission remains paused while the hosted worker gate restarts."
        : state.v3Gate?.status === "PREPARING_V3"
          ? "V2 remains active while the broader V3 OpenSea Studio release is prepared and verified."
          : "V2 remains active until every V3 deployment, source, guardian, and worker gate passes.";
    }
    punk.textContent = state.selection?.tokenId ? `#${state.selection.tokenId}` : "Choose a Punk";
    const selectedState = state.gate?.punk?.tokenId === state.selection?.tokenId
      ? state.gate.punk : null;
    const active = selectedState?.active === true;
    const agentLive = active && state.gate?.capability === true
      && state.gate?.heartbeat?.online === true;
    const setupCount = selectedState?.created === true || active ? 2 : 3;
    const setupIndex = state.setupSubmission?.index ?? 0;
    for (const [name, element] of Object.entries(progressSteps)) {
      const complete = name === "choose" ? Boolean(state.selection)
        : name === "limits" ? Boolean(state.selection) && (active || Boolean(state.setupSubmission))
          : name === "confirm" ? active
            : name === "live" ? agentLive : false;
      const current = !complete && (
        name === "choose" && !state.selection
        || name === "limits" && Boolean(state.selection) && !active && !state.setupSubmission
        || name === "confirm" && Boolean(state.setupSubmission)
        || name === "live" && active && !agentLive
      );
      element.classList.toggle("complete", complete);
      element.classList.toggle("current", current);
    }
    progressSummary.textContent = agentLive
      ? `Punk #${selectedState.tokenId} is live. The worker will keep scanning until its cap, expiry, pause, or revocation.`
      : active
        ? `Punk #${selectedState.tokenId} is set up. The worker is temporarily offline, so automatic submissions are paused.`
        : state.setupSubmission
          ? `MetaMask confirmation ${setupIndex} of ${state.setupSubmission.total}. Keep this page open until every confirmation is mined.`
          : state.selection
            ? "Choose a preset or custom limits, then start the agent."
            : "Connect your wallet and choose a Punk to begin.";
    confirmationPlan.textContent = state.selection
      ? `${active ? "Updating" : "Starting"} this agent requires ${setupCount} sequential MetaMask confirmations. No repeated confirmation is needed for later eligible free mints.`
      : "Setup confirmation count appears after you choose a Punk.";
    const punkWallet = /^0x[0-9a-fA-F]{40}$/.test(selectedState?.account ?? "")
      ? selectedState.account.toLowerCase() : null;
    account.textContent = punkWallet
      ? shortAddress(punkWallet)
      : state.gate?.bindings?.accountRegistry
        ? `Derived after V${state.version} activation · ${shortAddress(state.gate.bindings.accountRegistry)}`
      : `V${state.version} automation wallet not available`;
    accountCopy.disabled = !punkWallet;
    accountOpenSea.hidden = !punkWallet;
    if (punkWallet) accountOpenSea.href = automationPunkWalletOpenSeaUrl(punkWallet);
    else accountOpenSea.removeAttribute("href");
    accountCopyState.textContent = punkWallet
      ? `This exact V${state.version} wallet receives the selected Punk’s autonomous mints.`
      : "Select a live-verified Punk to reveal its NFT wallet.";
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
    setup.disabled = !ready || Boolean(state.setupSubmission);
    runNow.disabled = !agentLive || state.version !== 3 || state.running;
    runNow.textContent = state.running ? "Agent scan running…" : "Send selected agent now";
    stop.disabled = !active;
    cap.disabled = state.gate?.capability !== true;
    days.disabled = state.gate?.capability !== true;
    preset.disabled = state.gate?.capability !== true;
    setup.textContent = state.setupSubmission
      ? `Confirming ${setupIndex} of ${state.setupSubmission.total}…`
      : active ? "Update cap or run time" : "Set up and start agent";
    badge.textContent = agentLive ? "LIVE" : active ? "WORKER OFFLINE"
      : state.gate?.capability === true ? "READY" : "NOT READY";
    badge.classList.toggle("off", !agentLive && state.gate?.capability !== true);
    worker.textContent = state.gate?.heartbeat?.online === true ? "CHECKING FOR FREE MINTS"
      : state.gate?.status === "WORKER_STARTING" ? "RESTARTING" : "OFFLINE";
    workerDetail.textContent = heartbeatLabel(state.gate?.heartbeat);
    refresh.disabled = state.refreshing;
    refresh.textContent = state.refreshing ? "Refreshing…" : "Refresh live status";
    refreshed.textContent = state.lastSyncedAt
      ? `Page synced ${state.lastSyncedAt.toLocaleTimeString()} · automatic check every 30 seconds`
      : state.lastRefreshFailedAt
        ? `Refresh failed ${state.lastRefreshFailedAt.toLocaleTimeString()} · retrying automatically`
        : "Page has not synced yet";
    status.textContent = agentLive
      ? "LIVE · CHECKING FOR FREE MINTS"
      : active ? "SET UP · WORKER OFFLINE"
      : state.gate?.capability === true
        ? state.gate.reason === null ? "READY TO START" : "FINAL SAFETY CHECK PENDING"
      : state.gate?.status === "DEPLOYED_AWAITING_LIVE_GATE"
        ? "LIVE SAFETY CHECK PENDING"
        : state.gate?.status === "WORKER_STARTING"
          ? "WORKER RESTARTING"
        : state.gate?.status === "DEPLOYED_CONFIGURATION_PENDING"
          ? "SETUP SERVICE NOT READY"
          : state.gate?.status === "DEPLOYED_SOURCE_VERIFICATION_PENDING"
            ? "SAFETY VERIFICATION PENDING"
        : "AUTOMATION NOT READY";
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

  async function copyPunkWalletAddress() {
    const selectedState = state.gate?.punk?.tokenId === state.selection?.tokenId
      ? state.gate.punk : null;
    const value = selectedState?.account;
    if (!/^0x[0-9a-fA-F]{40}$/.test(value ?? "")) return;
    try {
      await browserWindow.navigator?.clipboard?.writeText(value.toLowerCase());
      accountCopy.textContent = `V${state.version} address copied`;
      accountCopyState.textContent = `Copied the selected Punk’s V${state.version} NFT wallet—not the hosted gas payer.`;
    } catch {
      accountCopyState.textContent = `Copy unavailable. Select this exact Punk NFT wallet: ${value.toLowerCase()}`;
    }
    browserWindow.setTimeout?.(() => {
      accountCopy.textContent = "Copy NFT-wallet address";
    }, 1_800);
  }

  function syncPresetFromLimits() {
    const pair = `${cap.value}:${days.value}`;
    preset.value = ["1:7", "5:14", "10:30"].includes(pair) ? pair : "custom";
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
    const sequence = ++state.loadSequence;
    state.refreshing = true;
    render();
    try {
      const params = new URLSearchParams({ refresh: String(Date.now()) });
      if (state.selection?.tokenId) params.set("tokenId", state.selection.tokenId);
      const query = `?${params}`;
      const fetchGate = async (version) => {
        const response = await request(`/api/broker/autonomy-v${version}-status${query}`, {
          headers: { accept: "application/json" }, cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true || typeof payload?.automation !== "object") {
          throw new Error(`V${version} status unavailable`);
        }
        return payload.automation;
      };
      const [v3Result, v2Result] = await Promise.allSettled([fetchGate(3), fetchGate(2)]);
      const v3Gate = v3Result.status === "fulfilled" ? v3Result.value : null;
      const v2Gate = v2Result.status === "fulfilled" ? v2Result.value : null;
      const selected = selectAutomationGeneration(
        v3Gate, v2Gate, state.selection?.tokenId ?? null,
      );
      if (!selected.gate) throw new Error("automation status unavailable");
      if (sequence !== state.loadSequence) return;
      state.v3Gate = v3Gate;
      state.version = selected.version;
      state.gate = selected.gate;
      state.lastSyncedAt = new Date();
      state.lastRefreshFailedAt = null;
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
      syncPresetFromLimits();
    } catch {
      if (sequence !== state.loadSequence) return;
      state.gate = null;
      state.lastRefreshFailedAt = new Date();
      status.textContent = "STATUS UNAVAILABLE";
    } finally {
      if (sequence !== state.loadSequence) return;
      state.refreshing = false;
      render();
    }
  }

  async function runAgentNow() {
    if (state.running || state.version !== 3 || !state.selection?.tokenId) return;
    state.running = true;
    render();
    runState.textContent = "Running the exact V3 target, policy, and simulation checks now…";
    try {
      const response = await request("/api/broker/autonomy-v3-run", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ tokenId: state.selection.tokenId }),
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok && response.status !== 202 || payload?.ok !== true) {
        throw new Error(payload?.message ?? "The immediate agent run was rejected.");
      }
      const outcome = payload.run;
      runState.textContent = outcome.status === "MINT_CONFIRMED"
        ? `Mint confirmed: ${outcome.transactionHash}`
        : outcome.status === "RUN_IN_PROGRESS"
          ? "A worker scan is already running. Live status will update when it finishes."
          : outcome.status === "NO_ANALYZED_ACTIVE_TARGETS"
            ? "Scan complete. The directed mint is not open yet."
            : outcome.status === "NO_ELIGIBLE_TARGETS"
              ? "Scan complete. No target passed every live safety and simulation check."
              : "Scan complete. No transaction was needed.";
      await load();
    } catch (error) {
      runState.textContent = error?.message ?? "The agent scan stopped safely.";
    } finally {
      state.running = false;
      render();
    }
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
      state.setupSubmission = { index: 0, total: review.setupTransactions.length };
      render();
      account.textContent = shortAddress(review.punk.account);
      await submit(review.setupTransactions, "Setup");
      message.textContent = `Automation is active for Punk #${review.punk.tokenId} until ${new Date(Number(review.limits.authorizationValidUntil) * 1_000).toLocaleString()}. The agent remains bounded by the selected daily cap.`;
      cap.dataset.userEdited = "false";
      await load();
    } catch (error) {
      message.textContent = error?.message ?? "Setup stopped safely.";
    } finally {
      state.setupSubmission = null;
      render();
    }
  });
  runNow.addEventListener("click", runAgentNow);
  accountCopy.addEventListener("click", copyPunkWalletAddress);
  agentCopy.addEventListener("click", copyAgentAddress);
  refresh.addEventListener("click", () => { void load(); });
  agentFundConfirm.addEventListener("change", render);
  agentFund.addEventListener("click", fundAgent);
  preset.addEventListener("change", () => {
    if (preset.value === "custom") return;
    const [nextCap, nextDays] = preset.value.split(":");
    cap.value = nextCap;
    days.value = nextDays;
    cap.dataset.userEdited = "true";
    render();
  });
  cap.addEventListener("change", () => {
    cap.dataset.userEdited = "true";
    syncPresetFromLimits();
  });
  days.addEventListener("change", syncPresetFromLimits);
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
  browserWindow.setInterval?.(() => { void load(); }, 30_000);
  browserWindow.addEventListener?.("focus", () => { void load(); });
  browserWindow.addEventListener?.("pageshow", () => { void load(); });
  browserDocument.addEventListener?.("visibilitychange", () => {
    if (browserDocument.visibilityState === "visible") void load();
  });
  return Object.freeze({ refresh: load });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupAutonomousMinting();
}
