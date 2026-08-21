import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
} from "viem";
import {
  ACTIVATION_CANONICAL_COLLECTION,
  ACTIVATION_CANONICAL_ERC6551_REGISTRY,
  ACTIVATION_REVIEW_SCHEMA,
  PUNK_ACCOUNT_ACTIVATION_ABIS,
  attestPunkAccountActivationReceipt,
  buildPunkAccountActivationReview,
  expectedPunkAccountAddress,
  expectedPunkAccountRuntime,
} from "../scripts/punk-account-activation.mjs";
import {
  parseActivationReceiptArguments,
  parseActivationReviewArguments,
  readActivationJsonFile,
  readActivationRpcEndpoints,
  runActivationReview,
  sanitizedActivationFailure,
} from "../scripts/punk-account-activation-runner.mjs";
import {
  sourceVerificationCanonicalSha256,
} from "../broker/src/recommendation/source-verification-adoption.mjs";

const canonicalRegistryCode = "0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063246a00211461003b5780638a54c52f1461006a575b600080fd5b61004e6100493660046101b7565b61007d565b6040516001600160a01b03909116815260200160405180910390f35b61004e6100783660046101b7565b6100e1565b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b60015284601552605560002060601b60601c60005260206000f35b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b600152846015526055600020803b61018b578560b760556000f580610157576320188a596000526004601cfd5b80606c52508284887f79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf887226060606ca46020606cf35b8060601b60601c60005260206000f35b80356001600160a01b03811681146101b257600080fd5b919050565b600080600080600060a086880312156101cf57600080fd5b6101d88661019b565b945060208601359350604086013592506101f46060870161019b565b94979396509194608001359291505056fea2646970667358221220ea2fe53af507453c64dd7c1db05549fa47a298dfb825d6d11e1689856135f16764736f6c63430008110033";

const names = [
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
];
const address = (prefix) => getAddress(`0x${prefix.padStart(40, "0")}`);
const guardian = address("1001");
const deployer = address("2001");
const owner = getAddress("0x1234567890123456789012345678901234567890");
const coreAddresses = Object.freeze({
  ArtAdapterRegistry: address("a001"),
  ArtAgentRegistry: address("a002"),
  BrokerPolicyModule: address("a003"),
  GoghPunkAccountV1: address("a004"),
  GoghPunkAccountRegistry: address("a005"),
});
const tokenId = 4242n;
const account = expectedPunkAccountAddress({
  implementation: coreAddresses.GoghPunkAccountV1,
  salt: `0x${"00".repeat(32)}`,
  tokenId,
});
const coreCode = Object.freeze(Object.fromEntries(names.map((name, index) => [
  name,
  `0x60${(index + 1).toString(16).padStart(2, "0")}6000f3`,
])));
const activationHash = `0x${"f1".repeat(32)}`;
const blockHash = (number) => `0x${(BigInt(number) + 10_000n).toString(16).padStart(64, "0")}`;

