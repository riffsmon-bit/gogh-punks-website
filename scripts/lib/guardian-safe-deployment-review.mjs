import { createHash } from "node:crypto";
import {
  concatHex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  getCreate2Address,
  keccak256,
} from "viem";

export const GUARDIAN_SAFE_REVIEW_SCHEMA =
  "GOGH_GUARDIAN_SAFE_DEPLOYMENT_REVIEW_ARTIFACT_V1";
export const GUARDIAN_SAFE_REVIEW_PAYLOAD_SCHEMA =
  "GOGH_GUARDIAN_SAFE_DEPLOYMENT_REVIEW_V1";
export const ROBINHOOD_CHAIN_ID = 4663;
export const SAFE_VERSION = "1.4.1";
export const SAFE_THRESHOLD = 2;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const SAFE_SENTINEL_OWNERS = "0x0000000000000000000000000000000000000001";

export const SAFE_L2_SINGLETON = getAddress(
  "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
);
export const SAFE_PROXY_FACTORY = getAddress(
  "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
);
export const COMPATIBILITY_FALLBACK_HANDLER = getAddress(
  "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
);

export const SAFE_L2_RUNTIME_CODE_HASH =
  "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff";
export const SAFE_PROXY_FACTORY_RUNTIME_CODE_HASH =
  "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317";
export const COMPATIBILITY_FALLBACK_HANDLER_RUNTIME_CODE_HASH =
  "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9";

// Exact SafeProxy creation code from @safe-global/safe-contracts@1.4.1,
// build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json.
export const SAFE_PROXY_CREATION_CODE =
  "0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564";

const safeSetupAbi = [{
  type: "function",
  name: "setup",
  stateMutability: "nonpayable",
  inputs: [
    { name: "_owners", type: "address[]" },
    { name: "_threshold", type: "uint256" },
    { name: "to", type: "address" },
    { name: "data", type: "bytes" },
    { name: "fallbackHandler", type: "address" },
    { name: "paymentToken", type: "address" },
    { name: "payment", type: "uint256" },
    { name: "paymentReceiver", type: "address" },
  ],
  outputs: [],
}];

const safeProxyFactoryAbi = [{
  type: "function",
  name: "createChainSpecificProxyWithNonce",
  stateMutability: "nonpayable",
  inputs: [
    { name: "_singleton", type: "address" },
    { name: "initializer", type: "bytes" },
    { name: "saltNonce", type: "uint256" },
  ],
  outputs: [{ name: "proxy", type: "address" }],
}];

export class GuardianSafeReviewError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "GuardianSafeReviewError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new GuardianSafeReviewError(code, message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])) {
    fail(
      "INVALID_SCHEMA",
      `${label} keys must be exactly: ${wanted.join(", ")}`,
    );
  }
}

