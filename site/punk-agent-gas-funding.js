import { readPunkWalletFundsState } from "./punk-wallet-funds.js";

// Reviewed Robinhood deployment. Never accept a destination from chat or a form.
const REGISTRY = "0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844";
const word = value => BigInt(value).toString(16).padStart(64, "0");
const addressWord = value => value.slice(2).padStart(64, "0");
const address = value => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
  && !/^0x0{40}$/.test(value) ? value.toLowerCase() : null;
const uint = value => typeof value === "string" && /^(0|[1-9]\d{0,77})$/.test(value)
  && BigInt(value) < 2n ** 256n ? BigInt(value) : null;
const decodeAddress = value => /^0x0{24}[0-9a-fA-F]{40}$/.test(value ?? "")
  ? address(`0x${value.slice(-40)}`) : null;
const EMPTY_RESULT = `0x${word(32)}${word(0)}`;

export async function prepareAgentGasFunding(provider, { gate, agent, funding }, tokenId, source, amount) {
  if (!["PUNK", "OWNER"].includes(source) || !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(amount)) throw new Error("Choose a funding source and a valid ETH amount.");
  const [whole, fraction = ""] = amount.split(".");
  const amountWei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  if (amountWei <= 0n || amountWei > 10n ** 18n) throw new Error("Gas funding must be greater than zero and no more than 1 ETH per transfer.");
  const { bindings, balanceWei } = await readPunkWalletFundsState(provider, gate, tokenId);
  const destination = address(agent?.runtime?.account);
  if (agent?.ok !== true || String(agent.tokenId) !== tokenId || agent.runtime?.accountCreated !== true
    || address(agent.owner) !== bindings.expectedOwner || address(agent.runtime.owner) !== bindings.expectedOwner
    || !destination || destination === bindings.account) throw new Error("Agent Account is not verified for this Punk and owner. Recheck readiness.");
  const rpc = (method, params) => provider.request({ method, params });
  // account(uint256), independently binds the authenticated server result to the fixed registry.
  const [registered, owner, code] = await Promise.all([
    rpc("eth_call", [{ to: REGISTRY, data: `0x2dd7c658${word(tokenId)}` }, "latest"]),
    rpc("eth_call", [{ to: destination, data: "0x8da5cb5b" }, "latest"]),
    rpc("eth_getCode", [destination, "latest"]),
  ]);
  if (decodeAddress(registered) !== destination || decodeAddress(owner) !== bindings.expectedOwner
    || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code ?? "")) throw new Error("Agent destination or ownership changed.");
  let reserve = 0n;
  if (source === "PUNK") {
    reserve = uint(funding?.minimumReserveWei);
    if (funding?.ok !== true || String(funding.tokenId) !== tokenId
      || address(funding.destination) !== bindings.account || reserve === null) throw new Error("Punk Wallet reserve could not be verified.");
    if (balanceWei < amountWei + reserve) throw new Error("This transfer would exceed the Punk Wallet balance or protected reserve.");
  }
  const transaction = Object.freeze(source === "OWNER" ? {
    from: bindings.expectedOwner, to: destination, value: `0x${amountWei.toString(16)}`, data: "0x",
  } : {
    from: bindings.expectedOwner, to: bindings.account, value: "0x0",
    data: `0x51945447${addressWord(destination)}${word(amountWei)}${word(128)}${word(0)}${word(0)}`,
  });
  const [result, gas] = await Promise.all([
    rpc("eth_call", [transaction, "latest"]), rpc("eth_estimateGas", [transaction]),
  ]);
  if (result !== (source === "PUNK" ? EMPTY_RESULT : "0x") || !/^0x[0-9a-fA-F]+$/.test(gas ?? "") || BigInt(gas) === 0n) throw new Error("The exact gas funding transaction did not simulate successfully.");
  return Object.freeze({ tokenId, source, amount, amountWei: amountWei.toString(),
    owner: bindings.expectedOwner, punkWallet: bindings.account, destination, reserveWei: reserve.toString(), transaction });
}

export async function submitAgentGasFunding(provider, prepared, { loadContext, isCurrent }) {
  if (!isCurrent()) throw new Error("Funding selection changed. Review again.");
  const fresh = await prepareAgentGasFunding(provider, await loadContext(), prepared.tokenId, prepared.source, prepared.amount);
  if (JSON.stringify(fresh) !== JSON.stringify(prepared) || !isCurrent()) throw new Error("Funding bindings changed. Review again.");
  const hash = await provider.request({ method: "eth_sendTransaction", params: [fresh.transaction] });
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) throw new Error("Wallet returned no valid transaction hash. Check wallet activity before retrying.");
  return { hash };
}
