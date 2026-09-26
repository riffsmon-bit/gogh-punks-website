import { readPunkWalletFundsState } from "./punk-wallet-funds.js";
import { keccak256Hex } from "./keccak256.js";
import { AGENT_RECOVERY_PINS, agentRecoveryProxyRuntime } from "./punk-agent-recovery.js";
import { submitJournaledAgentGasFunding } from "./punk-agent-gas-funding-journal.js";
export { getAgentGasFundingState, recoverAgentGasFunding, recheckAgentGasFunding }
  from "./punk-agent-gas-funding-journal.js";

// Reviewed Robinhood deployment. Never accept a destination from chat or a form.
const PINS = AGENT_RECOVERY_PINS;
const REGISTRY = PINS.registry;
const word = value => BigInt(value).toString(16).padStart(64, "0");
const addressWord = value => value.slice(2).padStart(64, "0");
const address = value => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
  && !/^0x0{40}$/.test(value) ? value.toLowerCase() : null;
const uint = value => typeof value === "string" && /^(0|[1-9]\d{0,77})$/.test(value)
  && BigInt(value) < 2n ** 256n ? BigInt(value) : null;
const decodeAddress = value => /^0x0{24}[0-9a-fA-F]{40}$/.test(value ?? "")
  ? address(`0x${value.slice(-40)}`) : null;
const EMPTY_RESULT = `0x${word(32)}${word(0)}`;
const quantity = value => typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  ? BigInt(value) : null;
// Some wallet bridges return safe integer nonces for pending and hex for latest.
// Keep this normalization at the nonce read boundary, before creating a review.
const nonceQuantity = value => typeof value === "number"
  ? Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null : quantity(value);
// WalletConnect reports eth_chainId as a Number. Accept that exact chain only;
// balances, amounts and reviewed transaction fields remain hex/string.
const onRobinhoodChain = value => value === 4663 || typeof value === "string"
  && /^0x[0-9a-fA-F]{1,64}$/.test(value) && BigInt(value) === 4663n;

function ownerFundingBinding(context, tokenId) {
  // Legacy callers may still supply the gate. OWNER funding does not depend on
  // its V3 activation/capability flag, V3 code, reserve or balance.
  const binding = context.ownerBinding ?? { chainId: context.gate?.bindings?.chainId,
    collection: context.gate?.bindings?.punkCollection, tokenId: context.gate?.bindings?.punkTokenId,
    owner: context.gate?.bindings?.expectedOwner };
  if (binding.chainId !== 4663 || address(binding.collection) !== PINS.collection
    || binding.tokenId !== tokenId || !address(binding.owner)) {
    throw new Error("Choose this Punk's current owner on Robinhood Chain and recheck funding.");
  }
  return { expectedOwner: address(binding.owner), account: null };
}

