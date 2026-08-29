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

export function authoritativeWalletProvider(windowObject = globalThis.window) {
  return windowObject?.__GOGH_WALLET_PROVIDER__ ?? null;
}

export function walletErrorMessage(error, action = "connect") {
  const code = error?.code ?? error?.cause?.code;
  const message = String(error?.message ?? "").toLowerCase();
  if (code === 4001 || code === "ACTION_REJECTED" || message.includes("user rejected")) {
    return action === "switch"
      ? "Robinhood Chain was not selected. You can try the network switch again."
      : "Wallet connection was cancelled. Nothing was signed or submitted.";
  }
  if (code === "APKT006" || message.includes("expired") || message.includes("session")) {
    return "Your wallet session expired. Reconnect to continue.";
  }
  if (code === "APKT004" || message.includes("timeout") || message.includes("timed out")) {
    return "The wallet did not respond in time. Reopen your wallet and try again.";
  }
  if (code === "APKT002" || code === "APKT005") {
    return "Wallet connection is not enabled for this site address. Use the official Gogh Punks link or contact support.";
  }
  if (code === "APKT001") {
    return "Wallet connected, but Robinhood Chain is not available. Try the network switch again.";
  }
  if (message.includes("relay") || message.includes("network") || message.includes("fetch")) {
    return "Wallet connection is temporarily unavailable. Check your connection and try again.";
  }
  return action === "switch"
    ? "Robinhood Chain could not be selected. Open your wallet and try again."
    : "The wallet did not connect. Reopen it and try again.";
}

export function walletPresentation({ available, pending, account, chainId, owner }) {
  if (!available) {
    return {
      buttonLabel: "Wallet unavailable",
      statusText: "Wallet connection is temporarily unavailable. Refresh the page and try again.",
      state: "unavailable",
      disabled: false,
    };
  }
  if (pending) {
    return {
      buttonLabel: "Connecting…",
      statusText: "Approve only the connection request. No signature or transaction is requested.",
      state: "pending",
      disabled: false,
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
      disabled: false,
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
      disabled: false,
    };
  }
  if (ownerAddress === account) {
    return {
      buttonLabel: shortAddress,
      statusText: `${tokenLabel} selected · live ownership verified for ${shortAddress}`,
      state: "owner",
      disabled: false,
    };
  }
  return {
    buttonLabel: shortAddress,
    statusText: `${tokenLabel} selected · this connected address is not its current holder`,
    state: "viewer",
    disabled: false,
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
  browserWindow.__GOGH_WALLET_PROVIDER__ = provider;
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

function loadReownBundle(browserWindow, browserDocument) {
  if (browserWindow.GoghReownWallet?.createReownWalletSession) return Promise.resolve();
  if (browserWindow.__GOGH_REOWN_BUNDLE_PROMISE__) {
    return browserWindow.__GOGH_REOWN_BUNDLE_PROMISE__;
  }
  browserWindow.__GOGH_REOWN_BUNDLE_PROMISE__ = new Promise((resolve, reject) => {
    const script = browserDocument.createElement("script");
    // Keep this version aligned with the HTML wallet module URL. Wallet session
    // fixes must not be stranded behind a stale mobile or desktop browser cache.
    script.src = "/reown-wallet-app.js?v=reown-2";
    script.async = true;
    script.dataset.reownAppkit = "true";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("wallet bundle unavailable")), {
      once: true,
    });
    browserDocument.head.append(script);
  });
  return browserWindow.__GOGH_REOWN_BUNDLE_PROMISE__;
}

const REOWN_RETURNING_SESSION_KEY = "gogh.wallet.reown.returning.v1";
const WALLET_SCOPED_STORAGE_KEYS = Object.freeze([
  REOWN_RETURNING_SESSION_KEY,
  "gogh.artBroker.setup.v1",
  "gogh:activated-punk-ids:v1",
  "gogh.controlCenter.v2",
]);
const WALLET_SCOPED_STORAGE_PREFIXES = Object.freeze(["gogh.controlCenter.v2:"]);

