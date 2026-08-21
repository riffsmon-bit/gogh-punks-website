import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { encodeFunctionData } from "viem";
import {
  buildGuardianSafeDeploymentReview,
  canonicalJson,
  COMPATIBILITY_FALLBACK_HANDLER,
  decodeGuardianSafeDeploymentCalldata,
  decodeSafeSetupCalldata,
  GuardianSafeReviewError,
  GUARDIAN_SAFE_REVIEW_PAYLOAD_SCHEMA,
  GUARDIAN_SAFE_REVIEW_SCHEMA,
  normalizeGuardianSafeOwners,
  ROBINHOOD_CHAIN_ID,
  SAFE_L2_SINGLETON,
  SAFE_PROXY_FACTORY,
  SAFE_SENTINEL_OWNERS,
  SAFE_THRESHOLD,
  validateGuardianSafeDeploymentReviewArtifact,
  ZERO_ADDRESS,
} from "../scripts/lib/guardian-safe-deployment-review.mjs";
import { parseGuardianSafeReviewArguments } from "../scripts/build-guardian-safe-deployment-review.mjs";

const PUBLIC_SALT_NONCE =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const DUMMY_OWNERS = Object.freeze([
  "0x3333333333333333333333333333333333333333",
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
]);
const SORTED_DUMMY_OWNERS = Object.freeze([
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
]);
const REVIEW_INPUTS = Object.freeze({
  owners: DUMMY_OWNERS,
  threshold: 2,
  saltNonce: PUBLIC_SALT_NONCE,
});
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

const buildReview = (overrides = {}) => buildGuardianSafeDeploymentReview({
  ...REVIEW_INPUTS,
  ...overrides,
});
const validateReview = (artifact, overrides = {}) => (
  validateGuardianSafeDeploymentReviewArtifact(artifact, {
    ...REVIEW_INPUTS,
    ...overrides,
  })
);

function expectError(code, action) {
  assert.throws(action, (error) => (
    error instanceof GuardianSafeReviewError && error.code === code
  ));
}

function recursivelyAssertAuthorizationFlagsFalse(value) {
  if (Array.isArray(value)) {
    value.forEach(recursivelyAssertAuthorizationFlagsFalse);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (/Authorized$/.test(key)) assert.equal(entry, false, `${key} must be false`);
    recursivelyAssertAuthorizationFlagsFalse(entry);
  }
}

test("builds the exact sorted 2-of-3 SafeL2 review with an inert setup", () => {
  const artifact = buildReview();
  const { payload } = artifact;

  assert.equal(artifact.schema, GUARDIAN_SAFE_REVIEW_SCHEMA);
  assert.equal(payload.schema, GUARDIAN_SAFE_REVIEW_PAYLOAD_SCHEMA);
  assert.equal(payload.status, "REVIEW_ONLY_NOT_DEPLOYED");
  assert.equal(payload.chain.chainId, ROBINHOOD_CHAIN_ID);
  assert.equal(payload.safeRelease.version, "1.4.1");
  assert.equal(
    payload.safeRelease.contracts.safeProxyFactory.address,
    SAFE_PROXY_FACTORY,
  );
  assert.equal(payload.safeRelease.contracts.safeL2Singleton.address, SAFE_L2_SINGLETON);
  assert.equal(
    payload.safeRelease.contracts.compatibilityFallbackHandler.address,
    COMPATIBILITY_FALLBACK_HANDLER,
  );
  assert.deepEqual(payload.proposedConfiguration.owners, SORTED_DUMMY_OWNERS);
  assert.deepEqual(normalizeGuardianSafeOwners(DUMMY_OWNERS), SORTED_DUMMY_OWNERS);
  assert.equal(payload.proposedConfiguration.ownerOrdering, "NUMERIC_ASCENDING");
  assert.equal(payload.proposedConfiguration.threshold, SAFE_THRESHOLD);
  assert.deepEqual(payload.proposedConfiguration.initialModules, []);
  assert.equal(payload.proposedConfiguration.initialGuard, ZERO_ADDRESS);
  assert.deepEqual(payload.proposedConfiguration.setup, {
    delegatecallTarget: ZERO_ADDRESS,
    delegatecallData: "0x",
    delegatecallUsed: false,
    fallbackHandler: COMPATIBILITY_FALLBACK_HANDLER,
    paymentToken: ZERO_ADDRESS,
    paymentWei: "0",
    paymentReceiver: ZERO_ADDRESS,
  });
  assert.equal(payload.deploymentCall.valueWei, "0");
  assert.equal(payload.deploymentCall.operation, "CALL");
  assert.equal(validateReview(artifact), true);
});

