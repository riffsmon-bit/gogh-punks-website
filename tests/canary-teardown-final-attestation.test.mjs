import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
} from "viem";
import {
  attestCanaryFinalTeardown,
  CanaryTeardownFinalAttestationError,
  validateCanaryFinalTeardownAttestationHash,
  validateCanaryFinalTeardownTiming,
} from "../scripts/canary-teardown-final-attestation.mjs";
import { LIVE_APPROVAL_PREFLIGHT_ABIS } from
  "../scripts/canary-approval-live-preflight.mjs";

const hash = (nibble) => `0x${nibble.repeat(64)}`;
const addr = (nibble) => `0x${nibble.repeat(40)}`;
const IDS = [
  "TEARDOWN_GUARDIAN_01_DISABLE_APPROVAL_PURCHASES",
  "TEARDOWN_OWNER_01_PAUSE_ACCOUNT",
  "TEARDOWN_OWNER_02_CONFIGURE_DISABLED",
  "TEARDOWN_GUARDIAN_02_DISABLE_ADAPTER",
  "TEARDOWN_OWNER_03_DISABLE_ALL_MINT_CONTROLS",
  "TEARDOWN_OWNER_04_DENY_SELECTOR",
  "TEARDOWN_OWNER_05_REVOKE_ADAPTER",
  "TEARDOWN_OWNER_06_REVOKE_MINT_VENUE",
  "TEARDOWN_OWNER_07_DENY_COLLECTION",
  "TEARDOWN_OWNER_08_DISABLE_CURRENCY",
  "TEARDOWN_OWNER_09_KEEP_ZERO_VENUE_MAXIMUM",
];
const FUNCTIONS = [
  "setFeatureFlags", "setAccountPaused", "configurePolicy", "setAdapterActive",
  "setMintControls", "setSelectorPermission", "setAdapterPermission", "setVenuePermission",
  "setCollectionPermission", "setCurrencyPolicy", "setVenueCurrencyMaximum",
];
const ERC6551_RUNTIME_CODE =
  "0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063246a00211461003b5780638a54c52f1461006a575b600080fd5b61004e6100493660046101b7565b61007d565b6040516001600160a01b03909116815260200160405180910390f35b61004e6100783660046101b7565b6100e1565b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b60015284601552605560002060601b60601c60005260206000f35b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b600152846015526055600020803b61018b578560b760556000f580610157576320188a596000526004601cfd5b80606c52508284887f79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf887226060606ca46020606cf35b8060601b60601c60005260206000f35b80356001600160a01b03811681146101b257600080fd5b919050565b600080600080600060a086880312156101cf57600080fd5b6101d88661019b565b945060208601359350604086013592506101f46060870161019b565b94979396509194608001359291505056fea2646970667358221220ea2fe53af507453c64dd7c1db05549fa47a298dfb825d6d11e1689856135f16764736f6c63430008110033";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function context(now = 2_000_000_000) {
  const guardian = addr("a");
  const owner = addr("b");
  const policy = addr("3");
  const adapterRegistry = addr("1");
  const agentRegistry = addr("2");
  const account = addr("6");
  const adapter = addr("7");
  const venue = addr("8");
  const evidenceHashNames = [
    "coreManifest", "canaryManifest", "coreSourceVerificationAdoption",
    "canarySourceVerificationAdoption", "configBundleReviewKeccak256", "configBundleArtifact",
    "configurationReceiptEvidence", "configurationReceiptEvidenceArtifact",
    "executionReceiptEvidence", "executionReceiptEvidenceArtifact",
    "mintReceiptAttestationArtifact", "teardownReceiptEvidence",
    "teardownReceiptEvidenceArtifact",
  ];
  const contracts = {
    guardian,
    adapterRegistry: { address: adapterRegistry, runtimeCodeHash: hash("1"), deploymentBlock: "100" },
    agentRegistry: { address: agentRegistry, runtimeCodeHash: hash("2"), deploymentBlock: "101" },
    policyModule: { address: policy, runtimeCodeHash: hash("3"), deploymentBlock: "102" },
    accountImplementation: { address: addr("4"), runtimeCodeHash: hash("4"), deploymentBlock: "103" },
    accountRegistry: { address: addr("5"), runtimeCodeHash: hash("5"), deploymentBlock: "104" },
    account: { address: account, runtimeCodeHash: hash("6"), deploymentBlock: "105" },
    adapter: { address: adapter, runtimeCodeHash: hash("7"), deploymentBlock: "106" },
    venue: { address: venue, runtimeCodeHash: hash("8"), deploymentBlock: "107" },
  };
  const mintHash = hash("f");
  const teardownPlan = IDS.map((id, index) => ({
    id,
    order: index + 1,
    role: index === 0 || index === 3 ? "GUARDIAN" : "CURRENT_PUNK_OWNER",
    from: index === 0 || index === 3 ? guardian : owner,
    to: index === 3 ? adapterRegistry : policy,
    valueWei: "0",
    functionName: FUNCTIONS[index],
    calldata: `0x${(index + 1).toString(16).padStart(2, "0")}`,
  }));
  return {
    evidenceHashes: Object.fromEntries(evidenceHashNames.map((name, index) => [
      name,
      hash("123456789abcd"[index]),
    ])),
    scope: {
      punkTokenId: "4242",
      account,
      owner,
      adapter,
      venue,
      collection: venue,
      selector: "0x40c10f19",
      artTokenId: "9001",
      adapterVersionHash: hash("d"),
      adapterMetadataHash: hash("e"),
    },
    infrastructure: {
      canonicalCollection: "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
      canonicalERC6551Registry: "0x000000006551c19487814612e58fe06813775758",
      canonicalERC6551RegistryRuntimeCodeHash:
        "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735",
      accountSalt: hash("0"),
    },
    contracts,
    mintTransaction: {
      hash: mintHash,
      from: owner,
      to: account,
      value: "0",
      data: "0x1234",
      dataKeccak256: keccak256("0x1234"),
    },
    mintReceipt: {
      transactionHash: mintHash,
      blockNumber: "500",
      blockHash: hash("a"),
      transactionIndex: "2",
      blockTimestamp: String(now),
    },
    teardownPlan,
    teardownEvidence: teardownPlan.map(({ id, order }, index) => ({
      id,
      order,
      hash: hash("123456789ab"[index]),
    })),
  };
}

