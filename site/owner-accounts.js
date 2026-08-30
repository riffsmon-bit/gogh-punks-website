const CHAIN_ID = 4663;
const STORAGE_KEY = "gogh:activated-punk-ids:v1";
const ACTIVATION_TOPIC = "0xbcba1c8ca6488532aba261811803bc402fd692b825e2a41dd2e555ec87989cc3";
const OWNER_OF = "0x6352211e";
const ACCOUNT = "0x2dd7c658";
const IS_ACCOUNT_CREATED = "0x6170c368";
const MAX_SUPPLY = "0xd5abeb01";
const TOKEN_URI = "0xc87b56dd";
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

function encodeUintMulticall(contract, selector, tokenIds) {
  const target = normalizedAddress(contract);
  if (!target || !Array.isArray(tokenIds) || tokenIds.length < 1 || tokenIds.length > 250
    || typeof selector !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(selector)
    || tokenIds.some((tokenId) => !/^(0|[1-9]\d{0,3})$/.test(String(tokenId)))) {
    throw new TypeError("Uint multicall input is invalid");
  }
  const bodies = tokenIds.map((tokenId) => [
    target.slice(2).padStart(64, "0"),
    word(1),
    word(96),
    word(36),
    `${selector.slice(2)}${word(tokenId)}`.padEnd(128, "0"),
  ].join(""));
  let offset = tokenIds.length * 32;
  const offsets = bodies.map((body) => {
    const current = word(offset);
    offset += body.length / 2;
    return current;
  });
  return `${AGGREGATE3}${word(32)}${word(tokenIds.length)}${offsets.join("")}${bodies.join("")}`;
}

export function encodeOwnerOfMulticall(collection, tokenIds) {
  try {
    return encodeUintMulticall(collection, OWNER_OF, tokenIds);
  } catch {
    throw new TypeError("Owner multicall input is invalid");
  }
}

function decodeWordMulticall(value, tokenIds) {
  if (!Array.isArray(tokenIds) || tokenIds.length < 1 || tokenIds.length > 250
    || tokenIds.some((tokenId) => !/^(0|[1-9]\d{0,3})$/.test(String(tokenId)))
    || typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)
    || byteLength(value) > 100_000 || abiWordAt(value, 0) !== 32n) {
    throw new TypeError("Multicall response is invalid");
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
    if (success === 0n) {
      output.push(null);
      continue;
    }
    if (resultLength !== 32n) throw new TypeError("Multicall returned an invalid word");
    const dataStart = tupleStart + Number(bytesOffset) + 32;
    const resultWord = value.slice(2 + dataStart * 2, 2 + (dataStart + 32) * 2);
    if (!/^[0-9a-fA-F]{64}$/.test(resultWord)) throw new TypeError("Multicall word is invalid");
    output.push(`0x${resultWord.toLowerCase()}`);
  }
  return output;
}

