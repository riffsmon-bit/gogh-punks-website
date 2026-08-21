import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  toFunctionSelector,
} from "viem";
import {
  buildGuardianSafeSigningDrill,
  canonicalJson,
  decodeGetTransactionHashCalldata,
  EIP712_DOMAIN_TYPEHASH,
  EXEC_TRANSACTION_SELECTOR,
  EXEC_TRANSACTION_SIGNATURE,
  GET_THRESHOLD_SELECTOR,
  GET_TRANSACTION_HASH_SIGNATURE,
  GuardianSafeSigningDrillError,
  GUARDIAN_SAFE_SIGNING_DRILL_ARTIFACT_SCHEMA,
  GUARDIAN_SAFE_SIGNING_DRILL_PAYLOAD_SCHEMA,
  SAFE_SENTINEL_OWNERS,
  SAFE_TX_TYPEHASH,
  validateGuardianSafeSigningDrillArtifact,
  ZERO_ADDRESS,
} from "../scripts/lib/guardian-safe-signing-drill.mjs";
import { parseGuardianSafeSigningDrillArguments } from "../scripts/build-guardian-safe-signing-drill.mjs";

const GENERIC_SAFE = "0x4444444444444444444444444444444444444444";
const GENERIC_OWNERS = Object.freeze([
  "0x3333333333333333333333333333333333333333",
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
]);
const SORTED_GENERIC_OWNERS = Object.freeze([
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
]);
const INPUTS = Object.freeze({
  chainId: 4663,
  safeAddress: GENERIC_SAFE,
  safeVersion: "1.4.1",
  owners: GENERIC_OWNERS,
  threshold: 2,
  safeNonce: 0,
  reviewOnly: true,
  acceptSignatures: false,
  chainWriteAuthorized: false,
});
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function build(overrides = {}) {
  return buildGuardianSafeSigningDrill({ ...INPUTS, ...overrides });
}

function validate(artifact, overrides = {}) {
  return validateGuardianSafeSigningDrillArtifact(
    artifact,
    { ...INPUTS, ...overrides },
  );
}

function expectError(code, action) {
  assert.throws(action, (error) => (
    error instanceof GuardianSafeSigningDrillError && error.code === code
  ));
}

function recursivelyAssertNonAuthorizing(value) {
  if (Array.isArray(value)) {
    value.forEach(recursivelyAssertNonAuthorizing);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (/Authorized$|Performed$/.test(key)) {
      assert.equal(entry, false, `${key} must be false`);
    }
    recursivelyAssertNonAuthorizing(entry);
  }
}

test("builds only the fixed self-CALL to getThreshold for the explicit Safe state", () => {
  const artifact = build();
  const { payload } = artifact;

  assert.equal(artifact.schema, GUARDIAN_SAFE_SIGNING_DRILL_ARTIFACT_SCHEMA);
  assert.equal(payload.schema, GUARDIAN_SAFE_SIGNING_DRILL_PAYLOAD_SCHEMA);
  assert.equal(payload.status, "REVIEW_ONLY_UNSIGNED_NOT_SIMULATED");
  assert.equal(payload.chain.chainId, 4663);
  assert.equal(payload.expectedSafeState.address, GENERIC_SAFE);
  assert.equal(payload.expectedSafeState.release, "1.4.1");
  assert.deepEqual(payload.expectedSafeState.owners, SORTED_GENERIC_OWNERS);
  assert.equal(payload.expectedSafeState.threshold, 2);
  assert.equal(payload.expectedSafeState.nonce, "0");
  assert.equal(payload.expectedSafeState.rpcVerifiedByBuilder, false);
  assert.deepEqual(payload.exactSafeTransaction, {
    to: GENERIC_SAFE,
    valueWei: "0",
    data: GET_THRESHOLD_SELECTOR,
    operation: 0,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce: "0",
    operationName: "CALL",
    targetRelationship: "SAFE_CALLS_ITSELF",
    innerFunctionSignature: "getThreshold()",
    innerFunctionSelector: GET_THRESHOLD_SELECTOR,
    innerStateMutability: "view",
    expectedInnerReturnType: "uint256",
    expectedInnerReturnValue: "2",
    expectedInnerReturnData: `0x${"0".repeat(63)}2`,
  });
  assert.equal(validate(artifact), true);
});

