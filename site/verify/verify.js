const CHAIN_ID = 4663;
const CHAIN_HEX = "0x1237";

const elements = {
  claimed: document.querySelector("[data-claimed]"),
  cap: document.querySelector("[data-cap]"),
  remaining: document.querySelector("[data-remaining]"),
  progress: document.querySelector("[data-progress]"),
  status: document.querySelector("[data-status]"),
  discordButton: document.querySelector("[data-discord-button]"),
  discordCopy: document.querySelector("[data-discord-copy]"),
  walletButton: document.querySelector("[data-wallet-button]"),
  walletCopy: document.querySelector("[data-wallet-copy]"),
  claimButton: document.querySelector("[data-claim-button]"),
  discordStep: document.querySelector('[data-step="discord"]'),
  walletStep: document.querySelector('[data-step="wallet"]'),
  claimStep: document.querySelector('[data-step="claim"]'),
};

const state = {
  discordConnected: false,
  alreadyClaimed: false,
  statsLoaded: false,
  captureOpen: false,
  walletAddress: null,
  busy: false,
};

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function setStatus(message, tone = "neutral") {
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
}

function renderButtons() {
  if (state.discordConnected) {
    elements.discordButton.textContent = "Connected";
    elements.discordButton.setAttribute("aria-disabled", "true");
    elements.discordButton.removeAttribute("href");
    elements.discordStep.classList.add("is-complete");
  }
  if (state.walletAddress) {
    elements.walletButton.textContent = shortAddress(state.walletAddress);
    elements.walletStep.classList.add("is-complete");
  }
  const canClaim =
    state.discordConnected &&
    state.walletAddress &&
    state.captureOpen &&
    !state.alreadyClaimed &&
    !state.busy;
  elements.claimButton.disabled = !canClaim;
  elements.walletButton.disabled =
    state.busy || state.alreadyClaimed || !state.statsLoaded || !state.captureOpen;
  if (state.alreadyClaimed) {
    elements.claimButton.textContent = "GTD Captured";
    elements.claimStep.classList.add("is-complete");
  } else if (!state.statsLoaded) {
    elements.claimButton.textContent = "Unavailable";
  } else if (!state.captureOpen) {
    elements.claimButton.textContent = "List Full";
  } else {
    elements.claimButton.textContent = state.busy ? "Verifying…" : "Claim GTD";
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.message || "The gallery service is temporarily unavailable.");
    error.code = payload?.code || "REQUEST_FAILED";
    throw error;
  }
  return payload;
}

function applyStats(capture) {
  elements.claimed.textContent = String(capture.claimed);
  elements.cap.textContent = String(capture.cap);
  elements.remaining.textContent = String(capture.remaining);
  elements.progress.max = capture.cap;
  elements.progress.value = capture.claimed;
  elements.progress.textContent = `${capture.claimed} of ${capture.cap}`;
  state.statsLoaded = true;
  state.captureOpen = capture.open;
}

function authMessage(code) {
  return {
    OAUTH_STATE_INVALID: "Discord sign-in expired. Please connect Discord again.",
    NOT_MEMBER: "Join the Gogh Punks Discord before capturing a GTD spot.",
    SCREENING_REQUIRED: "Accept the Gogh Punks server rules in Discord, then reconnect.",
    ACCOUNT_TOO_NEW: "This Discord account is too new for GTD capture.",
    AUTH_UNAVAILABLE: "Discord sign-in is temporarily unavailable. Please try again.",
  }[code];
}