function clearStorage(storage) {
  if (!storage) return;
  for (const key of WALLET_SCOPED_STORAGE_KEYS) storage.removeItem(key);
  const discovered = [];
  for (let index = 0; index < Number(storage.length ?? 0); index += 1) {
    const key = storage.key?.(index);
    if (typeof key === "string"
      && WALLET_SCOPED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      discovered.push(key);
    }
  }
  for (const key of discovered) storage.removeItem(key);
}

export function clearWalletScopedState(browserWindow) {
  try { clearStorage(browserWindow.localStorage); } catch { /* storage is optional */ }
  try { clearStorage(browserWindow.sessionStorage); } catch { /* storage is optional */ }
  browserWindow.__GOGH_OWNER_PUNKS__ = Object.freeze({ punks: Object.freeze([]) });
  browserWindow.__GOGH_AUTOMATION_SNAPSHOT__ = null;
  browserWindow.__GOGH_OWNER_SNAPSHOT__ = null;
}

function returningSessionMarker(browserWindow) {
  try {
    return browserWindow.localStorage?.getItem(REOWN_RETURNING_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function setReturningSessionMarker(browserWindow, connected) {
  try {
    if (connected) browserWindow.localStorage?.setItem(REOWN_RETURNING_SESSION_KEY, "1");
    else browserWindow.localStorage?.removeItem(REOWN_RETURNING_SESSION_KEY);
  } catch {
    // Connection state remains authoritative when storage is unavailable or full.
  }
}

export async function setupReownWallet({ windowObject, documentObject, fetchFunction,
  sessionFactory } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  if (!browserWindow || !browserDocument) return null;
  const buttons = [...browserDocument.querySelectorAll("[data-wallet-connect]")];
  const switchButtons = [...browserDocument.querySelectorAll("[data-wallet-switch]")];
  const disconnectButtons = [...browserDocument.querySelectorAll("[data-wallet-disconnect]")];
  const statusTargets = [...browserDocument.querySelectorAll("[data-wallet-state]")];
  if (!buttons.length) return null;
  const request = fetchFunction ?? browserWindow.fetch?.bind(browserWindow);
  if (!request && !sessionFactory) throw new Error("Wallet configuration is unavailable.");

  const state = {
    pending: false, account: null, chainId: null, owner: null, switching: false,
    networkError: null, provider: null, session: null, sessionStatus: "idle",
  };
  const unsubscribers = [];
  let initializationPromise = null;
  let destroyed = false;

  function render() {
    const available = state.sessionStatus !== "unavailable";
    const presentation = walletPresentation({
      available,
      pending: state.pending,
      account: state.account,
      chainId: state.chainId,
      owner: state.owner,
    });
    for (const button of buttons) {
      button.textContent = state.sessionStatus === "initializing"
        ? "Preparing wallet…" : presentation.buttonLabel;
      button.disabled = state.sessionStatus === "initializing";
      button.setAttribute("aria-disabled", String(button.disabled));
      button.dataset.walletStatus = presentation.state;
      button.title = state.account ?? presentation.buttonLabel;
    }
    for (const target of statusTargets) {
      target.textContent = state.switching
        ? "Waiting for your wallet to select Robinhood Chain…"
        : state.networkError ?? (state.account && state.chainId === ROBINHOOD_CHAIN_ID
          ? `Connected · ${shortWalletAddress(state.account)} · Robinhood Chain`
          : presentation.statusText);
      target.dataset.walletStatus = presentation.state;
    }
    for (const button of switchButtons) {
      button.hidden = presentation.state !== "wrong-network" && !state.switching;
      button.disabled = state.switching;
      button.textContent = state.switching ? "Switching network…" : "Switch Network";
    }
    for (const button of disconnectButtons) {
      button.hidden = !state.account;
      button.disabled = state.pending;
      button.textContent = state.pending ? "Disconnecting…" : "Disconnect Wallet";
      button.setAttribute("aria-disabled", String(button.disabled));
      button.title = state.account
        ? `Disconnect ${shortWalletAddress(state.account)}` : "Disconnect Wallet";
    }
    const detail = Object.freeze({
      account: state.account,
      chainId: state.chainId,
      owner: state.owner ? Object.freeze({ ...state.owner }) : null,
      status: presentation.state,
      providerType: "reown-appkit",
      restoring: state.sessionStatus === "initializing" && !state.account,
    });
    browserWindow.__GOGH_WALLET_PROVIDER__ = state.provider;
    browserWindow.__GOGH_WALLET_SNAPSHOT__ = detail;
    if (typeof browserWindow.dispatchEvent === "function"
      && typeof browserWindow.CustomEvent === "function") {
      browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:wallet-state", { detail }));
    }
  }

  function ownerSnapshot(event) {
    const detail = event?.detail ?? {};
    const address = normalizeWalletAddress(detail.address ?? detail.owner);
    const tokenId = typeof detail.tokenId === "string" && /^(0|[1-9]\d*)$/.test(detail.tokenId)
      ? detail.tokenId : null;
    state.owner = address && tokenId ? { address, tokenId, source: "selection" } : null;
    render();
  }

  async function connect() {
    if (state.pending) return;
    state.pending = true;
    state.networkError = null;
    render();
    try {
      await ensureSession();
      if (!state.session) return;
      state.pending = true;
      render();
      await (state.account && typeof state.session.openAccount === "function"
        ? state.session.openAccount() : state.session.open());
    } catch (error) {
      state.networkError = walletErrorMessage(error, "connect");
    } finally {
      state.pending = false;
      render();
    }
  }

  async function disconnect() {
    if (!state.session || !state.account || state.pending) return;
    state.pending = true;
    state.networkError = null;
    render();
    try {
      await state.session.disconnect();
      state.account = null;
      state.chainId = null;
      state.owner = null;
      state.provider = null;
      clearWalletScopedState(browserWindow);
      const events = [
        ["gogh:owner-punks", { punks: Object.freeze([]) }],
        ["gogh:automation-state", null],
        ["gogh:punk-selected", { tokenId: null, owner: null }],
        ["gogh:wallet-disconnected", { disconnected: true }],
      ];
      if (typeof browserWindow.CustomEvent === "function") {
        for (const [name, detail] of events) {
          browserWindow.dispatchEvent(new browserWindow.CustomEvent(name, { detail }));
        }
      }
    } catch (error) {
      state.networkError = walletErrorMessage(error, "disconnect");
    } finally {
      state.pending = false;
      render();
    }
  }

  async function switchNetwork() {
    if (state.switching) return;
    state.switching = true;
    state.networkError = null;
    render();
    try {
      await ensureSession();
      if (!state.session) return;
      await state.session.switchNetwork();
    } catch (error) {
      state.networkError = walletErrorMessage(error, "switch");
    } finally {
      state.switching = false;
      render();
    }
  }

  for (const button of buttons) button.addEventListener("click", connect);
  for (const button of switchButtons) button.addEventListener("click", switchNetwork);
  for (const button of disconnectButtons) button.addEventListener("click", disconnect);
  browserWindow.addEventListener("gogh:owner-snapshot", ownerSnapshot);
  browserWindow.addEventListener("gogh:punk-selected", ownerSnapshot);
  render();

  async function ensureSession() {
    if (state.session) return state.session;
    if (initializationPromise) return initializationPromise;
    state.sessionStatus = "initializing";
    state.networkError = null;
    render();
    initializationPromise = (async () => {
      try {
        let factory = sessionFactory;
        let configuration = null;
        if (!factory) {
          const response = await request("/api/broker/wallet-config", {
            headers: { accept: "application/json" }, cache: "no-store",
          });
          const payload = await response.json();
          if (!response.ok || payload?.ok !== true || payload.wallet?.configured !== true) {
            throw new Error("Reown wallet connection is not configured.");
          }
          configuration = payload.wallet;
          await loadReownBundle(browserWindow, browserDocument);
          factory = browserWindow.GoghReownWallet?.createReownWalletSession;
        }
        if (typeof factory !== "function") {
          throw new Error("Reown wallet connection is unavailable.");
        }
        if (destroyed) return null;
        state.session = factory(configuration ?? {});
        state.provider = state.session.getProvider();
        const accountState = state.session.getAccount?.();
        state.account = accountState?.isConnected
          ? normalizeWalletAddress(accountState.address) : null;
        state.chainId = Number(state.session.getNetwork?.().chainId) || null;
        setReturningSessionMarker(browserWindow, Boolean(state.account));
        unsubscribers.push(state.session.subscribeProvider((provider) => {
          state.provider = provider ?? null;
          render();
        }));
        unsubscribers.push(state.session.subscribeAccount((account) => {
          state.account = account?.isConnected ? normalizeWalletAddress(account.address) : null;
          if (!state.account) state.owner = null;
          state.pending = account?.status === "connecting" || account?.status === "reconnecting";
          setReturningSessionMarker(browserWindow, Boolean(state.account));
          render();
        }));
        unsubscribers.push(state.session.subscribeNetwork((network) => {
          state.chainId = Number(network?.chainId) || null;
          state.networkError = null;
          render();
        }));
        if (typeof state.session.subscribeState === "function") {
          unsubscribers.push(state.session.subscribeState(() => {
            const error = state.session.getError?.();
            if (error) state.networkError = walletErrorMessage({ message: error }, "connect");
            render();
          }));
        }
        const resume = () => {
          if (!state.session || destroyed) return;
          const account = state.session.getAccount?.();
          state.account = account?.isConnected ? normalizeWalletAddress(account.address) : null;
          state.chainId = Number(state.session.getNetwork?.().chainId) || null;
          state.provider = state.session.getProvider?.() ?? null;
          setReturningSessionMarker(browserWindow, Boolean(state.account));
          render();
        };
        const handleVisibility = () => {
          if (browserDocument.visibilityState === "visible") resume();
        };
        browserWindow.addEventListener("pageshow", resume);
        browserDocument.addEventListener("visibilitychange", handleVisibility);
        unsubscribers.push(() => browserWindow.removeEventListener("pageshow", resume));
        unsubscribers.push(() => browserDocument.removeEventListener?.(
          "visibilitychange", handleVisibility));
        state.sessionStatus = "ready";
        state.pending = false;
        render();
        return state.session;
      } catch {
        // Session initialization is atomic. AppKit mounts its modal as part of
        // construction, so retaining a partially initialized session can open a
        // working-looking selector while the page is permanently marked
        // unavailable. Never allow connect() to use that partial session.
        state.session = null;
        state.provider = null;
        state.sessionStatus = "unavailable";
        state.pending = false;
        state.networkError = "Wallet connection is temporarily unavailable. Please refresh and try again.";
        render();
        return null;
      }
    })();
    return initializationPromise;
  }

  // First-time visitors load no AppKit code and make no wallet/RPC calls. A known
  // prior session is different: restore it immediately. Deferring restoration to an
  // idle callback left busy/mobile pages visibly disconnected because an idle period
  // is not guaranteed while the page is rendering and fetching Punk state.
  if (returningSessionMarker(browserWindow)) {
    const restore = () => { void ensureSession(); };
    if (typeof browserWindow.queueMicrotask === "function") browserWindow.queueMicrotask(restore);
    else queueMicrotask(restore);
  }

  return Object.freeze({
    connect, disconnect, switchNetwork, ensureSession,
    get provider() { return state.provider; },
    destroy() {
      destroyed = true;
      for (const button of buttons) button.removeEventListener("click", connect);
      for (const button of switchButtons) button.removeEventListener("click", switchNetwork);
      for (const button of disconnectButtons) button.removeEventListener("click", disconnect);
      browserWindow.removeEventListener("gogh:owner-snapshot", ownerSnapshot);
      browserWindow.removeEventListener("gogh:punk-selected", ownerSnapshot);
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    },
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupReownWallet({ windowObject: window, documentObject: document });
}
