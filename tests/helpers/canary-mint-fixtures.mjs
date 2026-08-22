import { readFile } from "node:fs/promises";
import { keccak256 } from "viem";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { buildCanaryConfigurationReceiptEvidence } from
  "../../broker/src/recommendation/canary-configuration-receipt-evidence.mjs";
import { buildCanaryExecutionReceiptEvidence } from
  "../../broker/src/recommendation/canary-execution-receipt-evidence.mjs";
import {
  buildOwnerDirectFreeMintExecutionArtifact,
  canonicalSha256,
  ONE_SHOT_MINT_SELECTOR,
} from "../../broker/src/recommendation/owner-direct-free-mint-execution.mjs";
import { buildOwnerReviewFreeMintProposal } from
  "../../broker/src/recommendation/owner-approved-free-mint-proposal.mjs";
import { sourceVerificationCanonicalSha256 } from
  "../../broker/src/recommendation/source-verification-adoption.mjs";
import { buildOwnerDirectCanaryConfigBundle } from
  "../../scripts/build-owner-direct-canary-config-bundle.mjs";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const fixtureHash = (byte) => `0x${byte.repeat(64)}`;
export const fixtureAddress = (digit) => `0x${digit.repeat(40)}`;
export const COMMIT = "a".repeat(40);
export const OWNER = fixtureAddress("1");
export const ACCOUNT = fixtureAddress("2");
export const ART = fixtureAddress("3");
export const ADAPTER = fixtureAddress("4");
export const GUARDIAN = fixtureAddress("5");
export const DEPLOYER = fixtureAddress("6");
export const ART_CODE = "0x600c";
export const ADAPTER_CODE = "0x600d";
export const ACCOUNT_CODE = "0x600e";
export const ART_HASH = keccak256(ART_CODE);
export const ADAPTER_HASH = keccak256(ADAPTER_CODE);
export const ACCOUNT_HASH = keccak256(ACCOUNT_CODE);
export const CORE_CODES = Object.freeze([
  "0x6007", "0x6008", "0x6009", "0x600a", "0x600b",
]);
export const CANONICAL_REGISTRY_CODE = "0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063246a00211461003b5780638a54c52f1461006a575b600080fd5b61004e6100493660046101b7565b61007d565b6040516001600160a01b03909116815260200160405180910390f35b61004e6100783660046101b7565b6100e1565b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b60015284601552605560002060601b60601c60005260206000f35b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b600152846015526055600020803b61018b578560b760556000f580610157576320188a596000526004601cfd5b80606c52508284887f79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf887226060606ca46020606cf35b8060601b60601c60005260206000f35b80356001600160a01b03811681146101b257600080fd5b919050565b600080600080600060a086880312156101cf57600080fd5b6101d88661019b565b945060208601359350604086013592506101f46060870161019b565b94979396509194608001359291505056fea2646970667358221220ea2fe53af507453c64dd7c1db05549fa47a298dfb825d6d11e1689856135f16764736f6c63430008110033";
export const PUNK_TOKEN_ID = "4242";
export const ART_TOKEN_ID = "9001";
export const MINT_TX_HASH = fixtureHash("9");
export const RECEIPT_BLOCK_NUMBER = 5_005n;
export const RECEIPT_BLOCK_HASH = fixtureHash("6");
export const PARENT_BLOCK_HASH = fixtureHash("5");
export const RECEIPT_TIMESTAMP = 1_080n;
export const TRANSACTION_INDEX = 3n;
export const CORE_CONTRACT_NAMES = Object.freeze([
  "ArtAdapterRegistry", "ArtAgentRegistry", "BrokerPolicyModule",
  "GoghPunkAccountV1", "GoghPunkAccountRegistry",
]);
export const CANARY_CONTRACT_NAMES = Object.freeze([
  "GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter",
]);

const coreTemplate = JSON.parse(await readFile(
  new URL("../../deployments/robinhood.json", import.meta.url), "utf8",
));
const canaryTemplate = JSON.parse(await readFile(
  new URL("../../deployments/robinhood-canary.json", import.meta.url), "utf8",
));