function manifestFixture() {
  const constructors = {
    ArtAdapterRegistry: [guardian],
    ArtAgentRegistry: [guardian],
    BrokerPolicyModule: [guardian, coreAddresses.ArtAdapterRegistry],
    GoghPunkAccountV1: [
      coreAddresses.BrokerPolicyModule,
      coreAddresses.ArtAgentRegistry,
      coreAddresses.ArtAdapterRegistry,
    ],
    GoghPunkAccountRegistry: [coreAddresses.GoghPunkAccountV1, `0x${"00".repeat(32)}`],
  };
  const pendingManifestNotes = "Pending source-verification fixture.";
  const manifest = {
    status: "DEPLOYED",
    chain: {
      name: "Robinhood Chain",
      chainId: 4663,
      rpcEnvironmentVariable: "ROBINHOOD_RPC_URL",
      explorer: "https://robinhoodchain.blockscout.com",
      nativeCurrency: "ETH",
    },
    canonicalCollection: ACTIVATION_CANONICAL_COLLECTION,
    canonicalERC6551Registry: ACTIVATION_CANONICAL_ERC6551_REGISTRY,
    canonicalERC6551RegistryRuntimeCodeHash:
      "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735",
    verifiedExternalInfrastructure: {
      seaport: {
        address: "0x0000000000000068f116a894984e2db1123eb395",
        name: "Seaport",
        compiler: "v0.8.24+commit.e11b9ed9",
        deploymentTransaction:
          "0x4320260396b5fbb69618a9b95de358a865fb6c305d5b5dda35c21452b30ee39d",
        deploymentBlock: 605917,
        runtimeCodeHash:
          "0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00",
        verificationStatus: "VERIFIED_READ_ONLY_SCOUT",
        executionApproved: false,
      },
    },
    accountSalt: `0x${"00".repeat(32)}`,
    gitCommit: "1".repeat(40),
    compiler: "0.8.34",
    evmVersion: "cancun",
    optimizerRuns: 500,
    contracts: Object.fromEntries(names.map((name, index) => [name, {
      address: coreAddresses[name],
      deploymentTransaction: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      deploymentBlock: 100 + index,
      deployer,
      implementationVersion: "1",
      constructorArguments: constructors[name],
      creationBytecodeHash: keccak256(`0x61${(index + 1).toString(16).padStart(4, "0")}`),
      runtimeBytecodeHash: keccak256(coreCode[name]),
      gitCommit: "1".repeat(40),
      verificationStatus: "VERIFIED",
    }])),
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
    sourceVerificationAdoption: {
      schema: "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1",
      gateSchema: "GOGH_BLOCKSCOUT_VERIFIED_MANIFEST_PROPOSAL_V1",
      gateVersion: 1,
      chainId: 4663,
      explorerOrigin: "https://robinhoodchain.blockscout.com",
      pendingProposalSha256: `0x${"31".repeat(32)}`,
      pendingManifestSha256: `0x${"33".repeat(32)}`,
      pendingManifestNotes,
      verificationEvidenceSha256: `0x${"32".repeat(32)}`,
      verifiedContracts: [...names],
      observedAt: "2026-08-21T12:00:00.000Z",
    },
    notes: "Source-verified fixture.",
  };
  const pending = structuredClone(manifest);
  for (const name of names) pending.contracts[name].verificationStatus = "NOT_SUBMITTED";
  pending.sourceVerificationAdoption = null;
  pending.notes = pendingManifestNotes;
  manifest.sourceVerificationAdoption.pendingManifestSha256 =
    sourceVerificationCanonicalSha256(pending);
  return manifest;
}

