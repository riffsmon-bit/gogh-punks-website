import { keccak256Hex } from "./keccak256.js";

const CHAIN_ID = 4663;
const EXECUTE_SELECTOR = "0x51945447";
const OWNER_SELECTOR = "0x8da5cb5b";
const OWNER_OF_SELECTOR = "0x6352211e";
const ERC721_SAFE_TRANSFER_SELECTOR = "0x42842e0e";
const ERC1155_BALANCE_OF_SELECTOR = "0x00fdd58e";
const ERC1155_SAFE_TRANSFER_SELECTOR = "0xf242432a";
const EMPTY_EXECUTE_RESULT = `0x${32n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class NftWithdrawalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NftWithdrawalError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new NftWithdrawalError(code, message);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_STATUS", `${label} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_STATUS", `${label} fields are invalid`);
  }
}

function address(value, label, { zero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_ADDRESS", `${label} is invalid`);
  }
  const normalized = value.toLowerCase();
  if (!zero && normalized === ZERO_ADDRESS) fail("INVALID_ADDRESS", `${label} is zero`);
  return normalized;
}

function bytes32(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)
    || /^0x0{64}$/.test(value)) fail("INVALID_HASH", `${label} is invalid`);
  return value.toLowerCase();
}

function uint(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    fail("INVALID_INTEGER", `${label} must be a whole decimal number`);
  }
  const parsed = BigInt(value);
  if (parsed >= (1n << 256n)) fail("INVALID_INTEGER", `${label} is too large`);
  return parsed;
}

function word(value) {
  if (typeof value !== "bigint" || value < 0n || value >= (1n << 256n)) {
    fail("INVALID_INTEGER", "ABI integer is invalid");
  }
  return value.toString(16).padStart(64, "0");
}

function addressWord(value) {
  return address(value, "ABI address", { zero: true }).slice(2).padStart(64, "0");
}

function bytesPayload(value) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    fail("INVALID_CALLDATA", "inner transfer calldata is invalid");
  }
  const body = value.slice(2).toLowerCase();
  const padding = "0".repeat((64 - (body.length % 64)) % 64);
  return `${word(BigInt(body.length / 2))}${body}${padding}`;
}

export function encodeNftTransfer({ standard, account, owner, tokenId, amount = "1" }) {
  const id = uint(String(tokenId), "NFT token ID");
  if (standard === "ERC721") {
    return `${ERC721_SAFE_TRANSFER_SELECTOR}${addressWord(account)}${addressWord(owner)}${word(id)}`;
  }
  if (standard !== "ERC1155") fail("INVALID_STANDARD", "choose ERC-721 or ERC-1155");
  const quantity = uint(String(amount), "ERC-1155 amount");
  if (quantity === 0n) fail("INVALID_AMOUNT", "ERC-1155 amount must be greater than zero");
  return `${ERC1155_SAFE_TRANSFER_SELECTOR}${addressWord(account)}${addressWord(owner)}`
    + `${word(id)}${word(quantity)}${word(160n)}${word(0n)}`;
}

export function encodeNftWithdrawal(collection, innerData) {
  return `${EXECUTE_SELECTOR}${addressWord(collection)}${word(0n)}${word(128n)}${word(0n)}`
    + bytesPayload(innerData);
}

export function validateNftWithdrawalGate(gate, selectedTokenId) {
  exactKeys(gate, ["status", "capability", "reason", "checkedAt", "bindings"], "recovery gate");
  if (gate.status !== "READY_FOR_LIVE_OWNER_CHECK" || gate.capability !== true
    || gate.reason !== null || typeof gate.checkedAt !== "string") {
    fail("GATE_CLOSED", "NFT recovery is not ready for this Punk");
  }
  exactKeys(gate.bindings, [
    "chainId", "punkCollection", "accountImplementation", "accountRegistry",
    "punkTokenId", "account", "expectedOwner", "accountRuntimeCodeHash", "destination",
    "supportedStandards",
  ], "recovery bindings");
  if (gate.bindings.chainId !== CHAIN_ID || gate.bindings.punkTokenId !== selectedTokenId) {
    fail("GATE_MISMATCH", "recovery status belongs to a different Punk");
  }
  if (!Array.isArray(gate.bindings.supportedStandards)
    || gate.bindings.supportedStandards.join(",") !== "ERC721,ERC1155") {
    fail("GATE_MISMATCH", "recovery standards are invalid");
  }
  const expectedOwner = address(gate.bindings.expectedOwner, "expected owner");
  const destination = address(gate.bindings.destination, "fixed destination");
  if (destination !== expectedOwner) fail("GATE_MISMATCH", "destination is not the current owner");
  return Object.freeze({
    chainId: CHAIN_ID,
    punkCollection: address(gate.bindings.punkCollection, "Punk collection"),
    accountImplementation: address(gate.bindings.accountImplementation, "account implementation"),
    accountRegistry: address(gate.bindings.accountRegistry, "account registry"),
    punkTokenId: selectedTokenId,
    account: address(gate.bindings.account, "Punk NFT wallet"),
    expectedOwner,
    accountRuntimeCodeHash: bytes32(gate.bindings.accountRuntimeCodeHash, "account runtime hash"),
    destination,
  });
}

