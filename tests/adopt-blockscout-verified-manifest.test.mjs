import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { encodeAbiParameters, keccak256, stringToBytes } from "viem";
import {
  BLOCKSCOUT_ORIGIN,
  buildBlockscoutVerifiedManifestProposal,
  CANARY_CONTRACT_NAMES,
  CORE_CONTRACT_NAMES,
  extractBlockscoutVerifiedManifest,
  parseSourceVerificationArguments,
  readSourceVerificationJsonFile,
  renderBlockscoutVerifiedManifestProposal,
} from "../scripts/adopt-blockscout-verified-manifest.mjs";
import {
  parseVerifiedManifestExtractorArguments,
  renderExtractedVerifiedManifest,
} from "../scripts/extract-blockscout-verified-manifest.mjs";
import {
  requireVerifiedManifestAdoption,
  sourceVerificationCanonicalSha256,
} from
  "../broker/src/recommendation/source-verification-adoption.mjs";

const commit = "a".repeat(40);
const foundryCommit = "a".repeat(7);
const guardian = "0x1111111111111111111111111111111111111111";
const deployer = "0x2222222222222222222222222222222222222222";
const canonicalCollection = "0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6";
const canonicalRegistry = "0x000000006551c19487814612e58FE06813775758";
const registryHash =
  "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
const observedAt = Date.parse("2026-08-21T16:00:00.000Z");
const verifiedAt = "2026-08-21T15:00:00.000Z";
const sourcePath = (name) => ({
  GoghOneShotCanaryArt: "contracts/src/canary/GoghOneShotCanaryArt.sol",
  GoghOneShotCanaryMintAdapter:
    "contracts/src/adapters/GoghOneShotCanaryMintAdapter.sol",
}[name] ?? `contracts/src/${name}.sol`);
const addressFor = (index) => `0x${(index + 3).toString(16).repeat(40)}`;
const txFor = (index) => `0x${(index + 1).toString(16).repeat(64)}`;
const blockHashFor = (index) => `0x${(index + 9).toString(16).repeat(64)}`;

function artifactFor(name, index) {
  const source = `// SPDX-License-Identifier: MIT\npragma solidity 0.8.34; contract ${name} { constructor(address guardian) { require(guardian != address(0)); } }\n`;
  const path = sourcePath(name);
  const creation = `0x60${(index + 1).toString(16).padStart(2, "0")}600052`;
  const runtime = `0x60${(index + 1).toString(16).padStart(2, "0")}600055`;
  const settings = {
    compilationTarget: { [path]: name },
    evmVersion: "cancun",
    libraries: {},
    metadata: { bytecodeHash: "none" },
    optimizer: { enabled: true, runs: 500 },
    remappings: [":@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/"],
    viaIR: true,
  };
  const abi = [{
    type: "constructor",
    inputs: [{ name: "guardian", type: "address", internalType: "address" }],
    stateMutability: "nonpayable",
  }];
  return {
    artifact: {
      abi,
      bytecode: { object: creation, sourceMap: "", linkReferences: {} },
      deployedBytecode: {
        object: runtime,
        sourceMap: "",
        linkReferences: {},
        immutableReferences: {},
      },
      methodIdentifiers: {},
      rawMetadata: JSON.stringify({
        compiler: { version: "0.8.34+commit.80d5c536" },
        language: "Solidity",
        output: { abi },
        settings,
        sources: { [path]: { keccak256: keccak256(stringToBytes(source)), license: "MIT" } },
        version: 1,
      }),
      metadata: {},
      id: index,
    },
    abi,
    creation,
    runtime,
    settings,
    source,
    path,
  };
}

function sourceProvenance(kind) {
  return {
    releaseGitCommit: commit,
    headCommit: commit,
    artifactResolvedCommit: commit,
    foundryArtifactCommit: foundryCommit,
    [kind === "core" ? "compilerInputsClean" : "fullWorktreeClean"]: true,
    offlineBuildCompleted: true,
    offlineBuildCommand: ["forge", "build", "--offline", "--force"],
  };
}

function chain() {
  return {
    name: "Robinhood Chain",
    chainId: 4663,
    rpcEnvironmentVariable: "ROBINHOOD_RPC_URL",
    explorer: BLOCKSCOUT_ORIGIN,
    nativeCurrency: "ETH",
  };
}

