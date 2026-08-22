import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
} from "viem";
import { ROBINHOOD } from "../broker/src/config.mjs";
import {
  buildCanaryConfigurationReceiptEvidence,
} from "../broker/src/recommendation/canary-configuration-receipt-evidence.mjs";
import {
  buildOwnerReviewFreeMintProposal,
} from "../broker/src/recommendation/owner-approved-free-mint-proposal.mjs";
import {
  canonicalSha256,
  ONE_SHOT_MINT_SELECTOR,
} from "../broker/src/recommendation/owner-direct-free-mint-execution.mjs";
import { buildOwnerDirectCanaryConfigBundle } from
  "../scripts/build-owner-direct-canary-config-bundle.mjs";
import {
  attestLiveApproval,
  LIVE_APPROVAL_PREFLIGHT_ABIS,
  LiveApprovalPreflightError,
} from "../scripts/canary-approval-live-preflight.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_WORD = `0x${"00".repeat(32)}`;
const hash = (byte) => `0x${byte.repeat(32)}`;
const address = (nibble) => `0x${nibble.repeat(40)}`;
const COMMIT = "a".repeat(40);
const OWNER = address("1");
const ACCOUNT = address("2");
const ART = address("3");
const ADAPTER = address("4");
const GUARDIAN = address("5");
const DEPLOYER = address("6");
const RELAYER = address("c");
const PUNK_TOKEN_ID = "4242";
const ART_TOKEN_ID = "9001";
const CLEAN_BLOCK = 1_120;
const PINNED_BLOCK = 5_000n;
const LATEST_BLOCK = 5_021n;
const CLEAN_TIMESTAMP = 960n;
const PINNED_TIMESTAMP = 1_040n;
const LATEST_TIMESTAMP = 1_050n;
const EMPTY_HASH = keccak256("0x");
const CORE_CONTRACT_NAMES = [
  "ArtAdapterRegistry", "ArtAgentRegistry", "BrokerPolicyModule",
  "GoghPunkAccountV1", "GoghPunkAccountRegistry",
];
const CANARY_CONTRACT_NAMES = [
  "GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter",
];
const ERC6551_RUNTIME_CODE =
  "0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063246a00211461003b5780638a54c52f1461006a575b600080fd5b61004e6100493660046101b7565b61007d565b6040516001600160a01b03909116815260200160405180910390f35b61004e6100783660046101b7565b6100e1565b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b60015284601552605560002060601b60601c60005260206000f35b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b600152846015526055600020803b61018b578560b760556000f580610157576320188a596000526004601cfd5b80606c52508284887f79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf887226060606ca46020606cf35b8060601b60601c60005260206000f35b80356001600160a01b03811681146101b257600080fd5b919050565b600080600080600060a086880312156101cf57600080fd5b6101d88661019b565b945060208601359350604086013592506101f46060870161019b565b94979396509194608001359291505056fea2646970667358221220ea2fe53af507453c64dd7c1db05549fa47a298dfb825d6d11e1689856135f16764736f6c63430008110033";

const coreTemplate = JSON.parse(await readFile(
  new URL("../deployments/robinhood.json", import.meta.url), "utf8",
));
const canaryTemplate = JSON.parse(await readFile(
  new URL("../deployments/robinhood-canary.json", import.meta.url), "utf8",
));