function parseHexUint(value, label) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    fail("RPC_MALFORMED", `${label} is malformed`);
  }
  return BigInt(value);
}

function decodeAddressWord(value, label) {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) {
    fail("RPC_MALFORMED", `${label} is malformed`);
  }
  return address(`0x${value.slice(-40)}`, label);
}

function decodeUintWord(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("RPC_MALFORMED", `${label} is malformed`);
  }
  return BigInt(value);
}

async function request(provider, method, params = []) {
  if (!provider?.request) fail("WALLET_UNAVAILABLE", "wallet provider is unavailable");
  return provider.request({ method, params });
}

async function confirmOwner(provider, bindings) {
  const chainId = parseHexUint(await request(provider, "eth_chainId"), "chain ID");
  if (chainId !== BigInt(CHAIN_ID)) fail("WRONG_CHAIN", "switch to Robinhood Chain");
  const accounts = await request(provider, "eth_accounts");
  const selected = Array.isArray(accounts) && accounts.length
    ? address(accounts[0], "selected account") : null;
  if (selected !== bindings.expectedOwner) {
    fail("OWNER_MISMATCH", "connect the wallet that currently holds this Gogh Punk");
  }
}

function call(to, data) {
  return { to, data };
}

async function verifyLiveState(provider, bindings, asset) {
  const punkTokenWord = word(BigInt(bindings.punkTokenId));
  const [punkOwnerRaw, accountOwnerRaw, accountCode, collectionCode] = await Promise.all([
    request(provider, "eth_call", [call(
      bindings.punkCollection,
      `${OWNER_OF_SELECTOR}${punkTokenWord}`,
    ), "latest"]),
    request(provider, "eth_call", [call(bindings.account, OWNER_SELECTOR), "latest"]),
    request(provider, "eth_getCode", [bindings.account, "latest"]),
    request(provider, "eth_getCode", [asset.collection, "latest"]),
  ]);
  if (decodeAddressWord(punkOwnerRaw, "Punk owner") !== bindings.expectedOwner
    || decodeAddressWord(accountOwnerRaw, "Punk Account owner") !== bindings.expectedOwner) {
    fail("OWNER_MISMATCH", "live ownership changed");
  }
  if (typeof accountCode !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(accountCode)
    || keccak256Hex(accountCode) !== bindings.accountRuntimeCodeHash) {
    fail("CODE_MISMATCH", "Punk NFT wallet runtime does not match the verified V3 deployment");
  }
  if (typeof collectionCode !== "string" || collectionCode === "0x") {
    fail("COLLECTION_UNAVAILABLE", "NFT collection has no live contract code");
  }
  if (asset.standard === "ERC721") {
    const currentOwner = decodeAddressWord(await request(provider, "eth_call", [call(
      asset.collection,
      `${OWNER_OF_SELECTOR}${word(asset.tokenId)}`,
    ), "latest"]), "NFT owner");
    if (currentOwner !== bindings.account) {
      fail("ASSET_NOT_OWNED", "this ERC-721 is not held by the selected Punk NFT wallet");
    }
  } else {
    const balance = decodeUintWord(await request(provider, "eth_call", [call(
      asset.collection,
      `${ERC1155_BALANCE_OF_SELECTOR}${addressWord(bindings.account)}${word(asset.tokenId)}`,
    ), "latest"]), "ERC-1155 balance");
    if (balance < asset.amount) {
      fail("ASSET_NOT_OWNED", "the selected Punk NFT wallet does not hold that ERC-1155 amount");
    }
  }
}

