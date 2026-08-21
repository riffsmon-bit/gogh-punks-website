import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { encodeAbiParameters, keccak256 } from "viem";
import {
  buildRobinhoodDeploymentManifestProposal,
  EXPECTED_DEPLOYMENT_ORDER,
  readBoundedDeploymentJson,
  renderRobinhoodDeploymentManifestProposal,
  SAFE_FEATURE_FLAGS,
  verifyCliSourceProvenance,
} from "../scripts/build-robinhood-deployment-manifest.mjs";

const guardian = "0x1111111111111111111111111111111111111111";
const deployer = "0x2222222222222222222222222222222222222222";
const commit = "a".repeat(40);
const foundryCommit = "a".repeat(7);
const canonicalRegistryHash =
  "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
const canonicalRegistryCode = "0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063246a00211461003b5780638a54c52f1461006a575b600080fd5b61004e6100493660046101b7565b61007d565b6040516001600160a01b03909116815260200160405180910390f35b61004e6100783660046101b7565b6100e1565b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b60015284601552605560002060601b60601c60005260206000f35b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b600152846015526055600020803b61018b578560b760556000f580610157576320188a596000526004601cfd5b80606c52508284887f79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf887226060606ca46020606cf35b8060601b60601c60005260206000f35b80356001600160a01b03811681146101b257600080fd5b919050565b600080600080600060a086880312156101cf57600080fd5b6101d88661019b565b945060208601359350604086013592506101f46060870161019b565b94979396509194608001359291505056fea2646970667358221220ea2fe53af507453c64dd7c1db05549fa47a298dfb825d6d11e1689856135f16764736f6c63430008110033";
const salt = `0x${"0".repeat(64)}`;
const addresses = Object.fromEntries(EXPECTED_DEPLOYMENT_ORDER.map((name, index) => (
  [name, `0x${(index + 3).toString(16).repeat(40)}`]
)));
const txHash = (index) => `0x${(index + 1).toString(16).repeat(64)}`;
const blockHash = (index) => `0x${(index + 8).toString(16).repeat(64)}`;
const creationCode = (index) => `0x600${index + 1}600052`;
const runtimeTemplate = (index) => `0x600${index + 1}600055`;

function constructorDefinition(name) {
  return {
    ArtAdapterRegistry: [[{ type: "address" }], [guardian]],
    ArtAgentRegistry: [[{ type: "address" }], [guardian]],
    BrokerPolicyModule: [
      [{ type: "address" }, { type: "address" }],
      [guardian, addresses.ArtAdapterRegistry],
    ],
    GoghPunkAccountV1: [
      [{ type: "address" }, { type: "address" }, { type: "address" }],
      [addresses.BrokerPolicyModule, addresses.ArtAgentRegistry, addresses.ArtAdapterRegistry],
    ],
    GoghPunkAccountRegistry: [
      [{ type: "address" }, { type: "bytes32" }],
      [addresses.GoghPunkAccountV1, salt],
    ],
  }[name];
}

function compiledArtifact(name, index) {
  return {
    abi: [],
    bytecode: { object: creationCode(index), sourceMap: "", linkReferences: {} },
    deployedBytecode: {
      object: runtimeTemplate(index),
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
        compilationTarget: { [`contracts/src/${name}.sol`]: name },
      },
      sources: {
        [`contracts/src/${name}.sol`]: {
          keccak256: `0x${(index + 1).toString(16).repeat(64)}`,
        },
      },
    }),
    metadata: {},
    id: index,
  };
}

function compiledArtifacts() {
  return Object.fromEntries(EXPECTED_DEPLOYMENT_ORDER.map((name, index) => (
    [name, compiledArtifact(name, index)]
  )));
}

