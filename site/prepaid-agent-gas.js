const CHAIN_ID = 4663n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/;

export class PrepaidAgentGasError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PrepaidAgentGasError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PrepaidAgentGasError(code, message);
}

function normalizeAddress(value, name) {
  if (!ADDRESS.test(value ?? "")) fail("INVALID_STATUS", `${name} is invalid`);
  return value.toLowerCase();
}

function parseEther(value) {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    fail("INVALID_AMOUNT", "enter a valid ETH amount with no more than 18 decimals");
  }
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 10n ** 18n
    + BigInt((fraction + "0".repeat(18)).slice(0, 18));
  if (amount === 0n) fail("INVALID_AMOUNT", "amount must be greater than zero");
  return amount;
}

function parseHex(value, name) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    fail("RPC_MALFORMED", `${name} is malformed`);
  }
  return BigInt(value);
}

async function rpc(provider, method, params = []) {
  if (!provider?.request) fail("WALLET_UNAVAILABLE", "wallet provider is unavailable");
  return provider.request({ method, params });
}

export async function fetchPrepaidAgentGasStatus(fetchFunction, tokenId, owner) {
  const response = await fetchFunction(
    `/api/broker/punk-agent-gas?tokenId=${encodeURIComponent(tokenId)}&owner=${encodeURIComponent(owner)}`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    fail("STATUS_UNAVAILABLE", payload?.message ?? "Per-Punk prepaid agent gas is unavailable");
  }
  return payload.prepaidAgentGas;
}

export async function preflightPrepaidAgentGas(provider, status, selectedTokenId, amountText) {
  if (String(status?.tokenId) !== String(selectedTokenId)) {
    fail("PUNK_CHANGED", "the selected Punk changed");
  }
  const owner = normalizeAddress(status.owner, "Punk owner");
  const agent = normalizeAddress(status.agent, "hosted agent");
  const amountWei = parseEther(amountText);
  const minimum = BigInt(status.minimumWei);
  const maximum = BigInt(status.maximumWei);
  if (amountWei < minimum || amountWei > maximum) {
    fail("INVALID_AMOUNT", "amount is outside the reviewed prepaid gas range");
  }
  const [chain, accounts] = await Promise.all([
    rpc(provider, "eth_chainId"), rpc(provider, "eth_accounts"),
  ]);
  if (parseHex(chain, "chain ID") !== CHAIN_ID) fail("WRONG_CHAIN", "switch to Robinhood Chain");
  const selected = Array.isArray(accounts) && ADDRESS.test(accounts[0] ?? "")
    ? accounts[0].toLowerCase() : null;
  if (selected !== owner) fail("OWNER_MISMATCH", "connect the current Gogh Punk holder");
  const transaction = Object.freeze({
    from: owner, to: agent, value: `0x${amountWei.toString(16)}`, data: "0x",
  });
  const [simulation, gas] = await Promise.all([
    rpc(provider, "eth_call", [transaction, "latest"]),
    rpc(provider, "eth_estimateGas", [transaction]),
  ]);
  if (simulation !== "0x" || parseHex(gas, "gas estimate") === 0n) {
    fail("SIMULATION_FAILED", "the exact prepaid gas transfer did not simulate successfully");
  }
  return Object.freeze({ tokenId: String(selectedTokenId), owner, agent,
    amountWei: amountWei.toString(), transaction });
}

export async function submitPrepaidAgentGas(provider, plan) {
  const hash = await rpc(provider, "eth_sendTransaction", [plan.transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    fail("SUBMISSION_UNCONFIRMED", "wallet did not return a transaction hash");
  }
  return hash.toLowerCase();
}

export async function confirmPrepaidAgentGas(fetchFunction, plan, transactionHash) {
  const response = await fetchFunction("/api/broker/punk-agent-gas", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ tokenId: plan.tokenId, owner: plan.owner,
      amountWei: plan.amountWei, transactionHash }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    fail("CONFIRMATION_FAILED", payload?.message
      ?? "The deposit confirmed, but its Punk credit is still being reconciled");
  }
  return payload.prepaidAgentGas;
}
