const CHAIN_ID = 4663;
const STORAGE_KEY = "gogh:activated-punk-ids:v1";
const ACTIVATION_TOPIC = "0xbcba1c8ca6488532aba261811803bc402fd692b825e2a41dd2e555ec87989cc3";
const OWNER_OF = "0x6352211e";
const ACCOUNT = "0x2dd7c658";
const MAX_SUPPLY = "0xd5abeb01";
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const AGGREGATE3 = "0x82ad56cb";

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

function byteLength(value) {
  return (value.length - 2) / 2;
}

function abiWordAt(value, byteOffset) {
  const start = 2 + byteOffset * 2;
  const wordValue = value.slice(start, start + 64);
  if (wordValue.length !== 64) throw new TypeError("Multicall response is truncated");
  return BigInt(`0x${wordValue}`);
}

export function encodeOwnerOfMulticall(collection, tokenIds) {
  const target = normalizedAddress(collection);
  if (!target || !Array.isArray(tokenIds) || tokenIds.length < 1 || tokenIds.length > 250
    || tokenIds.some((tokenId) => !/^(0|[1-9]\d{0,3})$/.test(String(tokenId)))) {
    throw new TypeError("Owner multicall input is invalid");
  }
  const bodies = tokenIds.map((tokenId) => [
    target.slice(2).padStart(64, "0"),
    word(1),
    word(96),
    word(36),
    `${OWNER_OF.slice(2)}${word(tokenId)}`.padEnd(128, "0"),
  ].join(""));
  let offset = tokenIds.length * 32;
  const offsets = bodies.map((body) => {
    const current = word(offset);
    offset += body.length / 2;
    return current;
  });
  return `${AGGREGATE3}${word(32)}${word(tokenIds.length)}${offsets.join("")}${bodies.join("")}`;
}

export function decodeOwnerOfMulticall(value, tokenIds, expectedOwner) {
  const owner = normalizedAddress(expectedOwner);
  if (!owner || !Array.isArray(tokenIds) || tokenIds.length < 1 || tokenIds.length > 250
    || tokenIds.some((tokenId) => !/^(0|[1-9]\d{0,3})$/.test(String(tokenId)))
    || typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)
    || byteLength(value) > 100_000 || abiWordAt(value, 0) !== 32n) {
    throw new TypeError("Owner multicall response is invalid");
  }
  const arrayStart = 32;
  if (abiWordAt(value, arrayStart) !== BigInt(tokenIds.length)) {
    throw new TypeError("Owner multicall result count changed");
  }
  const output = [];
  for (let index = 0; index < tokenIds.length; index += 1) {
    const relative = abiWordAt(value, arrayStart + 32 + index * 32);
    if (relative > BigInt(byteLength(value))) throw new TypeError("Owner multicall offset is invalid");
    const tupleStart = arrayStart + 32 + Number(relative);
    const success = abiWordAt(value, tupleStart);
    const bytesOffset = abiWordAt(value, tupleStart + 32);
    if (success > 1n || bytesOffset !== 64n) throw new TypeError("Owner multicall tuple is invalid");
    const resultLength = abiWordAt(value, tupleStart + Number(bytesOffset));
    if (success === 0n) continue;
    if (resultLength !== 32n) throw new TypeError("ownerOf returned an invalid address word");
    const dataStart = tupleStart + Number(bytesOffset) + 32;
    const resultWord = value.slice(2 + dataStart * 2, 2 + (dataStart + 32) * 2);
    if (!/^0{24}[0-9a-fA-F]{40}$/.test(resultWord)) {
      throw new TypeError("ownerOf returned a noncanonical address");
    }
    if (`0x${resultWord.slice(-40)}`.toLowerCase() === owner) output.push(String(tokenIds[index]));
  }
  return output;
}

