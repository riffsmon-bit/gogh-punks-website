import { keccak256Hex } from "./keccak256.js";

const CHAIN_ID = 4663;
const PUNK_TOKEN_ID = "1797";
const OWNER_SELECTOR = "0x8da5cb5b";
const OWNER_OF_SELECTOR = "0x6352211e";
const EXECUTE_SELECTOR = "0x51945447";
const MAX_DEPOSIT_OR_WITHDRAWAL_WEI = 1_000_000_000_000_000_000n;
const EMPTY_EXECUTE_RESULT = `0x${32n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class AccountFundsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AccountFundsError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AccountFundsError(code, message);
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

function word(value) {
  if (typeof value !== "bigint" || value < 0n || value >= (1n << 256n)) {
    fail("INVALID_INTEGER", "ABI integer is invalid");
  }
  return value.toString(16).padStart(64, "0");
}

function addressWord(value) {
  return address(value, "ABI address", { zero: true }).slice(2).padStart(64, "0");
}

export function parseAccountEtherAmount(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
    fail("INVALID_AMOUNT", "amount must be a canonical ETH decimal with at most 18 places");
  }
  const [whole, fraction = ""] = value.split(".");
  const wei = BigInt(whole) * 1_000_000_000_000_000_000n
    + BigInt(fraction.padEnd(18, "0") || "0");
  if (wei === 0n || wei > MAX_DEPOSIT_OR_WITHDRAWAL_WEI) {
    fail("INVALID_AMOUNT", "amount must be greater than zero and at most 1 ETH");
  }
  return wei;
}

export function formatAccountEther(wei) {
  const whole = wei / 1_000_000_000_000_000_000n;
  const fraction = (wei % 1_000_000_000_000_000_000n).toString().padStart(18, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export function encodeOwnerWithdrawal(owner, amountWei) {
  return `${EXECUTE_SELECTOR}${addressWord(owner)}${word(amountWei)}${word(128n)}${word(0n)}${word(0n)}`;
}

export function validateAccountManagementGate(gate) {
  exactKeys(gate, ["status", "capability", "reason", "bindings"], "management gate");
  if (gate.status !== "READY_FOR_LIVE_OWNER_CHECK" || gate.capability !== true
    || gate.reason !== null) fail("GATE_CLOSED", "account management gate is closed");
  exactKeys(gate.bindings, [
    "chainId", "expectedOwner", "account", "accountRuntimeCodeHash", "punkCollection",
    "punkTokenId",
  ], "management bindings");
  if (gate.bindings.chainId !== CHAIN_ID || gate.bindings.punkTokenId !== PUNK_TOKEN_ID) {
    fail("GATE_MISMATCH", "management gate is not the fixed Punk #1797 account");
  }
  return Object.freeze({
    chainId: CHAIN_ID,
    expectedOwner: address(gate.bindings.expectedOwner, "expected owner"),
    account: address(gate.bindings.account, "Punk Account"),
    accountRuntimeCodeHash: bytes32(gate.bindings.accountRuntimeCodeHash, "account runtime hash"),
    punkCollection: address(gate.bindings.punkCollection, "Punk collection"),
    punkTokenId: PUNK_TOKEN_ID,
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

async function request(provider, method, params = []) {
  if (!provider?.request) fail("WALLET_UNAVAILABLE", "wallet provider is unavailable");
  return provider.request({ method, params });
}

async function confirmOwner(provider, bindings) {
  const chainId = parseHexUint(await request(provider, "eth_chainId"), "chain ID");
  if (chainId !== BigInt(CHAIN_ID)) fail("WRONG_CHAIN", "select Robinhood Chain 4663");
  const accounts = await request(provider, "eth_accounts");
  const selected = Array.isArray(accounts) && accounts.length
    ? address(accounts[0], "selected account") : null;
  if (selected !== bindings.expectedOwner) fail("OWNER_MISMATCH", "selected account is not owner");
  return selected;
}

function tokenWord() {
  return word(BigInt(PUNK_TOKEN_ID));
}

async function liveAccountState(provider, bindings) {
  const [punkOwnerRaw, accountOwnerRaw, code, balanceRaw] = await Promise.all([
    request(provider, "eth_call", [{
      to: bindings.punkCollection,
      data: `${OWNER_OF_SELECTOR}${tokenWord()}`,
    }, "latest"]),
    request(provider, "eth_call", [{ to: bindings.account, data: OWNER_SELECTOR }, "latest"]),
    request(provider, "eth_getCode", [bindings.account, "latest"]),
    request(provider, "eth_getBalance", [bindings.account, "latest"]),
  ]);
  if (decodeAddressWord(punkOwnerRaw, "Punk owner") !== bindings.expectedOwner
    || decodeAddressWord(accountOwnerRaw, "account owner") !== bindings.expectedOwner) {
    fail("OWNER_MISMATCH", "live owner no longer matches the reviewed owner");
  }
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)
    || keccak256Hex(code) !== bindings.accountRuntimeCodeHash) {
    fail("CODE_MISMATCH", "Punk Account runtime does not match the reviewed deployment");
  }
  return Object.freeze({ balanceWei: parseHexUint(balanceRaw, "account balance") });
}

function transactionFor(action, bindings, amountWei) {
  if (action === "deposit") {
    return Object.freeze({
      from: bindings.expectedOwner,
      to: bindings.account,
      value: `0x${amountWei.toString(16)}`,
      data: "0x",
    });
  }
  if (action !== "withdraw") fail("INVALID_ACTION", "action is invalid");
  return Object.freeze({
    from: bindings.expectedOwner,
    to: bindings.account,
    value: "0x0",
    data: encodeOwnerWithdrawal(bindings.expectedOwner, amountWei),
  });
}

export async function preflightAccountFunds(provider, gate, action, amountText) {
  const bindings = validateAccountManagementGate(gate);
  const amountWei = parseAccountEtherAmount(amountText);
  await confirmOwner(provider, bindings);
  const state = await liveAccountState(provider, bindings);
  if (action === "withdraw" && amountWei > state.balanceWei) {
    fail("INSUFFICIENT_ACCOUNT_BALANCE", "withdrawal exceeds the Punk Account balance");
  }
  const transaction = transactionFor(action, bindings, amountWei);
  const simulation = await request(provider, "eth_call", [transaction, "latest"]);
  if ((action === "deposit" && simulation !== "0x")
    || (action === "withdraw" && simulation !== EMPTY_EXECUTE_RESULT)) {
    fail("SIMULATION_FAILED", "account transaction simulation returned an unexpected result");
  }
  const gas = parseHexUint(await request(provider, "eth_estimateGas", [transaction]), "gas estimate");
  if (gas === 0n) fail("SIMULATION_FAILED", "gas estimate is zero");
  return Object.freeze({ action, amountWei, bindings, transaction, gas, balanceWei: state.balanceWei });
}

function sameTransaction(left, right) {
  return left.from === right.from && left.to === right.to
    && left.value === right.value && left.data === right.data;
}

export async function submitAccountFunds(provider, initial, options = {}) {
  if (typeof options.isCurrent !== "function") {
    fail("SUBMISSION_BLOCKED", "submission requires a live state guard");
  }
  const fresh = await preflightAccountFunds(
    provider,
    { status: "READY_FOR_LIVE_OWNER_CHECK", capability: true, reason: null,
      bindings: initial.bindings },
    initial.action,
    formatAccountEther(initial.amountWei),
  );
  if (!sameTransaction(initial.transaction, fresh.transaction) || !options.isCurrent()) {
    fail("STATE_CHANGED", "wallet or reviewed state changed during checks");
  }
  await confirmOwner(provider, fresh.bindings);
  if (!options.isCurrent()) fail("STATE_CHANGED", "wallet changed before submission");
  const hash = await request(provider, "eth_sendTransaction", [fresh.transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    fail("SUBMISSION_UNCONFIRMED", "wallet did not return a transaction hash");
  }
  return Object.freeze({ hash, transaction: fresh.transaction });
}

async function fetchGate(fetchFunction) {
  const response = await fetchFunction("/api/broker/account-management-status", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response?.ok) fail("STATUS_UNAVAILABLE", "management status is unavailable");
  const payload = await response.json();
  if (!payload?.ok || payload.autonomyStatus !== "DISABLED") {
    fail("STATUS_UNAVAILABLE", "management status is invalid");
  }
  return payload.managementGate;
}

export function setupAccountFunds({ windowObject, documentObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  const panel = browserDocument?.querySelector?.("[data-account-funds]");
  if (!browserWindow || !browserDocument || !panel
    || !/^\/punk\/1797\/?$/.test(browserWindow.location?.pathname ?? "")) return null;
  panel.hidden = false;
  const status = panel.querySelector("[data-account-funds-state]");
  const balance = panel.querySelector("[data-account-balance]");
  const amount = panel.querySelector("[data-account-amount]");
  const confirmation = panel.querySelector("[data-account-funds-confirm]");
  const deposit = panel.querySelector("[data-account-deposit]");
  const withdraw = panel.querySelector("[data-account-withdraw]");
  const state = {
    gate: null,
    bindings: null,
    wallet: browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null,
    balanceWei: null,
    busy: false,
    revision: 0,
    notice: null,
  };

  function ownerReady() {
    return state.bindings && state.wallet?.chainId === CHAIN_ID
      && state.wallet?.account?.toLowerCase?.() === state.bindings.expectedOwner;
  }

  function render() {
    const ready = ownerReady() && confirmation.checked && !state.busy;
    deposit.disabled = !ready;
    withdraw.disabled = !ready || state.balanceWei === 0n;
    amount.disabled = !ownerReady() || state.busy;
    balance.textContent = state.balanceWei === null
      ? "—" : `${formatAccountEther(state.balanceWei)} ETH`;
    status.textContent = state.notice ?? (state.bindings
      ? (ownerReady() ? "READY · exact owner actions require one wallet confirmation"
        : "LOCKED · connect the current owner on Robinhood Chain 4663")
      : "LOCKED · verified account deployment required");
    status.dataset.accountFundsStatus = state.notice ? "pending" : (ownerReady() ? "ready" : "locked");
  }

  async function refresh() {
    state.notice = null;
    state.balanceWei = null;
    try {
      state.gate = await fetchGate(fetchFunction ?? browserWindow.fetch?.bind(browserWindow));
      state.bindings = validateAccountManagementGate(state.gate);
      if (ownerReady()) {
        const live = await liveAccountState(browserWindow.__GOGH_WALLET_PROVIDER__, state.bindings);
        state.balanceWei = live.balanceWei;
      }
    } catch {
      state.gate = null;
      state.bindings = null;
    }
    render();
  }

  function changed(event) {
    state.wallet = event?.detail ?? browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;
    state.revision += 1;
    state.notice = null;
    confirmation.checked = false;
    refresh();
  }

  async function act(action) {
    if (state.busy || !ownerReady() || !confirmation.checked) return;
    state.busy = true;
    const revision = state.revision;
    state.notice = "CHECKING · live owner, account code, balance, and simulation";
    render();
    let outcome;
    try {
      const initial = await preflightAccountFunds(
        browserWindow.__GOGH_WALLET_PROVIDER__,
        state.gate,
        action,
        amount.value,
      );
      const { hash } = await submitAccountFunds(browserWindow.__GOGH_WALLET_PROVIDER__, initial, {
        isCurrent: () => state.revision === revision && confirmation.checked && ownerReady(),
      });
      outcome = `SUBMITTED · pending wallet receipt · ${hash}`;
    } catch (error) {
      outcome = `NOT SUBMITTED · ${error instanceof AccountFundsError
        ? error.code : "WALLET_REJECTED"}`;
    } finally {
      state.busy = false;
      confirmation.checked = false;
      await refresh();
      state.notice = outcome;
      render();
    }
  }

  const providerChanged = () => changed();
  const depositClick = () => act("deposit");
  const withdrawClick = () => act("withdraw");
  deposit.addEventListener("click", depositClick);
  withdraw.addEventListener("click", withdrawClick);
  confirmation.addEventListener("change", render);
  browserWindow.addEventListener("gogh:wallet-state", changed);
  for (const eventName of ["accountsChanged", "chainChanged", "disconnect"]) {
    browserWindow.__GOGH_WALLET_PROVIDER__?.on?.(eventName, providerChanged);
  }
  refresh();
  return {
    refresh,
    destroy() {
      deposit.removeEventListener("click", depositClick);
      withdraw.removeEventListener("click", withdrawClick);
      confirmation.removeEventListener("change", render);
      browserWindow.removeEventListener("gogh:wallet-state", changed);
      for (const eventName of ["accountsChanged", "chainChanged", "disconnect"]) {
        browserWindow.__GOGH_WALLET_PROVIDER__?.removeListener?.(eventName, providerChanged);
      }
    },
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupAccountFunds({ windowObject: window, documentObject: document });
}
