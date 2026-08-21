import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { LiveApprovalPreflightError } from "../scripts/canary-approval-live-preflight.mjs";
import { sourceVerificationCanonicalSha256 } from
  "../broker/src/recommendation/source-verification-adoption.mjs";
import {
  AUTHORITATIVE_MANIFEST_PATH,
  AUTHORITATIVE_CANARY_MANIFEST_PATH,
  MAX_CONFIG_BUNDLE_BYTES,
  MAX_CONFIGURATION_EVIDENCE_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_PROPOSAL_BYTES,
  parseLivePreflightArguments,
  readBoundedJsonFile,
  readRpcEndpoints,
  renderSanitizedFailure,
  runCanaryApprovalLivePreflight,
} from "../scripts/run-canary-approval-live-preflight.mjs";

const hash = (byte) => `0x${byte.repeat(64)}`;
const address = (digit) => `0x${digit.repeat(40)}`;

function sourceVerificationAdoption(verifiedContracts, pendingNibble, evidenceNibble) {
  return {
    schema: "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1",
    gateSchema: "GOGH_BLOCKSCOUT_VERIFIED_MANIFEST_PROPOSAL_V1",
    gateVersion: 1,
    chainId: 4663,
    explorerOrigin: "https://robinhoodchain.blockscout.com",
    pendingProposalSha256: hash(pendingNibble),
    pendingManifestSha256: hash("c"),
    pendingManifestNotes: "Pending manifest fixture.",
    verificationEvidenceSha256: hash(evidenceNibble),
    verifiedContracts: [...verifiedContracts],
    observedAt: "2026-08-20T15:58:00.000Z",
  };
}

function passResult() {
  const coreAdoption = sourceVerificationAdoption([
    "ArtAdapterRegistry", "ArtAgentRegistry", "BrokerPolicyModule",
    "GoghPunkAccountV1", "GoghPunkAccountRegistry",
  ], "8", "9");
  const canaryAdoption = sourceVerificationAdoption([
    "GoghOneShotCanaryArt", "GoghOneShotCanaryMintAdapter",
  ], "a", "b");
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
      simulatedCaller: address("2"),
      adapterData: "0x",
      ownerSignature: "0x",
      agentRelayerUsed: false,
    },
    evidenceHashes: {
      algorithms: {
        artifactEvidence: "SHA256_CANONICAL_JSON_V1",
        configBundleReview: "KECCAK256_CANONICAL_JSON_V1",
      },
      proposal: hash("f"),
      proposalArtifact: hash("1"),
      coreManifest: hash("2"),
      canaryManifest: hash("3"),
      coreSourceVerificationAdoption: sourceVerificationCanonicalSha256(coreAdoption),
      canarySourceVerificationAdoption: sourceVerificationCanonicalSha256(canaryAdoption),
      configBundleReview: hash("4"),
      configBundleArtifact: hash("5"),
      configurationReceiptEvidence: hash("6"),
      configurationReceiptEvidenceArtifact: hash("7"),
    },
    chainId: 4663,
    pinnedBlock: {
      number: "1234",
      hash: hash("a"),
      timestamp: "1777777777",
      confirmations: 20,
    },
    punk: {
      tokenId: "317",
      account: address("1"),
      currentOwner: address("2"),
      accountRuntimeCodeHash: hash("8"),
    },
    target: {
      adapter: address("3"),
      venue: address("4"),
      collection: address("5"),
      selector: "0x12345678",
      adapterCodeHash: hash("b"),
      venueCodeHash: hash("c"),
      collectionCodeHash: hash("d"),
    },
    infrastructure: {
      canonicalERC6551Registry: "0x000000006551c19487814612e58fe06813775758",
      canonicalERC6551RegistryRuntimeCodeHash:
        "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735",
    },
    sourceVerification: {
      status: "VERIFIED_ADOPTIONS_BOUND",
      coreAdoption,
      coreAdoptionSha256: sourceVerificationCanonicalSha256(coreAdoption),
      canaryAdoption,
      canaryAdoptionSha256: sourceVerificationCanonicalSha256(canaryAdoption),
    },
    configurationHistory: {
      status: "EXACT_13_CALL_DUAL_RPC_VERIFIED",
      transactionCount: 13,
      preconfigurationBlock: "1200",
      lastTransactionBlock: "1220",
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
      number: "1254",
      hash: hash("9"),
      timestamp: "1777777777",
      primaryHead: "1255",
      secondaryHead: "1254",
      headSkew: "1",
      currentOwner: address("2"),
      ownerType: "EOA",
      nonce: "0",
      policyVersion: "11",
      permissionGeneration: "1",
      simulation: "READ_ONLY_ETH_CALL_PASS",
      exactState: {
        accountRuntimeCodeHash: hash("8"),
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
    timing: {
      checkedAt: "1777777777",
      expiresAt: "1777777837",
      remainingSeconds: "60",
      minimumSubmissionMarginSeconds: 30,
    },
    intentDigest: hash("e"),
    simulation: "READ_ONLY_ETH_CALL_PASS",
  };
}