function eventLogs(receiptBlock = 990n) {
  const base = {
    transactionHash: activationHash,
    blockHash: blockHash(receiptBlock),
    blockNumber: receiptBlock,
    transactionIndex: 3,
    removed: false,
  };
  const createdTopics = encodeEventTopics({
    abi: [PUNK_ACCOUNT_ACTIVATION_ABIS.erc6551CreatedEvent],
    eventName: "ERC6551AccountCreated",
    args: {
      implementation: coreAddresses.GoghPunkAccountV1,
      tokenContract: ACTIVATION_CANONICAL_COLLECTION,
      tokenId,
    },
  });
  const createdData = encodeAbiParameters([
    { type: "address" }, { type: "bytes32" }, { type: "uint256" },
  ], [account, `0x${"00".repeat(32)}`, 4663n]);
  const activationTopics = encodeEventTopics({
    abi: [PUNK_ACCOUNT_ACTIVATION_ABIS.activationEvent],
    eventName: "GoghPunkAccountActivated",
    args: { account, chainId: 4663n, collection: ACTIVATION_CANONICAL_COLLECTION },
  });
  const activationData = encodeAbiParameters([
    { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint256" },
  ], [tokenId, owner, coreAddresses.GoghPunkAccountV1, 1n]);
  return [
    {
      ...base,
      address: ACTIVATION_CANONICAL_ERC6551_REGISTRY,
      data: createdData,
      topics: createdTopics,
      logIndex: 6,
    },
    {
      ...base,
      address: coreAddresses.GoghPunkAccountRegistry,
      data: activationData,
      topics: activationTopics,
      logIndex: 7,
    },
  ];
}

function fixture({ activated = false, head = 1_000n } = {}) {
  const manifest = manifestFixture();
  const runtime = expectedPunkAccountRuntime({
    implementation: coreAddresses.GoghPunkAccountV1,
    salt: manifest.accountSalt,
    tokenId,
  });
  const createData = encodeFunctionData({
    abi: PUNK_ACCOUNT_ACTIVATION_ABIS.accountRegistryAbi,
    functionName: "createAccount",
    args: [tokenId],
  });
  const activationReceipt = {
    transactionHash: activationHash,
    from: owner,
    to: coreAddresses.GoghPunkAccountRegistry,
    status: "success",
    blockNumber: 990n,
    blockHash: blockHash(990n),
    transactionIndex: 3,
    contractAddress: null,
    logs: eventLogs(),
  };
  const activationTransaction = {
    hash: activationHash,
    from: owner,
    to: coreAddresses.GoghPunkAccountRegistry,
    input: createData,
    value: 0n,
    blockNumber: 990n,
    blockHash: blockHash(990n),
    transactionIndex: 3,
    chainId: 4663,
  };
  const state = { activated, head, manifest, runtime, createData, activationReceipt,
    activationTransaction };
  const buildClient = () => ({
    async getChainId() { return 4663; },
    async getBlockNumber() { return state.head; },
    async getBlock({ blockNumber }) {
      return {
        number: blockNumber,
        hash: blockHash(blockNumber),
        timestamp: 1_700_000_000n + BigInt(blockNumber),
      };
    },
    async getCode({ address: target }) {
      const key = target.toLowerCase();
      for (const name of names) {
        if (coreAddresses[name].toLowerCase() === key) return coreCode[name];
      }
      if (ACTIVATION_CANONICAL_ERC6551_REGISTRY.toLowerCase() === key) {
        return canonicalRegistryCode;
      }
      if (ACTIVATION_CANONICAL_COLLECTION.toLowerCase() === key) return "0x60066000f3";
      if (owner.toLowerCase() === key) return undefined;
      if (account.toLowerCase() === key) return state.activated ? state.runtime : undefined;
      return undefined;
    },
    async readContract({ address: target, functionName }) {
      const key = target.toLowerCase();
      if (key === coreAddresses.GoghPunkAccountRegistry.toLowerCase()) {
        const values = {
          ROBINHOOD_CHAIN_ID: 4663n,
          GOGH_PUNKS: ACTIVATION_CANONICAL_COLLECTION,
          CANONICAL_ERC6551_REGISTRY: ACTIVATION_CANONICAL_ERC6551_REGISTRY,
          canonicalRegistry: ACTIVATION_CANONICAL_ERC6551_REGISTRY,
          implementation: coreAddresses.GoghPunkAccountV1,
          accountSalt: `0x${"00".repeat(32)}`,
          account,
          isAccountCreated: state.activated,
        };
        return values[functionName];
      }
      if (key === ACTIVATION_CANONICAL_ERC6551_REGISTRY.toLowerCase()) return account;
      if (key === ACTIVATION_CANONICAL_COLLECTION.toLowerCase()) return owner;
      if (key === coreAddresses.BrokerPolicyModule.toLowerCase()) {
        const values = {
          ROBINHOOD_CHAIN_ID: 4663n,
          GOGH_PUNKS: ACTIVATION_CANONICAL_COLLECTION,
          adapterRegistry: coreAddresses.ArtAdapterRegistry,
          owner: guardian,
          pendingOwner: "0x0000000000000000000000000000000000000000",
          globallyPaused: false,
          featureFlags: {
            scoutMode: true,
            approvalPurchases: false,
            autonomousPurchases: false,
            autonomousMints: false,
            unknownCollectionExecution: false,
            selling: false,
            autonomousSelling: false,
          },
        };
        return values[functionName];
      }
      if (key === coreAddresses.ArtAgentRegistry.toLowerCase()
        || key === coreAddresses.ArtAdapterRegistry.toLowerCase()) {
        return functionName === "owner" ? guardian
          : functionName === "pendingOwner" ? "0x0000000000000000000000000000000000000000"
            : false;
      }
      if (key === coreAddresses.GoghPunkAccountV1.toLowerCase()) {
        const values = {
          ROBINHOOD_CHAIN_ID: 4663n,
          GOGH_PUNKS: ACTIVATION_CANONICAL_COLLECTION,
          policyModule: coreAddresses.BrokerPolicyModule,
          agentRegistry: coreAddresses.ArtAgentRegistry,
          adapterRegistry: coreAddresses.ArtAdapterRegistry,
        };
        return values[functionName];
      }
      if (key === account.toLowerCase() && state.activated) {
        const values = {
          ROBINHOOD_CHAIN_ID: 4663n,
          GOGH_PUNKS: ACTIVATION_CANONICAL_COLLECTION,
          policyModule: coreAddresses.BrokerPolicyModule,
          agentRegistry: coreAddresses.ArtAgentRegistry,
          adapterRegistry: coreAddresses.ArtAdapterRegistry,
          owner,
          isCanonicalGoghPunkAccount: true,
          token: { chainId: 4663n, tokenContract: ACTIVATION_CANONICAL_COLLECTION, tokenId },
          state: 0n,
          acquisitionNonce: 0n,
        };
        return values[functionName];
      }
      throw new Error(`unhandled read ${target} ${functionName}`);
    },
    async call() {
      return {
        data: encodeFunctionResult({
          abi: PUNK_ACCOUNT_ACTIVATION_ABIS.accountRegistryAbi,
          functionName: "createAccount",
          result: account,
        }),
      };
    },
    async getTransactionReceipt({ hash }) {
      if (hash.toLowerCase() === activationHash.toLowerCase()) return state.activationReceipt;
      const match = names.find((name) => (
        state.manifest.contracts[name].deploymentTransaction.toLowerCase() === hash.toLowerCase()
      ));
      if (!match) throw new Error("unknown receipt");
      const record = state.manifest.contracts[match];
      return {
        status: "success",
        transactionHash: record.deploymentTransaction,
        blockNumber: BigInt(record.deploymentBlock),
        blockHash: blockHash(record.deploymentBlock),
        from: deployer,
        to: null,
        contractAddress: record.address,
      };
    },
    async getTransaction({ hash }) {
      if (hash.toLowerCase() !== activationHash.toLowerCase()) throw new Error("unknown tx");
      return state.activationTransaction;
    },
  });
  const primaryClient = buildClient();
  const secondaryClient = buildClient();
  return {
    state,
    manifest,
    primaryClient,
    secondaryClient,
    dependencies: {
      primaryClient,
      secondaryClient,
      endpointOrigins: ["https://primary.example", "https://secondary.example"],
    },
  };
}

async function successfulReview() {
  const item = fixture();
  const artifact = await buildPunkAccountActivationReview({
    manifest: item.manifest,
    tokenId: tokenId.toString(),
    expectedOwner: owner,
    confirmations: 20,
  }, item.dependencies);
  return { ...item, artifact };
}

test("derives the exact 173-byte ERC-6551 account runtime and token-qualified footer", () => {
  const runtime = expectedPunkAccountRuntime({
    implementation: coreAddresses.GoghPunkAccountV1,
    salt: `0x${"00".repeat(32)}`,
    tokenId,
  });
  assert.equal((runtime.length - 2) / 2, 173);
  assert.equal(runtime.slice(2, 22), "363d3d373d3d3d363d73");
  assert.equal(runtime.slice(2 + 90, 2 + 154), "0".repeat(64));
  assert.equal(runtime.slice(-64), tokenId.toString(16).padStart(64, "0"));
});

test("builds a non-authorizing owner-direct activation review after dual-RPC proof", async () => {
  const { artifact, state } = await successfulReview();
  assert.equal(artifact.review.schema, ACTIVATION_REVIEW_SCHEMA);
  assert.equal(artifact.review.punk.tokenId, tokenId.toString());
  assert.equal(artifact.review.punk.account, account);
  assert.equal(artifact.review.punk.accountCreated, false);
  assert.equal(artifact.review.transaction.from, owner);
  assert.equal(artifact.review.transaction.to, coreAddresses.GoghPunkAccountRegistry);
  assert.equal(artifact.review.transaction.value, "0");
  assert.equal(artifact.review.transaction.data, state.createData);
  assert.equal(artifact.review.accountRuntimeCommitment.expectedRuntimeByteLength, 173);
  assert.equal(artifact.review.confirmedEvidence.foundationFeatureFlagsMatched, true);
  assert.equal(artifact.review.latestSimulation.providersMatched, true);
  assert.equal(artifact.review.infrastructure.providerSeparation,
    "DISTINCT_REGISTRABLE_DOMAINS_PROVIDER_INDEPENDENCE_UNVERIFIED");
  assert.equal(artifact.transactionAuthorized, false);
  assert.equal(artifact.signingPerformed, false);
  assert.equal(artifact.submissionPerformed, false);
  assert.equal(artifact.chainWritePerformed, false);
  assert.doesNotMatch(JSON.stringify(artifact), /primary\.example|secondary\.example/);
});

test("simulates only the exact zero-value facade createAccount call from the current owner", async () => {
  const item = fixture();
  const requests = [];
  for (const client of [item.primaryClient, item.secondaryClient]) {
    const original = client.call;
    client.call = async (request) => {
      requests.push(request);
      return original(request);
    };
  }
  await buildPunkAccountActivationReview({
    manifest: item.manifest,
    tokenId: tokenId.toString(),
    expectedOwner: owner,
    confirmations: 20,
  }, item.dependencies);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.account, owner);
    assert.equal(request.to, coreAddresses.GoghPunkAccountRegistry);
    assert.equal(request.value, 0n);
    assert.equal(request.data, item.state.createData);
    assert.equal(request.blockNumber, 1_000n);
    assert.deepEqual(Object.keys(request).sort(),
      ["account", "blockNumber", "data", "to", "value"]);
  }
});