function client(origin) {
  const unavailable = async () => { throw new Error("unexpected RPC read"); };
  return {
    transport: { url: `${origin}/rpc` },
    getChainId: unavailable,
    getBlockNumber: unavailable,
    getBlock: unavailable,
    getTransaction: unavailable,
    getTransactionReceipt: unavailable,
    getCode: unavailable,
    getStorageAt: unavailable,
    getBalance: unavailable,
    getLogs: unavailable,
    readContract: unavailable,
  };
}

function argumentsFor(teardownContext, now) {
  return {
    teardownContext,
    primaryClient: client("https://rpc.first-provider.example"),
    secondaryClient: client("https://rpc.second-provider.test"),
    endpointOrigins: ["https://rpc.first-provider.example", "https://rpc.second-provider.test"],
    confirmations: 20,
    clock: () => now,
  };
}

function eventLog(abi, eventName, args, meta) {
  const event = abi.find((item) => item.type === "event" && item.name === eventName);
  assert.ok(event, `missing event ABI ${eventName}`);
  const topics = encodeEventTopics({ abi: [event], eventName, args });
  const parameters = event.inputs.filter((item) => !item.indexed).map((item) => ({
    name: item.name,
    type: item.type,
    ...(item.components ? { components: item.components } : {}),
  }));
  const data = parameters.length === 0 ? "0x" : encodeAbiParameters(
    parameters,
    parameters.map((item) => args[item.name]),
  );
  return {
    address: meta.address,
    blockHash: meta.blockHash,
    blockNumber: meta.blockNumber,
    transactionHash: meta.transactionHash,
    transactionIndex: meta.transactionIndex,
    logIndex: meta.logIndex,
    removed: false,
    data,
    topics,
    blockTimestamp: undefined,
  };
}