function template() {
  return {
    status: "NOT_DEPLOYED",
    chain: {
      name: "Robinhood Chain",
      chainId: 4663,
      rpcEnvironmentVariable: "ROBINHOOD_RPC_URL",
      explorer: "https://robinhoodchain.blockscout.com",
      nativeCurrency: "ETH",
    },
    canonicalCollection: "0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6",
    canonicalERC6551Registry: "0x000000006551c19487814612e58FE06813775758",
    canonicalERC6551RegistryRuntimeCodeHash: canonicalRegistryHash,
    verifiedExternalInfrastructure: {
      seaport: {
        address: "0x0000000000000068f116a894984e2db1123eb395",
        name: "Seaport",
        compiler: "v0.8.24+commit.e11b9ed9",
        deploymentTransaction: "0x4320260396b5fbb69618a9b95de358a865fb6c305d5b5dda35c21452b30ee39d",
        deploymentBlock: 605917,
        runtimeCodeHash: "0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00",
        verificationStatus: "VERIFIED_READ_ONLY_SCOUT",
        executionApproved: false,
      },
    },
    accountSalt: salt,
    gitCommit: null,
    compiler: "0.8.34",
    evmVersion: "cancun",
    optimizerRuns: 500,
    contracts: Object.fromEntries(EXPECTED_DEPLOYMENT_ORDER.map((name) => [name, {
      address: null,
      deploymentTransaction: null,
      deploymentBlock: null,
      deployer: null,
      implementationVersion: "1",
      constructorArguments: null,
      creationBytecodeHash: null,
      runtimeBytecodeHash: null,
      gitCommit: null,
      verificationStatus: "NOT_SUBMITTED",
    }])),
    sourceVerificationAdoption: null,
    featureFlags: { ...SAFE_FEATURE_FLAGS },
    protocolGuardian: null,
    notes: "Template only.",
  };
}

function artifact() {
  const transactions = EXPECTED_DEPLOYMENT_ORDER.map((name, index) => {
    const [types, args] = constructorDefinition(name);
    return {
      hash: txHash(index),
      transactionType: "CREATE",
      contractName: name,
      contractAddress: addresses[name],
      function: null,
      arguments: args,
      transaction: {
        from: deployer,
        gas: "0x100000",
        value: "0x0",
        input: `${creationCode(index)}${encodeAbiParameters(types, args).slice(2)}`,
        nonce: `0x${index.toString(16)}`,
        chainId: "0x1237",
      },
      additionalContracts: [],
      isFixedGasLimit: false,
    };
  });
  return {
    transactions,
    receipts: EXPECTED_DEPLOYMENT_ORDER.map((name, index) => ({
      status: "0x1",
      logs: [],
      transactionHash: txHash(index),
      blockHash: blockHash(index),
      blockNumber: `0x${(1_000 + index).toString(16)}`,
      from: deployer,
      to: null,
      contractAddress: addresses[name],
    })),
    libraries: [],
    pending: [],
    returns: {
      deployment: {
        internal_type: "struct DeployArtBroker.Deployment",
        value: `(${EXPECTED_DEPLOYMENT_ORDER.map((name) => addresses[name]).join(", ")})`,
      },
    },
    timestamp: 1_800_000_000_000,
    chain: 4663,
    commit: foundryCommit,
  };
}

function withRegistrySalt(source, nextSalt) {
  const index = EXPECTED_DEPLOYMENT_ORDER.indexOf("GoghPunkAccountRegistry");
  const name = EXPECTED_DEPLOYMENT_ORDER[index];
  const [types] = constructorDefinition(name);
  source.transactions[index].arguments[1] = nextSalt;
  source.transactions[index].transaction.input = `${creationCode(index)}${
    encodeAbiParameters(types, source.transactions[index].arguments).slice(2)
  }`;
  return source;
}

