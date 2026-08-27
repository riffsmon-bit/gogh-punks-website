import { createHash } from "node:crypto";

import { decodeFunctionData, encodeFunctionData, keccak256 } from "viem";
import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";
import { ROBINHOOD } from "../config.mjs";

export const AUTOMATED_OWNER_SETUP_INPUT_SCHEMA = "GOGH_AUTOMATED_SEADROP_OWNER_SETUP_INPUT_V1";
export const AUTOMATED_OWNER_SETUP_SCHEMA = "GOGH_AUTOMATED_SEADROP_OWNER_SETUP_V1";

const MIN_CAP = 1;
const MAX_CAP = 10;
const MIN_DURATION_DAYS = 1;
const MAX_DURATION_DAYS = 30;
const ZERO_VALUE = "0";

const REGISTRY_ABI = Object.freeze([{
  type: "function", name: "createAccount", stateMutability: "nonpayable",
  inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "accountAddress", type: "address" }],
}]);
const POLICY_ABI = Object.freeze([
  {
    type: "function", name: "configureAutomatedSeaDropPolicy", stateMutability: "nonpayable",
    inputs: [{ name: "account", type: "address" }, { name: "maxAcquisitionsPerDay", type: "uint32" }],
    outputs: [],
  },
  {
    type: "function", name: "disableAutomatedSeaDropPolicy", stateMutability: "nonpayable",
    inputs: [{ name: "account", type: "address" }], outputs: [],
  },
]);
const AGENT_REGISTRY_ABI = Object.freeze([
  {
    type: "function", name: "authorizeAgent", stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "agent", type: "address" },
      { name: "validUntil", type: "uint64" },
    ], outputs: [],
  },
  {
    type: "function", name: "revokeAgent", stateMutability: "nonpayable",
    inputs: [{ name: "account", type: "address" }, { name: "agent", type: "address" }],
    outputs: [],
  },
]);

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function snapshot(value, label) {
  try {
    return parseCanonicalJson(canonicalJson(value));
  } catch {
    fail("INVALID_JSON", `${label} must be strict canonical JSON`);
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_SCHEMA", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCHEMA", `${label} has an unsupported field set`);
  }
}

function address(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)
    || /^0x0{40}$/i.test(value)) fail("INVALID_ADDRESS", `${label} must be a nonzero address`);
  return value.toLowerCase();
}

function decimal(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("INVALID_INTEGER", `${label} must be a canonical unsigned decimal string`);
  }
  return BigInt(value);
}

function sha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function transaction(sequence, purpose, from, to, abi, functionName, args) {
  const data = encodeFunctionData({ abi, functionName, args });
  const decoded = decodeFunctionData({ abi, data });
  if (decoded.functionName !== functionName || decoded.args.length !== args.length) {
    fail("ENCODING_MISMATCH", `${purpose} failed decode equality`);
  }
  const action = {
    sequence, purpose, from, to, value: ZERO_VALUE, functionName, data,
    dataKeccak256: keccak256(data),
  };
  return Object.freeze(action);
}

