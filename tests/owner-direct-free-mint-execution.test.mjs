import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeFunctionData, keccak256 } from "viem";
import { ROBINHOOD } from "../broker/src/config.mjs";
import {
  buildOwnerDirectFreeMintExecutionArtifact,
  canonicalSha256,
  ONE_SHOT_MINT_SELECTOR,
  OWNER_DIRECT_ACQUISITION_ABI,
  OwnerDirectExecutionArtifactError,
} from "../broker/src/recommendation/owner-direct-free-mint-execution.mjs";
import { buildOwnerReviewFreeMintProposal } from
  "../broker/src/recommendation/owner-approved-free-mint-proposal.mjs";
import { buildOwnerDirectCanaryConfigBundle } from
  "../scripts/build-owner-direct-canary-config-bundle.mjs";
import { buildCanaryConfigurationReceiptEvidence } from
  "../broker/src/recommendation/canary-configuration-receipt-evidence.mjs";
import { sourceVerificationCanonicalSha256 } from
  "../broker/src/recommendation/source-verification-adoption.mjs";
import {
  AUTHORITATIVE_CANARY_MANIFEST_PATH,
  AUTHORITATIVE_CORE_MANIFEST_PATH,
  parseOwnerDirectExecutionArguments,
  renderOwnerDirectExecutionFailure,
  runOwnerDirectExecutionArtifactCli,
} from "../scripts/build-owner-direct-free-mint-execution.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const hash = (byte) => `0x${byte.repeat(64)}`;
const address = (digit) => `0x${digit.repeat(40)}`;
const COMMIT = "a".repeat(40);
const OWNER = address("1");
const ACCOUNT = address("2");
const ART = address("3");
const ADAPTER = address("4");
const GUARDIAN = address("5");
const DEPLOYER = address("6");
const ART_HASH = hash("c");
const ADAPTER_HASH = hash("d");
const ACCOUNT_HASH = hash("e");
const PUNK_TOKEN_ID = "4242";
const ART_TOKEN_ID = "9001";
const CORE_CONTRACT_NAMES = [
  "ArtAdapterRegistry", "ArtAgentRegistry", "BrokerPolicyModule",
  "GoghPunkAccountV1", "GoghPunkAccountRegistry",
];
const CANARY_CONTRACT_NAMES = [
  "GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter",
];

function sourceVerificationAdoption(
  verifiedContracts,
  pendingNibble,
  evidenceNibble,
  pendingManifest,
) {
  return {
    schema: "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1",
    gateSchema: "GOGH_BLOCKSCOUT_VERIFIED_MANIFEST_PROPOSAL_V1",
    gateVersion: 1,
    chainId: 4663,
    explorerOrigin: "https://robinhoodchain.blockscout.com",
    pendingProposalSha256: hash(pendingNibble),
    pendingManifestSha256: canonicalSha256(pendingManifest),
    pendingManifestNotes: pendingManifest.notes,
    verificationEvidenceSha256: hash(evidenceNibble),
    verifiedContracts: [...verifiedContracts],
    observedAt: "2026-08-20T15:58:00.000Z",
  };
}

function adoptManifest(manifest, verifiedContracts, pendingNibble, evidenceNibble) {
  const pendingManifest = structuredClone(manifest);
  for (const name of verifiedContracts) {
    pendingManifest.contracts[name].verificationStatus = "NOT_SUBMITTED";
  }
  pendingManifest.sourceVerificationAdoption = null;
  manifest.sourceVerificationAdoption = sourceVerificationAdoption(
    verifiedContracts,
    pendingNibble,
    evidenceNibble,
    pendingManifest,
  );
  return manifest;
}

const coreTemplate = JSON.parse(await readFile(
  new URL("../deployments/robinhood.json", import.meta.url),
  "utf8",
));
const canaryTemplate = JSON.parse(await readFile(
  new URL("../deployments/robinhood-canary.json", import.meta.url),
  "utf8",
));

