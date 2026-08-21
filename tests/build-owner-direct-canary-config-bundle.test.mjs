import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { toFunctionSelector } from "viem";
import {
  buildOwnerDirectCanaryConfigBundle,
  CANARY_MINT_SELECTOR,
  CANONICAL_COLLECTION,
  CANONICAL_ERC6551_REGISTRY,
  CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH,
  OwnerDirectCanaryBundleError,
  ZERO_ADDRESS,
  ZERO_SALT,
} from "../scripts/build-owner-direct-canary-config-bundle.mjs";

const hash = (byte) => `0x${byte.repeat(32)}`;
const address = (nibble) => `0x${nibble.repeat(40)}`;
const commit = (nibble) => nibble.repeat(40);
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}
const canonicalSha256 = (value) => (
  `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
);
const guardian = address("b");
const owner = address("c");
const deployer = address("d");
const account = address("8");
const coreAddresses = {
  ArtAdapterRegistry: address("1"),
  ArtAgentRegistry: address("2"),
  BrokerPolicyModule: address("3"),
  GoghPunkAccountV1: address("4"),
  GoghPunkAccountRegistry: address("5"),
};
const canaryAddresses = {
  GoghOneShotCanaryArt: address("6"),
  GoghOneShotCanaryMintAdapter: address("7"),
};

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
    observedAt: "2026-08-20T15:58:00.000Z",
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

function coreManifest() {
  const coreCommit = commit("a");
  const constructorArguments = {
    ArtAdapterRegistry: [guardian],
    ArtAgentRegistry: [guardian],
    BrokerPolicyModule: [guardian, coreAddresses.ArtAdapterRegistry],
    GoghPunkAccountV1: [
      coreAddresses.BrokerPolicyModule,
      coreAddresses.ArtAgentRegistry,
      coreAddresses.ArtAdapterRegistry,
    ],
    GoghPunkAccountRegistry: [coreAddresses.GoghPunkAccountV1, ZERO_SALT],
  };
  const manifest = {
    status: "DEPLOYED",
    chain: {
      name: "Robinhood Chain",
      chainId: 4663,
      rpcEnvironmentVariable: "ROBINHOOD_RPC_URL",
      explorer: "https://robinhoodchain.blockscout.com",
      nativeCurrency: "ETH",
    },
    canonicalCollection: CANONICAL_COLLECTION,
    canonicalERC6551Registry: CANONICAL_ERC6551_REGISTRY,
    canonicalERC6551RegistryRuntimeCodeHash:
      CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH,
    verifiedExternalInfrastructure: {
      seaport: {
        address: "0x0000000000000068f116a894984e2db1123eb395",
        name: "Seaport",
        compiler: "v0.8.24+commit.e11b9ed9",
        deploymentTransaction: hash("91"),
        deploymentBlock: 605_917,
        runtimeCodeHash: hash("92"),
        verificationStatus: "VERIFIED_READ_ONLY_SCOUT",
        executionApproved: false,
      },
    },
    accountSalt: ZERO_SALT,
    gitCommit: coreCommit,
    compiler: "0.8.34",
    evmVersion: "cancun",
    optimizerRuns: 500,
    contracts: Object.fromEntries(Object.entries(coreAddresses).map(
      ([name, contractAddress], index) => [name, {
        address: contractAddress,
        deploymentTransaction: hash(`0${index + 1}`),
        deploymentBlock: 700_000 + index,
        deployer,
        implementationVersion: "1",
        constructorArguments: constructorArguments[name],
        creationBytecodeHash: hash(`1${index + 1}`),
        runtimeBytecodeHash: hash(`2${index + 1}`),
        gitCommit: coreCommit,
        verificationStatus: "VERIFIED",
      }],
    )),
    sourceVerificationAdoption: null,
    featureFlags: {
      ENABLE_SCOUT_MODE: true,
      ENABLE_APPROVAL_PURCHASES: false,
      ENABLE_AUTONOMOUS_PURCHASES: false,
      ENABLE_AUTONOMOUS_MINTS: false,
      ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
      ENABLE_SELLING: false,
      ENABLE_AUTONOMOUS_SELLING: false,
    },
    protocolGuardian: guardian,
    notes: "Complete fixture; no transaction authority is implied.",
  };
  return adoptManifest(manifest, Object.keys(coreAddresses), "41", "42");
}

function rpcObservation(provider, origin) {
  return {
    provider,
    origin,
    chainId: 4663,
    headBlockNumber: 800_040,
    confirmedBlockNumber: 800_010,
    confirmedBlockHash: hash("31"),
    confirmedBlockTimestamp: "2026-08-20T16:01:00.000Z",
    observedAt: "2026-08-20T16:02:00.000Z",
    evidenceHash: provider === "primary" ? hash("32") : hash("33"),
  };
}

function ownerObservation(blockNumber, byte, blockTimestamp) {
  return {
    expectedOwner: owner,
    observedOwner: owner,
    blockNumber,
    blockHash: hash(byte),
    blockTimestamp,
  };
}

function cleanPreconfigurationState(core) {
  const isolationEventScan = {
    fromBlock: core.contracts.BrokerPolicyModule.deploymentBlock,
    toBlock: 800_010,
    accountScopedPolicyMutationEvents: 0,
    featureFlagChangeEvents: 0,
    passed: true,
  };
  isolationEventScan.evidenceHash = canonicalSha256(isolationEventScan);
  const agentAuthorizationEventScan = {
    fromBlock: core.contracts.ArtAgentRegistry.deploymentBlock,
    toBlock: 800_010,
    authorizedEvents: 0,
    revokedEvents: 0,
    allAgentsRevokedEvents: 0,
    passed: true,
  };
  agentAuthorizationEventScan.evidenceHash = canonicalSha256(agentAuthorizationEventScan);
  const value = {
    blockNumber: 800_010,
    blockHash: hash("31"),
    blockTimestamp: "2026-08-20T16:01:00.000Z",
    accountState: "0",
    acquisitionNonce: "0",
    policy: {
      mode: 0,
      maxSpendPerTransaction: "0",
      maxSpendPerDay: "0",
      maxSpendPerWeek: "0",
      maxMintPrice: "0",
      maxSecondaryPurchasePrice: "0",
      minimumNativeReserve: "0",
      maxAcquisitionsPerDay: 0,
      maxIntentAge: 0,
      maxSlippageBps: 0,
      requireCollectionAllowlist: false,
      allowUnknownCollections: false,
      configuredBy: ZERO_ADDRESS,
      version: 0,
      permissionGeneration: 0,
      accountPaused: false,
    },
    mintControls: {
      ownerApprovedMints: false,
      autonomousFreeMints: false,
      autonomousPaidMints: false,
    },
    adapterRecord: {
      kind: 0,
      active: false,
      venue: ZERO_ADDRESS,
      adapterCodeHash: ZERO_SALT,
      venueCodeHash: ZERO_SALT,
      versionHash: ZERO_SALT,
      metadataHash: ZERO_SALT,
    },
    permissions: {
      adapterAllowed: false,
      mintContractAllowed: false,
      collectionAllowed: false,
      collectionDenied: false,
      selectorAllowed: false,
      selectorDenied: false,
      nativeCurrencyPolicy: {
        allowed: false,
        maxSpendPerTransaction: "0",
        maxSpendPerDay: "0",
        maxSpendPerWeek: "0",
        maxMintPrice: "0",
        maxSecondaryPurchasePrice: "0",
      },
      venueCurrencyMaximum: "0",
    },
    featureFlags: {
      scoutMode: true,
      approvalPurchases: false,
      autonomousPurchases: false,
      autonomousMints: false,
      unknownCollectionExecution: false,
      selling: false,
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
  return { ...value, evidenceHash: canonicalSha256(value) };
}

function canaryManifest(core = coreManifest()) {
  const canaryCommit = core.gitCommit;
  const manifest = {
    status: "DEPLOYED",
    chain: { ...core.chain },
    coreDeploymentManifest: "deployments/robinhood.json",
    coreDeploymentManifestStatusRequired: "DEPLOYED",
    coreDeploymentManifestGitCommit: core.gitCommit,
    coreDeploymentManifestSha256: canonicalSha256(core),
    coreGoghPunkAccountRegistry: core.contracts.GoghPunkAccountRegistry.address,
    coreGoghPunkAccountRegistryRuntimeCodeHash:
      core.contracts.GoghPunkAccountRegistry.runtimeBytecodeHash,
    coreGoghPunkAccountImplementation: core.contracts.GoghPunkAccountV1.address,
    coreGoghPunkAccountImplementationRuntimeCodeHash:
      core.contracts.GoghPunkAccountV1.runtimeBytecodeHash,
    canonicalCollection: CANONICAL_COLLECTION,
    canonicalERC6551Registry: CANONICAL_ERC6551_REGISTRY,
    canonicalERC6551RegistryRuntimeCodeHash:
      CANONICAL_ERC6551_REGISTRY_RUNTIME_CODE_HASH,
    controllingPunkTokenId: "4242",
    expectedActivatedPunkAccount: account,
    expectedActivatedPunkAccountRuntimeCodeHash: hash("42"),
    expectedOwnerAtPreparation: owner,
    canaryArtTokenId: "1",
    gitCommit: canaryCommit,
    compiler: "0.8.34",
    evmVersion: "cancun",
    optimizerRuns: 500,
    contracts: {
      GoghOneShotCanaryArt: {
        address: canaryAddresses.GoghOneShotCanaryArt,
        deploymentTransaction: hash("51"),
        deploymentBlock: 800_001,
        deploymentBlockHash: hash("52"),
        receiptStatus: "SUCCESS",
        confirmationsRequired: 20,
        confirmationsObserved: 30,
        deployer,
        constructorArguments: [
          core.contracts.GoghPunkAccountRegistry.address,
          account,
          "4242",
          "1",
        ],
        creationBytecodeHash: hash("53"),
        runtimeBytecodeHash: hash("54"),
        gitCommit: canaryCommit,
        verificationStatus: "VERIFIED",
      },
      GoghOneShotCanaryMintAdapter: {
        address: canaryAddresses.GoghOneShotCanaryMintAdapter,
        deploymentTransaction: hash("61"),
        deploymentBlock: 800_002,
        deploymentBlockHash: hash("62"),
        receiptStatus: "SUCCESS",
        confirmationsRequired: 20,
        confirmationsObserved: 29,
        deployer,
        constructorArguments: [canaryAddresses.GoghOneShotCanaryArt],
        creationBytecodeHash: hash("63"),
        runtimeBytecodeHash: hash("64"),
        gitCommit: canaryCommit,
        verificationStatus: "VERIFIED",
      },
    },
    sourceVerificationAdoption: null,
    provenanceGate: {
      status: "VERIFIED",
      dualRpcAgreementRequired: true,
      primaryRpcObservation: rpcObservation("primary", "https://primary.example"),
      secondaryRpcObservation: rpcObservation("secondary", "https://secondary.example"),
      commonConfirmedBlockNumber: 800_010,
      commonConfirmedBlockHash: hash("31"),
      commonConfirmedBlockTimestamp: "2026-08-20T16:01:00.000Z",
      confirmationsRequired: 20,
      confirmationsObserved: 28,
      coreManifestHashVerified: true,
      coreRegistryRuntimeHashVerified: true,
      accountImplementationRuntimeHashVerified: true,
      activatedAccountRuntimeHashVerified: true,
      canonicalERC6551RegistryRuntimeHashVerified: true,
      accountFooterVerified: true,
      expectedOwnerVerified: true,
      constructorInputsVerified: true,
      cleanPreconfigurationState: cleanPreconfigurationState(core),
      verifiedAt: "2026-08-20T16:03:00.000Z",
    },
    ownerObservations: {
      preparation: ownerObservation(799_999, "71", "2026-08-20T15:59:00.000Z"),
      afterCanaryArtReceipt: ownerObservation(800_001, "52", "2026-08-20T16:00:00.000Z"),
      afterCanaryAdapterReceipt:
        ownerObservation(800_002, "62", "2026-08-20T16:00:30.000Z"),
    },
    configuration: {
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
    },
    notes: "Complete deployed one-shot canary fixture before configuration.",
  };
  return adoptManifest(manifest, Object.keys(canaryAddresses), "43", "44");
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => (
    error instanceof OwnerDirectCanaryBundleError && error.code === code
  ));
}

test("authoritative NOT_DEPLOYED templates fail closed", async () => {
  const core = JSON.parse(await readFile(
    new URL("../deployments/robinhood.json", import.meta.url), "utf8",
  ));
  const canary = JSON.parse(await readFile(
    new URL("../deployments/robinhood-canary.json", import.meta.url), "utf8",
  ));
  expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canary), "NOT_DEPLOYED");
});

test("builds a deterministic review-only owner-direct configuration and teardown", () => {
  const core = coreManifest();
  const canary = canaryManifest(core);
  const first = buildOwnerDirectCanaryConfigBundle(core, canary);
  const second = buildOwnerDirectCanaryConfigBundle(structuredClone(core), structuredClone(canary));
  assert.equal(first.bundleHash, second.bundleHash);
  const alteredCanary = structuredClone(canary);
  alteredCanary.notes = "A different but still nonempty audited manifest note.";
  const altered = buildOwnerDirectCanaryConfigBundle(core, alteredCanary);
  assert.notEqual(first.bundleHash, altered.bundleHash);
  assert.equal(first.hashAlgorithm, "KECCAK256_CANONICAL_JSON_V1");
  assert.equal(first.transactionAuthorized, false);
  assert.equal(first.review.transactionAuthorized, false);
  assert.match(first.review.generatedFrom.coreManifestSha256, /^0x[0-9a-f]{64}$/);
  assert.match(first.review.generatedFrom.canaryManifestSha256, /^0x[0-9a-f]{64}$/);
  assert.match(first.review.generatedFrom.coreSourceVerificationAdoptionSha256,
    /^0x[0-9a-f]{64}$/);
  assert.match(first.review.generatedFrom.canarySourceVerificationAdoptionSha256,
    /^0x[0-9a-f]{64}$/);
  assert.equal(first.review.generatedFrom.coreSourceVerificationAdoption.schema,
    "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1");
  assert.equal(first.review.generatedFrom.canarySourceVerificationAdoption.schema,
    "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1");
  assert.deepEqual(first.review.authorization, {
    transactionAuthorized: false,
    signingPerformed: false,
    broadcastPerformed: false,
    rpcUsed: false,
    walletUsed: false,
    privateKeyUsed: false,
    deploymentPerformed: false,
    databaseUsed: false,
    agentRegistrationIncluded: false,
    agentAuthorizationIncluded: false,
    autonomousExecutionIncluded: false,
  });

  const setup = first.review.configurationPlan.orderedCalls;
  assert.equal(setup.length, 13);
  assert.deepEqual(setup.map((item) => item.order), Array.from({ length: 13 }, (_, i) => i + 1));
  assert.deepEqual(setup.slice(0, 2).map((item) => item.functionName), [
    "setAccountPaused", "configurePolicy",
  ]);
  assert.equal(setup[1].arguments[1].mode, 0);
  assert.equal(setup[10].functionName, "setFeatureFlags");
  assert.equal(setup[10].arguments[0].approvalPurchases, true);
  assert.equal(setup[11].functionName, "configurePolicy");
  assert.equal(setup[11].arguments[1].mode, 2);
  assert.equal(setup[12].functionName, "setAccountPaused");
  assert.equal(setup[12].arguments[1], false);
  assert.ok(setup.every((item) => item.transactionAuthorized === false));
  assert.ok(setup.every((item) => /^0x[0-9a-f]+$/i.test(item.calldata)));

  const teardown = first.review.teardownPlan.orderedCalls;
  assert.equal(teardown.length, 11);
  assert.equal(teardown[0].functionName, "setFeatureFlags");
  assert.equal(teardown[0].arguments[0].approvalPurchases, false);
  assert.equal(teardown[1].functionName, "setAccountPaused");
  assert.equal(teardown[1].arguments[1], true);
  assert.equal(teardown[2].functionName, "configurePolicy");
  assert.equal(teardown[2].arguments[1].mode, 0);
  assert.ok(teardown.every((item) => item.transactionAuthorized === false));
  assert.equal(first.review.teardownPlan.leavesApprovalPurchasesEnabled, false);
  assert.equal(first.review.teardownPlan.leavesAllMintControlsDisabled, true);
  assert.equal(first.review.teardownPlan.changesGlobalPolicyPause, false);
  assert.equal(first.review.teardownPlan.changesGlobalAdapterRegistryPause, false);
  assert.equal(first.review.configurationPlan.atomic, false);
  assert.equal(first.review.teardownPlan.atomic, false);
  assert.equal(first.review.configurationPlan.policyVersionTransition
    .expectedOwnerMutationCount, 11);
  assert.equal(first.review.configurationPlan.policyVersionTransition
    .expectedFinalVersion, "11");
  assert.equal(first.review.configurationPlan.policyVersionTransition
    .expectedFinalPermissionGeneration, "1");

  const emergency = first.review.emergencyGlobalContainmentPlan;
  assert.equal(emergency.ordinaryPerCanaryTeardownIncludesTheseCalls, false);
  assert.equal(emergency.blastRadius, "ALL_PUNK_ACCOUNTS_AND_ALL_REGISTERED_ADAPTERS");
  assert.equal(emergency.orderedCalls.length, 2);
  assert.deepEqual(emergency.orderedCalls.map((item) => item.functionName), [
    "setGloballyPaused", "setGloballyPaused",
  ]);
  assert.ok(emergency.orderedCalls.every((item) => item.transactionAuthorized === false));

  const transition = first.review.postConfigurationManifestTransitionChecklist;
  assert.equal(transition.authoritativeDeploymentManifestsRemainImmutable, true);
  assert.equal(transition.executionArtifactEligibleBeforeCompletion, false);
  assert.equal(transition.expectedLiveFeatureFlagsAfterConfirmedReceipts
    .ENABLE_APPROVAL_PURCHASES, true);
  assert.equal(transition.expectedFinalPolicyVersion, "11");
  assert.equal(transition.expectedFinalPermissionGeneration, "1");
  assert.equal(transition.expectedFinalAcquisitionNonce, "0");
});

test("pins exact zero-cost canary registration metadata and excludes agent authority", () => {
  const core = coreManifest();
  const result = buildOwnerDirectCanaryConfigBundle(core, canaryManifest(core));
  const commitment = result.review.adapterRegistrationCommitment;
  assert.equal(commitment.adapter, canaryAddresses.GoghOneShotCanaryMintAdapter);
  assert.equal(commitment.venue, canaryAddresses.GoghOneShotCanaryArt);
  assert.equal(commitment.collection, canaryAddresses.GoghOneShotCanaryArt);
  assert.equal(commitment.selector, undefined);
  assert.equal(commitment.metadata.selector, CANARY_MINT_SELECTOR);
  assert.equal(commitment.metadata.payment, "ZERO_NATIVE_ONLY");
  assert.match(commitment.adapterRuntimeBytecodeHash, /^0x[0-9a-f]{64}$/);
  assert.match(commitment.venueRuntimeBytecodeHash, /^0x[0-9a-f]{64}$/);
  assert.match(commitment.versionHash, /^0x[0-9a-f]{64}$/);
  assert.match(commitment.metadataHash, /^0x[0-9a-f]{64}$/);

  const everyCall = [
    ...result.review.configurationPlan.orderedCalls,
    ...result.review.teardownPlan.orderedCalls,
    ...result.review.emergencyGlobalContainmentPlan.orderedCalls,
  ];
  assert.ok(everyCall.every((item) => (
    item.to.toLowerCase() !== core.contracts.ArtAgentRegistry.address.toLowerCase()
  )));
  assert.equal(result.review.desiredConfiguration.exactPermissions.currency, ZERO_ADDRESS);
  assert.equal(result.review.desiredConfiguration.exactPermissions.ownerApprovedMints, true);
  assert.equal(result.review.desiredConfiguration.exactPermissions.autonomousFreeMints, false);
  assert.equal(result.review.desiredConfiguration.exactPermissions.autonomousPaidMints, false);
  for (const flag of [
    "ENABLE_AUTONOMOUS_PURCHASES", "ENABLE_AUTONOMOUS_MINTS",
    "ENABLE_UNKNOWN_COLLECTION_EXECUTION", "ENABLE_SELLING", "ENABLE_AUTONOMOUS_SELLING",
  ]) assert.equal(result.review.desiredConfiguration.featureFlags[flag], false);
});

test("every encoded call selector matches the current Solidity ABI signature", () => {
  const core = coreManifest();
  const result = buildOwnerDirectCanaryConfigBundle(core, canaryManifest(core));
  const signatures = {
    createAccount: "createAccount(uint256)",
    registerAdapter: "registerAdapter(address,uint8,address,bytes32,bytes32)",
    setAdapterActive: "setAdapterActive(address,bool)",
    setGloballyPaused: "setGloballyPaused(bool)",
    setFeatureFlags: "setFeatureFlags((bool,bool,bool,bool,bool,bool,bool))",
    configurePolicy:
      "configurePolicy(address,(uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint32,uint32,uint16,bool,bool))",
    setAccountPaused: "setAccountPaused(address,bool)",
    setAdapterPermission: "setAdapterPermission(address,address,bool)",
    setVenuePermission: "setVenuePermission(address,address,uint8,bool)",
    setCollectionPermission: "setCollectionPermission(address,address,bool,bool)",
    setCurrencyPolicy:
      "setCurrencyPolicy(address,address,(bool,uint256,uint256,uint256,uint256,uint256))",
    setVenueCurrencyMaximum: "setVenueCurrencyMaximum(address,address,address,uint256)",
    setSelectorPermission: "setSelectorPermission(address,bytes4,bool,bool)",
    setMintControls: "setMintControls(address,(bool,bool,bool))",
  };
  const calls = [
    result.review.activation.referenceCall,
    ...result.review.configurationPlan.orderedCalls,
    ...result.review.teardownPlan.orderedCalls,
    ...result.review.emergencyGlobalContainmentPlan.orderedCalls,
  ];
  for (const item of calls) {
    assert.equal(item.calldata.slice(0, 10), toFunctionSelector(signatures[item.functionName]),
      item.id);
  }
});

test("keeps activation separate because a deployed canary already requires an activated account", () => {
  const core = coreManifest();
  const result = buildOwnerDirectCanaryConfigBundle(core, canaryManifest(core));
  assert.equal(result.review.activation.includeInPostDeploymentConfiguration, false);
  assert.equal(result.review.activation.expectedActivatedAccount, account);
  assert.equal(result.review.activation.referenceCall.functionName, "createAccount");
  assert.deepEqual(result.review.activation.referenceCall.arguments, ["4242"]);
  assert.equal(result.review.activation.referenceCall.transactionAuthorized, false);
  assert.ok(!result.review.configurationPlan.orderedCalls.some(
    (item) => item.functionName === "createAccount",
  ));
});

test("rejects unknown manifest fields and noncanonical pins", () => {
  {
    const core = coreManifest();
    core.sourceVerificationAdoption = null;
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canaryManifest(core)),
      "INVALID_SOURCE_VERIFICATION_ADOPTION");
  }
  {
    const core = coreManifest();
    core.sourceVerificationAdoption.verifiedContracts.reverse();
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canaryManifest(core)),
      "INVALID_SOURCE_VERIFICATION_ADOPTION");
  }
  {
    const core = coreManifest();
    const canary = canaryManifest(core);
    canary.sourceVerificationAdoption.verificationEvidenceSha256 = hash("FF");
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canary),
      "INVALID_SOURCE_VERIFICATION_ADOPTION");
  }
  {
    const core = coreManifest();
    core.surprise = true;
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canaryManifest(core)),
      "INVALID_SCHEMA");
  }
  {
    const core = coreManifest();
    core.accountSalt = hash("ff");
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canaryManifest(core)),
      "NONZERO_SALT");
  }
  {
    const core = coreManifest();
    core.chain.chainId = 1;
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canaryManifest(core)),
      "WRONG_CHAIN");
  }
  {
    const core = coreManifest();
    core[Symbol("hidden")] = true;
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canaryManifest(core)),
      "UNKNOWN_FIELD");
  }
  {
    const core = coreManifest();
    Object.defineProperty(core.chain, "name", { get: () => "Robinhood Chain" });
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canaryManifest(core)),
      "INVALID_SCHEMA");
  }
});

test("rejects duplicate or ambiguous role and contract addresses", () => {
  {
    const core = coreManifest();
    const canary = canaryManifest(core);
    canary.expectedOwnerAtPreparation = guardian;
    for (const observation of Object.values(canary.ownerObservations)) {
      observation.expectedOwner = guardian;
      observation.observedOwner = guardian;
    }
    adoptManifest(canary, Object.keys(canaryAddresses), "43", "44");
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canary), "DUPLICATE_ADDRESS");
  }
  {
    const core = coreManifest();
    core.contracts.ArtAgentRegistry.address = core.contracts.ArtAdapterRegistry.address;
    core.contracts.GoghPunkAccountV1.constructorArguments[1] =
      core.contracts.ArtAdapterRegistry.address;
    adoptManifest(core, Object.keys(coreAddresses), "41", "42");
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canaryManifest(core)),
      "DUPLICATE_ADDRESS");
  }
});

test("rejects canary binding, provenance, and preconfiguration ambiguity", () => {
  {
    const core = coreManifest();
    const canary = canaryManifest(core);
    canary.contracts.GoghOneShotCanaryMintAdapter.constructorArguments[0] = address("9");
    adoptManifest(canary, Object.keys(canaryAddresses), "43", "44");
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canary), "ADDRESS_MISMATCH");
  }
  {
    const core = coreManifest();
    const canary = canaryManifest(core);
    canary.provenanceGate.secondaryRpcObservation.origin = "https://primary.example";
    adoptManifest(canary, Object.keys(canaryAddresses), "43", "44");
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canary), "RPC_NOT_INDEPENDENT");
  }
  {
    const core = coreManifest();
    const canary = canaryManifest(core);
    canary.configuration.agentAuthorized = true;
    adoptManifest(canary, Object.keys(canaryAddresses), "43", "44");
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canary),
      "AMBIGUOUS_CANARY_STATE");
  }
  {
    const core = coreManifest();
    const canary = canaryManifest(core);
    canary.configuration.adapterRegistered = true;
    adoptManifest(canary, Object.keys(canaryAddresses), "43", "44");
    expectCode(() => buildOwnerDirectCanaryConfigBundle(core, canary),
      "AMBIGUOUS_CANARY_STATE");
  }
});

test("generator source contains no RPC, wallet, signing, sending, deployment, or file-write API", async () => {
  const source = await readFile(
    new URL("../scripts/build-owner-direct-canary-config-bundle.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source,
    /\b(?:createPublicClient|createWalletClient|writeContract|sendTransaction|signMessage|signTypedData|deployContract|writeFile|appendFile|createServer)\b/);
  assert.match(source, /encodeFunctionData/);
  assert.match(source, /process\.stdout\.write/);
});