function makeFixture(kind = "core") {
  const names = kind === "core" ? CORE_CONTRACT_NAMES : CANARY_CONTRACT_NAMES;
  const compiledArtifacts = {};
  const facts = {};
  const contracts = {};
  const compiledEvidence = {};
  names.forEach((name, index) => {
    const source = artifactFor(name, index);
    const address = addressFor(index);
    compiledArtifacts[name] = source.artifact;
    facts[name] = { ...source, address, transaction: txFor(index) };
    const common = {
      address,
      deploymentTransaction: txFor(index),
      deploymentBlock: 1_000 + index,
      deployer,
      constructorArguments: [guardian],
      creationBytecodeHash: keccak256(source.creation),
      runtimeBytecodeHash: keccak256(source.runtime),
      gitCommit: commit,
      verificationStatus: "NOT_SUBMITTED",
    };
    contracts[name] = kind === "core" ? {
      ...common,
      implementationVersion: "1",
    } : {
      address: common.address,
      deploymentTransaction: common.deploymentTransaction,
      deploymentBlock: common.deploymentBlock,
      deploymentBlockHash: blockHashFor(index),
      receiptStatus: "SUCCESS",
      confirmationsRequired: 20,
      confirmationsObserved: 25,
      deployer: common.deployer,
      constructorArguments: common.constructorArguments,
      creationBytecodeHash: common.creationBytecodeHash,
      runtimeBytecodeHash: common.runtimeBytecodeHash,
      gitCommit: common.gitCommit,
      verificationStatus: common.verificationStatus,
    };
    const metadata = JSON.parse(source.artifact.rawMetadata);
    const sourceHashes = Object.fromEntries(Object.entries(metadata.sources).map(([path, entry]) => [
      path,
      entry.keccak256.toLowerCase(),
    ]));
    const sourceIdentity = {
      rawMetadataSha256:
        `0x${createHash("sha256").update(source.artifact.rawMetadata).digest("hex")}`,
      sourceSetSha256: sourceVerificationCanonicalSha256(sourceHashes),
      compilerSettingsSha256: sourceVerificationCanonicalSha256(metadata.settings),
      abiSha256: sourceVerificationCanonicalSha256(source.artifact.abi),
    };
    compiledEvidence[name] = kind === "core" ? {
      creationBytecodeHash: keccak256(source.creation),
      deployedBytecodeTemplateHash: keccak256(source.runtime),
      maskedDeployedBytecodeHash: keccak256(source.runtime),
      ...sourceIdentity,
    } : {
      compiledCreationBytecodeHash: keccak256(source.creation),
      compiledDeployedBytecodeTemplateHash: keccak256(source.runtime),
      compiledMaskedDeployedBytecodeHash: keccak256(source.runtime),
      ...sourceIdentity,
      ignoredLiveEvidence: true,
    };
  });

  let pendingProposal;
  if (kind === "core") {
    pendingProposal = {
      schema: "GOGH_ROBINHOOD_DEPLOYMENT_MANIFEST_PROPOSAL_V2",
      proposalStatus: "COMPLETE_MANIFEST_PROPOSAL",
      trustBindings: {
        chainId: 4663,
        releaseGitCommit: commit,
        foundryArtifactCommit: foundryCommit,
        sourceProvenance: sourceProvenance(kind),
        commonPinnedBlock: { number: 2_000 },
        distinctReadEndpointOrigins: ["https://rpc-one.example", "https://rpc-two.example"],
        providerIndependence: "UNVERIFIED",
        guardianAuthority: { address: guardian },
        canonicalERC6551Registry: { address: canonicalRegistry },
        criticalImmutableBindings: {},
        compiledContracts: compiledEvidence,
      },
      manifest: {
        status: "DEPLOYED",
        chain: chain(),
        canonicalCollection,
        canonicalERC6551Registry: canonicalRegistry,
        canonicalERC6551RegistryRuntimeCodeHash: registryHash,
        verifiedExternalInfrastructure: {},
        accountSalt: `0x${"0".repeat(64)}`,
        gitCommit: commit,
        compiler: "0.8.34",
        evmVersion: "cancun",
        optimizerRuns: 500,
        contracts,
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
        notes: "Pending source verification.",
      },
    };
  } else {
    pendingProposal = {
      schema: "GOGH_ROBINHOOD_CANARY_DEPLOYMENT_MANIFEST_PROPOSAL_V1",
      proposalStatus: "CANARY_MANIFEST_PROPOSAL_SOURCE_VERIFICATION_PENDING",
      trustBindings: {
        chainId: 4663,
        releaseGitCommit: commit,
        foundryArtifactCommit: foundryCommit,
        sourceProvenance: sourceProvenance(kind),
        authoritativeCoreManifest: { contractsVerified: true },
        deploymentOrder: [...CANARY_CONTRACT_NAMES],
        commonConfirmedBlock: { number: 2_000 },
        rpcOrigins: [],
        providerIndependence: "UNVERIFIED",
        contractEvidence: compiledEvidence,
        blockscoutSourceVerification: "NOT_SUBMITTED",
        immutableBindings: {},
        accountIdentity: {},
        cleanPreconfigurationStateHash: `0x${"8".repeat(64)}`,
        immutableSnapshotSemantics: true,
        transactionCapability: "NONE_READ_ONLY_PROPOSAL",
      },
      manifest: {
        status: "DEPLOYED",
        chain: chain(),
        coreDeploymentManifest: "deployments/robinhood.json",
        coreDeploymentManifestStatusRequired: "DEPLOYED",
        coreDeploymentManifestGitCommit: commit,
        coreDeploymentManifestSha256: `0x${"7".repeat(64)}`,
        coreGoghPunkAccountRegistry: addressFor(8),
        coreGoghPunkAccountRegistryRuntimeCodeHash: `0x${"6".repeat(64)}`,
        coreGoghPunkAccountImplementation: addressFor(9),
        coreGoghPunkAccountImplementationRuntimeCodeHash: `0x${"5".repeat(64)}`,
        canonicalCollection,
        canonicalERC6551Registry: canonicalRegistry,
        canonicalERC6551RegistryRuntimeCodeHash: registryHash,
        controllingPunkTokenId: "4242",
        expectedActivatedPunkAccount: addressFor(10),
        expectedActivatedPunkAccountRuntimeCodeHash: `0x${"4".repeat(64)}`,
        expectedOwnerAtPreparation: guardian,
        canaryArtTokenId: "1",
        gitCommit: commit,
        compiler: "0.8.34",
        evmVersion: "cancun",
        optimizerRuns: 500,
        contracts,
        sourceVerificationAdoption: null,
        provenanceGate: { status: "VERIFIED" },
        ownerObservations: {},
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
        notes: "Pending source verification.",
      },
    };
  }
  return { kind, names, pendingProposal, compiledArtifacts, facts };
}