function fakeClient(sourceArtifact = artifact(), overrides = {}, origin = "https://primary.example") {
  const byHash = new Map(sourceArtifact.transactions.map((transaction, index) => [
    transaction.hash,
    { transaction, receipt: sourceArtifact.receipts[index], index },
  ]));
  return {
    transport: { url: origin },
    async getChainId() { return overrides.chainId ?? 4663; },
    async getBlockNumber() { return overrides.head ?? 2_000n; },
    async getBlock({ blockNumber }) {
      let block;
      if (blockNumber === 1_980n) {
        block = { number: blockNumber, hash: `0x${"f".repeat(64)}`, transactions: [] };
      } else {
        const index = Number(blockNumber) - 1_000;
        block = { number: blockNumber, hash: blockHash(index), transactions: [txHash(index)] };
      }
      return overrides.block ? overrides.block(block, blockNumber) : block;
    },
    async getTransactionReceipt({ hash }) {
      const receipt = structuredClone(byHash.get(hash).receipt);
      receipt.status = "success";
      receipt.blockNumber = BigInt(receipt.blockNumber);
      return overrides.receipt ? overrides.receipt(receipt, hash) : receipt;
    },
    async getTransaction({ hash }) {
      const { transaction, receipt } = byHash.get(hash);
      const live = {
        hash,
        input: transaction.transaction.input,
        from: transaction.transaction.from,
        to: null,
        value: 0n,
        chainId: 4663,
        blockNumber: BigInt(receipt.blockNumber),
        blockHash: receipt.blockHash,
      };
      return overrides.transaction ? overrides.transaction(live, hash) : live;
    },
    async getCode({ address }) {
      if (address.toLowerCase() === "0x000000006551c19487814612e58fe06813775758") {
        const code = canonicalRegistryCode;
        return overrides.registryCode ? overrides.registryCode(code) : code;
      }
      const index = EXPECTED_DEPLOYMENT_ORDER.findIndex((name) => addresses[name] === address);
      const code = runtimeTemplate(index);
      return overrides.code ? overrides.code(code, address) : code;
    },
    async readContract({ address, functionName }) {
      let value;
      if (functionName === "GOGH_PUNKS") {
        value = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
      } else if (functionName === "ROBINHOOD_CHAIN_ID") {
        value = 4663n;
      } else if (address === addresses.BrokerPolicyModule && functionName === "adapterRegistry") {
        value = addresses.ArtAdapterRegistry;
      } else if (address === addresses.GoghPunkAccountV1 && functionName === "policyModule") {
        value = addresses.BrokerPolicyModule;
      } else if (address === addresses.GoghPunkAccountV1 && functionName === "agentRegistry") {
        value = addresses.ArtAgentRegistry;
      } else if (address === addresses.GoghPunkAccountV1 && functionName === "adapterRegistry") {
        value = addresses.ArtAdapterRegistry;
      } else if (address === addresses.GoghPunkAccountRegistry && functionName === "implementation") {
        value = addresses.GoghPunkAccountV1;
      } else if (address === addresses.GoghPunkAccountRegistry && functionName === "accountSalt") {
        value = salt;
      } else if (address === addresses.GoghPunkAccountRegistry && functionName === "canonicalRegistry") {
        value = "0x000000006551c19487814612e58fe06813775758";
      } else if (functionName === "owner") {
        value = guardian;
      } else if (functionName === "pendingOwner") {
        value = "0x0000000000000000000000000000000000000000";
      } else if (address === addresses.BrokerPolicyModule && functionName === "featureFlags") {
        value = {
          scoutMode: true,
          approvalPurchases: false,
          autonomousPurchases: false,
          autonomousMints: false,
          unknownCollectionExecution: false,
          selling: false,
          autonomousSelling: false,
        };
      } else {
        throw new Error(`unexpected read ${address} ${functionName}`);
      }
      return overrides.readContract ? overrides.readContract(value, address, functionName) : value;
    },
  };
}

function endpoints(sourceArtifact = artifact(), overrides = {}) {
  return [
    {
      origin: "https://primary.example",
      client: fakeClient(sourceArtifact, overrides.primary, "https://primary.example"),
    },
    {
      origin: "https://secondary.example",
      client: fakeClient(sourceArtifact, overrides.secondary, "https://secondary.example"),
    },
  ];
}