function deployedCoreManifest() {
  const manifest = structuredClone(coreTemplate);
  manifest.status = "DEPLOYED";
  manifest.gitCommit = COMMIT;
  manifest.protocolGuardian = GUARDIAN;
  manifest.featureFlags.ENABLE_APPROVAL_PURCHASES = false;
  const addressDigits = ["7", "8", "9", "a", "b"];
  Object.entries(manifest.contracts).forEach(([name, record], index) => {
    record.address = address(addressDigits[index]);
    record.deploymentTransaction = hash(String(index + 1));
    record.deploymentBlock = 1_000 + index;
    record.deployer = DEPLOYER;
    record.constructorArguments = [];
    record.creationBytecodeHash = hash(String(index + 2));
    record.runtimeBytecodeHash = hash(addressDigits[index]);
    record.gitCommit = COMMIT;
    record.verificationStatus = "VERIFIED";
  });
  manifest.contracts.ArtAdapterRegistry.constructorArguments = [GUARDIAN];
  manifest.contracts.ArtAgentRegistry.constructorArguments = [GUARDIAN];
  manifest.contracts.BrokerPolicyModule.constructorArguments = [
    GUARDIAN,
    manifest.contracts.ArtAdapterRegistry.address,
  ];
  manifest.contracts.GoghPunkAccountV1.constructorArguments = [
    manifest.contracts.BrokerPolicyModule.address,
    manifest.contracts.ArtAgentRegistry.address,
    manifest.contracts.ArtAdapterRegistry.address,
  ];
  manifest.contracts.GoghPunkAccountRegistry.constructorArguments = [
    manifest.contracts.GoghPunkAccountV1.address,
    manifest.accountSalt,
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
    opportunityId: hash("1"),
    reasoningHash: hash("2"),
    adapterCodeHash: ADAPTER_HASH,
  }, { nowSeconds: 1_000 });
}

function ownerObservation(blockNumber, blockHash, blockTimestamp) {
  return {
    expectedOwner: OWNER,
    observedOwner: OWNER,
    blockNumber,
    blockHash,
    blockTimestamp,
  };
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
    blockHash: hash("a"),
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
      adapterCodeHash: `0x${"0".repeat(64)}`, venueCodeHash: `0x${"0".repeat(64)}`,
      versionHash: `0x${"0".repeat(64)}`, metadataHash: `0x${"0".repeat(64)}` },
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

function deployedCanaryManifest(core, proposal) {
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
    address: ART,
    deploymentTransaction: hash("a"),
    deploymentBlock: 1_100,
    deploymentBlockHash: hash("4"),
    receiptStatus: "SUCCESS",
    confirmationsObserved: 20,
    deployer: DEPLOYER,
    constructorArguments: [registry.address, ACCOUNT, PUNK_TOKEN_ID, ART_TOKEN_ID],
    creationBytecodeHash: hash("5"),
    runtimeBytecodeHash: ART_HASH,
    gitCommit: COMMIT,
    verificationStatus: "VERIFIED",
  });
  Object.assign(manifest.contracts.GoghOneShotCanaryMintAdapter, {
    address: ADAPTER,
    deploymentTransaction: hash("b"),
    deploymentBlock: 1_101,
    deploymentBlockHash: hash("7"),
    receiptStatus: "SUCCESS",
    confirmationsObserved: 20,
    deployer: DEPLOYER,
    constructorArguments: [ART],
    creationBytecodeHash: hash("9"),
    runtimeBytecodeHash: ADAPTER_HASH,
    gitCommit: COMMIT,
    verificationStatus: "VERIFIED",
  });
  Object.assign(manifest.provenanceGate, {
    status: "VERIFIED",
    dualRpcAgreementRequired: true,
    primaryRpcObservation: {
      provider: "primary",
      origin: "https://first-provider.example",
      chainId: 4663,
      headBlockNumber: 1_140,
      confirmedBlockNumber: 1_120,
      confirmedBlockHash: hash("a"),
      confirmedBlockTimestamp: "2026-08-20T16:00:00.000Z",
      observedAt: "2026-08-20T16:01:00.000Z",
      evidenceHash: hash("b"),
    },
    secondaryRpcObservation: {
      provider: "secondary",
      origin: "https://second-provider.test",
      chainId: 4663,
      headBlockNumber: 1_141,
      confirmedBlockNumber: 1_120,
      confirmedBlockHash: hash("a"),
      confirmedBlockTimestamp: "2026-08-20T16:00:00.000Z",
      observedAt: "2026-08-20T16:01:01.000Z",
      evidenceHash: hash("c"),
    },
    commonConfirmedBlockNumber: 1_120,
    commonConfirmedBlockHash: hash("a"),
    commonConfirmedBlockTimestamp: "2026-08-20T16:00:00.000Z",
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
    cleanPreconfigurationState: cleanState(core),
    verifiedAt: "2026-08-20T16:02:00.000Z",
  });
  manifest.sourceVerificationAdoption = null;
  manifest.ownerObservations = {
    preparation: ownerObservation(1_099, hash("8"), "2026-08-20T15:59:00.000Z"),
    afterCanaryArtReceipt:
      ownerObservation(1_100, hash("4"), "2026-08-20T16:00:00.000Z"),
    afterCanaryAdapterReceipt:
      ownerObservation(1_101, hash("7"), "2026-08-20T16:00:30.000Z"),
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
  assert.equal(proposal.proposal.intent.adapter, ADAPTER);
  return adoptManifest(manifest, CANARY_CONTRACT_NAMES, "d", "e");
}