function realisticFixture({ guardianSafe = false, utcRollover = false } = {}) {
  const mintTimestamp = utcRollover ? 2_000_073_590n : 2_000_000_000n;
  const finalTimestamp = utcRollover ? mintTimestamp + 30n : mintTimestamp + 40n;
  const teardownContext = context(Number(mintTimestamp));
  const codes = {};
  for (const [index, name] of ["adapterRegistry", "agentRegistry", "policyModule",
    "accountImplementation", "accountRegistry", "account", "adapter", "venue"].entries()) {
    const code = `0x60${(index + 1).toString(16).padStart(2, "0")}`;
    codes[teardownContext.contracts[name].address] = code;
    teardownContext.contracts[name].runtimeCodeHash = keccak256(code);
  }
  codes[teardownContext.infrastructure.canonicalERC6551Registry] = ERC6551_RUNTIME_CODE;
  if (guardianSafe) codes[teardownContext.contracts.guardian] = "0x6055";
  const state = {
    context: teardownContext,
    codes,
    codeOverrides: new Map(),
    guardianSafe,
    relayer: addr("c"),
    transactions: new Map(),
    receipts: new Map(),
    blocks: new Map(),
    policyLogs: [],
    adapterLogs: [],
    agentLogs: [],
    accountLogs: [],
    transfers: [],
    headReads: { primary: 0, secondary: 0 },
    blockReadCounts: { primary: new Map(), secondary: new Map() },
    closingBlockChanges: new Map(),
    owner: teardownContext.scope.owner,
    accountNonce: 1n,
    accountState: 2n,
    footerTokenId: teardownContext.scope.punkTokenId,
    accountCanonical: true,
    nftOwner: teardownContext.scope.account,
    proxySlots: {},
    policyVersion: 20n,
    permissionGeneration: 1n,
    policyPaused: true,
    policyGlobalPaused: false,
    adapterGlobalPaused: false,
    agentGlobalPaused: false,
    approvalPurchases: false,
    adapterActive: false,
    latestTimestamp: finalTimestamp,
  };
  const mint = teardownContext.mintReceipt;
  const mintBlockNumber = BigInt(mint.blockNumber);
  const mintIndex = BigInt(mint.transactionIndex);
  state.blocks.set(mintBlockNumber.toString(), {
    number: mintBlockNumber,
    hash: mint.blockHash,
    timestamp: mintTimestamp,
    transactions: [hash("0"), hash("e"), mint.transactionHash],
    blobGasUsed: undefined,
  });
  state.transactions.set(mint.transactionHash, {
    hash: mint.transactionHash,
    from: teardownContext.scope.owner,
    to: teardownContext.scope.account,
    input: "0x1234",
    value: 0n,
    chainId: 4663,
    blockNumber: mintBlockNumber,
    blockHash: mint.blockHash,
    transactionIndex: mintIndex,
    maxFeePerGas: undefined,
  });
  state.receipts.set(mint.transactionHash, {
    status: "success",
    transactionHash: mint.transactionHash,
    from: teardownContext.scope.owner,
    to: teardownContext.scope.account,
    blockNumber: mintBlockNumber,
    blockHash: mint.blockHash,
    transactionIndex: mintIndex,
    logs: [],
    blobGasUsed: undefined,
  });
  const safeFlags = {
    scoutMode: true,
    approvalPurchases: false,
    autonomousPurchases: false,
    autonomousMints: false,
    unknownCollectionExecution: false,
    selling: false,
    autonomousSelling: false,
  };
  const disabledCurrency = {
    allowed: false,
    maxSpendPerTransaction: 0n,
    maxSpendPerDay: 0n,
    maxSpendPerWeek: 0n,
    maxMintPrice: 0n,
    maxSecondaryPurchasePrice: 0n,
  };
  const eventArgs = [
    ["FeatureFlagsChanged", { flags: safeFlags }],
    ["AccountPauseChanged", {
      account: teardownContext.scope.account, owner: teardownContext.scope.owner,
      paused: true, version: 12n,
    }],
    ["PolicyConfigured", {
      account: teardownContext.scope.account, owner: teardownContext.scope.owner,
      version: 13n, mode: 0,
    }],
    ["AdapterStatusChanged", { adapter: teardownContext.scope.adapter, active: false }],
    ["MintControlsChanged", {
      account: teardownContext.scope.account, owner: teardownContext.scope.owner,
      ownerApprovedMints: false, autonomousFreeMints: false,
      autonomousPaidMints: false, policyVersion: 14n,
    }],
    ["SelectorPermissionChanged", {
      account: teardownContext.scope.account, selector: teardownContext.scope.selector,
      allowed: false, denied: true,
    }],
    ["AdapterPermissionChanged", {
      account: teardownContext.scope.account, adapter: teardownContext.scope.adapter, allowed: false,
    }],
    ["VenuePermissionChanged", {
      account: teardownContext.scope.account, venue: teardownContext.scope.venue,
      kind: 1, allowed: false,
    }],
    ["CollectionPermissionChanged", {
      account: teardownContext.scope.account, collection: teardownContext.scope.collection,
      allowed: false, denied: true,
    }],
    ["CurrencyPolicyChanged", {
      account: teardownContext.scope.account, currency: "0x0000000000000000000000000000000000000000",
      policy: disabledCurrency,
    }],
    ["VenueCurrencyMaximumChanged", {
      account: teardownContext.scope.account, venue: teardownContext.scope.venue,
      currency: "0x0000000000000000000000000000000000000000", maximum: 0n,
    }],
  ];
  for (let index = 0; index < 11; index += 1) {
    const planned = teardownContext.teardownPlan[index];
    const txHash = teardownContext.teardownEvidence[index].hash;
    const blockNumber = mintBlockNumber + 1n + BigInt(index);
    const blockHash = hash((index + 1).toString(16));
    const indirect = guardianSafe && planned.role === "GUARDIAN";
    const from = indirect ? state.relayer : planned.from;
    const to = indirect ? teardownContext.contracts.guardian : planned.to;
    const [eventName, args] = eventArgs[index];
    const targetLog = eventLog(index === 3
      ? LIVE_APPROVAL_PREFLIGHT_ABIS.adapterMutationEventAbi
      : LIVE_APPROVAL_PREFLIGHT_ABIS.policyMutationEventAbi, eventName, args, {
      address: planned.to,
      blockHash,
      blockNumber,
      transactionHash: txHash,
      transactionIndex: 0n,
      logIndex: indirect ? 1n : 0n,
    });
    const safeLog = {
      address: teardownContext.contracts.guardian,
      blockHash,
      blockNumber,
      transactionHash: txHash,
      transactionIndex: 0n,
      logIndex: 0n,
      removed: false,
      data: "0x",
      topics: [hash("9")],
      blockTimestamp: undefined,
    };
    state.transactions.set(txHash, {
      hash: txHash,
      from,
      to,
      input: indirect ? "0x12345678" : planned.calldata,
      value: 0n,
      chainId: 4663,
      blockNumber,
      blockHash,
      transactionIndex: 0n,
      maxFeePerGas: undefined,
    });
    state.receipts.set(txHash, {
      status: "success",
      transactionHash: txHash,
      from,
      to,
      blockNumber,
      blockHash,
      transactionIndex: 0n,
      logs: indirect ? [safeLog, targetLog] : [targetLog],
      blobGasUsed: undefined,
    });
    state.blocks.set(blockNumber.toString(), {
      number: blockNumber,
      hash: blockHash,
      timestamp: mintTimestamp + 1n + BigInt(index),
      transactions: [txHash],
      blobGasUsed: undefined,
    });
    (index === 3 ? state.adapterLogs : state.policyLogs).push(targetLog);
  }
  state.blocks.set("2020", {
    number: 2020n,
    hash: hash("c"),
    timestamp: finalTimestamp - 10n,
    blobGasUsed: undefined,
  });
  state.blocks.set("2041", {
    number: 2041n,
    hash: hash("d"),
    timestamp: finalTimestamp,
    blobGasUsed: undefined,
  });
  return state;
}

