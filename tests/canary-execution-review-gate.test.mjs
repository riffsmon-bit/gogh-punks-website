import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalSha256,
  validateOwnerDirectFreeMintExecutionArtifact,
} from "../broker/src/recommendation/owner-direct-free-mint-execution.mjs";
import { sourceVerificationCanonicalSha256 } from
  "../broker/src/recommendation/source-verification-adoption.mjs";
import {
  CURRENT_BROKER_DEPLOYMENT_SURFACE,
  brokerDeploymentSurface,
} from "../netlify/functions/_shared/broker-deployment-surface.mjs";
import { executionReviewFromRow } from
  "../netlify/functions/_shared/canary-execution-store.mjs";
import reviewHandler, {
  bindExecutionReviewToDeployment,
  config as reviewConfig,
} from "../netlify/functions/broker-canary-execution-review.mjs";
import statusHandler, {
  config as statusConfig,
  executionGateSnapshot,
} from "../netlify/functions/broker-canary-execution-status.mjs";
import { config as brokerStatusConfig } from "../netlify/functions/broker-status.mjs";
import {
  parsePublishReviewArguments,
  publishCanaryExecutionReview,
} from "../scripts/publish-canary-execution-review.mjs";
import {
  buildCanaryMintArtifactFixtures,
} from "./helpers/canary-mint-fixtures.mjs";

function fixtureReview() {
  const fixtures = buildCanaryMintArtifactFixtures();
  return {
    fixtures,
    review: validateOwnerDirectFreeMintExecutionArtifact(
      fixtures.executionArtifact,
      { nowSeconds: 1_070 },
    ),
  };
}

function surfaceFor(review) {
  return {
    deploymentStatus: "DEPLOYED",
    canaryStatus: "DEPLOYED",
    canary: {
      chainId: review.chainId,
      expectedOwner: review.expectedOwner,
      account: review.account,
      policyModule: "0x7777777777777777777777777777777777777777",
      punkCollection: review.punkCollection,
      punkTokenId: review.punkTokenId,
      adapter: review.adapter,
      venue: review.venue,
      collection: review.collection,
      tokenId: review.tokenId,
      functionSelector: review.functionSelector,
      mintSelector: review.mintSelector,
      value: review.value,
      accountRuntimeCodeHash: review.accountRuntimeCodeHash,
      adapterRuntimeCodeHash: review.adapterRuntimeCodeHash,
      artRuntimeCodeHash: review.artRuntimeCodeHash,
      coreManifestSha256: review.coreManifestSha256,
      canaryManifestSha256: review.canaryManifestSha256,
    },
  };
}

function rebindCanaryAdoption(canary) {
  const pending = structuredClone(canary);
  for (const record of Object.values(pending.contracts)) {
    record.verificationStatus = "NOT_SUBMITTED";
  }
  pending.sourceVerificationAdoption = null;
  pending.notes = canary.sourceVerificationAdoption.pendingManifestNotes;
  canary.sourceVerificationAdoption.pendingManifestSha256 =
    sourceVerificationCanonicalSha256(pending);
  return canary;
}

function deploymentManifestsFor1797() {
  const fixtures = buildCanaryMintArtifactFixtures();
  const core = structuredClone(fixtures.coreManifest);
  const canary = structuredClone(fixtures.canaryManifest);
  canary.controllingPunkTokenId = "1797";
  rebindCanaryAdoption(canary);
  return { core, canary };
}