function smartContractResponse(name, fact) {
  const constructorArgs = encodeAbiParameters(
    fact.abi[0].inputs,
    [guardian],
  );
  return {
    verified_twin_address_hash: null,
    is_verified: true,
    is_changed_bytecode: false,
    is_partially_verified: false,
    is_fully_verified: true,
    minimal_proxy_address_hash: null,
    name,
    optimization_enabled: true,
    optimizations_runs: 500,
    compiler_version: "v0.8.34+commit.80d5c536",
    evm_version: "cancun",
    verified_at: verifiedAt,
    abi: JSON.stringify(fact.abi),
    source_code: fact.source,
    file_path: fact.path,
    compiler_settings: fact.settings,
    constructor_args: constructorArgs,
    additional_sources: [],
    deployed_bytecode: fact.runtime,
    creation_bytecode: `${fact.creation}${constructorArgs.slice(2)}`,
    external_libraries: [],
    language: "solidity",
    creation_status: "success",
  };
}

function addressResponse(fact) {
  return {
    hash: fact.address,
    creator_address_hash: deployer,
    creation_transaction_hash: fact.transaction,
    implementation_address: null,
    implementation_name: null,
    is_contract: true,
    is_verified: true,
    creation_status: "success",
  };
}

function sourcifyResponse(fact) {
  return {
    matchId: "45075371",
    creationMatch: "match",
    runtimeMatch: "match",
    verifiedAt,
    match: "match",
    chainId: "4663",
    address: fact.address,
  };
}

function jsonResponse(url, value, overrides = {}) {
  const body = new TextEncoder().encode(JSON.stringify(value));
  return {
    status: overrides.status ?? 200,
    ok: overrides.ok ?? true,
    redirected: overrides.redirected ?? false,
    url: overrides.url ?? url,
    headers: new Headers({
      "content-type": overrides.contentType ?? "application/json; charset=utf-8",
      "content-length": overrides.contentLength ?? String(body.byteLength),
    }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    }),
  };
}