function adoption(verifiedContracts, pendingNibble, evidenceNibble, pendingManifest) {
  return {
    schema: "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1",
    gateSchema: "GOGH_BLOCKSCOUT_VERIFIED_MANIFEST_PROPOSAL_V1",
    gateVersion: 1,
    chainId: 4663,
    explorerOrigin: "https://robinhoodchain.blockscout.com",
    pendingProposalSha256: fixtureHash(pendingNibble),
    pendingManifestSha256: canonicalSha256(pendingManifest),
    pendingManifestNotes: pendingManifest.notes,
    verificationEvidenceSha256: fixtureHash(evidenceNibble),
    verifiedContracts: [...verifiedContracts],
    observedAt: "2026-08-20T15:58:00.000Z",
  };
}

function adoptManifest(manifest, names, pendingNibble, evidenceNibble) {
  const pending = structuredClone(manifest);
  for (const name of names) pending.contracts[name].verificationStatus = "NOT_SUBMITTED";
  pending.sourceVerificationAdoption = null;
  manifest.sourceVerificationAdoption = adoption(names, pendingNibble, evidenceNibble, pending);
  return manifest;
}

function deployedCoreManifest() {
  const manifest = structuredClone(coreTemplate);
  manifest.status = "DEPLOYED";
  manifest.gitCommit = COMMIT;
  manifest.protocolGuardian = GUARDIAN;
  const digits = ["7", "8", "9", "a", "b"];
  // Never derive fixture code/address assignments from manifest JSON key order. Authoritative
  // manifests are rewritten canonically at adoption time and their object key order is not an ABI
  // or deployment-order commitment.
  CORE_CONTRACT_NAMES.forEach((name, index) => {
    const record = manifest.contracts[name];
    record.address = fixtureAddress(digits[index]);
    record.deploymentTransaction = fixtureHash(String(index + 1));
    record.deploymentBlock = 1_000 + index;
    record.deployer = DEPLOYER;
    record.constructorArguments = [];
    record.creationBytecodeHash = fixtureHash(String(index + 2));
    record.runtimeBytecodeHash = keccak256(CORE_CODES[index]);
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
  return adoptManifest(manifest, CORE_CONTRACT_NAMES, "c", "d");
}

function proposalArtifact() {
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
    opportunityId: fixtureHash("1"),
    reasoningHash: fixtureHash("2"),
    adapterCodeHash: ADAPTER_HASH,
  }, { nowSeconds: 1_000 });
}

function ownerObservation(blockNumber, blockHash, blockTimestamp) {
  return { expectedOwner: OWNER, observedOwner: OWNER, blockNumber, blockHash, blockTimestamp };
}

function cleanState(core) {
  const isolation = {
    fromBlock: core.contracts.BrokerPolicyModule.deploymentBlock,
    toBlock: 1_120,
    accountScopedPolicyMutationEvents: 0,
    featureFlagChangeEvents: 0,
    passed: true,
  };
  isolation.evidenceHash = canonicalSha256(isolation);
  const agents = {
    fromBlock: core.contracts.ArtAgentRegistry.deploymentBlock,
    toBlock: 1_120,
    authorizedEvents: 0,
    revokedEvents: 0,
    allAgentsRevokedEvents: 0,
    passed: true,
  };
  agents.evidenceHash = canonicalSha256(agents);
  const clean = {
    blockNumber: 1_120,
    blockHash: fixtureHash("a"),
    blockTimestamp: "2026-08-20T16:00:00.000Z",
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
    mintControls: { ownerApprovedMints: false, autonomousFreeMints: false,
      autonomousPaidMints: false },
    adapterRecord: { kind: 0, active: false, venue: ZERO_ADDRESS,
      adapterCodeHash: ZERO_ADDRESS.replace("0x", `0x${"0".repeat(24)}`),
      venueCodeHash: `0x${"0".repeat(64)}`, versionHash: `0x${"0".repeat(64)}`,
      metadataHash: `0x${"0".repeat(64)}` },
    permissions: {
      adapterAllowed: false, mintContractAllowed: false, collectionAllowed: false,
      collectionDenied: false, selectorAllowed: false, selectorDenied: false,
      nativeCurrencyPolicy: { allowed: false, maxSpendPerTransaction: "0",
        maxSpendPerDay: "0", maxSpendPerWeek: "0", maxMintPrice: "0",
        maxSecondaryPurchasePrice: "0" }, venueCurrencyMaximum: "0",
    },
    featureFlags: { scoutMode: true, approvalPurchases: false, autonomousPurchases: false,
      autonomousMints: false, unknownCollectionExecution: false, selling: false,
      autonomousSelling: false },
    globalPauses: { policy: false, adapters: false, agents: false },
    authorizationGeneration: 0,
    activeAgents: [],
    agentAuthorizationEventScan: agents,
    acquisitionUsage: { acquisitionsToday: 0 },
    nativeUsage: { acquisitionsToday: 0, spentToday: "0", spentThisWeek: "0" },
    isolationEventScan: isolation,
  };
  return { ...clean, evidenceHash: canonicalSha256(clean) };
}