test("fails the current NOT_DEPLOYED manifest closed", async () => {
  const item = fixture();
  item.manifest.status = "NOT_DEPLOYED";
  await assert.rejects(() => buildPunkAccountActivationReview({
    manifest: item.manifest, tokenId: "4242", expectedOwner: owner, confirmations: 20,
  }, item.dependencies), /status/);
});

test("rejects manually flipped VERIFIED statuses without source-verification adoption", async () => {
  const item = fixture();
  item.manifest.sourceVerificationAdoption = null;
  await assert.rejects(() => buildPunkAccountActivationReview({
    manifest: item.manifest, tokenId: "4242", expectedOwner: owner, confirmations: 20,
  }, item.dependencies), /sourceVerificationAdoption|source verification/i);
});

test("rejects malformed adoption order and any unverified core contract", async () => {
  for (const mutate of [
    (manifest) => manifest.sourceVerificationAdoption.verifiedContracts.reverse(),
    (manifest) => { manifest.contracts.GoghPunkAccountV1.verificationStatus = "NOT_SUBMITTED"; },
  ]) {
    const item = fixture();
    mutate(item.manifest);
    await assert.rejects(() => buildPunkAccountActivationReview({
      manifest: item.manifest, tokenId: "4242", expectedOwner: owner, confirmations: 20,
    }, item.dependencies));
  }
});

