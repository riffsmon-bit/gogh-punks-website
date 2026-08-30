import automationManifest from "../../deployments/robinhood-automation-v3.json" with { type: "json" };
import { requireVerifiedManifestAdoption } from
  "../../broker/src/recommendation/source-verification-adoption.mjs";
import { json } from "./_shared/http.mjs";
import {
  AUTOMATION_V3_AGENT, readAutomationV3GlobalState, readAutomationV3PunkState,
} from "./_shared/autonomy-v3-live.mjs";
import {
  getAutomationV3UsageStats, getAutomationV3WorkerHeartbeat, workerHeartbeatIsCurrent,
} from "./_shared/automation-v3-worker-state.mjs";
import {
  getProductionAutomationV3Activity, isDeployPreview,
} from "./_shared/automation-v3-production-bridge.mjs";

const CONTRACT_NAMES = Object.freeze([
  "AutomatedSeaDropStudioFreeMintAdapter",
  "BrokerPolicyModuleV3",
  "GoghPunkAccountV3",
  "GoghPunkAccountRegistryV3",
]);

function address(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase() : null;
}

function hash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)
    && !/^0x0{64}$/.test(value) ? value.toLowerCase() : null;
}

export function autonomyV3Status(manifest = automationManifest) {
  const contracts = manifest?.contracts;
  let adoptionVerified = false;
  try {
    requireVerifiedManifestAdoption(manifest, CONTRACT_NAMES);
    adoptionVerified = true;
  } catch {
    adoptionVerified = false;
  }
  const deployedRecords = manifest?.schema === "GOGH_AUTOMATED_SEADROP_V3_DEPLOYMENT_MANIFEST"
    && manifest?.version === 1 && manifest?.status === "DEPLOYED" && manifest?.chainId === 4663
    && CONTRACT_NAMES.every((name) => {
      const record = contracts?.[name];
      return address(record?.address) && hash(record?.runtimeBytecodeHash)
        && hash(record?.deploymentTransaction) && record?.receiptStatus === "SUCCESS"
        && ["NOT_SUBMITTED", "VERIFIED"].includes(record?.verificationStatus);
    });
  if (!deployedRecords) {
    return Object.freeze({
      status: "PREPARING_V3",
      capability: false,
      setupTransactionAvailable: false,
      automaticSubmission: false,
      reason: "AUTOMATION_V3_NOT_DEPLOYED",
      bindings: null,
    });
  }
  const bindings = Object.freeze({
    chainId: 4663,
    adapter: address(contracts.AutomatedSeaDropStudioFreeMintAdapter.address),
    adapterRuntimeCodeHash: hash(
      contracts.AutomatedSeaDropStudioFreeMintAdapter.runtimeBytecodeHash,
    ),
    policyModule: address(contracts.BrokerPolicyModuleV3.address),
    policyModuleRuntimeCodeHash: hash(contracts.BrokerPolicyModuleV3.runtimeBytecodeHash),
    accountImplementation: address(contracts.GoghPunkAccountV3.address),
    accountImplementationRuntimeCodeHash: hash(
      contracts.GoghPunkAccountV3.runtimeBytecodeHash,
    ),
    accountRegistry: address(contracts.GoghPunkAccountRegistryV3.address),
    accountRegistryRuntimeCodeHash: hash(
      contracts.GoghPunkAccountRegistryV3.runtimeBytecodeHash,
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
      reason: "AUTOMATION_V3_SOURCE_ADOPTION_PENDING",
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
      reason: "AUTOMATION_V3_GUARDIAN_AND_WORKER_PENDING",
      bindings,
    });
  }
  return Object.freeze({
    status: "DEPLOYED_AWAITING_LIVE_GATE",
    capability: false,
    setupTransactionAvailable: false,
    automaticSubmission: false,
    reason: "V3_LIVE_EVIDENCE_GATE_NOT_RELEASED",
    bindings,
  });
}