function makeFetcher(fixture, mutate, responseOverrides) {
  const byAddress = new Map(fixture.names.map((name) => [
    fixture.facts[name].address.toLowerCase(),
    name,
  ]));
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const address = url.slice(url.lastIndexOf("/") + 1).toLowerCase();
    const name = byAddress.get(address);
    assert.ok(name, `unexpected test URL ${url}`);
    const type = url.includes("sourcify.dev/")
      ? "sourcify"
      : url.includes("/smart-contracts/") ? "smart" : "address";
    let value = type === "smart"
      ? smartContractResponse(name, fixture.facts[name])
      : type === "sourcify"
        ? sourcifyResponse(fixture.facts[name])
        : addressResponse(fixture.facts[name]);
    value = structuredClone(value);
    mutate?.(type, name, value);
    return jsonResponse(url, value, responseOverrides?.(type, name));
  };
  return { fetcher, calls };
}

function provenanceOptions(fixture) {
  const sourceByPath = new Map(fixture.names.map((name) => [
    fixture.facts[name].path,
    fixture.facts[name].source,
  ]));
  return {
    runProgram: async (executable, args) => {
      assert.equal(executable, "git");
      if (args[0] === "rev-parse") return { stdout: `${commit}\n` };
      if (args[0] === "merge-base" && args[1] === "--is-ancestor") return { stdout: "" };
      if (args[0] === "status") return { stdout: "" };
      if (args[0] === "show" && args[1].endsWith(":package-lock.json")) {
        return { stdout: JSON.stringify({ packages: {} }) };
      }
      if (args[0] === "show") {
        const path = args[1].slice(args[1].indexOf(":") + 1);
        if (!sourceByPath.has(path)) throw new Error("not tracked");
        return { stdout: sourceByPath.get(path) };
      }
      throw new Error(`unexpected command ${args.join(" ")}`);
    },
    sourceReader: async () => { throw new Error("fixture has no dependency sources"); },
    cwd: "/fixture",
  };
}

async function build(fixture, mutate, responseOverrides, provenanceOverrides = {}) {
  const { fetcher, calls } = makeFetcher(fixture, mutate, responseOverrides);
  const result = await buildBlockscoutVerifiedManifestProposal({
    kind: fixture.kind,
    pendingProposal: fixture.pendingProposal,
    compiledArtifacts: fixture.compiledArtifacts,
  }, {
    fetcher,
    clock: () => observedAt,
    ...provenanceOptions(fixture),
    ...provenanceOverrides,
  });
  return { result, calls };
}

test("adopts a fully source-verified core proposal without mutating its pending input", async () => {
  const fixture = makeFixture("core");
  const before = structuredClone(fixture.pendingProposal);
  const { result, calls } = await build(fixture);
  assert.equal(result.schema, "GOGH_BLOCKSCOUT_VERIFIED_MANIFEST_PROPOSAL_V1");
  assert.equal(result.proposalStatus, "VERIFIED_MANIFEST_PROPOSAL");
  assert.equal(result.verificationScope, "ROBINHOOD_CORE");
  assert.equal(result.trustBindings.allExpectedContractsVerified, true);
  assert.equal(result.trustBindings.transactionCapability, "NONE_READ_ONLY_ADOPTION_PROPOSAL");
  assert.equal(result.manifest.sourceVerificationAdoption.gateVersion, 1);
  assert.deepEqual(
    result.manifest.sourceVerificationAdoption.verifiedContracts,
    CORE_CONTRACT_NAMES,
  );
  assert.equal(calls.length, CORE_CONTRACT_NAMES.length * 3);
  for (const call of calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.redirect, "error");
    assert.deepEqual(call.options.headers, { accept: "application/json" });
    assert.ok(call.url.startsWith(`${BLOCKSCOUT_ORIGIN}/api/v2/`)
      || call.url.startsWith("https://sourcify.dev/server/v2/contract/4663/"));
  }
  for (const name of CORE_CONTRACT_NAMES) {
    assert.equal(result.manifest.contracts[name].verificationStatus, "VERIFIED");
    assert.equal(
      result.trustBindings.contracts[name].sourceVerification.fullVerificationEstablished,
      true,
    );
  }
  assert.deepEqual(fixture.pendingProposal, before);
  assert.deepEqual(JSON.parse(renderBlockscoutVerifiedManifestProposal(result)), result);
  const extracted = extractBlockscoutVerifiedManifest(result);
  assert.deepEqual(extracted, result.manifest);
  assert.deepEqual(JSON.parse(renderExtractedVerifiedManifest(extracted)), result.manifest);
});