test("strictly validates and ABI-decodes the final short-lived owner-direct artifact", () => {
  const { fixtures, review } = fixtureReview();
  assert.equal(review.artifactSha256, canonicalSha256(fixtures.executionArtifact));
  assert.equal(review.chainId, 4663);
  assert.equal(review.value, "0");
  assert.equal(review.functionSelector, "0x4402cb61");
  assert.equal(review.mintSelector, "0x40c10f19");
  assert.equal(review.coreManifestSha256,
    fixtures.executionArtifact.confirmedEvidence.hashes.coreManifest);
  assert.equal(review.canaryManifestSha256,
    fixtures.executionArtifact.confirmedEvidence.hashes.canaryManifest);
  assert.equal(review.accountRuntimeCodeHash,
    fixtures.executionArtifact.confirmedEvidence.hashes.punkAccountRuntimeCode);
  assert.equal(review.adapterRuntimeCodeHash,
    fixtures.executionArtifact.confirmedEvidence.hashes.adapterRuntimeCode);
  assert.equal(review.artRuntimeCodeHash,
    fixtures.executionArtifact.confirmedEvidence.hashes.venueRuntimeCode);

  for (const mutate of [
    (value) => { value.transaction.value = "1"; },
    (value) => { value.transaction.data += "00"; },
    (value) => { value.reviewedAcquisition.ownerSignature = "0x01"; },
    (value) => { value.reviewedAcquisition.intent.expectedPrice = "1"; },
    (value) => { value.reviewedAcquisition.target.mintSelector = "0xdeadbeef"; },
    (value) => { value.confirmedEvidence.sourceVerification.status = "PENDING"; },
    (value) => { value.confirmedEvidence.configurationHistory.transactionCount = 12; },
    (value) => { value.safetyBoundary.arbitraryCalldataAccepted = true; },
  ]) {
    const changed = structuredClone(fixtures.executionArtifact);
    mutate(changed);
    assert.throws(
      () => validateOwnerDirectFreeMintExecutionArtifact(changed, { nowSeconds: 1_070 }),
    );
  }
  assert.throws(
    () => validateOwnerDirectFreeMintExecutionArtifact(fixtures.executionArtifact,
      { nowSeconds: 1_091 }),
    /submission margin/,
  );
});

test("activation and public status bind one exact artifact hash to fixed manifest fields", () => {
  const { review } = fixtureReview();
  const surface = surfaceFor(review);
  const bound = bindExecutionReviewToDeployment(review, surface);
  assert.equal(bound.policyModule, surface.canary.policyModule);
  const gate = executionGateSnapshot(surface, bound, { nowSeconds: 1_070 });
  assert.equal(gate.capability, true);
  assert.equal(gate.expectedArtifactSha256, review.artifactSha256);
  const { artifactSha256: _artifactSha256, ...expectedBindings } = bound;
  assert.deepEqual(gate.bindings, expectedBindings);
  assert.deepEqual(executionGateSnapshot(surface, bound, { nowSeconds: 1_091 }), {
    status: "REVIEW_EXPIRED",
    capability: false,
    reason: "ACTIVE_REVIEW_LACKS_SUBMISSION_MARGIN",
    expectedArtifactSha256: null,
    bindings: null,
  });

  for (const field of [
    "expectedOwner", "account", "adapter", "venue", "collection", "tokenId",
    "functionSelector", "mintSelector", "accountRuntimeCodeHash", "adapterRuntimeCodeHash",
    "artRuntimeCodeHash", "coreManifestSha256", "canaryManifestSha256",
  ]) {
    const changed = { ...review, [field]: field.endsWith("Sha256") || field.endsWith("CodeHash")
      ? `0x${"f".repeat(64)}` : field.endsWith("Selector") ? "0xdeadbeef"
        : field === "tokenId" ? "999" : "0x9999999999999999999999999999999999999999" };
    assert.throws(() => bindExecutionReviewToDeployment(changed, surface));
  }
});

