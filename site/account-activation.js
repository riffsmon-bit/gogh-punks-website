import { keccak256Hex } from "./keccak256.js";
import { rememberActivatedPunk } from "./owner-accounts.js";

const CHAIN_ID = 4663;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"00".repeat(32)}`;
const SELECTORS = Object.freeze({
  ownerOf: "0x6352211e",
  account: "0x2dd7c658",
  createAccount: "0xcab13915",
  implementation: "0x5c60da1b",
  accountSalt: "0x6c74921e",
  collection: "0x93bbfb4a",
  canonicalRegistry: "0xa66ea95a",
});

export class AccountActivationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AccountActivationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AccountActivationError(code, message);
}

function address(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_ADDRESS", `${label} is invalid`);
  }
  const normalized = value.toLowerCase();
  if (normalized === ZERO_ADDRESS) fail("INVALID_ADDRESS", `${label} is zero`);
  return normalized;
}

function bytes32(value, label, { zero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)
    || (!zero && value.toLowerCase() === ZERO_HASH)) fail("INVALID_HASH", `${label} is invalid`);
  return value.toLowerCase();
}

function tokenId(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,3})$/.test(value)) {
    fail("INVALID_TOKEN", "Enter a Gogh Punk ID from 0 to 9999");
  }
  const parsed = BigInt(value);
  if (parsed > 9999n) fail("INVALID_TOKEN", "Enter a Gogh Punk ID from 0 to 9999");
  return parsed;
}

function word(value) {
  return value.toString(16).padStart(64, "0");
}

function decodeAddressWord(value, label) {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) {
    fail("RPC_MALFORMED", `${label} returned malformed data`);
  }
  return address(`0x${value.slice(-40)}`, label);
}

function parseChain(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    fail("RPC_MALFORMED", "wallet chain is malformed");
  }
  return Number(BigInt(value));
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_GATE", `${label} is malformed`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_GATE", `${label} fields are malformed`);
  }
}

export function validateActivationGate(gate) {
  exactKeys(gate, ["status", "capability", "reason", "bindings"], "activation gate");
  if (gate.status !== "READY_FOR_OWNER_ACTIVATION_CHECK"
    || gate.capability !== true || gate.reason !== null) {
    fail("GATE_CLOSED", "Punk Account activation is not available");
  }
  exactKeys(gate.bindings, [
    "chainId", "punkCollection", "accountRegistry", "accountRegistryRuntimeCodeHash",
    "accountImplementation", "accountImplementationRuntimeCodeHash",
    "canonicalERC6551Registry", "canonicalERC6551RegistryRuntimeCodeHash", "accountSalt",
  ], "activation bindings");
  if (gate.bindings.chainId !== CHAIN_ID) fail("WRONG_CHAIN", "activation gate chain is invalid");
  return Object.freeze({
    chainId: CHAIN_ID,
    punkCollection: address(gate.bindings.punkCollection, "Punk collection"),
    accountRegistry: address(gate.bindings.accountRegistry, "Punk Account registry"),
    accountRegistryRuntimeCodeHash: bytes32(
      gate.bindings.accountRegistryRuntimeCodeHash,
      "registry runtime hash",
    ),
    accountImplementation: address(gate.bindings.accountImplementation, "account implementation"),
    accountImplementationRuntimeCodeHash: bytes32(
      gate.bindings.accountImplementationRuntimeCodeHash,
      "implementation runtime hash",
    ),
    canonicalERC6551Registry: address(
      gate.bindings.canonicalERC6551Registry,
      "canonical ERC-6551 registry",
    ),
    canonicalERC6551RegistryRuntimeCodeHash: bytes32(
      gate.bindings.canonicalERC6551RegistryRuntimeCodeHash,
      "canonical registry runtime hash",
    ),
    accountSalt: bytes32(gate.bindings.accountSalt, "account salt", { zero: true }),
  });
}

async function rpc(provider, method, params = []) {
  if (!provider?.request) fail("WALLET_UNAVAILABLE", "Connect a browser wallet first");
  return provider.request({ method, params });
}

async function call(provider, to, data, from) {
  return rpc(provider, "eth_call", [{ to, data, ...(from ? { from } : {}) }, "latest"]);
}

async function runtime(provider, target, expectedHash, label) {
  const code = await rpc(provider, "eth_getCode", [target, "latest"]);
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)
    || keccak256Hex(code) !== expectedHash) fail("CODE_MISMATCH", `${label} code is not reviewed`);
}

export async function inspectPunkActivation(provider, gateValue, inputTokenId) {
  const bindings = validateActivationGate(gateValue);
  const id = tokenId(inputTokenId);
  const [chainHex, accounts] = await Promise.all([
    rpc(provider, "eth_chainId"),
    rpc(provider, "eth_accounts"),
  ]);
  if (parseChain(chainHex) !== CHAIN_ID) fail("WRONG_CHAIN", "Select Robinhood Chain 4663");
  const selected = Array.isArray(accounts) && accounts[0] ? address(accounts[0], "selected wallet") : null;
  if (!selected) fail("WALLET_UNAVAILABLE", "Connect the Punk owner wallet first");

  const encodedId = word(id);
  const [ownerRaw, accountRaw, implementationRaw, saltRaw, collectionRaw,
    canonicalRaw] = await Promise.all([
    call(provider, bindings.punkCollection, `${SELECTORS.ownerOf}${encodedId}`),
    call(provider, bindings.accountRegistry, `${SELECTORS.account}${encodedId}`),
    call(provider, bindings.accountRegistry, SELECTORS.implementation),
    call(provider, bindings.accountRegistry, SELECTORS.accountSalt),
    call(provider, bindings.accountRegistry, SELECTORS.collection),
    call(provider, bindings.accountRegistry, SELECTORS.canonicalRegistry),
    runtime(provider, bindings.accountRegistry, bindings.accountRegistryRuntimeCodeHash,
      "Punk Account registry"),
    runtime(provider, bindings.accountImplementation,
      bindings.accountImplementationRuntimeCodeHash, "account implementation"),
    runtime(provider, bindings.canonicalERC6551Registry,
      bindings.canonicalERC6551RegistryRuntimeCodeHash, "canonical ERC-6551 registry"),
  ]);
  if (decodeAddressWord(ownerRaw, "live Punk owner") !== selected) {
    fail("NOT_CURRENT_OWNER", `The connected wallet does not own Punk #${id}`);
  }
  if (decodeAddressWord(implementationRaw, "registry implementation")
      !== bindings.accountImplementation
    || bytes32(saltRaw, "registry salt", { zero: true }) !== bindings.accountSalt
    || decodeAddressWord(collectionRaw, "registry collection") !== bindings.punkCollection
    || decodeAddressWord(canonicalRaw, "registry canonical singleton")
      !== bindings.canonicalERC6551Registry) {
    fail("REGISTRY_MISMATCH", "The live account registry configuration changed");
  }
  const account = decodeAddressWord(accountRaw, "derived Punk Account");
  const code = await rpc(provider, "eth_getCode", [account, "latest"]);
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) {
    fail("RPC_MALFORMED", "Punk Account code response is malformed");
  }
  const transaction = Object.freeze({
    from: selected,
    to: bindings.accountRegistry,
    value: "0x0",
    data: `${SELECTORS.createAccount}${encodedId}`,
  });
  if (code !== "0x") {
    return Object.freeze({ tokenId: id.toString(), owner: selected, account,
      activated: true, transaction: null, bindings });
  }
  const [simulatedRaw, gasRaw] = await Promise.all([
    rpc(provider, "eth_call", [transaction, "latest"]),
    rpc(provider, "eth_estimateGas", [transaction]),
  ]);
  if (decodeAddressWord(simulatedRaw, "activation simulation") !== account
    || typeof gasRaw !== "string" || !/^0x[0-9a-fA-F]+$/.test(gasRaw)
    || BigInt(gasRaw) === 0n) fail("SIMULATION_FAILED", "Activation simulation failed");
  return Object.freeze({ tokenId: id.toString(), owner: selected, account,
    activated: false, transaction, bindings });
}