function assertJsonData(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail("INVALID_JSON_DATA", `${label} contains a non-safe-integer number`);
    }
    return;
  }
  if (typeof value !== "object" || seen.has(value)) {
    fail("INVALID_JSON_DATA", `${label} is not finite JSON data`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonData(entry, `${label}[${index}]`, seen));
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      fail("INVALID_JSON_DATA", `${label} contains a non-plain object`);
    }
    for (const [key, entry] of Object.entries(value)) {
      assertJsonData(entry, `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
}

export function canonicalJson(value) {
  assertJsonData(value, "canonical JSON input");
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256HexBytes(value) {
  return `0x${createHash("sha256").update(Buffer.from(value.slice(2), "hex")).digest("hex")}`;
}

function sha256CanonicalJson(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function normalizePublicSaltNonce(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail(
      "INVALID_SALT_NONCE",
      "salt nonce must be supplied explicitly as exactly 32 bytes of hexadecimal",
    );
  }
  const normalized = value.toLowerCase();
  if (BigInt(normalized) === 0n) {
    fail("INVALID_SALT_NONCE", "salt nonce must be nonzero");
  }
  return normalized;
}

export function normalizeGuardianSafeOwners(value, { predictedSafeAddress } = {}) {
  if (!Array.isArray(value) || value.length !== 3) {
    fail("INVALID_OWNERS", "exactly three owner addresses must be supplied explicitly");
  }
  const owners = value.map((owner, index) => {
    if (typeof owner !== "string") {
      fail("INVALID_OWNERS", `owner ${index + 1} must be an address string`);
    }
    let normalized;
    try {
      normalized = getAddress(owner);
    } catch {
      fail("INVALID_OWNERS", `owner ${index + 1} is not a valid address`);
    }
    if (normalized === ZERO_ADDRESS || normalized === SAFE_SENTINEL_OWNERS) {
      fail(
        "INVALID_OWNERS",
        `owner ${index + 1} must not be Safe's zero or sentinel address`,
      );
    }
    return normalized;
  });
  if (new Set(owners.map((owner) => owner.toLowerCase())).size !== owners.length) {
    fail("INVALID_OWNERS", "owner addresses must be distinct");
  }
  if (predictedSafeAddress !== undefined) {
    let safeAddress;
    try {
      safeAddress = getAddress(predictedSafeAddress);
    } catch {
      fail("INVALID_OWNERS", "predicted Safe address is invalid");
    }
    if (owners.includes(safeAddress)) {
      fail("INVALID_OWNERS", "an owner must not equal the predicted Safe itself");
    }
  }
  return owners.sort((left, right) => {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  });
}

function normalizeThreshold(value) {
  if (value !== SAFE_THRESHOLD) {
    fail("INVALID_THRESHOLD", "threshold must be supplied explicitly as 2");
  }
  return value;
}

function normalizeDecodedAddress(value, label) {
  try {
    return getAddress(value);
  } catch {
    fail("INVALID_CALLDATA", `${label} is not an address`);
  }
}

export function decodeSafeSetupCalldata(initializer) {
  if (typeof initializer !== "string" || !/^0x[0-9a-fA-F]*$/.test(initializer)
    || initializer.length % 2 !== 0) {
    fail("INVALID_CALLDATA", "Safe setup initializer must be hexadecimal bytes");
  }
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: safeSetupAbi, data: initializer });
  } catch {
    fail("INVALID_CALLDATA", "initializer is not canonical Safe setup calldata");
  }
  if (decoded.functionName !== "setup" || !Array.isArray(decoded.args)
    || decoded.args.length !== 8) {
    fail("INVALID_CALLDATA", "initializer must call Safe.setup with eight arguments");
  }
  const [owners, threshold, to, data, fallbackHandler, paymentToken, payment, paymentReceiver]
    = decoded.args;
  const reencoded = encodeFunctionData({
    abi: safeSetupAbi,
    functionName: "setup",
    args: [owners, threshold, to, data, fallbackHandler, paymentToken, payment, paymentReceiver],
  });
  if (reencoded.toLowerCase() !== initializer.toLowerCase()) {
    fail("NONCANONICAL_CALLDATA", "Safe setup calldata has trailing or noncanonical bytes");
  }
  return {
    functionName: "setup",
    owners: owners.map((owner, index) => normalizeDecodedAddress(owner, `owners[${index}]`)),
    threshold: threshold.toString(),
    to: normalizeDecodedAddress(to, "to"),
    data: data.toLowerCase(),
    fallbackHandler: normalizeDecodedAddress(fallbackHandler, "fallbackHandler"),
    paymentToken: normalizeDecodedAddress(paymentToken, "paymentToken"),
    paymentWei: payment.toString(),
    paymentReceiver: normalizeDecodedAddress(paymentReceiver, "paymentReceiver"),
  };
}