function realisticClient(state, role) {
  const origin = role === "primary"
    ? "https://rpc.first-provider.example"
    : "https://rpc.second-provider.test";
  const contract = state.context.contracts;
  return {
    transport: { url: `${origin}/rpc` },
    async getChainId() { return 4663; },
    async getBlockNumber() {
      state.headReads[role] += 1;
      return state.headReads[role] === 1
        ? (role === "primary" ? 2040n : 2041n)
        : (role === "primary" ? 2042n : 2041n);
    },
    async getBlock({ blockNumber }) {
      const key = `${role}:${blockNumber}`;
      const count = (state.blockReadCounts[role].get(blockNumber.toString()) ?? 0) + 1;
      state.blockReadCounts[role].set(blockNumber.toString(), count);
      const block = structuredClone(state.blocks.get(blockNumber.toString()));
      if (!block) throw new Error(`unknown block ${blockNumber}`);
      if (state.closingBlockChanges.has(key) && count > 1) {
        block.hash = state.closingBlockChanges.get(key);
      }
      return block;
    },
    async getTransaction({ hash: txHash }) { return structuredClone(state.transactions.get(txHash)); },
    async getTransactionReceipt({ hash: txHash }) {
      return structuredClone(state.receipts.get(txHash));
    },
    async getCode({ address: target, blockNumber }) {
      return state.codeOverrides.get(`${target.toLowerCase()}:${blockNumber}`)
        ?? state.codes[target.toLowerCase()] ?? "0x";
    },
    async getStorageAt({ address: target, slot }) {
      return state.proxySlots[target.toLowerCase()]?.[slot.toLowerCase()] ?? hash("0");
    },
    async getBalance() { return 0n; },
    async getLogs(request) {
      const target = request.address.toLowerCase();
      if (target === contract.policyModule.address) return structuredClone(state.policyLogs);
      if (target === contract.adapterRegistry.address) return structuredClone(state.adapterLogs);
      if (target === contract.agentRegistry.address) return structuredClone(state.agentLogs);
      if (target === contract.account.address) return structuredClone(state.accountLogs);
      if (target === state.context.infrastructure.canonicalCollection) {
        return structuredClone(state.transfers);
      }
      return [];
    },
    async readContract({ address: targetAddress, functionName, blockNumber }) {
      const target = targetAddress.toLowerCase();
      if ([contract.adapterRegistry.address, contract.agentRegistry.address,
        contract.policyModule.address].includes(target)) {
        if (functionName === "owner") return contract.guardian;
        if (functionName === "pendingOwner") {
          return "0x0000000000000000000000000000000000000000";
        }
      }
      if (target === contract.accountRegistry.address) {
        if (functionName === "implementation") return contract.accountImplementation.address;
        if (functionName === "accountSalt") return state.context.infrastructure.accountSalt;
        if (functionName === "ROBINHOOD_CHAIN_ID") return 4663n;
        if (functionName === "GOGH_PUNKS") return state.context.infrastructure.canonicalCollection;
        if (["CANONICAL_ERC6551_REGISTRY", "canonicalRegistry"].includes(functionName)) {
          return state.context.infrastructure.canonicalERC6551Registry;
        }
        if (functionName === "account") return state.context.scope.account;
      }
      if (target === state.context.infrastructure.canonicalERC6551Registry
        && functionName === "account") return state.context.scope.account;
      if (target === state.context.infrastructure.canonicalCollection && functionName === "ownerOf") {
        return state.owner;
      }
      if ([contract.account.address, contract.accountImplementation.address].includes(target)) {
        if (functionName === "token") return [4663n,
          state.context.infrastructure.canonicalCollection, state.footerTokenId];
        if (functionName === "owner") return state.owner;
        if (functionName === "isCanonicalGoghPunkAccount") return state.accountCanonical;
        if (functionName === "policyModule") return contract.policyModule.address;
        if (functionName === "agentRegistry") return contract.agentRegistry.address;
        if (functionName === "adapterRegistry") return contract.adapterRegistry.address;
        if (functionName === "acquisitionNonce") return state.accountNonce;
        if (functionName === "state") return state.accountState;
      }
      if (target === contract.policyModule.address) {
        if (functionName === "globallyPaused") return state.policyGlobalPaused;
        if (functionName === "featureFlags") return {
          scoutMode: true,
          approvalPurchases: state.approvalPurchases,
          autonomousPurchases: false,
          autonomousMints: false,
          unknownCollectionExecution: false,
          selling: false,
          autonomousSelling: false,
        };
        if (functionName === "policy") return {
          config: {
            mode: 0,
            maxSpendPerTransaction: 0n,
            maxSpendPerDay: 0n,
            maxSpendPerWeek: 0n,
            maxMintPrice: 0n,
            maxSecondaryPurchasePrice: 0n,
            minimumNativeReserve: 0n,
            maxAcquisitionsPerDay: 1,
            maxIntentAge: 120,
            maxSlippageBps: 0,
            requireCollectionAllowlist: true,
            allowUnknownCollections: false,
          },
          configuredBy: state.context.scope.owner,
          version: state.policyVersion,
          permissionGeneration: state.permissionGeneration,
          accountPaused: state.policyPaused,
        };
        if (functionName === "effectiveMode") return 0;
        if (functionName === "mintControls") return {
          ownerApprovedMints: false, autonomousFreeMints: false, autonomousPaidMints: false,
        };
        if (["approvedAdapters", "approvedMintContracts", "approvedCollections",
          "approvedSelectors"].includes(functionName)) return false;
        if (["deniedCollections", "deniedSelectors"].includes(functionName)) return true;
        if (functionName === "currencyPolicy") return {
          allowed: false,
          maxSpendPerTransaction: 0n,
          maxSpendPerDay: 0n,
          maxSpendPerWeek: 0n,
          maxMintPrice: 0n,
          maxSecondaryPurchasePrice: 0n,
        };
        if (functionName === "venueCurrencyMaximum") return 0n;
        if (functionName === "acquisitionUsage") {
          const timestamp = state.blocks.get(blockNumber.toString()).timestamp;
          const day = timestamp / 86_400n;
          const mintDay = BigInt(state.context.mintReceipt.blockTimestamp) / 86_400n;
          return { dayBucket: day, acquisitionsToday: day === mintDay ? 1 : 0 };
        }
      }
      if (target === contract.adapterRegistry.address) {
        if (functionName === "globallyPaused") return state.adapterGlobalPaused;
        if (functionName === "adapterRecord") return {
          kind: 1,
          active: state.adapterActive,
          venue: state.context.scope.venue,
          adapterCodeHash: contract.adapter.runtimeCodeHash,
          venueCodeHash: contract.venue.runtimeCodeHash,
          versionHash: state.context.scope.adapterVersionHash,
          metadataHash: state.context.scope.adapterMetadataHash,
        };
      }
      if (target === contract.agentRegistry.address && functionName === "globallyPaused") {
        return state.agentGlobalPaused;
      }
      if (target === state.context.scope.adapter) {
        if (functionName === "kind") return 1;
        if (["venue", "collection"].includes(functionName)) return state.context.scope.venue;
        if (functionName === "mintSelector") return state.context.scope.selector;
        if (functionName === "assetStandard") return 0;
      }
      if (target === state.context.scope.collection && functionName === "ownerOf") {
        return state.nftOwner;
      }
      if (target === state.context.scope.collection && functionName === "balanceOf") return 1n;
      if (target === state.context.scope.collection && functionName === "getApproved") {
        return "0x0000000000000000000000000000000000000000";
      }
      if (target === state.context.scope.collection && functionName === "isApprovedForAll") {
        return false;
      }
      if (target === state.context.scope.collection && functionName === "minted") return true;
      throw new Error(`unexpected read ${targetAddress}.${functionName}`);
    },
  };
}