function deployedCanaryManifest(core) {
  const manifest = structuredClone(canaryTemplate);
  const registry = core.contracts.GoghPunkAccountRegistry;
  const implementation = core.contracts.GoghPunkAccountV1;
  manifest.status = "DEPLOYED";
  manifest.coreDeploymentManifestGitCommit = COMMIT;
  manifest.coreDeploymentManifestSha256 = canonicalSha256(core);
  manifest.coreGoghPunkAccountRegistry = registry.address;
  manifest.coreGoghPunkAccountRegistryRuntimeCodeHash = registry.runtimeBytecodeHash;
  manifest.coreGoghPunkAccountImplementation = implementation.address;
  manifest.coreGoghPunkAccountImplementationRuntimeCodeHash = implementation.runtimeBytecodeHash;
  manifest.controllingPunkTokenId = PUNK_TOKEN_ID;
  manifest.expectedActivatedPunkAccount = ACCOUNT;
  manifest.expectedActivatedPunkAccountRuntimeCodeHash = ACCOUNT_HASH;
  manifest.expectedOwnerAtPreparation = OWNER;
  manifest.canaryArtTokenId = ART_TOKEN_ID;
  manifest.gitCommit = COMMIT;
  Object.assign(manifest.contracts.GoghOneShotCanaryArt, {
    address: ART, deploymentTransaction: fixtureHash("a"), deploymentBlock: 1_100,
    deploymentBlockHash: fixtureHash("4"), receiptStatus: "SUCCESS", confirmationsObserved: 20,
    deployer: DEPLOYER, constructorArguments: [registry.address, ACCOUNT, PUNK_TOKEN_ID, ART_TOKEN_ID],
    creationBytecodeHash: fixtureHash("5"), runtimeBytecodeHash: ART_HASH, gitCommit: COMMIT,
    verificationStatus: "VERIFIED",
  });
  Object.assign(manifest.contracts.GoghOneShotCanaryMintAdapter, {
    address: ADAPTER, deploymentTransaction: fixtureHash("b"), deploymentBlock: 1_101,
    deploymentBlockHash: fixtureHash("7"), receiptStatus: "SUCCESS", confirmationsObserved: 20,
    deployer: DEPLOYER, constructorArguments: [ART], creationBytecodeHash: fixtureHash("9"),
    runtimeBytecodeHash: ADAPTER_HASH, gitCommit: COMMIT, verificationStatus: "VERIFIED",
  });
  Object.assign(manifest.provenanceGate, {
    status: "VERIFIED", dualRpcAgreementRequired: true,
    primaryRpcObservation: { provider: "primary", origin: "https://first-provider.example",
      chainId: 4663, headBlockNumber: 1_140, confirmedBlockNumber: 1_120,
      confirmedBlockHash: fixtureHash("a"),
      confirmedBlockTimestamp: "2026-08-20T16:00:00.000Z",
      observedAt: "2026-08-20T16:01:00.000Z", evidenceHash: fixtureHash("b") },
    secondaryRpcObservation: { provider: "secondary", origin: "https://second-provider.test",
      chainId: 4663, headBlockNumber: 1_141, confirmedBlockNumber: 1_120,
      confirmedBlockHash: fixtureHash("a"),
      confirmedBlockTimestamp: "2026-08-20T16:00:00.000Z",
      observedAt: "2026-08-20T16:01:01.000Z", evidenceHash: fixtureHash("c") },
    commonConfirmedBlockNumber: 1_120, commonConfirmedBlockHash: fixtureHash("a"),
    commonConfirmedBlockTimestamp: "2026-08-20T16:00:00.000Z",
    confirmationsRequired: 20, confirmationsObserved: 20, coreManifestHashVerified: true,
    coreRegistryRuntimeHashVerified: true, accountImplementationRuntimeHashVerified: true,
    activatedAccountRuntimeHashVerified: true, canonicalERC6551RegistryRuntimeHashVerified: true,
    accountFooterVerified: true, expectedOwnerVerified: true, constructorInputsVerified: true,
    cleanPreconfigurationState: cleanState(core), verifiedAt: "2026-08-20T16:02:00.000Z",
  });
  manifest.ownerObservations = {
    preparation: ownerObservation(1_099, fixtureHash("8"), "2026-08-20T15:59:00.000Z"),
    afterCanaryArtReceipt: ownerObservation(1_100, fixtureHash("4"), "2026-08-20T16:00:00.000Z"),
    afterCanaryAdapterReceipt: ownerObservation(1_101, fixtureHash("7"), "2026-08-20T16:00:30.000Z"),
  };
  Object.assign(manifest.configuration, {
    deploymentAuthorized: true, broadcastAttempted: true, adapterRegistered: false,
    policyConfigured: false, ownerApprovedMintsEnabled: false, agentAuthorized: false,
    approvalPurchasesEnabled: false, autonomousPurchasesEnabled: false,
    autonomousMintsEnabled: false, mintExecuted: false,
  });
  return adoptManifest(manifest, CANARY_CONTRACT_NAMES, "d", "e");
}