export function decodeGuardianSafeDeploymentCalldata(calldata) {
  if (typeof calldata !== "string" || !/^0x[0-9a-fA-F]*$/.test(calldata)
    || calldata.length % 2 !== 0) {
    fail("INVALID_CALLDATA", "factory calldata must be hexadecimal bytes");
  }
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: safeProxyFactoryAbi, data: calldata });
  } catch {
    fail(
      "INVALID_CALLDATA",
      "calldata is not createChainSpecificProxyWithNonce(address,bytes,uint256)",
    );
  }
  if (decoded.functionName !== "createChainSpecificProxyWithNonce"
    || !Array.isArray(decoded.args) || decoded.args.length !== 3) {
    fail("INVALID_CALLDATA", "wrong SafeProxyFactory function");
  }
  const [singleton, initializer, saltNonce] = decoded.args;
  const reencoded = encodeFunctionData({
    abi: safeProxyFactoryAbi,
    functionName: "createChainSpecificProxyWithNonce",
    args: [singleton, initializer, saltNonce],
  });
  if (reencoded.toLowerCase() !== calldata.toLowerCase()) {
    fail("NONCANONICAL_CALLDATA", "factory calldata has trailing or noncanonical bytes");
  }
  return {
    functionName: "createChainSpecificProxyWithNonce",
    singleton: normalizeDecodedAddress(singleton, "singleton"),
    initializer: initializer.toLowerCase(),
    saltNonceUint256: saltNonce.toString(),
    setup: decodeSafeSetupCalldata(initializer),
  };
}

function sameAddress(left, right) {
  return getAddress(left) === getAddress(right);
}

function assertExpectedDecodedCall(decoded, owners, threshold, saltNonce) {
  if (!sameAddress(decoded.singleton, SAFE_L2_SINGLETON)) {
    fail("ENCODING_INVARIANT_FAILED", "decoded singleton differs from SafeL2 v1.4.1");
  }
  if (decoded.saltNonceUint256 !== BigInt(saltNonce).toString()) {
    fail("ENCODING_INVARIANT_FAILED", "decoded salt nonce differs from explicit input");
  }
  const setup = decoded.setup;
  if (setup.owners.length !== owners.length
    || setup.owners.some((owner, index) => owner !== owners[index])
    || setup.threshold !== threshold.toString()
    || !sameAddress(setup.to, ZERO_ADDRESS)
    || setup.data !== "0x"
    || !sameAddress(setup.fallbackHandler, COMPATIBILITY_FALLBACK_HANDLER)
    || !sameAddress(setup.paymentToken, ZERO_ADDRESS)
    || setup.paymentWei !== "0"
    || !sameAddress(setup.paymentReceiver, ZERO_ADDRESS)) {
    fail("ENCODING_INVARIANT_FAILED", "decoded Safe setup differs from the exact review policy");
  }
}

function contractReference(address, runtimeCodeHash) {
  return {
    address,
    expectedRuntimeCodeHash: runtimeCodeHash,
    codeHashSource: "GUARDIAN_SAFE_PREP_DUAL_RPC_OBSERVATION",
    recheckedByThisOfflineBuilder: false,
  };
}