test("deployment surface requires canonical adoptions and exact successful canary receipts", () => {
  const baseline = deploymentManifestsFor1797();
  const deployed = brokerDeploymentSurface(baseline.core, baseline.canary);
  assert.equal(deployed.deploymentStatus, "DEPLOYED");
  assert.equal(deployed.canaryStatus, "DEPLOYED");

  const emptyCoreAdoption = structuredClone(baseline);
  emptyCoreAdoption.core.sourceVerificationAdoption = {};
  assert.equal(
    brokerDeploymentSurface(emptyCoreAdoption.core, emptyCoreAdoption.canary).deploymentStatus,
    "NOT_DEPLOYED",
  );

  const emptyCanaryAdoption = structuredClone(baseline);
  emptyCanaryAdoption.canary.sourceVerificationAdoption = {};
  assert.equal(
    brokerDeploymentSurface(emptyCanaryAdoption.core, emptyCanaryAdoption.canary).canaryStatus,
    "NOT_DEPLOYED",
  );

  for (const receiptStatus of ["PENDING", "SKIPPED", "FAILED"]) {
    const changed = structuredClone(baseline);
    changed.canary.contracts.GoghOneShotCanaryArt.receiptStatus = receiptStatus;
    rebindCanaryAdoption(changed.canary);
    assert.equal(
      brokerDeploymentSurface(changed.core, changed.canary).canaryStatus,
      "NOT_DEPLOYED",
      String(receiptStatus),
    );
  }

  const crossManifestMutations = [
    ["coreDeploymentManifestSha256", `0x${"f".repeat(64)}`],
    ["coreGoghPunkAccountRegistry", "0x9999999999999999999999999999999999999999"],
    ["coreGoghPunkAccountRegistryRuntimeCodeHash", `0x${"e".repeat(64)}`],
    ["coreGoghPunkAccountImplementation", "0x9999999999999999999999999999999999999999"],
    ["coreGoghPunkAccountImplementationRuntimeCodeHash", `0x${"d".repeat(64)}`],
  ];
  for (const [field, value] of crossManifestMutations) {
    const changed = structuredClone(baseline);
    changed.canary[field] = value;
    rebindCanaryAdoption(changed.canary);
    assert.equal(
      brokerDeploymentSurface(changed.core, changed.canary).canaryStatus,
      "NOT_DEPLOYED",
      field,
    );
  }

  for (const field of [
    "coreManifestHashVerified",
    "coreRegistryRuntimeHashVerified",
    "accountImplementationRuntimeHashVerified",
    "activatedAccountRuntimeHashVerified",
    "canonicalERC6551RegistryRuntimeHashVerified",
    "accountFooterVerified",
    "expectedOwnerVerified",
    "constructorInputsVerified",
  ]) {
    const changed = structuredClone(baseline);
    changed.canary.provenanceGate[field] = false;
    rebindCanaryAdoption(changed.canary);
    assert.equal(
      brokerDeploymentSurface(changed.core, changed.canary).canaryStatus,
      "NOT_DEPLOYED",
      field,
    );
  }
});

test("current deployed manifests remain closed without an exact active review", async () => {
  assert.equal(CURRENT_BROKER_DEPLOYMENT_SURFACE.deploymentStatus, "DEPLOYED");
  assert.equal(CURRENT_BROKER_DEPLOYMENT_SURFACE.canaryStatus, "DEPLOYED");
  assert.equal(brokerDeploymentSurface().deploymentStatus, "DEPLOYED");
  const { review } = fixtureReview();
  const gate = executionGateSnapshot(CURRENT_BROKER_DEPLOYMENT_SURFACE, null);
  assert.deepEqual(gate, {
    status: "NO_ACTIVE_REVIEW",
    capability: false,
    reason: "NO_ACTIVE_EXECUTION_ARTIFACT_HASH",
    expectedArtifactSha256: null,
    bindings: null,
  });
  assert.throws(
    () => bindExecutionReviewToDeployment(review, CURRENT_BROKER_DEPLOYMENT_SURFACE),
    (error) => error.code === "MANIFEST_BINDING_MISMATCH",
  );

  const statusResponse = await statusHandler(new Request(
    "https://gogh.example/api/broker/canary-execution-status",
  ));
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(statusResponse.headers.get("netlify-cdn-cache-control"), "no-store");
  assert.equal((await statusResponse.json()).executionGate.capability, false);

  const wrongMethod = await reviewHandler(new Request(
    "https://gogh.example/api/admin/broker-canary-execution-review",
  ));
  assert.equal(wrongMethod.status, 405);
  const noBearer = await reviewHandler(new Request(
    "https://gogh.example/api/admin/broker-canary-execution-review",
    { method: "POST", body: "{}" },
  ));
  assert.equal(noBearer.status, 401);
  assert.equal((await noBearer.text()).includes("CANARY_EXECUTION_REVIEW_TOKEN"), false);
  assert.deepEqual(reviewConfig.rateLimit.aggregateBy, ["ip"]);
  assert.deepEqual(statusConfig.rateLimit.aggregateBy, ["ip"]);
  assert.deepEqual(brokerStatusConfig.rateLimit.aggregateBy, ["ip"]);
});

