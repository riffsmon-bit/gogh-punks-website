import { keccak256Hex } from "./keccak256.js";
import {
  encodeOwnerWithdrawal,
  formatAccountEther,
  parseAccountEtherAmount,
} from "./account-funds.js";

const CHAIN_ID = 4663;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MODE_NAMES = Object.freeze(["DISABLED", "SCOUT", "APPROVAL REQUIRED", "AUTONOMOUS"]);
const ALLOWED_CAPS = Object.freeze([0, 1, 3, 5, 10]);
const SELECTORS = Object.freeze({
  ownerOf: "0x6352211e",
  registryAccount: "0x2dd7c658",
  owner: "0x8da5cb5b",
  canonical: "0x41c283ac",
  policyModule: "0x893866f7",
  agentRegistry: "0x0d1cfcae",
  adapterRegistry: "0x50b5c16a",
  token: "0xfc0c546a",
  policy: "0x88632826",
  acquisitionUsage: "0x7d2fce04",
  mintControls: "0xfe6f2f60",
  effectiveMode: "0xdf3390be",
  globallyPaused: "0x08ce3fb5",
  configurePolicy: "0x69f21ee2",
  setAccountPaused: "0x6dbcb34d",
  revokeAllAgents: "0x980a8c5d",
});

export class OwnerPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OwnerPolicyError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new OwnerPolicyError(code, message);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_GATE", `${label} is malformed`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_GATE", `${label} fields are malformed`);
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

function bytes32(value, label, { zero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)
    || (!zero && /^0x0{64}$/.test(value))) fail("INVALID_HASH", `${label} is invalid`);
  return value.toLowerCase();
}

function tokenId(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,3})$/.test(value)) {
    fail("INVALID_TOKEN", "Select a valid Gogh Punk");
  }
  return BigInt(value);
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