test("rejects extra schema fields, accessors without invoking them, and Proxy input", async () => {
  const base = fixture();
  base.manifest.secret = "not allowed";
  await assert.rejects(() => buildPunkAccountActivationReview({
    manifest: base.manifest, tokenId: "4242", expectedOwner: owner, confirmations: 20,
  }, base.dependencies), /fields/);

  let invoked = false;
  const accessorInput = {
    tokenId: "4242",
    expectedOwner: owner,
    confirmations: 20,
  };
  Object.defineProperty(accessorInput, "manifest", {
    enumerable: true,
    get() { invoked = true; return manifestFixture(); },
  });
  await assert.rejects(() => buildPunkAccountActivationReview(accessorInput, fixture().dependencies),
    /data field/);
  assert.equal(invoked, false);

  const proxy = new Proxy({
    manifest: manifestFixture(), tokenId: "4242", expectedOwner: owner, confirmations: 20,
  }, {});
  await assert.rejects(() => buildPunkAccountActivationReview(proxy, fixture().dependencies),
    /Proxy/);
});

test("rejects same client, same HTTPS origin, non-HTTPS origins, and wrong chain", async () => {
  const item = fixture();
  const input = { manifest: item.manifest, tokenId: "4242", expectedOwner: owner,
    confirmations: 20 };
  await assert.rejects(() => buildPunkAccountActivationReview(input, {
    primaryClient: item.primaryClient,
    secondaryClient: item.primaryClient,
    endpointOrigins: ["https://primary.example", "https://secondary.example"],
  }), /distinct/);
  await assert.rejects(() => buildPunkAccountActivationReview(input, {
    primaryClient: item.primaryClient,
    secondaryClient: item.secondaryClient,
    endpointOrigins: ["https://same.example", "https://same.example"],
  }), /distinct/);
  await assert.rejects(() => buildPunkAccountActivationReview(input, {
    primaryClient: item.primaryClient,
    secondaryClient: item.secondaryClient,
    endpointOrigins: ["http://primary.example", "https://secondary.example"],
  }), /distinct/);
  item.secondaryClient.getChainId = async () => 1;
  await assert.rejects(() => buildPunkAccountActivationReview(input, item.dependencies),
    /chain ID|differs/);
});

