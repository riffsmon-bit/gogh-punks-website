export const ROBINHOOD_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EXECUTE_SELECTOR = "51945447";
const DEPOSIT_SELECTOR = "d0e30db0";
const WITHDRAW_SELECTOR = "2e1a7d4d";
const BALANCE_OF_SELECTOR = "70a08231";

function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Reflect.getPrototypeOf(value))) {
    throw new TypeError("wrapped native input must be a plain record");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string"
    || !keys.includes(key))) throw new TypeError("wrapped native input has unsupported fields");
  const output = Object.create(null);
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError("wrapped native input must contain data fields only");
    }
    output[key] = descriptor.value;
  }
  return Object.freeze(output);
}

function address(value, label) {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw new TypeError(`${label} must be an exact address`);
  }
  return value.toLowerCase();
}

function word(value) {
  const bigint = BigInt(value);
  if (bigint < 0n || bigint >= 2n ** 256n) throw new RangeError("ABI word is out of range");
  return bigint.toString(16).padStart(64, "0");
}

function addressWord(value) {
  return address(value, "address").slice(2).padStart(64, "0");
}

function bytesTail(data) {
  const hex = data.slice(2);
  return `${word(BigInt(hex.length / 2))}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`;
}

export function parseEthAmount(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) {
    throw new TypeError("Enter an ETH amount with no more than 18 decimal places");
  }
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0") || "0");
  if (amount === 0n) throw new RangeError("Amount must be greater than zero");
  return amount;
}

export function wrappedBalanceOfData(account) {
  return `0x${BALANCE_OF_SELECTOR}${addressWord(account)}`;
}

export function decodeUint256(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TypeError("Token balance response is invalid");
  }
  return BigInt(value);
}

export function buildWrappedNativeTransaction(rawInput) {
  const input = record(rawInput, ["direction", "punkWallet", "currentOwner", "amount"]);
  if (input.direction !== "WRAP" && input.direction !== "UNWRAP") {
    throw new TypeError("Direction must be WRAP or UNWRAP");
  }
  const punkWallet = address(input.punkWallet, "Punk Wallet");
  const currentOwner = address(input.currentOwner, "current owner");
  const amountWei = parseEthAmount(input.amount);
  const innerData = input.direction === "WRAP"
    ? `0x${DEPOSIT_SELECTOR}` : `0x${WITHDRAW_SELECTOR}${word(amountWei)}`;
  const innerValue = input.direction === "WRAP" ? amountWei : 0n;
  const executeData = `0x${EXECUTE_SELECTOR}${addressWord(ROBINHOOD_WETH)}${word(innerValue)}`
    + `${word(128n)}${word(0n)}${bytesTail(innerData)}`;
  return Object.freeze({
    direction: input.direction,
    amountWei,
    wrappedNative: ROBINHOOD_WETH.toLowerCase(),
    innerData,
    transaction: Object.freeze({
      from: currentOwner, to: punkWallet, value: "0x0", data: executeData,
    }),
  });
}

function exactTransaction(left, right) {
  return left?.from === right?.from && left?.to === right?.to
    && left?.value === right?.value && left?.data === right?.data;
}

async function providerRequest(provider, method, params = []) {
  if (!provider || typeof provider.request !== "function") {
    throw new TypeError("Wallet provider is unavailable");
  }
  return provider.request({ method, params });
}

export async function simulateWrappedNativeTransaction(provider, plan) {
  if (!plan || typeof plan !== "object" || !plan.transaction) {
    throw new TypeError("Wrapped native plan is invalid");
  }
  const [result, gas] = await Promise.all([
    providerRequest(provider, "eth_call", [plan.transaction, "latest"]),
    providerRequest(provider, "eth_estimateGas", [plan.transaction]),
  ]);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)
    || typeof gas !== "string" || !/^0x[0-9a-fA-F]+$/.test(gas) || BigInt(gas) === 0n) {
    throw new Error("The exact WETH transaction did not simulate successfully");
  }
  return Object.freeze({ result, gas });
}

export async function submitWrappedNativeTransaction(provider, reviewedPlan, rebuild, isCurrent) {
  if (typeof rebuild !== "function" || typeof isCurrent !== "function" || !isCurrent()) {
    throw new Error("Page state changed before WETH submission");
  }
  const freshPlan = await rebuild();
  if (!freshPlan || reviewedPlan.direction !== freshPlan.direction
    || reviewedPlan.amountWei !== freshPlan.amountWei
    || reviewedPlan.wrappedNative !== freshPlan.wrappedNative
    || !exactTransaction(reviewedPlan.transaction, freshPlan.transaction)
    || !isCurrent()) {
    throw new Error("Punk Wallet, owner, amount, or WETH action changed during review");
  }
  await simulateWrappedNativeTransaction(provider, freshPlan);
  if (!isCurrent()) throw new Error("Page state changed before WETH submission");
  const hash = await providerRequest(provider, "eth_sendTransaction", [freshPlan.transaction]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error("Wallet did not return a WETH transaction hash");
  }
  return Object.freeze({ hash, plan: freshPlan });
}