function sourceProvenance(overrides = {}) {
  return {
    releaseGitCommit: commit,
    headCommit: commit,
    artifactResolvedCommit: commit,
    foundryArtifactCommit: foundryCommit,
    compilerInputsClean: true,
    offlineBuildCompleted: true,
    offlineBuildCommand: ["forge", "build", "--offline", "--force"],
    ...overrides,
  };
}

function build(overrides = {}) {
  const sourceArtifact = overrides.artifact ?? artifact();
  return buildRobinhoodDeploymentManifestProposal({
    artifact: sourceArtifact,
    compiledArtifacts: overrides.compiledArtifacts ?? compiledArtifacts(),
    gitCommit: overrides.gitCommit ?? commit,
    guardian: overrides.guardian ?? guardian,
    template: overrides.template ?? template(),
    readEndpoints: overrides.readEndpoints ?? endpoints(sourceArtifact),
    confirmations: overrides.confirmations ?? 20,
    sourceProvenance: overrides.sourceProvenance ?? sourceProvenance(),
  });
}

test("emits COMPLETE/DEPLOYED only after every compiled and live trust binding passes", async () => {
  const proposal = await build();
  assert.equal(proposal.schema, "GOGH_ROBINHOOD_DEPLOYMENT_MANIFEST_PROPOSAL_V2");
  assert.equal(proposal.proposalStatus, "COMPLETE_MANIFEST_PROPOSAL");
  assert.equal(proposal.manifest.status, "DEPLOYED");
  assert.deepEqual(proposal.manifest.featureFlags, SAFE_FEATURE_FLAGS);
  assert.equal(proposal.manifest.featureFlags.ENABLE_APPROVAL_PURCHASES, false);
  assert.equal(proposal.manifest.canonicalERC6551RegistryRuntimeCodeHash, canonicalRegistryHash);
  assert.equal(proposal.trustBindings.releaseGitCommit, commit);
  assert.equal(proposal.trustBindings.foundryArtifactCommit, foundryCommit);
  assert.deepEqual(proposal.trustBindings.canonicalERC6551Registry, {
    address: "0x000000006551c19487814612e58FE06813775758",
    runtimeCodeHash: canonicalRegistryHash,
    matchedReadEndpoints: 2,
  });
  assert.equal(
    proposal.trustBindings.providerIndependence,
    "UNVERIFIED_BEYOND_DISTINCT_REGISTRABLE_PROVIDER_DOMAINS",
  );
  assert.equal(proposal.trustBindings.guardianAuthority.multisigStatus, "UNVERIFIED");
  assert.deepEqual(
    proposal.trustBindings.criticalImmutableBindings.governedAuthority.brokerPolicyModule
      .featureFlags,
    {
      scoutMode: true,
      approvalPurchases: false,
      autonomousPurchases: false,
      autonomousMints: false,
      unknownCollectionExecution: false,
      selling: false,
      autonomousSelling: false,
    },
  );
  assert.deepEqual(proposal.trustBindings.commonPinnedBlock, {
    number: 1_980,
    hash: `0x${"f".repeat(64)}`,
    confirmations: 20,
  });
  assert.deepEqual(proposal.trustBindings.distinctReadEndpointOrigins, [
    "https://primary.example",
    "https://secondary.example",
  ]);
  for (const [index, name] of EXPECTED_DEPLOYMENT_ORDER.entries()) {
    const record = proposal.manifest.contracts[name];
    assert.equal(record.creationBytecodeHash, keccak256(creationCode(index)));
    assert.equal(record.runtimeBytecodeHash, keccak256(runtimeTemplate(index)));
    assert.equal(record.verificationStatus, "NOT_SUBMITTED");
  }
  const rendered = renderRobinhoodDeploymentManifestProposal(proposal);
  assert.equal(rendered.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(rendered), proposal);
});

