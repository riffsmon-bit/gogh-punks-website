import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  computeAcquisitionIntentHash,
  evaluateApprovalCanary,
  validateApprovalManifest,
} from "../scripts/canary-approval-preflight.mjs";

const now = Date.parse("2026-08-20T16:05:00.000Z");
const owner = "0x1111111111111111111111111111111111111111";
const account = "0x2222222222222222222222222222222222222222";
const adapter = "0x3333333333333333333333333333333333333333";
const venue = "0x4444444444444444444444444444444444444444";
const collection = "0x5555555555555555555555555555555555555555";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const emptyAdapterDataHash = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const hash = (byte) => `0x${byte.repeat(64)}`;

function featureFlags() {
  return {
    ENABLE_SCOUT_MODE: true,
    ENABLE_APPROVAL_PURCHASES: true,
    ENABLE_AUTONOMOUS_PURCHASES: false,
    ENABLE_AUTONOMOUS_MINTS: false,
    ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
    ENABLE_SELLING: false,
    ENABLE_AUTONOMOUS_SELLING: false,
  };
}

function deployedManifest() {
  const contracts = {};
  for (const [index, name] of [
    "ArtAdapterRegistry",
    "ArtAgentRegistry",
    "BrokerPolicyModule",
    "GoghPunkAccountV1",
    "GoghPunkAccountRegistry",
  ].entries()) {
    contracts[name] = {
      address: `0x${["6", "7", "8", "9", "a"][index].repeat(40)}`,
      runtimeBytecodeHash: hash(String(index + 1)),
      verificationStatus: "VERIFIED",
    };
  }
  return {
    status: "DEPLOYED",
    chain: { chainId: 4663 },
    canonicalCollection: "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
    gitCommit: "a".repeat(40),
    featureFlags: featureFlags(),
    contracts,
  };
}

function readyConfig() {
  const target = {
    opportunityType: "FREE_MINT",
    adapter,
    venue,
    collection,
    selector: "0xabcdef12",
    assetStandard: "ERC721",
    tokenId: "42",
    amount: "1",
    currency: zeroAddress,
    expectedPriceWei: "0",
    maximumPriceWei: "0",
    valueWei: "0",
    maxSlippageBps: 0,
  };
  const permissionTarget = {
    adapter,
    venue,
    collection,
    selector: target.selector,
    assetStandard: target.assetStandard,
    tokenId: target.tokenId,
    amount: "1",
    currency: zeroAddress,
  };
  const intent = {
    account,
    chainId: 4663,
    expectedOwner: owner,
    nonce: "7",
    policyVersion: 3,
    opportunityType: "FREE_MINT",
    assetStandard: "ERC721",
    adapter,
    venue,
    collection,
    tokenId: "42",
    assetAmount: "1",
    currency: zeroAddress,
    expectedPrice: "0",
    maxPrice: "0",
    maxSlippageBps: 0,
    createdAt: Date.parse("2026-08-20T16:04:30.000Z") / 1_000,
    expiresAt: Date.parse("2026-08-20T16:06:00.000Z") / 1_000,
    opportunityId: hash("1"),
    reasoningHash: hash("2"),
    adapterCodeHash: hash("7"),
    adapterDataHash: emptyAdapterDataHash,
    intentHash: hash("c"),
  };
  intent.intentHash = computeAcquisitionIntentHash(intent);
  return {
    schemaVersion: 1,
    chainId: 4663,
    collection: "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
    accountMode: "APPROVAL_REQUIRED",
    globalFeatureFlags: featureFlags(),
    mintControls: {
      ownerApprovedMints: true,
      autonomousFreeMints: false,
      autonomousPaidMints: false,
    },
    punk: {
      tokenId: "317",
      expectedOwner: owner,
      expectedAccount: account,
      accountDerivations: [
        { method: "canonical-registry", account, evidenceHash: hash("a") },
        { method: "independent-client", account, evidenceHash: hash("b") },
      ],
    },
    target,
    intent,
    evidence: {
      generatedAt: "2026-08-20T16:04:50.000Z",
      confirmations: 20,
      pinnedBlock: {
        number: 1_000,
        hash: hash("d"),
        timestamp: "2026-08-20T16:04:10.000Z",
      },
      rpcPrimary: {
        provider: "primary",
        url: "https://primary.example",
        chainId: 4663,
        blockNumber: 1_000,
        blockHash: hash("d"),
        blockTimestamp: "2026-08-20T16:04:10.000Z",
        chainHead: 1_020,
        punkTokenId: "317",
        currentOwner: owner,
        resolvedAccount: account,
        observedAt: "2026-08-20T16:04:40.000Z",
        evidenceHash: hash("e"),
      },
      rpcSecondary: {
        provider: "secondary",
        url: "https://secondary.example",
        chainId: 4663,
        blockNumber: 1_000,
        blockHash: hash("d"),
        blockTimestamp: "2026-08-20T16:04:10.000Z",
        chainHead: 1_021,
        punkTokenId: "317",
        currentOwner: owner,
        resolvedAccount: account,
        observedAt: "2026-08-20T16:04:42.000Z",
        evidenceHash: hash("f"),
      },
      permissions: {
        account,
        ...permissionTarget,
        adapterAllowed: true,
        venueAllowed: true,
        mintContractAllowed: true,
        collectionAllowed: true,
        selectorAllowed: true,
        currencyAllowed: true,
        collectionDenied: false,
        selectorDenied: false,
        policyVersion: 3,
        maximumValueWei: "0",
        permissionSetHash: hash("9"),
        counts: {
          adapters: 1,
          venues: 1,
          mintContracts: 1,
          collections: 1,
          selectors: 1,
          currencies: 1,
        },
        observedAtBlock: 1_000,
      },
      code: Object.fromEntries([
        ["account", account],
        ["adapter", adapter],
        ["venue", venue],
        ["collection", collection],
      ].map(([name, codeAddress], index) => [name, {
        address: codeAddress,
        expectedRuntimeCodeHash: hash(String(index + 6)),
        observedRuntimeCodeHash: hash(String(index + 6)),
        observedAtBlock: 1_000,
      }])),
      simulation: {
        status: "PASS",
        blockNumber: 1_000,
        blockHash: hash("d"),
        simulatedAt: "2026-08-20T16:04:45.000Z",
        evidenceHash: hash("a"),
        traceHash: hash("b"),
        from: owner,
        executionAccount: account,
        executionSelector: target.selector,
        intent: { ...intent },
        nftRecipient: account,
        nativePaymentWei: "0",
        approvalChanges: [],
        unexpectedCalls: [],
      },
    },
  };
}

