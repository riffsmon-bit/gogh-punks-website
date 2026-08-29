function shortAddress(value) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

const FUNDING_VALUES = new Set([
  "500000000000000", "1000000000000000", "2000000000000000",
]);

const ACTIVITY_REFRESH_INTERVAL_MS = 15_000;

export const RETIREMENT_MINT_LIFETIMES = Object.freeze({
  COMMON: 100,
  UNCOMMON: 200,
  RARE: 400,
  EPIC: 800,
  LEGENDARY: 1_600,
  MYTHIC: 3_200,
});

export function retirementActivationDisclosure(tokenId, retirement) {
  const selectedToken = typeof tokenId === "string" && /^(?:0|[1-9][0-9]{0,3})$/.test(tokenId)
    ? tokenId : null;
  const tier = retirement?.rarityEvidence === "VERIFIED_SNAPSHOT"
    && Object.hasOwn(RETIREMENT_MINT_LIFETIMES, retirement?.rarityTier)
    ? retirement.rarityTier : null;
  const limit = tier ? RETIREMENT_MINT_LIFETIMES[tier] : null;
  const confirmed = Number.isSafeInteger(retirement?.confirmedAutonomousMints)
    && retirement.confirmedAutonomousMints >= 0
    ? retirement.confirmedAutonomousMints : null;
  if (!selectedToken) return Object.freeze({
    title: "Verified retirement tier pending",
    summary: "Select a Punk to review its mint lifetime. No retirement countdown is active until a published rarity snapshot assigns that Punk an exact tier.",
    assigned: false,
  });
  const previewTier = retirement?.rarityEvidence === "OPENSEA_OPENRARITY_CURRENT"
    && Object.hasOwn(RETIREMENT_MINT_LIFETIMES, retirement?.rarityTier)
    && Number.isSafeInteger(retirement?.rarityRank) && retirement.rarityRank >= 1
    ? retirement.rarityTier : null;
  if (previewTier) {
    const previewLimit = RETIREMENT_MINT_LIFETIMES[previewTier];
    return Object.freeze({
      title: `Punk #${selectedToken} · OpenRarity #${retirement.rarityRank.toLocaleString()} · proposed ${previewTier.toLowerCase()} tier`,
      summary: `The current OpenSea rarity rank maps to the draft ${previewTier.toLowerCase()} band and a proposed ${previewLimit.toLocaleString()}-mint lifetime. This is a preview only: the retirement countdown stays inactive until the collection publishes an immutable rarity snapshot.`,
      assigned: false,
      preview: true,
      tier: previewTier,
      limit: previewLimit,
      rank: retirement.rarityRank,
    });
  }
  const metadataTier = retirement?.rarityEvidence === "ONCHAIN_METADATA_TRAIT_CURRENT"
    && Object.hasOwn(RETIREMENT_MINT_LIFETIMES, retirement?.rarityTier)
    ? retirement.rarityTier : null;
  if (metadataTier) {
    const previewLimit = RETIREMENT_MINT_LIFETIMES[metadataTier];
    return Object.freeze({
      title: `Punk #${selectedToken} · on-chain ${metadataTier.toLowerCase()} trait`,
      summary: `The Punk’s current on-chain metadata declares the ${metadataTier.toLowerCase()} tier, which maps to a proposed ${previewLimit.toLocaleString()}-mint lifetime. This is still a preview: the countdown remains inactive until the collection publishes the complete immutable rarity snapshot used by the retirement model.`,
      assigned: false,
      preview: true,
      tier: metadataTier,
      limit: previewLimit,
    });
  }
  if (!tier || confirmed === null) return Object.freeze({
    title: `Punk #${selectedToken} · tier not assigned`,
    summary: "This Punk does not yet have a published, verified rarity assignment, so its retirement countdown is not active. The exact tier, lifetime, and remaining mint count must be shown before the retirement policy can launch.",
    assigned: false,
  });
  const remaining = Math.max(0, limit - confirmed);
  return Object.freeze({
    title: `Punk #${selectedToken} · ${tier.toLowerCase()} lifetime`,
    summary: `${confirmed.toLocaleString()} of ${limit.toLocaleString()} confirmed autonomous mints used · ${remaining.toLocaleString()} remaining before automation retirement.`,
    assigned: true,
    tier,
    limit,
    confirmed,
    remaining,
  });
}