export async function discoverWalletOwnedPunkIds(provider, collection, owner) {
  const target = normalizedAddress(collection);
  const expectedOwner = normalizedAddress(owner);
  if (!provider?.request || !target || !expectedOwner) throw new TypeError("Wallet scan is unavailable");
  const maximumRaw = await provider.request({
    method: "eth_call",
    params: [{ to: target, data: MAX_SUPPLY }, "latest"],
  });
  if (typeof maximumRaw !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(maximumRaw)) {
    throw new TypeError("Collection maxSupply is unavailable");
  }
  const maximum = Number(BigInt(maximumRaw));
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 9_999) {
    throw new RangeError("Collection maxSupply is outside the bounded scan range");
  }
  const chunks = [];
  for (let first = 0; first <= maximum; first += 200) {
    chunks.push(Array.from({ length: Math.min(200, maximum - first + 1) },
      (_, index) => String(first + index)));
  }
  const output = [];
  for (const tokenIds of chunks) {
    const response = await provider.request({
      method: "eth_call",
      params: [{ to: MULTICALL3, data: encodeOwnerOfMulticall(target, tokenIds) }, "latest"],
    });
    output.push(...decodeOwnerOfMulticall(response, tokenIds, expectedOwner));
    if (output.length > 200) throw new RangeError("Wallet owns more Punks than the UI can display");
  }
  return Object.freeze(output.sort((left, right) => Number(left) - Number(right)));
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
    empty.textContent = "No wallet-owned Punks were found from the indexed candidates. You can still enter a Punk ID manually above.";
    container.append(empty);
    return;
  }
  const activatedAccounts = accounts.filter(({ activated }) => activated);
  const readyCount = accounts.length - activatedAccounts.length;
  if (readyCount > 0) {
    const summary = document.createElement("p");
    summary.className = "empty-state owner-account-summary";
    summary.textContent = `${readyCount} additional wallet-owned ${readyCount === 1 ? "Punk is" : "Punks are"} ready in the activation selector above.`;
    container.append(summary);
  }
  for (const item of activatedAccounts) {
    const card = document.createElement("article");
    card.className = "panel owner-account-card";
    const identity = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = item.activated ? "Activated Punk Account" : "Owned Punk · ready to activate";
    const title = document.createElement("h3");
    const gallery = document.createElement("a");
    gallery.href = `/punk/${encodeURIComponent(item.tokenId)}`;
    gallery.textContent = `Gogh Punk #${item.tokenId}`;
    title.append(gallery);
    const label = document.createElement("p");
    label.className = "locked-note";
    label.textContent = item.activated
      ? "Agent wallet address (no agent authority or autonomy implied)"
      : "Deterministic future agent-wallet address";
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
    badge.classList.toggle("off", !item.activated);
    badge.textContent = item.activated ? "ACTIVATED ONCHAIN" : "READY TO ACTIVATE";
    card.append(identity, badge);
    container.append(card);
  }
}

export async function findBrowserOwnedPunks(provider, gate, owner, tokenIds = []) {
  const bindings = gate?.bindings;
  const normalizedOwner = normalizedAddress(owner);
  if (!provider?.request || gate?.capability !== true || !normalizedOwner
    || !normalizedAddress(bindings?.punkCollection)
    || !normalizedAddress(bindings?.accountRegistry)) throw new Error("live gate unavailable");
  const candidates = [...new Set(tokenIds.map(String).filter(
    (value) => /^(0|[1-9]\d{0,3})$/.test(value),
  ))].slice(0, 200);
  const output = [];
  for (let offset = 0; offset < candidates.length; offset += 12) {
    const batch = await Promise.allSettled(candidates.slice(offset, offset + 12).map(async (tokenId) => {
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
      if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) return null;
      return Object.freeze({ tokenId, account, owner: normalizedOwner,
        activated: code !== "0x", status: code === "0x" ? "READY_TO_ACTIVATE" : "ACTIVATED_ONCHAIN" });
    }));
    output.push(...batch.flatMap((result) => (
      result.status === "fulfilled" && result.value ? [result.value] : []
    )));
  }
  return output.sort((left, right) => Number(left.tokenId) - Number(right.tokenId));
}

function renderPunkPicker(picker, accounts, preferredTokenId = "") {
  if (!picker) return;
  const documentObject = picker.ownerDocument ?? globalThis.document;
  const placeholder = documentObject.createElement("option");
  placeholder.value = "";
  placeholder.textContent = accounts.length
    ? "Choose a Punk to inspect or activate"
    : "No wallet-owned Punks found · enter an ID manually";
  picker.replaceChildren(placeholder, ...accounts.map((item) => {
    const option = documentObject.createElement("option");
    option.value = item.tokenId;
    option.textContent = `Punk #${item.tokenId} — ${item.activated ? "activated" : "owned · inspect account"}`;
    return option;
  }));
  picker.disabled = accounts.length === 0;
  if (accounts.some(({ tokenId }) => tokenId === preferredTokenId)) picker.value = preferredTokenId;
}

