import automationManifest from "../../deployments/robinhood-automation-v3.json" with { type: "json" };
import { requireVerifiedManifestAdoption } from
  "../../broker/src/recommendation/source-verification-adoption.mjs";
import { json } from "./_shared/http.mjs";
import {
  AUTOMATION_V3_AGENT, readAutomationV3AgentDisplayState, readAutomationV3PunkState,
} from "./_shared/autonomy-v3-live.mjs";
import {
  getAutomationV3UsageStats, getAutomationV3WorkerHeartbeat, workerHeartbeatIsCurrent,
  workerPlatformHealth,
} from "./_shared/automation-v3-worker-state.mjs";
import { resolveAutomationV3PunkAgent } from "./_shared/automation-v3-punk-agent.mjs";
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
  const executionReady = globallyReady === true
    && workerHeartbeatIsCurrent(heartbeat, release, nowMs);
  const platform = globallyReady === true
    ? workerPlatformHealth(heartbeat, release, nowMs)
    : Object.freeze({ status: "OUTAGE", reason: "WORKER_NOT_CONFIGURED",
      lastSuccessfulAt: null, consecutiveFailures: 0 });
  const publicStatus = platform.status === "HEALTHY" ? "READY"
    : platform.status === "RECOVERING" ? "WORKER_RECOVERING"
      : platform.status === "DELAYED" ? "WORKER_DELAYED"
        : platform.status === "DEGRADED" ? "WORKER_DEGRADED"
          : globallyReady ? "WORKER_OUTAGE" : "DEPLOYED_CONFIGURATION_PENDING";
  return Object.freeze({
    online: platform.status === "HEALTHY",
    executionReady,
    status: publicStatus,
    reason: platform.reason,
    platformHealth: platform,
  });
}

export function automationV3WorkerConfigured(environment = process.env) {
  const release = environment.BROKER_AUTOMATION_V3_WORKER_RELEASE?.trim() ?? "";
  return environment.BROKER_AUTOMATION_V3_ENABLED === "true"
    && /^[0-9a-f]{40}$/.test(release)
    && (environment.BROKER_AUTOMATION_V3_AGENT_ADDRESS ?? "").toLowerCase()
      === AUTOMATION_V3_AGENT;
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
      const resolvedPunk = tokenId === null ? null
        : await resolveAutomationV3PunkAgent(tokenId).catch(() => null);
      const selectedAgent = resolvedPunk?.lane?.address ?? AUTOMATION_V3_AGENT;
      const [evidenceResult, selectedPunkResult, agentResult] = await Promise.allSettled([
        workerEvidence,
        tokenId === null ? null : resolvedPunk?.punk ?? readAutomationV3PunkState(
          tokenId, process.env, { agentAddress: selectedAgent },
        ),
        readAutomationV3AgentDisplayState(process.env, { agentAddress: selectedAgent }),
      ]);
      const selectedPunk = selectedPunkResult.status === "fulfilled"
        ? selectedPunkResult.value : null;
      punk = selectedPunk;
      const evidence = evidenceResult.status === "fulfilled"
        ? evidenceResult.value : { heartbeat: null, usage: null, online: false };
      const { heartbeat, usage } = evidence;
      const agent = agentResult.status === "fulfilled" ? agentResult.value : {
        address: AUTOMATION_V3_AGENT, validUntil: null, balanceWei: null, codeFree: false,
      };
      // This public endpoint is advisory UI state. The recent persisted worker heartbeat proves
      // that production is processing the reviewed release; re-reading the entire global contract
      // graph on every browser refresh caused provider skew, false outages, and unnecessary RPC
      // spend. Every setup/run mutation still performs its own dual-provider live gate.
      const configuredWorker = automationV3WorkerConfigured(process.env);
      // Deploy previews intentionally have no autonomous worker of their own. Their manual
      // execution bridge and status evidence both come from production, so a current production
      // heartbeat is the preview's readiness proof. Production still requires its exact env
      // binding in addition to the matching heartbeat.
      const globallyReady = preview ? evidence.configured === true : configuredWorker;
      const release = preview ? heartbeat?.release ?? ""
        : process.env.BROKER_AUTOMATION_V3_WORKER_RELEASE?.trim() ?? "";
      const availability = preview ? Object.freeze({
        online: evidence.online === true,
        executionReady: evidence.executionReady === true,
        status: evidence.executionReady === true ? "READY"
          : `WORKER_${evidence.platformHealth?.status ?? "OUTAGE"}`,
        reason: evidence.platformHealth?.reason ?? "WORKER_EVIDENCE_MISSING",
        platformHealth: evidence.platformHealth ?? null,
      }) : automationV3WorkerAvailability(globallyReady, heartbeat, release, Date.now());
      // Preview automation is intentionally not scheduled. Its manual run endpoint is bridged to
      // production, so the preview must display the production endpoint's already-validated
      // heartbeat rather than comparing that heartbeat with the preview commit SHA.
      const workerOnline = preview ? evidence.online === true : availability.online;
      const executionReady = preview ? evidence.executionReady === true
        : availability.executionReady;
      const ready = globallyReady && executionReady;
      automation = Object.freeze({
        ...base,
        status: ready ? "READY" : availability.status,
        capability: ready,
        // Owner setup is a separate live-checked transaction builder. A transient hosted-worker
        // outage must pause submissions, but must not prevent an owner from creating/updating the
        // bounded on-chain authorization that the worker will use after recovery.
        setupTransactionAvailable: globallyReady,
        automaticSubmission: ready,
        scheduledRetry: new Set(["WORKER_RECOVERING", "WORKER_DELAYED", "WORKER_DEGRADED"])
          .has(availability.status),
        reason: ready ? null : availability.reason ?? (globallyReady
          ? "AUTOMATION_V3_WORKER_PENDING" : "AUTOMATION_V3_GUARDIAN_PENDING"),
        agent,
        live: { adapterRegistered: null, featureFlagsEnabled: null,
          globalAgentApproved: null, workerEnabled: globallyReady, workerOnline },
        heartbeat: heartbeat ? { ...heartbeat, online: workerOnline } : null,
        platformHealth: availability.platformHealth,
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