export function createCoalescedRefresh(task) {
  if (typeof task !== "function") throw new TypeError("refresh task is required");
  let active = null;
  let queued = false;
  const refresh = () => {
    if (active) {
      queued = true;
      return active;
    }
    active = Promise.resolve().then(task).finally(() => {
      active = null;
      if (queued) {
        queued = false;
        void refresh();
      }
    });
    return active;
  };
  return refresh;
}

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

// Agent statistics are chain evidence or nothing. The live reader nests the authorization expiry
// under `authorization.validUntil`, and an inactive Punk has no enforced cap to report at all, so
// every figure here stays null until the chain supplies it.
export function automationSnapshotStats(selectedState) {
  const active = selectedState?.active === true;
  const integer = (value) => (active && Number.isInteger(value) ? value : null);
  return Object.freeze({
    cap: integer(selectedState?.maxAcquisitionsPerDay),
    acquisitionsToday: integer(selectedState?.acquisitionsToday),
    authorizationValidUntil: active
      ? selectedState.authorization?.validUntil ?? null : null,
  });
}

export function automationSelectionChanged(currentSelection, nextSelection) {
  const currentTokenId = currentSelection?.tokenId ?? null;
  const nextTokenId = nextSelection?.tokenId ?? null;
  return currentTokenId !== nextTokenId;
}