test("rejects owner, account, feature, runtime, wiring, and simulation safety failures", async () => {
  const cases = [
    ["owner contract", (item) => {
      const original = item.primaryClient.getCode;
      item.primaryClient.getCode = async (request) => (
        request.address.toLowerCase() === owner.toLowerCase() ? "0x6000" : original(request)
      );
      const original2 = item.secondaryClient.getCode;
      item.secondaryClient.getCode = async (request) => (
        request.address.toLowerCase() === owner.toLowerCase() ? "0x6000" : original2(request)
      );
    }],
    ["already created", (item) => { item.state.activated = true; }],
    ["unsafe feature", (item) => {
      for (const client of [item.primaryClient, item.secondaryClient]) {
        const original = client.readContract;
        client.readContract = async (request) => {
          const value = await original(request);
          if (request.functionName === "featureFlags") return { ...value, autonomousMints: true };
          return value;
        };
      }
    }],
    ["truthy-string feature", (item) => {
      for (const client of [item.primaryClient, item.secondaryClient]) {
        const original = client.readContract;
        client.readContract = async (request) => {
          const value = await original(request);
          if (request.functionName === "featureFlags") return { ...value, scoutMode: "true" };
          return value;
        };
      }
    }],
    ["runtime mismatch", (item) => { item.manifest.contracts.ArtAgentRegistry.runtimeBytecodeHash =
      `0x${"aa".repeat(32)}`; }],
    ["wiring mismatch", (item) => {
      for (const client of [item.primaryClient, item.secondaryClient]) {
        const original = client.readContract;
        client.readContract = async (request) => (
          request.address.toLowerCase() === coreAddresses.GoghPunkAccountRegistry.toLowerCase()
            && request.functionName === "implementation" ? address("dead") : original(request)
        );
      }
    }],
    ["local CREATE2 mismatch", (item) => {
      for (const client of [item.primaryClient, item.secondaryClient]) {
        const original = client.readContract;
        client.readContract = async (request) => {
          if (request.functionName === "account"
            && [
              coreAddresses.GoghPunkAccountRegistry.toLowerCase(),
              ACTIVATION_CANONICAL_ERC6551_REGISTRY.toLowerCase(),
            ].includes(request.address.toLowerCase())) return address("bad");
          return original(request);
        };
      }
    }],
    ["simulation mismatch", (item) => {
      const result = encodeFunctionResult({
        abi: PUNK_ACCOUNT_ACTIVATION_ABIS.accountRegistryAbi,
        functionName: "createAccount",
        result: address("dead"),
      });
      item.primaryClient.call = async () => ({ data: result });
      item.secondaryClient.call = async () => ({ data: result });
    }],
  ];
  for (const [label, mutate] of cases) {
    const item = fixture();
    mutate(item);
    await assert.rejects(() => buildPunkAccountActivationReview({
      manifest: item.manifest, tokenId: "4242", expectedOwner: owner, confirmations: 20,
    }, item.dependencies), undefined, label);
  }
});

test("rejects a controlling Punk owned by its own counterfactual account", async () => {
  const item = fixture();
  for (const client of [item.primaryClient, item.secondaryClient]) {
    const original = client.readContract;
    client.readContract = async (request) => (
      request.address.toLowerCase() === ACTIVATION_CANONICAL_COLLECTION.toLowerCase()
        ? account : original(request)
    );
  }
  await assert.rejects(() => buildPunkAccountActivationReview({
    manifest: item.manifest,
    tokenId: tokenId.toString(),
    expectedOwner: account,
    confirmations: 20,
  }, item.dependencies), /counterfactual account/);
});

test("rejects provider disagreement and a changed confirmed block", async () => {
  const disagreement = fixture();
  const original = disagreement.secondaryClient.readContract;
  disagreement.secondaryClient.readContract = async (request) => (
    request.address.toLowerCase() === ACTIVATION_CANONICAL_COLLECTION.toLowerCase()
      ? address("bad") : original(request)
  );
  await assert.rejects(() => buildPunkAccountActivationReview({
    manifest: disagreement.manifest, tokenId: "4242", expectedOwner: owner, confirmations: 20,
  }, disagreement.dependencies), /differs/);

  const changed = fixture();
  let reads = 0;
  const originalBlock = changed.secondaryClient.getBlock;
  changed.secondaryClient.getBlock = async (request) => {
    const result = await originalBlock(request);
    reads += 1;
    return reads === 2 ? { ...result, hash: `0x${"ab".repeat(32)}` } : result;
  };
  await assert.rejects(() => buildPunkAccountActivationReview({
    manifest: changed.manifest, tokenId: "4242", expectedOwner: owner, confirmations: 20,
  }, changed.dependencies));
});

