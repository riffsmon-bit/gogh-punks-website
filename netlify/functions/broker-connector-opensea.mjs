import { OpenSeaDirectedReviewError, reviewOpenSeaMintForPunk } from
  "../../broker/src/connector/opensea-directed-review.mjs";
import { readAutomationV3PunkState } from "./_shared/autonomy-v3-live.mjs";
import { json, PublicError, readJson } from "./_shared/http.mjs";

export function requireTrustedOrigin(request, environment = process.env) {
  const origin = request.headers.get("origin");
  const allowed = [request.url, environment.SITE_URL, environment.URL, environment.DEPLOY_PRIME_URL]
    .filter((value) => typeof value === "string" && value.length <= 2_048)
    .map((value) => {
      try { return new URL(value).origin; } catch { return null; }
    }).filter(Boolean);
  if (!origin || !allowed.includes(origin)) {
    throw new PublicError(403, "ORIGIN_REJECTED", "The request origin was rejected.");
  }
}

export async function handleOpenSeaConnectorRequest(body, dependencies = {}) {
  const review = await reviewOpenSeaMintForPunk(body, {
    apiKey: dependencies.apiKey ?? process.env.OPENSEA_API_KEY,
    fetchImpl: dependencies.fetchImpl,
    readPunk: dependencies.readPunk ?? readAutomationV3PunkState,
    nowMs: dependencies.nowMs,
  });
  const unsafe = review?.executionReady !== false
    || (review.status !== "DROP_DETAILS_RETRIEVED" && (
      review.simulationPerformed !== false
      || review.safety?.signingPerformed !== false
      || review.safety?.submissionPerformed !== false
    ));
  if (unsafe) {
    throw new Error("OPEN_SEA_REVIEW_EXCEEDED_READ_ONLY_BOUNDARY");
  }
  return review;
}

export default async function handler(request) {
  try {
    if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
    requireTrustedOrigin(request);
    const body = await readJson(request, 4_096);
    const review = await handleOpenSeaConnectorRequest(body);
    return json({ ok: true, review }, 200, { "netlify-cdn-cache-control": "no-store" });
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ ok: false, code: error.code, message: error.message }, error.status);
    }
    if (error instanceof OpenSeaDirectedReviewError) {
      const status = new Set(["INVALID_REQUEST", "INVALID_IDENTITY"]).has(error.code) ? 400
        : error.code === "OWNERSHIP_CHANGED" ? 403
          : new Set(["PUNK_NOT_ACTIVE", "UNSUPPORTED_MINT", "UNVERIFIED_DROP"]).has(error.code)
            ? 409 : 503;
      return json({ ok: false, code: error.code, message: error.message }, status);
    }
    console.error(JSON.stringify({
      event: "OPENSEA_CONNECTOR_REVIEW_FAILED",
      code: typeof error?.code === "string" ? error.code : "FAILED",
    }));
    return json({
      ok: false,
      code: "REVIEW_FAILED_SAFELY",
      message: "The mint review stopped safely. Nothing was signed or submitted.",
    }, 503);
  }
}

export const config = {
  path: "/api/broker/connector/opensea",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 8,
    windowSize: 60,
  },
};
