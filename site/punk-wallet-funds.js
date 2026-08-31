import { keccak256Hex } from "./keccak256.js";
import { validateNftWithdrawalGate } from "./nft-withdrawal.js";

const CHAIN_ID = 4663;
const OWNER_SELECTOR = "0x8da5cb5b";
const OWNER_OF_SELECTOR = "0x6352211e";
const EXECUTE_SELECTOR = "0x51945447";
const EMPTY_EXECUTE_RESULT = `0x${32n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
const MAX_DECIMALS = 18;

export class PunkWalletFundsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PunkWalletFundsError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PunkWalletFundsError(code, message);
}

function word(value) {
  return value.toString(16).padStart(64, "0");
}

function addressWord(value) {
  return value.slice(2).padStart(64, "0");
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
  return `0x${value.slice(-40).toLowerCase()}`;
}

function parseEther(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) {
    fail("INVALID_AMOUNT", "enter a valid ETH amount with no more than 18 decimals");
  }
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 10n ** 18n
    + BigInt((fraction + "0".repeat(MAX_DECIMALS)).slice(0, MAX_DECIMALS));
  if (amount === 0n) fail("INVALID_AMOUNT", "amount must be greater than zero");
  return amount;
}

async function rpc(provider, method, params = []) {
  if (!provider?.request) fail("WALLET_UNAVAILABLE", "wallet provider is unavailable");
  return provider.request({ method, params });
}

function encodeOwnerWithdrawal(owner, amount) {
  return `${EXECUTE_SELECTOR}${addressWord(owner)}${word(amount)}${word(128n)}${word(0n)}${word(0n)}`;
}

async function verifyV3PunkWallet(provider, bindings, direction, amountWei) {
  const [chainId, accounts] = await Promise.all([
    rpc(provider, "eth_chainId"),
    rpc(provider, "eth_accounts"),
  ]);
  if (parseHexUint(chainId, "chain ID") !== BigInt(CHAIN_ID)) {
    fail("WRONG_CHAIN", "switch to Robinhood Chain");
  }
  const selected = Array.isArray(accounts) && /^0x[0-9a-fA-F]{40}$/.test(accounts[0] ?? "")
    ? accounts[0].toLowerCase() : null;
  if (selected !== bindings.expectedOwner) {
    fail("OWNER_MISMATCH", "connect the wallet that currently holds this Gogh Punk");
  }
  const tokenWord = word(BigInt(bindings.punkTokenId));
  const reads = [
    rpc(provider, "eth_call", [{ to: bindings.punkCollection,
      data: `${OWNER_OF_SELECTOR}${tokenWord}` }, "latest"]),
    rpc(provider, "eth_call", [{ to: bindings.account, data: OWNER_SELECTOR }, "latest"]),
    rpc(provider, "eth_getCode", [bindings.account, "latest"]),
  ];
  if (direction === "withdraw") reads.push(rpc(provider, "eth_getBalance", [bindings.account, "latest"]));
  const [punkOwnerRaw, accountOwnerRaw, accountCode, balanceRaw] = await Promise.all(reads);
  if (decodeAddressWord(punkOwnerRaw, "Punk owner") !== bindings.expectedOwner
    || decodeAddressWord(accountOwnerRaw, "Punk Wallet owner") !== bindings.expectedOwner) {
    fail("OWNER_MISMATCH", "live ownership changed");
  }
  if (typeof accountCode !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(accountCode)
    || keccak256Hex(accountCode) !== bindings.accountRuntimeCodeHash) {
    fail("CODE_MISMATCH", "Punk Wallet runtime does not match the verified V3 deployment");
  }
  if (direction === "withdraw" && parseHexUint(balanceRaw, "Punk Wallet balance") < amountWei) {
    fail("INSUFFICIENT_BALANCE", "withdrawal exceeds the Punk Wallet balance");
  }
}

async function preflightWei(provider, gate, selectedTokenId, direction, amountWei) {
  if (!['deposit', 'withdraw'].includes(direction)) fail("INVALID_ACTION", "fund action is invalid");
  const bindings = validateNftWithdrawalGate(gate, selectedTokenId);
  await verifyV3PunkWallet(provider, bindings, direction, amountWei);
  const transaction = Object.freeze(direction === "deposit" ? {
    from: bindings.expectedOwner, to: bindings.account,
    value: `0x${amountWei.toString(16)}`, data: "0x",
  } : {
    from: bindings.expectedOwner, to: bindings.account, value: "0x0",
    data: encodeOwnerWithdrawal(bindings.expectedOwner, amountWei),
  });
  const [result, gasRaw] = await Promise.all([
    rpc(provider, "eth_call", [transaction, "latest"]),
    rpc(provider, "eth_estimateGas", [transaction]),
  ]);
  const expected = direction === "deposit" ? "0x" : EMPTY_EXECUTE_RESULT;
  if (result !== expected || parseHexUint(gasRaw, "gas estimate") === 0n) {
    fail("SIMULATION_FAILED", "the exact Punk Wallet transaction did not simulate successfully");
  }
  return Object.freeze({ direction, amountWei, bindings, transaction });
}

export async function preflightPunkWalletFunds(provider, gate, selectedTokenId, direction, amountText) {
  return preflightWei(provider, gate, selectedTokenId, direction, parseEther(amountText));
}

function sameTransaction(left, right) {
  return left.from === right.from && left.to === right.to
    && left.value === right.value && left.data === right.data;
}

export async function submitPunkWalletFunds(provider, initial, { loadGate, isCurrent } = {}) {
  if (typeof loadGate !== "function" || typeof isCurrent !== "function" || !isCurrent()) {
    fail("SUBMISSION_BLOCKED", "submission requires fresh status and wallet guards");
  }
  const freshGate = await loadGate(initial.bindings.punkTokenId);
  const fresh = await preflightWei(provider, freshGate, initial.bindings.punkTokenId,
    initial.direction, initial.amountWei);
  if (!sameTransaction(initial.transaction, fresh.transaction) || !isCurrent()) {
    fail("STATE_CHANGED", "wallet, Punk, amount, or destination changed during review");
  }
  const hash = await rpc(provider, "eth_sendTransaction", [fresh.transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    fail("SUBMISSION_UNCONFIRMED", "wallet did not return a transaction hash");
  }
  return Object.freeze({ hash, transaction: fresh.transaction });
}

export async function fetchPunkWalletFundsGate(fetchFunction, tokenId) {
  const response = await fetchFunction(
    `/api/broker/nft-withdrawal-status?tokenId=${encodeURIComponent(tokenId)}`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    fail("STATUS_UNAVAILABLE", "Punk Wallet live status is unavailable");
  }
  return payload.recovery;
}