export function decodeOwnerOfMulticall(value, tokenIds, expectedOwner) {
  const owner = normalizedAddress(expectedOwner);
  if (!owner) throw new TypeError("Owner multicall response is invalid");
  let words;
  try { words = decodeWordMulticall(value, tokenIds); } catch {
    throw new TypeError("Owner multicall response is invalid");
  }
  return tokenIds.flatMap((tokenId, index) => {
    const resultWord = words[index];
    if (resultWord === null) return [];
    const decoded = decodedAddress(resultWord);
    if (!decoded) throw new TypeError("ownerOf returned a noncanonical address");
    return decoded === owner ? [String(tokenId)] : [];
  });
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
  // A 5,016-token collection needs 26 bounded Multicall reads. Running those serially made
  // wallet discovery appear hung on normal mobile RPC latency. Four workers materially reduce
  // the wait without creating an unbounded provider burst.
  let cursor = 0;
  const scan = async () => {
    while (cursor < chunks.length) {
      const tokenIds = chunks[cursor];
      cursor += 1;
      const response = await provider.request({
        method: "eth_call",
        params: [{ to: MULTICALL3, data: encodeOwnerOfMulticall(target, tokenIds) }, "latest"],
      });
      output.push(...decodeOwnerOfMulticall(response, tokenIds, expectedOwner));
      if (output.length > 200) {
        throw new RangeError("Wallet owns more Punks than the UI can display");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, () => scan()));
  return Object.freeze(output.sort((left, right) => Number(left) - Number(right)));
}

const TRANSIENT_WALLET_STATES = new Set(["pending", "unavailable"]);
const SETTLE_RECHECK_MS = 1_000;

// A wallet session restore republishes the snapshot at every step: no account yet, then an
// account whose network has not been reported yet, then the settled pair. Those intermediate
// frames are not a disconnect, and discovery must not treat them as one — doing so cancels the
// scan already running for the real owner and publishes an empty roster in its place.
export function walletDiscoveryIntent(wallet, chainId = CHAIN_ID) {
  if (!wallet || typeof wallet !== "object") return "settled";
  const account = normalizedAddress(wallet.account);
  if (account && wallet.chainId === chainId) return "ready";
  if (TRANSIENT_WALLET_STATES.has(wallet.status)) return "transient";
  // An account with no network yet is mid-restore. A real wrong-network snapshot reports the
  // chain it is actually on.
  if (account && (wallet.chainId === null || wallet.chainId === undefined)) return "transient";
  return "settled";
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

export function requestedBrokerPunk(value) {
  try {
    const tokenId = new URL(String(value)).searchParams.get("punk");
    return /^(0|[1-9]\d{0,3})$/.test(tokenId ?? "") ? tokenId : null;
  } catch {
    return null;
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

function trustedArtworkUrl(value) {
  if (typeof value !== "string") return null;
  if (/^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    && value.length <= 750_000) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["i.seadn.io", "raw2.seadn.io"].includes(url.hostname)
      && !url.username && !url.password && !url.port && !url.hash ? url.href : null;
  } catch {
    return null;
  }
}

function decodeAbiString(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)
    || value.length > 3_000_002 || value.length < 130) {
    throw new TypeError("tokenURI result is invalid");
  }
  const byteCount = (value.length - 2) / 2;
  const offset = Number(BigInt(`0x${value.slice(2, 66)}`));
  if (!Number.isSafeInteger(offset) || offset !== 32) throw new TypeError("tokenURI offset is invalid");
  const lengthStart = 2 + offset * 2;
  const length = Number(BigInt(`0x${value.slice(lengthStart, lengthStart + 64)}`));
  const dataStart = lengthStart + 64;
  if (!Number.isSafeInteger(length) || length < 1 || length > 750_000
    || dataStart + length * 2 > value.length) throw new TypeError("tokenURI length is invalid");
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(dataStart + index * 2, dataStart + index * 2 + 2), 16);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function decodedBase64Json(value, atobFn = globalThis.atob) {
  const prefix = "data:application/json;base64,";
  if (typeof value !== "string" || !value.startsWith(prefix)
    || typeof atobFn !== "function" || value.length > 750_000) {
    throw new TypeError("Punk metadata URI is invalid");
  }
  const encoded = value.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new TypeError("Punk metadata is invalid");
  const binary = atobFn(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function metadataRarityTier(metadata) {
  const attributes = metadata && typeof metadata === "object"
    && Object.hasOwn(metadata, "attributes") ? metadata.attributes : null;
  if (!Array.isArray(attributes)) return null;
  for (const attribute of attributes) {
    if (!attribute || typeof attribute !== "object" || Array.isArray(attribute)) continue;
    const traitType = Object.hasOwn(attribute, "trait_type") ? attribute.trait_type : null;
    const traitValue = Object.hasOwn(attribute, "value") ? attribute.value : null;
    if (typeof traitType !== "string" || traitType.trim().toLowerCase() !== "rarity"
      || typeof traitValue !== "string") continue;
    const tier = traitValue.trim().toUpperCase();
    if (["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"].includes(tier)) {
      return tier;
    }
  }
  return null;
}

export function decodeOnchainPunkDecoration(value, tokenId, atobFn = globalThis.atob) {
  const metadata = decodedBase64Json(decodeAbiString(value), atobFn);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Punk metadata is invalid");
  }
  const image = Object.hasOwn(metadata, "image") ? trustedArtworkUrl(metadata.image) : null;
  const name = Object.hasOwn(metadata, "name") && typeof metadata.name === "string"
    ? metadata.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) : null;
  if (!image) throw new TypeError("Punk metadata image is unavailable");
  const rarityTier = metadataRarityTier(metadata);
  return Object.freeze({
    artwork: Object.freeze({ name: name || `Gogh Punk #${tokenId}`, imageUrl: image }),
    rarity: rarityTier ? Object.freeze({
      source: "ONCHAIN_METADATA_TRAIT_CURRENT",
      proposedTier: rarityTier,
      permanentSnapshot: false,
    }) : null,
  });
}

const onchainDecorationCache = new Map();

export async function hydrateOnchainPunkDecorations(provider, collection, accounts,
  { concurrency = 4 } = {}) {
  const target = normalizedAddress(collection);
  if (!provider?.request || !target || !Array.isArray(accounts)
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new TypeError("Punk artwork hydration is unavailable");
  }
  const output = accounts.map((item) => ({ ...item }));
  let cursor = 0;
  async function worker() {
    while (cursor < output.length) {
      const index = cursor;
      cursor += 1;
      const item = output[index];
      if (trustedArtworkUrl(item.artwork?.imageUrl)) continue;
      const cacheKey = `${target}:${item.tokenId}`;
      let decoration = onchainDecorationCache.get(cacheKey);
      try {
        if (!decoration) {
          const response = await provider.request({
            method: "eth_call",
            params: [{ to: target, data: `${TOKEN_URI}${word(item.tokenId)}` }, "latest"],
          });
          decoration = decodeOnchainPunkDecoration(response, item.tokenId);
          onchainDecorationCache.set(cacheKey, decoration);
        }
        item.artwork = decoration.artwork;
        if (!item.rarity && decoration.rarity) item.rarity = decoration.rarity;
      } catch {
        // Artwork is decorative. Ownership and activation remain live-chain checked separately.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, output.length) }, () => worker()));
  return Object.freeze(output.map((item) => Object.freeze(item)));
}

export function priorityArtworkAccounts(accounts, selectedTokenId = "") {
  if (!Array.isArray(accounts) || accounts.length > 200
    || typeof selectedTokenId !== "string") {
    throw new TypeError("Punk artwork priority input is invalid");
  }
  return Object.freeze(accounts.filter((item) => item && typeof item === "object"
    && (item.activated === true || item.automationConfigured === true
      || item.automationCreated === true
      || item.tokenId === selectedTokenId)));
}

export function renderSelectedPunkPreview(container, accounts, selectedTokenId = "") {
  if (!container) return;
  const documentObject = container.ownerDocument ?? globalThis.document;
  container.replaceChildren();
  const item = accounts.find(({ tokenId }) => tokenId === selectedTokenId) ?? null;
  if (!item) {
    const empty = documentObject.createElement("p");
    empty.className = "empty-state";
    empty.textContent = accounts.length
      ? "Choose a Punk above to load its artwork."
      : "Connect your wallet to see your Gogh Punks.";
    container.append(empty);
    return;
  }
  const imageUrl = trustedArtworkUrl(item.artwork?.imageUrl);
  const visual = documentObject.createElement(imageUrl ? "img" : "span");
  if (imageUrl) {
    visual.src = imageUrl;
    visual.alt = item.artwork?.name || `Gogh Punk #${item.tokenId}`;
    visual.decoding = "async";
  } else {
    visual.className = "selected-punk-placeholder loading";
    visual.textContent = `#${item.tokenId}`;
  }
  const detail = documentObject.createElement("div");
  const label = documentObject.createElement("strong");
  label.textContent = `Punk #${item.tokenId}`;
  const status = documentObject.createElement("small");
  const lifecycle = item.rarity?.rank && item.rarity?.proposedTier
    ? ` · OpenRarity #${item.rarity.rank.toLocaleString()} · ${item.rarity.proposedTier.toLowerCase()} preview`
    : "";
  status.textContent = `${item.activated ? "Active wallet" : "Ready to activate"}${lifecycle}`;
  detail.append(label, status);
  container.append(visual, detail);
}

export async function copyPunkAccountAddress(navigatorObject, value) {
  const account = normalizedAddress(value);
  if (!account || typeof navigatorObject?.clipboard?.writeText !== "function") {
    throw new TypeError("Punk Account address cannot be copied");
  }
  await navigatorObject.clipboard.writeText(account);
  return account;
}

export function selectedPunkGalleryPath(tokenId) {
  const value = String(tokenId ?? "");
  if (!/^(0|[1-9]\d{0,3})$/.test(value)) {
    throw new TypeError("Selected Punk token ID is invalid");
  }
  return `/punk/${encodeURIComponent(value)}`;
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
      ? "Legacy V1 Punk wallet · separate from the V3 automation NFT wallet"
      : "Deterministic future agent-wallet address";
    const account = document.createElement("a");
    account.className = "owner-account-address";
    account.href = `https://robinhoodchain.blockscout.com/address/${item.account}`;
    account.target = "_blank";
    account.rel = "noopener noreferrer";
    account.textContent = `${shortAddress(item.account)} ↗`;
    account.title = item.account;
    const actions = document.createElement("div");
    actions.className = "owner-account-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "status-refresh-button";
    copy.textContent = "Copy V1 wallet address";
    copy.setAttribute("aria-label", `Copy Punk #${item.tokenId} legacy V1 wallet address`);
    copy.addEventListener("click", async () => {
      copy.disabled = true;
      try {
        await copyPunkAccountAddress(container.ownerDocument?.defaultView?.navigator,
          item.account);
        copy.textContent = "Address copied";
      } catch {
        copy.textContent = "Copy unavailable";
      }
      container.ownerDocument?.defaultView?.setTimeout?.(() => {
        copy.textContent = "Copy V1 wallet address";
        copy.disabled = false;
      }, 1_800);
    });
    const openSea = document.createElement("a");
    openSea.className = "status-refresh-button owner-account-opensea";
    openSea.href = `https://opensea.io/${item.account}`;
    openSea.target = "_blank";
    openSea.rel = "noopener noreferrer";
    openSea.textContent = "View V1 NFTs on OpenSea ↗";
    actions.append(copy, openSea);
    identity.append(eyebrow, title, label, account, actions);
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
  if (candidates.length === 0) return [];

  // Ownership, deterministic account addresses, and deployment state are all view calls with the
  // same uint256 input. Batch each field through Multicall3 so a mobile wallet performs three RPC
  // round trips total instead of up to three requests per Punk. The action paths still repeat the
  // live owner/account checks immediately before any transaction is constructed.
  const [ownerResponse, accountResponse, createdResponse] = await Promise.all([
    provider.request({ method: "eth_call", params: [{ to: MULTICALL3,
      data: encodeUintMulticall(bindings.punkCollection, OWNER_OF, candidates) }, "latest"] }),
    provider.request({ method: "eth_call", params: [{ to: MULTICALL3,
      data: encodeUintMulticall(bindings.accountRegistry, ACCOUNT, candidates) }, "latest"] }),
    provider.request({ method: "eth_call", params: [{ to: MULTICALL3,
      data: encodeUintMulticall(bindings.accountRegistry, IS_ACCOUNT_CREATED, candidates) }, "latest"] }),
  ]);
  const ownerWords = decodeWordMulticall(ownerResponse, candidates);
  const accountWords = decodeWordMulticall(accountResponse, candidates);
  const createdWords = decodeWordMulticall(createdResponse, candidates);
  return candidates.flatMap((tokenId, index) => {
    const liveOwner = ownerWords[index] === null ? null : decodedAddress(ownerWords[index]);
    if (liveOwner !== normalizedOwner) return [];
    const account = accountWords[index] === null ? null : decodedAddress(accountWords[index]);
    const createdWord = createdWords[index];
    if (!account || createdWord === null || (createdWord !== `0x${word(0)}`
      && createdWord !== `0x${word(1)}`)) {
      throw new TypeError("Punk account multicall returned invalid state");
    }
    const activated = createdWord === `0x${word(1)}`;
    return [Object.freeze({
      tokenId,
      account,
      owner: normalizedOwner,
      activated,
      status: activated ? "ACTIVATED_ONCHAIN" : "READY_TO_ACTIVATE",
    })];
  });
}

function renderPunkPicker(picker, accounts, preferredTokenId = "") {
  if (!picker) return;
  const documentObject = picker.ownerDocument ?? globalThis.document;
  const placeholder = documentObject.createElement("option");
  placeholder.value = "";
  placeholder.textContent = accounts.length
    ? "Choose one of my Punks"
    : "No wallet-owned Punks found";
  picker.replaceChildren(placeholder, ...accounts.map((item) => {
    const option = documentObject.createElement("option");
    option.value = item.tokenId;
    option.textContent = `Punk #${item.tokenId}`;
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
  const candidates = new Set(hints);
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

export function mergeWalletAndActivatedPunks(walletOwned, activated, owner) {
  const normalizedOwner = normalizedAddress(owner);
  if (!normalizedOwner || !Array.isArray(walletOwned) || !Array.isArray(activated)
    || walletOwned.length > 200 || activated.length > 200) {
    throw new TypeError("Punk account merge input is invalid");
  }
  const activatedById = new Map();
  for (const item of activated) {
    if (!item || !/^(0|[1-9]\d{0,3})$/.test(item.tokenId)
      || normalizedAddress(item.account) !== item.account
      || normalizedAddress(item.owner) !== normalizedOwner) {
      throw new TypeError("Live activated Punk evidence is invalid");
    }
    activatedById.set(item.tokenId, Object.freeze({ ...item, activated: true }));
  }
  const tokenIds = new Set();
  for (const tokenId of walletOwned) {
    if (!/^(0|[1-9]\d{0,3})$/.test(tokenId)) {
      throw new TypeError("Wallet-owned Punk evidence is invalid");
    }
    tokenIds.add(tokenId);
  }
  for (const tokenId of activatedById.keys()) tokenIds.add(tokenId);
  return [...tokenIds].map((tokenId) => activatedById.get(tokenId) ?? Object.freeze({
    tokenId,
    account: null,
    owner: normalizedOwner,
    activated: false,
    status: "OWNED_LIVE_ACCOUNT_STATUS_CHECKED_ON_SELECTION",
  })).sort((left, right) => Number(left.tokenId) - Number(right.tokenId));
}

export function setupOwnerAccounts({ windowObject, documentObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  const container = browserDocument?.querySelector?.("[data-owner-accounts]");
  const picker = browserDocument?.querySelector?.("[data-owned-punk-picker]");
  const mandatePicker = browserDocument?.querySelector?.("[data-mandate-punk-picker]");
  const workspacePicker = browserDocument?.querySelector?.("[data-workspace-punk-picker]");
  const selectedPreview = browserDocument?.querySelector?.("[data-workspace-punk-preview]");
  if (!browserWindow || (!container && !picker && !mandatePicker && !workspacePicker)) return null;
  const request = fetchFunction ?? browserWindow.fetch.bind(browserWindow);
  let revision = 0;
  let currentAccounts = [];
  let currentCollection = null;
  let requestedTokenId = requestedBrokerPunk(browserWindow.location?.href);
  let recheckTimer = null;

  function announceOwnerPunks(accounts, owner = null) {
    const detail = Object.freeze({
      owner: typeof owner === "string" ? owner.toLowerCase() : null,
      tokenIds: Object.freeze(accounts.map(({ tokenId }) => tokenId)),
      punks: Object.freeze(accounts.map((item) => Object.freeze({
        tokenId: item.tokenId,
        account: item.account ?? null,
        activated: item.activated === true,
        automationConfigured: item.automationConfigured === true,
        automationCreated: item.automationCreated === true,
        agentSummary: item.agentSummary ? Object.freeze({ ...item.agentSummary }) : null,
        artwork: item.artwork ? Object.freeze({ ...item.artwork }) : null,
        rarity: item.rarity ? Object.freeze({ ...item.rarity }) : null,
      }))),
    });
    browserWindow.__GOGH_OWNER_PUNKS__ = detail;
    browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:owner-punks", { detail }));
  }

  function setContainerHtml(value) {
    if (container) container.innerHTML = value;
  }

  function setCounts(owned, activated, detail, ownedDetail = null) {
    browserDocument.querySelectorAll("[data-owned-punk-count]").forEach((target) => {
      target.textContent = owned === null ? "—" : String(owned);
    });
    browserDocument.querySelectorAll("[data-owned-punk-detail]").forEach((target) => {
      target.textContent = owned === null ? detail : ownedDetail ?? "Live wallet ownership verified";
    });
    browserDocument.querySelectorAll("[data-punk-account-count]").forEach((target) => {
      target.textContent = activated === null ? "—" : String(activated);
    });
    browserDocument.querySelectorAll("[data-punk-account-detail]").forEach((target) => {
      target.textContent = detail;
    });
  }

  function setSelected(tokenId = "") {
    browserDocument.querySelectorAll("[data-selected-punk-display]").forEach((target) => {
      target.textContent = tokenId ? `#${tokenId}` : "—";
    });
    browserDocument.querySelectorAll("[data-selected-gallery-link]").forEach((target) => {
      if (tokenId) {
        target.href = selectedPunkGalleryPath(tokenId);
        target.textContent = `Open Punk #${tokenId} activity and gallery`;
        target.removeAttribute("aria-disabled");
      } else {
        target.href = "#owner-workspace-title";
        target.textContent = "Choose a Punk to open its activity and gallery";
        target.setAttribute("aria-disabled", "true");
      }
    });
    browserDocument.querySelectorAll("[data-punk-gallery-primary]").forEach((target) => {
      target.hidden = !tokenId;
      if (tokenId) {
        target.href = selectedPunkGalleryPath(tokenId);
        target.textContent = `View Punk #${tokenId} verified gallery`;
      } else {
        target.removeAttribute("href");
      }
    });
    browserDocument.querySelectorAll("[data-public-scout-token-display]").forEach((target) => {
      target.textContent = tokenId ? `#${tokenId}` : "—";
    });
  }

  function selectPunk(tokenId = "") {
    const item = currentAccounts.find((candidate) => candidate.tokenId === tokenId) ?? null;
    setSelected(item?.tokenId ?? "");
    renderSelectedPunkPreview(selectedPreview, currentAccounts, item?.tokenId ?? "");
    for (const control of [workspacePicker, picker, mandatePicker]) {
      if (control && [...control.options].some((option) => option.value === (item?.tokenId ?? ""))) {
        control.value = item?.tokenId ?? "";
      }
    }
    if (!item) {
      browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:punk-selected", {
        detail: Object.freeze({ tokenId: null, account: null, activated: false, owner: null }),
      }));
      return;
    }
    if (!trustedArtworkUrl(item.artwork?.imageUrl)) {
      const selectionRevision = revision;
      void hydrateOnchainPunkDecorations(
        browserWindow.__GOGH_WALLET_PROVIDER__,
        currentCollection,
        [item],
        { concurrency: 1 },
      ).then(([decorated]) => {
        if (selectionRevision !== revision || !decorated) return;
        currentAccounts = currentAccounts.map((candidate) => (
          candidate.tokenId === decorated.tokenId ? decorated : candidate
        ));
        renderSelectedPunkPreview(selectedPreview, currentAccounts, decorated.tokenId);
        announceOwnerPunks(currentAccounts,
          browserWindow.__GOGH_WALLET_SNAPSHOT__?.account ?? null);
      }).catch(() => {});
    }
    const wallet = browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;
    const detail = Object.freeze({
      tokenId: item.tokenId,
      account: item.account,
      activated: item.activated === true,
      owner: wallet?.account?.toLowerCase?.() ?? item.owner,
      retirement: item.rarity ? Object.freeze({
        rarityEvidence: item.rarity.source,
        rarityRank: item.rarity.rank ?? null,
        rarityTier: item.rarity.proposedTier,
        rankBandSupply: item.rarity.rankBandSupply ?? null,
        permanentSnapshot: false,
      }) : null,
    });
    browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:punk-selected", { detail }));
    browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:mandate-punk-selected", {
      detail: { tokenId: detail.tokenId, owner: detail.owner },
    }));
  }

  // The settled snapshot may arrive with no event of its own once a restore finishes. Re-check it
  // shortly after any non-ready frame so a connected owner is never left on an empty roster.
  function scheduleSettleRecheck() {
    if (recheckTimer !== null || typeof browserWindow.setTimeout !== "function") return;
    recheckTimer = browserWindow.setTimeout(() => {
      recheckTimer = null;
      const settled = browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;
      if (walletDiscoveryIntent(settled) === "ready") void refresh({ detail: settled });
    }, SETTLE_RECHECK_MS);
  }

  function candidateDecorationMaps(payload) {
    const rows = Array.isArray(payload?.candidatePunks) ? payload.candidatePunks : [];
    return Object.freeze({
      artwork: new Map(rows.map((item) => [String(item?.tokenId), item?.artwork])),
      rarity: new Map(rows.map((item) => [String(item?.tokenId), item?.rarity])),
      automation: new Map(rows.map((item) => [
        String(item?.tokenId), item?.automationConfigured === true,
      ])),
      automationCreated: new Map(rows.map((item) => [
        String(item?.tokenId), item?.automationCreated === true,
      ])),
      agentSummary: new Map(rows.map((item) => [
        String(item?.tokenId), item?.agentSummary ?? null,
      ])),
    });
  }

  function decorateVerifiedAccounts(accounts, payload) {
    const maps = candidateDecorationMaps(payload);
    return accounts.map((item) => Object.freeze({
      ...item,
      artwork: maps.artwork.get(item.tokenId) ?? item.artwork ?? null,
      rarity: maps.rarity.get(item.tokenId) ?? item.rarity ?? null,
      automationConfigured: maps.automation.get(item.tokenId) === true,
      automationCreated: maps.automationCreated.get(item.tokenId) === true,
      agentSummary: maps.agentSummary.get(item.tokenId) ?? item.agentSummary ?? null,
    }));
  }

  function publishVerifiedAccounts(accounts, payload, wallet, current, { reconciled = false } = {}) {
    if (current !== revision) return;
    const decoratedAccounts = decorateVerifiedAccounts(accounts, payload);
    for (const item of decoratedAccounts) {
      if (item.activated) rememberActivatedPunk(browserWindow.localStorage, item.tokenId);
    }
    const activatedCount = decoratedAccounts.filter(({ activated }) => activated).length;
    const readyCount = decoratedAccounts.length - activatedCount;
    const detail = readyCount > 0
      ? `${readyCount} more owned ${readyCount === 1 ? "Punk" : "Punks"} ready to activate`
      : "Live ownership verified";
    setCounts(decoratedAccounts.length, activatedCount, detail, reconciled
      ? "Live ownership reconciled"
      : "Live ownership verified from indexed roster");
    renderPunkPicker(picker, decoratedAccounts);
    const routeSelection = requestedTokenId
      && decoratedAccounts.some(({ tokenId }) => tokenId === requestedTokenId)
      ? requestedTokenId : "";
    const previousSelection = routeSelection
      || workspacePicker?.value || mandatePicker?.value || picker?.value || "";
    const selectedTokenId = decoratedAccounts.some(({ tokenId }) => tokenId === previousSelection)
      ? previousSelection : "";
    if (routeSelection) requestedTokenId = null;
    renderPunkPicker(mandatePicker, decoratedAccounts, selectedTokenId);
    renderPunkPicker(workspacePicker, decoratedAccounts, selectedTokenId);
    currentAccounts = decoratedAccounts;
    announceOwnerPunks(decoratedAccounts, wallet.account);
    renderSelectedPunkPreview(selectedPreview, decoratedAccounts, selectedTokenId);
    if (container) renderOwnerAccounts(container, decoratedAccounts);
    if (selectedTokenId) selectPunk(selectedTokenId);
    const artworkTargets = priorityArtworkAccounts(decoratedAccounts, selectedTokenId);
    void hydrateOnchainPunkDecorations(
      browserWindow.__GOGH_WALLET_PROVIDER__,
      currentCollection,
      artworkTargets,
    ).then((decoratedTargets) => {
      if (current !== revision) return;
      const decoratedByToken = new Map(decoratedTargets.map((item) => [item.tokenId, item]));
      currentAccounts = currentAccounts.map((item) => decoratedByToken.get(item.tokenId) ?? item);
      announceOwnerPunks(currentAccounts, wallet.account);
      renderSelectedPunkPreview(selectedPreview, currentAccounts, selectedTokenId);
      if (container) renderOwnerAccounts(container, currentAccounts);
    }).catch(() => {
      // Artwork is optional and never delays or changes live ownership evidence.
    });
  }

  async function reconcileOwnerRoster(wallet, gatePayload, current, initialTokenIds) {
    try {
      const response = await request(
        `/api/broker/owner-punks?owner=${encodeURIComponent(wallet.account)}&view=reconcile`,
        { headers: { accept: "application/json" }, cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true || !Array.isArray(payload.candidateTokenIds)
        || current !== revision) return;
      const nextTokenIds = [...new Set(payload.candidateTokenIds.map(String))]
        .sort((left, right) => Number(left) - Number(right));
      const normalizedInitialTokenIds = [...new Set(initialTokenIds.map(String))]
        .sort((left, right) => Number(left) - Number(right));
      const sameRoster = nextTokenIds.length === normalizedInitialTokenIds.length
        && nextTokenIds.every((tokenId, index) => tokenId === normalizedInitialTokenIds[index]);
      const accounts = sameRoster ? currentAccounts : await findBrowserOwnedPunks(
        browserWindow.__GOGH_WALLET_PROVIDER__, gatePayload.activationGate,
        wallet.account, nextTokenIds,
      );
      publishVerifiedAccounts(accounts, payload, wallet, current, { reconciled: true });
    } catch {
      if (current === revision) {
        setCounts(currentAccounts.length, currentAccounts.filter(({ activated }) => activated).length,
          "Background ownership sync will retry", "Punks ready · background sync delayed");
      }
    }
  }

  async function refresh(event) {
    const wallet = event?.detail ?? browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;
    const intent = walletDiscoveryIntent(wallet);
    // Bumping the revision cancels whatever scan is in flight, so a transient frame must return
    // before it can revoke a scan that is about to answer for this very owner.
    if (intent === "transient") {
      scheduleSettleRecheck();
      return;
    }
    const current = ++revision;
    if (intent !== "ready") {
      scheduleSettleRecheck();
      setCounts(null, null, "Connect owner wallet");
      setSelected();
      renderPunkPicker(picker, []);
      renderPunkPicker(mandatePicker, []);
      renderPunkPicker(workspacePicker, []);
      renderSelectedPunkPreview(selectedPreview, []);
      currentAccounts = [];
      currentCollection = null;
      announceOwnerPunks([]);
      setContainerHtml('<p class="empty-state">Connect the owner wallet on Robinhood Chain to load activated Punk Accounts.</p>');
      return;
    }
    setContainerHtml('<p class="empty-state loading">Loading indexed candidates and checking each live owner…</p>');
    try {
      const [gateResponse, candidatesResponse] = await Promise.all([
        request("/api/broker/account-activation-status", {
          headers: { accept: "application/json" }, cache: "no-store",
        }),
        request(`/api/broker/owner-punks?owner=${encodeURIComponent(wallet.account)}&view=indexed`, {
          headers: { accept: "application/json" }, cache: "no-cache",
        }),
      ]);
      const [gatePayload, candidatesPayload] = await Promise.all([
        gateResponse.json(), candidatesResponse.json(),
      ]);
      currentCollection = gatePayload.activationGate?.bindings?.punkCollection ?? null;
      const indexed = candidatesResponse.ok && candidatesPayload?.ok === true
        && Array.isArray(candidatesPayload.candidateTokenIds)
        ? candidatesPayload.candidateTokenIds : [];
      const remembered = knownTokenIds(browserWindow.localStorage);
      let candidates = [...new Set([...remembered, ...indexed])];
      let rosterPayload = candidatesPayload;
      let reconciledInitially = false;
      let accounts = [];
      if (candidates.length > 0) {
        // The indexed/enrolled IDs are hints only. Three Multicall reads verify ownership,
        // deterministic account address, and deployment state for the whole bounded set before
        // anything is shown. This is the normal mobile path and avoids scanning all 5,017 tokens.
        accounts = await findBrowserOwnedPunks(browserWindow.__GOGH_WALLET_PROVIDER__,
          gatePayload.activationGate, wallet.account, candidates);
      } else {
        // A first-time holder can be absent from both the persistent index and local memory. Do
        // the bounded full-collection completion on the server, where it is 26 parallelized
        // Multicalls, rather than making a phone scan 5,017 ownerOf calls. The resulting IDs are
        // still only hints: the wallet provider verifies every returned owner and Punk Account
        // binding in the same three live Multicalls used by the indexed path.
        const reconcileResponse = await request(
          `/api/broker/owner-punks?owner=${encodeURIComponent(wallet.account)}&view=reconcile`,
          { headers: { accept: "application/json" }, cache: "no-store" },
        );
        const reconcilePayload = await reconcileResponse.json();
        if (!reconcileResponse.ok || reconcilePayload?.ok !== true
          || !Array.isArray(reconcilePayload.candidateTokenIds)) {
          throw new TypeError("Live Punk roster reconciliation is unavailable");
        }
        rosterPayload = reconcilePayload;
        reconciledInitially = true;
        candidates = [...new Set(reconcilePayload.candidateTokenIds.map(String))]
          .sort((left, right) => Number(left) - Number(right));
        accounts = await findBrowserOwnedPunks(browserWindow.__GOGH_WALLET_PROVIDER__,
          gatePayload.activationGate, wallet.account, candidates);
      }
      if (current !== revision) return;
      publishVerifiedAccounts(accounts, rosterPayload, wallet, current, {
        reconciled: reconciledInitially,
      });
      // A non-empty persistent ownership index is rendered after one bounded browser
      // Multicall verification. Do not launch the 5,017-token server reconciliation on every
      // navigation: the incremental Transfer index updates the roster, while privileged actions
      // still recheck ownerOf live. A completely empty index retains the one-time completion path
      // above so a first-time holder cannot disappear from the product.
    } catch {
      if (current !== revision) return;
      setCounts(null, null, "Live check unavailable");
      setSelected();
      renderPunkPicker(picker, []);
      renderPunkPicker(mandatePicker, []);
      renderPunkPicker(workspacePicker, []);
      renderSelectedPunkPreview(selectedPreview, []);
      currentAccounts = [];
      currentCollection = null;
      announceOwnerPunks([]);
      setContainerHtml('<p class="empty-state">Punks could not be checked right now. No ownership or wallet status was inferred from stale data.</p>');
    }
  }

  browserWindow.addEventListener("gogh:wallet-state", refresh);
  picker?.addEventListener("change", () => {
    selectPunk(picker.value);
  });
  mandatePicker?.addEventListener("change", () => {
    selectPunk(mandatePicker.value);
  });
  workspacePicker?.addEventListener("change", () => selectPunk(workspacePicker.value));
  browserWindow.addEventListener("gogh:select-punk-request", (event) => {
    const requested = event.detail?.tokenId;
    if (typeof requested === "string"
      && currentAccounts.some(({ tokenId }) => tokenId === requested)) selectPunk(requested);
  });
  refresh({ detail: browserWindow.__GOGH_WALLET_SNAPSHOT__ });
  return Object.freeze({ refresh });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupOwnerAccounts({ windowObject: window, documentObject: document });
}
