import { json } from "./_shared/http.mjs";
import {
  getAutomationV3PunkWorkerActivity, getAutomationV3UsageStats,
  getAutomationV3WorkerHeartbeat, workerHeartbeatIsCurrent,
} from "./_shared/automation-v3-worker-state.mjs";
import {
  getProductionAutomationV3Activity, isDeployPreview,
} from "./_shared/automation-v3-production-bridge.mjs";

export function automationV3Activity(heartbeat, usage, environment = process.env,
  nowMs = Date.now(), punk = null) {
  const release = environment.BROKER_AUTOMATION_V3_WORKER_RELEASE?.trim() ?? "";
  const enabled = environment.BROKER_AUTOMATION_V3_ENABLED === "true"
    && /^[0-9a-f]{40}$/.test(release);
  return Object.freeze({
    checkedAt: new Date(nowMs).toISOString(),
    online: enabled && workerHeartbeatIsCurrent(heartbeat, release, nowMs),
    heartbeat: heartbeat ? Object.freeze({ ...heartbeat }) : null,
    usage: usage ? Object.freeze({ ...usage }) : null,
    punk: punk ? Object.freeze({
      heartbeat: punk.heartbeat ? Object.freeze({ ...punk.heartbeat }) : null,
      events: Object.freeze((punk.events ?? []).map((event) => Object.freeze({ ...event }))),
    }) : null,
  });
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const url = new URL(request.url);
    const tokenValues = url.searchParams.getAll("tokenId");
    const selectedTokenId = tokenValues.length === 0 ? null : tokenValues[0];
    if (tokenValues.length > 1 || (selectedTokenId !== null
      && !/^(?:0|[1-9][0-9]{0,3})$/.test(selectedTokenId))) {
      return json({ ok: false, code: "INVALID_TOKEN_ID" }, 400);
    }
    const evidence = isDeployPreview(process.env, request.url)
      ? await getProductionAutomationV3Activity(undefined, selectedTokenId)
      : await Promise.all([
        getAutomationV3WorkerHeartbeat(), getAutomationV3UsageStats(),
        selectedTokenId === null ? null : getAutomationV3PunkWorkerActivity(selectedTokenId),
      ]).then(([heartbeat, usage, punk]) => ({ heartbeat, usage, punk }));
    const { heartbeat, usage, punk = null } = evidence;
    return json({ ok: true,
      activity: automationV3Activity(heartbeat, usage, process.env, Date.now(), punk) }, 200, {
      "cache-control": "no-store, max-age=0",
      "netlify-cdn-cache-control": "no-store",
    });
  } catch {
    return json({ ok: false, code: "AUTOMATION_ACTIVITY_UNAVAILABLE" }, 503, {
      "cache-control": "no-store, max-age=0",
      "netlify-cdn-cache-control": "no-store",
    });
  }
}

export const config = {
  path: "/api/broker/autonomy-v3-activity",
  method: "GET",
  rateLimit: {
    action: "rate_limit", aggregateBy: ["ip"], windowLimit: 120, windowSize: 60,
  },
};