export function automationV3WorkerAvailability(
  globallyReady, heartbeat, release, nowMs = Date.now(),
) {
  const online = globallyReady === true
    && workerHeartbeatIsCurrent(heartbeat, release, nowMs);
  const failed = globallyReady === true && heartbeat?.release === release
    && heartbeat?.status === "FAILED";
  return Object.freeze({
    online,
    status: online ? "READY" : failed ? "WORKER_DEGRADED"
      : globallyReady ? "WORKER_STARTING" : "DEPLOYED_CONFIGURATION_PENDING",
    reason: online ? null : failed ? "AUTOMATION_V3_WORKER_RETRYING"
      : globallyReady ? "AUTOMATION_V3_HEARTBEAT_PENDING" : null,
  });
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const base = autonomyV3Status();
  let automation = base;
  let punk = null;
  if (base.status === "DEPLOYED_CONFIGURATION_PENDING") {
    try {
      const params = new URL(request.url).searchParams;
      const tokenId = params.get("tokenId");
      const preview = isDeployPreview(process.env, request.url);
      const workerEvidence = preview
        ? getProductionAutomationV3Activity()
        : Promise.all([
          getAutomationV3WorkerHeartbeat().catch(() => null),
          getAutomationV3UsageStats().catch(() => null),
        ]).then(([heartbeat, usage]) => ({ heartbeat, usage }));
      const [liveResult, evidenceResult, selectedPunkResult] = await Promise.allSettled([
        readAutomationV3GlobalState(),
        workerEvidence,
        tokenId === null ? null : readAutomationV3PunkState(tokenId),
      ]);
      const selectedPunk = selectedPunkResult.status === "fulfilled"
        ? selectedPunkResult.value : null;
      punk = selectedPunk;
      if (liveResult.status !== "fulfilled") {
        automation = Object.freeze({
          ...base,
          reason: "AUTOMATION_V3_LIVE_READ_UNAVAILABLE",
          punk,
        });
        return json({ ok: true, automation }, 200, {
          "cache-control": "private, no-store, max-age=0",
          "netlify-cdn-cache-control": "public, s-maxage=15, stale-while-revalidate=15",
        });
      }
      const live = liveResult.value;
      const evidence = evidenceResult.status === "fulfilled"
        ? evidenceResult.value : { heartbeat: null, usage: null, online: false };
      const { heartbeat, usage } = evidence;
      const globallyReady = live.configured === true && live.worker.enabled === true;
      const availability = automationV3WorkerAvailability(
        globallyReady, heartbeat, live.worker.release, Date.now(),
      );
      // Preview automation is intentionally not scheduled. Its manual run endpoint is bridged to
      // production, so the preview must display the production endpoint's already-validated
      // heartbeat rather than comparing that heartbeat with the preview commit SHA.
      const workerOnline = preview ? evidence.online === true : availability.online;
      const ready = globallyReady && workerOnline;
      automation = Object.freeze({
        ...base,
        status: ready ? "READY" : availability.status,
        capability: ready,
        // Owner setup is a separate live-checked transaction builder. A transient hosted-worker
        // outage must pause submissions, but must not prevent an owner from creating/updating the
        // bounded on-chain authorization that the worker will use after recovery.
        setupTransactionAvailable: globallyReady,
        automaticSubmission: ready,
        scheduledRetry: availability.status === "WORKER_DEGRADED",
        reason: ready ? null : availability.reason ?? (live.configured
          ? "AUTOMATION_V3_WORKER_PENDING" : "AUTOMATION_V3_GUARDIAN_PENDING"),
        agent: {
          address: AUTOMATION_V3_AGENT,
          validUntil: live.agent.validUntil,
          balanceWei: live.agent.balanceWei,
          codeFree: live.agent.codeFree,
        },
        live: { adapterRegistered: live.adapter.active, featureFlagsEnabled: live.configured, globalAgentApproved: live.agent.approved, workerEnabled: live.worker.enabled, workerOnline },
        heartbeat: heartbeat ? { ...heartbeat, online: workerOnline } : null,
        usage,
        punk,
      });
    } catch {
      automation = Object.freeze({ ...base, reason: "AUTOMATION_V3_LIVE_READ_UNAVAILABLE" });
    }
  }
  return json({ ok: true, automation }, 200, {
    // This response is public, contains no connected-wallet data, and is advisory UI state.
    // Fifteen-second edge reuse collapses duplicate navigation/status requests. Every privileged
    // mutation endpoint independently revalidates current ownership, policy, runtime, and chain.
    "cache-control": "private, no-store, max-age=0",
    "netlify-cdn-cache-control": "public, s-maxage=15, stale-while-revalidate=15",
  });
}

export const config = {
  path: "/api/broker/autonomy-v3-status",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 120,
    windowSize: 60,
  },
};