test("matches the pinned Safe v1.4.1 EIP-712 hash vector in two derivations", () => {
  const artifact = build();
  const { eip712 } = artifact.payload;
  const { derivation } = eip712;

  assert.equal(
    derivation.domainSeparator,
    "0x7167030530cfeae43c6425e718a76b947d062fce6b7b94f70a34b48256393537",
  );
  assert.equal(
    derivation.dataKeccak256,
    "0x2db87ab8d195278f5643e29148116ea1fcda19f78097aed749898953176804fc",
  );
  assert.equal(
    derivation.safeTxStructHash,
    "0xdff97844af3b18a17aa2db2b232b9ec014abedac37f6391d518a839144d1854e",
  );
  assert.equal(
    derivation.encodedTransactionData,
    "0x19017167030530cfeae43c6425e718a76b947d062fce6b7b94f70a34b48256393537dff97844af3b18a17aa2db2b232b9ec014abedac37f6391d518a839144d1854e",
  );
  assert.equal(derivation.encodedTransactionDataLengthBytes, 66);
  assert.equal(
    derivation.safeTransactionHash,
    "0x91ebceab24c90500c2a6899b66ba7053091a649f26af0a0bff37ccafaff80f88",
  );
  assert.equal(derivation.typedDataLibraryHash, derivation.safeTransactionHash);

  const manualDomain = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [EIP712_DOMAIN_TYPEHASH, 4663n, GENERIC_SAFE],
  ));
  assert.equal(manualDomain, derivation.domainSeparator);
  const independentTypedDataHash = hashTypedData({
    domain: { chainId: 4663n, verifyingContract: GENERIC_SAFE },
    primaryType: "SafeTx",
    types: {
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    message: {
      to: GENERIC_SAFE,
      value: 0n,
      data: GET_THRESHOLD_SELECTOR,
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: ZERO_ADDRESS,
      refundReceiver: ZERO_ADDRESS,
      nonce: 0n,
    },
  });
  assert.equal(independentTypedDataHash, derivation.safeTransactionHash);
  assert.equal(
    artifact.payloadHashes.keccak256,
    "0x39f42fe0ff167c7a4f7ce2ccf262c98f4952a2beba3cc4a3fd064fd4fd611a21",
  );
  assert.equal(
    artifact.payloadHashes.sha256,
    "0xfc2c9312a27cdc3f4404ec8ca102e9bdf3d59698066f5f2099a64bbe534e96a3",
  );
});

test("encodes and strictly decodes only the matching getTransactionHash view call", () => {
  const { payload } = build();
  const readCheck = payload.getTransactionHashReadCheck;

  assert.equal(readCheck.to, GENERIC_SAFE);
  assert.equal(readCheck.valueWei, "0");
  assert.equal(readCheck.functionSignature, GET_TRANSACTION_HASH_SIGNATURE);
  assert.equal(readCheck.selector, toFunctionSelector(GET_TRANSACTION_HASH_SIGNATURE));
  assert.equal(readCheck.stateMutability, "view");
  assert.equal(readCheck.calldata.slice(0, 10), "0xd8d11f78");
  assert.deepEqual(
    decodeGetTransactionHashCalldata(readCheck.calldata),
    readCheck.orderedArguments,
  );
  assert.equal(readCheck.expectedReturnValue, payload.eip712.derivation.safeTransactionHash);
  expectError("NONCANONICAL_CALLDATA", () => (
    decodeGetTransactionHashCalldata(`${readCheck.calldata}00`)
  ));
  expectError("INVALID_CALLDATA", () => decodeGetTransactionHashCalldata("0xdeadbeef"));
});

test("describes the exact execTransaction ABI shape without accepting signatures or calldata", () => {
  const { payload } = build();
  const shape = payload.execTransactionAbiShape;

  assert.equal(shape.to, GENERIC_SAFE);
  assert.equal(shape.functionSignature, EXEC_TRANSACTION_SIGNATURE);
  assert.equal(shape.selector, EXEC_TRANSACTION_SELECTOR);
  assert.equal(shape.selector, toFunctionSelector(EXEC_TRANSACTION_SIGNATURE));
  assert.equal(shape.abi.name, "execTransaction");
  assert.equal(shape.abi.stateMutability, "payable");
  assert.deepEqual(shape.abi.inputs.map(({ name, type }) => [name, type]), [
    ["to", "address"],
    ["value", "uint256"],
    ["data", "bytes"],
    ["operation", "uint8"],
    ["safeTxGas", "uint256"],
    ["baseGas", "uint256"],
    ["gasPrice", "uint256"],
    ["gasToken", "address"],
    ["refundReceiver", "address"],
    ["signatures", "bytes"],
  ]);
  assert.equal(shape.fixedArgumentsExcludingSignatures.length, 9);
  assert.deepEqual(shape.signatureArgument, {
    position: 9,
    name: "signatures",
    type: "bytes",
    value: null,
    provided: false,
    acceptedByBuilder: false,
  });
  assert.equal(shape.calldata, null);
  assert.equal(shape.calldataConstructed, false);
  assert.equal(shape.executable, false);
});