test("adopts a fully source-verified canary proposal while preserving the immutable shape", async () => {
  const fixture = makeFixture("canary");
  const { result, calls } = await build(fixture);
  assert.equal(result.verificationScope, "ROBINHOOD_CANARY");
  assert.equal(calls.length, CANARY_CONTRACT_NAMES.length * 3);
  assert.deepEqual(Object.keys(result.manifest).sort(), Object.keys(fixture.pendingProposal.manifest).sort());
  for (const name of CANARY_CONTRACT_NAMES) {
    assert.equal(result.manifest.contracts[name].verificationStatus, "VERIFIED");
  }
  assert.equal(result.manifest.configuration.policyConfigured, false);
  assert.equal(result.manifest.provenanceGate.status, "VERIFIED");
});

const smartContractAttacks = [
  ["changed bytecode", "NOT_FULLY_VERIFIED", (value) => { value.is_changed_bytecode = true; }],
  ["verified twin", "VERIFIED_TWIN_REJECTED", (value) => {
    value.verified_twin_address_hash = guardian;
  }],
  ["minimal proxy", "PROXY_REJECTED", (value) => {
    value.minimal_proxy_address_hash = guardian;
  }],
  ["missing viaIR", "MISSING_EVIDENCE", (value) => { delete value.compiler_settings.viaIR; }],
  ["wrong compiler", "COMPILER_SETTINGS_MISMATCH", (value) => {
    value.compiler_version = "v0.8.33+commit.64118f21";
  }],
  ["wrong optimizer", "COMPILER_SETTINGS_MISMATCH", (value) => {
    value.compiler_settings.optimizer.runs = 499;
  }],
  ["wrong source", "SOURCE_IDENTITY_MISMATCH", (value) => {
    value.source_code = `${value.source_code}\n// altered`;
  }],
  ["missing source", "SOURCE_IDENTITY_MISMATCH", (value) => {
    value.additional_sources = [{ file_path: "unexpected.sol", source_code: "contract X {}" }];
  }],
  ["wrong ABI", "ABI_MISMATCH", (value) => { value.abi = "[]"; }],
  ["wrong creation bytecode", "BYTECODE_BINDING_MISMATCH", (value) => {
    value.creation_bytecode = "0x60006000";
  }],
  ["wrong deployment initcode suffix", "BYTECODE_BINDING_MISMATCH", (value) => {
    value.creation_bytecode = `${value.creation_bytecode.slice(0, -2)}ff`;
  }],
  ["wrong runtime bytecode", "BYTECODE_BINDING_MISMATCH", (value) => {
    value.deployed_bytecode = "0x60006000";
  }],
  ["wrong constructor args", "CONSTRUCTOR_BINDING_MISMATCH", (value) => {
    value.constructor_args = "0x00";
  }],
  ["external library", "LIBRARY_BINDING_MISMATCH", (value) => {
    value.external_libraries = [{ name: "Bad", address_hash: guardian }];
  }],
];

for (const [label, code, attack] of smartContractAttacks) {
  test(`fails closed on ${label}`, async () => {
    const fixture = makeFixture("core");
    const target = fixture.names[0];
    await assert.rejects(
      build(fixture, (type, name, value) => {
        if (type === "smart" && name === target) attack(value);
      }),
      (error) => error?.code === code,
    );
  });
}

test("accepts Blockscout partial status only with an exact Sourcify full match", async () => {
  const fixture = makeFixture("core");
  const { result } = await build(fixture, (type, _name, value) => {
    if (type === "smart") {
      value.is_partially_verified = true;
      value.is_fully_verified = false;
      delete value.minimal_proxy_address_hash;
      delete value.compiler_settings.compilationTarget;
      value.compiler_settings.metadata.appendCBOR = true;
      value.compiler_settings.metadata.useLiteralContent = false;
      value.compiler_settings.outputSelection = { "*": { "": ["*"], "*": ["*"] } };
    }
  });
  assert.equal(result.trustBindings.blockscoutPartialAcceptedOnlyWithSourcifyFullMatch, true);
  for (const name of fixture.names) {
    const source = result.trustBindings.contracts[name].sourceVerification;
    assert.equal(source.blockscoutPartiallyVerified, true);
    assert.equal(source.blockscoutFullyVerified, false);
    assert.equal(source.sourcifyFullMatch, true);
  }
});

