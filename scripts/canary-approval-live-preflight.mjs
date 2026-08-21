import { createHash } from "node:crypto";
import { decodeEventLog, keccak256 } from "viem";
import { ROBINHOOD } from "../broker/src/config.mjs";
import { buildOwnerDirectCanaryConfigBundle } from "./build-owner-direct-canary-config-bundle.mjs";
import {
  canonicalConfigurationEvidenceSha256,
  validateCanaryConfigurationReceiptEvidence,
} from "../broker/src/recommendation/canary-configuration-receipt-evidence.mjs";
import {
  requireVerifiedManifestAdoption,
  sourceVerificationCanonicalSha256,
} from "../broker/src/recommendation/source-verification-adoption.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_WORD = `0x${"00".repeat(32)}`;
const EMPTY_ADAPTER_DATA_HASH =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
export const MINIMUM_SUBMISSION_MARGIN_SECONDS = 30;
const EXPECTED_POLICY_VERSION = 11n;
const EXPECTED_PERMISSION_GENERATION = 1n;
const EXPECTED_ACQUISITION_NONCE = 0n;
const ONE_SHOT_MINT_SELECTOR = "0x40c10f19";
const REQUIRED_CONTRACTS = Object.freeze([
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
]);
const OWNABLE_CONTRACTS = Object.freeze([
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
]);
const EIP1967_SLOTS = Object.freeze({
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
});

const ownerAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pendingOwner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];
const punkAbi = [{
  type: "function", name: "ownerOf", stateMutability: "view",
  inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }],
}];
const punkTransferEvent = {
  type: "event", name: "Transfer", inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
};
const accountRegistryAbi = [
  { type: "function", name: "ROBINHOOD_CHAIN_ID", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "GOGH_PUNKS", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "CANONICAL_ERC6551_REGISTRY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "canonicalRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "implementation", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "accountSalt", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  {
    type: "function", name: "account", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }],
  },
];
const canonicalRegistryAbi = [{
  type: "function", name: "account", stateMutability: "view",
  inputs: [
    { name: "implementation", type: "address" }, { name: "salt", type: "bytes32" },
    { name: "chainId", type: "uint256" }, { name: "tokenContract", type: "address" },
    { name: "tokenId", type: "uint256" },
  ],
  outputs: [{ type: "address" }],
}];
const accountAbi = [
  {
    type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [
      { name: "chainId", type: "uint256" },
      { name: "tokenContract", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
  },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "isCanonicalGoghPunkAccount", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "policyModule", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "agentRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "adapterRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "acquisitionNonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "acquisitionIntentDigest", stateMutability: "view",
    inputs: [
      {
        name: "intent", type: "tuple", components: [
          { name: "account", type: "address" }, { name: "chainId", type: "uint256" },
          { name: "expectedOwner", type: "address" }, { name: "nonce", type: "uint256" },
          { name: "policyVersion", type: "uint64" }, { name: "opportunityType", type: "uint8" },
          { name: "assetStandard", type: "uint8" }, { name: "adapter", type: "address" },
          { name: "venue", type: "address" }, { name: "collection", type: "address" },
          { name: "tokenId", type: "uint256" }, { name: "assetAmount", type: "uint256" },
          { name: "currency", type: "address" }, { name: "expectedPrice", type: "uint256" },
          { name: "maxPrice", type: "uint256" }, { name: "maxSlippageBps", type: "uint16" },
          { name: "createdAt", type: "uint64" }, { name: "expiresAt", type: "uint64" },
          { name: "opportunityId", type: "bytes32" }, { name: "reasoningHash", type: "bytes32" },
          { name: "adapterCodeHash", type: "bytes32" },
        ],
      },
      { name: "adapterDataHash", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function", name: "executeApprovedAcquisition", stateMutability: "nonpayable",
    inputs: [
      {
        name: "intent", type: "tuple", components: [
          { name: "account", type: "address" }, { name: "chainId", type: "uint256" },
          { name: "expectedOwner", type: "address" }, { name: "nonce", type: "uint256" },
          { name: "policyVersion", type: "uint64" }, { name: "opportunityType", type: "uint8" },
          { name: "assetStandard", type: "uint8" }, { name: "adapter", type: "address" },
          { name: "venue", type: "address" }, { name: "collection", type: "address" },
          { name: "tokenId", type: "uint256" }, { name: "assetAmount", type: "uint256" },
          { name: "currency", type: "address" }, { name: "expectedPrice", type: "uint256" },
          { name: "maxPrice", type: "uint256" }, { name: "maxSlippageBps", type: "uint16" },
          { name: "createdAt", type: "uint64" }, { name: "expiresAt", type: "uint64" },
          { name: "opportunityId", type: "bytes32" }, { name: "reasoningHash", type: "bytes32" },
          { name: "adapterCodeHash", type: "bytes32" },
        ],
      },
      { name: "adapterData", type: "bytes" }, { name: "ownerSignature", type: "bytes" },
    ],
    outputs: [{ type: "bytes" }],
  },
];
const policyAbi = [
  ...ownerAbi,
  { type: "function", name: "adapterRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "globallyPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "function", name: "featureFlags", stateMutability: "view", inputs: [], outputs: [{
      type: "tuple", components: [
        { name: "scoutMode", type: "bool" }, { name: "approvalPurchases", type: "bool" },
        { name: "autonomousPurchases", type: "bool" }, { name: "autonomousMints", type: "bool" },
        { name: "unknownCollectionExecution", type: "bool" }, { name: "selling", type: "bool" },
        { name: "autonomousSelling", type: "bool" },
      ],
    }],
  },
  {
    type: "function", name: "policy", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{
      type: "tuple", components: [
        {
          name: "config", type: "tuple", components: [
            { name: "mode", type: "uint8" }, { name: "maxSpendPerTransaction", type: "uint256" },
            { name: "maxSpendPerDay", type: "uint256" }, { name: "maxSpendPerWeek", type: "uint256" },
            { name: "maxMintPrice", type: "uint256" }, { name: "maxSecondaryPurchasePrice", type: "uint256" },
            { name: "minimumNativeReserve", type: "uint256" }, { name: "maxAcquisitionsPerDay", type: "uint32" },
            { name: "maxIntentAge", type: "uint32" }, { name: "maxSlippageBps", type: "uint16" },
            { name: "requireCollectionAllowlist", type: "bool" }, { name: "allowUnknownCollections", type: "bool" },
          ],
        },
        { name: "configuredBy", type: "address" }, { name: "version", type: "uint64" },
        { name: "permissionGeneration", type: "uint64" }, { name: "accountPaused", type: "bool" },
      ],
    }],
  },
  { type: "function", name: "effectiveMode", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint8" }] },
  {
    type: "function", name: "mintControls", stateMutability: "view",
    inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: [
      { name: "ownerApprovedMints", type: "bool" }, { name: "autonomousFreeMints", type: "bool" },
      { name: "autonomousPaidMints", type: "bool" },
    ] }],
  },
  ...[
    "approvedAdapters", "approvedMintContracts", "approvedCollections", "deniedCollections",
  ].map((name) => ({
    type: "function", name, stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }],
  })),
  ...["approvedSelectors", "deniedSelectors"].map((name) => ({
    type: "function", name, stateMutability: "view",
    inputs: [{ type: "address" }, { type: "bytes4" }], outputs: [{ type: "bool" }],
  })),
  {
    type: "function", name: "currencyPolicy", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "tuple", components: [
      { name: "allowed", type: "bool" }, { name: "maxSpendPerTransaction", type: "uint256" },
      { name: "maxSpendPerDay", type: "uint256" }, { name: "maxSpendPerWeek", type: "uint256" },
      { name: "maxMintPrice", type: "uint256" }, { name: "maxSecondaryPurchasePrice", type: "uint256" },
    ] }],
  },
  {
    type: "function", name: "venueCurrencyMaximum", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "acquisitionUsage", stateMutability: "view",
    inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: [
      { name: "dayBucket", type: "uint64" }, { name: "acquisitionsToday", type: "uint32" },
    ] }],
  },
];
const adapterRegistryAbi = [
  ...ownerAbi,
  { type: "function", name: "globallyPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "function", name: "adapterRecord", stateMutability: "view",
    inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: [
      { name: "kind", type: "uint8" }, { name: "active", type: "bool" },
      { name: "venue", type: "address" }, { name: "adapterCodeHash", type: "bytes32" },
      { name: "venueCodeHash", type: "bytes32" }, { name: "versionHash", type: "bytes32" },
      { name: "metadataHash", type: "bytes32" },
    ] }],
  },
];
const agentRegistryAbi = [
  ...ownerAbi,
  { type: "function", name: "globallyPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
];
const mintAdapterAbi = [
  { type: "function", name: "kind", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "venue", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "collection", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "mintSelector", stateMutability: "view", inputs: [], outputs: [{ type: "bytes4" }] },
  { type: "function", name: "assetStandard", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];

const policyMutationEventAbi = [
  { type: "event", name: "OwnershipTransferred", inputs: [
    { name: "previousOwner", type: "address", indexed: true },
    { name: "newOwner", type: "address", indexed: true },
  ] },
  {
    type: "event", name: "FeatureFlagsChanged", inputs: [{ name: "flags", type: "tuple", indexed: false,
      components: [
        { name: "scoutMode", type: "bool" }, { name: "approvalPurchases", type: "bool" },
        { name: "autonomousPurchases", type: "bool" }, { name: "autonomousMints", type: "bool" },
        { name: "unknownCollectionExecution", type: "bool" }, { name: "selling", type: "bool" },
        { name: "autonomousSelling", type: "bool" },
      ] }],
  },
  { type: "event", name: "GlobalPolicyPauseChanged", inputs: [
    { name: "paused", type: "bool", indexed: false },
  ] },
  { type: "event", name: "PolicyConfigured", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "version", type: "uint64", indexed: true },
    { name: "mode", type: "uint8", indexed: false },
  ] },
  { type: "event", name: "AccountPauseChanged", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "paused", type: "bool", indexed: false },
    { name: "version", type: "uint64", indexed: false },
  ] },
  { type: "event", name: "AdapterPermissionChanged", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "adapter", type: "address", indexed: true },
    { name: "allowed", type: "bool", indexed: false },
  ] },
  { type: "event", name: "VenuePermissionChanged", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "venue", type: "address", indexed: true },
    { name: "kind", type: "uint8", indexed: true },
    { name: "allowed", type: "bool", indexed: false },
  ] },
  { type: "event", name: "CollectionPermissionChanged", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "collection", type: "address", indexed: true },
    { name: "allowed", type: "bool", indexed: false },
    { name: "denied", type: "bool", indexed: false },
  ] },
  { type: "event", name: "CurrencyPolicyChanged", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "currency", type: "address", indexed: true },
    { name: "policy", type: "tuple", indexed: false, components: [
      { name: "allowed", type: "bool" },
      { name: "maxSpendPerTransaction", type: "uint256" },
      { name: "maxSpendPerDay", type: "uint256" },
      { name: "maxSpendPerWeek", type: "uint256" },
      { name: "maxMintPrice", type: "uint256" },
      { name: "maxSecondaryPurchasePrice", type: "uint256" },
    ] },
  ] },
  { type: "event", name: "VenueCurrencyMaximumChanged", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "venue", type: "address", indexed: true },
    { name: "currency", type: "address", indexed: true },
    { name: "maximum", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "SelectorPermissionChanged", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "selector", type: "bytes4", indexed: true },
    { name: "allowed", type: "bool", indexed: false },
    { name: "denied", type: "bool", indexed: false },
  ] },
  { type: "event", name: "MintControlsChanged", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "ownerApprovedMints", type: "bool", indexed: false },
    { name: "autonomousFreeMints", type: "bool", indexed: false },
    { name: "autonomousPaidMints", type: "bool", indexed: false },
    { name: "policyVersion", type: "uint64", indexed: false },
  ] },
  { type: "event", name: "AcquisitionPolicyConsumed", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "opportunityId", type: "bytes32", indexed: true },
    { name: "currency", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
    { name: "spentToday", type: "uint256", indexed: false },
    { name: "spentThisWeek", type: "uint256", indexed: false },
    { name: "acquisitionsToday", type: "uint32", indexed: false },
    { name: "ownerApproved", type: "bool", indexed: false },
    { name: "policyVersion", type: "uint64", indexed: false },
  ] },
];

const adapterMutationEventAbi = [
  { type: "event", name: "OwnershipTransferred", inputs: [
    { name: "previousOwner", type: "address", indexed: true },
    { name: "newOwner", type: "address", indexed: true },
  ] },
  { type: "event", name: "AdapterRegistered", inputs: [
    { name: "adapter", type: "address", indexed: true },
    { name: "venue", type: "address", indexed: true },
    { name: "kind", type: "uint8", indexed: true },
    { name: "adapterCodeHash", type: "bytes32", indexed: false },
    { name: "venueCodeHash", type: "bytes32", indexed: false },
    { name: "versionHash", type: "bytes32", indexed: false },
    { name: "metadataHash", type: "bytes32", indexed: false },
  ] },
  { type: "event", name: "AdapterStatusChanged", inputs: [
    { name: "adapter", type: "address", indexed: true },
    { name: "active", type: "bool", indexed: false },
  ] },
  { type: "event", name: "GlobalAdapterPauseChanged", inputs: [
    { name: "paused", type: "bool", indexed: false },
  ] },
];