test("round-trips the exact nested setup and chain-specific factory calldata", () => {
  const { payload } = buildReview();
  const decodedFactory = decodeGuardianSafeDeploymentCalldata(
    payload.deploymentCall.calldata,
  );
  const decodedSetup = decodeSafeSetupCalldata(payload.derivation.initializer);

  assert.deepEqual(decodedFactory, payload.deploymentCall.decodedArguments);
  assert.deepEqual(decodedSetup, decodedFactory.setup);
  assert.equal(decodedFactory.functionName, "createChainSpecificProxyWithNonce");
  assert.equal(decodedFactory.singleton, SAFE_L2_SINGLETON);
  assert.equal(decodedFactory.initializer, payload.derivation.initializer);
  assert.deepEqual(decodedFactory.setup.owners, SORTED_DUMMY_OWNERS);
  assert.equal(decodedFactory.setup.threshold, "2");
  assert.equal(decodedFactory.setup.to, ZERO_ADDRESS);
  assert.equal(decodedFactory.setup.data, "0x");
  assert.equal(decodedFactory.setup.fallbackHandler, COMPATIBILITY_FALLBACK_HANDLER);
  assert.equal(decodedFactory.setup.paymentToken, ZERO_ADDRESS);
  assert.equal(decodedFactory.setup.paymentWei, "0");
  assert.equal(decodedFactory.setup.paymentReceiver, ZERO_ADDRESS);
});

test("matches the fixed CREATE2 and artifact hash vector for the reviewed nonce", () => {
  const artifact = buildReview();
  const { payload } = artifact;

  assert.equal(
    payload.componentHashes.initializerKeccak256,
    "0xe4311245ea7d1a003d6f0e055cc733003a7efa391562c2f4435a01e7f89ff487",
  );
  assert.equal(
    payload.componentHashes.proxyCreationCodeKeccak256,
    "0x1856e0ee08399d74e0ea0b03adca210aeade6f748969ac023cdcb4dd62dcaf5f",
  );
  assert.equal(
    payload.componentHashes.proxyDeploymentDataKeccak256,
    "0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee",
  );
  assert.equal(
    payload.derivation.create2Salt,
    "0x1c2e2e23c217cd4790c129a141979fa7034aab148488682dd4afd82dcb75d62c",
  );
  assert.equal(
    payload.derivation.predictedSafeAddress,
    "0x5EDDAded0DF32F640BFF5Fa194a4Cc4EA09adAc8",
  );
  assert.equal(
    payload.componentHashes.deploymentCalldataKeccak256,
    "0x9539291ebef865dd7c081083ad7d22adfd8fb87cdb7f339a0691e480c13a8b14",
  );
  assert.equal(
    artifact.payloadHashes.keccak256,
    "0xbb422f986ab5cc03b1affc0d4aca7c93ceaa008e47ccafb411c80fe6919ea803",
  );
  assert.equal(
    artifact.payloadHashes.sha256,
    "0xeff9c4e0660988d821e0bf5f9c1168a3b33a426ee3ded5cd750def202a9ef2e3",
  );
});