function liveAttestation(proposal, core, canary, configBundle, configurationEvidence) {
  return {
    status: "READ_ONLY_PASS",
    readOnly: true,
    transactionAuthorized: false,
    signingPerformed: false,
    submissionPerformed: false,
    chainWritePerformed: false,
    executionBoundary: {
      path: "OWNER_DIRECT_EMPTY_SIGNATURE",
      ownerType: "EOA_CURRENT_OWNER_ONLY",
      simulatedCaller: OWNER,
      adapterData: "0x",
      ownerSignature: "0x",
      agentRelayerUsed: false,
    },
    evidenceHashes: {
      algorithms: {
        artifactEvidence: "SHA256_CANONICAL_JSON_V1",
        configBundleReview: "KECCAK256_CANONICAL_JSON_V1",
      },
      proposal: proposal.proposalHash,
      proposalArtifact: canonicalSha256(proposal),
      coreManifest: canonicalSha256(core),
      canaryManifest: canonicalSha256(canary),
      coreSourceVerificationAdoption:
        sourceVerificationCanonicalSha256(core.sourceVerificationAdoption),
      canarySourceVerificationAdoption:
        sourceVerificationCanonicalSha256(canary.sourceVerificationAdoption),
      configBundleReview: configBundle.bundleHash,
      configBundleArtifact: canonicalSha256(configBundle),
      configurationReceiptEvidence: configurationEvidence.evidenceHash,
      configurationReceiptEvidenceArtifact: canonicalSha256(configurationEvidence),
    },
    chainId: 4663,
    pinnedBlock: {
      number: "5000",
      hash: hash("b"),
      timestamp: "1040",
      confirmations: 20,
    },
    punk: {
      tokenId: PUNK_TOKEN_ID,
      account: ACCOUNT,
      currentOwner: OWNER,
      accountRuntimeCodeHash: ACCOUNT_HASH,
    },
    target: {
      adapter: ADAPTER,
      venue: ART,
      collection: ART,
      selector: ONE_SHOT_MINT_SELECTOR,
      adapterCodeHash: ADAPTER_HASH,
      venueCodeHash: ART_HASH,
      collectionCodeHash: ART_HASH,
    },
    infrastructure: {
      canonicalERC6551Registry: ROBINHOOD.canonicalERC6551Registry,
      canonicalERC6551RegistryRuntimeCodeHash:
        ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash,
    },
    sourceVerification: {
      status: "VERIFIED_ADOPTIONS_BOUND",
      coreAdoption: core.sourceVerificationAdoption,
      coreAdoptionSha256:
        sourceVerificationCanonicalSha256(core.sourceVerificationAdoption),
      canaryAdoption: canary.sourceVerificationAdoption,
      canaryAdoptionSha256:
        sourceVerificationCanonicalSha256(canary.sourceVerificationAdoption),
    },
    timing: {
      checkedAt: "1050",
      expiresAt: "1120",
      remainingSeconds: "70",
      minimumSubmissionMarginSeconds: 30,
    },
    intentDigest: proposal.proposal.eip712.intentDigest,
    configurationHistory: {
      status: "EXACT_13_CALL_DUAL_RPC_VERIFIED",
      transactionCount: 13,
      preconfigurationBlock: "1120",
      lastTransactionBlock: "1213",
      expectedFinalPolicyVersion: "11",
      expectedFinalPermissionGeneration: "1",
      expectedAcquisitionNonce: "0",
      noPriorCanaryActivity: true,
      noExtraRelevantMutationEvents: true,
      noOwnershipTransfersFromPreconfigurationThroughLatest: true,
      noRelevantMutationsAfterPinnedBlock: true,
    },
    latestExecutionCheck: {
      status: "LATEST_COMMON_BLOCK_READ_AND_SIMULATION_PASS",
      number: "5002",
      hash: hash("f"),
      timestamp: "1045",
      primaryHead: "5003",
      secondaryHead: "5002",
      headSkew: "1",
      currentOwner: OWNER,
      ownerType: "EOA",
      nonce: "0",
      policyVersion: "11",
      permissionGeneration: "1",
      simulation: "READ_ONLY_ETH_CALL_PASS",
      exactState: {
        accountRuntimeCodeHash: ACCOUNT_HASH,
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
      },
    },
    simulation: "READ_ONLY_ETH_CALL_PASS",
  };
}

