import assert from "node:assert/strict";
import test from "node:test";

import { sourceVerificationCanonicalSha256 } from
  "../broker/src/recommendation/source-verification-adoption.mjs";
import { autonomyV2Status } from "../netlify/functions/broker-autonomy-v2-status.mjs";

const A = (digit) => `0x${digit.repeat(40)}`;
const H = (digit) => `0x${digit.repeat(64)}`;

function deployedManifest({ configured = true } = {}) {
  const record = (digit) => ({
    address: A(digit),
    runtimeBytecodeHash: H(digit),
    deploymentTransaction: H(String(9 - Number(digit))),
    receiptStatus: "SUCCESS",
    verificationStatus: "VERIFIED",
  });
  const manifest = {
    schema: "GOGH_AUTOMATED_SEADROP_V2_DEPLOYMENT_MANIFEST",
    version: 1,
    status: "DEPLOYED",
    chainId: 4663,
    sourceVerificationAdoption: null,
    contracts: {
      AutomatedSeaDropFreeMintAdapter: record("1"),
      BrokerPolicyModuleV2: record("2"),
      GoghPunkAccountV2: record("3"),
      GoghPunkAccountRegistryV2: record("4"),
    },
    configuration: {
      adapterRegistered: configured,
      featureFlagsEnabled: configured,
      globalAgentApproved: configured,
      workerEnabled: configured,
    },
    authorization: { automaticSubmissionEnabled: configured },
    notes: "Pending source verification",
  };
  const pending = structuredClone(manifest);
  for (const name of Object.keys(pending.contracts)) {
    pending.contracts[name].verificationStatus = "NOT_SUBMITTED";
  }
  manifest.sourceVerificationAdoption = {
    schema: "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1",
    gateSchema: "GOGH_BLOCKSCOUT_VERIFIED_MANIFEST_PROPOSAL_V1",
    gateVersion: 1,
    chainId: 4663,
    explorerOrigin: "https://robinhoodchain.blockscout.com",
    pendingProposalSha256: H("a"),
    pendingManifestSha256: sourceVerificationCanonicalSha256(pending),
    pendingManifestNotes: pending.notes,
    verificationEvidenceSha256: H("b"),
    verifiedContracts: [
      "AutomatedSeaDropFreeMintAdapter", "BrokerPolicyModuleV2",
      "GoghPunkAccountV2", "GoghPunkAccountRegistryV2",
    ],
    observedAt: "2026-08-23T12:00:00.000Z",
  };
  return manifest;
}

function sourcePendingManifest() {
  const manifest = deployedManifest();
  manifest.sourceVerificationAdoption = null;
  for (const name of Object.keys(manifest.contracts)) {
    manifest.contracts[name].verificationStatus = "NOT_SUBMITTED";
  }
  manifest.configuration = {
    adapterRegistered: false,
    featureFlagsEnabled: false,
    globalAgentApproved: false,
    workerEnabled: false,
  };
  manifest.authorization.automaticSubmissionEnabled = false;
  return manifest;
}

function configurationPendingManifest() {
  return deployedManifest({ configured: false });
}

test("an absent V2 deployment keeps every browser automation capability closed", async () => {
  const result = autonomyV2Status({});
  assert.deepEqual(result, {
    status: "PREPARING_V2",
    capability: false,
    setupTransactionAvailable: false,
    automaticSubmission: false,
    reason: "AUTOMATION_V2_NOT_DEPLOYED",
    bindings: null,
  });
});

test("current source-adopted V2 record is visible as configuration-pending and remains closed", () => {
  const result = autonomyV2Status();
  assert.equal(result.status, "DEPLOYED_CONFIGURATION_PENDING");
  assert.equal(result.capability, false);
  assert.equal(result.reason, "AUTOMATION_V2_GUARDIAN_AND_WORKER_PENDING");
  assert.equal(result.bindings.accountRegistry,
    "0x00e7d2a869cc6a8f61a4ce11a66a8874db1f78e3");
});

test("deployed records still keep every capability closed until the live gate is released", () => {
  const result = autonomyV2Status(deployedManifest());
  assert.equal(result.status, "DEPLOYED_AWAITING_LIVE_GATE");
  assert.equal(result.capability, false);
  assert.equal(result.automaticSubmission, false);
  assert.equal(result.setupTransactionAvailable, false);
  assert.equal(result.reason, "V2_LIVE_EVIDENCE_GATE_NOT_RELEASED");
  assert.equal(result.bindings.accountRegistry, A("4"));
});

test("deployed source-pending records are visible but non-operable", () => {
  const result = autonomyV2Status(sourcePendingManifest());
  assert.equal(result.status, "DEPLOYED_SOURCE_VERIFICATION_PENDING");
  assert.equal(result.capability, false);
  assert.equal(result.automaticSubmission, false);
  assert.equal(result.setupTransactionAvailable, false);
  assert.equal(result.reason, "AUTOMATION_V2_SOURCE_ADOPTION_PENDING");
  assert.equal(result.bindings.adapter, A("1"));
  assert.equal(result.bindings.accountRegistry, A("4"));
});

test("source-adopted records remain locked until guardian and worker configuration", () => {
  const result = autonomyV2Status(configurationPendingManifest());
  assert.equal(result.status, "DEPLOYED_CONFIGURATION_PENDING");
  assert.equal(result.capability, false);
  assert.equal(result.automaticSubmission, false);
  assert.equal(result.setupTransactionAvailable, false);
  assert.equal(result.reason, "AUTOMATION_V2_GUARDIAN_AND_WORKER_PENDING");
  assert.equal(result.bindings.policyModule, A("2"));
});

test("invalid deployment identity fails closed without exposing bindings", () => {
  const mutations = [
    (m) => { m.status = "NOT_DEPLOYED"; },
    (m) => { m.chainId = 1; },
    (m) => { m.contracts.GoghPunkAccountV2.receiptStatus = "FAILED"; },
    (m) => { m.contracts.GoghPunkAccountRegistryV2.runtimeBytecodeHash = null; },
    (m) => { m.contracts.BrokerPolicyModuleV2.verificationStatus = "PARTIAL"; },
  ];
  for (const mutate of mutations) {
    const manifest = deployedManifest();
    mutate(manifest);
    const result = autonomyV2Status(manifest);
    assert.equal(result.capability, false);
    assert.equal(result.automaticSubmission, false);
    assert.equal(result.bindings, null);
  }
});

test("source, configuration, and worker mutations stay visible but never operable", () => {
  const mutations = [
    (m) => { m.sourceVerificationAdoption = null; },
    (m) => { m.sourceVerificationAdoption.pendingManifestSha256 = H("f"); },
    (m) => { m.sourceVerificationAdoption.verifiedContracts.reverse(); },
    (m) => { m.configuration.adapterRegistered = false; },
    (m) => { m.configuration.featureFlagsEnabled = false; },
    (m) => { m.configuration.globalAgentApproved = false; },
    (m) => { m.configuration.workerEnabled = false; },
    (m) => { m.authorization.automaticSubmissionEnabled = false; },
  ];
  for (const mutate of mutations) {
    const manifest = deployedManifest();
    mutate(manifest);
    const result = autonomyV2Status(manifest);
    assert.equal(result.capability, false);
    assert.equal(result.automaticSubmission, false);
    assert.notEqual(result.bindings, null);
    assert.match(result.status, /^DEPLOYED_/);
  }
});
