import { json } from "./_shared/http.mjs";
import {
  getAutomationV3PunkWorkerActivity, getAutomationV3RecentWorkerActivity,
  getAutomationV3UsageStats,
  getAutomationV3WorkerHeartbeat, workerHeartbeatIsCurrent,
} from "./_shared/automation-v3-worker-state.mjs";
import {
  getProductionAutomationV3Activity, isDeployPreview,
} from "./_shared/automation-v3-production-bridge.mjs";

export function automationV3Activity(heartbeat, usage, environment = process.env,
  nowMs = Date.now(), punk = null, events = []) {
  const release = environment.BROKER_AUTOMATION_V3_WORKER_RELEASE?.trim() ?? "";
  const enabled = environment.BROKER_AUTOMATION_V3_ENABLED === "true"
    && /^[0-9a-f]{40}$/.test(release);
  return Object.freeze({
    checkedAt: new Date(nowMs).toISOString(),
    online: enabled && workerHeartbeatIsCurrent(heartbeat, release, nowMs),
    heartbeat: heartbeat ? Object.freeze({ ...heartbeat }) : null,
    usage: usage ? Object.freeze({ ...usage }) : null,
    events: Object.freeze(events.map((event) => Object.freeze({ ...event }))),
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
    const limitValues = url.searchParams.getAll("limit");
    const beforeValues = url.searchParams.getAll("before");
    const selectedTokenId = tokenValues.length === 0 ? null : tokenValues[0];
    const limit = limitValues.length === 0 ? 50 : Number(limitValues[0]);
    const before = beforeValues.length === 0 ? null : beforeValues[0];
    if (tokenValues.length > 1 || (selectedTokenId !== null
      && !/^(?:0|[1-9][0-9]{0,3})$/.test(selectedTokenId))
      || limitValues.length > 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || beforeValues.length > 1 || (before !== null
        && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(before)
          || !Number.isFinite(Date.parse(before))))) {
      return json({ ok: false, code: "INVALID_ACTIVITY_QUERY" }, 400);
    }
    const preview = isDeployPreview(process.env, request.url);
    const evidence = preview
      ? await getProductionAutomationV3Activity(undefined, selectedTokenId, { limit, before })
      : await Promise.all([
        getAutomationV3WorkerHeartbeat(), getAutomationV3UsageStats(),
        selectedTokenId === null ? null : getAutomationV3PunkWorkerActivity(selectedTokenId),
        getAutomationV3RecentWorkerActivity({ limit, before }),
      ]).then(([heartbeat, usage, punk, events]) => ({ heartbeat, usage, punk, events }));
    const { heartbeat, usage, punk = null, events = [] } = evidence;
    // A deploy preview deliberately has no autonomous worker of its own. Production already
    // validates its configured release before publishing `online`; recomputing that result with
    // the preview commit SHA would make every healthy production heartbeat look stale.
    const activity = preview ? Object.freeze({
      checkedAt: evidence.checkedAt,
      online: evidence.online,
      heartbeat,
      usage,
      punk,
      events,
    }) : automationV3Activity(heartbeat, usage, process.env, Date.now(), punk, events);
    return json({ ok: true, activity }, 200, {
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