function normalizeAsset(input, bindings) {
  const collection = address(input.collection, "NFT collection");
  if (collection === bindings.punkCollection) {
    fail("CONTROLLING_PUNK_BLOCKED", "the controlling Gogh Punk cannot be transferred by recovery");
  }
  const standard = input.standard;
  if (!['ERC721', 'ERC1155'].includes(standard)) {
    fail("INVALID_STANDARD", "choose ERC-721 or ERC-1155");
  }
  return Object.freeze({
    collection,
    standard,
    tokenId: uint(String(input.tokenId), "NFT token ID"),
    amount: standard === "ERC1155" ? uint(String(input.amount), "ERC-1155 amount") : 1n,
  });
}

export async function preflightNftWithdrawal(provider, gate, selectedTokenId, input) {
  const bindings = validateNftWithdrawalGate(gate, selectedTokenId);
  const asset = normalizeAsset(input, bindings);
  if (asset.amount === 0n) fail("INVALID_AMOUNT", "ERC-1155 amount must be greater than zero");
  await confirmOwner(provider, bindings);
  await verifyLiveState(provider, bindings, asset);
  const inner = encodeNftTransfer({
    standard: asset.standard,
    account: bindings.account,
    owner: bindings.destination,
    tokenId: asset.tokenId.toString(),
    amount: asset.amount.toString(),
  });
  const transaction = Object.freeze({
    from: bindings.expectedOwner,
    to: bindings.account,
    value: "0x0",
    data: encodeNftWithdrawal(asset.collection, inner),
  });
  const simulation = await request(provider, "eth_call", [transaction, "latest"]);
  if (simulation !== EMPTY_EXECUTE_RESULT) {
    fail("SIMULATION_FAILED", "NFT withdrawal simulation returned an unexpected result");
  }
  const gas = parseHexUint(await request(provider, "eth_estimateGas", [transaction]), "gas estimate");
  if (gas === 0n) fail("SIMULATION_FAILED", "gas estimate is zero");
  return Object.freeze({ bindings, asset, transaction, gas });
}

function sameTransaction(left, right) {
  return left.from === right.from && left.to === right.to
    && left.value === right.value && left.data === right.data;
}