function environment() {
  return {
    ROBINHOOD_RPC_URL: "https://primary-user:primary-secret@rpc.first-provider.example/v1/key-a",
    ROBINHOOD_SECONDARY_RPC_URL: "https://rpc.second-provider.test/v2?key=secondary-secret",
  };
}

test("parses only one exact proposal path and bounded confirmations", () => {
  const required = [
    "--proposal", "ops/proposal.json",
    "--config-bundle", "ops/config.json",
    "--configuration-evidence", "ops/receipts.json",
  ];
  assert.deepEqual(parseLivePreflightArguments(required), {
    proposal: "ops/proposal.json",
    configBundle: "ops/config.json",
    configurationEvidence: "ops/receipts.json",
    confirmations: 20,
  });
  assert.deepEqual(parseLivePreflightArguments([
    ...required, "--confirmations", "128",
  ]), {
    proposal: "ops/proposal.json",
    configBundle: "ops/config.json",
    configurationEvidence: "ops/receipts.json",
    confirmations: 128,
  });
  for (const argv of [
    [],
    ["--manifest", "manifest.json", ...required],
    [...required, "--proposal", "second.json"],
    [...required, "--confirmations", "11"],
    [...required, "--confirmations", "129"],
    ["--proposal", "proposal.*.json", ...required.slice(2)],
    ["--proposal", "proposal.txt", ...required.slice(2)],
    ["--proposal", " proposal.json", ...required.slice(2)],
    [...required, "--private-key", hash("1")],
  ]) {
    assert.throws(() => parseLivePreflightArguments(argv));
  }
});

test("requires two HTTPS endpoints from distinct normalized providers", () => {
  const endpoints = readRpcEndpoints(environment());
  assert.equal(endpoints.primary.href.startsWith("https://"), true);
  assert.equal(endpoints.secondary.href.startsWith("https://"), true);

  assert.throws(() => readRpcEndpoints({
    ROBINHOOD_RPC_URL: "http://rpc.first.example",
    ROBINHOOD_SECONDARY_RPC_URL: "https://rpc.second.test",
  }), /HTTPS URL/);
  assert.throws(() => readRpcEndpoints({
    ROBINHOOD_RPC_URL: "https://user:key-a@rpc.provider.example/a",
    ROBINHOOD_SECONDARY_RPC_URL: "https://other:key-b@rpc.provider.example/b",
  }), /distinct HTTPS providers/);
  assert.throws(() => readRpcEndpoints({
    ROBINHOOD_RPC_URL: "https://rpc-1.shared-provider.example/a",
    ROBINHOOD_SECONDARY_RPC_URL: "https://rpc-2.shared-provider.example/b",
  }), /distinct HTTPS providers/);
  assert.throws(() => readRpcEndpoints({
    ROBINHOOD_RPC_URL: "https://rpc.first.example/#fragment",
    ROBINHOOD_SECONDARY_RPC_URL: "https://rpc.second.test/",
  }), /without a fragment/);
});

