import automationManifest from "../../deployments/robinhood-automation-v2.json" with { type: "json" };
import { requireVerifiedManifestAdoption } from
  "../../broker/src/recommendation/source-verification-adoption.mjs";
import { json } from "./_shared/http.mjs";
import {
  AUTOMATION_V2_AGENT, readAutomationV2GlobalState, readAutomationV2PunkState,
} from "./_shared/autonomy-v2-live.mjs";
import {
  getAutomationV2WorkerHeartbeat, workerHeartbeatIsCurrent,
} from "./_shared/automation-v2-worker-state.mjs";

const CONTRACT_NAMES = Object.freeze([
  "AutomatedSeaDropFreeMintAdapter",
  "BrokerPolicyModuleV2",
  "GoghPunkAccountV2",
  "GoghPunkAccountRegistryV2",
]);

function address(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase() : null;
}

function hash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)
    && !/^0x0{64}$/.test(value) ? value.toLowerCase() : null;
}

export function autonomyV2Status(manifest = automationManifest) {
  const contracts = manifest?.contracts;
  let adoptionVerified = false;
  try {
    requireVerifiedManifestAdoption(manifest, CONTRACT_NAMES);
    adoptionVerified = true;
  } catch {
    adoptionVerified = false;
  }
  const deployedRecords = manifest?.schema === "GOGH_AUTOMATED_SEADROP_V2_DEPLOYMENT_MANIFEST"
    && manifest?.version === 1 && manifest?.status === "DEPLOYED" && manifest?.chainId === 4663
    && CONTRACT_NAMES.every((name) => {
      const record = contracts?.[name];
      return address(record?.address) && hash(record?.runtimeBytecodeHash)
        && hash(record?.deploymentTransaction) && record?.receiptStatus === "SUCCESS"
        && ["NOT_SUBMITTED", "VERIFIED"].includes(record?.verificationStatus);
    });
  if (!deployedRecords) {
    return Object.freeze({
      status: "PREPARING_V2",
      capability: false,
      setupTransactionAvailable: false,
      automaticSubmission: false,
      reason: "AUTOMATION_V2_NOT_DEPLOYED",
      bindings: null,
    });
  }
  const bindings = Object.freeze({
    chainId: 4663,
    adapter: address(contracts.AutomatedSeaDropFreeMintAdapter.address),
    adapterRuntimeCodeHash: hash(
      contracts.AutomatedSeaDropFreeMintAdapter.runtimeBytecodeHash,
    ),
    policyModule: address(contracts.BrokerPolicyModuleV2.address),
    policyModuleRuntimeCodeHash: hash(contracts.BrokerPolicyModuleV2.runtimeBytecodeHash),
    accountImplementation: address(contracts.GoghPunkAccountV2.address),
    accountImplementationRuntimeCodeHash: hash(
      contracts.GoghPunkAccountV2.runtimeBytecodeHash,
    ),
    accountRegistry: address(contracts.GoghPunkAccountRegistryV2.address),
    accountRegistryRuntimeCodeHash: hash(
      contracts.GoghPunkAccountRegistryV2.runtimeBytecodeHash,
    ),
  });
  if (!adoptionVerified || CONTRACT_NAMES.some((name) => (
    contracts[name].verificationStatus !== "VERIFIED"
  ))) {
    return Object.freeze({
      status: "DEPLOYED_SOURCE_VERIFICATION_PENDING",
      capability: false,
      setupTransactionAvailable: false,
      automaticSubmission: false,
      reason: "AUTOMATION_V2_SOURCE_ADOPTION_PENDING",
      bindings,
    });
  }
  const configured = manifest?.configuration?.adapterRegistered === true
    && manifest?.configuration?.featureFlagsEnabled === true
    && manifest?.configuration?.globalAgentApproved === true
    && manifest?.configuration?.workerEnabled === true
    && manifest?.authorization?.automaticSubmissionEnabled === true;
  if (!configured) {
    return Object.freeze({
      status: "DEPLOYED_CONFIGURATION_PENDING",
      capability: false,
      setupTransactionAvailable: false,
      automaticSubmission: false,
      reason: "AUTOMATION_V2_GUARDIAN_AND_WORKER_PENDING",
      bindings,
    });
  }
  return Object.freeze({
    status: "DEPLOYED_AWAITING_LIVE_GATE",
    capability: false,
    setupTransactionAvailable: false,
    automaticSubmission: false,
    reason: "V2_LIVE_EVIDENCE_GATE_NOT_RELEASED",
    bindings,
  });
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const base = autonomyV2Status();
  let automation = base;
  let punk = null;
  if (base.status === "DEPLOYED_CONFIGURATION_PENDING") {
    try {
      const params = new URL(request.url).searchParams;
      const tokenId = params.get("tokenId");
      const [live, heartbeat] = await Promise.all([
        readAutomationV2GlobalState(),
        getAutomationV2WorkerHeartbeat().catch(() => null),
      ]);
      if (tokenId !== null) punk = await readAutomationV2PunkState(tokenId);
      const globallyReady = live.configured === true && live.worker.enabled === true;
      const workerOnline = workerHeartbeatIsCurrent(
        heartbeat,
        live.worker.release,
        Date.now(),
      );
      const ready = globallyReady && workerOnline;
      automation = Object.freeze({
        ...base,
        status: ready ? "READY" : globallyReady ? "WORKER_STARTING" : "DEPLOYED_CONFIGURATION_PENDING",
        capability: ready,
        setupTransactionAvailable: ready,
        automaticSubmission: ready,
        reason: ready ? null : globallyReady ? "AUTOMATION_V2_HEARTBEAT_PENDING"
          : live.configured ? "AUTOMATION_V2_WORKER_PENDING" : "AUTOMATION_V2_GUARDIAN_PENDING",
        agent: { address: AUTOMATION_V2_AGENT, validUntil: live.agent.validUntil },
        live: { adapterRegistered: live.adapter.active, featureFlagsEnabled: live.configured, globalAgentApproved: live.agent.approved, workerEnabled: live.worker.enabled, workerOnline },
        heartbeat: heartbeat ? { ...heartbeat, online: workerOnline } : null,
        punk,
      });
    } catch {
      automation = Object.freeze({ ...base, reason: "AUTOMATION_V2_LIVE_READ_UNAVAILABLE" });
    }
  }
  return json({ ok: true, automation }, 200, {
    "cache-control": "no-store, max-age=0",
    "netlify-cdn-cache-control": "no-store",
  });
}

export const config = {
  path: "/api/broker/autonomy-v2-status",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 120,
    windowSize: 60,
  },
};