function fixtures() {
  const proposal = structuredClone(proposalArtifact());
  const core = deployedCoreManifest();
  const canary = deployedCanaryManifest(core, proposal);
  const configBundleArtifact = buildOwnerDirectCanaryConfigBundle(core, canary);
  const transactionNibbles = "123456789abcd";
  const configurationEvidenceArtifact = buildCanaryConfigurationReceiptEvidence({
    configBundleHash: configBundleArtifact.bundleHash,
    preconfigurationBlock: {
      number: canary.provenanceGate.cleanPreconfigurationState.blockNumber,
      hash: canary.provenanceGate.cleanPreconfigurationState.blockHash,
      timestamp: canary.provenanceGate.cleanPreconfigurationState.blockTimestamp,
    },
    transactions: configBundleArtifact.review.configurationPlan.orderedCalls.map((call, index) => ({
      id: call.id,
      order: call.order,
      hash: hash(transactionNibbles[index]),
    })),
  });
  return {
    proposalArtifact: proposal,
    coreManifest: core,
    canaryManifest: canary,
    configBundleArtifact,
    configurationEvidenceArtifact,
    liveAttestation:
      liveAttestation(proposal, core, canary, configBundleArtifact, configurationEvidenceArtifact),
  };
}

function build(input = fixtures(), nowSeconds = 1_070) {
  return buildOwnerDirectFreeMintExecutionArtifact(input, { nowSeconds });
}

