import assert from "node:assert/strict";
import test from "node:test";

import { autonomyV2Status } from "../netlify/functions/broker-autonomy-v2-status.mjs";

const A = (digit) => `0x${digit.repeat(40)}`;
const H = (digit) => `0x${digit.repeat(64)}`;

function deployedManifest() {
  const record = (digit) => ({
    address: A(digit),
    runtimeBytecodeHash: H(digit),
    deploymentTransaction: H(String(9 - Number(digit))),
    receiptStatus: "SUCCESS",
    verificationStatus: "VERIFIED",
  });
  return {
    schema: "GOGH_AUTOMATED_SEADROP_V2_DEPLOYMENT_MANIFEST",
    version: 1,
    status: "DEPLOYED",
    chainId: 4663,
    sourceVerificationAdoption: {
      schema: "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1",
    },
    contracts: {
      AutomatedSeaDropFreeMintAdapter: record("1"),
      BrokerPolicyModuleV2: record("2"),
      GoghPunkAccountV2: record("3"),
      GoghPunkAccountRegistryV2: record("4"),
    },
    configuration: {
      adapterRegistered: true,
      featureFlagsEnabled: true,
      globalAgentApproved: true,
      workerEnabled: true,
    },
    authorization: { automaticSubmissionEnabled: true },
  };
}

test("current V2 template keeps every browser automation capability closed", async () => {
  const result = autonomyV2Status();
  assert.deepEqual(result, {
    status: "PREPARING_V2",
    capability: false,
    setupTransactionAvailable: false,
    automaticSubmission: false,
    reason: "AUTOMATION_V2_NOT_DEPLOYED",
    bindings: null,
  });
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

test("every deployment, source, configuration, and worker mutation fails closed", () => {
  const mutations = [
    (m) => { m.status = "NOT_DEPLOYED"; },
    (m) => { m.chainId = 1; },
    (m) => { m.sourceVerificationAdoption = null; },
    (m) => { m.contracts.BrokerPolicyModuleV2.verificationStatus = "PARTIAL"; },
    (m) => { m.contracts.GoghPunkAccountV2.receiptStatus = "FAILED"; },
    (m) => { m.contracts.GoghPunkAccountRegistryV2.runtimeBytecodeHash = null; },
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
    assert.equal(result.bindings, null);
  }
});