function runRealistic(state, now = Number(state.latestTimestamp), confirmations = 20) {
  return attestCanaryFinalTeardown({
    teardownContext: state.context,
    primaryClient: realisticClient(state, "primary"),
    secondaryClient: realisticClient(state, "secondary"),
    endpointOrigins: ["https://rpc.first-provider.example", "https://rpc.second-provider.test"],
    confirmations,
    clock: () => now,
  });
}

test("rejects a halted-chain/replayed teardown after six hours by wall clock before any RPC read", async () => {
  const mintTime = 2_000_000_000;
  await assert.rejects(
    () => attestCanaryFinalTeardown(argumentsFor(context(mintTime), mintTime + 21_601)),
    (error) => error instanceof CanaryTeardownFinalAttestationError
      && error.code === "STALE_TEARDOWN",
  );
});

test("full dual-RPC EOA teardown attestation passes with exact receipts, events, state, and code", async () => {
  const state = realisticFixture();
  const result = await runRealistic(state);
  assert.equal(result.status, "READ_ONLY_FINAL_TEARDOWN_PASS");
  assert.equal(result.teardownHistory.transactionCount, 11);
  assert.equal(result.teardownHistory.guardianExecutionPath, "DIRECT_GUARDIAN_EOA");
  assert.equal(result.finalState.policyVersion, "20");
  assert.equal(result.finalState.permissionGeneration, "1");
  assert.equal(result.acquisition.acquisitionNonce, "1");
  assert.equal(result.acquisition.accountState, "2");
  assert.equal(result.acquisition.nftOwner, state.context.scope.account);
  assert.equal(result.transactionAuthorized, false);
  assert.equal(result.signingPerformed, false);
  assert.deepEqual(validateCanaryFinalTeardownAttestationHash(result), result);
});