test("requires every generic input explicitly and rejects any policy widening", () => {
  for (const [code, overrides] of [
    ["INVALID_CHAIN_ID", { chainId: 1 }],
    ["INVALID_CHAIN_ID", { chainId: "4663" }],
    ["INVALID_SAFE_VERSION", { safeVersion: "1.3.0" }],
    ["INVALID_THRESHOLD", { threshold: 1 }],
    ["INVALID_THRESHOLD", { threshold: "2" }],
    ["INVALID_NONCE", { safeNonce: 1 }],
    ["INVALID_NONCE", { safeNonce: "0" }],
    ["AUTHORIZATION_REQUIRED_FALSE", { reviewOnly: false }],
    ["SIGNATURE_INPUT_FORBIDDEN", { acceptSignatures: true }],
    ["CHAIN_WRITE_FORBIDDEN", { chainWriteAuthorized: true }],
  ]) {
    expectError(code, () => build(overrides));
  }
  expectError("INVALID_SCHEMA", () => buildGuardianSafeSigningDrill());
  expectError("INVALID_SCHEMA", () => buildGuardianSafeSigningDrill({
    ...INPUTS,
    signatures: "0x",
  }));
});

test("requires a non-special Safe and exactly three distinct non-special owners", () => {
  for (const safeAddress of [ZERO_ADDRESS, SAFE_SENTINEL_OWNERS]) {
    expectError("INVALID_SAFE_ADDRESS", () => build({ safeAddress }));
  }
  expectError("INVALID_ADDRESS", () => build({ safeAddress: "not-an-address" }));
  for (const owners of [
    [],
    GENERIC_OWNERS.slice(0, 2),
    [...GENERIC_OWNERS, "0x5555555555555555555555555555555555555555"],
    [GENERIC_OWNERS[0], GENERIC_OWNERS[0], GENERIC_OWNERS[2]],
    [ZERO_ADDRESS, GENERIC_OWNERS[1], GENERIC_OWNERS[2]],
    [SAFE_SENTINEL_OWNERS, GENERIC_OWNERS[1], GENERIC_OWNERS[2]],
    [GENERIC_SAFE, GENERIC_OWNERS[1], GENERIC_OWNERS[2]],
    ["not-an-address", GENERIC_OWNERS[1], GENERIC_OWNERS[2]],
  ]) {
    expectError("INVALID_OWNERS", () => build({ owners }));
  }
});

test("strict validation rejects unknown fields, changed hashes, and material mutations", () => {
  const artifact = build();
  const unknown = structuredClone(artifact);
  unknown.extra = false;
  expectError("INVALID_SCHEMA", () => validate(unknown));

  for (const mutate of [
    (copy) => { copy.payload.chain.chainId = 1; },
    (copy) => { copy.payload.expectedSafeState.owners.reverse(); },
    (copy) => { copy.payload.exactSafeTransaction.to = ZERO_ADDRESS; },
    (copy) => { copy.payload.exactSafeTransaction.data = "0x"; },
    (copy) => { copy.payload.exactSafeTransaction.operation = 1; },
    (copy) => { copy.payload.eip712.derivation.safeTransactionHash = `0x${"0".repeat(64)}`; },
    (copy) => { copy.payload.execTransactionAbiShape.calldata = "0x"; },
    (copy) => { copy.payload.authorization.signingAuthorized = true; },
    (copy) => { copy.payloadHashes.sha256 = `0x${"0".repeat(64)}`; },
    (copy) => { copy.payload.thresholdDrillExpectations.unknown = false; },
  ]) {
    const copy = structuredClone(artifact);
    mutate(copy);
    expectError("ARTIFACT_MISMATCH", () => validate(copy));
  }
  expectError("INVALID_SCHEMA", () => (
    validateGuardianSafeSigningDrillArtifact(artifact)
  ));
});