test("binds creation input and runtime to trusted compiled out artifacts", async (t) => {
  await t.test("accepts real Forge shapes that omit empty immutableReferences", async () => {
    const compiled = compiledArtifacts();
    delete compiled.ArtAdapterRegistry.deployedBytecode.immutableReferences;
    delete compiled.ArtAgentRegistry.deployedBytecode.immutableReferences;
    const proposal = await build({ compiledArtifacts: compiled });
    assert.equal(proposal.manifest.status, "DEPLOYED");
  });
  await t.test("permits only canonical 32-byte immutable runtime positions to differ", async () => {
    const source = artifact();
    const compiled = compiledArtifacts();
    const templateRuntime = `0x6001${"00".repeat(32)}55`;
    const immutableRuntime = `0x6001${"ff".repeat(32)}55`;
    compiled.BrokerPolicyModule.deployedBytecode.object = templateRuntime;
    compiled.BrokerPolicyModule.deployedBytecode.immutableReferences = {
      1: [{ start: 2, length: 32 }],
    };
    const code = (original, address) => address === addresses.BrokerPolicyModule
      ? immutableRuntime
      : original;
    const proposal = await build({
      artifact: source,
      compiledArtifacts: compiled,
      readEndpoints: endpoints(source, {
        primary: { code },
        secondary: { code },
      }),
    });
    assert.equal(
      proposal.manifest.contracts.ArtAdapterRegistry.runtimeBytecodeHash,
      keccak256(runtimeTemplate(0)),
    );
    assert.equal(
      proposal.manifest.contracts.BrokerPolicyModule.runtimeBytecodeHash,
      keccak256(immutableRuntime),
    );
  });
  await t.test("rejects null and non-32-byte immutable layouts", async () => {
    const nullCompiled = compiledArtifacts();
    nullCompiled.ArtAdapterRegistry.deployedBytecode.immutableReferences = null;
    await assert.rejects(build({ compiledArtifacts: nullCompiled }), /must be an object when present/);
    const shortRange = compiledArtifacts();
    shortRange.ArtAdapterRegistry.deployedBytecode.immutableReferences = {
      1: [{ start: 0, length: 1 }],
    };
    await assert.rejects(build({ compiledArtifacts: shortRange }), /exactly 32 bytes/);
  });
  await t.test("creation mismatch", async () => {
    const compiled = compiledArtifacts();
    compiled.ArtAgentRegistry.bytecode.object = "0x60006000";
    await assert.rejects(build({ compiledArtifacts: compiled }), /artifact input differs from compiled/);
  });
  await t.test("runtime mismatch", async () => {
    const source = artifact();
    await assert.rejects(build({
      artifact: source,
      readEndpoints: endpoints(source, {
        secondary: { code: (code, address) => address === addresses.BrokerPolicyModule
          ? "0x6000600055"
          : code },
      }),
    }), /runtime does not match compiled/);
  });
  await t.test("compiler settings mismatch", async () => {
    const compiled = compiledArtifacts();
    const metadata = JSON.parse(compiled.GoghPunkAccountV1.rawMetadata);
    metadata.settings.optimizer.runs = 200;
    compiled.GoghPunkAccountV1.rawMetadata = JSON.stringify(metadata);
    await assert.rejects(build({ compiledArtifacts: compiled }), /canonical release settings/);
  });
});

test("verifies full live creation transaction fields against artifact", async (t) => {
  const cases = [
    ["input", (transaction) => ({ ...transaction, input: "0x60006000" })],
    ["from", (transaction) => ({ ...transaction, from: guardian })],
    ["to", (transaction) => ({ ...transaction, to: guardian })],
    ["value", (transaction) => ({ ...transaction, value: 1n })],
    ["hash", (transaction) => ({ ...transaction, hash: txHash(4) })],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const source = artifact();
      await assert.rejects(build({
        artifact: source,
        readEndpoints: endpoints(source, {
          secondary: {
            transaction: (transaction, hash) => hash === txHash(0)
              ? mutate(transaction)
              : transaction,
          },
        }),
      }), /live transaction|deployer|target/);
    });
  }
});

