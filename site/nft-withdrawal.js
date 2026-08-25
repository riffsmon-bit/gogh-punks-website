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
  const confirmation = panel.querySelector("[data-nft-confirm]");
  const submit = panel.querySelector("[data-nft-submit]");
  const status = panel.querySelector("[data-nft-state]");
  const state = { selection: null, revision: 0, busy: false };
  const fetcher = fetchFunction ?? browserWindow.fetch.bind(browserWindow);

  function render() {
    amountField.hidden = standard.value !== "ERC1155";
    submit.disabled = state.busy || !state.selection?.tokenId || !confirmation.checked;
    if (!state.selection?.tokenId && !state.busy) {
      status.textContent = "Choose one of your wallet-owned Punks above.";
    }
  }

  async function act() {
    if (state.busy || !state.selection?.tokenId) return;
    const provider = browserWindow.ethereum;
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

  browserWindow.addEventListener("gogh:punk-selected", (event) => {
    state.selection = event.detail?.tokenId ? event.detail : null;
    state.revision += 1;
    confirmation.checked = false;
    render();
  });
  browserWindow.ethereum?.on?.("accountsChanged", () => { state.revision += 1; });
  browserWindow.ethereum?.on?.("chainChanged", () => { state.revision += 1; });
  standard.addEventListener("change", render);
  confirmation.addEventListener("change", render);
  submit.addEventListener("click", act);
  render();
  return Object.freeze({ render });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupNftWithdrawal();
}