test("full dual-RPC Safe guardian path proves logical caller target events and preserves warning", async () => {
  const result = await runRealistic(realisticFixture({ guardianSafe: true }));
  assert.equal(result.status, "READ_ONLY_FINAL_TEARDOWN_PASS");
  assert.equal(result.teardownHistory.guardianExecutionPath,
    "SAFE_OR_CONTRACT_LOGICAL_CALLER_TARGET_EVENTS_VERIFIED");
  assert.equal(result.teardownHistory.completeSafeBatchInspectionStillRequired, true);
});

test("UTC rollover reports reset daily usage while persistent mint history remains proven", async () => {
  const result = await runRealistic(realisticFixture({ utcRollover: true }));
  assert.equal(result.acquisition.acquisitionsTodayAtLatest, "0");
  assert.equal(result.acquisition.persistentAcquisitionHistoryProvenByNonceStateAndBoundMintReceipt,
    true);
  assert.equal(result.acquisition.acquisitionNonce, "1");
  assert.equal(result.acquisition.accountState, "2");
});

test("fails closed on transaction, receipt, inclusion, and event-identity mutations", async (t) => {
  const cases = [
    ["failed receipt status", (state) => {
      state.receipts.get(state.context.teardownEvidence[0].hash).status = "reverted";
    }],
    ["transaction sender", (state) => {
      state.transactions.get(state.context.teardownEvidence[1].hash).from = addr("c");
    }],
    ["transaction destination", (state) => {
      state.transactions.get(state.context.teardownEvidence[1].hash).to = addr("c");
    }],
    ["transaction calldata", (state) => {
      state.transactions.get(state.context.teardownEvidence[1].hash).input = "0xdeadbeef";
    }],
    ["transaction value", (state) => {
      state.transactions.get(state.context.teardownEvidence[1].hash).value = 1n;
    }],
    ["receipt sender", (state) => {
      state.receipts.get(state.context.teardownEvidence[1].hash).from = addr("c");
    }],
    ["receipt destination", (state) => {
      state.receipts.get(state.context.teardownEvidence[1].hash).to = addr("c");
    }],
    ["receipt block hash", (state) => {
      state.receipts.get(state.context.teardownEvidence[1].hash).blockHash = hash("e");
    }],
    ["receipt transaction index", (state) => {
      state.receipts.get(state.context.teardownEvidence[1].hash).transactionIndex = 1n;
    }],
    ["transaction absent from claimed block", (state) => {
      state.blocks.get("501").transactions[0] = hash("e");
    }],
    ["mint absent from claimed block index", (state) => {
      state.blocks.get("500").transactions[2] = hash("e");
    }],
    ["receipt log index disagrees with interval", (state) => {
      const receipt = state.receipts.get(state.context.teardownEvidence[1].hash);
      receipt.logs[0] = { ...receipt.logs[0], logIndex: 99n };
    }],
    ["receipt log emitter", (state) => {
      state.receipts.get(state.context.teardownEvidence[1].hash).logs[0].address = addr("c");
    }],
    ["receipt log transaction identity", (state) => {
      state.receipts.get(state.context.teardownEvidence[1].hash).logs[0].transactionHash = hash("e");
    }],
    ["nonboolean removed marker", (state) => {
      state.receipts.get(state.context.teardownEvidence[1].hash).logs[0].removed = "false";
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const state = realisticFixture();
      mutate(state);
      await assert.rejects(() => runRealistic(state), CanaryTeardownFinalAttestationError);
    });
  }
});