function responseWords(value, count, label) {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${count * 64}}$`).test(value)) {
    fail("RPC_MALFORMED", `${label} returned malformed data`);
  }
  return Array.from({ length: count }, (_, index) => BigInt(`0x${value.slice(
    2 + index * 64,
    2 + (index + 1) * 64,
  )}`));
}

function decodedAddress(value, label) {
  const [raw] = responseWords(value, 1, label);
  if (raw >= (1n << 160n)) fail("RPC_MALFORMED", `${label} is noncanonical`);
  return address(`0x${raw.toString(16).padStart(40, "0")}`, label, { zero: true });
}

function decodedBool(value, label) {
  const [raw] = responseWords(value, 1, label);
  if (raw > 1n) fail("RPC_MALFORMED", `${label} is not a boolean`);
  return raw === 1n;
}

function decodedUint(value, label) {
  return responseWords(value, 1, label)[0];
}

function hexQuantity(value, label) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    fail("RPC_MALFORMED", `${label} is malformed`);
  }
  return BigInt(value);
}

function boolFromWord(value, label) {
  if (value > 1n) fail("RPC_MALFORMED", `${label} is not a boolean`);
  return value === 1n;
}

export function validateOwnerPolicyGate(gate) {
  exactKeys(gate, ["status", "capability", "reason", "bindings"], "owner policy gate");
  if (gate.status !== "READY_FOR_LIVE_OWNER_POLICY_CHECK"
    || gate.capability !== true || gate.reason !== null) {
    fail("GATE_CLOSED", "owner policy controls are unavailable");
  }
  const keys = [
    "chainId", "punkCollection", "accountRegistry", "accountRegistryRuntimeCodeHash",
    "accountImplementation", "accountImplementationRuntimeCodeHash", "policyModule",
    "policyModuleRuntimeCodeHash", "agentRegistry", "agentRegistryRuntimeCodeHash",
    "adapterRegistry", "adapterRegistryRuntimeCodeHash", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash", "accountSalt",
  ];
  exactKeys(gate.bindings, keys, "owner policy bindings");
  if (gate.bindings.chainId !== CHAIN_ID) fail("WRONG_CHAIN", "policy gate chain is invalid");
  const normalized = { chainId: CHAIN_ID };
  for (const key of [
    "punkCollection", "accountRegistry", "accountImplementation", "policyModule",
    "agentRegistry", "adapterRegistry", "canonicalERC6551Registry",
  ]) normalized[key] = address(gate.bindings[key], key);
  for (const key of [
    "accountRegistryRuntimeCodeHash", "accountImplementationRuntimeCodeHash",
    "policyModuleRuntimeCodeHash", "agentRegistryRuntimeCodeHash",
    "adapterRegistryRuntimeCodeHash", "canonicalERC6551RegistryRuntimeCodeHash",
  ]) normalized[key] = bytes32(gate.bindings[key], key);
  normalized.accountSalt = bytes32(gate.bindings.accountSalt, "account salt", { zero: true });
  return Object.freeze(normalized);
}

export function decodePolicyResult(value) {
  const words = responseWords(value, 16, "policy");
  if (words[0] > 3n || words[7] >= (1n << 32n) || words[8] >= (1n << 32n)
    || words[9] >= (1n << 16n) || words[12] >= (1n << 160n)
    || words[13] >= (1n << 64n) || words[14] >= (1n << 64n)) {
    fail("RPC_MALFORMED", "policy fields exceed their ABI bounds");
  }
  return Object.freeze({
    config: Object.freeze({
      mode: Number(words[0]),
      maxSpendPerTransaction: words[1],
      maxSpendPerDay: words[2],
      maxSpendPerWeek: words[3],
      maxMintPrice: words[4],
      maxSecondaryPurchasePrice: words[5],
      minimumNativeReserve: words[6],
      maxAcquisitionsPerDay: Number(words[7]),
      maxIntentAge: Number(words[8]),
      maxSlippageBps: Number(words[9]),
      requireCollectionAllowlist: boolFromWord(words[10], "collection allowlist flag"),
      allowUnknownCollections: boolFromWord(words[11], "unknown collection flag"),
    }),
    configuredBy: address(`0x${words[12].toString(16).padStart(40, "0")}`,
      "configured owner", { zero: true }),
    version: words[13],
    permissionGeneration: words[14],
    accountPaused: boolFromWord(words[15], "account pause flag"),
  });
}

export function encodeDailyCapUpdate(account, policy, cap) {
  if (!ALLOWED_CAPS.includes(cap)) fail("INVALID_CAP", "daily cap must be 0, 1, 3, 5, or 10");
  const c = policy?.config;
  if (!c || !Number.isInteger(c.mode) || c.mode < 0 || c.mode > 3) {
    fail("INVALID_POLICY", "current policy is invalid");
  }
  return `${SELECTORS.configurePolicy}${addressWord(account)}${[
    BigInt(c.mode), c.maxSpendPerTransaction, c.maxSpendPerDay, c.maxSpendPerWeek,
    c.maxMintPrice, c.maxSecondaryPurchasePrice, c.minimumNativeReserve, BigInt(cap),
    BigInt(c.maxIntentAge), BigInt(c.maxSlippageBps),
    c.requireCollectionAllowlist ? 1n : 0n, c.allowUnknownCollections ? 1n : 0n,
  ].map(word).join("")}`;
}

async function rpc(provider, method, params = []) {
  if (!provider?.request) fail("WALLET_UNAVAILABLE", "Connect a browser wallet first");
  return provider.request({ method, params });
}

async function call(provider, to, data, from) {
  return rpc(provider, "eth_call", [{ to, data, ...(from ? { from } : {}) }, "latest"]);
}

async function exactRuntime(provider, target, expected, label) {
  const code = await rpc(provider, "eth_getCode", [target, "latest"]);
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)
    || keccak256Hex(code) !== expected) fail("CODE_MISMATCH", `${label} code changed`);
}

function samePolicy(left, right) {
  return encodeDailyCapUpdate(ZERO_ADDRESS, left, left.config.maxAcquisitionsPerDay)
      === encodeDailyCapUpdate(ZERO_ADDRESS, right, right.config.maxAcquisitionsPerDay)
    && left.configuredBy === right.configuredBy && left.version === right.version
    && left.permissionGeneration === right.permissionGeneration
    && left.accountPaused === right.accountPaused;
}

export async function readOwnerPolicyState(provider, gateValue, selection) {
  const bindings = validateOwnerPolicyGate(gateValue);
  const id = tokenId(selection?.tokenId);
  if (selection?.activated !== true) fail("NOT_ACTIVATED", "Activate this Punk Account first");
  const selectedAccount = address(selection.account, "selected Punk Account");
  const [chainRaw, accounts] = await Promise.all([
    rpc(provider, "eth_chainId"), rpc(provider, "eth_accounts"),
  ]);
  if (hexQuantity(chainRaw, "chain ID") !== BigInt(CHAIN_ID)) {
    fail("WRONG_CHAIN", "Select Robinhood Chain 4663");
  }
  const owner = Array.isArray(accounts) && accounts[0]
    ? address(accounts[0], "connected owner") : fail("WALLET_UNAVAILABLE", "Connect owner wallet");
  const idWord = word(id);
  const accountWord = addressWord(selectedAccount);
  const [punkOwnerRaw, derivedRaw, accountOwnerRaw, canonicalRaw, accountPolicyRaw,
    accountAgentsRaw, accountAdaptersRaw, footerRaw, policyRaw,
    usageRaw, controlsRaw, modeRaw, pausedRaw, balanceRaw, accountCode] = await Promise.all([
    call(provider, bindings.punkCollection, `${SELECTORS.ownerOf}${idWord}`),
    call(provider, bindings.accountRegistry, `${SELECTORS.registryAccount}${idWord}`),
    call(provider, selectedAccount, SELECTORS.owner),
    call(provider, selectedAccount, SELECTORS.canonical),
    call(provider, selectedAccount, SELECTORS.policyModule),
    call(provider, selectedAccount, SELECTORS.agentRegistry),
    call(provider, selectedAccount, SELECTORS.adapterRegistry),
    call(provider, selectedAccount, SELECTORS.token),
    call(provider, bindings.policyModule, `${SELECTORS.policy}${accountWord}`),
    call(provider, bindings.policyModule, `${SELECTORS.acquisitionUsage}${accountWord}`),
    call(provider, bindings.policyModule, `${SELECTORS.mintControls}${accountWord}`),
    call(provider, bindings.policyModule, `${SELECTORS.effectiveMode}${accountWord}`),
    call(provider, bindings.policyModule, SELECTORS.globallyPaused),
    rpc(provider, "eth_getBalance", [selectedAccount, "latest"]),
    rpc(provider, "eth_getCode", [selectedAccount, "latest"]),
    exactRuntime(provider, bindings.accountRegistry, bindings.accountRegistryRuntimeCodeHash,
      "account registry"),
    exactRuntime(provider, bindings.accountImplementation,
      bindings.accountImplementationRuntimeCodeHash, "account implementation"),
    exactRuntime(provider, bindings.policyModule, bindings.policyModuleRuntimeCodeHash,
      "policy module"),
    exactRuntime(provider, bindings.agentRegistry, bindings.agentRegistryRuntimeCodeHash,
      "agent registry"),
    exactRuntime(provider, bindings.adapterRegistry, bindings.adapterRegistryRuntimeCodeHash,
      "adapter registry"),
    exactRuntime(provider, bindings.canonicalERC6551Registry,
      bindings.canonicalERC6551RegistryRuntimeCodeHash, "canonical ERC-6551 registry"),
  ]);
  if (decodedAddress(punkOwnerRaw, "Punk owner") !== owner
    || decodedAddress(derivedRaw, "derived Punk Account") !== selectedAccount
    || decodedAddress(accountOwnerRaw, "Punk Account owner") !== owner
    || !decodedBool(canonicalRaw, "canonical account flag")
    || decodedAddress(accountPolicyRaw, "account policy module") !== bindings.policyModule
    || decodedAddress(accountAgentsRaw, "account agent registry") !== bindings.agentRegistry
    || decodedAddress(accountAdaptersRaw, "account adapter registry") !== bindings.adapterRegistry) {
    fail("IDENTITY_MISMATCH", "selected Punk Account identity or owner changed");
  }
  const footer = responseWords(footerRaw, 3, "Punk Account footer");
  if (footer[0] !== BigInt(CHAIN_ID) || footer[1] >= (1n << 160n)
    || `0x${footer[1].toString(16).padStart(40, "0")}` !== bindings.punkCollection
    || footer[2] !== id) fail("IDENTITY_MISMATCH", "Punk Account footer changed");
  if (typeof accountCode !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(accountCode)) {
    fail("CODE_MISMATCH", "Punk Account is not deployed");
  }
  const usage = responseWords(usageRaw, 2, "acquisition usage");
  if (usage[0] >= (1n << 64n) || usage[1] >= (1n << 32n)) {
    fail("RPC_MALFORMED", "acquisition usage exceeds ABI bounds");
  }
  const controls = responseWords(controlsRaw, 3, "mint controls").map(
    (value, index) => boolFromWord(value, `mint control ${index}`),
  );
  const effectiveMode = decodedUint(modeRaw, "effective mode");
  if (effectiveMode > 3n) fail("RPC_MALFORMED", "effective mode is invalid");
  return Object.freeze({
    bindings,
    tokenId: id.toString(),
    account: selectedAccount,
    owner,
    policy: decodePolicyResult(policyRaw),
    acquisitionsToday: Number(usage[1]),
    mintControls: Object.freeze({
      ownerApprovedMints: controls[0], autonomousFreeMints: controls[1],
      autonomousPaidMints: controls[2],
    }),
    effectiveMode: Number(effectiveMode),
    globallyPaused: decodedBool(pausedRaw, "global pause"),
    balanceWei: hexQuantity(balanceRaw, "account balance"),
  });
}

function transaction(from, to, data, value = "0x0") {
  return Object.freeze({ from, to, value, data });
}

async function simulationAndGas(provider, tx, expectedResult = "0x") {
  const [result, gasRaw] = await Promise.all([
    rpc(provider, "eth_call", [tx, "latest"]),
    rpc(provider, "eth_estimateGas", [tx]),
  ]);
  if (result !== expectedResult || typeof gasRaw !== "string" || BigInt(gasRaw) === 0n) {
    fail("SIMULATION_FAILED", "the exact transaction did not simulate successfully");
  }
}

export async function prepareDailyCapUpdate(provider, gate, selection, cap) {
  const state = await readOwnerPolicyState(provider, gate, selection);
  if (!ALLOWED_CAPS.includes(cap)) fail("INVALID_CAP", "choose a supported daily cap");
  if (state.policy.config.maxAcquisitionsPerDay === cap) {
    fail("NO_CHANGE", "the selected cap is already enforced on-chain");
  }
  const tx = transaction(state.owner, state.bindings.policyModule,
    encodeDailyCapUpdate(state.account, state.policy, cap));
  await simulationAndGas(provider, tx);
  return Object.freeze({ kind: "CAP", cap, state, transaction: tx });
}

export async function prepareEmergencyPause(provider, gate, selection) {
  const state = await readOwnerPolicyState(provider, gate, selection);
  if (state.policy.accountPaused) fail("NO_CHANGE", "this Punk Account is already paused");
  const tx = transaction(state.owner, state.bindings.policyModule,
    `${SELECTORS.setAccountPaused}${addressWord(state.account)}${word(1n)}`);
  await simulationAndGas(provider, tx);
  return Object.freeze({ kind: "PAUSE", state, transaction: tx });
}

export async function prepareRevokeAllAgents(provider, gate, selection) {
  const state = await readOwnerPolicyState(provider, gate, selection);
  const tx = transaction(state.owner, state.bindings.agentRegistry,
    `${SELECTORS.revokeAllAgents}${addressWord(state.account)}`);
  await simulationAndGas(provider, tx);
  return Object.freeze({ kind: "REVOKE", state, transaction: tx });
}

export async function prepareOwnerFunds(provider, gate, selection, direction, amountText) {
  const state = await readOwnerPolicyState(provider, gate, selection);
  const amountWei = parseAccountEtherAmount(amountText);
  if (direction === "withdraw" && amountWei > state.balanceWei) {
    fail("INSUFFICIENT_BALANCE", "withdrawal exceeds the Punk Account balance");
  }
  const tx = direction === "deposit"
    ? transaction(state.owner, state.account, "0x", `0x${amountWei.toString(16)}`)
    : direction === "withdraw"
      ? transaction(state.owner, state.account, encodeOwnerWithdrawal(state.owner, amountWei))
      : fail("INVALID_ACTION", "fund action is invalid");
  const expected = direction === "deposit"
    ? "0x" : `0x${word(32n)}${word(0n)}`;
  await simulationAndGas(provider, tx, expected);
  return Object.freeze({ kind: direction.toUpperCase(), amountWei, state, transaction: tx });
}

function sameTransaction(left, right) {
  return left.from === right.from && left.to === right.to
    && left.value === right.value && left.data === right.data;
}

export async function submitOwnerAction(provider, prepared, gate, selection, isCurrent) {
  if (typeof isCurrent !== "function" || !isCurrent()) fail("STATE_CHANGED", "page state changed");
  let fresh;
  if (prepared.kind === "CAP") {
    fresh = await prepareDailyCapUpdate(provider, gate, selection, prepared.cap);
  } else if (prepared.kind === "PAUSE") {
    fresh = await prepareEmergencyPause(provider, gate, selection);
  } else if (prepared.kind === "REVOKE") {
    fresh = await prepareRevokeAllAgents(provider, gate, selection);
  } else {
    fresh = await prepareOwnerFunds(provider, gate, selection,
      prepared.kind.toLowerCase(), formatAccountEther(prepared.amountWei));
  }
  if (!samePolicy(prepared.state.policy, fresh.state.policy)
    || prepared.state.account !== fresh.state.account
    || prepared.state.owner !== fresh.state.owner
    || !sameTransaction(prepared.transaction, fresh.transaction) || !isCurrent()) {
    fail("STATE_CHANGED", "owner, policy, selection, or transaction changed during review");
  }
  const hash = await rpc(provider, "eth_sendTransaction", [fresh.transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    fail("SUBMISSION_UNCONFIRMED", "wallet did not return a transaction hash");
  }
  return Object.freeze({ hash, transaction: fresh.transaction });
}

function shortAddress(value) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

async function fetchGate(fetchFunction) {
  const response = await fetchFunction("/api/broker/owner-policy-status", {
    headers: { accept: "application/json" }, cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true || payload.authorityGranted !== false
    || payload.automaticSubmission !== false) fail("GATE_CLOSED", "owner policy status is unavailable");
  return payload.policyGate;
}

export function setupOwnerPolicyControls({ windowObject, documentObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  const panel = browserDocument?.querySelector?.("[data-owner-policy-controls]");
  if (!browserWindow || !panel) return null;
  const request = fetchFunction ?? browserWindow.fetch.bind(browserWindow);
  const elements = Object.fromEntries([
    "token", "account-short", "account-link", "mode", "pause-state", "usage", "version",
    "balance", "selection-detail", "cap", "cap-confirm", "cap-submit", "funds-amount",
    "funds-confirm", "deposit", "withdraw", "pause-confirm", "pause", "revoke-confirm",
    "revoke", "state",
  ].map((name) => [name, panel.querySelector(`[data-policy-${name}]`)]));
  const state = { gate: null, selection: null, live: null, wallet: null, revision: 0, busy: false };

  function walletProvider() {
    return browserWindow.__GOGH_WALLET_PROVIDER__;
  }

  function isCurrent(revision, token) {
    return revision === state.revision && token === state.selection?.tokenId;
  }

  function render(message = null) {
    const ready = Boolean(state.live && !state.busy);
    elements.token.textContent = state.selection?.tokenId ? `#${state.selection.tokenId}` : "—";
    elements["selection-detail"].textContent = state.selection
      ? (state.selection.activated ? "Live owner and account checked" : "Activate this Punk first")
      : "Select an activated Punk";
    elements["account-short"].textContent = state.live ? shortAddress(state.live.account) : "—";
    elements["account-link"].hidden = !state.live;
    if (state.live) elements["account-link"].href =
      `https://robinhoodchain.blockscout.com/address/${state.live.account}`;
    elements.mode.textContent = state.live ? MODE_NAMES[state.live.effectiveMode] : "—";
    elements["pause-state"].textContent = state.live
      ? (state.live.globallyPaused ? "Protocol globally paused"
        : state.live.policy.accountPaused ? "Punk Account paused" : "Punk Account not paused")
      : "Live policy unavailable";
    elements.usage.textContent = state.live
      ? `${state.live.acquisitionsToday} / ${state.live.policy.config.maxAcquisitionsPerDay}` : "—";
    elements.version.textContent = state.live ? state.live.policy.version.toString() : "—";
    elements.balance.textContent = state.live ? `${formatAccountEther(state.live.balanceWei)} ETH` : "—";
    if (state.live) elements.cap.value = String(state.live.policy.config.maxAcquisitionsPerDay);
    elements.cap.disabled = !ready;
    elements["funds-amount"].disabled = !ready;
    elements["cap-submit"].disabled = !ready || !elements["cap-confirm"].checked;
    elements.deposit.disabled = !ready || !elements["funds-confirm"].checked;
    elements.withdraw.disabled = !ready || !elements["funds-confirm"].checked
      || state.live.balanceWei === 0n;
    elements.pause.disabled = !ready || !elements["pause-confirm"].checked
      || state.live.policy.accountPaused;
    elements.revoke.disabled = !ready || !elements["revoke-confirm"].checked;
    elements.state.textContent = message ?? (state.live
      ? "READY · every owner action will be re-read and simulated before MetaMask opens"
      : "Connect the owner wallet and select an activated Punk.");
  }

  async function refresh(message = null) {
    const revision = ++state.revision;
    state.live = null;
    render(message ?? "Checking owner, Punk Account identity, runtimes, policy, usage, and balance…");
    if (!state.selection?.activated || !state.wallet?.account || state.wallet.chainId !== CHAIN_ID) {
      render();
      return;
    }
    try {
      state.gate ??= await fetchGate(request);
      const live = await readOwnerPolicyState(walletProvider(), state.gate, state.selection);
      if (!isCurrent(revision, state.selection.tokenId)) return;
      state.live = live;
      render();
    } catch (error) {
      if (revision !== state.revision) return;
      render(`LOCKED · ${error?.message ?? "live owner controls are unavailable"}`);
    }
  }

  async function run(prepare) {
    if (state.busy || !state.live) return;
    const revision = state.revision;
    const token = state.selection.tokenId;
    state.busy = true;
    render("Reviewing and simulating the exact transaction…");
    try {
      const prepared = await prepare();
      const result = await submitOwnerAction(walletProvider(), prepared, state.gate, state.selection,
        () => isCurrent(revision, token));
      render(`SUBMITTED · ${result.hash} · refresh after the transaction confirms`);
      browserWindow.setTimeout?.(() => refresh("Refreshing confirmed chain state…"), 4_000);
    } catch (error) {
      render(`NOT SUBMITTED · ${error?.message ?? "wallet action failed"}`);
    } finally {
      state.busy = false;
      elements["cap-confirm"].checked = false;
      elements["funds-confirm"].checked = false;
      elements["pause-confirm"].checked = false;
      elements["revoke-confirm"].checked = false;
      render(elements.state.textContent);
    }
  }

  function selectedCap() {
    if (!/^(?:0|[1-9]|10)$/.test(elements.cap.value)) {
      fail("INVALID_CAP", "choose a hard daily cap from 0 through 10");
    }
    return Number(elements.cap.value);
  }

  browserWindow.addEventListener("gogh:wallet-state", (event) => {
    state.wallet = event?.detail ?? browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;
    refresh();
  });
  browserWindow.addEventListener("gogh:punk-selected", (event) => {
    state.selection = event?.detail ?? null;
    refresh();
  });
  for (const key of ["cap-confirm", "funds-confirm", "pause-confirm", "revoke-confirm"]) {
    elements[key].addEventListener("change", () => render());
  }
  elements["cap-submit"].addEventListener("click", () => run(() => prepareDailyCapUpdate(
    walletProvider(), state.gate, state.selection, selectedCap(),
  )));
  elements.deposit.addEventListener("click", () => run(() => prepareOwnerFunds(
    walletProvider(), state.gate, state.selection, "deposit", elements["funds-amount"].value,
  )));
  elements.withdraw.addEventListener("click", () => run(() => prepareOwnerFunds(
    walletProvider(), state.gate, state.selection, "withdraw", elements["funds-amount"].value,
  )));
  elements.pause.addEventListener("click", () => run(() => prepareEmergencyPause(
    walletProvider(), state.gate, state.selection,
  )));
  elements.revoke.addEventListener("click", () => run(() => prepareRevokeAllAgents(
    walletProvider(), state.gate, state.selection,
  )));
  state.wallet = browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;
  render();
  return Object.freeze({ refresh });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupOwnerPolicyControls({ windowObject: window, documentObject: document });
}