test("encodes one exact owner-direct zero-price canary mint and proves decode equality", () => {
  const artifact = build();
  assert.equal(artifact.schema, "GOGH_OWNER_DIRECT_FREE_MINT_EXECUTION_ARTIFACT_V1");
  assert.equal(artifact.status, "ENCODING_ONLY_OWNER_WALLET_REVIEW_REQUIRED");
  assert.deepEqual(artifact.transaction, {
    chainId: 4663,
    from: OWNER,
    to: ACCOUNT,
    value: "0",
    functionName: "executeApprovedAcquisition",
    functionSelector: "0x4402cb61",
    data: artifact.transaction.data,
    dataKeccak256: keccak256(artifact.transaction.data),
  });
  const decoded = decodeFunctionData({
    abi: OWNER_DIRECT_ACQUISITION_ABI,
    data: artifact.transaction.data,
  });
  assert.equal(decoded.functionName, "executeApprovedAcquisition");
  assert.equal(decoded.args[0].account.toLowerCase(), ACCOUNT);
  assert.equal(decoded.args[0].nonce, 0n);
  assert.equal(decoded.args[0].policyVersion, 11n);
  assert.equal(decoded.args[0].opportunityType, 2);
  assert.equal(decoded.args[0].assetStandard, 0);
  assert.equal(decoded.args[0].venue.toLowerCase(), ART);
  assert.equal(decoded.args[0].collection.toLowerCase(), ART);
  assert.equal(decoded.args[0].tokenId, 9001n);
  assert.equal(decoded.args[0].expectedPrice, 0n);
  assert.equal(decoded.args[0].maxPrice, 0n);
  assert.equal(decoded.args[1], "0x");
  assert.equal(decoded.args[2], "0x");
  assert.equal(artifact.reviewedAcquisition.controllingPunk.currentOwner, OWNER);
  assert.equal(artifact.reviewedAcquisition.target.mintSelector, ONE_SHOT_MINT_SELECTOR);
  assert.equal(artifact.reviewedAcquisition.payment.transactionValue, "0");
  assert.equal(artifact.reviewedAcquisition.livePolicyBinding.nonce, "0");
  assert.equal(artifact.reviewedAcquisition.livePolicyBinding.policyVersion, "11");
  assert.equal(artifact.reviewedAcquisition.timing.remainingSeconds, "50");
  assert.equal(artifact.confirmedEvidence.sourceVerification.status,
    "VERIFIED_ADOPTIONS_BOUND");
  assert.equal(artifact.confirmedEvidence.hashes.coreSourceVerificationAdoption,
    sourceVerificationCanonicalSha256(
      artifact.confirmedEvidence.sourceVerification.coreAdoption,
    ));
  assert.equal(artifact.safetyBoundary.postEncodingDecodeEqual, true);
  assert.equal(artifact.safetyBoundary.transactionAuthorized, false);
  assert.equal(artifact.safetyBoundary.signingPerformed, false);
  assert.equal(artifact.safetyBoundary.submissionPerformed, false);
  assert.equal(artifact.safetyBoundary.chainWritePerformed, false);
  assert.ok(Object.isFrozen(artifact));
});

test("binds the proposal, live attestation, both manifests, current owner, and exact target", () => {
  const mutators = [
    (value) => { value.liveAttestation.intentDigest = hash("f"); },
    (value) => { value.liveAttestation.evidenceHashes.proposalArtifact = hash("f"); },
    (value) => { value.liveAttestation.punk.currentOwner = address("9"); },
    (value) => { value.liveAttestation.target.collection = address("9"); },
    (value) => { value.liveAttestation.target.adapterCodeHash = hash("f"); },
    (value) => { value.canaryManifest.contracts.GoghOneShotCanaryArt.constructorArguments[3] = "9002"; },
    (value) => { value.canaryManifest.coreDeploymentManifestSha256 = hash("f"); },
    (value) => { value.coreManifest.accountSalt = hash("f"); },
    (value) => {
      value.coreManifest.contracts.GoghPunkAccountRegistry.constructorArguments[1] = hash("f");
    },
    (value) => { value.coreManifest.protocolGuardian = DEPLOYER; },
    (value) => { value.coreManifest.featureFlags.ENABLE_AUTONOMOUS_PURCHASES = true; },
    (value) => { value.canaryManifest.configuration.agentAuthorized = true; },
    (value) => { value.canaryManifest.provenanceGate.status = "BLOCKED"; },
    (value) => { value.coreManifest.sourceVerificationAdoption = null; },
    (value) => { value.canaryManifest.sourceVerificationAdoption.verifiedContracts.reverse(); },
    (value) => {
      value.liveAttestation.sourceVerification.coreAdoption.pendingProposalSha256 = hash("f");
      const changed = sourceVerificationCanonicalSha256(
        value.liveAttestation.sourceVerification.coreAdoption,
      );
      value.liveAttestation.sourceVerification.coreAdoptionSha256 = changed;
      value.liveAttestation.evidenceHashes.coreSourceVerificationAdoption = changed;
    },
  ];
  for (const mutate of mutators) {
    const value = fixtures();
    mutate(value);
    assert.throws(() => build(value), OwnerDirectExecutionArtifactError);
  }
});