test("leaves every authorization and activity false and carries no signature material", () => {
  const { payload } = build();
  recursivelyAssertNonAuthorizing(payload);
  assert.deepEqual(payload.requestScope, {
    reviewOnly: true,
    acceptsSignatures: false,
    chainWriteAuthorized: false,
  });
  assert.equal(payload.thresholdDrillExpectations.signaturesInArtifact, 0);
  assert.equal(payload.thresholdDrillExpectations.thresholdSatisfiedByArtifact, false);
  assert.equal(payload.builderCapabilities.offline, true);
  assert.equal(payload.builderCapabilities.readOnly, true);
  assert.equal(payload.builderCapabilities.signatureInput, false);
  assert.equal(payload.builderCapabilities.signatureProduction, false);
  assert.equal(payload.builderCapabilities.rpcAccess, false);
  assert.equal(payload.builderCapabilities.networkAccess, false);
  assert.equal(payload.builderCapabilities.chainWrites, false);
  assert.equal(payload.builderCapabilities.fileWrites, false);
  assert.equal(payload.builderCapabilities.cliOutput, "STDOUT_ONLY");
});

test("CLI requires the exact non-authorizing flags and emits one artifact to stdout", () => {
  const argv = [
    "--chain-id", "4663",
    "--safe-address", GENERIC_SAFE,
    "--safe-version", "1.4.1",
    "--owner", GENERIC_OWNERS[0],
    "--owner", GENERIC_OWNERS[1],
    "--owner", GENERIC_OWNERS[2],
    "--threshold", "2",
    "--safe-nonce", "0",
    "--review-only",
    "--no-signatures",
    "--no-chain-write",
  ];
  assert.deepEqual(parseGuardianSafeSigningDrillArguments(argv), INPUTS);
  for (const invalidArgv of [
    [],
    argv.slice(0, -1),
    [...argv, "--review-only"],
    argv.map((value) => value === "4663" ? "04663" : value),
    argv.map((value) => value === "1.4.1" ? "1.4.0" : value),
    argv.map((value) => value === "--no-signatures" ? "--signatures" : value),
    [...argv.slice(0, -3), "--unknown", "x", ...argv.slice(-3)],
  ]) {
    expectError("INVALID_ARGUMENTS", () => (
      parseGuardianSafeSigningDrillArguments(invalidArgv)
    ));
  }

  const result = spawnSync(process.execPath, [
    "scripts/build-guardian-safe-signing-drill.mjs",
    ...argv,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {},
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.endsWith("\n"), true);
  assert.equal(result.stdout.trimStart().startsWith("{"), true);
  assert.equal(result.stdout.trimEnd().endsWith("}"), true);
  assert.equal(validate(JSON.parse(result.stdout)), true);
});

test("builder sources expose no RPC, wallet, signing, send, deploy, env, or file API", () => {
  const paths = [
    new URL("../scripts/lib/guardian-safe-signing-drill.mjs", import.meta.url),
    new URL("../scripts/build-guardian-safe-signing-drill.mjs", import.meta.url),
  ];
  const source = paths.map((path) => readFileSync(path, "utf8")).join("\n");
  for (const forbidden of [
    /from ["']node:fs["']/,
    /createPublicClient\s*\(/,
    /createWalletClient\s*\(/,
    /privateKeyToAccount\s*\(/,
    /signMessage\s*\(/,
    /signTypedData\s*\(/,
    /sendTransaction\s*\(/,
    /writeContract\s*\(/,
    /deployContract\s*\(/,
    /simulateContract\s*\(/,
    /fetch\s*\(/,
    /process\.env/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test("canonical JSON rejects non-JSON values and unsafe or cyclic structures", () => {
  expectError("INVALID_JSON_DATA", () => canonicalJson({ value: 1n }));
  expectError("INVALID_JSON_DATA", () => canonicalJson({ value: Number.MAX_SAFE_INTEGER + 1 }));
  expectError("INVALID_JSON_DATA", () => canonicalJson({ value: undefined }));
  const cyclic = {};
  cyclic.self = cyclic;
  expectError("INVALID_JSON_DATA", () => canonicalJson(cyclic));
  const sparse = [];
  sparse.length = 1;
  expectError("INVALID_JSON_DATA", () => canonicalJson(sparse));
  assert.equal(SAFE_TX_TYPEHASH, "0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8");
});