test("argument and endpoint parsing never accepts private keys or RPC CLI arguments", () => {
  assert.deepEqual(parseActivationReviewArguments([
    "--token-id", "4242", "--expected-owner", owner,
  ]), { tokenId: "4242", expectedOwner: owner, confirmations: "20" });
  assert.deepEqual(parseActivationReceiptArguments([
    "--review", "review.json", "--transaction-hash", activationHash,
  ]), { reviewPath: "review.json", transactionHash: activationHash, confirmations: "20" });
  assert.throws(() => parseActivationReviewArguments(["--private-key", `0x${"11".repeat(32)}`]),
    /never accepted/);
  assert.throws(() => parseActivationReviewArguments(["--rpc-url", "https://rpc.example"]),
    /never accepted/);
  assert.throws(() => readActivationRpcEndpoints({
    ROBINHOOD_RPC_URL: "https://same.example/key-a",
    ROBINHOOD_SECONDARY_RPC_URL: "https://same.example/key-b",
  }), /distinct/);
  assert.throws(() => readActivationRpcEndpoints({
    ROBINHOOD_RPC_URL: "https://api-1.shared-provider.com/key-a",
    ROBINHOOD_SECONDARY_RPC_URL: "https://api-2.shared-provider.com/key-b",
  }), /provider domains/);
  const endpoints = readActivationRpcEndpoints({
    ROBINHOOD_RPC_URL: "https://one.example/secret-key",
    ROBINHOOD_SECONDARY_RPC_URL: "https://two.example/other-secret",
  });
  assert.deepEqual(endpoints.origins, ["https://one.example", "https://two.example"]);
});