test("recomputes proposal hashes and the complete EIP-712 digest", () => {
  const changedHash = fixtures();
  changedHash.proposalArtifact.proposal.intent.nonce = "8";
  assert.throws(() => build(changedHash), /proposal hash does not match/);

  const changedDigest = fixtures();
  changedDigest.proposalArtifact.proposal.eip712.intentDigest = hash("f");
  changedDigest.proposalArtifact.proposalHash = canonicalSha256(
    changedDigest.proposalArtifact.proposal,
  );
  changedDigest.liveAttestation.evidenceHashes.proposal = changedDigest.proposalArtifact.proposalHash;
  changedDigest.liveAttestation.evidenceHashes.proposalArtifact = canonicalSha256(
    changedDigest.proposalArtifact,
  );
  assert.throws(() => build(changedDigest), /recomputed EIP-712 intent digest does not match/);
});

test("requires the attestor final-clock margin at artifact encoding time", () => {
  assert.throws(() => build(fixtures(), 1_091), (error) => (
    error instanceof OwnerDirectExecutionArtifactError && error.code === "STALE_ATTESTATION"
  ));
  const futureDated = fixtures();
  futureDated.liveAttestation.timing.checkedAt = "1080";
  futureDated.liveAttestation.timing.remainingSeconds = "40";
  assert.throws(() => build(futureDated, 1_070), /future-dated/);
});

test("strictly rejects unknown fields, accessors, symbols, and custom prototypes", () => {
  const unknown = fixtures();
  unknown.liveAttestation.arbitraryCalldata = "0xdeadbeef";
  assert.throws(() => build(unknown), (error) => error.code === "UNKNOWN_FIELD");

  const accessor = fixtures();
  Object.defineProperty(accessor.liveAttestation, "status", {
    enumerable: true,
    get() { throw new Error("must never run"); },
  });
  assert.throws(() => build(accessor), (error) => error.code === "ACCESSOR_REJECTED");

  const symbol = fixtures();
  symbol.canaryManifest[Symbol("hidden")] = "value";
  assert.throws(() => build(symbol), (error) => error.code === "UNKNOWN_FIELD");

  const customPrototype = fixtures();
  Object.setPrototypeOf(customPrototype.proposalArtifact.proposal.intent, { inherited: true });
  assert.throws(() => build(customPrototype), (error) => error.code === "INVALID_PROTOTYPE");
});

test("the current authoritative NOT_DEPLOYED manifests block the CLI boundary", async () => {
  const value = fixtures();
  const currentCore = JSON.parse(await readFile(AUTHORITATIVE_CORE_MANIFEST_PATH, "utf8"));
  const currentCanary = JSON.parse(await readFile(AUTHORITATIVE_CANARY_MANIFEST_PATH, "utf8"));
  await assert.rejects(runOwnerDirectExecutionArtifactCli([
    "--proposal", "proposal.json",
    "--attestation", "attestation.json",
    "--config-bundle", "config-bundle.json",
    "--configuration-evidence", "configuration-evidence.json",
  ], {
    cwd: "/workspace",
    nowSeconds: 1_070,
    readJson: async (path) => {
      if (path === AUTHORITATIVE_CORE_MANIFEST_PATH) return currentCore;
      if (path === AUTHORITATIVE_CANARY_MANIFEST_PATH) return currentCanary;
      if (path.endsWith("proposal.json")) return value.proposalArtifact;
      if (path.endsWith("attestation.json")) return value.liveAttestation;
      if (path.endsWith("config-bundle.json")) return value.configBundleArtifact;
      return value.configurationEvidenceArtifact;
    },
  }), (error) => error instanceof OwnerDirectExecutionArtifactError && error.code === "NOT_DEPLOYED");
});