export function automationGateNeedsLegacyFallback(v3Gate, tokenId) {
  return selectAutomationGeneration(v3Gate, null, tokenId).version !== 3;
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
  const latestMint = panel.querySelector("[data-v3-latest-mint]");
  const refresh = panel.querySelector("[data-v2-refresh]");
  const refreshed = panel.querySelector("[data-v2-refreshed]");
  const setup = panel.querySelector("[data-v2-setup]");
  const runNow = panel.querySelector("[data-v3-run-now]");
  const runAll = panel.querySelector("[data-v3-run-all]");
  const runState = panel.querySelector("[data-v3-run-state]");
  const stop = panel.querySelector("[data-v2-stop]");
  const preset = panel.querySelector("[data-v2-preset]");
  const cap = panel.querySelector("[data-v2-cap]");
  const days = panel.querySelector("[data-v2-days]");
  const confirmationPlan = panel.querySelector("[data-v2-confirmation-plan]");
  const retirementTitle = panel.querySelector("[data-retirement-title]");
  const retirementSummary = panel.querySelector("[data-retirement-summary]");
  const retirementConfirm = panel.querySelector("[data-retirement-confirm]");
  const retirementConfirmLabel = panel.querySelector("[data-retirement-confirm-label]");
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
    lastTransactionHash: null, lastActionError: null,
  };

  function heartbeatLabel(value) {
    if (!value) return "No worker check recorded yet";
    const checked = new Date(value.completedAt);
    const outcome = value.status === "MINT_CONFIRMED"
      ? `Mint completed${value.tokenId ? ` for Punk #${value.tokenId}` : ""}`
      : value.status === "NO_ELIGIBLE_TARGETS" ? "Scan finished — no mint passed all checks"
        : value.status === "NO_ANALYZED_ACTIVE_TARGETS" ? "Scan finished — no supported free mint is open"
          : value.status === "NO_AUTONOMOUS_MANDATES" ? "Scan finished — no Punk agent is enrolled"
            : value.status === "FAILED"
              ? `Scan stopped safely${value.failureCode ? ` (${value.failureCode})` : ""}; automatic retry scheduled`
              : "Scan stopped safely";
    return `${outcome} · ${checked.toLocaleString()}`;
  }

  async function rpc(method, params = []) {
    const provider = browserWindow.__GOGH_WALLET_PROVIDER__;
    if (!provider?.request) throw new Error("Connect your wallet first.");
    return provider.request({ method, params });
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
      state.lastTransactionHash = hash;
      await receipt(hash);
    }
  }

  function render() {
    const publicUsage = state.v3Gate?.usage;
    usageMints.textContent = publicUsage?.confirmedMints ?? "—";
    usagePunks.textContent = publicUsage?.mintingPunks ?? "—";
    usageWallets.textContent = publicUsage?.autonomousPreferenceWallets ?? "—";
    usageMintsDetail.textContent = publicUsage?.latestConfirmedAt
      ? `Last confirmed mint ${new Date(publicUsage.latestConfirmedAt).toLocaleString()} · durable history is not erased by a later failed scan`
      : publicUsage?.trackedSince
        ? `Hosted history tracked since ${new Date(publicUsage.trackedSince).toLocaleDateString()} · no confirmed mint recorded yet`
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
    const retirement = retirementActivationDisclosure(
      state.selection?.tokenId ?? null,
      selectedState?.retirement ?? state.selection?.retirement,
    );
    retirementTitle.textContent = retirement.title;
    retirementSummary.textContent = retirement.summary;
    retirementConfirm.disabled = active || !state.selection;
    retirementConfirmLabel.textContent = active
      ? "This Punk is already active. Any future retirement policy requires a separately published tier assignment and cannot retroactively authorize a burn."
      : "I reviewed the lifecycle and understand that retirement becomes required to continue automation after the verified mint lifetime; the final burn remains a separate owner-confirmed action.";
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
    setup.disabled = !ready || Boolean(state.setupSubmission)
      || (!active && retirementConfirm.checked !== true);
    runNow.disabled = !agentLive || state.version !== 3 || state.running;
    runNow.textContent = state.running ? "Agent scan running…" : "Send selected agent now";
    runAll.disabled = state.version !== 3 || state.gate?.capability !== true || state.running;
    runAll.textContent = state.running ? "Agent scan running…" : "Scan all my active Punks";
    stop.disabled = !active;
    cap.disabled = state.gate?.capability !== true;
    days.disabled = state.gate?.capability !== true;
    preset.disabled = state.gate?.capability !== true;
    setup.textContent = state.setupSubmission
      ? `Confirming ${setupIndex} of ${state.setupSubmission.total}…`
      : active ? "Update cap or run time" : "Set up and start agent";
    const workerRetrying = state.gate?.status === "WORKER_DEGRADED";
    badge.textContent = agentLive ? "LIVE" : active
      ? workerRetrying ? "WORKER RETRYING" : "WORKER OFFLINE"
      : state.gate?.capability === true ? "READY" : "NOT READY";
    badge.classList.toggle("off", !agentLive && state.gate?.capability !== true);
    worker.textContent = state.gate?.heartbeat?.online === true ? "CHECKING FOR FREE MINTS"
      : ["WORKER_STARTING", "WORKER_DEGRADED"].includes(state.gate?.status)
        ? "RETRYING" : "OFFLINE";
    workerDetail.textContent = heartbeatLabel(state.gate?.heartbeat);
    const heartbeat = state.gate?.heartbeat;
    const mintHash = heartbeat?.status === "MINT_CONFIRMED"
      && /^0x[0-9a-fA-F]{64}$/.test(heartbeat.transactionHash ?? "")
      ? heartbeat.transactionHash.toLowerCase() : null;
    latestMint.hidden = false;
    if (mintHash) {
      latestMint.href = `https://robinhoodchain.blockscout.com/tx/${mintHash}`;
      latestMint.textContent = `Latest autonomous mint${heartbeat.tokenId ? ` · Punk #${heartbeat.tokenId}` : ""} ↗`;
    } else {
      latestMint.removeAttribute("href");
      latestMint.textContent = publicUsage?.latestConfirmedAt
        ? `No mint in the latest scan · last confirmed ${new Date(publicUsage.latestConfirmedAt).toLocaleString()}`
        : "No confirmed autonomous mint recorded yet";
    }
    refresh.disabled = state.refreshing;
    refresh.textContent = state.refreshing ? "Refreshing…" : "Refresh live status";
    refreshed.textContent = state.lastSyncedAt
      ? `Page synced ${state.lastSyncedAt.toLocaleTimeString()} · lightweight activity check every 15 seconds`
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
        : state.gate?.status === "WORKER_DEGRADED"
          ? "WORKER RETRYING"
        : state.gate?.status === "DEPLOYED_CONFIGURATION_PENDING"
          ? "SETUP SERVICE NOT READY"
          : state.gate?.status === "DEPLOYED_SOURCE_VERIFICATION_PENDING"
            ? "SAFETY VERIFICATION PENDING"
        : "AUTOMATION NOT READY";
    status.classList.toggle("off", !agentLive && !ready);
    if (agentLive) {
      message.textContent = `Agent is live for Punk #${selectedState.tokenId}. ${heartbeatLabel(state.gate?.heartbeat)}. Today: ${selectedState.acquisitionsToday} of ${selectedState.maxAcquisitionsPerDay} mints.`;
    } else if (active) {
      message.textContent = workerRetrying
        ? `Punk #${selectedState.tokenId} remains authorized on-chain. The latest worker run stopped safely and the scheduled worker will retry automatically. Manual scans wait for a healthy heartbeat; stop and revoke remains available here.`
        : `Punk #${selectedState.tokenId} remains authorized on-chain, but the hosted worker heartbeat is not current. Manual scans wait for it to recover; scheduled checks remain fail-closed. You can still stop and revoke it here.`;
    }
    const wizardDetail = Object.freeze({
      tokenId: state.selection?.tokenId ?? null,
      version: state.version,
      account: punkWallet,
      active,
      agentLive,
      capability: state.gate?.capability === true,
      workerOnline: state.gate?.heartbeat?.online === true,
      ...automationSnapshotStats(selectedState),
      setupSubmission: state.setupSubmission ? Object.freeze({ ...state.setupSubmission }) : null,
      lastTransactionHash: state.lastTransactionHash,
      lastActionError: state.lastActionError,
      hostedGas: gasReady ? Object.freeze({
        address: gasAgent.address,
        balanceWei: gasAgent.balanceWei,
        ready: BigInt(gasAgent.balanceWei) > 0n,
      }) : null,
      heartbeat: state.gate?.heartbeat ? Object.freeze({ ...state.gate.heartbeat }) : null,
    });
    browserWindow.__GOGH_AUTOMATION_SNAPSHOT__ = wizardDetail;
    browserWindow.dispatchEvent(new browserWindow.CustomEvent(
      "gogh:automation-state", { detail: wizardDetail },
    ));
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
    const provider = browserWindow.__GOGH_WALLET_PROVIDER__;
    if (!provider?.request) {
      agentFundState.textContent = "Connect your wallet before funding automation gas.";
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

  async function loadOnce() {
    const sequence = ++state.loadSequence;
    const requestedTokenId = state.selection?.tokenId ?? null;
    state.refreshing = true;
    render();
    try {
      // The status route carries a short CDN cache for wallet-independent live evidence. Avoid a
      // timestamp query key that defeats that cache on every page navigation. Privileged setup,
      // stop, funding, and execution routes still perform their own fresh chain checks.
      const params = new URLSearchParams();
      if (requestedTokenId) params.set("tokenId", requestedTokenId);
      const query = params.size > 0 ? `?${params}` : "";
      const fetchGate = async (version) => {
        const response = await request(`/api/broker/autonomy-v${version}-status${query}`, {
          // The edge may reuse this public advisory response briefly; its browser response is
          // still private/no-store. Mutation routes independently perform fresh live checks.
          headers: { accept: "application/json" },
        });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true || typeof payload?.automation !== "object") {
          throw new Error(`V${version} status unavailable`);
        }
        return payload.automation;
      };
      const v3Gate = await fetchGate(3).catch(() => null);
      const v2Gate = automationGateNeedsLegacyFallback(v3Gate, requestedTokenId)
        ? await fetchGate(2).catch(() => null) : null;
      const selected = selectAutomationGeneration(
        v3Gate, v2Gate, requestedTokenId,
      );
      if (!selected.gate) throw new Error("automation status unavailable");
      if (sequence !== state.loadSequence
        || requestedTokenId !== (state.selection?.tokenId ?? null)) return;
      state.v3Gate = v3Gate;
      state.version = selected.version;
      state.gate = selected.gate;
      state.lastSyncedAt = new Date();
      state.lastRefreshFailedAt = null;
      const selectedState = state.gate?.punk?.tokenId === state.selection?.tokenId
        ? state.gate.punk : null;
      if (selectedState?.active === true
        && Number.isInteger(selectedState.maxAcquisitionsPerDay)
        && selectedState.maxAcquisitionsPerDay >= 1
        && selectedState.maxAcquisitionsPerDay <= 10
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

  const load = createCoalescedRefresh(loadOnce);

  async function refreshActivity() {
    if (!state.selection?.tokenId || !state.gate || browserDocument.visibilityState === "hidden") {
      return;
    }
    try {
      const response = await request(`/api/broker/autonomy-v3-activity?refresh=${Date.now()}`, {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      const payload = await response.json();
      const activity = payload?.activity;
      if (!response.ok || payload?.ok !== true || typeof activity !== "object") return;
      const priorCompletedAt = state.gate?.heartbeat?.completedAt ?? null;
      const heartbeat = activity.heartbeat
        ? { ...activity.heartbeat, online: activity.online === true } : null;
      state.gate = { ...state.gate, heartbeat };
      if (state.v3Gate) state.v3Gate = { ...state.v3Gate, heartbeat, usage: activity.usage };
      state.lastSyncedAt = new Date();
      render();
      if (heartbeat?.completedAt !== priorCompletedAt
        && heartbeat?.status === "MINT_CONFIRMED"
        && heartbeat?.tokenId === state.selection.tokenId) {
        await load();
      }
    } catch {
      // Advisory DB activity refresh never substitutes for an explicit live chain check.
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

  async function runAllAgentsNow() {
    if (state.running || state.version !== 3 || state.gate?.capability !== true) return;
    state.running = true;
    render();
    runState.textContent = "Starting one fair, serialized scan across all active Punk agents…";
    try {
      const response = await request("/api/broker/autonomy-v3-run", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
        cache: "no-store",
      });
      const payload = await response.json();
      if ((!response.ok && response.status !== 202) || payload?.ok !== true) {
        throw new Error(payload?.message ?? "The all-Punk scan was rejected.");
      }
      const outcome = payload.run;
      runState.textContent = outcome.status === "MINT_CONFIRMED"
        ? `Mint confirmed for Punk #${outcome.tokenId}: ${outcome.transactionHash}`
        : outcome.status === "RUN_IN_PROGRESS"
          ? "A fair worker scan is already running. Status will update when it finishes."
          : "Fair scan complete. Every active Punk reached before the time bound was checked; no transaction was needed.";
      await load();
    } catch (error) {
      runState.textContent = error?.message ?? "The all-Punk scan stopped safely.";
    } finally {
      state.running = false;
      render();
    }
  }

  browserWindow.addEventListener("gogh:punk-selected", (event) => {
    const nextSelection = event.detail?.tokenId ? event.detail : null;
    const selectedAnotherPunk = automationSelectionChanged(state.selection, nextSelection);
    state.selection = nextSelection;
    if (selectedAnotherPunk) {
      cap.dataset.userEdited = "false";
      cap.dataset.liveToken = "";
      retirementConfirm.checked = false;
      if (state.gate) state.gate = { ...state.gate, punk: null };
    }
    render();
    void load();
  });
  setup.addEventListener("click", async () => {
    let startFirstScan = false;
    setup.disabled = true;
    state.lastActionError = null;
    try {
      const review = await artifact();
      state.setupSubmission = { index: 0, total: review.setupTransactions.length };
      render();
      account.textContent = shortAddress(review.punk.account);
      await submit(review.setupTransactions, "Setup");
      message.textContent = `Automation is active for Punk #${review.punk.tokenId} until ${new Date(Number(review.limits.authorizationValidUntil) * 1_000).toLocaleString()}. Its first bounded scan is starting automatically.`;
      cap.dataset.userEdited = "false";
      await load();
      // Activation used to stop after the on-chain confirmations. That made a Punk look active
      // while leaving it out of the durable worker roster until its owner found and pressed the
      // separate manual-run button. The existing run endpoint first rechecks live V3 authority,
      // idempotently enrolls the Punk, and only then invokes the bounded worker. Start it once
      // after setup so the product's activation promise is true without granting any new power.
      startFirstScan = state.version === 3 && state.selection?.tokenId === review.punk.tokenId;
    } catch (error) {
      state.lastActionError = error?.message ?? "Setup stopped safely.";
      message.textContent = error?.message ?? "Setup stopped safely.";
    } finally {
      state.setupSubmission = null;
      render();
    }
    if (startFirstScan) void runAgentNow();
  });
  runNow.addEventListener("click", runAgentNow);
  runAll.addEventListener("click", runAllAgentsNow);
  accountCopy.addEventListener("click", copyPunkWalletAddress);
  agentCopy.addEventListener("click", copyAgentAddress);
  refresh.addEventListener("click", () => { void load(); });
  agentFundConfirm.addEventListener("change", render);
  retirementConfirm.addEventListener("change", render);
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
  browserWindow.setInterval?.(() => { void refreshActivity(); }, ACTIVITY_REFRESH_INTERVAL_MS);
  browserWindow.addEventListener?.("focus", () => { void refreshActivity(); });
  browserWindow.addEventListener?.("pageshow", () => { void refreshActivity(); });
  browserDocument.addEventListener?.("visibilitychange", () => {
    if (browserDocument.visibilityState === "visible") void refreshActivity();
  });
  return Object.freeze({ refresh: load });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupAutonomousMinting();
}