const accountActivityEventAbi = [
  { type: "event", name: "PendingAcquisitionsCancelled", inputs: [
    { name: "owner", type: "address", indexed: true },
    { name: "previousNonce", type: "uint256", indexed: false },
    { name: "newNonce", type: "uint256", indexed: false },
    { name: "state", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "AcquisitionExecuted", inputs: [
    { name: "executor", type: "address", indexed: true },
    { name: "opportunityId", type: "bytes32", indexed: true },
    { name: "collection", type: "address", indexed: true },
    { name: "opportunityType", type: "uint8", indexed: false },
    { name: "assetStandard", type: "uint8", indexed: false },
    { name: "adapter", type: "address", indexed: false },
    { name: "venue", type: "address", indexed: false },
    { name: "tokenId", type: "uint256", indexed: false },
    { name: "assetAmount", type: "uint256", indexed: false },
    { name: "currency", type: "address", indexed: false },
    { name: "price", type: "uint256", indexed: false },
    { name: "ownerApproved", type: "bool", indexed: false },
    { name: "reasoningHash", type: "bytes32", indexed: false },
    { name: "policyVersion", type: "uint64", indexed: false },
    { name: "nonce", type: "uint256", indexed: false },
    { name: "state", type: "uint256", indexed: false },
  ] },
];

const agentMutationEventAbi = [
  { type: "event", name: "OwnershipTransferred", inputs: [
    { name: "previousOwner", type: "address", indexed: true },
    { name: "newOwner", type: "address", indexed: true },
  ] },
  { type: "event", name: "GlobalAgentConfigured", inputs: [
    { name: "agent", type: "address", indexed: true },
    { name: "approved", type: "bool", indexed: false },
    { name: "validAfter", type: "uint64", indexed: false },
    { name: "validUntil", type: "uint64", indexed: false },
    { name: "versionHash", type: "bytes32", indexed: false },
    { name: "metadataHash", type: "bytes32", indexed: false },
  ] },
  { type: "event", name: "AgentAuthorized", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "agent", type: "address", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "validUntil", type: "uint64", indexed: false },
    { name: "generation", type: "uint64", indexed: false },
  ] },
  { type: "event", name: "AgentRevoked", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "agent", type: "address", indexed: true },
    { name: "owner", type: "address", indexed: true },
  ] },
  { type: "event", name: "AllAgentsRevoked", inputs: [
    { name: "account", type: "address", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "newGeneration", type: "uint64", indexed: false },
  ] },
  { type: "event", name: "GlobalAgentPauseChanged", inputs: [
    { name: "paused", type: "bool", indexed: false },
  ] },
];

export class LiveApprovalPreflightError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LiveApprovalPreflightError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new LiveApprovalPreflightError(code, `READ-ONLY preflight failed: ${message}`);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCHEMA", `${label} fields do not match the canonical schema`);
  }
}