async function loadStatus() {
  try {
    const payload = await api("/api/verification/status");
    applyStats(payload.capture);
    state.discordConnected = payload.discord.connected;
    state.alreadyClaimed = payload.discord.claimed;
    if (payload.discord.connected) {
      elements.discordCopy.textContent = `Connected as ${payload.discord.username}.`;
    }
    if (payload.discord.claimed) {
      elements.walletCopy.textContent = `${payload.discord.wallet} is already secured for this Discord account.`;
      const syncPending = payload.discord.roleSyncState !== "SYNCED";
      setStatus(
        syncPending
          ? "Your GTD spot is secured. Discord role sync is queued."
          : "Your GTD spot is secured and your Discord role is synced.",
        "success",
      );
    } else if (!payload.capture.open) {
      setStatus("All 200 GTD wallet spots have been claimed.", "warning");
    } else if (payload.discord.connected) {
      setStatus("Discord confirmed. Connect the wallet you want on the list.", "success");
    } else {
      setStatus("Connect Discord to begin. Your wallet comes next.");
    }
  } catch (error) {
    setStatus(error.message, "error");
  }

  const authCode = new URLSearchParams(window.location.search).get("auth");
  const authNotice = authMessage(authCode);
  if (authNotice && !state.discordConnected) setStatus(authNotice, "error");
  if (window.location.search) {
    history.replaceState(null, "", window.location.pathname);
  }
  renderButtons();
}

async function switchToRobinhoodChain() {
  const currentChain = await window.ethereum.request({ method: "eth_chainId" });
  if (Number.parseInt(currentChain, 16) === CHAIN_ID) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_HEX }],
    });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_HEX,
          chainName: "Robinhood Chain",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.arrowrpc.com"],
          blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
        },
      ],
    });
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setStatus("No EVM wallet was detected. Open this page in a wallet-enabled browser.", "error");
    return;
  }
  try {
    await switchToRobinhoodChain();
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts?.[0]) throw new Error("No wallet account was selected.");
    state.walletAddress = accounts[0];
    elements.walletCopy.textContent = `${shortAddress(accounts[0])} connected on Robinhood Chain.`;
    setStatus(
      state.discordConnected
        ? "Wallet connected. Sign the authentication message to capture GTD."
        : "Wallet connected. Connect Discord before signing.",
      "success",
    );
  } catch (error) {
    setStatus(
      error?.code === 4001
        ? "Wallet connection was cancelled. Nothing changed."
        : "Connect your wallet on Robinhood Chain (chain ID 4663).",
      "error",
    );
  }
  renderButtons();
}

function utf8ToHex(value) {
  return `0x${[...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function claimGtd() {
  state.busy = true;
  renderButtons();
  setStatus("Preparing a single-use authentication message…");
  try {
    await switchToRobinhoodChain();
    const prepared = await api("/api/verification/prepare", {
      method: "POST",
      body: JSON.stringify({ address: state.walletAddress, chainId: CHAIN_ID }),
    });
    const signature = await window.ethereum.request({
      method: "personal_sign",
      params: [utf8ToHex(prepared.message), state.walletAddress],
    });
    setStatus("Signature received. Reserving your wallet atomically…");
    const completed = await api("/api/verification/complete", {
      method: "POST",
      body: JSON.stringify({ signature }),
    });
    applyStats(completed.capture);
    state.alreadyClaimed = true;
    elements.walletCopy.textContent = `${completed.wallet} captured · 3 mints · 0 ETH.`;
    setStatus(
      completed.roleSyncState === "SYNCED"
        ? "GTD confirmed. Your wallet is captured and your Discord role is live."
        : "GTD confirmed. Your wallet is captured; Discord role sync is queued.",
      "success",
    );
  } catch (error) {
    setStatus(
      error?.code === 4001
        ? "Signature cancelled. No wallet was recorded and no role changed."
        : error.message,
      "error",
    );
  } finally {
    state.busy = false;
    renderButtons();
  }
}

elements.walletButton.addEventListener("click", connectWallet);
elements.claimButton.addEventListener("click", claimGtd);
window.ethereum?.on?.("accountsChanged", () => {
  state.walletAddress = null;
  elements.walletStep.classList.remove("is-complete");
  elements.walletCopy.textContent = "Wallet changed. Connect it again before signing.";
  renderButtons();
});
window.ethereum?.on?.("chainChanged", () => {
  state.walletAddress = null;
  elements.walletStep.classList.remove("is-complete");
  elements.walletCopy.textContent = "Network changed. Reconnect on Robinhood Chain.";
  renderButtons();
});

loadStatus();