export async function prepareAgentGasFunding(provider, context, tokenId, source, amount) {
  if (!provider?.request || typeof tokenId !== "string" || !/^(0|[1-9]\d{0,3})$/.test(tokenId)
    || !["PUNK", "OWNER"].includes(source) || typeof amount !== "string"
    || !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(amount)) throw new Error("Choose a funding source and a valid ETH amount.");
  const { gate, agent, funding } = context;
  const [whole, fraction = ""] = amount.split(".");
  const amountWei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  if (amountWei <= 0n || amountWei > 10n ** 18n) throw new Error("Gas funding must be greater than zero and no more than 1 ETH per transfer.");
  const { bindings, balanceWei } = source === "PUNK"
    ? await readPunkWalletFundsState(provider, gate, tokenId)
    : { bindings: ownerFundingBinding(context, tokenId), balanceWei: null };
  const destination = address(agent?.runtime?.account);
  if (agent?.ok !== true || String(agent.tokenId) !== tokenId || agent.runtime?.accountCreated !== true
    || address(agent.owner) !== bindings.expectedOwner || address(agent.runtime.owner) !== bindings.expectedOwner
    || !destination || destination === bindings.account) throw new Error("Agent Account is not verified for this Punk and owner. Recheck readiness.");
  const rpc = (method, params) => provider.request({ method, params });
  // account(uint256), independently binds the authenticated server result to the fixed registry.
  const [registered, owner, code, controllingOwner, chainId, accounts, registryCode,
    implementationCode, salt, nonce, latestNonce, ownerBalance] = await Promise.all([
    rpc("eth_call", [{ to: REGISTRY, data: `0x2dd7c658${word(tokenId)}` }, "latest"]),
    rpc("eth_call", [{ to: destination, data: "0x8da5cb5b" }, "latest"]),
    rpc("eth_getCode", [destination, "latest"]),
    rpc("eth_call", [{ to: PINS.collection, data: `0x6352211e${word(tokenId)}` }, "latest"]),
    rpc("eth_chainId", []), rpc("eth_accounts", []),
    rpc("eth_getCode", [REGISTRY, "latest"]), rpc("eth_getCode", [PINS.implementation, "latest"]),
    rpc("eth_call", [{ to: REGISTRY, data: "0x6c74921e" }, "latest"]),
    rpc("eth_getTransactionCount", [bindings.expectedOwner, "pending"]),
    rpc("eth_getTransactionCount", [bindings.expectedOwner, "latest"]),
    ...(source === "OWNER" ? [rpc("eth_getBalance", [bindings.expectedOwner, "latest"])] : [null]),
  ]);
  if (!onRobinhoodChain(chainId) || !Array.isArray(accounts)
    || address(accounts[0]) !== bindings.expectedOwner || decodeAddress(controllingOwner) !== bindings.expectedOwner) {
    throw new Error("Punk ownership or connected wallet changed. Reconnect its current owner on Robinhood Chain.");
  }
  if (decodeAddress(registered) !== destination || decodeAddress(owner) !== bindings.expectedOwner
    || !/^0x[0-9a-fA-F]{64}$/.test(salt ?? "")
    || keccak256Hex(registryCode) !== PINS.registryHash || keccak256Hex(implementationCode) !== PINS.implementationHash
    || code?.toLowerCase() !== agentRecoveryProxyRuntime(tokenId, salt.toLowerCase())) {
    throw new Error("Agent destination, runtime or ownership changed. Recheck its setup.");
  }
  const ownerNonce = nonceQuantity(nonce);
  if (ownerNonce === null || ownerNonce !== nonceQuantity(latestNonce)) {
    throw new Error("Your wallet has a pending transaction. Wait for it, then review funding again.");
  }
  if (source === "OWNER" && (quantity(ownerBalance) === null || quantity(ownerBalance) < amountWei)) {
    throw new Error("Your connected wallet does not have enough ETH for this funding amount.");
  }
  let reserve = 0n;
  if (source === "PUNK") {
    reserve = uint(funding?.minimumReserveWei);
    if (funding?.ok !== true || String(funding.tokenId) !== tokenId
      || address(funding.destination) !== bindings.account || reserve === null) throw new Error("Punk Wallet reserve could not be verified.");
    if (balanceWei < amountWei + reserve) throw new Error("This transfer would exceed the Punk Wallet balance or protected reserve.");
  }
  const transactionNonce = `0x${ownerNonce.toString(16)}`;
  const transaction = Object.freeze(source === "OWNER" ? {
    chainId: "0x1237", nonce: transactionNonce, from: bindings.expectedOwner, to: destination, value: `0x${amountWei.toString(16)}`, data: "0x",
  } : {
    chainId: "0x1237", nonce: transactionNonce, from: bindings.expectedOwner, to: bindings.account, value: "0x0",
    data: `0x51945447${addressWord(destination)}${word(amountWei)}${word(128)}${word(0)}${word(0)}`,
  });
  const [result, gas] = await Promise.all([
    rpc("eth_call", [transaction, "latest"]), rpc("eth_estimateGas", [transaction]),
  ]);
  if (result !== (source === "PUNK" ? EMPTY_RESULT : "0x") || !/^0x[0-9a-fA-F]+$/.test(gas ?? "") || BigInt(gas) === 0n) throw new Error("The exact gas funding transaction did not simulate successfully.");
  return Object.freeze({ tokenId, source, amount, amountWei: amountWei.toString(),
    owner: bindings.expectedOwner, punkWallet: bindings.account, destination, reserveWei: reserve.toString(), transaction });
}

export async function submitAgentGasFunding(provider, prepared, { loadContext, isCurrent, storage, locks }) {
  if (typeof loadContext !== "function") throw new Error("Fresh funding checks are unavailable. Review again.");
  return submitJournaledAgentGasFunding(provider, prepared, { isCurrent, storage, locks,
    freshReview: async shown => prepareAgentGasFunding(provider, await loadContext(),
      shown.tokenId, shown.source, shown.amount),
  });
}