test("fails closed when Sourcify does not report an exact creation/runtime match", async () => {
  const fixture = makeFixture("core");
  const target = fixture.names[0];
  await assert.rejects(
    build(fixture, (type, name, value) => {
      if (type === "sourcify" && name === target) value.runtimeMatch = "partial_match";
    }),
    (error) => error?.code === "NOT_FULLY_VERIFIED",
  );
});

test("fails closed on Blockscout address proxy or deployment mismatches", async (context) => {
  const attacks = [
    ["implementation", "PROXY_REJECTED", (value) => { value.implementation_address = guardian; }],
    ["wrong creation tx", "DEPLOYMENT_EVIDENCE_MISMATCH", (value) => {
      value.creation_transaction_hash = `0x${"f".repeat(64)}`;
    }],
    ["wrong deployer", "DEPLOYMENT_EVIDENCE_MISMATCH", (value) => {
      value.creator_address_hash = guardian;
    }],
  ];
  for (const [label, code, attack] of attacks) {
    await context.test(label, async () => {
      const fixture = makeFixture("core");
      const target = fixture.names[0];
      await assert.rejects(
        build(fixture, (type, name, value) => {
          if (type === "address" && name === target) attack(value);
        }),
        (error) => error?.code === code,
      );
    });
  }
});

test("fails closed on redirects, final-URL changes, and oversized responses", async (context) => {
  const attacks = [
    ["redirect", "BLOCKSCOUT_RESPONSE_REJECTED", () => ({ redirected: true })],
    ["final URL", "BLOCKSCOUT_RESPONSE_REJECTED", () => ({
      url: `${BLOCKSCOUT_ORIGIN}/api/v2/smart-contracts/${guardian}`,
    })],
    ["oversize", "BLOCKSCOUT_RESPONSE_TOO_LARGE", () => ({
      contentLength: String(4 * 1024 * 1024 + 1),
    })],
  ];
  for (const [label, code, override] of attacks) {
    await context.test(label, async () => {
      const fixture = makeFixture("core");
      await assert.rejects(build(fixture, undefined, (type, name) => (
        type === "smart" && name === fixture.names[0] ? override() : undefined
      )), (error) => error?.code === code);
    });
  }
});

test("rejects already-adopted or build-unbound pending proposals before fetching", async (context) => {
  await context.test("already verified contract", async () => {
    const fixture = makeFixture("core");
    fixture.pendingProposal.manifest.contracts[fixture.names[0]].verificationStatus = "VERIFIED";
    const { fetcher, calls } = makeFetcher(fixture);
    await assert.rejects(buildBlockscoutVerifiedManifestProposal({
      kind: fixture.kind,
      pendingProposal: fixture.pendingProposal,
      compiledArtifacts: fixture.compiledArtifacts,
    }, { fetcher }), (error) => error?.code === "NOT_SOURCE_VERIFICATION_PENDING");
    assert.equal(calls.length, 0);
  });
  await context.test("release commit mismatch", async () => {
    const fixture = makeFixture("core");
    fixture.pendingProposal.trustBindings.releaseGitCommit = "b".repeat(40);
    await assert.rejects(build(fixture), (error) => error?.code === "BUILD_BINDING_MISMATCH");
  });
  await context.test("artifact bytecode mismatch", async () => {
    const fixture = makeFixture("core");
    fixture.compiledArtifacts[fixture.names[0]].bytecode.object = "0x60006000";
    await assert.rejects(build(fixture), (error) => error?.code === "BYTECODE_BINDING_MISMATCH");
  });
  await context.test("unrelated Foundry artifact commit", async () => {
    const fixture = makeFixture("core");
    fixture.pendingProposal.trustBindings.foundryArtifactCommit = "b".repeat(7);
    fixture.pendingProposal.trustBindings.sourceProvenance.foundryArtifactCommit = "b".repeat(7);
    await assert.rejects(build(fixture), (error) => error?.code === "BUILD_BINDING_MISMATCH");
  });
  await context.test("compiled source identity mismatch", async () => {
    const fixture = makeFixture("core");
    fixture.pendingProposal.trustBindings.compiledContracts[fixture.names[0]].sourceSetSha256 =
      `0x${"e".repeat(64)}`;
    await assert.rejects(build(fixture), (error) => error?.code === "BUILD_BINDING_MISMATCH");
  });
});