export async function findBrowserOwnerAccounts(provider, gate, owner, hints = []) {
  const bindings = gate?.bindings;
  const normalizedOwner = normalizedAddress(owner);
  if (!provider?.request || gate?.capability !== true || !normalizedOwner
    || !normalizedAddress(bindings?.punkCollection)
    || !normalizedAddress(bindings?.accountRegistry)) throw new Error("live gate unavailable");
  // Punk #1639's confirmed autonomous-canary activation is older than the bounded log scan. It is
  // only a discovery hint: live owner, derived account, and deployed code are still rechecked.
  const candidates = new Set(["1639", "1797", ...hints]);
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
  const picker = browserDocument?.querySelector?.("[data-owned-punk-picker]");
  const mandatePicker = browserDocument?.querySelector?.("[data-mandate-punk-picker]");
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
      renderPunkPicker(picker, []);
      renderPunkPicker(mandatePicker, []);
      container.innerHTML = '<p class="empty-state">Connect the owner wallet on Robinhood Chain to load activated Punk Accounts.</p>';
      return;
    }
    container.innerHTML = '<p class="empty-state loading">Loading indexed candidates and checking each live owner…</p>';
    try {
      const [gateResponse, candidatesResponse] = await Promise.all([
        request("/api/broker/account-activation-status", {
          headers: { accept: "application/json" }, cache: "no-store",
        }),
        request(`/api/broker/owner-punks?owner=${encodeURIComponent(wallet.account)}`, {
          headers: { accept: "application/json" }, cache: "no-store",
        }),
      ]);
      const [gatePayload, candidatesPayload] = await Promise.all([
        gateResponse.json(), candidatesResponse.json(),
      ]);
      const indexed = candidatesResponse.ok && candidatesPayload?.ok === true
        && Array.isArray(candidatesPayload.candidateTokenIds)
        ? candidatesPayload.candidateTokenIds : [];
      let walletOwned = [];
      try {
        walletOwned = await discoverWalletOwnedPunkIds(browserWindow.ethereum,
          gatePayload.activationGate?.bindings?.punkCollection, wallet.account);
      } catch {
        // The bounded server and local candidates remain available and are each rechecked live.
      }
      const remembered = knownTokenIds(browserWindow.localStorage);
      const candidates = [...new Set([
        "1639", "1797", ...remembered, ...indexed, ...walletOwned,
      ])];
      let accounts;
      if (walletOwned.length > 0) {
        const activated = await findBrowserOwnerAccounts(browserWindow.ethereum,
          gatePayload.activationGate, wallet.account, [...remembered, ...indexed]);
        const activatedById = new Map(activated.map((item) => [item.tokenId,
          Object.freeze({ ...item, activated: true })]));
        accounts = walletOwned.map((tokenId) => activatedById.get(tokenId) ?? Object.freeze({
          tokenId,
          account: null,
          owner: wallet.account.toLowerCase(),
          activated: false,
          status: "OWNED_LIVE_ACCOUNT_STATUS_CHECKED_ON_SELECTION",
        }));
      } else {
        accounts = await findBrowserOwnedPunks(browserWindow.ethereum,
          gatePayload.activationGate, wallet.account, candidates);
      }
      if (current !== revision) return;
      for (const item of accounts) {
        if (item.activated) rememberActivatedPunk(browserWindow.localStorage, item.tokenId);
      }
      const activatedCount = accounts.filter(({ activated }) => activated).length;
      const readyCount = accounts.length - activatedCount;
      setCount(activatedCount, readyCount > 0
        ? `${readyCount} more owned ${readyCount === 1 ? "Punk" : "Punks"} ready to activate`
        : "Live ownership verified");
      renderPunkPicker(picker, accounts);
      const previousMandate = mandatePicker?.value ?? "";
      const mandateTokenId = accounts.some(({ tokenId }) => tokenId === previousMandate)
        ? previousMandate
        : accounts.find(({ tokenId }) => tokenId === "1797")?.tokenId ?? accounts[0]?.tokenId ?? "";
      renderPunkPicker(mandatePicker, accounts, mandateTokenId);
      renderOwnerAccounts(container, accounts);
      if (mandateTokenId) {
        browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:mandate-punk-selected", {
          detail: { tokenId: mandateTokenId, owner: wallet.account.toLowerCase() },
        }));
      }
    } catch {
      if (current !== revision) return;
      setCount(0, "Live check unavailable");
      renderPunkPicker(picker, []);
      renderPunkPicker(mandatePicker, []);
      container.innerHTML = '<p class="empty-state">Activated accounts could not be checked right now. No account status was inferred from stale indexed data.</p>';
    }
  }

  browserWindow.addEventListener("gogh:wallet-state", refresh);
  picker?.addEventListener("change", () => {
    if (!picker.value) return;
    browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:punk-selected", {
      detail: { tokenId: picker.value },
    }));
  });
  mandatePicker?.addEventListener("change", () => {
    if (!mandatePicker.value) return;
    const wallet = browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;
    if (!wallet?.account) return;
    browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:mandate-punk-selected", {
      detail: { tokenId: mandatePicker.value, owner: wallet.account.toLowerCase() },
    }));
  });
  refresh({ detail: browserWindow.__GOGH_WALLET_SNAPSHOT__ });
  return Object.freeze({ refresh });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupOwnerAccounts({ windowObject: window, documentObject: document });
}
