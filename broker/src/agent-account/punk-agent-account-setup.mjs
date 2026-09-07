import { createHash } from "node:crypto";

import { decodeFunctionData, encodeFunctionData, keccak256 } from "viem";

import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";

export const PUNK_AGENT_ACCOUNT_SETUP_INPUT_SCHEMA = "GOGH_PUNK_AGENT_ACCOUNT_SETUP_INPUT_V1";
export const PUNK_AGENT_ACCOUNT_SETUP_SCHEMA = "GOGH_PUNK_AGENT_ACCOUNT_SETUP_V1";
export const ENTRY_POINT_V08 = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_VALUE = "0";
const ADDRESS = /^0x[0-9a-f]{40}$/;
const BYTES32 = /^0x[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MAX_UINT32 = (2n ** 32n) - 1n;
const MAX_UINT48 = (2n ** 48n) - 1n;
const MAX_UINT256 = (2n ** 256n) - 1n;
const MAX_SESSION_SECONDS = 30n * 86_400n;
const MAX_SESSION_MINTS = 100n;

const REGISTRY_ABI = Object.freeze([{
  type: "function", name: "createAccount", stateMutability: "nonpayable",
  inputs: [{ name: "tokenId", type: "uint256" }],
  outputs: [{ name: "accountAddress", type: "address" }],
}]);

export const PUNK_AGENT_ACCOUNT_SETUP_ABI = Object.freeze([
  {
    type: "function", name: "configureAutonomousSession", stateMutability: "nonpayable",
    inputs: [{
      name: "config", type: "tuple", components: [
        { name: "sessionKey", type: "address" },
        { name: "adapter", type: "address" },
        { name: "venue", type: "address" },
        { name: "adapterCodeHash", type: "bytes32" },
        { name: "targetCollection", type: "address" },
        { name: "validAfter", type: "uint48" },
        { name: "validUntil", type: "uint48" },
        { name: "maxMintsPerDay", type: "uint32" },
        { name: "maxMintsTotal", type: "uint32" },
        { name: "maxGasCostWei", type: "uint256" },
        { name: "minimumNativeReserveWei", type: "uint256" },
      ],
    }], outputs: [],
  },
  {
    type: "function", name: "revokeAutonomousSession", stateMutability: "nonpayable",
    inputs: [], outputs: [],
  },
]);

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SCHEMA", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    fail("INVALID_SCHEMA", `${label} has an unsupported field set`);
  }
}

function snapshot(value) {
  try {
    return parseCanonicalJson(canonicalJson(value));
  } catch {
    fail("INVALID_JSON", "Punk Agent Account setup input must be strict canonical JSON");
  }
}

function address(value, label, { zero = false } = {}) {
  const output = String(value ?? "").toLowerCase();
  if (!ADDRESS.test(output) || (!zero && output === ZERO_ADDRESS)) {
    fail("INVALID_ADDRESS", `${label} must be a ${zero ? "canonical" : "nonzero"} address`);
  }
  return output;
}

function bytes32(value, label) {
  const output = String(value ?? "").toLowerCase();
  if (!BYTES32.test(output) || /^0x0{64}$/.test(output)) {
    fail("INVALID_HASH", `${label} must be a nonzero bytes32 value`);
  }
  return output;
}

function decimal(value, label, maximum = MAX_UINT256) {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    fail("INVALID_INTEGER", `${label} must be a canonical decimal string`);
  }
  const output = BigInt(value);
  if (output > maximum) fail("INVALID_INTEGER", `${label} exceeds its contract type`);
  return output;
}

function transaction(sequence, approval, purpose, from, to, abi, functionName, args) {
  const data = encodeFunctionData({ abi, functionName, args });
  const decoded = decodeFunctionData({ abi, data });
  if (decoded.functionName !== functionName) fail("ENCODING_MISMATCH", `${purpose} failed decode`);
  return Object.freeze({
    sequence, approval, purpose, from, to, value: ZERO_VALUE,
    functionName, data: data.toLowerCase(), dataKeccak256: keccak256(data).toLowerCase(),
  });
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) freeze(value[key]);
  }
  return value;
}

