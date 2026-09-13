const ADDRESS = /^0x[0-9a-f]{40}$/;
const HEX = /^0x(?:[0-9a-f]{2})+$/;
const SELECTOR = /^0x[0-9a-f]{8}$/;

function address(value, label) {
  const output = typeof value === "string" ? value.toLowerCase() : "";
  if (!ADDRESS.test(output)) throw new TypeError(`${label} is invalid`);
  return output;
}
function uint(value, label) {
  const output = typeof value === "string" ? value : "";
  if (!/^(?:0|[1-9]\d{0,77})$/.test(output)) throw new TypeError(`${label} is invalid`);
  return output;
}

export function screenKnownSafeMint(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.chainId !== 4663) {
    throw new TypeError("security screening input is invalid");
  }
  const reasons = [];
  const expectedWallet = address(input.expectedPunkWallet, "expected Punk Wallet");
  const mintContract = address(input.mintContract, "mint contract");
  const transactionTo = address(input.transaction?.to, "transaction recipient");
  const valueWei = uint(input.transaction?.valueWei, "transaction value");
  const expectedValueWei = uint(input.expectedValueWei, "expected transaction value");
  const data = typeof input.transaction?.data === "string" ? input.transaction.data.toLowerCase() : "";
  const selector = data.slice(0, 10);
  const allowedSelectors = Array.isArray(input.allowedSelectors)
    ? input.allowedSelectors.filter((value) => typeof value === "string").map((value) => value.toLowerCase()) : [];
  if (!HEX.test(data) || data.length < 10) reasons.push("INVALID_CALLDATA");
  if (Object.hasOwn(input.transaction, "chainId") && input.transaction.chainId !== input.chainId) {
    reasons.push("WRONG_CHAIN");
  }
  if (Object.hasOwn(input.transaction, "from")
    && address(input.transaction.from, "transaction sender") !== expectedWallet) {
    reasons.push("WRONG_TRANSACTION_SENDER");
  }
  if (transactionTo !== mintContract) reasons.push("WRONG_TRANSACTION_RECIPIENT");
  if (valueWei !== expectedValueWei) reasons.push("UNEXPECTED_ETH_VALUE");
  if (!SELECTOR.test(selector) || !allowedSelectors.includes(selector)) reasons.push("UNRECOGNIZED_FUNCTION_SELECTOR");
  if (input.adapterRecognized !== true) reasons.push("UNRECOGNIZED_ADAPTER");
  if (input.chainCodePinned !== true) reasons.push("UNPINNED_CONTRACT_CODE");
  // Only explicit negative inspection evidence clears a known hazard.
  if (input.proxyChanged !== false) reasons.push("PROXY_OR_CODE_CHANGED");
  if (input.containsDelegatecall !== false) reasons.push("DELEGATECALL_DETECTED");
  if (input.requestsApproval !== false) reasons.push("UNEXPECTED_APPROVAL");
  if (input.requestsAssetTransfer !== false) reasons.push("UNEXPECTED_ASSET_TRANSFER");
  if (address(input.expectedNftReceiver, "expected NFT receiver") !== expectedWallet) {
    reasons.push("WRONG_NFT_RECEIVER");
  }
  return Object.freeze({ status: reasons.length ? "BLOCKED" : "PASSED",
    safeToConsider: reasons.length === 0, reasons: Object.freeze(reasons),
    selector: SELECTOR.test(selector) ? selector : null,
    disclaimer: "Screening reduces known risks but cannot guarantee safety." });
}