test("requires an explicit nonzero 32-byte public salt nonce and has no default", () => {
  for (const saltNonce of [
    undefined,
    null,
    "",
    "0x01",
    "1",
    `0x${"0".repeat(64)}`,
    `0x${"1".repeat(66)}`,
    `0x${"z".repeat(64)}`,
  ]) {
    expectError("INVALID_SALT_NONCE", () => (
      buildReview({ saltNonce })
    ));
  }
  expectError("INVALID_OWNERS", () => buildGuardianSafeDeploymentReview());
});

test("requires exactly three distinct nonzero owners and the explicit 2 threshold", () => {
  for (const owners of [
    undefined,
    [],
    DUMMY_OWNERS.slice(0, 2),
    [...DUMMY_OWNERS, "0x4444444444444444444444444444444444444444"],
    [DUMMY_OWNERS[0], DUMMY_OWNERS[0], DUMMY_OWNERS[2]],
    [DUMMY_OWNERS[0], ZERO_ADDRESS, DUMMY_OWNERS[2]],
    [DUMMY_OWNERS[0], SAFE_SENTINEL_OWNERS, DUMMY_OWNERS[2]],
    [DUMMY_OWNERS[0], "not-an-address", DUMMY_OWNERS[2]],
  ]) {
    expectError("INVALID_OWNERS", () => buildReview({ owners }));
  }
  for (const threshold of [undefined, null, 0, 1, 3, "2"]) {
    expectError("INVALID_THRESHOLD", () => buildReview({ threshold }));
  }
  expectError("INVALID_OWNERS", () => normalizeGuardianSafeOwners(
    DUMMY_OWNERS,
    { predictedSafeAddress: DUMMY_OWNERS[0] },
  ));
});

test("changes CREATE2 output deterministically when the explicit nonce changes", () => {
  const first = buildReview();
  const second = buildReview({
    saltNonce: `0x${"1".repeat(64)}`,
  });
  const repeated = buildReview();

  assert.notEqual(
    first.payload.derivation.create2Salt,
    second.payload.derivation.create2Salt,
  );
  assert.notEqual(
    first.payload.derivation.predictedSafeAddress,
    second.payload.derivation.predictedSafeAddress,
  );
  assert.equal(canonicalJson(first), canonicalJson(repeated));
});

test("rejects generic factory calls, trailing bytes, and malformed setup bytes", () => {
  const { payload } = buildReview();
  const genericFactoryAbi = [{
    type: "function",
    name: "createProxyWithNonce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_singleton", type: "address" },
      { name: "initializer", type: "bytes" },
      { name: "saltNonce", type: "uint256" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  }];
  const genericCalldata = encodeFunctionData({
    abi: genericFactoryAbi,
    functionName: "createProxyWithNonce",
    args: [SAFE_L2_SINGLETON, payload.derivation.initializer, BigInt(PUBLIC_SALT_NONCE)],
  });

  expectError("INVALID_CALLDATA", () => (
    decodeGuardianSafeDeploymentCalldata(genericCalldata)
  ));
  expectError("NONCANONICAL_CALLDATA", () => (
    decodeGuardianSafeDeploymentCalldata(`${payload.deploymentCall.calldata}00`)
  ));
  expectError("NONCANONICAL_CALLDATA", () => (
    decodeSafeSetupCalldata(`${payload.derivation.initializer}00`)
  ));
  expectError("INVALID_CALLDATA", () => decodeSafeSetupCalldata("0xdeadbeef"));
});