export async function submitNftWithdrawal(provider, initial, options = {}) {
  if (typeof options.loadGate !== "function" || typeof options.isCurrent !== "function") {
    fail("SUBMISSION_BLOCKED", "submission requires fresh status and wallet guards");
  }
  const gate = await options.loadGate(initial.bindings.punkTokenId);
  const fresh = await preflightNftWithdrawal(
    provider,
    gate,
    initial.bindings.punkTokenId,
    {
      collection: initial.asset.collection,
      standard: initial.asset.standard,
      tokenId: initial.asset.tokenId.toString(),
      amount: initial.asset.amount.toString(),
    },
  );
  if (!sameTransaction(initial.transaction, fresh.transaction) || !options.isCurrent()) {
    fail("STATE_CHANGED", "wallet, Punk, or asset state changed during review");
  }
  await confirmOwner(provider, fresh.bindings);
  if (!options.isCurrent()) fail("STATE_CHANGED", "wallet changed before submission");
  const hash = await request(provider, "eth_sendTransaction", [fresh.transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    fail("SUBMISSION_UNCONFIRMED", "wallet did not return a transaction hash");
  }
  return Object.freeze({ hash, transaction: fresh.transaction });
}

async function fetchGate(fetchFunction, tokenId) {
  const response = await fetchFunction(
    `/api/broker/nft-withdrawal-status?tokenId=${encodeURIComponent(tokenId)}`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  if (!response?.ok) fail("STATUS_UNAVAILABLE", "NFT recovery status is unavailable");
  const payload = await response.json();
  if (!payload?.ok) fail("STATUS_UNAVAILABLE", "NFT recovery status is invalid");
  return payload.recovery;
}

function assetItem(value) {
  exactKeys(value, [
    "standard", "collection", "tokenId", "amount", "transactionHash", "acquiredAt", "openSeaUrl",
    "name", "imageUrl",
  ], "withdrawable NFT");
  if (value.standard !== "ERC721" || value.amount !== "1") {
    fail("INVALID_ASSET_LIST", "withdrawable NFT standard is invalid");
  }
  const normalized = {
    standard: "ERC721",
    collection: address(value.collection, "withdrawable NFT collection"),
    tokenId: uint(value.tokenId, "withdrawable NFT token ID").toString(),
    amount: "1",
    transactionHash: bytes32(value.transactionHash, "withdrawable NFT transaction"),
    acquiredAt: value.acquiredAt,
    openSeaUrl: value.openSeaUrl,
    name: typeof value.name === "string" && value.name.length <= 200 ? value.name : null,
    imageUrl: null,
  };
  if (value.imageUrl !== null) {
    try {
      const url = new URL(value.imageUrl);
      if (url.protocol !== "https:" || !["i.seadn.io", "raw2.seadn.io"].includes(url.hostname)
        || url.username || url.password || url.port || url.hash) throw new Error("invalid");
      normalized.imageUrl = url.href;
    } catch {
      fail("INVALID_ASSET_LIST", "withdrawable NFT image is invalid");
    }
  }
  if (typeof normalized.acquiredAt !== "string" || !Number.isFinite(Date.parse(normalized.acquiredAt))) {
    fail("INVALID_ASSET_LIST", "withdrawable NFT timestamp is invalid");
  }
  const expectedUrl = `https://opensea.io/item/robinhood/${normalized.collection}/${normalized.tokenId}`;
  if (normalized.openSeaUrl !== expectedUrl) {
    fail("INVALID_ASSET_LIST", "withdrawable NFT link is invalid");
  }
  return Object.freeze(normalized);
}

export function validateWithdrawableNftAssets(value, selectedTokenId) {
  exactKeys(value, [
    "status", "capability", "reason", "checkedAt", "punkTokenId", "account", "owner", "items",
  ], "withdrawable NFT list");
  if (value.status !== "READY" || value.capability !== true || value.reason !== null
    || value.punkTokenId !== selectedTokenId || typeof value.checkedAt !== "string"
    || !Number.isFinite(Date.parse(value.checkedAt)) || !Array.isArray(value.items)
    || value.items.length > 64) {
    fail("INVALID_ASSET_LIST", "withdrawable NFT list is unavailable");
  }
  address(value.account, "withdrawable NFT account");
  address(value.owner, "withdrawable NFT owner");
  const items = value.items.map(assetItem);
  const identities = new Set(items.map((item) => `${item.collection}:${item.tokenId}`));
  if (identities.size !== items.length) fail("INVALID_ASSET_LIST", "withdrawable NFT list is duplicated");
  return Object.freeze(items);
}

export function validateWithdrawableNftPortfolio(value, selectedTokenIds) {
  exactKeys(value, [
    "status", "capability", "reason", "checkedAt", "punkTokenIds", "groups",
  ], "withdrawable NFT portfolio");
  if (value.status !== "READY" || value.capability !== true || value.reason !== null
    || typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt))
    || !Array.isArray(value.punkTokenIds) || !Array.isArray(value.groups)
    || value.punkTokenIds.length > 128 || value.groups.length > 128
    || value.punkTokenIds.join(",") !== selectedTokenIds.join(",")) {
    fail("INVALID_ASSET_LIST", "withdrawable NFT portfolio is unavailable");
  }
  const allowed = new Set(selectedTokenIds);
  const grouped = new Set();
  const items = [];
  for (const group of value.groups) {
    if (!allowed.has(group?.punkTokenId) || grouped.has(group.punkTokenId)) {
      fail("INVALID_ASSET_LIST", "withdrawable NFT portfolio group is invalid");
    }
    grouped.add(group.punkTokenId);
    const account = address(group.account, "withdrawable NFT account");
    const owner = address(group.owner, "withdrawable NFT owner");
    for (const item of validateWithdrawableNftAssets(group, group.punkTokenId)) {
      items.push(Object.freeze({ ...item, punkTokenId: group.punkTokenId, account, owner }));
    }
  }
  const identities = new Set(items.map((item) => (
    `${item.punkTokenId}:${item.collection}:${item.tokenId}`
  )));
  if (identities.size !== items.length || items.length > 256) {
    fail("INVALID_ASSET_LIST", "withdrawable NFT portfolio items are invalid");
  }
  return Object.freeze(items);
}