test("CLI accepts exactly four bound artifacts and fixed authoritative manifests", async () => {
  assert.deepEqual(parseOwnerDirectExecutionArguments([
    "--proposal", "ops/proposal.json", "--attestation", "ops/attestation.json",
    "--config-bundle", "ops/config-bundle.json",
    "--configuration-evidence", "ops/configuration-evidence.json",
  ]), {
    proposal: "ops/proposal.json",
    attestation: "ops/attestation.json",
    configBundle: "ops/config-bundle.json",
    configurationEvidence: "ops/configuration-evidence.json",
  });
  for (const argv of [
    [],
    ["--proposal", "proposal.json"],
    ["--proposal", "same.json", "--attestation", "same.json",
      "--config-bundle", "c.json", "--configuration-evidence", "e.json"],
    ["--proposal", "proposal.*.json", "--attestation", "attestation.json",
      "--config-bundle", "c.json", "--configuration-evidence", "e.json"],
    ["--proposal", "proposal.json", "--attestation", "attestation.json",
      "--config-bundle", "c.json", "--configuration-evidence", "e.json", "--to", ACCOUNT],
    ["--proposal", "proposal.json", "--attestation", "attestation.json",
      "--config-bundle", "c.json", "--configuration-evidence", "e.json", "--private-key", hash("1")],
    ["--proposal", "proposal.json", "--attestation", "attestation.json",
      "--config-bundle", "c.json", "--configuration-evidence", "e.json", "--data", "0xdeadbeef"],
  ]) assert.throws(() => parseOwnerDirectExecutionArguments(argv));

  const value = fixtures();
  const reads = [];
  const result = await runOwnerDirectExecutionArtifactCli([
    "--proposal", "inputs/proposal.json",
    "--attestation", "inputs/attestation.json",
    "--config-bundle", "inputs/config-bundle.json",
    "--configuration-evidence", "inputs/configuration-evidence.json",
  ], {
    cwd: "/workspace",
    nowSeconds: 1_070,
    readJson: async (path, maximumBytes, label) => {
      reads.push({ path, maximumBytes, label });
      if (path === AUTHORITATIVE_CORE_MANIFEST_PATH) return value.coreManifest;
      if (path === AUTHORITATIVE_CANARY_MANIFEST_PATH) return value.canaryManifest;
      if (path.endsWith("proposal.json")) return value.proposalArtifact;
      if (path.endsWith("attestation.json")) return value.liveAttestation;
      if (path.endsWith("config-bundle.json")) return value.configBundleArtifact;
      return value.configurationEvidenceArtifact;
    },
  });
  assert.equal(result.status, "ENCODING_ONLY_OWNER_WALLET_REVIEW_REQUIRED");
  assert.deepEqual(reads.map(({ path }) => path), [
    "/workspace/inputs/proposal.json",
    "/workspace/inputs/attestation.json",
    "/workspace/inputs/config-bundle.json",
    "/workspace/inputs/configuration-evidence.json",
    AUTHORITATIVE_CORE_MANIFEST_PATH,
    AUTHORITATIVE_CANARY_MANIFEST_PATH,
  ]);
});

test("failure rendering is non-authorizing and sanitized", () => {
  const secret = "https://user:secret@rpc.example/key";
  const message = renderOwnerDirectExecutionFailure(
    new OwnerDirectExecutionArtifactError("EVIDENCE_MISMATCH", secret),
  );
  assert.equal(message,
    "ENCODING_ONLY_FAIL [EVIDENCE_MISMATCH]: owner-direct execution artifact was not created\n");
  assert.equal(message.includes("secret"), false);
});

test("builder and CLI source expose no wallet, signing, RPC, submission, deployment, or write API", async () => {
  const source = await Promise.all([
    readFile(new URL(
      "../broker/src/recommendation/owner-direct-free-mint-execution.mjs",
      import.meta.url,
    ), "utf8"),
    readFile(new URL("../scripts/build-owner-direct-free-mint-execution.mjs", import.meta.url), "utf8"),
  ]).then((parts) => parts.join("\n"));
  assert.doesNotMatch(source, /createWalletClient|privateKeyToAccount|mnemonicToAccount/);
  assert.doesNotMatch(source, /sendTransaction|writeContract|signTypedData|eth_sendRawTransaction/);
  assert.doesNotMatch(source, /createPublicClient|\bhttp\(|simulateContract|deployContract/);
  assert.doesNotMatch(source, /writeFile|appendFile/);
  assert.match(source, /decodeFunctionData/);
  assert.match(source, /AUTHORITATIVE_CORE_MANIFEST_PATH/);
  assert.match(source, /AUTHORITATIVE_CANARY_MANIFEST_PATH/);
});