export async function submitPunkActivation(provider, initial, gate, isCurrent) {
  if (typeof isCurrent !== "function" || !isCurrent()) fail("STATE_CHANGED", "Page state changed");
  const fresh = await inspectPunkActivation(provider, gate, initial.tokenId);
  if (fresh.activated) return Object.freeze({ alreadyActivated: true, account: fresh.account });
  if (fresh.account !== initial.account
    || JSON.stringify(fresh.transaction) !== JSON.stringify(initial.transaction)
    || !isCurrent()) fail("STATE_CHANGED", "Activation details changed during review");
  const hash = await rpc(provider, "eth_sendTransaction", [fresh.transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    fail("SUBMISSION_UNCONFIRMED", "Wallet did not return a transaction hash");
  }
  return Object.freeze({ alreadyActivated: false, account: fresh.account, hash });
}

async function fetchGate(fetchFunction) {
  const response = await fetchFunction("/api/broker/account-activation-status", {
    headers: { accept: "application/json" }, cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true || payload.autonomyStatus !== "DISABLED") {
    fail("GATE_CLOSED", "Activation status is unavailable");
  }
  return payload.activationGate;
}

export function setupAccountActivation({ windowObject, documentObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  const panel = browserDocument?.querySelector?.("[data-account-activation]");
  if (!browserWindow || !panel) return null;
  const provider = browserWindow.ethereum;
  const request = fetchFunction ?? browserWindow.fetch.bind(browserWindow);
  const input = panel.querySelector("[data-activation-token]");
  const inspect = panel.querySelector("[data-activation-inspect]");
  const confirm = panel.querySelector("[data-activation-confirm]");
  const activate = panel.querySelector("[data-activation-submit]");
  const account = panel.querySelector("[data-activation-account]");
  const status = panel.querySelector("[data-activation-state]");
  let gate = null;
  let reviewed = null;
  let busy = false;
  let revision = 0;
  let wallet = browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;

  function connected() {
    return Boolean(provider?.request && wallet?.account && wallet?.chainId === CHAIN_ID);
  }
  function render(message = null, kind = null) {
    inspect.disabled = busy || !gate || !connected();
    activate.disabled = busy || !reviewed || reviewed.activated || !confirm.checked;
    if (message) status.textContent = message;
    status.dataset.activationStatus = kind ?? (gate && connected() ? "ready" : "locked");
    account.textContent = reviewed?.account ?? "Check an owned Punk to derive its agent wallet";
  }
  async function check() {
    busy = true;
    reviewed = null;
    confirm.checked = false;
    const started = revision;
    render("Checking live ownership and the deterministic account…", "pending");
    try {
      const result = await inspectPunkActivation(provider, gate, input.value);
      if (started !== revision) throw new AccountActivationError("STATE_CHANGED", "Wallet changed");
      reviewed = result;
      if (result.activated) rememberActivatedPunk(browserWindow.localStorage, result.tokenId);
      render(result.activated
        ? `Punk #${result.tokenId} is already activated. Its agent wallet is ready to fund.`
        : `Punk #${result.tokenId} is owned by this wallet and can be activated. Review the address, check the box, then activate.`,
      "ready");
    } catch (error) {
      render(error?.message ?? "Punk activation check failed.", "error");
    } finally {
      busy = false;
      render();
    }
  }
  async function submit() {
    if (!reviewed || reviewed.activated || !confirm.checked || busy) return;
    const started = revision;
    busy = true;
    render("Rechecking everything before opening MetaMask…", "pending");
    try {
      const result = await submitPunkActivation(
        provider,
        reviewed,
        gate,
        () => started === revision && confirm.checked,
      );
      render(result.alreadyActivated
        ? "This Punk Account was already activated."
        : `Activation submitted: ${result.hash}. Wait for confirmation, then check the Punk again.`,
      "ready");
      rememberActivatedPunk(browserWindow.localStorage, reviewed.tokenId);
      browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:wallet-state", {
        detail: browserWindow.__GOGH_WALLET_SNAPSHOT__,
      }));
      if (!result.alreadyActivated) reviewed = null;
    } catch (error) {
      render(error?.message ?? "Activation was cancelled or rejected.", "error");
    } finally {
      busy = false;
      render();
    }
  }
  function walletChanged(event) {
    wallet = event?.detail ?? null;
    revision += 1;
    reviewed = null;
    confirm.checked = false;
    render("Connect the owner wallet, enter a Punk ID, then check it.");
  }
  inspect.addEventListener("click", check);
  activate.addEventListener("click", submit);
  confirm.addEventListener("change", () => render());
  input.addEventListener("input", () => {
    revision += 1; reviewed = null; confirm.checked = false; render();
  });
  browserWindow.addEventListener("gogh:wallet-state", walletChanged);
  fetchGate(request).then((value) => {
    gate = value;
    render("Connect the owner wallet, enter a Punk ID, then check it.");
  }).catch((error) => render(error.message, "error"));
  render("Loading activation status…", "pending");
  return Object.freeze({ inspect: check, submit });
}

if (typeof window !== "undefined" && typeof document !== "undefined") setupAccountActivation();