function liveAttestation(proposal, core, canary, config, configurationEvidence) {
  return {
    status: "READ_ONLY_PASS", readOnly: true, transactionAuthorized: false,
    signingPerformed: false, submissionPerformed: false, chainWritePerformed: false,
    executionBoundary: { path: "OWNER_DIRECT_EMPTY_SIGNATURE", ownerType: "EOA_CURRENT_OWNER_ONLY",
      simulatedCaller: OWNER, adapterData: "0x", ownerSignature: "0x", agentRelayerUsed: false },
    evidenceHashes: {
      algorithms: { artifactEvidence: "SHA256_CANONICAL_JSON_V1",
        configBundleReview: "KECCAK256_CANONICAL_JSON_V1" },
      proposal: proposal.proposalHash, proposalArtifact: canonicalSha256(proposal),
      coreManifest: canonicalSha256(core), canaryManifest: canonicalSha256(canary),
      coreSourceVerificationAdoption: sourceVerificationCanonicalSha256(core.sourceVerificationAdoption),
      canarySourceVerificationAdoption: sourceVerificationCanonicalSha256(canary.sourceVerificationAdoption),
      configBundleReview: config.bundleHash, configBundleArtifact: canonicalSha256(config),
      configurationReceiptEvidence: configurationEvidence.evidenceHash,
      configurationReceiptEvidenceArtifact: canonicalSha256(configurationEvidence),
    },
    chainId: 4663,
    pinnedBlock: { number: "5000", hash: fixtureHash("b"), timestamp: "1040", confirmations: 20 },
    punk: { tokenId: PUNK_TOKEN_ID, account: ACCOUNT, currentOwner: OWNER,
      accountRuntimeCodeHash: ACCOUNT_HASH },
    target: { adapter: ADAPTER, venue: ART, collection: ART, selector: ONE_SHOT_MINT_SELECTOR,
      adapterCodeHash: ADAPTER_HASH, venueCodeHash: ART_HASH, collectionCodeHash: ART_HASH },
    infrastructure: { canonicalERC6551Registry: ROBINHOOD.canonicalERC6551Registry,
      canonicalERC6551RegistryRuntimeCodeHash: ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash },
    sourceVerification: { status: "VERIFIED_ADOPTIONS_BOUND",
      coreAdoption: core.sourceVerificationAdoption,
      coreAdoptionSha256: sourceVerificationCanonicalSha256(core.sourceVerificationAdoption),
      canaryAdoption: canary.sourceVerificationAdoption,
      canaryAdoptionSha256: sourceVerificationCanonicalSha256(canary.sourceVerificationAdoption) },
    timing: { checkedAt: "1050", expiresAt: "1120", remainingSeconds: "70",
      minimumSubmissionMarginSeconds: 30 },
    intentDigest: proposal.proposal.eip712.intentDigest,
    configurationHistory: { status: "EXACT_13_CALL_DUAL_RPC_VERIFIED", transactionCount: 13,
      preconfigurationBlock: "1120", lastTransactionBlock: "1213",
      expectedFinalPolicyVersion: "11", expectedFinalPermissionGeneration: "1",
      expectedAcquisitionNonce: "0", noPriorCanaryActivity: true,
      noExtraRelevantMutationEvents: true,
      noOwnershipTransfersFromPreconfigurationThroughLatest: true,
      noRelevantMutationsAfterPinnedBlock: true },
    latestExecutionCheck: { status: "LATEST_COMMON_BLOCK_READ_AND_SIMULATION_PASS",
      number: "5002", hash: fixtureHash("f"), timestamp: "1045", primaryHead: "5003",
      secondaryHead: "5002", headSkew: "1", currentOwner: OWNER, ownerType: "EOA",
      nonce: "0", policyVersion: "11", permissionGeneration: "1",
      simulation: "READ_ONLY_ETH_CALL_PASS",
      exactState: { accountRuntimeCodeHash: ACCOUNT_HASH, mode: "APPROVAL_REQUIRED",
        minimumNativeReserve: "0", maxAcquisitionsPerDay: "1", maxIntentAgeSeconds: "120",
        acquisitionsToday: "0", accountPaused: false, policyPaused: false,
        adaptersPaused: false, agentsPaused: false, ownerApprovedMints: true,
        autonomousFreeMints: false, autonomousPaidMints: false, approvalPurchases: true,
        autonomousPurchases: false, autonomousMints: false, unknownCollectionExecution: false,
        selling: false, autonomousSelling: false, adapterActive: true } },
    simulation: "READ_ONLY_ETH_CALL_PASS",
  };
}

