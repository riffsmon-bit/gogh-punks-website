import { CURRENT_BROKER_DEPLOYMENT_SURFACE } from
  "./_shared/broker-deployment-surface.mjs";
import { getCurrentCanaryExecutionRecord } from "./_shared/canary-execution-store.mjs";
import { json } from "./_shared/http.mjs";

function disabled(status, reason) {
  return Object.freeze({
    status,
    capability: false,
    reason,
    expectedArtifactSha256: null,
    bindings: null,
  });
}

function equal(actual, expected) {
  if (typeof actual === "string" && typeof expected === "string") {
    return actual.toLowerCase() === expected.toLowerCase();
  }
  return actual === expected;
}

export function executionGateSnapshot(surface, review, options = {}) {
  if (surface?.deploymentStatus !== "DEPLOYED" || surface?.canaryStatus !== "DEPLOYED"
    || !surface.canary) {
    return disabled("NOT_DEPLOYED", surface?.reason ?? "DEPLOYMENT_MANIFESTS_NOT_READY");
  }
  if (!review) return disabled("NO_ACTIVE_REVIEW", "NO_ACTIVE_EXECUTION_ARTIFACT_HASH");
  const expected = surface.canary;
  for (const [field, expectedValue] of [
    ["chainId", expected.chainId],
    ["expectedOwner", expected.expectedOwner],
    ["account", expected.account],
    ["policyModule", expected.policyModule],
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
  ]) {
    if (!equal(review[field], expectedValue)) {
      return disabled("REVIEW_MISMATCH", `ACTIVE_REVIEW_${field.toUpperCase()}_MISMATCH`);
    }
  }
  if (review.nonce !== "0" || review.policyVersion !== "11"
    || !/^0x[0-9a-f]{64}$/.test(review.artifactSha256)
    || !/^0x[0-9a-f]{64}$/.test(review.dataKeccak256)
    || !/^0x[0-9a-f]{64}$/.test(review.intentDigest)
    || !/^(?:0|[1-9]\d*)$/.test(review.expiresAt)) {
    return disabled("REVIEW_MISMATCH", "ACTIVE_REVIEW_SHAPE_MISMATCH");
  }
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0
    || BigInt(review.expiresAt) < BigInt(nowSeconds) + 30n) {
    return disabled("REVIEW_EXPIRED", "ACTIVE_REVIEW_LACKS_SUBMISSION_MARGIN");
  }
  return Object.freeze({
    status: "READY_FOR_OWNER_REVIEW",
    capability: true,
    reason: null,
    expectedArtifactSha256: review.artifactSha256,
    bindings: Object.freeze({
      chainId: review.chainId,
      expectedOwner: review.expectedOwner,
      account: review.account,
      policyModule: review.policyModule,
      punkCollection: review.punkCollection,
      punkTokenId: review.punkTokenId,
      adapter: review.adapter,
      venue: review.venue,
      collection: review.collection,
      tokenId: review.tokenId,
      functionSelector: review.functionSelector,
      mintSelector: review.mintSelector,
      value: review.value,
      dataKeccak256: review.dataKeccak256,
      intentDigest: review.intentDigest,
      accountRuntimeCodeHash: review.accountRuntimeCodeHash,
      adapterRuntimeCodeHash: review.adapterRuntimeCodeHash,
      artRuntimeCodeHash: review.artRuntimeCodeHash,
      coreManifestSha256: review.coreManifestSha256,
      canaryManifestSha256: review.canaryManifestSha256,
      nonce: review.nonce,
      policyVersion: review.policyVersion,
      expiresAt: review.expiresAt,
    }),
  });
}

export default async function handler(request) {
  if (request.method !== "GET") {
    return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  }
  let record = null;
  if (CURRENT_BROKER_DEPLOYMENT_SURFACE.deploymentStatus === "DEPLOYED"
    && CURRENT_BROKER_DEPLOYMENT_SURFACE.canaryStatus === "DEPLOYED") {
    try {
      record = await getCurrentCanaryExecutionRecord();
    } catch {
      // A missing migration, database outage, or malformed row must leave execution disabled.
    }
  }
  let executionGate = executionGateSnapshot(
    CURRENT_BROKER_DEPLOYMENT_SURFACE,
    record?.review ?? null,
    { nowSeconds: Math.floor(Date.now() / 1_000) },
  );
  if (executionGate.capability === true && !record?.artifact) {
    executionGate = disabled("REVIEW_ARTIFACT_UNAVAILABLE", "ACTIVE_REVIEW_ARTIFACT_UNAVAILABLE");
  }
  return json(
    {
      ok: true,
      chainId: 4663,
      executionGate,
      executionArtifact: executionGate.capability === true ? record.artifact : null,
      autonomyStatus: "DISABLED",
    },
    200,
    {
      "cache-control": "no-store, max-age=0",
      "netlify-cdn-cache-control": "no-store",
    },
  );
}

export const config = {
  path: "/api/broker/canary-execution-status",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 120,
    windowSize: 60,
  },
};