test("fails closed on missing/extra interval events, ownership ABA, and agent history", async (t) => {
  const cases = [
    ["missing teardown interval event", (state) => { state.policyLogs.pop(); }],
    ["extra teardown interval event", (state) => {
      state.policyLogs.push(structuredClone(state.policyLogs[0]));
    }],
    ["controlling Punk transfer", (state) => {
      state.transfers.push({ blockNumber: 700n, transactionIndex: 0n });
    }],
    ["controlling Punk ABA transfers", (state) => {
      state.transfers.push(
        { blockNumber: 700n, transactionIndex: 0n },
        { blockNumber: 701n, transactionIndex: 0n },
      );
    }],
    ["global agent history", (state) => {
      state.agentLogs.push(eventLog(
        LIVE_APPROVAL_PREFLIGHT_ABIS.agentMutationEventAbi,
        "GlobalAgentPauseChanged",
        { paused: true },
        {
          address: state.context.contracts.agentRegistry.address,
          blockHash: hash("e"),
          blockNumber: 700n,
          transactionHash: hash("e"),
          transactionIndex: 0n,
          logIndex: 0n,
        },
      ));
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const state = realisticFixture();
      mutate(state);
      await assert.rejects(() => runRealistic(state), CanaryTeardownFinalAttestationError);
    });
  }
});

test("fails closed on runtime, proxy, owner, footer, policy, nonce, state, and NFT drift", async (t) => {
  const cases = [
    ["per-receipt target runtime", (state) => {
      state.codeOverrides.set(`${state.context.contracts.policyModule.address}:501`, "0x6000");
    }],
    ["final runtime", (state) => {
      state.codes[state.context.contracts.adapter.address] = "0x6000";
    }],
    ["proxy implementation slot", (state) => {
      state.proxySlots[state.context.scope.adapter] = {
        "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc": hash("1"),
      };
    }],
    ["current owner", (state) => { state.owner = addr("c"); }],
    ["account footer", (state) => { state.footerTokenId = 1798n; }],
    ["canonical account qualification", (state) => { state.accountCanonical = false; }],
    ["policy version", (state) => { state.policyVersion = 19n; }],
    ["permission generation", (state) => { state.permissionGeneration = 2n; }],
    ["account pause", (state) => { state.policyPaused = false; }],
    ["approval purchase feature", (state) => { state.approvalPurchases = true; }],
    ["adapter remains active", (state) => { state.adapterActive = true; }],
    ["policy global pause", (state) => { state.policyGlobalPaused = true; }],
    ["adapter global pause", (state) => { state.adapterGlobalPaused = true; }],
    ["agent global pause", (state) => { state.agentGlobalPaused = true; }],
    ["acquisition nonce", (state) => { state.accountNonce = 2n; }],
    ["account state", (state) => { state.accountState = 3n; }],
    ["canary NFT owner", (state) => { state.nftOwner = addr("c"); }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const state = realisticFixture();
      mutate(state);
      await assert.rejects(() => runRealistic(state), CanaryTeardownFinalAttestationError);
    });
  }
});

