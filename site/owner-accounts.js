const CHAIN_ID = 4663;
const STORAGE_KEY = "gogh:activated-punk-ids:v1";
const ACTIVATION_TOPIC = "0xbcba1c8ca6488532aba261811803bc402fd692b825e2a41dd2e555ec87989cc3";
const OWNER_OF = "0x6352211e";
const ACCOUNT = "0x2dd7c658";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function normalizedAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase() : null;
}

function decodedAddress(value) {
  return typeof value === "string" && /^0x0{24}[0-9a-fA-F]{40}$/.test(value)
    ? `0x${value.slice(-40)}`.toLowerCase() : null;
}

function knownTokenIds(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((value) => /^(0|[1-9]\d{0,3})$/.test(value)))].slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

export function rememberActivatedPunk(storage, tokenId) {
  if (!/^(0|[1-9]\d{0,3})$/.test(String(tokenId))) return;
  try {
    const values = knownTokenIds(storage);
    if (!values.includes(String(tokenId))) values.push(String(tokenId));
    storage?.setItem(STORAGE_KEY, JSON.stringify(values.slice(-20)));
  } catch {
    // Storage is a convenience hint only. Live chain checks remain authoritative.
  }
}

function shortAddress(value) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function renderOwnerAccounts(container, accounts) {
  container.replaceChildren();
  if (!accounts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No activated Punk Accounts were found in the live checked range.";
    container.append(empty);
    return;
  }
  for (const item of accounts) {
    const card = document.createElement("article");
    card.className = "panel owner-account-card";
    const identity = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Activated Punk Account";
    const title = document.createElement("h3");
    const gallery = document.createElement("a");
    gallery.href = `/punk/${encodeURIComponent(item.tokenId)}`;
    gallery.textContent = `Gogh Punk #${item.tokenId}`;
    title.append(gallery);
    const label = document.createElement("p");
    label.className = "locked-note";
    label.textContent = "Agent wallet address (no agent authority or autonomy implied)";
    const account = document.createElement("a");
    account.className = "owner-account-address";
    account.href = `https://robinhoodchain.blockscout.com/address/${item.account}`;
    account.target = "_blank";
    account.rel = "noopener noreferrer";
    account.textContent = `${shortAddress(item.account)} ↗`;
    account.title = item.account;
    identity.append(eyebrow, title, label, account);
    const badge = document.createElement("span");
    badge.className = "tag";
    badge.textContent = "ACTIVATED ONCHAIN";
    card.append(identity, badge);
    container.append(card);
  }
}

export async function findBrowserOwnerAccounts(provider, gate, owner, hints = []) {
  const bindings = gate?.bindings;
  const normalizedOwner = normalizedAddress(owner);
  if (!provider?.request || gate?.capability !== true || !normalizedOwner
    || !normalizedAddress(bindings?.punkCollection)
    || !normalizedAddress(bindings?.accountRegistry)) throw new Error("live gate unavailable");
  const candidates = new Set(["1797", ...hints]);
  try {
    const headHex = await provider.request({ method: "eth_blockNumber" });
    const head = BigInt(headHex);
    const from = head > 100_000n ? head - 100_000n : 0n;
    const logs = await provider.request({ method: "eth_getLogs", params: [{
      address: bindings.accountRegistry,
      fromBlock: `0x${from.toString(16)}`,
      toBlock: "latest",
      topics: [
        ACTIVATION_TOPIC,
        null,
        `0x${word(CHAIN_ID)}`,
        `0x${bindings.punkCollection.slice(2).padStart(64, "0")}`,
      ],
    }] });
    for (const log of Array.isArray(logs) ? logs : []) {
      if (typeof log?.data !== "string" || !/^0x[0-9a-fA-F]{256}$/.test(log.data)) continue;
      const eventOwner = decodedAddress(`0x${log.data.slice(66, 130)}`);
      const id = BigInt(`0x${log.data.slice(2, 66)}`);
      if (eventOwner === normalizedOwner && id <= 9999n) candidates.add(id.toString());
    }
  } catch {
    // Exact locally remembered tokens still receive live ownership/code checks below.
  }
  const results = await Promise.allSettled([...candidates].slice(0, 21).map(async (tokenId) => {
    const encoded = word(tokenId);
    const [ownerRaw, accountRaw] = await Promise.all([
      provider.request({ method: "eth_call", params: [{ to: bindings.punkCollection,
        data: `${OWNER_OF}${encoded}` }, "latest"] }),
      provider.request({ method: "eth_call", params: [{ to: bindings.accountRegistry,
        data: `${ACCOUNT}${encoded}` }, "latest"] }),
    ]);
    const liveOwner = decodedAddress(ownerRaw);
    const account = decodedAddress(accountRaw);
    if (liveOwner !== normalizedOwner || !account) return null;
    const code = await provider.request({ method: "eth_getCode", params: [account, "latest"] });
    if (typeof code !== "string" || code === "0x") return null;
    return Object.freeze({ tokenId, account, owner: normalizedOwner,
      status: "ACTIVATED_ONCHAIN" });
  }));
  return results.flatMap((result) => (
    result.status === "fulfilled" && result.value ? [result.value] : []
  )).sort((left, right) => Number(left.tokenId) - Number(right.tokenId));
}

export function setupOwnerAccounts({ windowObject, documentObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  const container = browserDocument?.querySelector?.("[data-owner-accounts]");
  if (!browserWindow || !container) return null;
  const request = fetchFunction ?? browserWindow.fetch.bind(browserWindow);
  let revision = 0;

  function setCount(count, detail) {
    browserDocument.querySelectorAll("[data-punk-account-count]").forEach((target) => {
      target.textContent = String(count);
    });
    browserDocument.querySelectorAll("[data-punk-account-detail]").forEach((target) => {
      target.textContent = detail;
    });
  }

  async function refresh(event) {
    const wallet = event?.detail ?? browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;
    const current = ++revision;
    if (!wallet?.account || wallet.chainId !== CHAIN_ID) {
      setCount(0, "Connect owner wallet");
      container.innerHTML = '<p class="empty-state">Connect the owner wallet on Robinhood Chain to load activated Punk Accounts.</p>';
      return;
    }
    container.innerHTML = '<p class="empty-state loading">Checking recent activations and live ownership…</p>';
    try {
      const gateResponse = await request("/api/broker/account-activation-status", {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      const gatePayload = await gateResponse.json();
      const accounts = await findBrowserOwnerAccounts(
        browserWindow.ethereum,
        gatePayload.activationGate,
        wallet.account,
        knownTokenIds(browserWindow.localStorage),
      );
      if (current !== revision) return;
      for (const item of accounts) rememberActivatedPunk(browserWindow.localStorage, item.tokenId);
      setCount(accounts.length, "Live wallet RPC verified");
      renderOwnerAccounts(container, accounts);
    } catch {
      if (current !== revision) return;
      setCount(0, "Live check unavailable");
      container.innerHTML = '<p class="empty-state">Activated accounts could not be checked right now. No account status was inferred from stale indexed data.</p>';
    }
  }

  browserWindow.addEventListener("gogh:wallet-state", refresh);
  refresh({ detail: browserWindow.__GOGH_WALLET_SNAPSHOT__ });
  return Object.freeze({ refresh });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupOwnerAccounts({ windowObject: window, documentObject: document });
}
