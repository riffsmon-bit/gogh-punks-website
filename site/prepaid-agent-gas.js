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

function boundedChoice(value, allowed, name) {
  const selected = Number(value);
  if (!Number.isSafeInteger(selected) || !allowed.includes(selected)) {
    fail("INVALID_SESSION", `${name} is invalid`);
  }
  return selected;
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

export async function preflightPrepaidAgentGas(provider, status, selectedTokenId, configuration) {
  if (String(status?.tokenId) !== String(selectedTokenId)) {
    fail("PUNK_CHANGED", "the selected Punk changed");
  }
  const owner = normalizeAddress(status.owner, "Punk owner");
  const agent = normalizeAddress(status.agent, "hosted agent");
  const amountWei = parseEther(configuration?.amountText);
  const mintLimit = boundedChoice(configuration?.mintLimit, [1, 3, 5, 10], "mint limit");
  const durationDays = boundedChoice(configuration?.durationDays, [1, 3, 7, 30], "duration");
  const minimum = BigInt(status.minimumWei);
  const maximum = BigInt(status.maximumWei);
  if (amountWei < minimum || amountWei > maximum) {
    fail("INVALID_AMOUNT", "amount is outside the reviewed prepaid gas range");
  }
  const recommended = BigInt(status.recommendedWeiByMintLimit?.[String(mintLimit)] ?? "0");
  if (recommended === 0n || amountWei < recommended) {
    fail("INVALID_AMOUNT", `choose at least the recommended reserve for ${mintLimit} mints`);
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
    amountWei: amountWei.toString(), mintLimit, durationDays, transaction });
}

export async function submitPrepaidAgentGas(provider, plan) {
  const hash = await rpc(provider, "eth_sendTransaction", [plan.transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    fail("SUBMISSION_UNCONFIRMED", "wallet did not return a transaction hash");
  }
  return hash.toLowerCase();
}

export async function confirmPrepaidAgentGas(fetchFunction, plan, transactionHash, options = {}) {
  const attempts = Number.isSafeInteger(options.attempts) ? options.attempts : 5;
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchFunction("/api/broker/punk-agent-gas", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ tokenId: plan.tokenId, owner: plan.owner,
        amountWei: plan.amountWei, mintLimit: plan.mintLimit,
        durationDays: plan.durationDays, transactionHash }),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.ok === true) return payload.prepaidAgentGas;
    const retryable = new Set([
      "TRANSACTION_PENDING", "TRANSACTION_UNCONFIRMED", "RPC_DISAGREEMENT",
      "PREPAID_GAS_FAILED",
    ]).has(payload?.code);
    if (!retryable || attempt === attempts - 1) {
      fail("CONFIRMATION_FAILED", payload?.message
        ?? "The deposit confirmed, but its Punk credit is still being reconciled");
    }
    await wait(1_500 * (attempt + 1));
  }
  fail("CONFIRMATION_FAILED", "The deposit confirmed, but its Punk credit is still being reconciled");
}