test("reads only the exact proposal and authoritative manifest then calls the genuine boundary", async () => {
  const proposalArtifact = { proposal: "artifact" };
  const manifest = { manifest: "authoritative" };
  const canaryManifest = { manifest: "canary" };
  const configBundleArtifact = { bundle: "config" };
  const configurationEvidenceArtifact = { receipts: "evidence" };
  const reads = [];
  const clients = [];
  let attestorOptions;
  const result = passResult();

  const observed = await runCanaryApprovalLivePreflight([
    "--proposal", "artifacts/owner-review.json",
    "--config-bundle", "artifacts/config.json",
    "--configuration-evidence", "artifacts/receipts.json",
    "--confirmations", "20",
  ], {
    cwd: "/workspace",
    env: environment(),
    nowSeconds: 1_777_777_777,
    readJson: async (path, maximumBytes, label) => {
      reads.push({ path, maximumBytes, label });
      if (path === AUTHORITATIVE_MANIFEST_PATH) return manifest;
      if (path === AUTHORITATIVE_CANARY_MANIFEST_PATH) return canaryManifest;
      if (path.endsWith("config.json")) return configBundleArtifact;
      if (path.endsWith("receipts.json")) return configurationEvidenceArtifact;
      return proposalArtifact;
    },
    clientFactory: ({ url, chain, role }) => {
      const client = { role, chainId: chain.id, marker: Symbol(role) };
      clients.push({ url, chain, role, client });
      return client;
    },
    attestor: async (options) => {
      attestorOptions = options;
      return result;
    },
  });

  assert.deepEqual(observed, result, "wrapper must return an immutable-data snapshot of READ_ONLY_PASS");
  assert.deepEqual(reads, [
    {
      path: resolve("/workspace", "artifacts/owner-review.json"),
      maximumBytes: MAX_PROPOSAL_BYTES,
      label: "proposal artifact",
    },
    {
      path: AUTHORITATIVE_MANIFEST_PATH,
      maximumBytes: MAX_MANIFEST_BYTES,
      label: "authoritative manifest",
    },
    {
      path: AUTHORITATIVE_CANARY_MANIFEST_PATH,
      maximumBytes: MAX_MANIFEST_BYTES,
      label: "authoritative canary manifest",
    },
    {
      path: resolve("/workspace", "artifacts/config.json"),
      maximumBytes: MAX_CONFIG_BUNDLE_BYTES,
      label: "configuration bundle artifact",
    },
    {
      path: resolve("/workspace", "artifacts/receipts.json"),
      maximumBytes: MAX_CONFIGURATION_EVIDENCE_BYTES,
      label: "configuration receipt evidence artifact",
    },
  ]);
  assert.equal(clients.length, 2);
  assert.notEqual(clients[0].client, clients[1].client);
  assert.equal(clients[0].chain.id, 4663);
  assert.equal(clients[1].chain.id, 4663);
  assert.deepEqual(attestorOptions, {
    proposalArtifact,
    manifest,
    canaryManifest,
    configBundleArtifact,
    configurationEvidenceArtifact,
    primaryClient: clients[0].client,
    secondaryClient: clients[1].client,
    confirmations: 20,
    nowSeconds: 1_777_777_777,
  });
});