test("release provenance fails closed before Blockscout on dirty or divergent sources", async (context) => {
  await context.test("dirty release tree", async () => {
    const fixture = makeFixture("core");
    const base = provenanceOptions(fixture);
    const { fetcher, calls } = makeFetcher(fixture);
    await assert.rejects(buildBlockscoutVerifiedManifestProposal({
      kind: fixture.kind,
      pendingProposal: fixture.pendingProposal,
      compiledArtifacts: fixture.compiledArtifacts,
    }, {
      fetcher,
      clock: () => observedAt,
      ...base,
      runProgram: async (executable, args, options) => (
        args[0] === "status" ? { stdout: " M contracts/src/BrokerPolicyModule.sol\n" }
          : base.runProgram(executable, args, options)
      ),
    }), (error) => error?.code === "DIRTY_RELEASE_TREE");
    assert.equal(calls.length, 0);
  });
  await context.test("release source differs from compiled metadata", async () => {
    const fixture = makeFixture("core");
    const base = provenanceOptions(fixture);
    await assert.rejects(build(fixture, undefined, undefined, {
      ...base,
      runProgram: async (executable, args, options) => {
        const result = await base.runProgram(executable, args, options);
        if (args[0] === "show" && args[1].endsWith(`:${fixture.facts[fixture.names[0]].path}`)) {
          return { stdout: `${result.stdout}\n// divergence` };
        }
        return result;
      },
    }), (error) => error?.code === "RELEASE_SOURCE_MISMATCH");
  });
});

test("rejects Proxy input and accessor-bearing evidence without fetching", async () => {
  const fixture = makeFixture("core");
  const proxied = new Proxy(fixture.pendingProposal, {});
  await assert.rejects(buildBlockscoutVerifiedManifestProposal({
    kind: "core",
    pendingProposal: proxied,
    compiledArtifacts: fixture.compiledArtifacts,
  }, { fetcher: async () => { throw new Error("must not fetch"); } }),
  (error) => error?.code === "INVALID_SCHEMA");

  let invoked = false;
  Object.defineProperty(fixture.pendingProposal, "evil", {
    enumerable: true,
    get() { invoked = true; return true; },
  });
  await assert.rejects(buildBlockscoutVerifiedManifestProposal({
    kind: "core",
    pendingProposal: fixture.pendingProposal,
    compiledArtifacts: fixture.compiledArtifacts,
  }, { fetcher: async () => { throw new Error("must not fetch"); } }),
  (error) => error?.code === "INVALID_SCHEMA");
  assert.equal(invoked, false);
});

test("CLI argument parser is exact and non-extensible", () => {
  assert.deepEqual(parseSourceVerificationArguments([
    "--kind", "core", "--proposal", "/tmp/pending.json",
  ]), { kind: "core", proposalPath: "/tmp/pending.json" });
  assert.throws(() => parseSourceVerificationArguments([
    "--kind", "core", "--proposal", "x", "--url", "https://evil.example",
  ]), (error) => error?.code === "INVALID_ARGUMENTS");
  assert.throws(() => parseSourceVerificationArguments([
    "--kind", "core", "--kind", "canary", "--proposal", "x",
  ]), (error) => error?.code === "INVALID_ARGUMENTS");
  assert.deepEqual(parseVerifiedManifestExtractorArguments([
    "--verified-proposal", "/tmp/verified.json",
  ]), { verifiedProposalPath: "/tmp/verified.json" });
  assert.throws(() => parseVerifiedManifestExtractorArguments([
    "--verified-proposal", "a", "--output", "x",
  ]), (error) => error?.code === "INVALID_ARGUMENTS");
});

test("bounded JSON reader refuses a symlink instead of lstat/readFile racing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gogh-source-gate-"));
  const target = join(directory, "target.json");
  const link = join(directory, "link.json");
  await writeFile(target, "{}", "utf8");
  await symlink(target, link);
  try {
    await assert.rejects(readSourceVerificationJsonFile(link),
      (error) => error?.code === "INVALID_INPUT_FILE");
  } finally {
    await unlink(link);
    await unlink(target);
    await rmdir(directory);
  }
});