export function buildAutomatedSeaDropOwnerSetup(inputValue, options = {}) {
  const input = snapshot(inputValue, "input");
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) fail("INVALID_TIME", "nowSeconds is invalid");
  exactKeys(input, [
    "schema", "version", "chainId", "checkedAt", "punk", "infrastructure", "limits", "globalAgent",
  ], "input");
  if (input.schema !== AUTOMATED_OWNER_SETUP_INPUT_SCHEMA || input.version !== 1 || input.chainId !== 4663) {
    fail("INVALID_SCHEMA", "owner setup input identity is invalid");
  }
  const checkedAtMs = Date.parse(input.checkedAt);
  if (!Number.isFinite(checkedAtMs) || Math.abs(nowSeconds - Math.floor(checkedAtMs / 1000)) > 30) {
    fail("STALE_EVIDENCE", "owner setup evidence must be within 30 seconds");
  }
  exactKeys(input.punk, ["tokenId", "collection", "expectedOwner", "account", "accountCreated"], "punk");
  const tokenId = decimal(input.punk.tokenId, "punk.tokenId");
  if (tokenId > (2n ** 256n) - 1n) fail("INVALID_INTEGER", "punk token ID exceeds uint256");
  const collection = address(input.punk.collection, "punk.collection");
  if (collection !== ROBINHOOD.canonicalCollection.toLowerCase()) fail("WRONG_COLLECTION", "wrong Punk collection");
  const owner = address(input.punk.expectedOwner, "punk.expectedOwner");
  const account = address(input.punk.account, "punk.account");
  if (typeof input.punk.accountCreated !== "boolean") fail("INVALID_SCHEMA", "accountCreated must be boolean");

  exactKeys(input.infrastructure, ["accountRegistry", "policyModule", "agentRegistry", "agent"], "infrastructure");
  const accountRegistry = address(input.infrastructure.accountRegistry, "accountRegistry");
  const policyModule = address(input.infrastructure.policyModule, "policyModule");
  const agentRegistry = address(input.infrastructure.agentRegistry, "agentRegistry");
  const agent = address(input.infrastructure.agent, "agent");
  if (new Set([owner, account, accountRegistry, policyModule, agentRegistry, agent]).size !== 6) {
    fail("ROLE_COLLISION", "owner, account, contracts, and agent must be distinct");
  }

  exactKeys(input.limits, ["maxMintsPerUtcDay", "authorizationDays"], "limits");
  if (!Number.isInteger(input.limits.maxMintsPerUtcDay)
    || input.limits.maxMintsPerUtcDay < MIN_CAP
    || input.limits.maxMintsPerUtcDay > MAX_CAP) {
    fail("INVALID_CAP", "daily cap must be an integer from 1 through 10");
  }
  if (!Number.isInteger(input.limits.authorizationDays)
    || input.limits.authorizationDays < MIN_DURATION_DAYS
    || input.limits.authorizationDays > MAX_DURATION_DAYS) {
    fail("INVALID_DURATION", "authorization must be an integer from 1 through 30 days");
  }
  const authorizationEnds = BigInt(nowSeconds + (input.limits.authorizationDays * 86_400));

  exactKeys(input.globalAgent, ["approved", "validAfter", "validUntil"], "globalAgent");
  if (input.globalAgent.approved !== true) fail("AGENT_UNAVAILABLE", "global agent is not approved");
  const globalValidAfter = decimal(input.globalAgent.validAfter, "globalAgent.validAfter");
  const globalValidUntil = decimal(input.globalAgent.validUntil, "globalAgent.validUntil");
  if (BigInt(nowSeconds) < globalValidAfter || authorizationEnds > globalValidUntil) {
    fail("AGENT_UNAVAILABLE", "requested authorization exceeds the global agent window");
  }

  const setupTransactions = [];
  if (!input.punk.accountCreated) {
    setupTransactions.push(transaction(
      1, "ACTIVATE_V2_PUNK_ACCOUNT", owner, accountRegistry,
      REGISTRY_ABI, "createAccount", [tokenId],
    ));
  }
  setupTransactions.push(transaction(
    setupTransactions.length + 1, "CONFIGURE_ZERO_SPEND_AUTONOMOUS_POLICY", owner, policyModule,
    POLICY_ABI, "configureAutomatedSeaDropPolicy", [account, input.limits.maxMintsPerUtcDay],
  ));
  setupTransactions.push(transaction(
    setupTransactions.length + 1, "AUTHORIZE_PUBLISHED_AGENT", owner, agentRegistry,
    AGENT_REGISTRY_ABI, "authorizeAgent", [account, agent, authorizationEnds],
  ));
  const stopTransactions = [
    transaction(
      1, "DISABLE_AND_PAUSE_POLICY", owner, policyModule,
      POLICY_ABI, "disableAutomatedSeaDropPolicy", [account],
    ),
    transaction(
      2, "REVOKE_PUBLISHED_AGENT", owner, agentRegistry,
      AGENT_REGISTRY_ABI, "revokeAgent", [account, agent],
    ),
  ];
  const artifact = {
    schema: AUTOMATED_OWNER_SETUP_SCHEMA,
    version: 1,
    chainId: 4663,
    generatedAt: new Date(nowSeconds * 1000).toISOString(),
    checkedAt: input.checkedAt,
    punk: { tokenId: input.punk.tokenId, collection, expectedOwner: owner, account },
    agent,
    limits: {
      maxMintsPerUtcDay: input.limits.maxMintsPerUtcDay,
      authorizationDays: input.limits.authorizationDays,
      authorizationValidUntil: authorizationEnds.toString(),
    },
    setupTransactions,
    stopTransactions,
    safety: {
      ownerWalletTransactionsRequired: setupTransactions.length,
      setupIsAtomic: false,
      walletPopupPerMintRequiredAfterSetup: false,
      transactionValueWei: ZERO_VALUE,
      paidMintsAllowed: false,
      approvalsAllowed: false,
      arbitraryCalldataAllowed: false,
      signingPerformed: false,
      submissionPerformed: false,
      chainStateWritten: false,
      mandatorySetupOrder: setupTransactions.map((item) => item.purpose),
      mandatoryStopOrder: stopTransactions.map((item) => item.purpose),
    },
  };
  return deepFreeze({ ...artifact, artifactHash: sha256(artifact) });
}