async function fetchAssets(fetchFunction, selectedTokenId) {
  const response = await fetchFunction(
    `/api/broker/nft-withdrawal-assets?tokenId=${encodeURIComponent(selectedTokenId)}`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  if (!response?.ok) fail("ASSET_LIST_UNAVAILABLE", "NFT list is temporarily unavailable");
  const payload = await response.json();
  if (!payload?.ok) fail("ASSET_LIST_UNAVAILABLE", "NFT list is invalid");
  return validateWithdrawableNftAssets(payload.assets, selectedTokenId);
}

async function fetchPortfolio(fetchFunction, selectedTokenIds) {
  const response = await fetchFunction(
    `/api/broker/nft-withdrawal-assets?tokenIds=${encodeURIComponent(selectedTokenIds.join(","))}`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  if (!response?.ok) fail("ASSET_LIST_UNAVAILABLE", "NFT portfolio is temporarily unavailable");
  const payload = await response.json();
  if (!payload?.ok) fail("ASSET_LIST_UNAVAILABLE", "NFT portfolio is invalid");
  return validateWithdrawableNftPortfolio(payload.portfolio, selectedTokenIds);
}

export function setupNftWithdrawal({ windowObject, documentObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  const panel = browserDocument?.querySelector?.("[data-nft-withdrawal]");
  if (!browserWindow || !browserDocument || !panel) return null;
  const collection = panel.querySelector("[data-nft-collection]");
  const standard = panel.querySelector("[data-nft-standard]");
  const tokenId = panel.querySelector("[data-nft-token-id]");
  const amount = panel.querySelector("[data-nft-amount]");
  const amountField = panel.querySelector("[data-nft-amount-field]");
  const assetPicker = panel.querySelector("[data-nft-owned-asset]");
  const assetCards = panel.querySelector("[data-nft-owned-cards]");
  const assetDetail = panel.querySelector("[data-nft-owned-detail]");
  const manualEntry = panel.querySelector(".manual-nft-entry");
  const confirmation = panel.querySelector("[data-nft-confirm]");
  const submit = panel.querySelector("[data-nft-submit]");
  const status = panel.querySelector("[data-nft-state]");
  const state = {
    selection: null, assets: [], portfolioTokenIds: [], revision: 0,
    portfolioRevision: 0, busy: false, loadingAssets: false,
  };
  const fetcher = fetchFunction ?? browserWindow.fetch.bind(browserWindow);

  function setManualMode(manual) {
    standard.disabled = !manual;
    collection.readOnly = !manual;
    tokenId.readOnly = !manual;
    amount.readOnly = !manual;
    if (manualEntry) manualEntry.open = manual;
  }

  function applyAssetSelection() {
    const selectedIndex = assetPicker.value;
    if (selectedIndex === "manual") {
      collection.value = "";
      tokenId.value = "";
      amount.value = "1";
      confirmation.checked = false;
      setManualMode(true);
      render();
      return;
    }
    const asset = /^(?:0|[1-9][0-9]*)$/.test(selectedIndex)
      ? state.assets[Number(selectedIndex)] : null;
    if (asset) {
      if (asset.punkTokenId && state.selection?.tokenId !== asset.punkTokenId) {
        browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:select-punk-request", {
          detail: Object.freeze({ tokenId: asset.punkTokenId }),
        }));
      }
      if (!state.selection?.tokenId || (asset.punkTokenId
        && state.selection.tokenId !== asset.punkTokenId)) {
        status.textContent = "Select the controlling Punk before withdrawing this NFT.";
        return;
      }
      standard.value = asset.standard;
      collection.value = asset.collection;
      tokenId.value = asset.tokenId;
      amount.value = asset.amount;
      confirmation.checked = false;
      setManualMode(false);
      assetDetail.innerHTML = `Selected Punk #${asset.punkTokenId ?? state.selection.tokenId} · token #${asset.tokenId}. <a href="${asset.openSeaUrl}" target="_blank" rel="noopener noreferrer">View on OpenSea ↗</a>`;
    }
    render();
  }

  function populateAssets() {
    assetPicker.replaceChildren();
    const placeholder = browserDocument.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.assets.length
      ? `Choose from ${state.assets.length} NFT${state.assets.length === 1 ? "" : "s"}`
      : "No hosted mints currently held — use manual entry";
    assetPicker.append(placeholder);
    state.assets.forEach((asset, index) => {
      const option = browserDocument.createElement("option");
      option.value = String(index);
      option.textContent = `Punk #${asset.punkTokenId ?? state.selection?.tokenId} · ${asset.name || `token #${asset.tokenId}`}`;
      assetPicker.append(option);
    });
    const manual = browserDocument.createElement("option");
    manual.value = "manual";
    manual.textContent = "Enter another NFT manually";
    assetPicker.append(manual);
    assetPicker.disabled = false;
    assetCards?.replaceChildren();
    state.assets.forEach((asset, index) => {
      const card = browserDocument.createElement("button");
      card.type = "button";
      card.className = "nft-choice-card";
      card.dataset.assetIndex = String(index);
      card.setAttribute("aria-pressed", "false");
      if (asset.imageUrl) {
        const image = browserDocument.createElement("img");
        image.src = asset.imageUrl;
        image.alt = asset.name || `NFT token #${asset.tokenId}`;
        image.loading = "lazy";
        image.decoding = "async";
        card.append(image);
      } else {
        const placeholder = browserDocument.createElement("span");
        placeholder.className = "nft-choice-placeholder";
        placeholder.textContent = `#${asset.tokenId}`;
        card.append(placeholder);
      }
      const name = browserDocument.createElement("strong");
      name.textContent = asset.name || `NFT #${asset.tokenId}`;
      const detail = browserDocument.createElement("small");
      detail.textContent = `Held by Punk #${asset.punkTokenId ?? state.selection?.tokenId} · ${asset.collection.slice(0, 8)}…${asset.collection.slice(-6)}`;
      card.append(name, detail);
      card.addEventListener("click", () => {
        assetPicker.value = String(index);
        assetCards.querySelectorAll("[aria-pressed]").forEach((item) => {
          item.setAttribute("aria-pressed", String(item === card));
        });
        applyAssetSelection();
      });
      assetCards.append(card);
    });
    assetDetail.textContent = state.assets.length
      ? `${state.assets.length} confirmed NFT${state.assets.length === 1 ? "" : "s"} across your Punk-agent wallets.`
      : "No confirmed hosted mints are currently held. Direct transfers can still be entered manually.";
  }

  function render() {
    amountField.hidden = standard.value !== "ERC1155";
    const complete = collection.value.trim() && tokenId.value.trim()
      && (standard.value !== "ERC1155" || amount.value.trim());
    submit.disabled = state.busy || state.loadingAssets || !state.selection?.tokenId
      || !complete || !confirmation.checked;
    if (!state.selection?.tokenId && !state.busy) {
      status.textContent = "Choose one of your wallet-owned Punks above.";
    }
  }

  async function act() {
    if (state.busy || !state.selection?.tokenId) return;
    const provider = browserWindow.__GOGH_WALLET_PROVIDER__;
    const revision = state.revision;
    state.busy = true;
    render();
    status.textContent = "Checking live ownership, NFT balance, verified wallet code, and simulation…";
    try {
      const input = {
        collection: collection.value.trim(), standard: standard.value,
        tokenId: tokenId.value.trim(), amount: amount.value.trim(),
      };
      const gate = await fetchGate(fetcher, state.selection.tokenId);
      const initial = await preflightNftWithdrawal(
        provider, gate, state.selection.tokenId, input,
      );
      const result = await submitNftWithdrawal(provider, initial, {
        loadGate: (id) => fetchGate(fetcher, id),
        isCurrent: () => revision === state.revision,
      });
      status.innerHTML = `Withdrawal submitted to the current holder. <a href="https://robinhoodchain.blockscout.com/tx/${result.hash}" target="_blank" rel="noopener noreferrer">View transaction ↗</a>`;
      confirmation.checked = false;
    } catch (error) {
      status.textContent = error?.message ?? "NFT withdrawal stopped safely.";
    } finally {
      state.busy = false;
      render();
    }
  }

  async function loadSelectedPunkAssets(revision) {
    if (!state.selection) return;
    state.loadingAssets = true;
    assetDetail.textContent = "Checking confirmed mint receipts and current NFT ownership…";
    try {
      const assets = await fetchAssets(fetcher, state.selection.tokenId);
      if (revision !== state.revision) return;
      state.assets = assets.map((asset) => Object.freeze({
        ...asset, punkTokenId: state.selection.tokenId,
      }));
      populateAssets();
      status.textContent = assets.length
        ? "Choose an NFT, review it, then confirm the withdrawal."
        : "No hosted-mint NFT is currently held by this Punk wallet. Manual entry remains available.";
    } catch (error) {
      if (revision !== state.revision) return;
      populateAssets();
      status.textContent = `${error?.message ?? "NFT list unavailable"}. Manual entry remains available.`;
    } finally {
      if (revision === state.revision) {
        state.loadingAssets = false;
        render();
      }
    }
  }

  async function loadOwnerPortfolio(event) {
    const values = event.detail?.tokenIds;
    const portfolioTokenIds = Array.isArray(values)
      && values.length <= 128 && values.every((value) => (
        typeof value === "string" && /^(?:0|[1-9][0-9]{0,3})$/.test(value)
      )) && new Set(values).size === values.length ? [...values] : [];
    state.portfolioTokenIds = portfolioTokenIds;
    state.portfolioRevision += 1;
    state.revision += 1;
    const portfolioRevision = state.portfolioRevision;
    state.assets = [];
    confirmation.checked = false;
    assetPicker.replaceChildren();
    const loading = browserDocument.createElement("option");
    loading.value = "";
    loading.textContent = portfolioTokenIds.length
      ? `Loading NFTs across ${portfolioTokenIds.length} owned Punks…`
      : "Connect your wallet to load the portfolio";
    assetPicker.append(loading);
    assetPicker.disabled = true;
    assetCards?.replaceChildren();
    if (!portfolioTokenIds.length) {
      populateAssets();
      status.textContent = "Connect your wallet to load NFTs held across your Punk agents.";
      return;
    }
    state.loadingAssets = true;
    assetDetail.textContent = "Checking confirmed mint history and current NFT ownership across your Punks…";
    try {
      const assets = await fetchPortfolio(fetcher, portfolioTokenIds);
      if (portfolioRevision !== state.portfolioRevision) return;
      state.assets = assets;
      populateAssets();
      status.textContent = assets.length
        ? "Choose any NFT below; its controlling Punk will be selected automatically."
        : "No confirmed hosted-mint NFTs are currently held across these Punk wallets.";
    } catch (error) {
      if (portfolioRevision !== state.portfolioRevision) return;
      populateAssets();
      status.textContent = `${error?.message ?? "NFT portfolio unavailable"}. Select a Punk to use manual entry.`;
    } finally {
      if (portfolioRevision === state.portfolioRevision) {
        state.loadingAssets = false;
        render();
      }
    }
  }

  browserWindow.addEventListener("gogh:owner-punks", loadOwnerPortfolio);

  browserWindow.addEventListener("gogh:punk-selected", (event) => {
    const nextSelection = event.detail?.tokenId ? event.detail : null;
    const changed = nextSelection?.tokenId !== state.selection?.tokenId;
    state.selection = nextSelection;
    state.revision += 1;
    const revision = state.revision;
    if (changed) {
      confirmation.checked = false;
      collection.value = "";
      tokenId.value = "";
      amount.value = "1";
      setManualMode(false);
    }
    render();
    if (state.selection && !state.portfolioTokenIds.length) void loadSelectedPunkAssets(revision);
  });
  browserWindow.__GOGH_WALLET_PROVIDER__?.on?.("accountsChanged", () => {
    state.revision += 1; state.portfolioRevision += 1;
  });
  browserWindow.__GOGH_WALLET_PROVIDER__?.on?.("chainChanged", () => {
    state.revision += 1; state.portfolioRevision += 1;
  });
  standard.addEventListener("change", render);
  assetPicker.addEventListener("change", applyAssetSelection);
  confirmation.addEventListener("change", render);
  submit.addEventListener("click", act);
  const revealPortfolio = () => {
    if (browserWindow.location?.hash === "#nft-portfolio-title") panel.open = true;
  };
  browserWindow.addEventListener("hashchange", revealPortfolio);
  revealPortfolio();
  if (browserWindow.__GOGH_OWNER_PUNKS__) {
    void loadOwnerPortfolio({ detail: browserWindow.__GOGH_OWNER_PUNKS__ });
  }
  render();
  return Object.freeze({ render });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupNftWithdrawal();
}