test("extractor rejects evidence/adoption tampering", async (context) => {
  const fixture = makeFixture("core");
  const { result } = await build(fixture);
  await context.test("evidence", () => {
    const altered = structuredClone(result);
    altered.trustBindings.contracts[fixture.names[0]].sourceVerification.viaIR = false;
    assert.throws(() => extractBlockscoutVerifiedManifest(altered),
      (error) => error?.code === "INVALID_VERIFIED_PROPOSAL");
  });
  await context.test("adoption evidence hash", () => {
    const altered = structuredClone(result);
    altered.manifest.sourceVerificationAdoption.verificationEvidenceSha256 =
      `0x${"f".repeat(64)}`;
    assert.throws(() => extractBlockscoutVerifiedManifest(altered),
      (error) => error?.code === "SOURCE_VERIFICATION_HASH_MISMATCH");
  });
  await context.test("contract set", () => {
    const altered = structuredClone(result);
    altered.manifest.sourceVerificationAdoption.verifiedContracts.reverse();
    assert.throws(() => extractBlockscoutVerifiedManifest(altered),
      (error) => error?.code === "INVALID_SOURCE_VERIFICATION_ADOPTION");
  });
  await context.test("source hashes even after attacker-controlled rehashing", () => {
    const altered = structuredClone(result);
    const name = fixture.names[0];
    const source = altered.trustBindings.contracts[name].sourceVerification;
    const path = source.filePath;
    source.sourceHashes[path] = `0x${"f".repeat(64)}`;
    source.sourceSetSha256 = sourceVerificationCanonicalSha256(source.sourceHashes);
    const release = altered.trustBindings.releaseSourceProvenance;
    release.trackedSourceHashes[path] = source.sourceHashes[path];
    release.trackedSourceSetSha256 = sourceVerificationCanonicalSha256(
      release.trackedSourceHashes,
    );
    const evidenceHash = sourceVerificationCanonicalSha256({
      releaseSourceProvenance: release,
      contracts: altered.trustBindings.contracts,
    });
    altered.manifest.sourceVerificationAdoption.verificationEvidenceSha256 = evidenceHash;
    altered.trustBindings.sourceVerificationAdoption.verificationEvidenceSha256 = evidenceHash;
    assert.throws(() => extractBlockscoutVerifiedManifest(altered),
      (error) => error?.code === "SOURCE_IDENTITY_MISMATCH");
  });
  await context.test("release package-lock content hash", () => {
    const altered = structuredClone(result);
    altered.trustBindings.releaseSourceProvenance.packageLockSha256 = `0x${"f".repeat(64)}`;
    const evidenceHash = sourceVerificationCanonicalSha256({
      releaseSourceProvenance: altered.trustBindings.releaseSourceProvenance,
      contracts: altered.trustBindings.contracts,
    });
    altered.manifest.sourceVerificationAdoption.verificationEvidenceSha256 = evidenceHash;
    altered.trustBindings.sourceVerificationAdoption.verificationEvidenceSha256 = evidenceHash;
    assert.throws(() => extractBlockscoutVerifiedManifest(altered),
      (error) => error?.code === "SOURCE_VERIFICATION_HASH_MISMATCH");
  });
});

test("extractor permits only the exact pending-to-verified manifest transition", async (context) => {
  const core = (await build(makeFixture("core"))).result;
  const canary = (await build(makeFixture("canary"))).result;
  const attacks = [
    ["core autonomous feature", core, (manifest) => {
      manifest.featureFlags.ENABLE_AUTONOMOUS_PURCHASES = true;
    }],
    ["core guardian", core, (manifest) => { manifest.protocolGuardian = deployer; }],
    ["core canonical identity", core, (manifest) => {
      manifest.canonicalCollection = guardian;
    }],
    ["canary configuration", canary, (manifest) => {
      manifest.configuration.agentAuthorized = true;
    }],
    ["canary identity", canary, (manifest) => {
      manifest.expectedOwnerAtPreparation = deployer;
    }],
  ];
  for (const [label, original, attack] of attacks) {
    await context.test(label, () => {
      const altered = structuredClone(original);
      attack(altered.manifest);
      assert.throws(() => extractBlockscoutVerifiedManifest(altered),
        (error) => error?.code === "INVALID_VERIFIED_PROPOSAL");
    });
  }
});

test("raw manifest adoption rejects post-extraction security-field hand flips", async () => {
  const fixture = makeFixture("core");
  const { result } = await build(fixture);
  assert.doesNotThrow(() => requireVerifiedManifestAdoption(
    result.manifest,
    CORE_CONTRACT_NAMES,
  ));
  const altered = structuredClone(result.manifest);
  altered.featureFlags.ENABLE_AUTONOMOUS_MINTS = true;
  assert.throws(() => requireVerifiedManifestAdoption(altered, CORE_CONTRACT_NAMES),
    (error) => error?.code === "SOURCE_VERIFICATION_HASH_MISMATCH");
});
