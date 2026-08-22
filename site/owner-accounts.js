const CHAIN_ID = 4663;
const STORAGE_KEY = "gogh:activated-punk-ids:v1";

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
      const tokens = knownTokenIds(browserWindow.localStorage).join(",");
      const response = await request(
        `/api/broker/owner-accounts?owner=${encodeURIComponent(wallet.account)}&tokens=${encodeURIComponent(tokens)}`,
        { headers: { accept: "application/json" }, cache: "no-store" },
      );
      const payload = await response.json();
      if (current !== revision) return;
      if (!response.ok || payload?.ok !== true || !Array.isArray(payload.activatedPunks)) {
        throw new Error("live account response unavailable");
      }
      for (const item of payload.activatedPunks) {
        rememberActivatedPunk(browserWindow.localStorage, item.tokenId);
      }
      setCount(payload.activatedPunks.length, "Live chain verified");
      renderOwnerAccounts(container, payload.activatedPunks);
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
