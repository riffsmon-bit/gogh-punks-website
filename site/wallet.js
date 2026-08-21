export const ROBINHOOD_CHAIN_ID = 4663;

export function normalizeWalletAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

export function parseWalletChainId(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const parsed = Number.parseInt(value.slice(2), 16);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function shortWalletAddress(value) {
  const address = normalizeWalletAddress(value);
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

export function walletPresentation({ available, pending, account, chainId, owner }) {
  if (!available) {
    return {
      buttonLabel: "Wallet unavailable",
      statusText: "Install or enable an EVM wallet to use read-only ownership checks.",
      state: "unavailable",
      disabled: true,
    };
  }
  if (pending) {
    return {
      buttonLabel: "Connecting…",
      statusText: "Approve only the connection request. No signature or transaction is requested.",
      state: "pending",
      disabled: true,
    };
  }
  if (!account) {
    return {
      buttonLabel: "Connect wallet",
      statusText: "Wallet disconnected · no automatic signatures or transactions",
      state: "disconnected",
      disabled: false,
    };
  }

  const shortAddress = shortWalletAddress(account);
  if (chainId !== ROBINHOOD_CHAIN_ID) {
    return {
      buttonLabel: shortAddress,
      statusText: `${shortAddress} connected · wrong network · select Robinhood Chain (4663) in your wallet`,
      state: "wrong-network",
      disabled: true,
    };
  }

  const ownerAddress = normalizeWalletAddress(owner?.address);
  const tokenLabel = owner?.tokenId === undefined || owner?.tokenId === null
    ? "this Punk"
    : `Punk #${String(owner.tokenId)}`;
  if (!ownerAddress) {
    return {
      buttonLabel: shortAddress,
      statusText: `${shortAddress} connected · Robinhood Chain · ownership data unavailable · owner actions remain gated`,
      state: "connected",
      disabled: true,
    };
  }
  if (ownerAddress === account) {
    return {
      buttonLabel: shortAddress,
      statusText: `Matches the indexed owner of ${tokenLabel} · live authority is rechecked for every gated owner action`,
      state: "owner",
      disabled: true,
    };
  }
  return {
    buttonLabel: shortAddress,
    statusText: `${shortAddress} connected · public view · not the indexed owner of ${tokenLabel}`,
    state: "viewer",
    disabled: true,
  };
}

function firstValidAccount(accounts) {
  if (!Array.isArray(accounts)) return null;
  for (const account of accounts) {
    const normalized = normalizeWalletAddress(account);
    if (normalized) return normalized;
  }
  return null;
}

export function setupReadOnlyWallet({ windowObject, documentObject } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  if (!browserWindow || !browserDocument) return null;

  const buttons = [...browserDocument.querySelectorAll("[data-wallet-connect]")];
  const statusTargets = [...browserDocument.querySelectorAll("[data-wallet-state]")];
  if (!buttons.length) return null;

  const provider = browserWindow.ethereum ?? null;
  const state = {
    pending: false,
    account: null,
    chainId: null,
    owner: null,
  };

  function render() {
    const presentation = walletPresentation({
      available: Boolean(provider?.request),
      pending: state.pending,
      account: state.account,
      chainId: state.chainId,
      owner: state.owner,
    });
    for (const button of buttons) {
      button.textContent = presentation.buttonLabel;
      button.disabled = presentation.disabled;
      button.setAttribute("aria-disabled", String(presentation.disabled));
      button.dataset.walletStatus = presentation.state;
      button.title = state.account ?? presentation.buttonLabel;
    }
    for (const target of statusTargets) {
      target.textContent = presentation.statusText;
      target.dataset.walletStatus = presentation.state;
    }
    const detail = Object.freeze({
      account: state.account,
      chainId: state.chainId,
      owner: state.owner ? Object.freeze({ ...state.owner }) : null,
      status: presentation.state,
    });
    browserWindow.__GOGH_WALLET_SNAPSHOT__ = detail;
    if (typeof browserWindow.dispatchEvent === "function"
      && typeof browserWindow.CustomEvent === "function") {
      browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:wallet-state", { detail }));
    }
  }

  async function connect() {
    if (!provider?.request || state.pending || state.account) return;
    state.pending = true;
    render();
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const chainId = await provider.request({ method: "eth_chainId" });
      state.account = firstValidAccount(accounts);
      state.chainId = parseWalletChainId(chainId);
    } catch {
      state.account = null;
      state.chainId = null;
    } finally {
      state.pending = false;
      render();
    }
  }

  function handleAccountsChanged(accounts) {
    state.account = firstValidAccount(accounts);
    render();
  }

  function handleChainChanged(chainId) {
    state.chainId = parseWalletChainId(chainId);
    render();
  }

  function handleDisconnect() {
    state.account = null;
    state.chainId = null;
    render();
  }

  function handleOwnerSnapshot(event) {
    const detail = event?.detail ?? {};
    const address = normalizeWalletAddress(detail.address);
    if (!address) return;
    const tokenId = typeof detail.tokenId === "string" && /^\d+$/.test(detail.tokenId)
      ? detail.tokenId
      : null;
    const owner = { address, tokenId, source: detail.source === "punk" ? "punk" : "scout" };
    if (!state.owner || owner.source === "punk" || state.owner.source !== "punk") {
      state.owner = owner;
      render();
    }
  }

  for (const button of buttons) button.addEventListener("click", connect);
  if (typeof provider?.on === "function") {
    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);
    provider.on("disconnect", handleDisconnect);
  }
  browserWindow.addEventListener("gogh:owner-snapshot", handleOwnerSnapshot);
  handleOwnerSnapshot({ detail: browserWindow.__GOGH_OWNER_SNAPSHOT__ });
  render();

  return {
    connect,
    destroy() {
      for (const button of buttons) button.removeEventListener("click", connect);
      if (typeof provider?.removeListener === "function") {
        provider.removeListener("accountsChanged", handleAccountsChanged);
        provider.removeListener("chainChanged", handleChainChanged);
        provider.removeListener("disconnect", handleDisconnect);
      }
      browserWindow.removeEventListener("gogh:owner-snapshot", handleOwnerSnapshot);
    },
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupReadOnlyWallet({ windowObject: window, documentObject: document });
}
