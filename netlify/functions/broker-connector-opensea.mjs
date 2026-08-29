import { OpenSeaDirectedReviewError, reviewOpenSeaMintForPunk } from
  "../../broker/src/connector/opensea-directed-review.mjs";
import { consumeDirectedMintIntent, createDirectedMintIntent,
  DirectedMintIntentError } from
  "../../broker/src/connector/directed-mint-intent-store.mjs";
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
  if (body?.action === "execute") {
    const expected = ["action", "intentId", "tokenId", "walletAddress"].sort();
    const keys = body && typeof body === "object" && !Array.isArray(body)
      ? Object.keys(body).sort() : [];
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw new DirectedMintIntentError("INVALID_INTENT", "Directed mint request is invalid.");
    }
    const consumeIntent = dependencies.consumeIntent ?? consumeDirectedMintIntent;
    const intent = await consumeIntent({ intentId: body.intentId,
      walletAddress: String(body.walletAddress).toLowerCase(), punkTokenId: body.tokenId });
    const fresh = await reviewOpenSeaMintForPunk({ action: "prepare", tokenId: body.tokenId,
      url: intent.sourceUrl, walletAddress: body.walletAddress }, {
      apiKey: dependencies.apiKey ?? process.env.OPENSEA_API_KEY,
      fetchImpl: dependencies.fetchImpl,
      readPunk: dependencies.readPunk ?? readAutomationV3PunkState,
      nowMs: dependencies.nowMs,
    });
    if (fresh.reviewId !== intent.reviewId) {
      throw new DirectedMintIntentError("MINT_CHANGED",
        "The mint price or transaction changed. Review the updated mint before continuing.");
    }
    return Object.freeze({ ...fresh, intentId: intent.intentId, expiresAt: intent.expiresAt,
      status: "INTENT_REVALIDATED", executionReady: false,
      message: "Ownership, recipient, price, and exact SeaDrop call were revalidated. Production execution remains disabled until the full Punk Wallet simulation gate is enabled." });
  }
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
  if (body.action !== "prepare") return review;
  const createIntent = dependencies.createIntent ?? createDirectedMintIntent;
  const intent = await createIntent({ review, walletAddress: body.walletAddress.toLowerCase(),
    punkTokenId: body.tokenId });
  return Object.freeze({ ...review, intentId: intent.intentId, expiresAt: intent.expiresAt });
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
    if (error instanceof DirectedMintIntentError) {
      const status = error.code === "INVALID_INTENT" ? 400
        : error.code === "MINT_CHANGED" ? 409 : 410;
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
