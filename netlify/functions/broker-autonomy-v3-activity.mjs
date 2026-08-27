import { json } from "./_shared/http.mjs";
import {
  getAutomationV3UsageStats, getAutomationV3WorkerHeartbeat, workerHeartbeatIsCurrent,
} from "./_shared/automation-v3-worker-state.mjs";

export function automationV3Activity(heartbeat, usage, environment = process.env,
  nowMs = Date.now()) {
  const release = environment.BROKER_AUTOMATION_V3_WORKER_RELEASE?.trim() ?? "";
  const enabled = environment.BROKER_AUTOMATION_V3_ENABLED === "true"
    && /^[0-9a-f]{40}$/.test(release);
  return Object.freeze({
    checkedAt: new Date(nowMs).toISOString(),
    online: enabled && workerHeartbeatIsCurrent(heartbeat, release, nowMs),
    heartbeat: heartbeat ? Object.freeze({ ...heartbeat }) : null,
    usage: usage ? Object.freeze({ ...usage }) : null,
  });
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const [heartbeat, usage] = await Promise.all([
      getAutomationV3WorkerHeartbeat(), getAutomationV3UsageStats(),
    ]);
    return json({ ok: true, activity: automationV3Activity(heartbeat, usage) }, 200, {
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