test("fails closed on confirmation depth and closing-block reorg mutations", async () => {
  await assert.rejects(() => runRealistic(realisticFixture(), undefined, 11), (error) => (
    error.code === "INVALID_CONFIRMATIONS"
  ));
  const reorg = realisticFixture();
  reorg.closingBlockChanges.set("primary:501", hash("e"));
  await assert.rejects(() => runRealistic(reorg), CanaryTeardownFinalAttestationError);
});

test("requires endpoint-origin provenance from distinct registrable providers", async () => {
  const now = 2_000_000_000;
  const args = argumentsFor(context(now), now);
  delete args.endpointOrigins;
  await assert.rejects(() => attestCanaryFinalTeardown(args), /exactly two endpoint origins/);

  const duplicate = argumentsFor(context(now), now);
  duplicate.secondaryClient = client("https://other.rpc.first-provider.example");
  duplicate.endpointOrigins = [
    "https://rpc.first-provider.example",
    "https://other.rpc.first-provider.example",
  ];
  await assert.rejects(() => attestCanaryFinalTeardown(duplicate), /distinct registrable/);
});

test("pins exact teardown IDs/functions and rejects evidence substitution before RPC", async () => {
  const now = 2_000_000_000;
  const replaced = context(now);
  replaced.teardownPlan[5].functionName = "setAdapterPermission";
  await assert.rejects(() => attestCanaryFinalTeardown(argumentsFor(replaced, now)), (error) => (
    error.code === "INVALID_TEARDOWN_PLAN"
  ));

  const swapped = context(now);
  [swapped.teardownEvidence[2], swapped.teardownEvidence[3]] = [
    swapped.teardownEvidence[3], swapped.teardownEvidence[2],
  ];
  await assert.rejects(() => attestCanaryFinalTeardown(argumentsFor(swapped, now)), (error) => (
    error.code === "INVALID_TEARDOWN_EVIDENCE"
  ));
});

test("attestation hash binds the complete emitted body and detects edited final claims", () => {
  const body = {
    schema: "GOGH_OWNER_DIRECT_CANARY_FINAL_TEARDOWN_ATTESTATION_V1",
    status: "READ_ONLY_FINAL_TEARDOWN_PASS",
    readOnly: true,
    transactionAuthorized: false,
    signingPerformed: false,
    submissionPerformed: false,
    chainWritePerformed: false,
    evidenceHashes: { coreManifest: hash("1") },
    punk: { tokenId: "4242", currentOwner: addr("b") },
    finalState: { approvalPurchases: false, adapterActive: false },
    limitations: ["read-only"],
  };
  const artifact = {
    ...body,
    attestationSha256: `0x${createHash("sha256").update(canonicalJson(body)).digest("hex")}`,
  };
  const validated = validateCanaryFinalTeardownAttestationHash(artifact);
  assert.deepEqual(validated, artifact);
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated.finalState));
  const edited = structuredClone(artifact);
  edited.finalState.approvalPurchases = true;
  assert.throws(() => validateCanaryFinalTeardownAttestationHash(edited), (error) => (
    error.code === "ATTESTATION_HASH_MISMATCH"
  ));
});

test("timing gate rejects future and stalled latest blocks and enforces final wall-clock boundary", () => {
  assert.deepEqual(validateCanaryFinalTeardownTiming({
    nowSeconds: "2000000100",
    mintBlockTimestamp: "2000000000",
    latestBlockTimestamp: "2000000090",
  }), { now: 2_000_000_100n, mint: 2_000_000_000n, latest: 2_000_000_090n });
  assert.throws(() => validateCanaryFinalTeardownTiming({
    nowSeconds: "2000000100",
    mintBlockTimestamp: "2000000000",
    latestBlockTimestamp: "2000000131",
  }), /in the future/);
  assert.throws(() => validateCanaryFinalTeardownTiming({
    nowSeconds: "2000001000",
    mintBlockTimestamp: "2000000000",
    latestBlockTimestamp: "2000000600",
  }), /stale/);
  assert.throws(() => validateCanaryFinalTeardownTiming({
    nowSeconds: String(2_000_000_000 + 21_601),
    mintBlockTimestamp: "2000000000",
    latestBlockTimestamp: String(2_000_000_000 + 21_600),
  }), /six-hour/);
});

test("final attestor source has no wallet, signer, submission, or file-write capability", async () => {
  const source = await readFile(new URL(
    "../scripts/canary-teardown-final-attestation.mjs",
    import.meta.url,
  ), "utf8");
  assert.doesNotMatch(source, /createWalletClient|privateKeyToAccount|signTypedData/);
  assert.doesNotMatch(source, /sendTransaction|writeContract|eth_sendRawTransaction/);
  assert.doesNotMatch(source, /writeFile|appendFile|simulateContract/);
});
