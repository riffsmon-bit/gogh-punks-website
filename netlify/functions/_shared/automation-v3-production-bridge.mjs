import {
  punkWorkerActivityFromRow,
  punkWorkerEvidenceFromRow,
  workerHeartbeatFromRow,
  workerUsageFromRow,
} from "./automation-v3-worker-state.mjs";

const PRODUCTION_ORIGIN = "https://goghpunks.xyz";
const RUN_STATUSES = new Set([
  "NO_AUTONOMOUS_MANDATES",
  "NO_ANALYZED_ACTIVE_TARGETS",
  "NO_ELIGIBLE_TARGETS",
  "MINT_CONFIRMED",
  "RUN_IN_PROGRESS",
]);
const PLATFORM_STATUSES = new Set(["HEALTHY", "DELAYED", "RECOVERING", "DEGRADED", "OUTAGE"]);

function plain(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function bounded(value, pattern, name) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

async function productionJson(path, options, fetchFunction) {
  const response = await fetchFunction(`${PRODUCTION_ORIGIN}${path}`, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (text.length > 64_000) throw new TypeError("Production response is too large");
  let payload;
  try { payload = JSON.parse(text); } catch { throw new TypeError("Production response is invalid"); }
  return { response, payload: plain(payload, "production response") };
}

export function isDeployPreview(environment = process.env, requestUrl = null) {
  if (environment.CONTEXT === "deploy-preview") return true;
  if (typeof requestUrl !== "string") return false;
  try {
    const url = new URL(requestUrl);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (/^deploy-preview-[1-9][0-9]*--gogh-punks\.netlify\.app$/.test(url.hostname)
        || /^deploy-preview-[1-9][0-9]*\.preview\.goghpunks\.xyz$/.test(url.hostname));
  } catch {
    return false;
  }
}

export async function getProductionAutomationV3Activity(fetchFunction = fetch, tokenId = null) {
  const selectedTokenId = tokenId == null ? null
    : bounded(String(tokenId), /^(?:0|[1-9][0-9]{0,3})$/, "activity token ID");
  const { response, payload } = await productionJson(
    `/api/broker/autonomy-v3-activity${selectedTokenId === null
      ? "" : `?tokenId=${encodeURIComponent(selectedTokenId)}`}`,
    { method: "GET", headers: { accept: "application/json" }, cache: "no-store" },
    fetchFunction,
  );
  if (!response.ok || payload.ok !== true) throw new TypeError("Production activity is unavailable");
  const activity = plain(payload.activity, "production activity");
  const checkedAt = bounded(
    activity.checkedAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    "production activity time",
  );
  if (!Number.isFinite(Date.parse(checkedAt)) || typeof activity.configured !== "boolean"
    || typeof activity.online !== "boolean" || typeof activity.executionReady !== "boolean") {
    throw new TypeError("Production activity state is invalid");
  }
  const platform = plain(activity.platformHealth, "production platform health");
  const platformStatus = bounded(platform.status, /^[A-Z_]{3,32}$/, "platform status");
  const platformReason = platform.reason == null ? null
    : bounded(platform.reason, /^[A-Z0-9_]{3,64}$/, "platform reason");
  if (!PLATFORM_STATUSES.has(platformStatus)
    || !Number.isSafeInteger(platform.consecutiveFailures)
    || platform.consecutiveFailures < 0
    || (platform.lastSuccessfulAt !== null
      && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(platform.lastSuccessfulAt)
        || !Number.isFinite(Date.parse(platform.lastSuccessfulAt))))) {
    throw new TypeError("Production platform health is invalid");
  }
  const punk = activity.punk == null ? null : plain(activity.punk, "Punk activity");
  return Object.freeze({
    checkedAt,
    configured: activity.configured,
    online: activity.online,
    executionReady: activity.executionReady,
    platformHealth: Object.freeze({
      status: platformStatus,
      reason: platformReason,
      lastSuccessfulAt: platform.lastSuccessfulAt,
      consecutiveFailures: platform.consecutiveFailures,
    }),
    heartbeat: activity.heartbeat == null ? null : workerHeartbeatFromRow(activity.heartbeat),
    usage: activity.usage == null ? null : workerUsageFromRow(activity.usage),
    punk: punk === null ? null : Object.freeze({
      heartbeat: punk.heartbeat == null
        ? null : punkWorkerEvidenceFromRow(plain(punk.heartbeat, "Punk heartbeat")),
      events: Object.freeze((Array.isArray(punk.events) ? punk.events : [])
        .map((event) => punkWorkerActivityFromRow(plain(event, "Punk activity event")))),
    }),
  });
}

function normalizeRun(run) {
  const value = plain(run, "production run");
  const tokenId = value.tokenId == null ? null
    : bounded(String(value.tokenId), /^(?:0|[1-9][0-9]{0,3})$/, "run token ID");
  const status = bounded(value.status, /^[A-Z_]{1,64}$/, "run status");
  if (!RUN_STATUSES.has(status) || ![0, 1].includes(value.submitted)) {
    throw new TypeError("Production run result is invalid");
  }
  const collection = value.collection == null ? null
    : bounded(value.collection, /^0x[0-9a-f]{40}$/, "run collection");
  const transactionHash = value.transactionHash == null ? null
    : bounded(value.transactionHash, /^0x[0-9a-f]{64}$/, "run transaction hash");
  if (status === "MINT_CONFIRMED"
    && (value.submitted !== 1 || tokenId === null || !collection || !transactionHash)) {
    throw new TypeError("Confirmed production run is incomplete");
  }
  if (status !== "MINT_CONFIRMED" && (value.submitted !== 0 || transactionHash !== null)) {
    throw new TypeError("Non-mint production run is invalid");
  }
  return Object.freeze({ tokenId, status, submitted: value.submitted, collection, transactionHash });
}

export async function forwardProductionAutomationV3Run(body, fetchFunction = fetch) {
  const { response, payload } = await productionJson(
    "/api/broker/autonomy-v3-run",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: PRODUCTION_ORIGIN,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
    fetchFunction,
  );
  if (payload.ok === true && (response.status === 200 || response.status === 202)) {
    return Object.freeze({ status: response.status, ok: true, run: normalizeRun(payload.run) });
  }
  const code = bounded(payload.code, /^[A-Z0-9_]{1,64}$/, "production error code");
  const message = bounded(payload.message, /^.{1,500}$/s, "production error message");
  if (response.status < 400 || response.status > 599) {
    throw new TypeError("Production error status is invalid");
  }
  return Object.freeze({ status: response.status, ok: false, code, message });
}

export const AUTOMATION_V3_PRODUCTION_ORIGIN = PRODUCTION_ORIGIN;
