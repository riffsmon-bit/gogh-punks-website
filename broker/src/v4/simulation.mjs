const ADDRESS = /^0x[0-9a-f]{40}$/;
const UINT = /^(?:0|[1-9]\d{0,77})$/;

function validWei(value) {
  return typeof value === "string" && UINT.test(value);
}

export function validateMintSimulation(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw new TypeError("simulation evidence is invalid");
  }
  const reasons = [];
  if (value.success !== true || value.reverted !== false) reasons.push("SIMULATION_REVERTED");
  if (!validWei(value.valueWei) || !validWei(expected.valueWei)
    || value.valueWei !== expected.valueWei) reasons.push("VALUE_MISMATCH");
  const receiver = typeof value.nftReceiver === "string" ? value.nftReceiver.toLowerCase() : "";
  const expectedReceiver = typeof expected.punkWallet === "string" ? expected.punkWallet.toLowerCase() : "";
  if (!ADDRESS.test(receiver) || !ADDRESS.test(expectedReceiver)
    || receiver !== expectedReceiver) reasons.push("WRONG_NFT_RECEIVER");
  if (!validWei(value.estimatedGasWei)) reasons.push("INVALID_GAS_ESTIMATE");
  if (!Array.isArray(value.approvals) || value.approvals.length !== 0) reasons.push("UNEXPECTED_APPROVALS");
  if (!Array.isArray(value.unexpectedTransfers) || value.unexpectedTransfers.length !== 0) {
    reasons.push("UNEXPECTED_TRANSFERS");
  }
  if (value.postCallVerified !== true) reasons.push("POST_CALL_EFFECTS_UNVERIFIED");
  return Object.freeze({ status: reasons.length ? "FAILED" : "PASSED",
    reasons: Object.freeze(reasons), estimatedGasWei: reasons.includes("INVALID_GAS_ESTIMATE")
      ? null : value.estimatedGasWei, expectedReceiver,
    executionAuthorized: false });
}