function assertJsonData(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_SCHEMA", `${label} contains an unsafe number`);
    return;
  }
  if (!value || typeof value !== "object") fail("INVALID_SCHEMA", `${label} is not JSON data`);
  if (seen.has(value)) fail("INVALID_SCHEMA", `${label} contains a cycle`);
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  const expectedPrototype = Array.isArray(value) ? Array.prototype : Object.prototype;
  if (prototype !== expectedPrototype && prototype !== null) {
    fail("INVALID_SCHEMA", `${label} has a custom prototype`);
  }
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => key !== "length"
      && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)))) {
      fail("INVALID_SCHEMA", `${label} has an extra array field`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail("INVALID_SCHEMA", `${label} contains an array hole`);
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string") fail("INVALID_SCHEMA", `${label} contains a symbol field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("INVALID_SCHEMA", `${label}.${key} is not an enumerable data field`);
    }
    assertJsonData(descriptor.value, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function address(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_ADDRESS", `${label} is not an address`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === ZERO_ADDRESS) fail("INVALID_ADDRESS", `${label} is zero`);
  return normalized;
}

function bytes32(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail("INVALID_HASH", `${label} is not bytes32`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === ZERO_WORD) fail("INVALID_HASH", `${label} is zero`);
  return normalized;
}

function uint(value, label) {
  if ((typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value))
    && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    && !(typeof value === "bigint" && value >= 0n)) {
    fail("INVALID_INTEGER", `${label} is not an unsigned integer`);
  }
  return BigInt(value);
}

function same(actual, expected, code, label) {
  const normalizedActual = typeof actual === "bigint" ? actual.toString()
    : typeof actual === "string" ? actual.toLowerCase() : actual;
  const normalizedExpected = typeof expected === "bigint" ? expected.toString()
    : typeof expected === "string" ? expected.toLowerCase() : expected;
  if (normalizedActual !== normalizedExpected) fail(code, `${label} does not match`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function strictJsonSnapshot(value, label, maximumBytes = 8_000_000) {
  assertJsonData(value, label);
  let clone;
  try {
    clone = structuredClone(value);
  } catch {
    fail("INVALID_SCHEMA", `${label} may not contain a Proxy or uncloneable value`);
  }
  assertJsonData(clone, `${label} snapshot`);
  const serialized = canonicalJson(clone);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    fail("INVALID_SCHEMA", `${label} exceeds its canonical size limit`);
  }
  return JSON.parse(serialized);
}

function canonicalRpcValue(value, label, seen = new Set()) {
  // viem uses own `undefined` fields for optional RPC values (for example
  // pre-4844 blob fields). Preserve them without invoking JSON hooks.
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return `bigint:${value}`;
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return canonicalJson(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("INVALID_RPC_RESPONSE", `${label} has an unsafe number`);
    return `number:${value}`;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    fail("INVALID_RPC_RESPONSE", `${label} is not acyclic RPC data`);
  }
  seen.add(value);
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (isArray ? Array.prototype : Object.prototype) && prototype !== null) {
    fail("INVALID_RPC_RESPONSE", `${label} has a custom prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail("INVALID_RPC_RESPONSE", `${label} has a symbol field`);
  }
  if (isArray) {
    if (keys.some((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key))) {
      fail("INVALID_RPC_RESPONSE", `${label} has an extra array field`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail("INVALID_RPC_RESPONSE", `${label} has an array hole`);
    }
  }
  const dataKeys = keys.filter((key) => key !== "length").sort();
  const encoded = dataKeys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail("INVALID_RPC_RESPONSE", `${label}.${key} is not an enumerable data field`);
    }
    return `${canonicalJson(key)}:${canonicalRpcValue(descriptor.value, `${label}.${key}`, seen)}`;
  });
  seen.delete(value);
  return isArray ? `[${encoded.join(",")}]` : `{${encoded.join(",")}}`;
}

function canonicalSha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function clockSeconds(clock, label) {
  let value;
  try {
    value = clock();
  } catch {
    fail("INVALID_TIME", `${label} clock read failed`);
  }
  if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_TIME", `${label} is invalid`);
  return value;
}

function field(value, name, index) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  if (Object.hasOwn(value, name)) return value[name];
  if (Object.hasOwn(value, index)) return value[index];
  return undefined;
}

function clientIdentity(client) {
  if (!client || typeof client !== "object") return undefined;
  const ownData = (object, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && !descriptor.get && !descriptor.set ? descriptor.value : undefined;
  };
  const transport = ownData(client, "transport");
  if (transport && typeof transport === "object") {
    const directUrl = ownData(transport, "url");
    if (directUrl !== undefined) return directUrl;
    const transportValue = ownData(transport, "value");
    if (transportValue && typeof transportValue === "object") {
      const nestedUrl = ownData(transportValue, "url");
      if (nestedUrl !== undefined) return nestedUrl;
    }
  }
  const name = ownData(client, "name");
  if (name !== undefined) return name;
  const uid = ownData(client, "uid");
  if (uid !== undefined) return uid;
  return undefined;
}

function assertClient(client, label) {
  for (const method of [
    "getChainId", "getBlockNumber", "getBlock", "getCode", "getStorageAt",
    "readContract", "simulateContract", "getTransaction", "getTransactionReceipt", "getLogs",
  ]) {
    if (typeof client?.[method] !== "function") fail("INVALID_CLIENT", `${label}.${method} is required`);
  }
}

async function dual(label, primaryClient, secondaryClient, operation) {
  let primary;
  let secondary;
  try {
    [primary, secondary] = await Promise.all([
      operation(primaryClient),
      operation(secondaryClient),
    ]);
  } catch (error) {
    fail("LIVE_READ_FAILED", `${label}: ${error?.shortMessage ?? error?.message ?? "read failed"}`);
  }
  if (canonicalRpcValue(primary, `${label}.primary`)
    !== canonicalRpcValue(secondary, `${label}.secondary`)) {
    fail("RPC_DISAGREEMENT", `${label} differs between independent clients`);
  }
  return primary;
}

async function dualRead(primaryClient, secondaryClient, blockNumber, request, label) {
  return dual(label, primaryClient, secondaryClient, (client) => client.readContract({
    ...request,
    blockNumber,
  }));
}

function validateManifest(manifest) {
  exactKeys(manifest, [
    "status", "chain", "canonicalCollection", "canonicalERC6551Registry",
    "canonicalERC6551RegistryRuntimeCodeHash",
    "verifiedExternalInfrastructure", "accountSalt", "gitCommit", "compiler", "evmVersion",
    "optimizerRuns", "contracts", "sourceVerificationAdoption", "featureFlags",
    "protocolGuardian", "notes",
  ], "manifest");
  if (manifest.status !== "DEPLOYED") fail("NOT_DEPLOYED", "manifest status is not DEPLOYED");
  exactKeys(manifest.chain, [
    "name", "chainId", "rpcEnvironmentVariable", "explorer", "nativeCurrency",
  ], "manifest.chain");
  same(manifest.chain?.chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "manifest chain ID");
  same(address(manifest.canonicalCollection, "manifest canonical collection"),
    ROBINHOOD.canonicalCollection, "NONCANONICAL_COLLECTION", "canonical collection");
  const guardian = address(manifest.protocolGuardian, "protocol guardian");
  same(address(manifest.canonicalERC6551Registry, "canonical ERC-6551 registry"),
    ROBINHOOD.canonicalERC6551Registry, "WIRING_MISMATCH", "canonical ERC-6551 registry");
  const canonicalRegistryRuntimeCodeHash = bytes32(
    manifest.canonicalERC6551RegistryRuntimeCodeHash,
    "canonical ERC-6551 registry runtime hash",
  );
  same(canonicalRegistryRuntimeCodeHash, ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash,
    "CODE_HASH_MISMATCH", "canonical ERC-6551 registry manifest runtime hash");
  same(bytes32(manifest.accountSalt, "account salt", { allowZero: true }), ZERO_WORD,
    "WIRING_MISMATCH", "account salt");
  if (typeof manifest.gitCommit !== "string" || !/^[0-9a-f]{40}$/i.test(manifest.gitCommit)) {
    fail("INCOMPLETE_MANIFEST", "manifest gitCommit is missing");
  }
  plainObject(manifest.contracts, "manifest contracts");
  exactKeys(manifest.featureFlags, [
    "ENABLE_SCOUT_MODE", "ENABLE_APPROVAL_PURCHASES", "ENABLE_AUTONOMOUS_PURCHASES",
    "ENABLE_AUTONOMOUS_MINTS", "ENABLE_UNKNOWN_COLLECTION_EXECUTION", "ENABLE_SELLING",
    "ENABLE_AUTONOMOUS_SELLING",
  ], "manifest.featureFlags");
  const expectedFlags = {
    ENABLE_SCOUT_MODE: true,
    ENABLE_APPROVAL_PURCHASES: false,
    ENABLE_AUTONOMOUS_PURCHASES: false,
    ENABLE_AUTONOMOUS_MINTS: false,
    ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
    ENABLE_SELLING: false,
    ENABLE_AUTONOMOUS_SELLING: false,
  };
  for (const [name, expected] of Object.entries(expectedFlags)) {
    same(manifest.featureFlags[name], expected, "FEATURE_FLAG_MISMATCH", `manifest ${name}`);
  }
  const contracts = {};
  const contractAddresses = new Set();
  for (const name of REQUIRED_CONTRACTS) {
    const record = manifest.contracts[name];
    exactKeys(record, [
      "address", "deploymentTransaction", "deploymentBlock", "deployer", "implementationVersion",
      "constructorArguments", "creationBytecodeHash", "runtimeBytecodeHash", "gitCommit",
      "verificationStatus",
    ], `manifest.contracts.${name}`);
    contracts[name] = {
      ...record,
      address: address(record.address, `${name} address`),
      runtimeBytecodeHash: bytes32(record.runtimeBytecodeHash, `${name} runtime hash`),
    };
    if (contractAddresses.has(contracts[name].address)) {
      fail("INCOMPLETE_MANIFEST", `${name} reuses another protocol contract address`);
    }
    contractAddresses.add(contracts[name].address);
    bytes32(record.deploymentTransaction, `${name} deployment transaction`);
    if (!Number.isSafeInteger(record.deploymentBlock) || record.deploymentBlock <= 0) {
      fail("INCOMPLETE_MANIFEST", `${name} deployment block is missing`);
    }
    address(record.deployer, `${name} deployer`);
    if (record.constructorArguments === null || record.implementationVersion !== "1") {
      fail("INCOMPLETE_MANIFEST", `${name} version or constructor arguments are missing`);
    }
    bytes32(record.creationBytecodeHash, `${name} creation hash`);
    if (record.gitCommit !== manifest.gitCommit || record.verificationStatus !== "VERIFIED") {
      fail("INCOMPLETE_MANIFEST", `${name} is not tied to the verified manifest commit`);
    }
  }
  let sourceVerificationAdoption;
  try {
    sourceVerificationAdoption = requireVerifiedManifestAdoption(manifest, REQUIRED_CONTRACTS);
  } catch (error) {
    fail(error?.code ?? "SOURCE_VERIFICATION_NOT_ADOPTED",
      error?.message ?? "core source verification adoption is invalid");
  }
  return {
    contracts,
    guardian,
    accountSalt: manifest.accountSalt.toLowerCase(),
    canonicalRegistryRuntimeCodeHash,
    sourceVerificationAdoption,
    sourceVerificationAdoptionSha256:
      sourceVerificationCanonicalSha256(sourceVerificationAdoption),
  };
}

function validateProposalArtifact(artifact, nowSeconds) {
  exactKeys(artifact, ["hashAlgorithm", "proposalHash", "proposal"], "proposal artifact");
  if (artifact.hashAlgorithm !== "SHA256_CANONICAL_JSON_V1") {
    fail("INVALID_PROPOSAL", "unsupported proposal hash algorithm");
  }
  const proposal = plainObject(artifact.proposal, "proposal");
  exactKeys(proposal, [
    "schema", "stage", "punk", "authorization", "intent", "eip712", "humanReview",
    "localArtifacts",
  ], "proposal");
  const recomputed = `0x${createHash("sha256").update(canonicalJson(proposal)).digest("hex")}`;
  same(bytes32(artifact.proposalHash, "proposal hash"), recomputed,
    "PROPOSAL_HASH_MISMATCH", "proposal hash");
  if (proposal.schema !== "GOGH_OWNER_REVIEW_FREE_MINT_PROPOSAL_V1"
    || proposal.stage !== "LOCAL_OWNER_REVIEW") {
    fail("INVALID_PROPOSAL", "proposal is not the canonical owner-review artifact");
  }
  const auth = proposal.authorization;
  exactKeys(auth, [
    "executionPath", "ownerReviewRequested", "ownerApprovalObtained",
    "approvalPurchasesStaged", "executionEnabled", "autonomousPurchasesEnabled",
    "autonomousMintsEnabled", "unknownCollectionExecutionEnabled", "sellingEnabled",
  ], "proposal.authorization");
  if (auth?.executionPath !== "OWNER_APPROVAL_REQUIRED"
    || auth?.ownerReviewRequested !== true || auth?.ownerApprovalObtained !== false
    || auth?.approvalPurchasesStaged !== true || auth?.executionEnabled !== false
    || auth?.autonomousPurchasesEnabled !== false || auth?.autonomousMintsEnabled !== false
    || auth?.unknownCollectionExecutionEnabled !== false || auth?.sellingEnabled !== false) {
    fail("INVALID_PROPOSAL", "proposal authorization is not review-only");
  }
  const punk = proposal.punk;
  exactKeys(punk, ["chainId", "collection", "tokenId", "account", "expectedOwner"],
    "proposal.punk");
  same(punk?.chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "proposal chain ID");
  same(address(punk?.collection, "proposal Punk collection"), ROBINHOOD.canonicalCollection,
    "NONCANONICAL_COLLECTION", "proposal Punk collection");
  const intent = plainObject(proposal.intent, "proposal intent");
  exactKeys(intent, [
    "account", "chainId", "expectedOwner", "nonce", "policyVersion", "opportunityType",
    "assetStandard", "adapter", "venue", "collection", "tokenId", "assetAmount", "currency",
    "expectedPrice", "maxPrice", "maxSlippageBps", "createdAt", "expiresAt", "opportunityId",
    "reasoningHash", "adapterCodeHash",
  ], "proposal.intent");
  exactKeys(proposal.humanReview, [
    "summary", "target", "outputTokenId", "outputAmount", "totalPrice", "expiresInSeconds",
    "requiredChecks",
  ], "proposal.humanReview");
  const target = proposal.humanReview?.target;
  exactKeys(target, [
    "adapter", "venue", "collection", "mintSelector", "adapterDataPolicy", "adapterDataHash",
  ], "proposal.humanReview.target");
  exactKeys(proposal.eip712, [
    "domain", "primaryType", "adapterDataPolicy", "adapterDataHash", "intentDigest",
    "derivation", "liveDeploymentVerified", "ownerApprovalObtained",
  ], "proposal.eip712");
  exactKeys(proposal.eip712.domain, ["name", "version", "chainId", "verifyingContract"],
    "proposal.eip712.domain");
  exactKeys(proposal.localArtifacts, [
    "signingPerformed", "submissionPerformed", "chainWritePerformed",
  ], "proposal.localArtifacts");
  if (intent.opportunityType !== "FREE_MINT" || intent.assetStandard !== "ERC721"
    || uint(intent.assetAmount, "asset amount") !== 1n || uint(intent.expectedPrice, "expected price") !== 0n
    || uint(intent.maxPrice, "maximum price") !== 0n || uint(intent.maxSlippageBps, "slippage") !== 0n
    || address(intent.currency, "currency", { allowZero: true }) !== ZERO_ADDRESS) {
    fail("INVALID_PROPOSAL", "intent is not an exact zero-payment single-token free mint");
  }
  for (const name of ["adapter", "venue", "collection"]) {
    same(address(target?.[name], `target ${name}`), address(intent[name], `intent ${name}`),
      "TARGET_MISMATCH", name);
  }
  same(target?.mintSelector?.toLowerCase(), ONE_SHOT_MINT_SELECTOR,
    "INVALID_PROPOSAL", "one-shot mint selector");
  same(address(intent.venue, "intent venue"), address(intent.collection, "intent collection"),
    "TARGET_MISMATCH", "one-shot venue and collection");
  if (target.adapterDataPolicy !== "EMPTY_ONLY"
    || target.adapterDataHash?.toLowerCase() !== EMPTY_ADAPTER_DATA_HASH
    || proposal.eip712?.adapterDataPolicy !== "EMPTY_ONLY"
    || proposal.eip712?.adapterDataHash?.toLowerCase() !== EMPTY_ADAPTER_DATA_HASH
    || proposal.eip712?.ownerApprovalObtained !== false
    || proposal.eip712?.liveDeploymentVerified !== false
    || proposal.eip712?.primaryType !== "AcquisitionIntent"
    || proposal.eip712?.derivation !== "LOCAL_CURRENT_GOGH_PUNK_ACCOUNT_V1"
    || proposal.localArtifacts.signingPerformed !== false
    || proposal.localArtifacts.submissionPerformed !== false
    || proposal.localArtifacts.chainWritePerformed !== false) {
    fail("INVALID_PROPOSAL", "empty adapter data or approval status is not explicit");
  }
  same(address(intent.account, "intent account"), address(punk.account, "Punk account"),
    "TARGET_MISMATCH", "intent account");
  same(address(intent.expectedOwner, "intent owner"), address(punk.expectedOwner, "Punk owner"),
    "TARGET_MISMATCH", "intent owner");
  same(intent.chainId, punk.chainId, "TARGET_MISMATCH", "intent chain");
  same(intent.tokenId, proposal.humanReview?.outputTokenId, "TARGET_MISMATCH", "output token ID");
  same(proposal.humanReview.outputAmount, "1", "TARGET_MISMATCH", "review output amount");
  same(proposal.humanReview.totalPrice, "0", "TARGET_MISMATCH", "review total price");
  same(proposal.eip712.domain.name, "Gogh Punk Account", "INVALID_PROPOSAL", "EIP-712 name");
  same(proposal.eip712.domain.version, "1", "INVALID_PROPOSAL", "EIP-712 version");
  same(proposal.eip712.domain.chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "EIP-712 chain ID");
  same(address(proposal.eip712.domain.verifyingContract, "EIP-712 verifying contract"),
    address(intent.account, "intent account"), "TARGET_MISMATCH", "EIP-712 verifying contract");
  for (const name of ["opportunityId", "reasoningHash", "adapterCodeHash"]) {
    bytes32(intent[name], `intent ${name}`);
  }
  const createdAt = uint(intent.createdAt, "intent createdAt");
  const expiresAt = uint(intent.expiresAt, "intent expiresAt");
  same(uint(intent.policyVersion, "policy version"), EXPECTED_POLICY_VERSION,
    "POLICY_MISMATCH", "proposal policy version");
  same(uint(intent.nonce, "nonce"), EXPECTED_ACQUISITION_NONCE,
    "NONCE_MISMATCH", "proposal acquisition nonce");
  if (expiresAt <= createdAt || expiresAt - createdAt > 120n || BigInt(nowSeconds) > expiresAt) {
    fail("STALE_PROPOSAL", "intent is expired or exceeds the 120-second lifetime");
  }
  same(proposal.humanReview.expiresInSeconds, Number(expiresAt - createdAt),
    "TARGET_MISMATCH", "review expiry");
  return {
    proposal,
    punkTokenId: uint(punk.tokenId, "Punk token ID"),
    account: address(punk.account, "Punk account"),
    expectedOwner: address(punk.expectedOwner, "expected owner"),
    adapter: address(intent.adapter, "adapter"),
    venue: address(intent.venue, "venue"),
    collection: address(intent.collection, "collection"),
    selector: target.mintSelector.toLowerCase(),
    assetStandard: intent.assetStandard === "ERC721" ? 0 : 1,
    policyVersion: uint(intent.policyVersion, "policy version"),
    nonce: uint(intent.nonce, "nonce"),
    createdAt,
    expiresAt,
    digest: bytes32(proposal.eip712?.intentDigest, "intent digest"),
    proposalHash: bytes32(artifact.proposalHash, "proposal hash"),
    solidityIntent: {
      account: intent.account,
      chainId: BigInt(intent.chainId),
      expectedOwner: intent.expectedOwner,
      nonce: BigInt(intent.nonce),
      policyVersion: BigInt(intent.policyVersion),
      opportunityType: 2,
      assetStandard: intent.assetStandard === "ERC721" ? 0 : 1,
      adapter: intent.adapter,
      venue: intent.venue,
      collection: intent.collection,
      tokenId: BigInt(intent.tokenId),
      assetAmount: BigInt(intent.assetAmount),
      currency: intent.currency,
      expectedPrice: BigInt(intent.expectedPrice),
      maxPrice: BigInt(intent.maxPrice),
      maxSlippageBps: Number(intent.maxSlippageBps),
      createdAt: BigInt(intent.createdAt),
      expiresAt: BigInt(intent.expiresAt),
      opportunityId: intent.opportunityId,
      reasoningHash: intent.reasoningHash,
      adapterCodeHash: intent.adapterCodeHash,
    },
  };
}

function validateConfigurationInputs(configBundleArtifact, configurationEvidenceArtifact,
  manifest, canaryManifest) {
  let expectedBundle;
  try {
    expectedBundle = buildOwnerDirectCanaryConfigBundle(manifest, canaryManifest);
  } catch (error) {
    fail(error?.code ?? "INVALID_CONFIG_BUNDLE", error?.message ?? "configuration bundle rebuild failed");
  }
  if (canonicalJson(configBundleArtifact) !== canonicalJson(expectedBundle)) {
    fail("CONFIG_BUNDLE_MISMATCH",
      "configuration bundle is not the exact artifact rebuilt from the authoritative manifests");
  }
  let evidence;
  try {
    evidence = validateCanaryConfigurationReceiptEvidence(configurationEvidenceArtifact);
  } catch (error) {
    fail(error?.code ?? "INVALID_CONFIGURATION_EVIDENCE",
      error?.message ?? "configuration receipt evidence is invalid");
  }
  same(evidence.evidence.configBundleHash, expectedBundle.bundleHash,
    "CONFIG_BUNDLE_MISMATCH", "configuration evidence bundle hash");
  const calls = expectedBundle.review?.configurationPlan?.orderedCalls;
  if (!Array.isArray(calls) || calls.length !== 13) {
    fail("INVALID_CONFIG_BUNDLE", "configuration bundle does not contain the exact 13-call plan");
  }
  for (let index = 0; index < calls.length; index += 1) {
    const recorded = evidence.evidence.transactions[index];
    if (recorded.id !== calls[index].id || recorded.order !== calls[index].order) {
      fail("CONFIGURATION_EVIDENCE_MISMATCH",
        `configuration transaction ${index + 1} is not bound to the exact planned call`);
    }
  }
  const clean = canaryManifest?.provenanceGate?.cleanPreconfigurationState;
  if (!clean || typeof clean !== "object") {
    fail("UNVERIFIED_CANARY", "canary manifest lacks verified clean preconfiguration state");
  }
  same(evidence.evidence.preconfigurationBlock.number, clean.blockNumber,
    "CONFIGURATION_EVIDENCE_MISMATCH", "clean preconfiguration block number");
  same(evidence.evidence.preconfigurationBlock.hash, clean.blockHash,
    "CONFIGURATION_EVIDENCE_MISMATCH", "clean preconfiguration block hash");
  same(evidence.evidence.preconfigurationBlock.timestamp, clean.blockTimestamp,
    "CONFIGURATION_EVIDENCE_MISMATCH", "clean preconfiguration block timestamp");
  const scope = expectedBundle.review.scope;
  return {
    bundle: expectedBundle,
    bundleArtifactHash: canonicalSha256(configBundleArtifact),
    evidence,
    evidenceArtifactHash: canonicalSha256(configurationEvidenceArtifact),
    calls,
    clean,
    accountRuntimeCodeHash: bytes32(scope.punkAccountRuntimeBytecodeHash,
      "expected Punk Account runtime bytecode hash"),
    adapterVersionHash: bytes32(
      expectedBundle.review.adapterRegistrationCommitment.versionHash,
      "adapter version commitment",
    ),
    adapterMetadataHash: bytes32(
      expectedBundle.review.adapterRegistrationCommitment.metadataHash,
      "adapter metadata commitment",
    ),
  };
}

function rpcUint(value, label) {
  if ((typeof value !== "bigint" || value < 0n)
    && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
    fail("INVALID_RPC_RESPONSE", `${label} is not an unsigned RPC integer`);
  }
  return BigInt(value);
}

function decodeKnownEvent(log, abi, label) {
  if (!log || typeof log !== "object" || log.removed === true) {
    fail("INVALID_RECEIPT", `${label} is missing or removed`);
  }
  try {
    return decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
  } catch {
    fail("UNEXPECTED_EVENT", `${label} is not a recognized exact protocol event`);
  }
}

function eventArg(decoded, name) {
  return decoded?.args?.[name];
}

function sameEventArg(decoded, name, expected, label) {
  same(eventArg(decoded, name), expected, "CONFIGURATION_EVENT_MISMATCH", `${label}.${name}`);
}

function assertExpectedConfigurationEvent(index, decoded, context) {
  const { artifact, adapterHash, venueHash, versionHash, metadataHash } = context;
  const account = artifact.account;
  const owner = artifact.expectedOwner;
  const expectations = [
    ["AccountPauseChanged", { account, owner, paused: true, version: 1n }],
    ["PolicyConfigured", { account, owner, version: 2n, mode: 0 }],
    ["AdapterRegistered", {
      adapter: artifact.adapter, venue: artifact.venue, kind: 1,
      adapterCodeHash: adapterHash, venueCodeHash: venueHash, versionHash, metadataHash,
    }],
    ["AdapterPermissionChanged", { account, adapter: artifact.adapter, allowed: true }],
    ["VenuePermissionChanged", { account, venue: artifact.venue, kind: 1, allowed: true }],
    ["CollectionPermissionChanged", {
      account, collection: artifact.collection, allowed: true, denied: false,
    }],
    ["CurrencyPolicyChanged", { account, currency: ZERO_ADDRESS }],
    ["VenueCurrencyMaximumChanged", {
      account, venue: artifact.venue, currency: ZERO_ADDRESS, maximum: 0n,
    }],
    ["SelectorPermissionChanged", {
      account, selector: ONE_SHOT_MINT_SELECTOR, allowed: true, denied: false,
    }],
    ["MintControlsChanged", {
      account, owner, ownerApprovedMints: true, autonomousFreeMints: false,
      autonomousPaidMints: false, policyVersion: 9n,
    }],
    ["FeatureFlagsChanged", {}],
    ["PolicyConfigured", { account, owner, version: 10n, mode: 2 }],
    ["AccountPauseChanged", { account, owner, paused: false, version: 11n }],
  ];
  const [expectedName, args] = expectations[index];
  if (decoded.eventName !== expectedName) {
    fail("CONFIGURATION_EVENT_MISMATCH",
      `configuration call ${index + 1} emitted ${decoded.eventName}, expected ${expectedName}`);
  }
  for (const [name, expected] of Object.entries(args)) {
    sameEventArg(decoded, name, expected, `configuration event ${index + 1}`);
  }
  if (index === 6) {
    const policy = eventArg(decoded, "policy");
    requireTuple(policy, [
      ["allowed", 0, true], ["maxSpendPerTransaction", 1, 0n],
      ["maxSpendPerDay", 2, 0n], ["maxSpendPerWeek", 3, 0n],
      ["maxMintPrice", 4, 0n], ["maxSecondaryPurchasePrice", 5, 0n],
    ], "configuration native currency event");
  }
  if (index === 10) {
    const flags = eventArg(decoded, "flags");
    requireTuple(flags, [
      ["scoutMode", 0, true], ["approvalPurchases", 1, true],
      ["autonomousPurchases", 2, false], ["autonomousMints", 3, false],
      ["unknownCollectionExecution", 4, false], ["selling", 5, false],
      ["autonomousSelling", 6, false],
    ], "configuration feature event");
  }
}

function logIdentity(log) {
  return {
    address: address(log.address, "log address"),
    blockHash: bytes32(log.blockHash, "log block hash"),
    blockNumber: rpcUint(log.blockNumber, "log block number").toString(),
    transactionHash: bytes32(log.transactionHash, "log transaction hash"),
    transactionIndex: rpcUint(log.transactionIndex, "log transaction index").toString(),
    logIndex: rpcUint(log.logIndex, "log index").toString(),
    data: typeof log.data === "string" ? log.data.toLowerCase() : fail("INVALID_RECEIPT", "log data invalid"),
    topics: Array.isArray(log.topics) ? log.topics.map((topic) => topic.toLowerCase())
      : fail("INVALID_RECEIPT", "log topics invalid"),
  };
}

function relevantPolicyLog(log, account) {
  const decoded = decodeKnownEvent(log, policyMutationEventAbi, "policy log");
  const accountArg = eventArg(decoded, "account");
  return {
    decoded,
    relevant: true,
    selectedAccount: typeof accountArg === "string" && accountArg.toLowerCase() === account,
  };
}

function relevantAdapterLog(log, adapter) {
  const decoded = decodeKnownEvent(log, adapterMutationEventAbi, "adapter registry log");
  if (decoded.eventName === "GlobalAdapterPauseChanged") return { decoded, relevant: true };
  return { decoded, relevant: true,
    selectedAdapter: eventArg(decoded, "adapter")?.toLowerCase() === adapter };
}

async function verifyConfigurationHistory({
  primaryClient, secondaryClient, deployed, pinned, artifact, config,
  adapterHash, venueHash,
}) {
  const policy = deployed.contracts.BrokerPolicyModule.address;
  const adapterRegistry = deployed.contracts.ArtAdapterRegistry.address;
  const agentRegistry = deployed.contracts.ArtAgentRegistry.address;
  const preBlock = BigInt(config.evidence.evidence.preconfigurationBlock.number);
  const guardianCode = await dual("guardian runtime code", primaryClient, secondaryClient,
    async (client) => (await client.getCode({
      address: deployed.guardian,
      blockNumber: pinned.blockNumber,
    })) ?? "0x");
  const guardianIsContract = guardianCode !== undefined && guardianCode !== null && guardianCode !== "0x";
  if (preBlock >= pinned.blockNumber) {
    fail("UNCONFIRMED_CONFIGURATION", "configuration interval is not before the confirmed pin");
  }
  const cleanBlock = await dual("clean preconfiguration block", primaryClient, secondaryClient,
    (client) => client.getBlock({ blockNumber: preBlock }));
  same(rpcUint(cleanBlock.number, "clean preconfiguration block number"), preBlock,
    "CONFIGURATION_EVIDENCE_MISMATCH", "clean preconfiguration block number");
  same(bytes32(cleanBlock.hash, "clean preconfiguration block hash"),
    config.evidence.evidence.preconfigurationBlock.hash,
    "CONFIGURATION_EVIDENCE_MISMATCH", "clean preconfiguration block hash");
  const cleanTimestamp = rpcUint(cleanBlock.timestamp, "clean preconfiguration block timestamp");
  if (cleanTimestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("INVALID_BLOCK", "clean preconfiguration timestamp exceeds safe ISO range");
  }
  same(new Date(Number(cleanTimestamp) * 1_000).toISOString(),
    config.evidence.evidence.preconfigurationBlock.timestamp,
    "CONFIGURATION_EVIDENCE_MISMATCH", "clean preconfiguration block timestamp");
  const expectedReceiptLogs = [];
  let previousPosition = null;
  for (let index = 0; index < config.calls.length; index += 1) {
    const planned = config.calls[index];
    const guardianCall = planned.role === "GUARDIAN";
    const transactionHash = config.evidence.evidence.transactions[index].hash;
    const transaction = await dual(`configuration transaction ${index + 1}`,
      primaryClient, secondaryClient, (client) => client.getTransaction({ hash: transactionHash }));
    const receipt = await dual(`configuration receipt ${index + 1}`,
      primaryClient, secondaryClient,
      (client) => client.getTransactionReceipt({ hash: transactionHash }));
    same(bytes32(transaction.hash, "configuration transaction hash"), transactionHash,
      "CONFIGURATION_TRANSACTION_MISMATCH", `configuration transaction ${index + 1} hash`);
    const transactionFrom = address(transaction.from, "configuration sender");
    const indirectGuardianCall = guardianCall && guardianIsContract;
    same(address(transaction.to, "configuration destination"),
      indirectGuardianCall ? deployed.guardian : planned.to,
      "CONFIGURATION_TRANSACTION_MISMATCH", `configuration transaction ${index + 1} destination`);
    if (!indirectGuardianCall) {
      same(transactionFrom, planned.from, "CONFIGURATION_TRANSACTION_MISMATCH",
        `configuration transaction ${index + 1} sender`);
      same(typeof transaction.input === "string" ? transaction.input.toLowerCase() : transaction.input,
        planned.calldata.toLowerCase(), "CONFIGURATION_TRANSACTION_MISMATCH",
        `configuration transaction ${index + 1} calldata`);
    }
    same(rpcUint(transaction.value, "configuration transaction value"), 0n,
      "CONFIGURATION_TRANSACTION_MISMATCH", `configuration transaction ${index + 1} value`);
    same(transaction.chainId, ROBINHOOD.chainId, "WRONG_CHAIN",
      `configuration transaction ${index + 1} chain`);
    if (receipt.status !== "success") {
      fail("CONFIGURATION_RECEIPT_FAILED", `configuration receipt ${index + 1} did not succeed`);
    }
    same(bytes32(receipt.transactionHash, "receipt transaction hash"), transactionHash,
      "CONFIGURATION_RECEIPT_MISMATCH", `configuration receipt ${index + 1} hash`);
    same(address(receipt.from, "receipt sender"), transactionFrom,
      "CONFIGURATION_RECEIPT_MISMATCH", `configuration receipt ${index + 1} sender`);
    same(address(receipt.to, "receipt destination"),
      indirectGuardianCall ? deployed.guardian : planned.to,
      "CONFIGURATION_RECEIPT_MISMATCH", `configuration receipt ${index + 1} destination`);
    const blockNumber = rpcUint(receipt.blockNumber, "configuration receipt block");
    const transactionIndex = rpcUint(receipt.transactionIndex, "configuration receipt index");
    const blockHash = bytes32(receipt.blockHash, "configuration receipt block hash");
    same(rpcUint(transaction.blockNumber, "configuration transaction block"), blockNumber,
      "CONFIGURATION_RECEIPT_MISMATCH", `configuration transaction ${index + 1} block`);
    same(bytes32(transaction.blockHash, "configuration transaction block hash"), blockHash,
      "CONFIGURATION_RECEIPT_MISMATCH", `configuration transaction ${index + 1} block hash`);
    same(rpcUint(transaction.transactionIndex, "configuration transaction index"), transactionIndex,
      "CONFIGURATION_RECEIPT_MISMATCH", `configuration transaction ${index + 1} index`);
    if (blockNumber <= preBlock || blockNumber > pinned.blockNumber) {
      fail("UNCONFIRMED_CONFIGURATION", `configuration receipt ${index + 1} is outside the proven interval`);
    }
    if (previousPosition && (blockNumber < previousPosition.block
      || (blockNumber === previousPosition.block && transactionIndex <= previousPosition.index))) {
      fail("CONFIGURATION_ORDER_MISMATCH", "configuration transactions are not strictly chronological");
    }
    previousPosition = { block: blockNumber, index: transactionIndex };
    const receiptBlock = await dual(`configuration block ${index + 1}`,
      primaryClient, secondaryClient, (client) => client.getBlock({ blockNumber }));
    same(rpcUint(receiptBlock.number, "configuration block number"), blockNumber,
      "CONFIGURATION_RECEIPT_MISMATCH", `configuration block ${index + 1} number`);
    same(bytes32(receiptBlock.hash, "configuration block hash"), blockHash,
      "CONFIGURATION_RECEIPT_MISMATCH", `configuration block ${index + 1} hash`);
    if (!Array.isArray(receipt.logs)) {
      fail("UNEXPECTED_EVENT", `configuration receipt ${index + 1} logs are missing`);
    }
    const targetLogs = receipt.logs.filter((log) => (
      typeof log?.address === "string" && log.address.toLowerCase() === planned.to.toLowerCase()
    ));
    if (targetLogs.length !== 1 || (!indirectGuardianCall && receipt.logs.length !== 1)) {
      fail("UNEXPECTED_EVENT",
        `configuration receipt ${index + 1} does not contain exactly one target protocol event`);
    }
    const receiptLog = targetLogs[0];
    same(bytes32(receiptLog.transactionHash, "receipt log transaction hash"), transactionHash,
      "CONFIGURATION_EVENT_MISMATCH", `configuration event ${index + 1} transaction hash`);
    same(bytes32(receiptLog.blockHash, "receipt log block hash"), blockHash,
      "CONFIGURATION_EVENT_MISMATCH", `configuration event ${index + 1} block hash`);
    same(rpcUint(receiptLog.blockNumber, "receipt log block number"), blockNumber,
      "CONFIGURATION_EVENT_MISMATCH", `configuration event ${index + 1} block number`);
    same(rpcUint(receiptLog.transactionIndex, "receipt log transaction index"), transactionIndex,
      "CONFIGURATION_EVENT_MISMATCH", `configuration event ${index + 1} transaction index`);
    same(address(receiptLog.address, "receipt log address"), planned.to,
      "CONFIGURATION_EVENT_MISMATCH", `configuration event ${index + 1} emitter`);
    const abi = index === 2 ? adapterMutationEventAbi : policyMutationEventAbi;
    const decoded = decodeKnownEvent(receiptLog, abi, `configuration receipt ${index + 1} log`);
    assertExpectedConfigurationEvent(index, decoded, {
      artifact, adapterHash, venueHash,
      versionHash: config.adapterVersionHash,
      metadataHash: config.adapterMetadataHash,
    });
    expectedReceiptLogs.push(logIdentity(receiptLog));
  }

  const scanFrom = preBlock + 1n;
  const [policyLogs, adapterLogs, agentLogs, accountLogs] = await Promise.all([
    dual("configuration policy event interval", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: policy, fromBlock: scanFrom, toBlock: pinned.blockNumber })),
    dual("configuration adapter event interval", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: adapterRegistry, fromBlock: scanFrom, toBlock: pinned.blockNumber })),
    dual("configuration agent event interval", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: agentRegistry, fromBlock: scanFrom, toBlock: pinned.blockNumber })),
    dual("configuration account activity interval", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: artifact.account, fromBlock: scanFrom, toBlock: pinned.blockNumber })),
  ]);
  if (!Array.isArray(policyLogs) || !Array.isArray(adapterLogs)
    || !Array.isArray(agentLogs) || !Array.isArray(accountLogs)) {
    fail("INVALID_RPC_RESPONSE", "configuration event interval responses must be arrays");
  }
  const relevantScanned = [];
  for (const log of policyLogs) {
    const { relevant } = relevantPolicyLog(log, artifact.account);
    if (relevant) relevantScanned.push(logIdentity(log));
  }
  for (const log of adapterLogs) {
    const { relevant } = relevantAdapterLog(log, artifact.adapter);
    if (relevant) relevantScanned.push(logIdentity(log));
  }
  for (const log of agentLogs) {
    const decoded = decodeKnownEvent(log, agentMutationEventAbi, "agent registry log");
    const eventAccount = eventArg(decoded, "account")?.toLowerCase();
    if (["GlobalAgentConfigured", "GlobalAgentPauseChanged", "OwnershipTransferred"]
      .includes(decoded.eventName) || eventAccount === artifact.account) {
      fail("UNEXPECTED_EVENT", `configuration interval contains ${decoded.eventName}`);
    }
  }
  if (accountLogs.length !== 0) {
    for (const log of accountLogs) decodeKnownEvent(log, accountActivityEventAbi, "Punk Account activity log");
    fail("UNEXPECTED_ACCOUNT_ACTIVITY",
      "Punk Account emitted cancellation or acquisition activity during configuration");
  }
  const position = (item) => [BigInt(item.blockNumber), BigInt(item.transactionIndex), BigInt(item.logIndex)];
  const sorter = (left, right) => {
    const a = position(left); const b = position(right);
    for (let index = 0; index < 3; index += 1) {
      if (a[index] < b[index]) return -1;
      if (a[index] > b[index]) return 1;
    }
    return 0;
  };
  expectedReceiptLogs.sort(sorter);
  relevantScanned.sort(sorter);
  if (canonicalJson(relevantScanned) !== canonicalJson(expectedReceiptLogs)) {
    fail("UNEXPECTED_EVENT", "configuration interval does not contain exactly the 13 receipt events");
  }

  const policyDeploymentBlock = BigInt(deployed.contracts.BrokerPolicyModule.deploymentBlock);
  const adapterDeploymentBlock = BigInt(deployed.contracts.ArtAdapterRegistry.deploymentBlock);
  const [priorPolicyLogs, priorAdapterLogs, priorAgentLogs, priorAccountLogs] = await Promise.all([
    dual("preconfiguration policy isolation history", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: policy, fromBlock: policyDeploymentBlock,
        toBlock: preBlock })),
    dual("preconfiguration adapter isolation history", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: adapterRegistry, fromBlock: adapterDeploymentBlock,
        toBlock: preBlock })),
    dual("preconfiguration selected-account agent history", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: agentRegistry,
        fromBlock: BigInt(deployed.contracts.ArtAgentRegistry.deploymentBlock), toBlock: preBlock })),
    dual("preconfiguration account activity history", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: artifact.account,
        fromBlock: BigInt(deployed.contracts.GoghPunkAccountRegistry.deploymentBlock),
        toBlock: preBlock })),
  ]);
  for (const log of priorPolicyLogs) {
    const { decoded, relevant } = relevantPolicyLog(log, artifact.account);
    if (relevant) {
      if (decoded.eventName === "OwnershipTransferred"
        && eventArg(decoded, "previousOwner")?.toLowerCase() === ZERO_ADDRESS
        && eventArg(decoded, "newOwner")?.toLowerCase() === deployed.guardian
        && log.transactionHash?.toLowerCase()
          === deployed.contracts.BrokerPolicyModule.deploymentTransaction.toLowerCase()
        && rpcUint(log.blockNumber, "policy deployment ownership block")
          === BigInt(deployed.contracts.BrokerPolicyModule.deploymentBlock)) continue;
      fail("NONCLEAN_PRECONFIGURATION",
        `preconfiguration history contains ${decoded.eventName} affecting the canary path`);
    }
  }
  for (const log of priorAdapterLogs) {
    const { decoded, relevant } = relevantAdapterLog(log, artifact.adapter);
    if (relevant) {
      if (decoded.eventName === "OwnershipTransferred"
        && eventArg(decoded, "previousOwner")?.toLowerCase() === ZERO_ADDRESS
        && eventArg(decoded, "newOwner")?.toLowerCase() === deployed.guardian
        && log.transactionHash?.toLowerCase()
          === deployed.contracts.ArtAdapterRegistry.deploymentTransaction.toLowerCase()
        && rpcUint(log.blockNumber, "adapter deployment ownership block")
          === BigInt(deployed.contracts.ArtAdapterRegistry.deploymentBlock)) continue;
      fail("NONCLEAN_PRECONFIGURATION",
        `preconfiguration history contains ${decoded.eventName} affecting the canary adapter`);
    }
  }
  for (const log of priorAgentLogs) {
    const decoded = decodeKnownEvent(log, agentMutationEventAbi, "preconfiguration agent log");
    if (eventArg(decoded, "account")?.toLowerCase() === artifact.account) {
      fail("NONCLEAN_PRECONFIGURATION",
        `preconfiguration history contains ${decoded.eventName} for the canary account`);
    }
  }
  if (priorAccountLogs.length !== 0) {
    for (const log of priorAccountLogs) decodeKnownEvent(log, accountActivityEventAbi,
      "preconfiguration Punk Account activity log");
    fail("NONCLEAN_PRECONFIGURATION", "Punk Account has prior cancellation or acquisition activity");
  }
  const ownershipTransfers = await dual("configuration Punk ownership transfer interval",
    primaryClient, secondaryClient, (client) => client.getLogs({
      address: ROBINHOOD.canonicalCollection,
      event: punkTransferEvent,
      args: { tokenId: artifact.punkTokenId },
      fromBlock: scanFrom,
      toBlock: pinned.blockNumber,
    }));
  if (!Array.isArray(ownershipTransfers) || ownershipTransfers.length !== 0) {
    fail("OWNERSHIP_CHANGED_DURING_CONFIGURATION",
      "controlling Gogh Punk transferred during the configuration interval");
  }
  return {
    transactionCount: 13,
    firstBlock: preBlock + 1n,
    lastTransactionBlock: previousPosition.block,
    receiptEvidenceHash: config.evidence.evidenceHash,
  };
}

async function establishPinnedBlock(primaryClient, secondaryClient, confirmations) {
  const [primaryHead, secondaryHead] = await Promise.all([
    primaryClient.getBlockNumber(), secondaryClient.getBlockNumber(),
  ]).catch((error) => fail("LIVE_READ_FAILED", error?.message ?? "cannot read chain heads"));
  if (typeof primaryHead !== "bigint" || primaryHead < 0n
    || typeof secondaryHead !== "bigint" || secondaryHead < 0n) {
    fail("INVALID_BLOCK", "chain heads are not unsigned block numbers");
  }
  const pinnedNumber = (primaryHead < secondaryHead ? primaryHead : secondaryHead) - BigInt(confirmations);
  if (pinnedNumber < 0n) fail("UNCONFIRMED_BLOCK", "chain head is below confirmation depth");
  const block = await dual("pinned block", primaryClient, secondaryClient,
    (client) => client.getBlock({ blockNumber: pinnedNumber }));
  if (block?.number !== pinnedNumber || typeof block.timestamp !== "bigint" || block.timestamp < 0n) {
    fail("INVALID_BLOCK", "pinned block response is incomplete");
  }
  const blockHash = bytes32(block.hash, "pinned block hash");
  if (primaryHead - pinnedNumber < BigInt(confirmations)
    || secondaryHead - pinnedNumber < BigInt(confirmations)) {
    fail("UNCONFIRMED_BLOCK", "pinned block lacks confirmations");
  }
  return { blockNumber: pinnedNumber, blockHash, blockTimestamp: block.timestamp };
}

async function recheckPinnedBlock(primaryClient, secondaryClient, pinned) {
  const closing = await dual("closing pinned block", primaryClient, secondaryClient,
    (client) => client.getBlock({ blockNumber: pinned.blockNumber }));
  if (closing?.number !== pinned.blockNumber
    || bytes32(closing.hash, "closing pinned block hash") !== pinned.blockHash
    || closing.timestamp !== pinned.blockTimestamp) {
    fail("PINNED_BLOCK_CHANGED", "pinned block changed during the read-only attestation");
  }
}

async function establishLatestCommonBlock(primaryClient, secondaryClient) {
  const [primaryHead, secondaryHead] = await Promise.all([
    primaryClient.getBlockNumber(), secondaryClient.getBlockNumber(),
  ]).catch((error) => fail("LIVE_READ_FAILED", error?.message ?? "cannot read latest heads"));
  if (typeof primaryHead !== "bigint" || primaryHead < 0n
    || typeof secondaryHead !== "bigint" || secondaryHead < 0n) {
    fail("INVALID_BLOCK", "latest heads are invalid");
  }
  const skew = primaryHead > secondaryHead ? primaryHead - secondaryHead : secondaryHead - primaryHead;
  if (skew > 3n) fail("RPC_HEAD_SKEW", "independent RPC heads differ by more than three blocks");
  const number = primaryHead < secondaryHead ? primaryHead : secondaryHead;
  const block = await dual("latest common block", primaryClient, secondaryClient,
    (client) => client.getBlock({ blockNumber: number }));
  if (rpcUint(block.number, "latest block number") !== number) {
    fail("INVALID_BLOCK", "latest common block number is inconsistent");
  }
  return {
    number,
    hash: bytes32(block.hash, "latest common block hash"),
    timestamp: rpcUint(block.timestamp, "latest common block timestamp"),
    primaryHead,
    secondaryHead,
    skew,
  };
}

async function verifyLatestExecutionState({
  primaryClient, secondaryClient, latest, artifact, deployed, config,
}) {
  const policy = deployed.contracts.BrokerPolicyModule.address;
  const currentOwner = await dualRead(primaryClient, secondaryClient, latest.number,
    { address: ROBINHOOD.canonicalCollection, abi: punkAbi, functionName: "ownerOf",
      args: [artifact.punkTokenId] }, "latest current Punk owner");
  same(address(currentOwner, "latest current Punk owner"), artifact.expectedOwner,
    "OWNER_MISMATCH", "latest current Punk owner");
  const ownerCode = await dual("latest current owner runtime code", primaryClient, secondaryClient,
    async (client) => (await client.getCode({
      address: artifact.expectedOwner,
      blockNumber: latest.number,
    })) ?? "0x");
  if (ownerCode !== undefined && ownerCode !== null && ownerCode !== "0x") {
    fail("SMART_CONTRACT_OWNER_UNSUPPORTED",
      "latest current Punk owner is not an EOA for the owner-direct path");
  }
  const nonce = await dualRead(primaryClient, secondaryClient, latest.number,
    { address: artifact.account, abi: accountAbi, functionName: "acquisitionNonce" },
    "latest account nonce");
  same(nonce, EXPECTED_ACQUISITION_NONCE, "NONCE_MISMATCH", "latest account nonce");
  const policyState = await dualRead(primaryClient, secondaryClient, latest.number,
    { address: policy, abi: policyAbi, functionName: "policy", args: [artifact.account] },
    "latest Punk policy");
  requireTuple(policyState, [
    ["configuredBy", 1, artifact.expectedOwner], ["version", 2, EXPECTED_POLICY_VERSION],
    ["permissionGeneration", 3, EXPECTED_PERMISSION_GENERATION], ["accountPaused", 4, false],
  ], "latest Punk policy");
  requireTuple(field(policyState, "config", 0), [
    ["mode", 0, 2], ["maxSpendPerTransaction", 1, 0n],
    ["maxSpendPerDay", 2, 0n], ["maxSpendPerWeek", 3, 0n],
    ["maxMintPrice", 4, 0n], ["maxSecondaryPurchasePrice", 5, 0n],
    ["minimumNativeReserve", 6, 0n], ["maxAcquisitionsPerDay", 7, 1],
    ["maxIntentAge", 8, 120], ["maxSlippageBps", 9, 0],
    ["requireCollectionAllowlist", 10, true], ["allowUnknownCollections", 11, false],
  ], "latest Punk policy config");
  const adapterRegistry = deployed.contracts.ArtAdapterRegistry.address;
  const agentRegistry = deployed.contracts.ArtAgentRegistry.address;
  for (const [label, target, abi] of [
    ["latest policy pause", policy, policyAbi],
    ["latest adapter pause", adapterRegistry, adapterRegistryAbi],
    ["latest agent pause", agentRegistry, agentRegistryAbi],
  ]) {
    const paused = await dualRead(primaryClient, secondaryClient, latest.number,
      { address: target, abi, functionName: "globallyPaused" }, label);
    same(paused, false, "PAUSED", label);
  }
  const features = await dualRead(primaryClient, secondaryClient, latest.number,
    { address: policy, abi: policyAbi, functionName: "featureFlags" }, "latest feature flags");
  requireTuple(features, [
    ["scoutMode", 0, true], ["approvalPurchases", 1, true],
    ["autonomousPurchases", 2, false], ["autonomousMints", 3, false],
    ["unknownCollectionExecution", 4, false], ["selling", 5, false],
    ["autonomousSelling", 6, false],
  ], "latest feature flags");
  const controls = await dualRead(primaryClient, secondaryClient, latest.number,
    { address: policy, abi: policyAbi, functionName: "mintControls", args: [artifact.account] },
    "latest mint controls");
  requireTuple(controls, [
    ["ownerApprovedMints", 0, true], ["autonomousFreeMints", 1, false],
    ["autonomousPaidMints", 2, false],
  ], "latest mint controls");
  for (const [functionName, args, expected] of [
    ["approvedAdapters", [artifact.account, artifact.adapter], true],
    ["approvedMintContracts", [artifact.account, artifact.venue], true],
    ["approvedCollections", [artifact.account, artifact.collection], true],
    ["deniedCollections", [artifact.account, artifact.collection], false],
    ["approvedSelectors", [artifact.account, artifact.selector], true],
    ["deniedSelectors", [artifact.account, artifact.selector], false],
  ]) {
    const allowed = await dualRead(primaryClient, secondaryClient, latest.number,
      { address: policy, abi: policyAbi, functionName, args }, `latest ${functionName}`);
    same(allowed, expected, "PERMISSION_MISMATCH", `latest ${functionName}`);
  }
  const currencyPolicy = await dualRead(primaryClient, secondaryClient, latest.number,
    { address: policy, abi: policyAbi, functionName: "currencyPolicy",
      args: [artifact.account, ZERO_ADDRESS] }, "latest native currency policy");
  requireTuple(currencyPolicy, [
    ["allowed", 0, true], ["maxSpendPerTransaction", 1, 0n],
    ["maxSpendPerDay", 2, 0n], ["maxSpendPerWeek", 3, 0n],
    ["maxMintPrice", 4, 0n], ["maxSecondaryPurchasePrice", 5, 0n],
  ], "latest native currency policy");
  const venueMaximum = await dualRead(primaryClient, secondaryClient, latest.number,
    { address: policy, abi: policyAbi, functionName: "venueCurrencyMaximum",
      args: [artifact.account, artifact.venue, ZERO_ADDRESS] }, "latest venue maximum");
  same(venueMaximum, 0n, "PERMISSION_MISMATCH", "latest venue maximum");
  const acquisitionUsage = await dualRead(primaryClient, secondaryClient, latest.number,
    { address: policy, abi: policyAbi, functionName: "acquisitionUsage", args: [artifact.account] },
    "latest acquisition usage");
  same(uint(field(acquisitionUsage, "acquisitionsToday", 1), "latest acquisitions today"), 0n,
    "ACCOUNT_ACTIVITY_MISMATCH", "latest acquisitions today");
  const adapterRecord = await dualRead(primaryClient, secondaryClient, latest.number,
    { address: adapterRegistry, abi: adapterRegistryAbi, functionName: "adapterRecord",
      args: [artifact.adapter] }, "latest adapter record");
  requireTuple(adapterRecord, [
    ["kind", 0, 1], ["active", 1, true], ["venue", 2, artifact.venue],
    ["adapterCodeHash", 3, artifact.proposal.intent.adapterCodeHash],
    ["venueCodeHash", 4,
      config.bundle.review.adapterRegistrationCommitment.venueRuntimeBytecodeHash],
    ["versionHash", 5, config.adapterVersionHash],
    ["metadataHash", 6, config.adapterMetadataHash],
  ], "latest adapter record");
  const accountState = await dualRead(primaryClient, secondaryClient, latest.number,
    { address: artifact.account, abi: accountAbi, functionName: "state" }, "latest account state");
  same(accountState, uint(config.clean.accountState, "clean preconfiguration account state"),
    "ACCOUNT_ACTIVITY_MISMATCH", "latest account state");
  const runtimeTargets = [
    [artifact.account, config.accountRuntimeCodeHash, "latest Punk Account"],
    [artifact.adapter, artifact.proposal.intent.adapterCodeHash, "latest mint adapter"],
    [artifact.venue, config.bundle.review.adapterRegistrationCommitment.venueRuntimeBytecodeHash,
      "latest mint venue"],
    [artifact.collection, config.bundle.review.adapterRegistrationCommitment.venueRuntimeBytecodeHash,
      "latest mint collection"],
  ];
  for (const [target, expectedHash, label] of runtimeTargets) {
    await assertCode(primaryClient, secondaryClient, latest.number, target, expectedHash, label);
  }
  await dual("latest owner-direct acquisition simulation", primaryClient, secondaryClient,
    (client) => client.simulateContract({
      account: artifact.expectedOwner,
      address: artifact.account,
      abi: accountAbi,
      functionName: "executeApprovedAcquisition",
      args: [artifact.solidityIntent, "0x", "0x"],
      blockNumber: latest.number,
    }));
  const closing = await dual("closing latest common block", primaryClient, secondaryClient,
    (client) => client.getBlock({ blockNumber: latest.number }));
  same(rpcUint(closing.number, "closing latest block number"), latest.number,
    "LATEST_BLOCK_CHANGED", "closing latest block number");
  same(bytes32(closing.hash, "closing latest block hash"), latest.hash,
    "LATEST_BLOCK_CHANGED", "closing latest block hash");
}

async function verifyPostPinIsolation({
  primaryClient, secondaryClient, deployed, artifact, pinned, latest,
}) {
  if (latest.number <= pinned.blockNumber) return;
  const fromBlock = pinned.blockNumber + 1n;
  const [policyLogs, adapterLogs, agentLogs, accountLogs, ownershipTransfers] = await Promise.all([
    dual("post-pin policy isolation", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: deployed.contracts.BrokerPolicyModule.address,
        fromBlock, toBlock: latest.number })),
    dual("post-pin adapter isolation", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: deployed.contracts.ArtAdapterRegistry.address,
        fromBlock, toBlock: latest.number })),
    dual("post-pin agent isolation", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: deployed.contracts.ArtAgentRegistry.address,
        fromBlock, toBlock: latest.number })),
    dual("post-pin account isolation", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: artifact.account, fromBlock, toBlock: latest.number })),
    dual("post-pin Punk ownership isolation", primaryClient, secondaryClient,
      (client) => client.getLogs({ address: ROBINHOOD.canonicalCollection,
        event: punkTransferEvent, args: { tokenId: artifact.punkTokenId },
        fromBlock, toBlock: latest.number })),
  ]);
  if (policyLogs.length !== 0) {
    for (const log of policyLogs) decodeKnownEvent(log, policyMutationEventAbi, "post-pin policy log");
    fail("POST_PIN_MUTATION", "policy or feature state changed after the confirmed pin");
  }
  for (const log of adapterLogs) {
    const decoded = decodeKnownEvent(log, adapterMutationEventAbi, "post-pin adapter log");
    const selected = eventArg(decoded, "adapter")?.toLowerCase() === artifact.adapter;
    if (selected || ["GlobalAdapterPauseChanged", "OwnershipTransferred"].includes(decoded.eventName)) {
      fail("POST_PIN_MUTATION", `adapter state changed after the confirmed pin: ${decoded.eventName}`);
    }
  }
  for (const log of agentLogs) {
    const decoded = decodeKnownEvent(log, agentMutationEventAbi, "post-pin agent log");
    const selected = eventArg(decoded, "account")?.toLowerCase() === artifact.account;
    if (selected || ["GlobalAgentConfigured", "GlobalAgentPauseChanged", "OwnershipTransferred"]
      .includes(decoded.eventName)) {
      fail("POST_PIN_MUTATION", `agent state changed after the confirmed pin: ${decoded.eventName}`);
    }
  }
  if (accountLogs.length !== 0) {
    for (const log of accountLogs) decodeKnownEvent(log, accountActivityEventAbi, "post-pin account log");
    fail("POST_PIN_MUTATION", "Punk Account activity occurred after the confirmed pin");
  }
  if (ownershipTransfers.length !== 0) {
    fail("OWNERSHIP_CHANGED_AFTER_ATTESTATION_PIN",
      "controlling Gogh Punk transferred after the confirmed pin");
  }
}

async function assertCode(primaryClient, secondaryClient, blockNumber, target, expectedHash, label) {
  const code = await dual(`${label} runtime code`, primaryClient, secondaryClient,
    (client) => client.getCode({ address: target, blockNumber }));
  if (!code || code === "0x") fail("MISSING_CODE", `${label} has no runtime code`);
  const actualHash = keccak256(code).toLowerCase();
  if (expectedHash) same(actualHash, expectedHash, "CODE_HASH_MISMATCH", `${label} runtime hash`);
  return actualHash;
}

async function rejectProxy(primaryClient, secondaryClient, blockNumber, target, label) {
  for (const [slotName, slot] of Object.entries(EIP1967_SLOTS)) {
    const value = await dual(`${label} ${slotName} slot`, primaryClient, secondaryClient,
      (client) => client.getStorageAt({ address: target, slot, blockNumber }));
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)
      || value.toLowerCase() !== ZERO_WORD) {
      fail("PROXY_UNSUPPORTED", `${label} has a nonzero EIP-1967 ${slotName} slot`);
    }
  }
}

function requireTuple(value, expected, label) {
  for (const [name, index, wanted] of expected) same(field(value, name, index), wanted,
    "LIVE_STATE_MISMATCH", `${label}.${name}`);
}

export async function attestLiveApproval({
  proposalArtifact,
  manifest,
  canaryManifest,
  configBundleArtifact,
  configurationEvidenceArtifact,
  primaryClient,
  secondaryClient,
  confirmations = 20,
  nowSeconds,
  clock = () => Math.floor(Date.now() / 1_000),
}) {
  assertClient(primaryClient, "primaryClient");
  assertClient(secondaryClient, "secondaryClient");
  if (primaryClient === secondaryClient) fail("CLIENTS_NOT_INDEPENDENT", "clients are the same object");
  const primaryIdentity = clientIdentity(primaryClient);
  const secondaryIdentity = clientIdentity(secondaryClient);
  if (primaryIdentity && secondaryIdentity && primaryIdentity === secondaryIdentity) {
    fail("CLIENTS_NOT_INDEPENDENT", "clients identify the same RPC origin");
  }
  if (!Number.isSafeInteger(confirmations) || confirmations < 12 || confirmations > 128) {
    fail("INVALID_CONFIRMATIONS", "confirmations must be between 12 and 128");
  }
  if (typeof clock !== "function") fail("INVALID_TIME", "clock is invalid");
  if (nowSeconds !== undefined
    && (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0)) {
    fail("INVALID_TIME", "nowSeconds is invalid");
  }
  const initialNowSeconds = nowSeconds ?? clockSeconds(clock, "initial real time");
  const finalClock = nowSeconds === undefined ? clock : () => nowSeconds;

  const inputs = strictJsonSnapshot({
    proposalArtifact,
    manifest,
    canaryManifest,
    configBundleArtifact,
    configurationEvidenceArtifact,
  }, "attestation artifacts");
  const deployed = validateManifest(inputs.manifest);
  let canarySourceVerificationAdoption;
  try {
    canarySourceVerificationAdoption = requireVerifiedManifestAdoption(
      inputs.canaryManifest,
      ["GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter"],
    );
  } catch (error) {
    fail(error?.code ?? "SOURCE_VERIFICATION_NOT_ADOPTED",
      error?.message ?? "canary source verification adoption is invalid");
  }
  const canarySourceVerificationAdoptionSha256 =
    sourceVerificationCanonicalSha256(canarySourceVerificationAdoption);
  const artifact = validateProposalArtifact(inputs.proposalArtifact, initialNowSeconds);
  const config = validateConfigurationInputs(
    inputs.configBundleArtifact,
    inputs.configurationEvidenceArtifact,
    inputs.manifest,
    inputs.canaryManifest,
  );
  const configScope = config.bundle.review.scope;
  same(artifact.punkTokenId, BigInt(configScope.controllingPunkTokenId),
    "CANARY_BINDING_MISMATCH", "proposal controlling Punk token ID");
  same(artifact.account, configScope.punkAccount,
    "CANARY_BINDING_MISMATCH", "proposal Punk Account");
  same(artifact.expectedOwner, configScope.expectedOwnerFromDeployedCanaryManifest,
    "OWNER_MISMATCH", "proposal expected owner");
  same(artifact.adapter, config.bundle.review.adapterRegistrationCommitment.adapter,
    "CANARY_BINDING_MISMATCH", "proposal adapter");
  same(artifact.venue, config.bundle.review.adapterRegistrationCommitment.venue,
    "CANARY_BINDING_MISMATCH", "proposal venue");
  same(artifact.collection, config.bundle.review.adapterRegistrationCommitment.collection,
    "CANARY_BINDING_MISMATCH", "proposal collection");
  same(artifact.proposal.intent.tokenId, configScope.canaryArtTokenId,
    "CANARY_BINDING_MISMATCH", "proposal art token ID");
  if (artifact.expiresAt - BigInt(initialNowSeconds) < BigInt(MINIMUM_SUBMISSION_MARGIN_SECONDS)) {
    fail("STALE_PROPOSAL", "intent lacks the minimum owner submission margin");
  }
  const proposalArtifactEvidenceHash = canonicalSha256(inputs.proposalArtifact);
  const manifestEvidenceHash = canonicalSha256(inputs.manifest);
  const canaryManifestEvidenceHash = canonicalSha256(inputs.canaryManifest);
  const chainId = await dual("chain ID", primaryClient, secondaryClient, (client) => client.getChainId());
  same(chainId, ROBINHOOD.chainId, "WRONG_CHAIN", "live chain ID");
  const pinned = await establishPinnedBlock(primaryClient, secondaryClient, confirmations);
  if (pinned.blockTimestamp > BigInt(initialNowSeconds) + 30n) {
    fail("INVALID_BLOCK", "pinned block timestamp is in the future");
  }
  if (artifact.createdAt > pinned.blockTimestamp || artifact.expiresAt < pinned.blockTimestamp) {
    fail("STALE_PROPOSAL", "intent is not valid at the confirmed pinned block");
  }

  for (const name of REQUIRED_CONTRACTS) {
    await assertCode(primaryClient, secondaryClient, pinned.blockNumber,
      deployed.contracts[name].address, deployed.contracts[name].runtimeBytecodeHash, name);
  }
  await assertCode(primaryClient, secondaryClient, pinned.blockNumber,
    ROBINHOOD.canonicalERC6551Registry, deployed.canonicalRegistryRuntimeCodeHash,
    "canonical ERC-6551 registry");
  const accountHash = await assertCode(primaryClient, secondaryClient, pinned.blockNumber,
    artifact.account, config.accountRuntimeCodeHash, "Punk Account");
  const ownerCode = await dual("current owner runtime code", primaryClient, secondaryClient,
    async (client) => (await client.getCode({
      address: artifact.expectedOwner,
      blockNumber: pinned.blockNumber,
    })) ?? "0x");
  if (ownerCode !== undefined && ownerCode !== null && ownerCode !== "0x") {
    fail("SMART_CONTRACT_OWNER_UNSUPPORTED",
      "owner-direct empty-signature execution requires the current Punk owner to be an EOA");
  }
  const adapterHash = await assertCode(primaryClient, secondaryClient, pinned.blockNumber,
    artifact.adapter, artifact.proposal.intent.adapterCodeHash, "mint adapter");
  const venueHash = await assertCode(primaryClient, secondaryClient, pinned.blockNumber,
    artifact.venue, null, "mint venue");
  const collectionHash = await assertCode(primaryClient, secondaryClient, pinned.blockNumber,
    artifact.collection, null, "mint collection");
  for (const [target, label] of [
    [artifact.adapter, "mint adapter"], [artifact.venue, "mint venue"],
    [artifact.collection, "mint collection"],
  ]) await rejectProxy(primaryClient, secondaryClient, pinned.blockNumber, target, label);

  const configurationHistory = await verifyConfigurationHistory({
    primaryClient,
    secondaryClient,
    deployed,
    pinned,
    artifact,
    config,
    adapterHash,
    venueHash,
  });

  for (const name of OWNABLE_CONTRACTS) {
    const target = deployed.contracts[name].address;
    const abi = name === "ArtAdapterRegistry" ? adapterRegistryAbi
      : name === "ArtAgentRegistry" ? agentRegistryAbi : policyAbi;
    const guardian = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
      { address: target, abi, functionName: "owner" }, `${name} guardian`);
    const pendingOwner = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
      { address: target, abi, functionName: "pendingOwner" }, `${name} pending owner`);
    same(address(guardian, `${name} guardian`), deployed.guardian,
      "GUARDIAN_MISMATCH", `${name} guardian`);
    same(address(pendingOwner, `${name} pending owner`, { allowZero: true }), ZERO_ADDRESS,
      "PENDING_OWNERSHIP", `${name} pending owner`);
  }

  const accountRegistry = deployed.contracts.GoghPunkAccountRegistry.address;
  const implementation = deployed.contracts.GoghPunkAccountV1.address;
  const policy = deployed.contracts.BrokerPolicyModule.address;
  const agentRegistry = deployed.contracts.ArtAgentRegistry.address;
  const adapterRegistry = deployed.contracts.ArtAdapterRegistry.address;
  const registryImplementation = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: accountRegistry, abi: accountRegistryAbi, functionName: "implementation" },
    "registry implementation");
  const registrySalt = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: accountRegistry, abi: accountRegistryAbi, functionName: "accountSalt" }, "registry salt");
  const resolvedAccount = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: accountRegistry, abi: accountRegistryAbi, functionName: "account", args: [artifact.punkTokenId] },
    "canonical account derivation");
  const registryChain = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: accountRegistry, abi: accountRegistryAbi, functionName: "ROBINHOOD_CHAIN_ID" },
    "registry immutable chain");
  const registryCollection = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: accountRegistry, abi: accountRegistryAbi, functionName: "GOGH_PUNKS" },
    "registry immutable collection");
  const registryCanonicalAddress = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: accountRegistry, abi: accountRegistryAbi, functionName: "CANONICAL_ERC6551_REGISTRY" },
    "registry immutable canonical ERC-6551 address");
  const registryCanonicalInterface = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: accountRegistry, abi: accountRegistryAbi, functionName: "canonicalRegistry" },
    "registry canonical ERC-6551 interface");
  const independentlyResolvedAccount = await dualRead(
    primaryClient,
    secondaryClient,
    pinned.blockNumber,
    {
      address: ROBINHOOD.canonicalERC6551Registry,
      abi: canonicalRegistryAbi,
      functionName: "account",
      args: [implementation, deployed.accountSalt, BigInt(ROBINHOOD.chainId),
        ROBINHOOD.canonicalCollection, artifact.punkTokenId],
    },
    "independent canonical ERC-6551 derivation",
  );
  same(address(registryImplementation, "registry implementation"), implementation,
    "WIRING_MISMATCH", "registry implementation");
  same(registrySalt, deployed.accountSalt, "WIRING_MISMATCH", "registry salt");
  same(address(resolvedAccount, "resolved account"), artifact.account,
    "ACCOUNT_DERIVATION_MISMATCH", "resolved account");
  same(registryChain, BigInt(ROBINHOOD.chainId), "WIRING_MISMATCH", "registry immutable chain");
  same(address(registryCollection, "registry immutable collection"), ROBINHOOD.canonicalCollection,
    "WIRING_MISMATCH", "registry immutable collection");
  for (const [label, value] of [
    ["registry immutable canonical ERC-6551 address", registryCanonicalAddress],
    ["registry canonical ERC-6551 interface", registryCanonicalInterface],
  ]) same(address(value, label), ROBINHOOD.canonicalERC6551Registry, "WIRING_MISMATCH", label);
  same(address(independentlyResolvedAccount, "independently resolved account"), artifact.account,
    "ACCOUNT_DERIVATION_MISMATCH", "independent canonical ERC-6551 derivation");

  const currentOwner = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: ROBINHOOD.canonicalCollection, abi: punkAbi, functionName: "ownerOf", args: [artifact.punkTokenId] },
    "canonical NFT owner");
  same(address(currentOwner, "current Punk owner"), artifact.expectedOwner,
    "OWNER_MISMATCH", "current Punk owner");
  const footer = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: artifact.account, abi: accountAbi, functionName: "token" }, "account token footer");
  requireTuple(footer, [
    ["chainId", 0, BigInt(ROBINHOOD.chainId)],
    ["tokenContract", 1, ROBINHOOD.canonicalCollection],
    ["tokenId", 2, artifact.punkTokenId],
  ], "account token footer");
  const accountOwner = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: artifact.account, abi: accountAbi, functionName: "owner" }, "account owner");
  const canonical = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: artifact.account, abi: accountAbi, functionName: "isCanonicalGoghPunkAccount" },
    "canonical account qualification");
  same(address(accountOwner, "account owner"), artifact.expectedOwner, "OWNER_MISMATCH", "account owner");
  same(canonical, true, "ACCOUNT_DERIVATION_MISMATCH", "canonical account qualification");

  for (const [functionName, expected] of [
    ["policyModule", policy], ["agentRegistry", agentRegistry], ["adapterRegistry", adapterRegistry],
  ]) {
    const accountWiring = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
      { address: artifact.account, abi: accountAbi, functionName }, `account ${functionName}`);
    const implementationWiring = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
      { address: implementation, abi: accountAbi, functionName }, `implementation ${functionName}`);
    same(address(accountWiring, `account ${functionName}`), expected, "WIRING_MISMATCH", functionName);
    same(address(implementationWiring, `implementation ${functionName}`), expected,
      "WIRING_MISMATCH", `implementation ${functionName}`);
  }
  const policyAdapterRegistry = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: policy, abi: policyAbi, functionName: "adapterRegistry" }, "policy adapter registry");
  same(address(policyAdapterRegistry, "policy adapter registry"), adapterRegistry,
    "WIRING_MISMATCH", "policy adapter registry");

  const policyPaused = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: policy, abi: policyAbi, functionName: "globallyPaused" }, "policy pause");
  const adaptersPaused = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: adapterRegistry, abi: adapterRegistryAbi, functionName: "globallyPaused" }, "adapter pause");
  const agentsPaused = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: agentRegistry, abi: agentRegistryAbi, functionName: "globallyPaused" }, "agent pause");
  for (const [label, value] of [["policy", policyPaused], ["adapters", adaptersPaused], ["agents", agentsPaused]]) {
    same(value, false, "PAUSED", `${label} global pause`);
  }
  const features = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: policy, abi: policyAbi, functionName: "featureFlags" }, "feature flags");
  requireTuple(features, [
    ["scoutMode", 0, true], ["approvalPurchases", 1, true],
    ["autonomousPurchases", 2, false], ["autonomousMints", 3, false],
    ["unknownCollectionExecution", 4, false], ["selling", 5, false],
    ["autonomousSelling", 6, false],
  ], "feature flags");
  const policyState = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: policy, abi: policyAbi, functionName: "policy", args: [artifact.account] }, "Punk policy");
  const policyConfig = field(policyState, "config", 0);
  requireTuple(policyState, [
    ["configuredBy", 1, artifact.expectedOwner], ["version", 2, EXPECTED_POLICY_VERSION],
    ["permissionGeneration", 3, EXPECTED_PERMISSION_GENERATION],
    ["accountPaused", 4, false],
  ], "Punk policy");
  requireTuple(policyConfig, [
    ["mode", 0, 2],
    ["maxSpendPerTransaction", 1, 0n], ["maxSpendPerDay", 2, 0n],
    ["maxSpendPerWeek", 3, 0n], ["maxMintPrice", 4, 0n],
    ["maxSecondaryPurchasePrice", 5, 0n], ["minimumNativeReserve", 6, 0n],
    ["maxAcquisitionsPerDay", 7, 1], ["maxIntentAge", 8, 120],
    ["maxSlippageBps", 9, 0],
    ["requireCollectionAllowlist", 10, true], ["allowUnknownCollections", 11, false],
  ], "Punk policy config");
  const policyMaxIntentAge = uint(field(policyConfig, "maxIntentAge", 8), "policy max intent age");
  const maxAcquisitionsPerDay = uint(
    field(policyConfig, "maxAcquisitionsPerDay", 7),
    "policy maximum acquisitions per day",
  );
  same(maxAcquisitionsPerDay, 1n, "POLICY_MISMATCH", "policy maximum acquisitions per day");
  if (policyMaxIntentAge !== 120n || artifact.expiresAt - artifact.createdAt > policyMaxIntentAge) {
    fail("POLICY_MISMATCH", "policy intent lifetime is not bounded to this proposal");
  }
  const effectiveMode = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: policy, abi: policyAbi, functionName: "effectiveMode", args: [artifact.account] },
    "effective mode");
  same(effectiveMode, 2, "POLICY_MISMATCH", "effective mode");
  const nonce = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: artifact.account, abi: accountAbi, functionName: "acquisitionNonce" }, "account nonce");
  same(nonce, EXPECTED_ACQUISITION_NONCE, "NONCE_MISMATCH", "account nonce");
  const accountState = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: artifact.account, abi: accountAbi, functionName: "state" }, "account state");
  same(accountState, uint(config.clean.accountState, "clean preconfiguration account state"),
    "ACCOUNT_ACTIVITY_MISMATCH", "account state");
  const controls = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: policy, abi: policyAbi, functionName: "mintControls", args: [artifact.account] },
    "mint controls");
  requireTuple(controls, [
    ["ownerApprovedMints", 0, true], ["autonomousFreeMints", 1, false],
    ["autonomousPaidMints", 2, false],
  ], "mint controls");

  const permissionReads = [
    ["approvedAdapters", [artifact.account, artifact.adapter], true],
    ["approvedMintContracts", [artifact.account, artifact.venue], true],
    ["approvedCollections", [artifact.account, artifact.collection], true],
    ["deniedCollections", [artifact.account, artifact.collection], false],
    ["approvedSelectors", [artifact.account, artifact.selector], true],
    ["deniedSelectors", [artifact.account, artifact.selector], false],
  ];
  for (const [functionName, args, expected] of permissionReads) {
    const value = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
      { address: policy, abi: policyAbi, functionName, args }, functionName);
    same(value, expected, "PERMISSION_MISMATCH", functionName);
  }
  const currencyPolicy = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: policy, abi: policyAbi, functionName: "currencyPolicy", args: [artifact.account, ZERO_ADDRESS] },
    "native currency policy");
  requireTuple(currencyPolicy, [
    ["allowed", 0, true], ["maxSpendPerTransaction", 1, 0n], ["maxSpendPerDay", 2, 0n],
    ["maxSpendPerWeek", 3, 0n], ["maxMintPrice", 4, 0n],
    ["maxSecondaryPurchasePrice", 5, 0n],
  ], "native currency policy");
  const venueMaximum = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    {
      address: policy, abi: policyAbi, functionName: "venueCurrencyMaximum",
      args: [artifact.account, artifact.venue, ZERO_ADDRESS],
    }, "venue native maximum");
  same(venueMaximum, 0n, "PERMISSION_MISMATCH", "venue native maximum");
  const acquisitionUsage = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: policy, abi: policyAbi, functionName: "acquisitionUsage", args: [artifact.account] },
    "daily acquisition usage");
  const acquisitionsToday = uint(
    field(acquisitionUsage, "acquisitionsToday", 1),
    "acquisitions today",
  );
  same(acquisitionsToday, 0n, "ACCOUNT_ACTIVITY_MISMATCH", "acquisitions today");

  const adapterRecord = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
    { address: adapterRegistry, abi: adapterRegistryAbi, functionName: "adapterRecord", args: [artifact.adapter] },
    "mint adapter record");
  requireTuple(adapterRecord, [
    ["kind", 0, 1], ["active", 1, true], ["venue", 2, artifact.venue],
    ["adapterCodeHash", 3, adapterHash], ["venueCodeHash", 4, venueHash],
    ["versionHash", 5, config.adapterVersionHash],
    ["metadataHash", 6, config.adapterMetadataHash],
  ], "mint adapter record");
  for (const [functionName, expected] of [
    ["kind", 1], ["venue", artifact.venue], ["collection", artifact.collection],
    ["mintSelector", artifact.selector], ["assetStandard", artifact.assetStandard],
  ]) {
    const actual = await dualRead(primaryClient, secondaryClient, pinned.blockNumber,
      { address: artifact.adapter, abi: mintAdapterAbi, functionName }, `adapter ${functionName}`);
    same(actual, expected, "ADAPTER_MISMATCH", `adapter ${functionName}`);
  }

  const liveDigest = await dualRead(primaryClient, secondaryClient, pinned.blockNumber, {
    address: artifact.account,
    abi: accountAbi,
    functionName: "acquisitionIntentDigest",
    args: [artifact.solidityIntent, EMPTY_ADAPTER_DATA_HASH],
  }, "on-chain acquisition intent digest");
  same(bytes32(liveDigest, "live intent digest"), artifact.digest,
    "DIGEST_MISMATCH", "on-chain acquisition intent digest");

  await dual("approved acquisition simulation", primaryClient, secondaryClient,
    (client) => client.simulateContract({
      account: artifact.expectedOwner,
      address: artifact.account,
      abi: accountAbi,
      functionName: "executeApprovedAcquisition",
      args: [artifact.solidityIntent, "0x", "0x"],
      blockNumber: pinned.blockNumber,
    }));

  await recheckPinnedBlock(primaryClient, secondaryClient, pinned);
  const latest = await establishLatestCommonBlock(primaryClient, secondaryClient);
  if (latest.number < pinned.blockNumber || latest.timestamp < pinned.blockTimestamp
    || latest.timestamp > BigInt(initialNowSeconds) + 30n
    || artifact.createdAt > latest.timestamp || artifact.expiresAt < latest.timestamp) {
    fail("STALE_PROPOSAL", "proposal is not valid at the latest common execution-check block");
  }
  await verifyPostPinIsolation({
    primaryClient,
    secondaryClient,
    deployed,
    artifact,
    pinned,
    latest,
  });
  await verifyLatestExecutionState({
    primaryClient,
    secondaryClient,
    latest,
    artifact,
    deployed,
    config,
  });
  const finalNowSeconds = clockSeconds(finalClock, "final real time");
  if (finalNowSeconds < initialNowSeconds) fail("INVALID_TIME", "real clock moved backwards");
  const remainingSeconds = artifact.expiresAt - BigInt(finalNowSeconds);
  if (remainingSeconds < BigInt(MINIMUM_SUBMISSION_MARGIN_SECONDS)) {
    fail("STALE_PROPOSAL", "intent lacks the minimum owner submission margin after simulation");
  }

  return Object.freeze({
    status: "READ_ONLY_PASS",
    readOnly: true,
    transactionAuthorized: false,
    signingPerformed: false,
    submissionPerformed: false,
    chainWritePerformed: false,
    executionBoundary: Object.freeze({
      path: "OWNER_DIRECT_EMPTY_SIGNATURE",
      ownerType: "EOA_CURRENT_OWNER_ONLY",
      simulatedCaller: artifact.expectedOwner,
      adapterData: "0x",
      ownerSignature: "0x",
      agentRelayerUsed: false,
    }),
    evidenceHashes: Object.freeze({
      algorithms: Object.freeze({
        artifactEvidence: "SHA256_CANONICAL_JSON_V1",
        configBundleReview: "KECCAK256_CANONICAL_JSON_V1",
      }),
      proposal: artifact.proposalHash,
      proposalArtifact: proposalArtifactEvidenceHash,
      coreManifest: manifestEvidenceHash,
      canaryManifest: canaryManifestEvidenceHash,
      coreSourceVerificationAdoption: deployed.sourceVerificationAdoptionSha256,
      canarySourceVerificationAdoption: canarySourceVerificationAdoptionSha256,
      configBundleArtifact: config.bundleArtifactHash,
      configBundleReview: config.bundle.bundleHash,
      configurationReceiptEvidenceArtifact: config.evidenceArtifactHash,
      configurationReceiptEvidence: config.evidence.evidenceHash,
    }),
    chainId: ROBINHOOD.chainId,
    pinnedBlock: Object.freeze({
      number: pinned.blockNumber.toString(),
      hash: pinned.blockHash,
      timestamp: pinned.blockTimestamp.toString(),
      confirmations,
    }),
    punk: Object.freeze({
      tokenId: artifact.punkTokenId.toString(),
      account: artifact.account,
      currentOwner: artifact.expectedOwner,
      accountRuntimeCodeHash: accountHash,
    }),
    target: Object.freeze({
      adapter: artifact.adapter,
      venue: artifact.venue,
      collection: artifact.collection,
      selector: artifact.selector,
      adapterCodeHash: adapterHash,
      venueCodeHash: venueHash,
      collectionCodeHash: collectionHash,
    }),
    infrastructure: Object.freeze({
      canonicalERC6551Registry: ROBINHOOD.canonicalERC6551Registry,
      canonicalERC6551RegistryRuntimeCodeHash: deployed.canonicalRegistryRuntimeCodeHash,
    }),
    sourceVerification: Object.freeze({
      status: "VERIFIED_ADOPTIONS_BOUND",
      coreAdoption: deployed.sourceVerificationAdoption,
      coreAdoptionSha256: deployed.sourceVerificationAdoptionSha256,
      canaryAdoption: canarySourceVerificationAdoption,
      canaryAdoptionSha256: canarySourceVerificationAdoptionSha256,
    }),
    configurationHistory: Object.freeze({
      status: "EXACT_13_CALL_DUAL_RPC_VERIFIED",
      transactionCount: configurationHistory.transactionCount,
      preconfigurationBlock: config.evidence.evidence.preconfigurationBlock.number.toString(),
      lastTransactionBlock: configurationHistory.lastTransactionBlock.toString(),
      expectedFinalPolicyVersion: EXPECTED_POLICY_VERSION.toString(),
      expectedFinalPermissionGeneration: EXPECTED_PERMISSION_GENERATION.toString(),
      expectedAcquisitionNonce: EXPECTED_ACQUISITION_NONCE.toString(),
      noPriorCanaryActivity: true,
      noExtraRelevantMutationEvents: true,
      noOwnershipTransfersFromPreconfigurationThroughLatest: true,
      noRelevantMutationsAfterPinnedBlock: true,
    }),
    latestExecutionCheck: Object.freeze({
      status: "LATEST_COMMON_BLOCK_READ_AND_SIMULATION_PASS",
      number: latest.number.toString(),
      hash: latest.hash,
      timestamp: latest.timestamp.toString(),
      primaryHead: latest.primaryHead.toString(),
      secondaryHead: latest.secondaryHead.toString(),
      headSkew: latest.skew.toString(),
      currentOwner: artifact.expectedOwner,
      ownerType: "EOA",
      nonce: EXPECTED_ACQUISITION_NONCE.toString(),
      policyVersion: EXPECTED_POLICY_VERSION.toString(),
      permissionGeneration: EXPECTED_PERMISSION_GENERATION.toString(),
      simulation: "READ_ONLY_ETH_CALL_PASS",
      exactState: Object.freeze({
        accountRuntimeCodeHash: accountHash,
        mode: "APPROVAL_REQUIRED",
        minimumNativeReserve: "0",
        maxAcquisitionsPerDay: "1",
        maxIntentAgeSeconds: "120",
        acquisitionsToday: "0",
        accountPaused: false,
        policyPaused: false,
        adaptersPaused: false,
        agentsPaused: false,
        ownerApprovedMints: true,
        autonomousFreeMints: false,
        autonomousPaidMints: false,
        approvalPurchases: true,
        autonomousPurchases: false,
        autonomousMints: false,
        unknownCollectionExecution: false,
        selling: false,
        autonomousSelling: false,
        adapterActive: true,
      }),
    }),
    timing: Object.freeze({
      checkedAt: finalNowSeconds.toString(),
      expiresAt: artifact.expiresAt.toString(),
      remainingSeconds: remainingSeconds.toString(),
      minimumSubmissionMarginSeconds: MINIMUM_SUBMISSION_MARGIN_SECONDS,
    }),
    intentDigest: artifact.digest,
    simulation: "READ_ONLY_ETH_CALL_PASS",
  });
}

export const LIVE_APPROVAL_PREFLIGHT_ABIS = Object.freeze({
  ownerAbi, punkAbi, accountRegistryAbi, canonicalRegistryAbi, accountAbi, policyAbi, adapterRegistryAbi,
  agentRegistryAbi, mintAdapterAbi, policyMutationEventAbi, adapterMutationEventAbi,
  agentMutationEventAbi, accountActivityEventAbi, punkTransferEvent,
});