test("bounded file reader rejects symlinks and oversized input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gogh-activation-test-"));
  try {
    const target = join(directory, "target.json");
    const link = join(directory, "link.json");
    await writeFile(target, "{}", { mode: 0o600 });
    await symlink(target, link);
    await assert.rejects(() => readActivationJsonFile(link, 100, "review"), /non-symlink/);
    await writeFile(target, JSON.stringify({ value: "x".repeat(100) }), { mode: 0o600 });
    await assert.rejects(() => readActivationJsonFile(target, 20, "review"), /exceeds/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runner passes only public inputs and redacted endpoint origins to the attestor", async () => {
  const item = fixture();
  let observed;
  const result = await runActivationReview([
    "--token-id", "4242", "--expected-owner", owner,
  ], {
    env: {
      ROBINHOOD_RPC_URL: "https://one.example/super-secret",
      ROBINHOOD_SECONDARY_RPC_URL: "https://two.example/other-secret",
    },
    readJson: async () => item.manifest,
    clientFactory: ({ role }) => role === "primary" ? item.primaryClient : item.secondaryClient,
    attestor: async (input, deps) => { observed = { input, deps }; return { ok: true }; },
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(observed.deps.endpointOrigins,
    ["https://one.example", "https://two.example"]);
  assert.equal(JSON.stringify(observed).includes("super-secret"), false);
  assert.equal(Object.hasOwn(observed.input, "privateKey"), false);
});

test("runner rejects NOT_DEPLOYED before requiring RPCs or constructing clients", async () => {
  const manifest = manifestFixture();
  manifest.status = "NOT_DEPLOYED";
  let factoryCalled = false;
  await assert.rejects(() => runActivationReview([
    "--token-id", "4242", "--expected-owner", owner,
  ], {
    env: {},
    readJson: async () => manifest,
    clientFactory: () => { factoryCalled = true; throw new Error("must not run"); },
  }), (error) => error?.code === "CORE_NOT_DEPLOYED");
  assert.equal(factoryCalled, false);
});

test("sanitized failures redact URLs and arbitrary errors", () => {
  const known = new Error("failed at https://rpc.example/secret-key");
  known.name = "PunkAccountActivationError";
  known.code = "RPC_FAILURE";
  assert.equal(sanitizedActivationFailure(known), "RPC_FAILURE: failed at [redacted RPC]");
  assert.equal(sanitizedActivationFailure(new Error("secret")),
    "ACTIVATION_PREFLIGHT_FAILED: activation validation failed closed");
});

test("activation tooling has no signer, private-key, send, write, or deployment API", async () => {
  const sources = await Promise.all([
    "scripts/punk-account-activation.mjs",
    "scripts/punk-account-activation-runner.mjs",
    "scripts/build-punk-account-activation-review.mjs",
    "scripts/attest-punk-account-activation-receipt.mjs",
  ].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  const joined = sources.join("\n");
  for (const forbidden of [
    "createWalletClient", "privateKeyToAccount", ".sendTransaction(", ".writeContract(",
    ".signTransaction(", ".signMessage(", "broadcastTransaction", "eth_sendRawTransaction",
  ]) assert.equal(joined.includes(forbidden), false, forbidden);
});

test("post-receipt attestation binds exact tx, two events, runtime, footer, modules, and owner", async () => {
  const before = await successfulReview();
  const after = fixture({ activated: true, head: 1_020n });
  const artifact = await attestPunkAccountActivationReceipt({
    manifest: after.manifest,
    reviewArtifact: before.artifact,
    transactionHash: activationHash,
    confirmations: 20,
  }, after.dependencies);
  assert.equal(artifact.attestation.status, "READ_ONLY_ACTIVATION_CONFIRMED");
  assert.equal(artifact.attestation.receipt.exactLogCount, 2);
  assert.equal(artifact.attestation.receipt.canonicalERC6551EventVerified, true);
  assert.equal(artifact.attestation.receipt.facadeActivationEventVerified, true);
  assert.equal(artifact.attestation.account.runtimeByteLength, 173);
  assert.equal(artifact.attestation.account.footer.tokenId, "4242");
  assert.equal(artifact.attestation.punk.currentOwner, owner);
  assert.equal(artifact.attestation.trustBoundary.activationTransactionGrantedAgentAuthority,
    false);
  assert.equal(artifact.attestation.trustBoundary.currentAgentAuthority,
    "UNVERIFIED_BY_ACTIVATION_ATTESTATION");
  assert.equal(artifact.transactionAuthorized, false);
  assert.equal(artifact.signingPerformed, false);
  assert.equal(artifact.submissionPerformed, false);
  assert.equal(artifact.chainWritePerformed, false);
});

test("post-receipt attestation rejects tampering, failed or altered transactions, logs, and runtime", async () => {
  const before = await successfulReview();
  const cases = [
    ["review hash", (after, review) => { review.review.transaction.value = "1"; }],
    ["transaction value", (after) => { after.state.activationTransaction.value = 1n; }],
    ["failed receipt", (after) => { after.state.activationReceipt.status = "reverted"; }],
    ["extra log", (after) => { after.state.activationReceipt.logs.push(
      { ...after.state.activationReceipt.logs[1], logIndex: 8 },
    ); }],
    ["event owner", (after) => {
      const logs = eventLogs();
      logs[1].data = encodeAbiParameters([
        { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint256" },
      ], [tokenId, address("bad"), coreAddresses.GoghPunkAccountV1, 1n]);
      after.state.activationReceipt.logs = logs;
    }],
    ["runtime", (after) => {
      after.state.runtime = `${after.state.runtime.slice(0, -2)}00`;
    }],
    ["receipt block number", (after) => {
      for (const client of [after.primaryClient, after.secondaryClient]) {
        const original = client.getBlock;
        client.getBlock = async (request) => {
          const value = await original(request);
          return request.blockNumber === 990n ? { ...value, number: 991n } : value;
        };
      }
    }],
  ];
  for (const [label, mutate] of cases) {
    const after = fixture({ activated: true, head: 1_020n });
    const review = structuredClone(before.artifact);
    mutate(after, review);
    await assert.rejects(() => attestPunkAccountActivationReceipt({
      manifest: after.manifest,
      reviewArtifact: review,
      transactionHash: activationHash,
      confirmations: 20,
    }, after.dependencies), undefined, label);
  }
});

test("post-receipt attestation rejects insufficient confirmations and live ownership change", async () => {
  const before = await successfulReview();
  const young = fixture({ activated: true, head: 1_005n });
  await assert.rejects(() => attestPunkAccountActivationReceipt({
    manifest: young.manifest, reviewArtifact: before.artifact,
    transactionHash: activationHash, confirmations: 20,
  }, young.dependencies), /confirmations/);

  const transferred = fixture({ activated: true, head: 1_020n });
  for (const client of [transferred.primaryClient, transferred.secondaryClient]) {
    const original = client.readContract;
    client.readContract = async (request) => (
      request.address.toLowerCase() === ACTIVATION_CANONICAL_COLLECTION.toLowerCase()
        ? address("b0b") : original(request)
    );
  }
  await assert.rejects(() => attestPunkAccountActivationReceipt({
    manifest: transferred.manifest, reviewArtifact: before.artifact,
    transactionHash: activationHash, confirmations: 20,
  }, transferred.dependencies), /owner/);
});