function buildPayload(explicitOwners, explicitThreshold, explicitSaltNonce) {
  const owners = normalizeGuardianSafeOwners(explicitOwners);
  const threshold = normalizeThreshold(explicitThreshold);
  const saltNonce = normalizePublicSaltNonce(explicitSaltNonce);
  const saltNonceUint256 = BigInt(saltNonce);
  const initializer = encodeFunctionData({
    abi: safeSetupAbi,
    functionName: "setup",
    args: [
      owners,
      BigInt(threshold),
      ZERO_ADDRESS,
      "0x",
      COMPATIBILITY_FALLBACK_HANDLER,
      ZERO_ADDRESS,
      0n,
      ZERO_ADDRESS,
    ],
  });
  const deploymentCalldata = encodeFunctionData({
    abi: safeProxyFactoryAbi,
    functionName: "createChainSpecificProxyWithNonce",
    args: [SAFE_L2_SINGLETON, initializer, saltNonceUint256],
  });
  const decoded = decodeGuardianSafeDeploymentCalldata(deploymentCalldata);
  assertExpectedDecodedCall(decoded, owners, threshold, saltNonce);

  const initializerKeccak256 = keccak256(initializer);
  const create2Salt = keccak256(encodePacked(
    ["bytes32", "uint256", "uint256"],
    [initializerKeccak256, saltNonceUint256, BigInt(ROBINHOOD_CHAIN_ID)],
  ));
  const encodedSingleton = encodeAbiParameters(
    [{ type: "uint256" }],
    [BigInt(SAFE_L2_SINGLETON)],
  );
  const proxyDeploymentData = concatHex([SAFE_PROXY_CREATION_CODE, encodedSingleton]);
  const proxyDeploymentDataKeccak256 = keccak256(proxyDeploymentData);
  const predictedSafeAddress = getCreate2Address({
    from: SAFE_PROXY_FACTORY,
    salt: create2Salt,
    bytecodeHash: proxyDeploymentDataKeccak256,
  });
  normalizeGuardianSafeOwners(owners, { predictedSafeAddress });

  return {
    schema: GUARDIAN_SAFE_REVIEW_PAYLOAD_SCHEMA,
    schemaVersion: 1,
    status: "REVIEW_ONLY_NOT_DEPLOYED",
    chain: {
      name: "Robinhood Chain",
      chainId: ROBINHOOD_CHAIN_ID,
      nativeCurrency: "ETH",
    },
    safeRelease: {
      version: SAFE_VERSION,
      singletonVariant: "SafeL2",
      sourcePackage: "@safe-global/safe-contracts@1.4.1",
      contracts: {
        safeProxyFactory: contractReference(
          SAFE_PROXY_FACTORY,
          SAFE_PROXY_FACTORY_RUNTIME_CODE_HASH,
        ),
        safeL2Singleton: contractReference(SAFE_L2_SINGLETON, SAFE_L2_RUNTIME_CODE_HASH),
        compatibilityFallbackHandler: contractReference(
          COMPATIBILITY_FALLBACK_HANDLER,
          COMPATIBILITY_FALLBACK_HANDLER_RUNTIME_CODE_HASH,
        ),
      },
    },
    proposedConfiguration: {
      owners,
      ownerOrdering: "NUMERIC_ASCENDING",
      ownerCount: owners.length,
      threshold,
      setup: {
        delegatecallTarget: ZERO_ADDRESS,
        delegatecallData: "0x",
        delegatecallUsed: false,
        fallbackHandler: COMPATIBILITY_FALLBACK_HANDLER,
        paymentToken: ZERO_ADDRESS,
        paymentWei: "0",
        paymentReceiver: ZERO_ADDRESS,
      },
      initialModules: [],
      initialGuard: ZERO_ADDRESS,
    },
    custodyAssessment: {
      scope: "SAME_HOST_BETA_ONLY",
      sameHostBetaCustody: true,
      productionSignerIndependenceEstablished: false,
      signerIdentityVerified: false,
      ownerControlVerified: false,
      deviceIndependenceVerified: false,
      productionReady: false,
      warning: "Two same-host software signers can satisfy this 2-of-3 threshold; use three independently controlled custody domains before production.",
    },
    saltNonce: {
      value: saltNonce,
      uint256Decimal: saltNonceUint256.toString(),
      inputRequired: true,
      generatedByBuilder: false,
      publicValue: true,
      csprngRequired: true,
      csprngProvenanceVerifiedByBuilder: false,
      warning: "The caller must generate this public nonce with a CSPRNG; this offline builder validates only its nonzero 32-byte representation.",
    },
    derivation: {
      factoryMethod: "createChainSpecificProxyWithNonce(address,bytes,uint256)",
      chainSpecific: true,
      create2SaltFormula: "keccak256(abi.encodePacked(keccak256(initializer), uint256(saltNonce), uint256(chainId)))",
      proxyDeploymentDataFormula: "abi.encodePacked(type(SafeProxy).creationCode, uint256(uint160(singleton)))",
      initializer,
      proxyCreationCode: SAFE_PROXY_CREATION_CODE,
      proxyDeploymentData,
      create2Salt,
      predictedSafeAddress,
    },
    deploymentCall: {
      to: SAFE_PROXY_FACTORY,
      valueWei: "0",
      operation: "CALL",
      functionSignature: "createChainSpecificProxyWithNonce(address,bytes,uint256)",
      calldata: deploymentCalldata,
      decodedArguments: decoded,
    },
    componentHashes: {
      initializerKeccak256,
      initializerSha256: sha256HexBytes(initializer),
      proxyCreationCodeKeccak256: keccak256(SAFE_PROXY_CREATION_CODE),
      proxyCreationCodeSha256: sha256HexBytes(SAFE_PROXY_CREATION_CODE),
      proxyDeploymentDataKeccak256,
      proxyDeploymentDataSha256: sha256HexBytes(proxyDeploymentData),
      create2Salt,
      deploymentCalldataKeccak256: keccak256(deploymentCalldata),
      deploymentCalldataSha256: sha256HexBytes(deploymentCalldata),
    },
    authorization: {
      reviewOnly: true,
      transactionAuthorized: false,
      signingAuthorized: false,
      submissionAuthorized: false,
      deploymentAuthorized: false,
      broadcastAuthorized: false,
      chainWriteAuthorized: false,
    },
    builderCapabilities: {
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
    },
    requiredBeforeSeparateDeploymentAuthorization: [
      "Reconfirm all three owner addresses and the 2-of-3 threshold on an independent display.",
      "Establish genuinely independent signer custody before any production use.",
      "Freshly verify chain ID 4663 and the exact runtime code hashes at the singleton, factory, and fallback-handler addresses through independent RPC origins.",
      "Verify that the predicted Safe address has no code and no prior state on chain 4663.",
      "Simulate the exact zero-value factory call, then separately authorize any signing and broadcast.",
    ],
  };
}