test("current authoritative manifest blocks the approval canary scaffold", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../deployments/robinhood.json", import.meta.url),
    "utf8",
  ));
  const failures = validateApprovalManifest(manifest);
  assert.match(failures.join("\n"), /must be DEPLOYED.*NOT_DEPLOYED/);
});

test("one exact zero-payment bundle completes only the evidence checklist", () => {
  const result = evaluateApprovalCanary(deployedManifest(), readyConfig(), { now });
  assert.deepEqual(result.failures, []);
  assert.equal(result.checklistComplete, true);
  assert.equal(result.ready, false);
  assert.equal(result.summary.stage, "APPROVAL_REQUIRED");
  assert.equal(result.summary.status, "EVIDENCE_CHECKLIST_ONLY");
  assert.equal(result.summary.authenticityVerified, false);
  assert.equal(result.summary.transactionAuthorized, false);
  assert.equal(result.summary.signingPerformed, false);
  assert.equal(result.summary.submissionPerformed, false);
});

test("approval preflight fails closed on autonomy, payment, scope, or stale evidence", () => {
  const cases = [
    ["autonomous purchases", (value) => { value.globalFeatureFlags.ENABLE_AUTONOMOUS_PURCHASES = true; }],
    ["paid target", (value) => { value.target.valueWei = "1"; }],
    ["more than one NFT", (value) => { value.target.amount = "2"; }],
    ["unknown token", (value) => { value.target.tokenId = "REPLACE"; }],
    ["unknown standard", (value) => { value.target.assetStandard = "UNKNOWN"; }],
    ["broad permission", (value) => { value.evidence.permissions.selectorAllowed = false; }],
    ["changed code", (value) => { value.evidence.code.adapter.observedRuntimeCodeHash = hash("9"); }],
    ["one RPC origin", (value) => { value.evidence.rpcSecondary.url = value.evidence.rpcPrimary.url; }],
    ["RPC block disagreement", (value) => { value.evidence.rpcSecondary.blockHash = hash("9"); }],
    ["stale owner", (value) => { value.evidence.rpcSecondary.currentOwner = venue; }],
    ["unexpected simulation call", (value) => { value.evidence.simulation.unexpectedCalls.push("call"); }],
    ["stale simulation", (value) => { value.evidence.simulation.simulatedAt = "2026-08-20T16:02:00.000Z"; }],
    ["simulation predates intent", (value) => { value.evidence.simulation.simulatedAt = "2026-08-20T16:04:20.000Z"; }],
    ["stale pinned block", (value) => { value.evidence.pinnedBlock.timestamp = "2026-08-20T16:02:00.000Z"; }],
    ["ambiguous timestamp", (value) => { value.evidence.generatedAt = "2026-08-20 16:04:50Z"; }],
    ["long expiry", (value) => { value.intent.expiresAt += 1_000; }],
    ["uint256 overflow", (value) => { value.intent.nonce = (1n << 256n).toString(); }],
    ["wrong empty data hash", (value) => { value.intent.adapterDataHash = hash("8"); }],
    ["wrong typed digest", (value) => { value.intent.intentHash = hash("8"); }],
    ["simulation intent mismatch", (value) => { value.evidence.simulation.intent.tokenId = "43"; }],
    ["missing canonical field", (value) => { delete value.evidence.simulation.intent.createdAt; }],
    ["signing material", (value) => { value.signature = "0xdead"; }],
    ["nested signature alias", (value) => { value.evidence.simulation.ownerSignature = "0xdead"; }],
    ["adapter data", (value) => { value.adapterData = "0xdead"; }],
  ];
  for (const [label, mutate] of cases) {
    const config = readyConfig();
    mutate(config);
    const result = evaluateApprovalCanary(deployedManifest(), config, { now });
    assert.equal(result.checklistComplete, false, label);
    assert.equal(result.ready, false, label);
    assert.ok(result.failures.length > 0, label);
  }
});

test("approval scaffold contains no signing, submission, deployment, or RPC execution path", async () => {
  const [source, ignore] = await Promise.all([
    readFile(new URL("../scripts/canary-approval-preflight.mjs", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /createWalletClient|sendTransaction|signTypedData|eth_sendRawTransaction/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.match(source, /status: "EVIDENCE_CHECKLIST_ONLY"/);
  assert.match(source, /authenticityVerified: false/);
  assert.match(source, /transactionAuthorized: false/);
  assert.match(ignore, /^ops\/canary-approval\.json$/m);
});