function iso(seconds) {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function sourceVerificationAdoption(
  verifiedContracts,
  pendingByte,
  evidenceByte,
  pendingManifest,
) {
  return {
    schema: "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1",
    gateSchema: "GOGH_BLOCKSCOUT_VERIFIED_MANIFEST_PROPOSAL_V1",
    gateVersion: 1,
    chainId: 4663,
    explorerOrigin: "https://robinhoodchain.blockscout.com",
    pendingProposalSha256: hash(pendingByte),
    pendingManifestSha256: canonicalSha256(pendingManifest),
    pendingManifestNotes: pendingManifest.notes,
    verificationEvidenceSha256: hash(evidenceByte),
    verifiedContracts: [...verifiedContracts],
    observedAt: iso(949n),
  };
}

function adoptManifest(manifest, verifiedContracts, pendingByte, evidenceByte) {
  const pendingManifest = structuredClone(manifest);
  for (const name of verifiedContracts) {
    pendingManifest.contracts[name].verificationStatus = "NOT_SUBMITTED";
  }
  pendingManifest.sourceVerificationAdoption = null;
  manifest.sourceVerificationAdoption = sourceVerificationAdoption(
    verifiedContracts,
    pendingByte,
    evidenceByte,
    pendingManifest,
  );
  return manifest;
}

function deployedCore(codes) {
  const manifest = structuredClone(coreTemplate);
  manifest.status = "DEPLOYED";
  manifest.gitCommit = COMMIT;
  manifest.protocolGuardian = GUARDIAN;
  manifest.featureFlags.ENABLE_APPROVAL_PURCHASES = false;
  const digits = ["7", "8", "9", "a", "b"];
  Object.entries(manifest.contracts).forEach(([name, record], index) => {
    const contractAddress = address(digits[index]);
    const code = `0x60${String(index + 1).padStart(2, "0")}`;
    codes[contractAddress] = code;
    record.address = contractAddress;
    record.deploymentTransaction = hash(`0${index + 1}`);
    record.deploymentBlock = 1_000 + index;
    record.deployer = DEPLOYER;
    record.constructorArguments = [];
    record.creationBytecodeHash = hash(`1${index + 1}`);
    record.runtimeBytecodeHash = keccak256(code);
    record.gitCommit = COMMIT;
    record.verificationStatus = "VERIFIED";
  });
  manifest.contracts.ArtAdapterRegistry.constructorArguments = [GUARDIAN];
  manifest.contracts.ArtAgentRegistry.constructorArguments = [GUARDIAN];
  manifest.contracts.BrokerPolicyModule.constructorArguments = [
    GUARDIAN, manifest.contracts.ArtAdapterRegistry.address,
  ];
  manifest.contracts.GoghPunkAccountV1.constructorArguments = [
    manifest.contracts.BrokerPolicyModule.address,
    manifest.contracts.ArtAgentRegistry.address,
    manifest.contracts.ArtAdapterRegistry.address,
  ];
  manifest.contracts.GoghPunkAccountRegistry.constructorArguments = [
    manifest.contracts.GoghPunkAccountV1.address, manifest.accountSalt,
  ];
  return adoptManifest(manifest, CORE_CONTRACT_NAMES, "17", "18");
}

function cleanPreconfigurationState(core) {
  const isolationEventScan = {
    fromBlock: core.contracts.BrokerPolicyModule.deploymentBlock,
    toBlock: CLEAN_BLOCK,
    accountScopedPolicyMutationEvents: 0,
    featureFlagChangeEvents: 0,
    passed: true,
  };
  isolationEventScan.evidenceHash = canonicalSha256(isolationEventScan);
  const agentAuthorizationEventScan = {
    fromBlock: core.contracts.ArtAgentRegistry.deploymentBlock,
    toBlock: CLEAN_BLOCK,
    authorizedEvents: 0,
    revokedEvents: 0,
    allAgentsRevokedEvents: 0,
    passed: true,
  };
  agentAuthorizationEventScan.evidenceHash = canonicalSha256(agentAuthorizationEventScan);
  const clean = {
    blockNumber: CLEAN_BLOCK,
    blockHash: hash("40"),
    blockTimestamp: iso(CLEAN_TIMESTAMP),
    accountState: "0",
    acquisitionNonce: "0",
    policy: {
      mode: 0, maxSpendPerTransaction: "0", maxSpendPerDay: "0",
      maxSpendPerWeek: "0", maxMintPrice: "0", maxSecondaryPurchasePrice: "0",
      minimumNativeReserve: "0", maxAcquisitionsPerDay: 0, maxIntentAge: 0,
      maxSlippageBps: 0, requireCollectionAllowlist: false,
      allowUnknownCollections: false, configuredBy: ZERO_ADDRESS, version: 0,
      permissionGeneration: 0, accountPaused: false,
    },
    mintControls: {
      ownerApprovedMints: false, autonomousFreeMints: false, autonomousPaidMints: false,
    },
    adapterRecord: {
      kind: 0, active: false, venue: ZERO_ADDRESS, adapterCodeHash: ZERO_WORD,
      venueCodeHash: ZERO_WORD, versionHash: ZERO_WORD, metadataHash: ZERO_WORD,
    },
    permissions: {
      adapterAllowed: false, mintContractAllowed: false, collectionAllowed: false,
      collectionDenied: false, selectorAllowed: false, selectorDenied: false,
      nativeCurrencyPolicy: {
        allowed: false, maxSpendPerTransaction: "0", maxSpendPerDay: "0",
        maxSpendPerWeek: "0", maxMintPrice: "0", maxSecondaryPurchasePrice: "0",
      },
      venueCurrencyMaximum: "0",
    },
    featureFlags: {
      scoutMode: true, approvalPurchases: false, autonomousPurchases: false,
      autonomousMints: false, unknownCollectionExecution: false, selling: false,
      autonomousSelling: false,
    },
    globalPauses: { policy: false, adapters: false, agents: false },
    authorizationGeneration: 0,
    activeAgents: [],
    agentAuthorizationEventScan,
    acquisitionUsage: { acquisitionsToday: 0 },
    nativeUsage: { acquisitionsToday: 0, spentToday: "0", spentThisWeek: "0" },
    isolationEventScan,
  };
  return { ...clean, evidenceHash: canonicalSha256(clean) };
}

function rpcObservation(provider, origin) {
  return {
    provider,
    origin,
    chainId: 4663,
    headBlockNumber: 1_140,
    confirmedBlockNumber: CLEAN_BLOCK,
    confirmedBlockHash: hash("40"),
    confirmedBlockTimestamp: iso(CLEAN_TIMESTAMP),
    observedAt: iso(CLEAN_TIMESTAMP + (provider === "primary" ? 1n : 2n)),
    evidenceHash: provider === "primary" ? hash("41") : hash("42"),
  };
}

function ownerObservation(blockNumber, blockHash, timestamp) {
  return {
    expectedOwner: OWNER,
    observedOwner: OWNER,
    blockNumber,
    blockHash,
    blockTimestamp: iso(timestamp),
  };
}

function deployedCanary(core, codes) {
  const manifest = structuredClone(canaryTemplate);
  codes[ACCOUNT] = "0x6015";
  codes[ART] = "0x6013";
  codes[ADAPTER] = "0x6014";
  manifest.status = "DEPLOYED";
  manifest.coreDeploymentManifestGitCommit = COMMIT;
  manifest.coreDeploymentManifestSha256 = canonicalSha256(core);
  manifest.coreGoghPunkAccountRegistry = core.contracts.GoghPunkAccountRegistry.address;
  manifest.coreGoghPunkAccountRegistryRuntimeCodeHash =
    core.contracts.GoghPunkAccountRegistry.runtimeBytecodeHash;
  manifest.coreGoghPunkAccountImplementation = core.contracts.GoghPunkAccountV1.address;
  manifest.coreGoghPunkAccountImplementationRuntimeCodeHash =
    core.contracts.GoghPunkAccountV1.runtimeBytecodeHash;
  manifest.controllingPunkTokenId = PUNK_TOKEN_ID;
  manifest.expectedActivatedPunkAccount = ACCOUNT;
  manifest.expectedActivatedPunkAccountRuntimeCodeHash = keccak256(codes[ACCOUNT]);
  manifest.expectedOwnerAtPreparation = OWNER;
  manifest.canaryArtTokenId = ART_TOKEN_ID;
  manifest.gitCommit = COMMIT;
  Object.assign(manifest.contracts.GoghOneShotCanaryArt, {
    address: ART,
    deploymentTransaction: hash("21"),
    deploymentBlock: 1_100,
    deploymentBlockHash: hash("22"),
    receiptStatus: "SUCCESS",
    confirmationsRequired: 20,
    confirmationsObserved: 20,
    deployer: DEPLOYER,
    constructorArguments: [
      core.contracts.GoghPunkAccountRegistry.address, ACCOUNT, PUNK_TOKEN_ID, ART_TOKEN_ID,
    ],
    creationBytecodeHash: hash("23"),
    runtimeBytecodeHash: keccak256(codes[ART]),
    gitCommit: COMMIT,
    verificationStatus: "VERIFIED",
  });
  Object.assign(manifest.contracts.GoghOneShotCanaryMintAdapter, {
    address: ADAPTER,
    deploymentTransaction: hash("24"),
    deploymentBlock: 1_101,
    deploymentBlockHash: hash("25"),
    receiptStatus: "SUCCESS",
    confirmationsRequired: 20,
    confirmationsObserved: 20,
    deployer: DEPLOYER,
    constructorArguments: [ART],
    creationBytecodeHash: hash("26"),
    runtimeBytecodeHash: keccak256(codes[ADAPTER]),
    gitCommit: COMMIT,
    verificationStatus: "VERIFIED",
  });
  Object.assign(manifest.provenanceGate, {
    status: "VERIFIED",
    dualRpcAgreementRequired: true,
    primaryRpcObservation: rpcObservation("primary", "https://primary.example"),
    secondaryRpcObservation: rpcObservation("secondary", "https://secondary.test"),
    commonConfirmedBlockNumber: CLEAN_BLOCK,
    commonConfirmedBlockHash: hash("40"),
    commonConfirmedBlockTimestamp: iso(CLEAN_TIMESTAMP),
    confirmationsRequired: 20,
    confirmationsObserved: 20,
    coreManifestHashVerified: true,
    coreRegistryRuntimeHashVerified: true,
    accountImplementationRuntimeHashVerified: true,
    activatedAccountRuntimeHashVerified: true,
    canonicalERC6551RegistryRuntimeHashVerified: true,
    accountFooterVerified: true,
    expectedOwnerVerified: true,
    constructorInputsVerified: true,
    cleanPreconfigurationState: cleanPreconfigurationState(core),
    verifiedAt: iso(CLEAN_TIMESTAMP + 3n),
  });
  manifest.sourceVerificationAdoption = null;
  manifest.ownerObservations = {
    preparation: ownerObservation(1_099, hash("20"), 950n),
    afterCanaryArtReceipt: ownerObservation(1_100, hash("22"), 955n),
    afterCanaryAdapterReceipt: ownerObservation(1_101, hash("25"), 958n),
  };
  Object.assign(manifest.configuration, {
    deploymentAuthorized: true,
    broadcastAttempted: true,
    adapterRegistered: false,
    policyConfigured: false,
    ownerApprovedMintsEnabled: false,
    agentAuthorized: false,
    approvalPurchasesEnabled: false,
    autonomousPurchasesEnabled: false,
    autonomousMintsEnabled: false,
    mintExecuted: false,
  });
  return adoptManifest(manifest, CANARY_CONTRACT_NAMES, "29", "2a");
}

function proposal(codes) {
  return buildOwnerReviewFreeMintProposal({
    chainId: ROBINHOOD.chainId,
    punkCollection: ROBINHOOD.canonicalCollection,
    punkTokenId: PUNK_TOKEN_ID,
    punkAccount: ACCOUNT,
    expectedOwner: OWNER,
    ownerReview: true,
    opportunityType: "FREE_MINT",
    assetStandard: "ERC721",
    adapter: ADAPTER,
    venue: ART,
    collection: ART,
    mintSelector: ONE_SHOT_MINT_SELECTOR,
    tokenId: ART_TOKEN_ID,
    assetAmount: "1",
    currency: ZERO_ADDRESS,
    expectedPrice: "0",
    maxPrice: "0",
    maxSlippageBps: "0",
    expiresAt: "1120",
    nonce: "0",
    policyVersion: "11",
    opportunityId: hash("27"),
    reasoningHash: hash("28"),
    adapterCodeHash: keccak256(codes[ADAPTER]),
  }, { nowSeconds: 1_000 });
}

function eventLog(abi, eventName, args, meta) {
  const event = abi.find((item) => item.type === "event" && item.name === eventName);
  assert.ok(event, `missing ${eventName} ABI`);
  const topics = encodeEventTopics({ abi: [event], eventName, args });
  const nonIndexed = event.inputs.filter((input) => !input.indexed).map((input) => ({
    name: input.name,
    type: input.type,
    ...(input.components ? { components: input.components } : {}),
  }));
  const data = nonIndexed.length === 0 ? "0x" : encodeAbiParameters(
    nonIndexed,
    nonIndexed.map((input) => args[input.name]),
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

function expectedEvent(index, config, artifact, state) {
  const features = {
    scoutMode: true, approvalPurchases: true, autonomousPurchases: false,
    autonomousMints: false, unknownCollectionExecution: false, selling: false,
    autonomousSelling: false,
  };
  const currencyPolicy = {
    allowed: true, maxSpendPerTransaction: 0n, maxSpendPerDay: 0n,
    maxSpendPerWeek: 0n, maxMintPrice: 0n, maxSecondaryPurchasePrice: 0n,
  };
  return [
    ["AccountPauseChanged", { account: ACCOUNT, owner: OWNER, paused: true, version: 1n }],
    ["PolicyConfigured", { account: ACCOUNT, owner: OWNER, version: 2n, mode: 0 }],
    ["AdapterRegistered", {
      adapter: ADAPTER, venue: ART, kind: 1,
      adapterCodeHash: keccak256(state.codes[ADAPTER]),
      venueCodeHash: keccak256(state.codes[ART]),
      versionHash: config.review.adapterRegistrationCommitment.versionHash,
      metadataHash: config.review.adapterRegistrationCommitment.metadataHash,
    }],
    ["AdapterPermissionChanged", { account: ACCOUNT, adapter: ADAPTER, allowed: true }],
    ["VenuePermissionChanged", { account: ACCOUNT, venue: ART, kind: 1, allowed: true }],
    ["CollectionPermissionChanged", {
      account: ACCOUNT, collection: ART, allowed: true, denied: false,
    }],
    ["CurrencyPolicyChanged", { account: ACCOUNT, currency: ZERO_ADDRESS, policy: currencyPolicy }],
    ["VenueCurrencyMaximumChanged", {
      account: ACCOUNT, venue: ART, currency: ZERO_ADDRESS, maximum: 0n,
    }],
    ["SelectorPermissionChanged", {
      account: ACCOUNT, selector: ONE_SHOT_MINT_SELECTOR, allowed: true, denied: false,
    }],
    ["MintControlsChanged", {
      account: ACCOUNT, owner: OWNER, ownerApprovedMints: true,
      autonomousFreeMints: false, autonomousPaidMints: false, policyVersion: 9n,
    }],
    ["FeatureFlagsChanged", { flags: features }],
    ["PolicyConfigured", { account: ACCOUNT, owner: OWNER, version: 10n, mode: 2 }],
    ["AccountPauseChanged", { account: ACCOUNT, owner: OWNER, paused: false, version: 11n }],
  ][index];
}

function buildChainState({ guardianSafe = false } = {}) {
  const codes = {};
  const core = deployedCore(codes);
  const canary = deployedCanary(core, codes);
  const artifact = proposal(codes);
  const config = buildOwnerDirectCanaryConfigBundle(core, canary);
  const txBytes = Array.from({ length: 13 }, (_, index) => (
    (0x31 + index).toString(16).padStart(2, "0")
  ));
  const evidence = buildCanaryConfigurationReceiptEvidence({
    configBundleHash: config.bundleHash,
    preconfigurationBlock: {
      number: CLEAN_BLOCK,
      hash: hash("40"),
      timestamp: iso(CLEAN_TIMESTAMP),
    },
    transactions: config.review.configurationPlan.orderedCalls.map((call, index) => ({
      id: call.id,
      order: call.order,
      hash: hash(txBytes[index]),
    })),
  });
  if (guardianSafe) codes[GUARDIAN] = "0x6055";
  codes[ROBINHOOD.canonicalERC6551Registry] = ERC6551_RUNTIME_CODE;
  const state = {
    artifact,
    core,
    canary,
    config,
    evidence,
    codes,
    guardianSafe,
    chainIds: { primary: 4663, secondary: 4663 },
    headReads: { primary: 0, secondary: 0 },
    latestHeads: { primary: 5_022n, secondary: LATEST_BLOCK },
    latestTimestamp: LATEST_TIMESTAMP,
    blockReads: { primary: new Map(), secondary: new Map() },
    changedPinnedHash: {},
    transactions: new Map(),
    receipts: new Map(),
    policyIntervalLogs: [],
    adapterIntervalLogs: [],
    extraPolicyIntervalLogs: [],
    extraAdapterIntervalLogs: [],
    configurationAccountLogs: [],
    postPolicyLogs: [],
    postAdapterLogs: [],
    postAgentLogs: [],
    postAccountLogs: [],
    configurationOwnershipTransfers: [],
    postOwnershipTransfers: [],
    pendingOwners: {},
    owner: OWNER,
    accountNonce: 0n,
    accountState: 0n,
    features: {
      scoutMode: true, approvalPurchases: true, autonomousPurchases: false,
      autonomousMints: false, unknownCollectionExecution: false, selling: false,
      autonomousSelling: false,
    },
    latestFeatures: null,
    policy: {
      config: {
        mode: 2, maxSpendPerTransaction: 0n, maxSpendPerDay: 0n,
        maxSpendPerWeek: 0n, maxMintPrice: 0n, maxSecondaryPurchasePrice: 0n,
        minimumNativeReserve: 0n, maxAcquisitionsPerDay: 1, maxIntentAge: 120,
        maxSlippageBps: 0, requireCollectionAllowlist: true, allowUnknownCollections: false,
      },
      configuredBy: OWNER,
      version: 11n,
      permissionGeneration: 1n,
      accountPaused: false,
    },
    mintControls: {
      ownerApprovedMints: true, autonomousFreeMints: false, autonomousPaidMints: false,
    },
    permissions: {
      approvedAdapters: true, approvedMintContracts: true, approvedCollections: true,
      deniedCollections: false, approvedSelectors: true, deniedSelectors: false,
    },
    currencyPolicy: {
      allowed: true, maxSpendPerTransaction: 0n, maxSpendPerDay: 0n,
      maxSpendPerWeek: 0n, maxMintPrice: 0n, maxSecondaryPurchasePrice: 0n,
    },
    venueMaximum: 0n,
    acquisitionUsage: { dayBucket: 0n, acquisitionsToday: 0 },
    adapterRecord: {
      kind: 1,
      active: true,
      venue: ART,
      adapterCodeHash: keccak256(codes[ADAPTER]),
      venueCodeHash: keccak256(codes[ART]),
      versionHash: config.review.adapterRegistrationCommitment.versionHash,
      metadataHash: config.review.adapterRegistrationCommitment.metadataHash,
    },
    proxySlots: {},
    simulationError: null,
  };
  for (let index = 0; index < 13; index += 1) {
    const planned = config.review.configurationPlan.orderedCalls[index];
    const transactionHash = evidence.evidence.transactions[index].hash;
    const blockNumber = 1_201n + BigInt(index);
    const blockHash = hash((0x61 + index).toString(16).padStart(2, "0"));
    const isGuardian = planned.role === "GUARDIAN";
    const indirect = guardianSafe && isGuardian;
    const from = indirect ? RELAYER : planned.from;
    const to = indirect ? GUARDIAN : planned.to;
    const [eventName, args] = expectedEvent(index, config, artifact, state);
    const eventAbi = index === 2
      ? LIVE_APPROVAL_PREFLIGHT_ABIS.adapterMutationEventAbi
      : LIVE_APPROVAL_PREFLIGHT_ABIS.policyMutationEventAbi;
    const targetLog = eventLog(eventAbi, eventName, args, {
      address: planned.to,
      blockHash,
      blockNumber,
      transactionHash,
      transactionIndex: 0n,
      logIndex: indirect ? 1n : 0n,
    });
    const logs = indirect ? [{
      address: GUARDIAN,
      blockHash,
      blockNumber,
      transactionHash,
      transactionIndex: 0n,
      logIndex: 0n,
      removed: false,
      data: "0x",
      topics: [hash("99")],
      blockTimestamp: undefined,
    }, targetLog] : [targetLog];
    state.transactions.set(transactionHash, {
      hash: transactionHash,
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
    state.receipts.set(transactionHash, {
      status: "success",
      transactionHash,
      from,
      to,
      blockNumber,
      blockHash,
      transactionIndex: 0n,
      logs,
      blobGasUsed: undefined,
    });
    if (index === 2) state.adapterIntervalLogs.push(targetLog);
    else state.policyIntervalLogs.push(targetLog);
  }
  return state;
}

function blockFor(state, role, blockNumber) {
  const key = blockNumber.toString();
  const count = (state.blockReads[role].get(key) ?? 0) + 1;
  state.blockReads[role].set(key, count);
  if (blockNumber === BigInt(CLEAN_BLOCK)) {
    return { number: blockNumber, hash: hash("40"), timestamp: CLEAN_TIMESTAMP,
      blobGasUsed: undefined, excessBlobGas: undefined };
  }
  if (blockNumber >= 1_201n && blockNumber <= 1_213n) {
    const receipt = [...state.receipts.values()].find((item) => item.blockNumber === blockNumber);
    return { number: blockNumber, hash: receipt.blockHash, timestamp: 970n + blockNumber - 1_201n,
      blobGasUsed: undefined, excessBlobGas: undefined };
  }
  if (blockNumber === PINNED_BLOCK) {
    const changed = count > 1 ? state.changedPinnedHash[role] : undefined;
    return { number: blockNumber, hash: changed ?? hash("50"), timestamp: PINNED_TIMESTAMP,
      blobGasUsed: undefined, excessBlobGas: undefined };
  }
  if (blockNumber === LATEST_BLOCK) {
    return { number: blockNumber, hash: hash("51"), timestamp: state.latestTimestamp,
      blobGasUsed: undefined, excessBlobGas: undefined };
  }
  throw new Error(`unexpected block ${blockNumber}`);
}

function coreName(state, target) {
  return Object.entries(state.core.contracts)
    .find(([, record]) => record.address.toLowerCase() === target)?.[0];
}

function makeClient(state, role, calls) {
  return {
    name: `${role}-rpc`,
    transport: { url: `https://${role}.example` },
    async getChainId() {
      calls.push([role, "getChainId"]);
      return state.chainIds[role];
    },
    async getBlockNumber() {
      calls.push([role, "getBlockNumber"]);
      state.headReads[role] += 1;
      if (state.headReads[role] === 1) return role === "primary" ? 5_020n : 5_021n;
      return state.latestHeads[role];
    },
    async getBlock({ blockNumber }) {
      calls.push([role, "getBlock", blockNumber]);
      return blockFor(state, role, blockNumber);
    },
    async getCode({ address: target, blockNumber }) {
      calls.push([role, "getCode", target, blockNumber]);
      return state.codes[target.toLowerCase()];
    },
    async getStorageAt({ address: target, slot, blockNumber }) {
      calls.push([role, "getStorageAt", target, slot, blockNumber]);
      return state.proxySlots[target.toLowerCase()]?.[slot.toLowerCase()] ?? ZERO_WORD;
    },
    async getTransaction({ hash: transactionHash }) {
      calls.push([role, "getTransaction", transactionHash]);
      return state.transactions.get(transactionHash);
    },
    async getTransactionReceipt({ hash: transactionHash }) {
      calls.push([role, "getTransactionReceipt", transactionHash]);
      const receipt = state.receipts.get(transactionHash);
      // Real Robinhood providers disagree on representation only: Tenderly supplies zero for the
      // non-applicable blob field on ordinary EIP-1559 receipts while the official RPC omits it.
      return role === "secondary" ? { ...receipt, blobGasUsed: 0n } : receipt;
    },
    async getLogs(request) {
      calls.push([role, "getLogs", request]);
      const target = request.address.toLowerCase();
      const fromBlock = request.fromBlock;
      let logs;
      if (target === ROBINHOOD.canonicalCollection) {
        logs = fromBlock === BigInt(CLEAN_BLOCK) + 1n
          ? state.configurationOwnershipTransfers : state.postOwnershipTransfers;
      } else if (fromBlock <= BigInt(CLEAN_BLOCK)) {
        logs = [];
      } else if (fromBlock === BigInt(CLEAN_BLOCK) + 1n) {
        if (target === state.core.contracts.BrokerPolicyModule.address) {
          logs = [...state.policyIntervalLogs, ...state.extraPolicyIntervalLogs];
        } else if (target === state.core.contracts.ArtAdapterRegistry.address) {
          logs = [...state.adapterIntervalLogs, ...state.extraAdapterIntervalLogs];
        } else if (target === ACCOUNT) {
          logs = state.configurationAccountLogs;
        } else {
          logs = [];
        }
      } else if (target === state.core.contracts.BrokerPolicyModule.address) {
        logs = state.postPolicyLogs;
      } else if (target === state.core.contracts.ArtAdapterRegistry.address) {
        logs = state.postAdapterLogs;
      } else if (target === state.core.contracts.ArtAgentRegistry.address) {
        logs = state.postAgentLogs;
      } else if (target === ACCOUNT) {
        logs = state.postAccountLogs;
      } else {
        logs = [];
      }
      // eth_getLogs has no consensus blockTimestamp field. Real providers currently differ here:
      // the official endpoint materializes zero while Tenderly supplies the actual timestamp.
      return role === "secondary"
        ? logs.map((log) => ({ ...log, blockTimestamp: 1_787_376_447n }))
        : logs.map((log) => ({ ...log, blockTimestamp: 0n }));
    },
    async readContract(request) {
      const { address: targetAddress, functionName, blockNumber } = request;
      calls.push([role, "readContract", targetAddress, functionName, blockNumber]);
      const target = targetAddress.toLowerCase();
      const name = coreName(state, target);
      if (["ArtAdapterRegistry", "ArtAgentRegistry", "BrokerPolicyModule"].includes(name)) {
        if (functionName === "owner") return GUARDIAN;
        if (functionName === "pendingOwner") return state.pendingOwners[name] ?? ZERO_ADDRESS;
      }
      if (target === state.core.contracts.GoghPunkAccountRegistry.address) {
        if (functionName === "implementation") return state.core.contracts.GoghPunkAccountV1.address;
        if (functionName === "accountSalt") return state.core.accountSalt;
        if (functionName === "account") return ACCOUNT;
        if (functionName === "ROBINHOOD_CHAIN_ID") return 4663n;
        if (functionName === "GOGH_PUNKS") return ROBINHOOD.canonicalCollection;
        if (["CANONICAL_ERC6551_REGISTRY", "canonicalRegistry"].includes(functionName)) {
          return ROBINHOOD.canonicalERC6551Registry;
        }
      }
      if (target === ROBINHOOD.canonicalERC6551Registry && functionName === "account") return ACCOUNT;
      if (target === ROBINHOOD.canonicalCollection && functionName === "ownerOf") return state.owner;
      if ([ACCOUNT, state.core.contracts.GoghPunkAccountV1.address].includes(target)) {
        if (functionName === "token") return [4663n, ROBINHOOD.canonicalCollection, BigInt(PUNK_TOKEN_ID)];
        if (functionName === "owner") return state.owner;
        if (functionName === "isCanonicalGoghPunkAccount") return true;
        if (functionName === "policyModule") return state.core.contracts.BrokerPolicyModule.address;
        if (functionName === "agentRegistry") return state.core.contracts.ArtAgentRegistry.address;
        if (functionName === "adapterRegistry") return state.core.contracts.ArtAdapterRegistry.address;
        if (functionName === "state") return state.accountState;
        if (functionName === "acquisitionNonce") return state.accountNonce;
        if (functionName === "acquisitionIntentDigest") {
          return state.artifact.proposal.eip712.intentDigest;
        }
      }
      if (target === state.core.contracts.BrokerPolicyModule.address) {
        if (functionName === "adapterRegistry") return state.core.contracts.ArtAdapterRegistry.address;
        if (functionName === "globallyPaused") return false;
        if (functionName === "featureFlags") {
          return blockNumber === LATEST_BLOCK && state.latestFeatures
            ? state.latestFeatures : state.features;
        }
        if (functionName === "policy") return state.policy;
        if (functionName === "effectiveMode") return 2;
        if (functionName === "mintControls") return state.mintControls;
        if (Object.hasOwn(state.permissions, functionName)) return state.permissions[functionName];
        if (functionName === "currencyPolicy") return state.currencyPolicy;
        if (functionName === "venueCurrencyMaximum") return state.venueMaximum;
        if (functionName === "acquisitionUsage") return state.acquisitionUsage;
      }
      if (target === state.core.contracts.ArtAdapterRegistry.address) {
        if (functionName === "globallyPaused") return false;
        if (functionName === "adapterRecord") return state.adapterRecord;
      }
      if (target === state.core.contracts.ArtAgentRegistry.address
        && functionName === "globallyPaused") return false;
      if (target === ADAPTER) {
        if (functionName === "kind") return 1;
        if (functionName === "venue" || functionName === "collection") return ART;
        if (functionName === "mintSelector") return ONE_SHOT_MINT_SELECTOR;
        if (functionName === "assetStandard") return 0;
      }
      throw new Error(`unexpected read ${targetAddress}.${functionName}`);
    },
    async simulateContract(request) {
      calls.push([role, "simulateContract", request]);
      if (state.simulationError) throw state.simulationError;
      return { result: "0x", request: { to: ACCOUNT } };
    },
  };
}

function readyFixture(options) {
  const state = buildChainState(options);
  const calls = [];
  return {
    state,
    calls,
    primaryClient: makeClient(state, "primary", calls),
    secondaryClient: makeClient(state, "secondary", calls),
  };
}

function attest(fixture, options = {}) {
  return attestLiveApproval({
    proposalArtifact: fixture.state.artifact,
    manifest: fixture.state.core,
    canaryManifest: fixture.state.canary,
    configBundleArtifact: fixture.state.config,
    configurationEvidenceArtifact: fixture.state.evidence,
    primaryClient: fixture.primaryClient,
    secondaryClient: fixture.secondaryClient,
    confirmations: 20,
    nowSeconds: options.nowSeconds ?? 1_050,
    ...(options.clock ? { nowSeconds: undefined, clock: options.clock } : {}),
  });
}

test("dual-RPC attestation proves exact receipts, history, latest state, and EOA execution", async () => {
  const fixture = readyFixture();
  const result = await attest(fixture);
  assert.equal(result.status, "READ_ONLY_PASS");
  assert.equal(result.transactionAuthorized, false);
  assert.equal(result.executionBoundary.ownerType, "EOA_CURRENT_OWNER_ONLY");
  assert.equal(result.punk.accountRuntimeCodeHash,
    fixture.state.canary.expectedActivatedPunkAccountRuntimeCodeHash.toLowerCase());
  assert.equal(result.configurationHistory.transactionCount, 13);
  assert.equal(result.configurationHistory.lastTransactionBlock, "1213");
  assert.equal(result.configurationHistory.noPriorCanaryActivity, true);
  assert.equal(result.configurationHistory.noExtraRelevantMutationEvents, true);
  assert.equal(result.configurationHistory.noOwnershipTransfersFromPreconfigurationThroughLatest, true);
  assert.equal(result.configurationHistory.noRelevantMutationsAfterPinnedBlock, true);
  assert.equal(result.latestExecutionCheck.number, LATEST_BLOCK.toString());
  assert.equal(result.latestExecutionCheck.exactState.maxIntentAgeSeconds, "120");
  assert.equal(result.latestExecutionCheck.exactState.autonomousPurchases, false);
  assert.equal(result.sourceVerification.status, "VERIFIED_ADOPTIONS_BOUND");
  assert.equal(result.evidenceHashes.coreSourceVerificationAdoption,
    result.sourceVerification.coreAdoptionSha256);
  assert.equal(result.evidenceHashes.canarySourceVerificationAdoption,
    result.sourceVerification.canaryAdoptionSha256);
  assert.deepEqual(result.timing, {
    checkedAt: "1050", expiresAt: "1120", remainingSeconds: "70",
    minimumSubmissionMarginSeconds: 30,
  });
  assert.equal(fixture.calls.filter((call) => call[1] === "getTransaction").length, 26);
  assert.equal(fixture.calls.filter((call) => call[1] === "getTransactionReceipt").length, 26);
  assert.equal(fixture.calls.filter((call) => call[1] === "simulateContract").length, 4);
  assert.ok(fixture.calls.some((call) => call[1] === "getLogs"));
});

test("owner funding is bound as native account activity without becoming an acquisition", async () => {
  const fixture = readyFixture();
  fixture.state.configurationAccountLogs.push(eventLog(
    LIVE_APPROVAL_PREFLIGHT_ABIS.accountActivityEventAbi,
    "NativeReceived",
    { sender: OWNER, amount: 900_000_000_000_000n, state: 1n },
    {
      address: ACCOUNT,
      blockHash: hash("81"),
      blockNumber: 1_220n,
      transactionHash: hash("82"),
      transactionIndex: 0n,
      logIndex: 0n,
    },
  ));
  fixture.state.accountState = 1n;
  const result = await attest(fixture);
  assert.equal(result.status, "READ_ONLY_PASS");
  assert.equal(result.latestExecutionCheck.nonce, "0");
  assert.equal(result.latestExecutionCheck.exactState.acquisitionsToday, "0");
});

test("native funding from any address other than the current owner fails closed", async () => {
  const fixture = readyFixture();
  fixture.state.configurationAccountLogs.push(eventLog(
    LIVE_APPROVAL_PREFLIGHT_ABIS.accountActivityEventAbi,
    "NativeReceived",
    { sender: RELAYER, amount: 1n, state: 1n },
    {
      address: ACCOUNT,
      blockHash: hash("83"),
      blockNumber: 1_220n,
      transactionHash: hash("84"),
      transactionIndex: 0n,
      logIndex: 0n,
    },
  ));
  fixture.state.accountState = 1n;
  await assert.rejects(() => attest(fixture), (error) => (
    error instanceof LiveApprovalPreflightError && error.code === "UNEXPECTED_ACCOUNT_ACTIVITY"
  ));
});

test("fast-chain provider notification skew is bounded while the exact common block stays pinned", async () => {
  const bounded = readyFixture();
  bounded.state.latestHeads.primary = LATEST_BLOCK + 16n;
  const pass = await attest(bounded);
  assert.equal(pass.latestExecutionCheck.headSkew, "16");

  const excessive = readyFixture();
  excessive.state.latestHeads.primary = LATEST_BLOCK + 17n;
  await assert.rejects(() => attest(excessive), (error) => (
    error instanceof LiveApprovalPreflightError && error.code === "RPC_HEAD_SKEW"
  ));
});

test("guardian Safe receipts use logical bundle caller and exact target events", async () => {
  const fixture = readyFixture({ guardianSafe: true });
  const result = await attest(fixture);
  assert.equal(result.status, "READ_ONLY_PASS");
  const guardianTransactions = fixture.state.config.review.configurationPlan.orderedCalls
    .map((call, index) => ({ call, tx: fixture.state.transactions.get(
      fixture.state.evidence.evidence.transactions[index].hash,
    ) }))
    .filter(({ call }) => call.role === "GUARDIAN");
  assert.equal(guardianTransactions.length, 2);
  for (const { tx } of guardianTransactions) {
    assert.equal(tx.to, GUARDIAN);
    assert.equal(tx.from, RELAYER);
  }
});

test("current NOT_DEPLOYED manifest fails before any chain read", async () => {
  const fixture = readyFixture();
  fixture.state.core.status = "NOT_DEPLOYED";
  await assert.rejects(() => attest(fixture), (error) => (
    error instanceof LiveApprovalPreflightError && error.code === "NOT_DEPLOYED"
  ));
  assert.deepEqual(fixture.calls, []);
});

test("receipt, interval, owner, adapter, latest-state, and EOA violations fail closed", async () => {
  const cases = [
    ["hand-flipped core verification", (f) => {
      f.state.core.sourceVerificationAdoption = null;
    }, "INVALID_SOURCE_VERIFICATION_ADOPTION"],
    ["chain disagreement", (f) => { f.state.chainIds.secondary = 1; }, "RPC_DISAGREEMENT"],
    ["owner is a contract", (f) => { f.state.codes[OWNER] = "0x6001"; },
      "SMART_CONTRACT_OWNER_UNSUPPORTED"],
    ["account runtime changed", (f) => { f.state.codes[ACCOUNT] = "0x6099"; },
      "CODE_HASH_MISMATCH"],
    ["configuration calldata changed", (f) => {
      const first = f.state.evidence.evidence.transactions[0].hash;
      f.state.transactions.get(first).input = "0xdeadbeef";
    }, "CONFIGURATION_TRANSACTION_MISMATCH"],
    ["receipt log identity changed", (f) => {
      const first = f.state.evidence.evidence.transactions[0].hash;
      f.state.receipts.get(first).logs[0].blockHash = hash("98");
    }, "CONFIGURATION_EVENT_MISMATCH"],
    ["extra policy event", (f) => {
      f.state.extraPolicyIntervalLogs.push(eventLog(
        LIVE_APPROVAL_PREFLIGHT_ABIS.policyMutationEventAbi,
        "FeatureFlagsChanged",
        { flags: f.state.features },
        { address: f.state.core.contracts.BrokerPolicyModule.address, blockHash: hash("97"),
          blockNumber: 1_300n, transactionHash: hash("96"), transactionIndex: 0n, logIndex: 0n },
      ));
    }, "UNEXPECTED_EVENT"],
    ["ownership round trip evidence", (f) => {
      f.state.configurationOwnershipTransfers.push({ removed: false });
    }, "OWNERSHIP_CHANGED_DURING_CONFIGURATION"],
    ["post-pin mutation", (f) => {
      f.state.postPolicyLogs.push(eventLog(
        LIVE_APPROVAL_PREFLIGHT_ABIS.policyMutationEventAbi,
        "FeatureFlagsChanged",
        { flags: f.state.features },
        { address: f.state.core.contracts.BrokerPolicyModule.address, blockHash: hash("95"),
          blockNumber: 5_010n, transactionHash: hash("94"), transactionIndex: 0n, logIndex: 0n },
      ));
    }, "POST_PIN_MUTATION"],
    ["latest autonomy enabled", (f) => {
      f.state.latestFeatures = { ...f.state.features, autonomousPurchases: true };
    }, "LIVE_STATE_MISMATCH"],
    ["adapter commitment changed", (f) => { f.state.adapterRecord.versionHash = hash("93"); },
      "LIVE_STATE_MISMATCH"],
    ["prior acquisition", (f) => { f.state.acquisitionUsage.acquisitionsToday = 1; },
      "ACCOUNT_ACTIVITY_MISMATCH"],
  ];
  for (const [label, mutate, code] of cases) {
    const fixture = readyFixture();
    mutate(fixture);
    await assert.rejects(() => attest(fixture), (error) => (
      error instanceof LiveApprovalPreflightError && error.code === code
    ), label);
  }
});

test("RPC comparison ignores polluted toJSON and tuple reads ignore inherited fields", async () => {
  const disagreement = readyFixture();
  disagreement.state.chainIds.secondary = 1;
  let toJsonCalls = 0;
  Object.defineProperty(Object.prototype, "toJSON", {
    configurable: true,
    value() { toJsonCalls += 1; return "collapsed"; },
  });
  try {
    await assert.rejects(() => attest(disagreement), (error) => error.code === "RPC_DISAGREEMENT");
    assert.equal(toJsonCalls, 0);
  } finally {
    delete Object.prototype.toJSON;
  }

  Object.defineProperty(Object.prototype, "configuredBy", {
    configurable: true,
    value: OWNER,
  });
  try {
    const inherited = readyFixture();
    delete inherited.state.policy.configuredBy;
    await assert.rejects(() => attest(inherited), (error) => error.code === "LIVE_STATE_MISMATCH");
  } finally {
    delete Object.prototype.configuredBy;
  }
});

test("input Proxies are snapshotted or rejected before reads without invoking getters", async () => {
  const fixture = readyFixture();
  let reads = 0;
  fixture.state.artifact = new Proxy(fixture.state.artifact, {
    get() { reads += 1; throw new Error("must not read through Proxy"); },
  });
  await assert.rejects(() => attest(fixture), (error) => error.code === "INVALID_SCHEMA");
  assert.equal(reads, 0);
  assert.deepEqual(fixture.calls, []);
});

test("pinned reorg and final-clock expiry fail after read-only verification", async () => {
  const reorg = readyFixture();
  reorg.state.changedPinnedHash.secondary = hash("92");
  await assert.rejects(() => attest(reorg), (error) => (
    error.code === "RPC_DISAGREEMENT" || error.code === "PINNED_BLOCK_CHANGED"
  ));

  const stale = readyFixture();
  const ticks = [1_050, 1_091];
  await assert.rejects(() => attest(stale, { clock: () => ticks.shift() }), (error) => (
    error.code === "STALE_PROPOSAL" && /after simulation/.test(error.message)
  ));

  const future = readyFixture();
  future.state.latestTimestamp = 1_081n;
  await assert.rejects(() => attest(future), (error) => error.code === "INVALID_BLOCK");
});

test("live preflight source contains no signing, submission, wallet, or deployment path", async () => {
  const source = await readFile(
    new URL("../scripts/canary-approval-live-preflight.mjs", import.meta.url), "utf8",
  );
  assert.doesNotMatch(source, /createWalletClient|sendTransaction|writeContract|signTypedData/);
  assert.doesNotMatch(source, /privateKeyToAccount|mnemonicToAccount|eth_sendRawTransaction/);
  assert.doesNotMatch(source, /\bfetch\s*\(|\bdeployContract\b/);
  assert.match(source, /status: "READ_ONLY_PASS"/);
  assert.match(source, /transactionAuthorized: false/);
  assert.match(source, /submissionPerformed: false/);
  assert.equal(EMPTY_HASH,
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
});