test("requires a common confirmed block and genuinely distinct declared origins", async (t) => {
  const source = artifact();
  const sameOrigin = endpoints(source);
  sameOrigin[1].origin = sameOrigin[0].origin;
  await assert.rejects(build({ artifact: source, readEndpoints: sameOrigin }), /origins must be distinct/);

  const sameProviderDomain = [
    {
      origin: "https://rpc-a.provider.example",
      client: fakeClient(source, {}, "https://rpc-a.provider.example"),
    },
    {
      origin: "https://rpc-b.provider.example",
      client: fakeClient(source, {}, "https://rpc-b.provider.example"),
    },
  ];
  await assert.rejects(
    build({ artifact: source, readEndpoints: sameProviderDomain }),
    /distinct registrable provider domains/,
  );

  const splitBlock = endpoints(source, {
    secondary: {
      block: (block, number) => number === 1_980n
        ? { ...block, hash: `0x${"e".repeat(64)}` }
        : block,
    },
  });
  await assert.rejects(build({ artifact: source, readEndpoints: splitBlock }), /block hashes differ/);

  await t.test("closing reorg", async () => {
    let pinnedReads = 0;
    const reorg = endpoints(source, {
      secondary: {
        block: (block, number) => {
          if (number === 1_980n && ++pinnedReads > 1) return { ...block, hash: `0x${"d".repeat(64)}` };
          return block;
        },
      },
    });
    await assert.rejects(build({ artifact: source, readEndpoints: reorg }), /pinned block changed/);
  });
});

test("bounded CLI JSON reader rejects symlinks, oversized files, and in-read changes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "gogh-core-manifest-reader-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const fixturePath = join(directory, "fixture.json");
  const linkPath = join(directory, "fixture-link.json");
  await writeFile(fixturePath, '{"status":"ok"}', { encoding: "utf8", mode: 0o600 });
  await symlink(fixturePath, linkPath);

  assert.deepEqual(
    await readBoundedDeploymentJson(fixturePath, 1_024, "fixture"),
    { status: "ok" },
  );
  await assert.rejects(
    readBoundedDeploymentJson(linkPath, 1_024, "symlink fixture"),
    /could not be opened as one exact regular file/,
  );
  await assert.rejects(
    readBoundedDeploymentJson(fixturePath, 4, "oversized fixture"),
    /bounded nonempty regular file/,
  );

  const before = {
    dev: 1n,
    ino: 2n,
    size: 2n,
    mtimeNs: 3n,
    ctimeNs: 4n,
    isFile: () => true,
  };
  const after = { ...before, ctimeNs: 5n };
  let statCalls = 0;
  const changedHandle = {
    async stat() { return statCalls++ === 0 ? before : after; },
    async readFile() { return Buffer.from("{}", "utf8"); },
    async close() {},
  };
  await assert.rejects(
    readBoundedDeploymentJson("virtual.json", 1_024, "changed fixture", {
      openFile: async () => changedHandle,
    }),
    /changed while it was read/,
  );
});

test("accepts Forge short commits as facts but requires full release provenance", async (t) => {
  const tooShort = artifact();
  tooShort.commit = "a".repeat(6);
  await assert.rejects(build({ artifact: tooShort }), /7-40 hexadecimal/);

  const wrongPrefix = artifact();
  wrongPrefix.commit = "b".repeat(7);
  await assert.rejects(build({ artifact: wrongPrefix }), /not a prefix/);

  await assert.rejects(build({
    sourceProvenance: sourceProvenance({ artifactResolvedCommit: "b".repeat(40) }),
  }), /does not match the supplied release commit/);

  const unsafeTemplate = template();
  unsafeTemplate.featureFlags.ENABLE_APPROVAL_PURCHASES = true;
  await assert.rejects(build({ template: unsafeTemplate }), /must be false/);

  await t.test("noncanonical registry runtime pin", async () => {
    const badTemplate = template();
    badTemplate.canonicalERC6551RegistryRuntimeCodeHash = `0x${"12".repeat(32)}`;
    await assert.rejects(build({ template: badTemplate }), /runtime code hash is noncanonical/);
  });
});