export function buildCanaryMintArtifactFixtures() {
  const proposal = structuredClone(proposalArtifact());
  const core = deployedCoreManifest();
  const canary = deployedCanaryManifest(core);
  const configBundleArtifact = buildOwnerDirectCanaryConfigBundle(core, canary);
  const nibbles = "123456789abcd";
  const configurationEvidenceArtifact = buildCanaryConfigurationReceiptEvidence({
    configBundleHash: configBundleArtifact.bundleHash,
    preconfigurationBlock: { number: canary.provenanceGate.cleanPreconfigurationState.blockNumber,
      hash: canary.provenanceGate.cleanPreconfigurationState.blockHash,
      timestamp: canary.provenanceGate.cleanPreconfigurationState.blockTimestamp },
    transactions: configBundleArtifact.review.configurationPlan.orderedCalls.map((call, index) => ({
      id: call.id, order: call.order, hash: fixtureHash(nibbles[index]),
    })),
  });
  const inputs = {
    proposalArtifact: proposal,
    liveAttestation: liveAttestation(proposal, core, canary, configBundleArtifact,
      configurationEvidenceArtifact),
    coreManifest: core,
    canaryManifest: canary,
    configBundleArtifact,
    configurationEvidenceArtifact,
  };
  const executionArtifact = buildOwnerDirectFreeMintExecutionArtifact(inputs, { nowSeconds: 1_070 });
  const executionReceiptEvidence = buildCanaryExecutionReceiptEvidence({
    executionArtifact, transactionHash: MINT_TX_HASH,
  });
  return structuredClone({ ...inputs, executionArtifact, executionReceiptEvidence });
}

export function runtimeCodeByAddress(fixtures) {
  return new Map([
    ...CORE_CONTRACT_NAMES.map((name, index) => [
      fixtures.coreManifest.contracts[name].address.toLowerCase(), CORE_CODES[index],
    ]),
    [ROBINHOOD.canonicalERC6551Registry, CANONICAL_REGISTRY_CODE],
    [ACCOUNT, ACCOUNT_CODE], [ART, ART_CODE], [ADAPTER, ADAPTER_CODE],
  ]);
}

export const EMPTY_BYTES_HASH = keccak256("0x");
