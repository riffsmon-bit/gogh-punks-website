export function validateMintSimulation(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw new TypeError("simulation evidence is invalid");
  }
  const reasons = [];
  if (value.success !== true || value.reverted === true) reasons.push("SIMULATION_REVERTED");
  if (String(value.valueWei ?? "") !== String(expected.valueWei ?? "")) reasons.push("VALUE_MISMATCH");
  if (String(value.nftReceiver ?? "").toLowerCase()
    !== String(expected.punkWallet ?? "").toLowerCase()) reasons.push("WRONG_NFT_RECEIVER");
  if (!/^(?:0|[1-9]\d{0,77})$/.test(String(value.estimatedGasWei ?? ""))) reasons.push("INVALID_GAS_ESTIMATE");
  if (!Array.isArray(value.approvals) || value.approvals.length !== 0) reasons.push("UNEXPECTED_APPROVALS");
  if (!Array.isArray(value.unexpectedTransfers) || value.unexpectedTransfers.length !== 0) {
    reasons.push("UNEXPECTED_TRANSFERS");
  }
  if (value.postCallVerified !== true) reasons.push("POST_CALL_EFFECTS_UNVERIFIED");
  return Object.freeze({ status: reasons.length ? "FAILED" : "PASSED",
    reasons: Object.freeze(reasons), estimatedGasWei: reasons.includes("INVALID_GAS_ESTIMATE")
      ? null : String(value.estimatedGasWei), expectedReceiver: String(expected.punkWallet).toLowerCase(),
    executionAuthorized: false });
}