export function buildPunkAgentAccountSessionSetup(inputValue, options = {}) {
  const input = snapshot(inputValue);
  const nowSeconds = BigInt(options.nowSeconds ?? Math.floor(Date.now() / 1_000));
  exactKeys(input, [
    "schema", "version", "chainId", "checkedAt", "punk", "infrastructure", "session",
  ], "input");
  if (input.schema !== PUNK_AGENT_ACCOUNT_SETUP_INPUT_SCHEMA || input.version !== 1
    || input.chainId !== 4663) fail("INVALID_SCHEMA", "Punk Agent Account setup identity is invalid");
  const checkedAt = Date.parse(input.checkedAt);
  if (!Number.isFinite(checkedAt)
    || (nowSeconds - BigInt(Math.floor(checkedAt / 1_000))) ** 2n > 30n ** 2n) {
    fail("STALE_EVIDENCE", "Punk Agent Account setup evidence must be within 30 seconds");
  }

  exactKeys(input.punk, ["tokenId", "expectedOwner", "account", "accountCreated"], "punk");
  const tokenId = decimal(input.punk.tokenId, "punk.tokenId");
  const owner = address(input.punk.expectedOwner, "punk.expectedOwner");
  const account = address(input.punk.account, "punk.account");
  if (typeof input.punk.accountCreated !== "boolean") {
    fail("INVALID_SCHEMA", "punk.accountCreated must be boolean");
  }

  exactKeys(input.infrastructure, [
    "accountRegistry", "entryPoint", "adapterRegistry", "adapter", "venue",
  ], "infrastructure");
  const accountRegistry = address(input.infrastructure.accountRegistry, "accountRegistry");
  const entryPoint = address(input.infrastructure.entryPoint, "entryPoint");
  const adapterRegistry = address(input.infrastructure.adapterRegistry, "adapterRegistry");
  const adapter = address(input.infrastructure.adapter, "adapter");
  const venue = address(input.infrastructure.venue, "venue");
  if (entryPoint !== ENTRY_POINT_V08) fail("WRONG_ENTRY_POINT", "Punk Agent Account requires EntryPoint v0.8");

  exactKeys(input.session, [
    "sessionKey", "adapterCodeHash", "targetCollection", "validAfter", "validUntil",
    "maxMintsPerDay", "maxMintsTotal", "maxGasCostWei", "minimumNativeReserveWei",
  ], "session");
  const sessionKey = address(input.session.sessionKey, "session.sessionKey");
  const adapterCodeHash = bytes32(input.session.adapterCodeHash, "session.adapterCodeHash");
  const targetCollection = address(input.session.targetCollection, "session.targetCollection", { zero: true });
  const validAfter = decimal(input.session.validAfter, "session.validAfter", MAX_UINT48);
  const validUntil = decimal(input.session.validUntil, "session.validUntil", MAX_UINT48);
  const maxMintsPerDay = decimal(input.session.maxMintsPerDay, "session.maxMintsPerDay", MAX_UINT32);
  const maxMintsTotal = decimal(input.session.maxMintsTotal, "session.maxMintsTotal", MAX_UINT32);
  const maxGasCostWei = decimal(input.session.maxGasCostWei, "session.maxGasCostWei");
  const minimumNativeReserveWei = decimal(
    input.session.minimumNativeReserveWei, "session.minimumNativeReserveWei",
  );
  if (validUntil <= nowSeconds || validAfter > validUntil
    || validUntil > nowSeconds + MAX_SESSION_SECONDS) {
    fail("INVALID_DURATION", "session validity must end within 30 days");
  }
  if (maxMintsPerDay === 0n || maxMintsTotal === 0n
    || maxMintsPerDay > maxMintsTotal || maxMintsTotal > MAX_SESSION_MINTS) {
    fail("INVALID_CAP", "session mint caps must be 1 through 100 and daily cannot exceed total");
  }
  if (maxGasCostWei === 0n) fail("INVALID_GAS_CAP", "session gas cap must be nonzero");
  const roles = [owner, account, accountRegistry, entryPoint, adapterRegistry, adapter, venue, sessionKey];
  if (new Set(roles).size !== roles.length) fail("ROLE_COLLISION", "Punk Agent Account setup roles must be distinct");

  const sessionTuple = {
    sessionKey, adapter, venue, adapterCodeHash, targetCollection,
    validAfter, validUntil, maxMintsPerDay, maxMintsTotal, maxGasCostWei,
    minimumNativeReserveWei,
  };
  const setupTransactions = [];
  if (!input.punk.accountCreated) {
    setupTransactions.push(transaction(
      1, 1, "ACTIVATE_PUNK_AGENT_ACCOUNT", owner, accountRegistry,
      REGISTRY_ABI, "createAccount", [tokenId],
    ));
  }
  setupTransactions.push(transaction(
    setupTransactions.length + 1, 2, "AUTHORIZE_MISSION_SESSION", owner, account,
    PUNK_AGENT_ACCOUNT_SETUP_ABI, "configureAutonomousSession", [sessionTuple],
  ));
  const stopTransaction = transaction(
    1, null, "REVOKE_MISSION_SESSION", owner, account,
    PUNK_AGENT_ACCOUNT_SETUP_ABI, "revokeAutonomousSession", [],
  );
  const artifact = {
    schema: PUNK_AGENT_ACCOUNT_SETUP_SCHEMA,
    version: 1,
    chainId: 4663,
    generatedAt: new Date(Number(nowSeconds) * 1_000).toISOString(),
    checkedAt: input.checkedAt,
    punk: { tokenId: tokenId.toString(), expectedOwner: owner, account },
    infrastructure: { accountRegistry, entryPoint, adapterRegistry, adapter, venue },
    session: {
      sessionKey, adapterCodeHash, targetCollection,
      validAfter: validAfter.toString(), validUntil: validUntil.toString(),
      maxMintsPerDay: maxMintsPerDay.toString(), maxMintsTotal: maxMintsTotal.toString(),
      maxGasCostWei: maxGasCostWei.toString(),
      minimumNativeReserveWei: minimumNativeReserveWei.toString(),
    },
    setupTransactions,
    stopTransaction,
    safety: {
      ownerWalletTransactionsRequired: setupTransactions.length,
      maximumOwnerApprovals: 2,
      walletPopupPerMintRequiredAfterSetup: false,
      punkFundsEntryPointGas: true,
      paidMintsAllowed: false,
      tokenApprovalsAllowed: false,
      arbitraryCalldataAllowed: false,
      paymasterAllowed: false,
      ownerCanRevokeImmediately: true,
      signingPerformed: false,
      submissionPerformed: false,
      chainStateWritten: false,
    },
  };
  const artifactHash = `0x${createHash("sha256").update(canonicalJson(artifact)).digest("hex")}`;
  return freeze({ ...artifact, artifactHash });
}
