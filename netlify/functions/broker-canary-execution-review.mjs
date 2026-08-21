import {
  validateOwnerDirectFreeMintExecutionArtifact,
} from "../../broker/src/recommendation/owner-direct-free-mint-execution.mjs";
import { getCanaryExecutionReviewToken } from "./_shared/config.mjs";
import { CURRENT_BROKER_DEPLOYMENT_SURFACE } from
  "./_shared/broker-deployment-surface.mjs";
import { activateCanaryExecutionReview } from "./_shared/canary-execution-store.mjs";
import { json, PublicError, publicFailure, readJson } from "./_shared/http.mjs";
import { safeEqual } from "./_shared/session.mjs";

function authorize(request) {
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !safeEqual(supplied, getCanaryExecutionReviewToken())) {
    throw new PublicError(401, "UNAUTHORIZED", "A valid canary review token is required.");
  }
}

function same(actual, expected, field) {
  const normalizedActual = typeof actual === "string" ? actual.toLowerCase() : actual;
  const normalizedExpected = typeof expected === "string" ? expected.toLowerCase() : expected;
  if (normalizedActual !== normalizedExpected) {
    throw new PublicError(409, "MANIFEST_BINDING_MISMATCH", `${field} is not the deployed canary.`);
  }
}

export function bindExecutionReviewToDeployment(review, surface) {
  if (surface?.deploymentStatus !== "DEPLOYED" || surface?.canaryStatus !== "DEPLOYED"
    || !surface.canary) {
    throw new PublicError(
      409,
      "NOT_DEPLOYED",
      "The deployed core and one-shot canary manifests are not both verified.",
    );
  }
  const expected = surface.canary;
  for (const [field, expectedValue] of [
    ["chainId", expected.chainId],
    ["expectedOwner", expected.expectedOwner],
    ["account", expected.account],
    ["punkCollection", expected.punkCollection],
    ["punkTokenId", expected.punkTokenId],
    ["adapter", expected.adapter],
    ["venue", expected.venue],
    ["collection", expected.collection],
    ["tokenId", expected.tokenId],
    ["functionSelector", expected.functionSelector],
    ["mintSelector", expected.mintSelector],
    ["value", expected.value],
    ["accountRuntimeCodeHash", expected.accountRuntimeCodeHash],
    ["adapterRuntimeCodeHash", expected.adapterRuntimeCodeHash],
    ["artRuntimeCodeHash", expected.artRuntimeCodeHash],
    ["coreManifestSha256", expected.coreManifestSha256],
    ["canaryManifestSha256", expected.canaryManifestSha256],
  ]) same(review[field], expectedValue, field);
  same(review.nonce, "0", "nonce");
  same(review.policyVersion, "11", "policyVersion");
  return Object.freeze({ ...review, policyModule: expected.policyModule });
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return json(
      { ok: false, code: "METHOD_NOT_ALLOWED" },
      405,
      { "netlify-cdn-cache-control": "no-store" },
    );
  }
  try {
    authorize(request);
    if (CURRENT_BROKER_DEPLOYMENT_SURFACE.deploymentStatus !== "DEPLOYED"
      || CURRENT_BROKER_DEPLOYMENT_SURFACE.canaryStatus !== "DEPLOYED") {
      throw new PublicError(
        409,
        "NOT_DEPLOYED",
        "The deployed core and one-shot canary manifests are not both verified.",
      );
    }
    const body = await readJson(request, 2_100_000);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, "artifact")) {
      throw new PublicError(400, "INVALID_REVIEW", "Supply exactly one execution artifact.");
    }
    let review;
    try {
      review = validateOwnerDirectFreeMintExecutionArtifact(body.artifact, {
        nowSeconds: Math.floor(Date.now() / 1_000),
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: "CANARY_EXECUTION_REVIEW_REJECTED",
        code: error?.code ?? "INVALID_EXECUTION_ARTIFACT",
      }));
      throw new PublicError(
        400,
        "INVALID_EXECUTION_ARTIFACT",
        "The execution artifact did not pass the strict owner-direct review boundary.",
      );
    }
    const bound = bindExecutionReviewToDeployment(review, CURRENT_BROKER_DEPLOYMENT_SURFACE);
    const activated = await activateCanaryExecutionReview(
      bound,
      CURRENT_BROKER_DEPLOYMENT_SURFACE.canary.policyModule,
    );
    return json(
      { ok: true, status: "REVIEW_HASH_ACTIVE", executionGate: activated },
      200,
      { "netlify-cdn-cache-control": "no-store" },
    );
  } catch (error) {
    const response = publicFailure(error);
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store, max-age=0");
    headers.set("netlify-cdn-cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  }
}

export const config = {
  path: "/api/admin/broker-canary-execution-review",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 5,
    windowSize: 60,
  },
};