test("bounded reader rejects empty, oversized, invalid, directory, and missing inputs", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "gogh-live-preflight-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const validPath = resolve(directory, "valid.json");
  const invalidPath = resolve(directory, "invalid.json");
  const oversizedPath = resolve(directory, "oversized.json");
  const emptyPath = resolve(directory, "empty.json");
  await Promise.all([
    writeFile(validPath, "{\"ok\":true}"),
    writeFile(invalidPath, "not-json"),
    writeFile(oversizedPath, "{\"value\":\"1234567890\"}"),
    writeFile(emptyPath, ""),
  ]);

  assert.deepEqual(await readBoundedJsonFile(validPath, 100, "fixture"), { ok: true });
  await assert.rejects(readBoundedJsonFile(invalidPath, 100, "fixture"), /not valid JSON/);
  await assert.rejects(readBoundedJsonFile(oversizedPath, 10, "fixture"), /size limit/);
  await assert.rejects(readBoundedJsonFile(emptyPath, 100, "fixture"), /nonempty regular file/);
  await assert.rejects(readBoundedJsonFile(directory, 100, "fixture"), /regular file/);
  await assert.rejects(readBoundedJsonFile(resolve(directory, "missing.json"), 100, "fixture"),
    /could not be read/);
});

test("fails closed if the attestor does not return the canonical read-only result", async () => {
  const requiredArgs = [
    "--proposal", "proposal.json", "--config-bundle", "config.json",
    "--configuration-evidence", "receipts.json",
  ];
  const dependencies = {
    cwd: "/workspace",
    env: environment(),
    readJson: async () => ({}),
    clientFactory: ({ role }) => ({ role }),
    attestor: async () => ({ ...passResult(), transactionAuthorized: true }),
  };
  await assert.rejects(
    runCanaryApprovalLivePreflight(requiredArgs, dependencies),
    /canonical read-only pass/,
  );
  await assert.rejects(
    runCanaryApprovalLivePreflight(requiredArgs, {
      ...dependencies,
      attestor: async () => {
        const result = passResult();
        result.sourceVerification.coreAdoption.pendingProposalSha256 = hash("f");
        return result;
      },
    }),
    /source verification adoption|canonical read-only pass/,
  );
  await assert.rejects(
    runCanaryApprovalLivePreflight(requiredArgs, {
      ...dependencies,
      unexpected: true,
    }),
    /dependencies.unexpected is not allowed/,
  );
  await assert.rejects(
    runCanaryApprovalLivePreflight([...requiredArgs, "--confirmations", "32"], {
      ...dependencies,
      attestor: async () => passResult(),
    }),
    /canonical read-only pass/,
  );
  await assert.rejects(
    runCanaryApprovalLivePreflight(requiredArgs, {
      ...dependencies,
      attestor: async () => ({
        ...passResult(),
        punk: { ...passResult().punk, account: "https://rpc.example/secret" },
      }),
    }),
    /Punk account is not a nonzero address/,
  );
});

test("sanitized failures never expose RPC credentials or upstream messages", () => {
  const secret = "https://user:super-secret@rpc.provider.example/key";
  const liveFailure = renderSanitizedFailure(
    new LiveApprovalPreflightError("LIVE_READ_FAILED", `request failed at ${secret}`),
  );
  assert.equal(liveFailure, "READ_ONLY_FAIL [LIVE_READ_FAILED]: live approval preflight failed closed\n");
  assert.equal(liveFailure.includes("super-secret"), false);

  const unexpected = renderSanitizedFailure(new Error(secret));
  assert.equal(unexpected, "READ_ONLY_FAIL [UNEXPECTED_FAILURE]: live approval preflight failed closed\n");
  assert.equal(unexpected.includes("provider.example"), false);
});

test("wrapper source contains no wallet, key, signing, sending, deployment, or write path", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("../scripts/run-canary-approval-live-preflight.mjs", import.meta.url),
    "utf8",
  ));
  assert.doesNotMatch(source, /createWalletClient|sendTransaction|writeContract|signTypedData/);
  assert.doesNotMatch(source, /privateKeyToAccount|mnemonicToAccount|eth_sendRawTransaction/);
  assert.doesNotMatch(source, /writeFile|appendFile|deployContract/);
  assert.match(source, /attestLiveApproval/);
  assert.match(source, /AUTHORITATIVE_MANIFEST_PATH/);
});