function buildArtifact(explicitOwners, explicitThreshold, explicitSaltNonce) {
  const payload = buildPayload(explicitOwners, explicitThreshold, explicitSaltNonce);
  return {
    schema: GUARDIAN_SAFE_REVIEW_SCHEMA,
    hashAlgorithms: {
      canonicalJson: "RECURSIVE_LEXICOGRAPHIC_KEY_ORDER_UTF8_V1",
      keccak256: "KECCAK256_CANONICAL_JSON_V1",
      sha256: "SHA256_CANONICAL_JSON_V1",
    },
    payloadHashes: {
      keccak256: keccak256(new TextEncoder().encode(canonicalJson(payload))),
      sha256: sha256CanonicalJson(payload),
    },
    payload,
  };
}

export function validateGuardianSafeDeploymentReviewArtifact(
  artifact,
  { owners, threshold, saltNonce } = {},
) {
  exactKeys(artifact, ["schema", "hashAlgorithms", "payloadHashes", "payload"], "artifact");
  exactKeys(
    artifact.hashAlgorithms,
    ["canonicalJson", "keccak256", "sha256"],
    "artifact.hashAlgorithms",
  );
  exactKeys(artifact.payloadHashes, ["keccak256", "sha256"], "artifact.payloadHashes");
  const expected = buildArtifact(owners, threshold, saltNonce);
  if (canonicalJson(artifact) !== canonicalJson(expected)) {
    fail(
      "ARTIFACT_MISMATCH",
      "artifact differs from the exact deterministic schema, constants, calldata, or hashes",
    );
  }
  return true;
}

export function buildGuardianSafeDeploymentReview({ owners, threshold, saltNonce } = {}) {
  const inputs = { owners, threshold, saltNonce };
  const artifact = buildArtifact(owners, threshold, saltNonce);
  validateGuardianSafeDeploymentReviewArtifact(artifact, inputs);
  return artifact;
}
