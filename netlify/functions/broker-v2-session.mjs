import { getDatabase } from "@netlify/database";
import { json, PublicError, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { isV2DeployPreview, isV2DeployPreviewUrl } from "./_shared/v2-review.mjs";
import { completeV2Session, prepareV2Session, requireV2Session, revokeV2Session } from
  "./_shared/v2-session.mjs";

function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The session request is invalid.");
  }
}

export function requireV2SessionOrigin(request) {
  if (isV2DeployPreview(request)) return new URL(request.url).origin;
  if (isV2DeployPreviewUrl(request)) {
    throw new PublicError(403, "ORIGIN_REJECTED", "The request origin was rejected.");
  }
  requireSameOrigin(request);
  return request.headers.get("origin");
}

export default async function handler(request) {
  const pool = getDatabase().pool;
  try {
    if (request.method === "GET") {
      const session = await requireV2Session(request, pool);
      return json({ ok: true, authenticated: true, walletAddress: session.walletAddress,
        expiresAt: session.expiresAt });
    }
    if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
    const siteUrl = requireV2SessionOrigin(request);
    const body = await readJson(request, 16_384);
    if (body.action === "prepare") {
      exact(body, ["action", "walletAddress"]);
      return json({ ok: true, action: "SIGN_IN",
        challenge: await prepareV2Session(pool, body.walletAddress, new Date(), siteUrl) });
    }
    if (body.action === "complete") {
      exact(body, ["action", "challengeId", "walletAddress", "signature"]);
      const session = await completeV2Session(pool, body, new Date(), siteUrl);
      return json({ ok: true, authenticated: true, walletAddress: session.walletAddress,
        expiresAt: session.expiresAt }, 200, { "set-cookie": session.cookie });
    }
    if (body.action === "logout") {
      exact(body, ["action"]);
      return json({ ok: true, authenticated: false }, 200,
        { "set-cookie": await revokeV2Session(request, pool) });
    }
    throw new PublicError(400, "INVALID_ACTION", "Choose a supported session action.");
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/session", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 20, windowSize: 60,
} };