test("strict validation rejects unknown fields and every material mutation", () => {
  const artifact = buildReview();
  const unknownField = structuredClone(artifact);
  unknownField.extra = false;
  expectError("INVALID_SCHEMA", () => (
    validateReview(unknownField)
  ));

  const nestedUnknownField = structuredClone(artifact);
  nestedUnknownField.payload.proposedConfiguration.setup.unknown = false;
  expectError("ARTIFACT_MISMATCH", () => validateReview(nestedUnknownField));

  for (const mutate of [
    (copy) => { copy.payload.proposedConfiguration.threshold = 1; },
    (copy) => { copy.payload.proposedConfiguration.owners.reverse(); },
    (copy) => { copy.payload.proposedConfiguration.setup.delegatecallUsed = true; },
    (copy) => { copy.payload.proposedConfiguration.initialModules.push(ZERO_ADDRESS); },
    (copy) => { copy.payload.authorization.deploymentAuthorized = true; },
    (copy) => { copy.payload.deploymentCall.valueWei = "1"; },
    (copy) => { copy.payload.derivation.predictedSafeAddress = ZERO_ADDRESS; },
    (copy) => { copy.payloadHashes.keccak256 = `0x${"0".repeat(64)}`; },
  ]) {
    const copy = structuredClone(artifact);
    mutate(copy);
    expectError("ARTIFACT_MISMATCH", () => (
      validateReview(copy)
    ));
  }
});

test("strict validation requires independent expected inputs", () => {
  const artifact = buildReview();
  expectError("INVALID_OWNERS", () => (
    validateGuardianSafeDeploymentReviewArtifact(artifact)
  ));
  expectError("ARTIFACT_MISMATCH", () => validateReview(artifact, {
    owners: [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x4444444444444444444444444444444444444444",
    ],
  }));
});

test("makes no signer or device assurance and leaves every authorization false", () => {
  const artifact = buildReview();
  const { custodyAssessment, authorization, builderCapabilities } = artifact.payload;

  assert.equal(custodyAssessment.scope, "SAME_HOST_BETA_ONLY");
  assert.equal(custodyAssessment.sameHostBetaCustody, true);
  assert.equal(custodyAssessment.productionSignerIndependenceEstablished, false);
  assert.equal(custodyAssessment.signerIdentityVerified, false);
  assert.equal(custodyAssessment.ownerControlVerified, false);
  assert.equal(custodyAssessment.deviceIndependenceVerified, false);
  assert.equal(custodyAssessment.productionReady, false);
  assert.equal(authorization.reviewOnly, true);
  recursivelyAssertAuthorizationFlagsFalse(artifact);
  assert.deepEqual(builderCapabilities, {
    deterministic: true,
    offline: true,
    rpcAccess: false,
    walletAccess: false,
    privateKeyAccess: false,
    secretGeneration: false,
    signing: false,
    submission: false,
    deployment: false,
    chainWrites: false,
    fileWrites: false,
    cliOutput: "STDOUT_ONLY",
  });
});

test("CLI requires the exact explicit config and emits one JSON artifact to stdout", () => {
  const validArgv = [
    "--owner", DUMMY_OWNERS[0],
    "--owner", DUMMY_OWNERS[1],
    "--owner", DUMMY_OWNERS[2],
    "--threshold", "2",
    "--salt-nonce", PUBLIC_SALT_NONCE,
  ];
  assert.deepEqual(
    parseGuardianSafeReviewArguments(validArgv),
    REVIEW_INPUTS,
  );
  for (const argv of [
    [],
    ["--salt-nonce"],
    [...validArgv.slice(0, -2), "--salt", PUBLIC_SALT_NONCE],
    [...validArgv.slice(0, -2), "--threshold", "2"],
    [...validArgv.slice(0, -4), "--threshold", "1", "--salt-nonce", PUBLIC_SALT_NONCE],
    [...validArgv.slice(0, -1), "--other"],
  ]) {
    expectError("INVALID_ARGUMENTS", () => parseGuardianSafeReviewArguments(argv));
  }

  const result = spawnSync(process.execPath, [
    "scripts/build-guardian-safe-deployment-review.mjs",
    ...validArgv,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {},
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.endsWith("\n"), true);
  const artifact = JSON.parse(result.stdout);
  assert.equal(validateReview(artifact), true);
});