test("database rows expose only the public fixed review bindings", () => {
  const { review } = fixtureReview();
  const row = executionReviewFromRow({
    artifact_sha256: review.artifactSha256,
    chain_id: review.chainId,
    expected_owner: review.expectedOwner,
    account_address: review.account,
    policy_module: "0x7777777777777777777777777777777777777777",
    punk_collection: review.punkCollection,
    punk_token_id: review.punkTokenId,
    adapter_address: review.adapter,
    venue_address: review.venue,
    collection_address: review.collection,
    output_token_id: review.tokenId,
    function_selector: review.functionSelector,
    mint_selector: review.mintSelector,
    transaction_value: review.value,
    data_keccak256: review.dataKeccak256,
    intent_digest: review.intentDigest,
    account_runtime_code_hash: review.accountRuntimeCodeHash,
    adapter_runtime_code_hash: review.adapterRuntimeCodeHash,
    art_runtime_code_hash: review.artRuntimeCodeHash,
    core_manifest_sha256: review.coreManifestSha256,
    canary_manifest_sha256: review.canaryManifestSha256,
    acquisition_nonce: review.nonce,
    policy_version: review.policyVersion,
    expires_at_seconds: review.expiresAt,
  });
  assert.equal(row.artifactSha256, review.artifactSha256);
  assert.equal(Object.hasOwn(row, "data"), false);
  assert.equal(Object.hasOwn(row, "signature"), false);
});

test("runtime gate sources contain no key value, relay, signer, or private material", async () => {
  const sources = await Promise.all([
    "../netlify/functions/broker-canary-execution-review.mjs",
    "../netlify/functions/broker-canary-execution-status.mjs",
    "../netlify/functions/_shared/canary-execution-store.mjs",
    "../netlify/functions/_shared/config.mjs",
    "../scripts/publish-canary-execution-review.mjs",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const source = sources.join("\n");
  assert.doesNotMatch(source, /privateKey|seed phrase|mnemonic|sendTransaction|writeContract/);
  assert.match(source, /CANARY_EXECUTION_REVIEW_TOKEN/);
  assert.match(source, /artifactSha256/);
  assert.match(source, /expires_at >= NOW\(\) \+ INTERVAL '30 seconds'/);
});

test("operator publisher accepts one file path, keeps its bearer out of output, and posts one artifact", async () => {
  assert.deepEqual(parsePublishReviewArguments(["--artifact", "review.json"]), {
    artifact: "review.json",
  });
  for (const argv of [[], ["--token", "secret"], ["--artifact", "review.txt"]]) {
    assert.throws(() => parsePublishReviewArguments(argv));
  }
  const { fixtures, review } = fixtureReview();
  const requests = [];
  const token = "z".repeat(32);
  const result = await publishCanaryExecutionReview(["--artifact", "review.json"], {
    cwd: "/workspace",
    siteUrl: "https://gogh.example",
    token,
    readJson: async (path) => {
      assert.equal(path, "/workspace/review.json");
      return fixtures.executionArtifact;
    },
    fetchFunction: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({
        ok: true,
        status: "REVIEW_HASH_ACTIVE",
        executionGate: {
          artifactSha256: review.artifactSha256,
          expiresAt: review.expiresAt,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.artifactSha256, review.artifactSha256);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url,
    "https://gogh.example/api/admin/broker-canary-execution-review");
  assert.equal(requests[0].init.headers.authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(requests[0].init.body), { artifact: fixtures.executionArtifact });
  assert.equal(JSON.stringify(result).includes(token), false);
});