test("requires strict artifact and canonical template schemas", async (t) => {

  const pendingMissing = artifact();
  delete pendingMissing.pending;
  await assert.rejects(build({ artifact: pendingMissing }), /unexpected key set/);

  const additionalMissing = artifact();
  delete additionalMissing.transactions[0].additionalContracts;
  await assert.rejects(build({ artifact: additionalMissing }), /unexpected key set/);

  await t.test("noncanonical external infrastructure", async () => {
    const badTemplate = template();
    badTemplate.verifiedExternalInfrastructure.seaport.executionApproved = true;
    await assert.rejects(build({ template: badTemplate }), /Seaport read-only record/);
  });
});

test("fails closed on salt, authority, endpoint, freshness, registry, and immutable binding drift", async (t) => {
  await t.test("aligned nonzero registry and template salts are still forbidden", async () => {
    const nonzeroSalt = `0x${"01".repeat(32)}`;
    const changedTemplate = template();
    changedTemplate.accountSalt = nonzeroSalt;
    await assert.rejects(build({
      artifact: withRegistrySalt(artifact(), nonzeroSalt),
      template: changedTemplate,
    }), /template account salt must be the canonical zero/);
  });

  await t.test("nonzero broadcast registry salt is independently forbidden", async () => {
    await assert.rejects(build({
      artifact: withRegistrySalt(artifact(), `0x${"02".repeat(32)}`),
    }), /broadcast registry salt must be zero/);
  });

  await t.test("registry salt differs from template", async () => {
    const changedTemplate = template();
    changedTemplate.accountSalt = `0x${"01".repeat(32)}`;
    await assert.rejects(build({ template: changedTemplate }), /canonical zero/);
  });

  await t.test("guardian equals deployer", async () => {
    const source = artifact();
    for (const index of [0, 1, 2]) source.transactions[index].arguments[0] = deployer;
    for (const index of [0, 1, 2]) {
      const name = EXPECTED_DEPLOYMENT_ORDER[index];
      const [types] = constructorDefinition(name);
      source.transactions[index].transaction.input = `${creationCode(index)}${
        encodeAbiParameters(types, source.transactions[index].arguments).slice(2)
      }`;
    }
    await assert.rejects(build({ artifact: source, guardian: deployer }), /must differ from the deployer/);
  });

  await t.test("same client object", async () => {
    const source = artifact();
    const reads = endpoints(source);
    reads[1].client = reads[0].client;
    await assert.rejects(build({ artifact: source, readEndpoints: reads }), /distinct objects/);
  });

  await t.test("declared origin differs from transport", async () => {
    const source = artifact();
    const reads = endpoints(source);
    reads[1].client.transport.url = "https://third.example";
    await assert.rejects(build({ artifact: source, readEndpoints: reads }), /differs from its client/);
  });

  await t.test("head skew and shallow confirmations", async () => {
    const source = artifact();
    await assert.rejects(build({
      artifact: source,
      readEndpoints: endpoints(source, { secondary: { head: 2_200n } }),
    }), /heads differ by more than/);
    await assert.rejects(build({ confirmations: 11 }), /between 12 and 256/);
  });

  await t.test("canonical registry runtime mismatch", async () => {
    const source = artifact();
    await assert.rejects(build({
      artifact: source,
      readEndpoints: endpoints(source, {
        secondary: { registryCode: () => "0x6000" },
      }),
    }), /canonical ERC-6551 registry runtime hash is wrong/);
  });

  await t.test("critical immutable getter mismatch", async () => {
    const source = artifact();
    await assert.rejects(build({
      artifact: source,
      readEndpoints: endpoints(source, {
        secondary: {
          readContract: (value, address, functionName) => (
            address === addresses.GoghPunkAccountRegistry && functionName === "implementation"
              ? addresses.ArtAgentRegistry
              : value
          ),
        },
      }),
    }), /registry live implementation/);
  });

  await t.test("governed owner mismatch", async () => {
    const source = artifact();
    await assert.rejects(build({
      artifact: source,
      readEndpoints: endpoints(source, {
        secondary: {
          readContract: (value, address, functionName) => (
            address === addresses.ArtAgentRegistry && functionName === "owner"
              ? deployer
              : value
          ),
        },
      }),
    }), /ArtAgentRegistry live owner/);
  });

  await t.test("pending governed ownership", async () => {
    const source = artifact();
    await assert.rejects(build({
      artifact: source,
      readEndpoints: endpoints(source, {
        primary: {
          readContract: (value, address, functionName) => (
            address === addresses.ArtAdapterRegistry && functionName === "pendingOwner"
              ? deployer
              : value
          ),
        },
      }),
    }), /pending owner must be zero/);
  });

  await t.test("live transaction feature enabled", async () => {
    const source = artifact();
    await assert.rejects(build({
      artifact: source,
      readEndpoints: endpoints(source, {
        secondary: {
          readContract: (value, address, functionName) => (
            address === addresses.BrokerPolicyModule && functionName === "featureFlags"
              ? { ...value, approvalPurchases: true }
              : value
          ),
        },
      }),
    }), /approvalPurchases must be false/);
  });
});

