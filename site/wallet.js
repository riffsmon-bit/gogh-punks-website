export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CHAIN_HEX = "0x1237";
export const ROBINHOOD_CHAIN_CONFIGURATION = Object.freeze({
  chainId: ROBINHOOD_CHAIN_HEX,
  chainName: "Robinhood Chain",
  nativeCurrency: Object.freeze({ name: "Ether", symbol: "ETH", decimals: 18 }),
  rpcUrls: Object.freeze(["https://rpc.mainnet.chain.robinhood.com"]),
  blockExplorerUrls: Object.freeze(["https://robinhoodchain.blockscout.com"]),
});

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
      statusText: `${shortAddress} connected to Robinhood Chain · choose a Punk below`,
      state: "connected",
      disabled: true,
    };
  }
  if (ownerAddress === account) {
    return {
      buttonLabel: shortAddress,
      statusText: `${tokenLabel} selected · live ownership verified for ${shortAddress}`,
      state: "owner",
      disabled: true,
    };
  }
  return {
    buttonLabel: shortAddress,
    statusText: `${tokenLabel} selected · this connected address is not its current holder`,
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

export async function switchWalletToRobinhoodChain(provider) {
  if (!provider?.request) throw new TypeError("An EVM wallet is required.");
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ROBINHOOD_CHAIN_HEX }],
    });
  } catch (error) {
    if (error?.code !== 4902 && error?.code !== "4902") throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: ROBINHOOD_CHAIN_CONFIGURATION.chainId,
        chainName: ROBINHOOD_CHAIN_CONFIGURATION.chainName,
        nativeCurrency: { ...ROBINHOOD_CHAIN_CONFIGURATION.nativeCurrency },
        rpcUrls: [...ROBINHOOD_CHAIN_CONFIGURATION.rpcUrls],
        blockExplorerUrls: [...ROBINHOOD_CHAIN_CONFIGURATION.blockExplorerUrls],
      }],
    });
  }
  let chainId = await provider.request({ method: "eth_chainId" });
  if (parseWalletChainId(chainId) !== ROBINHOOD_CHAIN_ID) {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ROBINHOOD_CHAIN_HEX }],
    });
    chainId = await provider.request({ method: "eth_chainId" });
  }
  if (parseWalletChainId(chainId) !== ROBINHOOD_CHAIN_ID) {
    throw new Error("The wallet did not switch to Robinhood Chain.");
  }
  return ROBINHOOD_CHAIN_ID;
}

export function setupReadOnlyWallet({ windowObject, documentObject } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  if (!browserWindow || !browserDocument) return null;

  const buttons = [...browserDocument.querySelectorAll("[data-wallet-connect]")];
  const switchButtons = [...browserDocument.querySelectorAll("[data-wallet-switch]")];
  const statusTargets = [...browserDocument.querySelectorAll("[data-wallet-state]")];
  if (!buttons.length) return null;

  const provider = browserWindow.ethereum ?? null;
  const state = {
    pending: false,
    account: null,
    chainId: null,
    owner: null,
    switching: false,
    networkError: null,
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
      target.textContent = state.switching
        ? "Waiting for the wallet to switch to Robinhood Chain (4663)…"
        : state.networkError ?? presentation.statusText;
      target.dataset.walletStatus = presentation.state;
    }
    for (const switchButton of switchButtons) {
      switchButton.hidden = presentation.state !== "wrong-network" && !state.switching;
      switchButton.disabled = state.switching;
      switchButton.textContent = state.switching ? "Switching network…" : "Switch to Robinhood Chain";
      switchButton.setAttribute("aria-disabled", String(state.switching));
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

  async function switchNetwork() {
    if (!provider?.request || state.switching || !state.account) return;
    state.switching = true;
    state.networkError = null;
    render();
    try {
      state.chainId = await switchWalletToRobinhoodChain(provider);
    } catch {
      state.networkError = "Network switch was cancelled or unavailable. Select Robinhood Chain (4663) in the wallet and retry.";
    } finally {
      state.switching = false;
      render();
    }
  }

  async function connect() {
    await restorePromise;
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

  async function restoreAuthorizedSession() {
    if (!provider?.request) return;
    try {
      const accounts = await provider.request({ method: "eth_accounts" });
      const account = firstValidAccount(accounts);
      if (!account) return;
      const chainId = await provider.request({ method: "eth_chainId" });
      state.account = account;
      state.chainId = parseWalletChainId(chainId);
      render();
    } catch {
      // Silent restoration never prompts and never substitutes for live action checks.
    }
  }

  function handleAccountsChanged(accounts) {
    state.account = firstValidAccount(accounts);
    state.owner = null;
    render();
  }

  function handleChainChanged(chainId) {
    state.chainId = parseWalletChainId(chainId);
    state.owner = null;
    state.networkError = null;
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

  function handlePunkSelection(event) {
    const detail = event?.detail ?? {};
    const address = normalizeWalletAddress(detail.owner);
    const tokenId = typeof detail.tokenId === "string" && /^(0|[1-9]\d*)$/.test(detail.tokenId)
      ? detail.tokenId : null;
    state.owner = address && tokenId
      ? { address, tokenId, source: "selection" }
      : null;
    render();
  }

  for (const button of buttons) button.addEventListener("click", connect);
  for (const button of switchButtons) button.addEventListener("click", switchNetwork);
  if (typeof provider?.on === "function") {
    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);
    provider.on("disconnect", handleDisconnect);
  }
  browserWindow.addEventListener("gogh:owner-snapshot", handleOwnerSnapshot);
  browserWindow.addEventListener("gogh:punk-selected", handlePunkSelection);
  handleOwnerSnapshot({ detail: browserWindow.__GOGH_OWNER_SNAPSHOT__ });
  render();
  const restorePromise = restoreAuthorizedSession();

  return {
    connect,
    switchNetwork,
    ready: restorePromise,
    destroy() {
      for (const button of buttons) button.removeEventListener("click", connect);
      for (const button of switchButtons) button.removeEventListener("click", switchNetwork);
      if (typeof provider?.removeListener === "function") {
        provider.removeListener("accountsChanged", handleAccountsChanged);
        provider.removeListener("chainChanged", handleChainChanged);
        provider.removeListener("disconnect", handleDisconnect);
      }
      browserWindow.removeEventListener("gogh:owner-snapshot", handleOwnerSnapshot);
      browserWindow.removeEventListener("gogh:punk-selected", handlePunkSelection);
    },
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupReadOnlyWallet({ windowObject: window, documentObject: document });
}
