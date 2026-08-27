import { json } from "./_shared/http.mjs";

const PROJECT_ID_PATTERN = /^[0-9a-f]{32}$/;

export function walletConfiguration(environment = process.env, origin = null) {
  const projectId = environment.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim() ?? "";
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    return Object.freeze({
      configured: false,
      projectId: null,
      metadataUrl: null,
      reason: "REOWN_PROJECT_ID_NOT_CONFIGURED",
    });
  }
  const metadataUrl = typeof origin === "string" && /^https?:\/\/[^/]+$/.test(origin)
    ? origin : "https://goghpunks.xyz";
  return Object.freeze({ configured: true, projectId, metadataUrl, reason: null });
}

export default function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const requestOrigin = new URL(request.url).origin;
  return json({ ok: true, wallet: walletConfiguration(process.env, requestOrigin) }, 200, {
    "cache-control": "no-store, max-age=0",
    "netlify-cdn-cache-control": "no-store",
  });
}

export const config = {
  path: "/api/broker/wallet-config",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 120,
    windowSize: 60,
  },
};