test("CLI resolves short Forge commit to clean HEAD and rebuilds offline before artifacts", async (t) => {
  const calls = [];
  const runner = async (executable, args) => {
    calls.push([executable, args]);
    if (executable === "forge") return { stdout: "build complete\n", stderr: "" };
    if (args[0] === "status") return { stdout: "", stderr: "" };
    return { stdout: `${commit}\n`, stderr: "" };
  };
  const provenance = await verifyCliSourceProvenance({
    releaseGitCommit: commit,
    foundryArtifactCommit: foundryCommit,
    cwd: "/workspace",
    runProgram: runner,
  });
  assert.deepEqual(provenance, sourceProvenance());
  assert.equal(calls.filter(([command]) => command === "forge").length, 1);
  assert.deepEqual(calls.find(([command]) => command === "forge"), [
    "forge", ["build", "--offline", "--force"],
  ]);
  assert.equal(calls.filter(([, args]) => args[0] === "status").length, 2);
  assert.equal(calls.filter(([, args]) => args[0] === "rev-parse").length, 4);

  await t.test("dirty compiler input", async () => {
    await assert.rejects(verifyCliSourceProvenance({
      releaseGitCommit: commit,
      foundryArtifactCommit: foundryCommit,
      runProgram: async (executable, args) => {
        if (executable === "git" && args[0] === "status") {
          return { stdout: " M contracts/src/BrokerPolicyModule.sol\n" };
        }
        return { stdout: executable === "git" ? `${commit}\n` : "" };
      },
    }), /compiler inputs differ from clean HEAD/);
  });

  await t.test("ambiguous or unresolvable artifact prefix", async () => {
    await assert.rejects(verifyCliSourceProvenance({
      releaseGitCommit: commit,
      foundryArtifactCommit: foundryCommit,
      runProgram: async (executable, args) => {
        if (executable === "git" && args[0] === "rev-parse" && args[2].startsWith(foundryCommit)) {
          throw new Error("ambiguous");
        }
        return { stdout: args[0] === "status" ? "" : `${commit}\n` };
      },
    }), /Foundry artifact commit resolution failed closed/);
  });

  const source = await readFile(
    new URL("../scripts/build-robinhood-deployment-manifest.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.indexOf("await verifyCliSourceProvenance") < source.indexOf("const compiledArtifacts"),
    "offline provenance/rebuild must occur before compiled artifacts are read",
  );
});

test("source has no write, signing, sending, or deployment path", async () => {
  const source = await readFile(
    new URL("../scripts/build-robinhood-deployment-manifest.mjs", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "writeFile", "appendFile", "sendTransaction", "signTransaction", "privateKeyToAccount",
    "mnemonicToAccount", "walletClient",
  ]) {
    assert.equal(source.includes(forbidden), false, `source must not contain ${forbidden}`);
  }
  assert.match(source, /process\.stdout\.write/);
});
