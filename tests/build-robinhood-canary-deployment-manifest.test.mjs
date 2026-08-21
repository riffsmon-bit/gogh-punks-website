import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeAbiParameters, getContractAddress, keccak256 } from "viem";
import { canonicalJson } from "../broker/src/scout/canonical-json.mjs";
import {
  buildRobinhoodCanaryDeploymentManifestProposal,
  CANARY_DEPLOYMENT_ORDER,
  parseCanaryManifestArguments,
  renderRobinhoodCanaryDeploymentManifestProposal,
  verifyCanaryCliSourceProvenance,
} from "../scripts/build-robinhood-canary-deployment-manifest.mjs";

const commit = "a".repeat(40);
const foundryCommit = "a".repeat(7);
const guardian = "0x1111111111111111111111111111111111111111";
const deployer = "0x2222222222222222222222222222222222222222";
const owner = "0x3333333333333333333333333333333333333333";
const account = "0x4444444444444444444444444444444444444444";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const zeroHash = `0x${"0".repeat(64)}`;
const canonicalCollection = "0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6";
const canonicalRegistry = "0x000000006551c19487814612e58FE06813775758";
const canonicalRegistryHash =
  "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
const canonicalRegistryCode = "0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063246a00211461003b5780638a54c52f1461006a575b600080fd5b61004e6100493660046101b7565b61007d565b6040516001600160a01b03909116815260200160405180910390f35b61004e6100783660046101b7565b6100e1565b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b60015284601552605560002060601b60601c60005260206000f35b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b600152846015526055600020803b61018b578560b760556000f580610157576320188a596000526004601cfd5b80606c52508284887f79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf887226060606ca46020606cf35b8060601b60601c60005260206000f35b80356001600160a01b03811681146101b257600080fd5b919050565b600080600080600060a086880312156101cf57600080fd5b6101d88661019b565b945060208601359350604086013592506101f46060870161019b565b94979396509194608001359291505056fea2646970667358221220ea2fe53af507453c64dd7c1db05549fa47a298dfb825d6d11e1689856135f16764736f6c63430008110033";
const coreNames = [
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
];
const coreAddresses = Object.fromEntries(coreNames.map((name, index) => [
  name,
  `0x${(index + 5).toString(16).repeat(40)}`,
]));
const coreCode = Object.fromEntries(coreNames.map((name, index) => [name, `0x600${index + 1}6000`]));
const canaryAddresses = {
  GoghOneShotCanaryArt: getContractAddress({ from: deployer, nonce: 10n }),
  GoghOneShotCanaryMintAdapter: getContractAddress({ from: deployer, nonce: 11n }),
};
const txHash = (index) => `0x${String(index + 1).repeat(64)}`;
const blockHash = (index) => `0x${(index + 5).toString(16).repeat(64)}`;
const creationCode = (index) => `0x600${index + 1}600052`;
const runtimeCode = (index) => `0x600${index + 1}600055`;
const template = JSON.parse(await readFile(
  new URL("../deployments/robinhood-canary.json", import.meta.url),
  "utf8",
));
const canonicalSha256 = (value) => (
  `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
);

function adoptCoreManifest(manifest) {
  const pendingManifest = structuredClone(manifest);
  for (const name of coreNames) {
    pendingManifest.contracts[name].verificationStatus = "NOT_SUBMITTED";
  }
  pendingManifest.sourceVerificationAdoption = null;
  manifest.sourceVerificationAdoption = {
    schema: "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1",
    gateSchema: "GOGH_BLOCKSCOUT_VERIFIED_MANIFEST_PROPOSAL_V1",
    gateVersion: 1,
    chainId: 4663,
    explorerOrigin: "https://robinhoodchain.blockscout.com",
    pendingProposalSha256: `0x${"1".repeat(64)}`,
    pendingManifestSha256: canonicalSha256(pendingManifest),
    pendingManifestNotes: pendingManifest.notes,
    verificationEvidenceSha256: `0x${"2".repeat(64)}`,
    verifiedContracts: [...coreNames],
    observedAt: "2026-08-21T12:00:00.000Z",
  };
  return manifest;
}

function coreConstructorArguments() {
  return {
    ArtAdapterRegistry: [guardian],
    ArtAgentRegistry: [guardian],
    BrokerPolicyModule: [guardian, coreAddresses.ArtAdapterRegistry],
    GoghPunkAccountV1: [
      coreAddresses.BrokerPolicyModule,
      coreAddresses.ArtAgentRegistry,
      coreAddresses.ArtAdapterRegistry,
    ],
    GoghPunkAccountRegistry: [coreAddresses.GoghPunkAccountV1, zeroHash],
  };
}

function coreManifest() {
  const constructorArguments = coreConstructorArguments();
  const manifest = {
    status: "DEPLOYED",
    chain: {
      name: "Robinhood Chain",
      chainId: 4663,
      rpcEnvironmentVariable: "ROBINHOOD_RPC_URL",
      explorer: "https://robinhoodchain.blockscout.com",
      nativeCurrency: "ETH",
    },
    canonicalCollection,
    canonicalERC6551Registry: canonicalRegistry,
    canonicalERC6551RegistryRuntimeCodeHash: canonicalRegistryHash,
    verifiedExternalInfrastructure: {
      seaport: {
        address: "0x0000000000000068f116a894984e2db1123eb395",
        name: "Seaport",
        compiler: "v0.8.24+commit.e11b9ed9",
        deploymentTransaction: `0x${"9".repeat(64)}`,
        deploymentBlock: 50,
        runtimeCodeHash: `0x${"8".repeat(64)}`,
        verificationStatus: "VERIFIED_READ_ONLY_SCOUT",
        executionApproved: false,
      },
    },
    accountSalt: zeroHash,
    gitCommit: commit,
    compiler: "0.8.34",
    evmVersion: "cancun",
    optimizerRuns: 500,
    contracts: Object.fromEntries(coreNames.map((name, index) => [name, {
      address: coreAddresses[name],
      deploymentTransaction: `0x${(index + 3).toString(16).repeat(64)}`,
      deploymentBlock: 100 + index,
      deployer,
      implementationVersion: "1",
      constructorArguments: constructorArguments[name],
      creationBytecodeHash: keccak256(`0x600${index + 5}`),
      runtimeBytecodeHash: keccak256(coreCode[name]),
      gitCommit: commit,
      verificationStatus: "VERIFIED",
    }])),
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
    notes: "Verified fixture.",
  };
  return adoptCoreManifest(manifest);
}

function compiledArtifact(name, index) {
  const sourcePath = name === "GoghOneShotCanaryArt"
    ? "contracts/src/canary/GoghOneShotCanaryArt.sol"
    : "contracts/src/adapters/GoghOneShotCanaryMintAdapter.sol";
  return {
    abi: [],
    bytecode: { object: creationCode(index), sourceMap: "", linkReferences: {} },
    deployedBytecode: {
      object: runtimeCode(index),
      sourceMap: "",
      linkReferences: {},
      immutableReferences: {},
    },
    methodIdentifiers: {},
    rawMetadata: JSON.stringify({
      compiler: { version: "0.8.34+commit.80d5c536" },
      settings: {
        optimizer: { enabled: true, runs: 500 },
        evmVersion: "cancun",
        viaIR: true,
        metadata: { bytecodeHash: "none" },
        compilationTarget: { [sourcePath]: name },
      },
      sources: {
        [sourcePath]: { keccak256: `0x${(index + 1).toString(16).repeat(64)}` },
      },
    }),
    metadata: {},
    id: index,
  };
}

function compiledArtifacts() {
  return Object.fromEntries(CANARY_DEPLOYMENT_ORDER.map((name, index) => [
    name,
    compiledArtifact(name, index),
  ]));
}

function artifact() {
  const definitions = [
    {
      types: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
      args: [coreAddresses.GoghPunkAccountRegistry, account, 4242n, 1n],
    },
    { types: [{ type: "address" }], args: [canaryAddresses.GoghOneShotCanaryArt] },
  ];
  const transactions = CANARY_DEPLOYMENT_ORDER.map((name, index) => ({
    hash: txHash(index),
    transactionType: "CREATE",
    contractName: name,
    contractAddress: canaryAddresses[name],
    function: null,
    arguments: definitions[index].args.map((value) => typeof value === "bigint" ? value.toString() : value),
    transaction: {
      from: deployer,
      gas: "0x100000",
      value: "0x0",
      input: `${creationCode(index)}${encodeAbiParameters(
        definitions[index].types,
        definitions[index].args,
      ).slice(2)}`,
      nonce: `0x${(10 + index).toString(16)}`,
      chainId: "0x1237",
    },
    additionalContracts: [],
    isFixedGasLimit: false,
  }));
  return {
    transactions,
    receipts: CANARY_DEPLOYMENT_ORDER.map((name, index) => ({
      status: "0x1",
      logs: [],
      transactionHash: txHash(index),
      transactionIndex: `0x${(index + 1).toString(16)}`,
      blockHash: blockHash(index),
      blockNumber: `0x${(1_000 + index).toString(16)}`,
      from: deployer,
      to: null,
      contractAddress: canaryAddresses[name],
    })),
    libraries: [],
    pending: [],
    returns: {
      deployment: {
        internal_type: "struct DeployOneShotCanary.Deployment",
        value: `(${canaryAddresses.GoghOneShotCanaryArt}, ${canaryAddresses.GoghOneShotCanaryMintAdapter}, ${owner})`,
      },
    },
    timestamp: 1_800_000_000_000,
    chain: 4663,
    commit: foundryCommit,
  };
}

function zeroPolicy() {
  return {
    config: {
      mode: 0,
      maxSpendPerTransaction: 0n,
      maxSpendPerDay: 0n,
      maxSpendPerWeek: 0n,
      maxMintPrice: 0n,
      maxSecondaryPurchasePrice: 0n,
      minimumNativeReserve: 0n,
      maxAcquisitionsPerDay: 0,
      maxIntentAge: 0,
      maxSlippageBps: 0,
      requireCollectionAllowlist: false,
      allowUnknownCollections: false,
    },
    configuredBy: zeroAddress,
    version: 0,
    permissionGeneration: 0,
    accountPaused: false,
  };
}

function zeroCurrencyPolicy() {
  return {
    allowed: false,
    maxSpendPerTransaction: 0n,
    maxSpendPerDay: 0n,
    maxSpendPerWeek: 0n,
    maxMintPrice: 0n,
    maxSecondaryPurchasePrice: 0n,
  };
}

function zeroAdapterRecord() {
  return {
    kind: 0,
    active: false,
    venue: zeroAddress,
    adapterCodeHash: zeroHash,
    venueCodeHash: zeroHash,
    versionHash: zeroHash,
    metadataHash: zeroHash,
  };
}

function sourceProvenance(overrides = {}) {
  return {
    releaseGitCommit: commit,
    headCommit: commit,
    artifactResolvedCommit: commit,
    foundryArtifactCommit: foundryCommit,
    fullWorktreeClean: true,
    offlineBuildCompleted: true,
    offlineBuildCommand: ["forge", "build", "--offline", "--force"],
    ...overrides,
  };
}

function fakeClient(sourceArtifact, origin, overrides = {}) {
  const byHash = new Map(sourceArtifact.transactions.map((transaction, index) => [
    transaction.hash,
    { transaction, receipt: sourceArtifact.receipts[index], index },
  ]));
  const addressKey = (value) => value.toLowerCase();
  const coreByAddress = new Map(coreNames.map((name) => [addressKey(coreAddresses[name]), name]));
  let pinnedReads = 0;
  const base = {
    transport: { url: `${origin}/rpc?secret=redacted` },
    async getChainId() { return 4663; },
    async getBlockNumber() { return 1_100n; },
    async getBlock({ blockNumber }) {
      const number = Number(blockNumber);
      if (number === 1_080) {
        pinnedReads += 1;
        return {
          number: blockNumber,
          hash: `0x${"f".repeat(64)}`,
          timestamp: 1_800_000_000n,
          transactions: [],
        };
      }
      if (number === 999) {
        return { number: blockNumber, hash: blockHash(4), timestamp: 1_799_999_000n, transactions: [] };
      }
      if (number === 1_000 || number === 1_001) {
        const index = number - 1_000;
        return {
          number: blockNumber,
          hash: blockHash(index),
          timestamp: BigInt(1_800_000_000 + index),
          transactions: [txHash(index)],
        };
      }
      return { number: blockNumber, hash: blockHash(6), timestamp: 1_799_000_000n, transactions: [] };
    },
    async getTransactionReceipt({ hash }) {
      const receipt = structuredClone(byHash.get(hash).receipt);
      return {
        ...receipt,
        status: "success",
        transactionIndex: BigInt(receipt.transactionIndex),
        blockNumber: BigInt(receipt.blockNumber),
      };
    },
    async getTransaction({ hash }) {
      const { transaction, receipt, index } = byHash.get(hash);
      return {
        hash,
        input: transaction.transaction.input,
        from: transaction.transaction.from,
        to: null,
        value: 0n,
        chainId: 4663,
        nonce: 10 + index,
        blockNumber: BigInt(receipt.blockNumber),
        blockHash: receipt.blockHash,
        transactionIndex: BigInt(receipt.transactionIndex),
      };
    },
    async getCode({ address: target }) {
      const key = addressKey(target);
      if (key === canonicalRegistry.toLowerCase()) return canonicalRegistryCode;
      if (key === account.toLowerCase()) return "0x60006000556001";
      if (key === canaryAddresses.GoghOneShotCanaryArt.toLowerCase()) return runtimeCode(0);
      if (key === canaryAddresses.GoghOneShotCanaryMintAdapter.toLowerCase()) return runtimeCode(1);
      const name = coreByAddress.get(key);
      if (name) return coreCode[name];
      throw new Error(`unexpected code ${target}`);
    },
    async readContract({ address: target, functionName }) {
      const key = addressKey(target);
      let value;
      if (key === coreAddresses.GoghPunkAccountRegistry.toLowerCase()) {
        value = {
          GOGH_PUNKS: canonicalCollection,
          ROBINHOOD_CHAIN_ID: 4663n,
          CANONICAL_ERC6551_REGISTRY: canonicalRegistry,
          canonicalRegistry,
          implementation: coreAddresses.GoghPunkAccountV1,
          accountSalt: zeroHash,
          account,
        }[functionName];
      } else if (key === canonicalRegistry.toLowerCase()) {
        value = account;
      } else if (key === account.toLowerCase()) {
        value = {
          token: { chainId: 4663n, tokenContract: canonicalCollection, tokenId: 4242n },
          isCanonicalGoghPunkAccount: true,
          owner,
          policyModule: coreAddresses.BrokerPolicyModule,
          agentRegistry: coreAddresses.ArtAgentRegistry,
          adapterRegistry: coreAddresses.ArtAdapterRegistry,
          state: 0n,
          acquisitionNonce: 0n,
        }[functionName];
      } else if (key === canonicalCollection.toLowerCase()) {
        value = owner;
      } else if (key === canaryAddresses.GoghOneShotCanaryArt.toLowerCase()) {
        value = {
          ROBINHOOD_CHAIN_ID: 4663n,
          GOGH_PUNKS: canonicalCollection,
          CANONICAL_ERC6551_REGISTRY: canonicalRegistry,
          punkAccountRegistry: coreAddresses.GoghPunkAccountRegistry,
          punkAccount: account,
          controllingPunkTokenId: 4242n,
          canaryTokenId: 1n,
          minted: false,
        }[functionName];
      } else if (key === canaryAddresses.GoghOneShotCanaryMintAdapter.toLowerCase()) {
        value = {
          canaryCollection: canaryAddresses.GoghOneShotCanaryArt,
          boundAccount: account,
          boundTokenId: 1n,
          venue: canaryAddresses.GoghOneShotCanaryArt,
          collection: canaryAddresses.GoghOneShotCanaryArt,
          mintSelector: "0x40c10f19",
          assetStandard: 0,
          kind: 1,
        }[functionName];
      } else if (key === coreAddresses.BrokerPolicyModule.toLowerCase()) {
        value = {
          featureFlags: {
            scoutMode: true,
            approvalPurchases: false,
            autonomousPurchases: false,
            autonomousMints: false,
            unknownCollectionExecution: false,
            selling: false,
            autonomousSelling: false,
          },
          globallyPaused: false,
          policy: zeroPolicy(),
          mintControls: {
            ownerApprovedMints: false,
            autonomousFreeMints: false,
            autonomousPaidMints: false,
          },
          approvedAdapters: false,
          approvedMintContracts: false,
          approvedCollections: false,
          deniedCollections: false,
          approvedSelectors: false,
          deniedSelectors: false,
          currencyPolicy: zeroCurrencyPolicy(),
          venueCurrencyMaximum: 0n,
          acquisitionUsage: { dayBucket: 1n, acquisitionsToday: 0 },
          usage: {
            dayBucket: 1n,
            weekBucket: 1n,
            acquisitionsToday: 0,
            spentToday: 0n,
            spentThisWeek: 0n,
          },
        }[functionName];
      } else if (key === coreAddresses.ArtAdapterRegistry.toLowerCase()) {
        value = functionName === "globallyPaused" ? false : zeroAdapterRecord();
      } else if (key === coreAddresses.ArtAgentRegistry.toLowerCase()) {
        value = functionName === "globallyPaused" ? false
          : functionName === "authorizationGeneration" ? 0n : false;
      }
      if (value === undefined) throw new Error(`unexpected read ${target} ${functionName}`);
      return value;
    },
    async getLogs() { return []; },
  };
  const client = { ...base };
  for (const [method, handler] of Object.entries(overrides)) {
    if (method === "pinnedReads") continue;
    const original = client[method];
    client[method] = async (args) => handler(await original.call(client, args), args, {
      pinnedReads,
      base,
    });
  }
  return client;
}

function endpoints(sourceArtifact, overrides = {}) {
  return [
    {
      provider: "primary-provider",
      origin: "https://primary.example",
      client: fakeClient(sourceArtifact, "https://primary.example", overrides.primary),
    },
    {
      provider: "secondary-provider",
      origin: "https://secondary.example",
      client: fakeClient(sourceArtifact, "https://secondary.example", overrides.secondary),
    },
  ];
}

function build(overrides = {}) {
  const sourceArtifact = overrides.artifact ?? artifact();
  return buildRobinhoodCanaryDeploymentManifestProposal({
    artifact: sourceArtifact,
    compiledArtifacts: overrides.compiledArtifacts ?? compiledArtifacts(),
    gitCommit: overrides.gitCommit ?? commit,
    coreManifest: overrides.coreManifest ?? coreManifest(),
    canaryTemplate: overrides.canaryTemplate ?? structuredClone(template),
    expectedCanary: overrides.expectedCanary ?? {
      controllingPunkTokenId: "4242",
      expectedActivatedPunkAccount: account,
      expectedOwnerAtPreparation: owner,
      canaryArtTokenId: "1",
    },
    readEndpoints: overrides.readEndpoints ?? endpoints(sourceArtifact, overrides.endpointOverrides),
    confirmations: overrides.confirmations ?? 20,
    sourceProvenance: overrides.sourceProvenance ?? sourceProvenance(),
  }, { clock: () => 1_800_001_000_000 });
}

test("emits immutable deployment/preconfiguration evidence while source verification is pending", async () => {
  const proposal = await build();
  assert.equal(proposal.proposalStatus, "CANARY_MANIFEST_PROPOSAL_SOURCE_VERIFICATION_PENDING");
  assert.equal(proposal.manifest.status, "DEPLOYED");
  assert.equal(proposal.manifest.provenanceGate.status, "VERIFIED");
  assert.equal(proposal.manifest.expectedActivatedPunkAccountRuntimeCodeHash,
    keccak256("0x60006000556001"));
  assert.equal(proposal.manifest.contracts.GoghOneShotCanaryArt.verificationStatus, "NOT_SUBMITTED");
  assert.equal(proposal.manifest.contracts.GoghOneShotCanaryMintAdapter.verificationStatus,
    "NOT_SUBMITTED");
  assert.equal(proposal.manifest.contracts.GoghOneShotCanaryMintAdapter.receiptStatus, "SUCCESS");
  assert.deepEqual(proposal.manifest.configuration, {
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
  const clean = proposal.manifest.provenanceGate.cleanPreconfigurationState;
  assert.equal(clean.blockNumber, 1_080);
  assert.equal(clean.accountState, "0");
  assert.equal(clean.acquisitionNonce, "0");
  assert.equal(clean.policy.version, 0);
  assert.equal(clean.policy.permissionGeneration, 0);
  assert.equal(clean.adapterRecord.adapterCodeHash, zeroHash);
  assert.equal(clean.permissions.adapterAllowed, false);
  assert.equal(clean.nativeUsage.spentToday, "0");
  assert.equal(clean.isolationEventScan.accountScopedPolicyMutationEvents, 0);
  assert.equal(clean.isolationEventScan.featureFlagChangeEvents, 0);
  assert.equal(clean.agentAuthorizationEventScan.authorizedEvents, 0);
  assert.equal(clean.agentAuthorizationEventScan.revokedEvents, 0);
  assert.equal(clean.agentAuthorizationEventScan.allAgentsRevokedEvents, 0);
  const unhashed = structuredClone(clean);
  delete unhashed.evidenceHash;
  assert.equal(clean.evidenceHash,
    `0x${createHash("sha256").update(canonicalJson(unhashed)).digest("hex")}`);
  assert.match(proposal.manifest.provenanceGate.verifiedAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(proposal.trustBindings.transactionCapability, "NONE_READ_ONLY_PROPOSAL");
  assert.deepEqual(JSON.parse(renderRobinhoodCanaryDeploymentManifestProposal(proposal)), proposal);
});

test("rejects ambiguous, reordered, or constructor-divergent Foundry broadcasts", async (t) => {
  await t.test("extra transaction", async () => {
    const source = artifact();
    source.transactions.push(structuredClone(source.transactions[1]));
    await assert.rejects(build({ artifact: source }), /exactly two transactions/);
  });
  await t.test("wrong contract order", async () => {
    const source = artifact();
    [source.transactions[0], source.transactions[1]] = [source.transactions[1], source.transactions[0]];
    await assert.rejects(build({ artifact: source }), /canonical GoghOneShotCanaryArt creation/);
  });
  await t.test("nonconsecutive nonce", async () => {
    const source = artifact();
    source.transactions[1].transaction.nonce = "0xc";
    await assert.rejects(build({ artifact: source }), /nonces must be consecutive/);
  });
  await t.test("wrong CREATE address", async () => {
    const source = artifact();
    source.transactions[0].contractAddress = account;
    await assert.rejects(build({ artifact: source }), /CREATE address/);
  });
  await t.test("wrong Punk constructor binding", async () => {
    const source = artifact();
    source.transactions[0].arguments[2] = "1798";
    await assert.rejects(build({ artifact: source }), /argument 2 is wrong/);
  });
  await t.test("compiled initcode mismatch", async () => {
    const source = artifact();
    source.transactions[0].transaction.input = "0x60006000";
    await assert.rejects(build({ artifact: source }), /compiled code plus args/);
  });
  await t.test("return owner mismatch", async () => {
    const source = artifact();
    source.returns.deployment.value = `(${canaryAddresses.GoghOneShotCanaryArt}, ${canaryAddresses.GoghOneShotCanaryMintAdapter}, ${guardian})`;
    await assert.rejects(build({ artifact: source }), /returned current owner/);
  });
  await t.test("receipt order mismatch", async () => {
    const source = artifact();
    source.receipts[1].blockNumber = source.receipts[0].blockNumber;
    source.receipts[1].transactionIndex = source.receipts[0].transactionIndex;
    await assert.rejects(build({ artifact: source }), /ordered after canary art/);
  });
});

test("binds clean compiler artifacts, live CREATE transactions, receipts, and block inclusion", async (t) => {
  await t.test("wrong compiler settings", async () => {
    const compiled = compiledArtifacts();
    const metadata = JSON.parse(compiled.GoghOneShotCanaryArt.rawMetadata);
    metadata.settings.viaIR = false;
    compiled.GoghOneShotCanaryArt.rawMetadata = JSON.stringify(metadata);
    await assert.rejects(build({ compiledArtifacts: compiled }), /canonical release settings/);
  });
  await t.test("live runtime mismatch", async () => {
    await assert.rejects(build({ endpointOverrides: {
      secondary: {
        getCode: (value, args) => args.address.toLowerCase()
          === canaryAddresses.GoghOneShotCanaryMintAdapter.toLowerCase() ? "0x60006000" : value,
      },
    } }), /runtime differs from clean compiled output/);
  });
  await t.test("failed live receipt", async () => {
    await assert.rejects(build({ endpointOverrides: {
      primary: {
        getTransactionReceipt: (value, args) => args.hash === txHash(0)
          ? { ...value, status: "reverted" }
          : value,
      },
    } }), /not successful/);
  });
  await t.test("live calldata mismatch", async () => {
    await assert.rejects(build({ endpointOverrides: {
      primary: {
        getTransaction: (value, args) => args.hash === txHash(1)
          ? { ...value, input: "0x60006000" }
          : value,
      },
    } }), /live transaction differs/);
  });
  await t.test("transaction absent from deployment block", async () => {
    await assert.rejects(build({ endpointOverrides: {
      secondary: {
        getBlock: (value, args) => Number(args.blockNumber) === 1_001
          ? { ...value, transactions: [] }
          : value,
      },
    } }), /absent from its block/);
  });
});

test("requires authoritative verified core release and full clean-tree provenance", async (t) => {
  await t.test("unverified core contract", async () => {
    const core = coreManifest();
    core.contracts.GoghPunkAccountV1.verificationStatus = "NOT_SUBMITTED";
    await assert.rejects(build({ coreManifest: core }), /is not VERIFIED/);
  });
  await t.test("core commit mismatch", async () => {
    await assert.rejects(build({ gitCommit: "b".repeat(40) }), /equal authoritative core commit/);
  });
  await t.test("dirty source provenance", async () => {
    await assert.rejects(build({
      sourceProvenance: sourceProvenance({ fullWorktreeClean: false }),
    }), /clean full-tree offline release provenance/);
  });
  await t.test("live core runtime mismatch", async () => {
    await assert.rejects(build({ endpointOverrides: {
      primary: {
        getCode: (value, args) => args.address.toLowerCase()
          === coreAddresses.GoghPunkAccountRegistry.toLowerCase() ? "0x60006000" : value,
      },
    } }), /runtime hash differs from authoritative evidence/);
  });
  await t.test("canonical registry pin mismatch", async () => {
    await assert.rejects(build({ endpointOverrides: {
      secondary: {
        getCode: (value, args) => args.address.toLowerCase() === canonicalRegistry.toLowerCase()
          ? "0x60006000"
          : value,
      },
    } }), /canonical ERC-6551 registry runtime hash/);
  });
});

test("requires two distinct RPC clients to agree on one stable confirmed block", async (t) => {
  await t.test("same origin", async () => {
    const source = artifact();
    const reads = endpoints(source);
    reads[1].origin = reads[0].origin;
    await assert.rejects(build({ artifact: source, readEndpoints: reads }), /origins must differ/);
  });
  await t.test("same provider label", async () => {
    const source = artifact();
    const reads = endpoints(source);
    reads[1].provider = reads[0].provider;
    await assert.rejects(build({ artifact: source, readEndpoints: reads }), /provider labels must differ/);
  });
  await t.test("wrong chain", async () => {
    await assert.rejects(build({ endpointOverrides: {
      primary: { getChainId: () => 1 },
    } }), /not chain 4663/);
  });
  await t.test("confirmed hash disagreement", async () => {
    await assert.rejects(build({ endpointOverrides: {
      secondary: {
        getBlock: (value, args) => Number(args.blockNumber) === 1_080
          ? { ...value, hash: `0x${"e".repeat(64)}` }
          : value,
      },
    } }), /common confirmed block/);
  });
  await t.test("closing reorg", async () => {
    await assert.rejects(build({ endpointOverrides: {
      secondary: {
        getBlock: (value, args, context) => Number(args.blockNumber) === 1_080
          && context.pinnedReads > 1
          ? { ...value, hash: `0x${"d".repeat(64)}` }
          : value,
      },
    } }), /confirmed block changed/);
  });
  await t.test("fewer than twenty confirmations", async () => {
    await assert.rejects(build({ confirmations: 19 }), /confirmations must be 20-256/);
  });
});

test("fails closed on canonical account, owner, art, or adapter binding drift", async (t) => {
  const cases = [
    ["account derivation", "account", (value) => guardian, /facade-derived Punk Account/],
    ["current owner", "ownerOf", (value) => guardian, /canonical Punk current owner/],
    ["account footer", "token", (value) => ({ ...value, tokenId: 1798n }), /footer token ID/],
    ["art already minted", "minted", () => true, /canary art minted state/],
    ["adapter account", "boundAccount", () => guardian, /adapter bound account/],
    ["adapter selector", "mintSelector", () => "0xdeadbeef", /mint selector is wrong/],
  ];
  for (const [label, targetFunction, mutate, pattern] of cases) {
    await t.test(label, async () => {
      const override = {
        readContract: (value, args) => args.functionName === targetFunction ? mutate(value) : value,
      };
      await assert.rejects(build({ endpointOverrides: {
        primary: override,
        secondary: override,
      } }), pattern);
    });
  }
});

test("requires a truly clean one-Punk preconfiguration snapshot", async (t) => {
  const dirtyReadCases = [
    ["account state", "state", () => 1n, /account state must be 0/],
    ["acquisition nonce", "acquisitionNonce", () => 1n, /acquisition nonce must be 0/],
    ["policy version", "policy", (value) => ({ ...value, version: 1 }), /policy.version must be 0/],
    ["permission generation", "policy", (value) => ({ ...value, permissionGeneration: 1 }),
      /policy.permissionGeneration must be 0/],
    ["mint control", "mintControls", (value) => ({ ...value, ownerApprovedMints: true }),
      /ownerApprovedMints must be false/],
    ["adapter registered", "adapterRecord", (value) => ({ ...value, active: true,
      adapterCodeHash: `0x${"1".repeat(64)}` }), /adapterRecord.active must be false/],
    ["selected permission", "approvedAdapters", () => true, /canary adapter permission must be false/],
    ["global approval", "featureFlags", (value) => ({ ...value, approvalPurchases: true }),
      /approvalPurchases must be false/],
    ["prior usage", "usage", (value) => ({ ...value, spentToday: 1n }),
      /nativeUsage.spentToday must be 0/],
  ];
  for (const [label, targetFunction, mutate, pattern] of dirtyReadCases) {
    await t.test(label, async () => {
      const override = {
        readContract: (value, args) => args.functionName === targetFunction ? mutate(value) : value,
      };
      await assert.rejects(build({ endpointOverrides: {
        primary: override,
        secondary: override,
      } }), pattern);
    });
  }
  await t.test("prior account-scoped policy mutation anywhere", async () => {
    const override = {
      getLogs: (value, args) => args.event?.name === "PolicyConfigured" ? [{}] : value,
    };
    await assert.rejects(build({ endpointOverrides: {
      primary: override,
      secondary: override,
    } }), /prior policy or feature mutations exist/);
  });
  await t.test("prior feature flag mutation", async () => {
    const override = {
      getLogs: (value, args) => args.event?.name === "FeatureFlagsChanged" ? [{}] : value,
    };
    await assert.rejects(build({ endpointOverrides: {
      primary: override,
      secondary: override,
    } }), /prior policy or feature mutations exist/);
  });
  await t.test("any prior account agent authorization history", async () => {
    const log = {
      args: { account, agent: guardian, owner },
      blockNumber: 500n,
      blockHash: blockHash(7),
      transactionHash: `0x${"7".repeat(64)}`,
      logIndex: 0,
    };
    const override = {
      getLogs: (value, args) => args.event?.name === "AgentAuthorized" ? [log] : value,
      readContract: (value, args) => args.functionName === "isAuthorized" ? true : value,
    };
    await assert.rejects(build({ endpointOverrides: {
      primary: override,
      secondary: override,
    } }), /prior agent authorization\/revocation history/);
  });
  for (const eventName of ["AgentRevoked", "AllAgentsRevoked"]) {
    await t.test(`prior ${eventName} history`, async () => {
      const override = {
        getLogs: (value, args) => args.event?.name === eventName ? [{}] : value,
      };
      await assert.rejects(build({ endpointOverrides: {
        primary: override,
        secondary: override,
      } }), /prior agent authorization\/revocation history/);
    });
  }
});

test("CLI provenance checks the entire worktree before and after the offline rebuild", async () => {
  const commands = [];
  const result = await verifyCanaryCliSourceProvenance({
    releaseGitCommit: commit,
    foundryArtifactCommit: foundryCommit,
    runProgram: async (executable, args) => {
      commands.push([executable, ...args]);
      if (executable === "forge") return { stdout: "" };
      if (args[0] === "status") return { stdout: "" };
      return { stdout: `${commit}\n` };
    },
  });
  assert.equal(result.fullWorktreeClean, true);
  assert.equal(commands.filter(([executable]) => executable === "forge").length, 1);
  const statusCommands = commands.filter(([, command]) => command === "status");
  assert.equal(statusCommands.length, 2);
  assert.deepEqual(statusCommands[0], ["git", "status", "--porcelain=v1", "--untracked-files=all"]);

  await assert.rejects(verifyCanaryCliSourceProvenance({
    releaseGitCommit: commit,
    foundryArtifactCommit: foundryCommit,
    runProgram: async (executable, args) => {
      if (executable === "forge") return { stdout: "" };
      if (args[0] === "status") return { stdout: " M README.md\n" };
      return { stdout: `${commit}\n` };
    },
  }), /full release worktree must be clean/);
});

test("CLI arguments require every independent human binding and reject duplicates", () => {
  const parsed = parseCanaryManifestArguments([
    "--artifact", "broadcast/DeployOneShotCanary.s.sol/4663/run-latest.json",
    "--git-commit", commit,
    "--punk-token-id", "4242",
    "--expected-account", account,
    "--expected-owner", owner,
    "--canary-art-token-id", "1",
  ]);
  assert.equal(parsed["--punk-token-id"], "4242");
  assert.throws(() => parseCanaryManifestArguments([
    "--artifact", "x.json", "--artifact", "y.json",
  ]), /supplied twice/);
  assert.throws(() => parseCanaryManifestArguments([
    "--artifact", "x.json",
  ]), /--git-commit is required/);
});
