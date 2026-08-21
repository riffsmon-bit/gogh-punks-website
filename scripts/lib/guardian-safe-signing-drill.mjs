import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import {
  concatHex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  keccak256,
  toFunctionSelector,
} from "viem";

export const GUARDIAN_SAFE_SIGNING_DRILL_ARTIFACT_SCHEMA =
  "GOGH_GUARDIAN_SAFE_SIGNING_DRILL_REVIEW_ARTIFACT_V1";
export const GUARDIAN_SAFE_SIGNING_DRILL_PAYLOAD_SCHEMA =
  "GOGH_GUARDIAN_SAFE_SIGNING_DRILL_REVIEW_V1";
export const GUARDIAN_SAFE_SIGNING_DRILL_CHAIN_ID = 4663;
export const GUARDIAN_SAFE_SIGNING_DRILL_SAFE_VERSION = "1.4.1";
export const GUARDIAN_SAFE_SIGNING_DRILL_THRESHOLD = 2;
export const GUARDIAN_SAFE_SIGNING_DRILL_NONCE = 0;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const SAFE_SENTINEL_OWNERS = "0x0000000000000000000000000000000000000001";

export const EIP712_DOMAIN_TYPE =
  "EIP712Domain(uint256 chainId,address verifyingContract)";
export const SAFE_TX_TYPE =
  "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)";
export const EIP712_DOMAIN_TYPEHASH =
  "0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218";
export const SAFE_TX_TYPEHASH =
  "0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8";
export const GET_THRESHOLD_SIGNATURE = "getThreshold()";
export const GET_THRESHOLD_SELECTOR = "0xe75235b8";
export const GET_TRANSACTION_HASH_SIGNATURE =
  "getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)";
export const EXEC_TRANSACTION_SIGNATURE =
  "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)";
export const EXEC_TRANSACTION_SELECTOR = "0x6a761202";

const DOMAIN_FIELDS = Object.freeze([
  Object.freeze({ name: "chainId", type: "uint256" }),
  Object.freeze({ name: "verifyingContract", type: "address" }),
]);

const SAFE_TX_FIELDS = Object.freeze([
  Object.freeze({ name: "to", type: "address" }),
  Object.freeze({ name: "value", type: "uint256" }),
  Object.freeze({ name: "data", type: "bytes" }),
  Object.freeze({ name: "operation", type: "uint8" }),
  Object.freeze({ name: "safeTxGas", type: "uint256" }),
  Object.freeze({ name: "baseGas", type: "uint256" }),
  Object.freeze({ name: "gasPrice", type: "uint256" }),
  Object.freeze({ name: "gasToken", type: "address" }),
  Object.freeze({ name: "refundReceiver", type: "address" }),
  Object.freeze({ name: "nonce", type: "uint256" }),
]);

const getTransactionHashAbi = [{
  type: "function",
  name: "getTransactionHash",
  stateMutability: "view",
  inputs: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "_nonce", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bytes32" }],
}];

const execTransactionAbiShape = {
  type: "function",
  name: "execTransaction",
  stateMutability: "payable",
  inputs: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "signatures", type: "bytes" },
  ],
  outputs: [{ name: "success", type: "bool" }],
};

export class GuardianSafeSigningDrillError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "GuardianSafeSigningDrillError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new GuardianSafeSigningDrillError(code, message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || utilTypes.isProxy(value) || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("INVALID_SCHEMA", `${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) {
    fail("INVALID_SCHEMA", `${label} must not contain symbol fields`);
  }
  const wanted = [...expected].sort();
  const sortedActual = [...actual].sort();
  if (sortedActual.length !== wanted.length
    || sortedActual.some((key, index) => key !== wanted[index])) {
    fail("INVALID_SCHEMA", `${label} keys must be exactly: ${wanted.join(", ")}`);
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      fail("INVALID_SCHEMA", `${label}.${key} must be an enumerable data field`);
    }
  }
}

function assertJsonData(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail("INVALID_JSON_DATA", `${label} contains a non-safe-integer number`);
    }
    return;
  }
  if (typeof value !== "object" || utilTypes.isProxy(value) || seen.has(value)) {
    fail("INVALID_JSON_DATA", `${label} is not finite JSON data`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail("INVALID_JSON_DATA", `${label} must use the ordinary array prototype`);
    }
    const actual = Reflect.ownKeys(value);
    const expected = new Set([
      "length",
      ...Array.from({ length: value.length }, (_, index) => String(index)),
    ]);
    if (actual.some((key) => typeof key !== "string" || !expected.has(key))
      || actual.length !== expected.size) {
      fail("INVALID_JSON_DATA", `${label} must not be sparse or have named properties`);
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
        fail("INVALID_JSON_DATA", `${label}[${index}] must be an enumerable data field`);
      }
      assertJsonData(descriptor.value, `${label}[${index}]`, seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("INVALID_JSON_DATA", `${label} contains a non-plain object`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        fail("INVALID_JSON_DATA", `${label} contains a symbol field`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
        fail("INVALID_JSON_DATA", `${label}.${key} must be an enumerable data field`);
      }
      assertJsonData(descriptor.value, `${label}.${key}`, seen);
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

function sha256CanonicalJson(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function strictJsonSnapshot(value, label, maximumBytes) {
  assertJsonData(value, label);
  let cloned;
  try {
    cloned = structuredClone(value);
  } catch {
    fail("INVALID_SCHEMA", `${label} must be cloneable plain JSON data`);
  }
  assertJsonData(cloned, `${label} snapshot`);
  const encoded = canonicalJson(cloned);
  if (Buffer.byteLength(encoded, "utf8") > maximumBytes) {
    fail("INVALID_SCHEMA", `${label} exceeds ${maximumBytes} canonical UTF-8 bytes`);
  }
  return JSON.parse(encoded);
}

function normalizeAddress(value, label) {
  if (typeof value !== "string") fail("INVALID_ADDRESS", `${label} must be a string`);
  try {
    return getAddress(value);
  } catch {
    fail("INVALID_ADDRESS", `${label} must be a valid Ethereum address`);
  }
}

function normalizeSafeAddress(value) {
  const safeAddress = normalizeAddress(value, "safeAddress");
  if (safeAddress === ZERO_ADDRESS || safeAddress === SAFE_SENTINEL_OWNERS) {
    fail("INVALID_SAFE_ADDRESS", "safeAddress must not be the zero or Safe sentinel address");
  }
  return safeAddress;
}

export function normalizeGuardianOwners(value, { safeAddress } = {}) {
  if (!Array.isArray(value)) {
    fail("INVALID_OWNERS", "exactly three owner addresses must be supplied explicitly");
  }
  const ownerInput = strictJsonSnapshot(value, "owners", 1_024);
  if (ownerInput.length !== 3) {
    fail("INVALID_OWNERS", "exactly three owner addresses must be supplied explicitly");
  }
  const owners = ownerInput.map((owner, index) => {
    let normalized;
    try {
      normalized = normalizeAddress(owner, `owners[${index}]`);
    } catch (error) {
      if (error instanceof GuardianSafeSigningDrillError) {
        fail("INVALID_OWNERS", error.message.slice(error.message.indexOf(":") + 2));
      }
      throw error;
    }
    if (normalized === ZERO_ADDRESS || normalized === SAFE_SENTINEL_OWNERS) {
      fail("INVALID_OWNERS", `owners[${index}] must not be the zero or Safe sentinel address`);
    }
    return normalized;
  });
  if (new Set(owners.map((owner) => owner.toLowerCase())).size !== owners.length) {
    fail("INVALID_OWNERS", "owner addresses must be distinct");
  }
  if (safeAddress !== undefined) {
    const normalizedSafe = normalizeSafeAddress(safeAddress);
    if (owners.some((owner) => owner === normalizedSafe)) {
      fail("INVALID_OWNERS", "an owner must not equal the Safe itself");
    }
  }
  return owners.sort((left, right) => {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  });
}

function normalizeInputs(options) {
  exactKeys(options, [
    "acceptSignatures",
    "chainId",
    "chainWriteAuthorized",
    "owners",
    "reviewOnly",
    "safeAddress",
    "safeNonce",
    "safeVersion",
    "threshold",
  ], "builder inputs");
  if (options.chainId !== GUARDIAN_SAFE_SIGNING_DRILL_CHAIN_ID) {
    fail("INVALID_CHAIN_ID", "chainId must be supplied explicitly as integer 4663");
  }
  if (options.safeVersion !== GUARDIAN_SAFE_SIGNING_DRILL_SAFE_VERSION) {
    fail("INVALID_SAFE_VERSION", "safeVersion must be supplied explicitly as 1.4.1");
  }
  if (options.threshold !== GUARDIAN_SAFE_SIGNING_DRILL_THRESHOLD) {
    fail("INVALID_THRESHOLD", "threshold must be supplied explicitly as integer 2");
  }
  if (options.safeNonce !== GUARDIAN_SAFE_SIGNING_DRILL_NONCE) {
    fail("INVALID_NONCE", "safeNonce must be supplied explicitly as integer 0");
  }
  if (options.reviewOnly !== true) {
    fail("AUTHORIZATION_REQUIRED_FALSE", "reviewOnly must be explicitly true");
  }
  if (options.acceptSignatures !== false) {
    fail("SIGNATURE_INPUT_FORBIDDEN", "acceptSignatures must be explicitly false");
  }
  if (options.chainWriteAuthorized !== false) {
    fail("CHAIN_WRITE_FORBIDDEN", "chainWriteAuthorized must be explicitly false");
  }
  const safeAddress = normalizeSafeAddress(options.safeAddress);
  const owners = normalizeGuardianOwners(options.owners, { safeAddress });
  return {
    acceptSignatures: false,
    chainId: GUARDIAN_SAFE_SIGNING_DRILL_CHAIN_ID,
    chainWriteAuthorized: false,
    owners,
    reviewOnly: true,
    safeAddress,
    safeNonce: GUARDIAN_SAFE_SIGNING_DRILL_NONCE,
    safeVersion: GUARDIAN_SAFE_SIGNING_DRILL_SAFE_VERSION,
    threshold: GUARDIAN_SAFE_SIGNING_DRILL_THRESHOLD,
  };
}

function cloneFields(fields) {
  return fields.map(({ name, type }) => ({ name, type }));
}

function cloneFunctionAbi(value) {
  return {
    type: value.type,
    name: value.name,
    stateMutability: value.stateMutability,
    inputs: cloneFields(value.inputs),
    outputs: cloneFields(value.outputs),
  };
}

function fixedTransaction(safeAddress) {
  return {
    to: safeAddress,
    valueWei: "0",
    data: GET_THRESHOLD_SELECTOR,
    operation: 0,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce: "0",
  };
}

function transactionValues(transaction) {
  return [
    transaction.to,
    BigInt(transaction.valueWei),
    transaction.data,
    transaction.operation,
    BigInt(transaction.safeTxGas),
    BigInt(transaction.baseGas),
    BigInt(transaction.gasPrice),
    transaction.gasToken,
    transaction.refundReceiver,
    BigInt(transaction.nonce),
  ];
}

export function decodeGetTransactionHashCalldata(calldata) {
  if (typeof calldata !== "string" || !/^0x[0-9a-fA-F]*$/.test(calldata)
    || calldata.length % 2 !== 0) {
    fail("INVALID_CALLDATA", "getTransactionHash calldata must be hexadecimal bytes");
  }
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: getTransactionHashAbi, data: calldata });
  } catch {
    fail("INVALID_CALLDATA", "calldata must be the Safe getTransactionHash call");
  }
  if (decoded.functionName !== "getTransactionHash" || !Array.isArray(decoded.args)
    || decoded.args.length !== 10) {
    fail("INVALID_CALLDATA", "calldata must contain ten getTransactionHash arguments");
  }
  const reencoded = encodeFunctionData({
    abi: getTransactionHashAbi,
    functionName: "getTransactionHash",
    args: decoded.args,
  });
  if (reencoded.toLowerCase() !== calldata.toLowerCase()) {
    fail("NONCANONICAL_CALLDATA", "getTransactionHash calldata has trailing bytes");
  }
  const [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken,
    refundReceiver, nonce] = decoded.args;
  return {
    to: normalizeAddress(to, "decoded.to"),
    valueWei: value.toString(),
    data: data.toLowerCase(),
    operation,
    safeTxGas: safeTxGas.toString(),
    baseGas: baseGas.toString(),
    gasPrice: gasPrice.toString(),
    gasToken: normalizeAddress(gasToken, "decoded.gasToken"),
    refundReceiver: normalizeAddress(refundReceiver, "decoded.refundReceiver"),
    nonce: nonce.toString(),
  };
}

function deriveTransactionHash(chainId, safeAddress, transaction) {
  const derivedDomainTypeHash = keccak256(new TextEncoder().encode(EIP712_DOMAIN_TYPE));
  const derivedSafeTxTypeHash = keccak256(new TextEncoder().encode(SAFE_TX_TYPE));
  if (derivedDomainTypeHash !== EIP712_DOMAIN_TYPEHASH
    || derivedSafeTxTypeHash !== SAFE_TX_TYPEHASH
    || toFunctionSelector(GET_THRESHOLD_SIGNATURE) !== GET_THRESHOLD_SELECTOR
    || toFunctionSelector(EXEC_TRANSACTION_SIGNATURE) !== EXEC_TRANSACTION_SELECTOR) {
    fail("PINNED_CONSTANT_MISMATCH", "Safe v1.4.1 type hash or selector changed");
  }

  const domainAbiEncoded = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [EIP712_DOMAIN_TYPEHASH, BigInt(chainId), safeAddress],
  );
  const domainSeparator = keccak256(domainAbiEncoded);
  const dataKeccak256 = keccak256(transaction.data);
  const safeTxAbiEncoded = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "address" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "uint8" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
    ],
    [
      SAFE_TX_TYPEHASH,
      transaction.to,
      BigInt(transaction.valueWei),
      dataKeccak256,
      transaction.operation,
      BigInt(transaction.safeTxGas),
      BigInt(transaction.baseGas),
      BigInt(transaction.gasPrice),
      transaction.gasToken,
      transaction.refundReceiver,
      BigInt(transaction.nonce),
    ],
  );
  const safeTxStructHash = keccak256(safeTxAbiEncoded);
  const encodedTransactionData = concatHex([
    "0x1901",
    domainSeparator,
    safeTxStructHash,
  ]);
  const safeTransactionHash = keccak256(encodedTransactionData);
  const typedDataHash = hashTypedData({
    domain: {
      chainId: BigInt(chainId),
      verifyingContract: safeAddress,
    },
    primaryType: "SafeTx",
    types: { SafeTx: cloneFields(SAFE_TX_FIELDS) },
    message: {
      to: transaction.to,
      value: BigInt(transaction.valueWei),
      data: transaction.data,
      operation: transaction.operation,
      safeTxGas: BigInt(transaction.safeTxGas),
      baseGas: BigInt(transaction.baseGas),
      gasPrice: BigInt(transaction.gasPrice),
      gasToken: transaction.gasToken,
      refundReceiver: transaction.refundReceiver,
      nonce: BigInt(transaction.nonce),
    },
  });
  if (typedDataHash !== safeTransactionHash) {
    fail("HASH_INVARIANT_FAILED", "manual Safe hash differs from typed-data hash");
  }
  return {
    domainAbiEncoded,
    domainSeparator,
    dataKeccak256,
    safeTxAbiEncoded,
    safeTxStructHash,
    encodedTransactionData,
    safeTransactionHash,
    typedDataHash,
  };
}

function buildPayload(normalized) {
  const transaction = fixedTransaction(normalized.safeAddress);
  const hashes = deriveTransactionHash(
    normalized.chainId,
    normalized.safeAddress,
    transaction,
  );
  const getTransactionHashCalldata = encodeFunctionData({
    abi: getTransactionHashAbi,
    functionName: "getTransactionHash",
    args: transactionValues(transaction),
  });
  const decodedHashCall = decodeGetTransactionHashCalldata(getTransactionHashCalldata);
  if (canonicalJson(decodedHashCall) !== canonicalJson(transaction)) {
    fail("ENCODING_INVARIANT_FAILED", "decoded hash-check call differs from fixed transaction");
  }

  const fixedArguments = cloneFields(execTransactionAbiShape.inputs.slice(0, 9))
    .map((field, index) => ({ ...field, value: [
      transaction.to,
      transaction.valueWei,
      transaction.data,
      transaction.operation,
      transaction.safeTxGas,
      transaction.baseGas,
      transaction.gasPrice,
      transaction.gasToken,
      transaction.refundReceiver,
    ][index] }));

  return {
    schema: GUARDIAN_SAFE_SIGNING_DRILL_PAYLOAD_SCHEMA,
    schemaVersion: 1,
    status: "REVIEW_ONLY_UNSIGNED_NOT_SIMULATED",
    requestScope: {
      reviewOnly: normalized.reviewOnly,
      acceptsSignatures: normalized.acceptSignatures,
      chainWriteAuthorized: normalized.chainWriteAuthorized,
    },
    chain: {
      name: "Robinhood Chain",
      chainId: normalized.chainId,
      nativeCurrency: "ETH",
    },
    expectedSafeState: {
      address: normalized.safeAddress,
      release: normalized.safeVersion,
      singletonVariant: "SafeL2",
      owners: normalized.owners,
      ownerOrdering: "NUMERIC_ASCENDING",
      ownerCount: normalized.owners.length,
      threshold: normalized.threshold,
      nonce: normalized.safeNonce.toString(),
      suppliedExplicitly: true,
      rpcVerifiedByBuilder: false,
      warning: "The offline builder does not verify code, implementation, owners, threshold, or nonce; recheck all expected state before any simulation.",
    },
    exactSafeTransaction: {
      ...transaction,
      operationName: "CALL",
      targetRelationship: "SAFE_CALLS_ITSELF",
      innerFunctionSignature: GET_THRESHOLD_SIGNATURE,
      innerFunctionSelector: GET_THRESHOLD_SELECTOR,
      innerStateMutability: "view",
      expectedInnerReturnType: "uint256",
      expectedInnerReturnValue: normalized.threshold.toString(),
      expectedInnerReturnData: encodeAbiParameters(
        [{ type: "uint256" }],
        [BigInt(normalized.threshold)],
      ),
    },
    eip712: {
      primaryType: "SafeTx",
      domainType: EIP712_DOMAIN_TYPE,
      domainTypeHash: EIP712_DOMAIN_TYPEHASH,
      domainFields: cloneFields(DOMAIN_FIELDS),
      domain: {
        chainId: normalized.chainId.toString(),
        verifyingContract: normalized.safeAddress,
      },
      safeTxType: SAFE_TX_TYPE,
      safeTxTypeHash: SAFE_TX_TYPEHASH,
      safeTxFields: cloneFields(SAFE_TX_FIELDS),
      message: {
        to: transaction.to,
        value: transaction.valueWei,
        data: transaction.data,
        operation: transaction.operation,
        safeTxGas: transaction.safeTxGas,
        baseGas: transaction.baseGas,
        gasPrice: transaction.gasPrice,
        gasToken: transaction.gasToken,
        refundReceiver: transaction.refundReceiver,
        nonce: transaction.nonce,
      },
      derivation: {
        domainAbiEncoding: "abi.encode(domainTypeHash, chainId, verifyingContract)",
        domainAbiEncoded: hashes.domainAbiEncoded,
        domainSeparator: hashes.domainSeparator,
        dataHashFormula: "keccak256(data)",
        dataKeccak256: hashes.dataKeccak256,
        safeTxAbiEncoding: "abi.encode(safeTxTypeHash, to, value, keccak256(data), operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce)",
        safeTxAbiEncoded: hashes.safeTxAbiEncoded,
        safeTxStructHash: hashes.safeTxStructHash,
        eip712Prefix: "0x1901",
        encodedTransactionData: hashes.encodedTransactionData,
        encodedTransactionDataLengthBytes: 66,
        safeTransactionHash: hashes.safeTransactionHash,
        typedDataLibraryHash: hashes.typedDataHash,
        hashDerivationsAgree: true,
      },
    },
    getTransactionHashReadCheck: {
      to: normalized.safeAddress,
      valueWei: "0",
      functionSignature: GET_TRANSACTION_HASH_SIGNATURE,
      selector: toFunctionSelector(GET_TRANSACTION_HASH_SIGNATURE),
      stateMutability: "view",
      orderedArguments: decodedHashCall,
      calldata: getTransactionHashCalldata,
      expectedReturnType: "bytes32",
      expectedReturnValue: hashes.safeTransactionHash,
      rpcPerformed: false,
      chainReadAuthorized: false,
    },
    execTransactionAbiShape: {
      to: normalized.safeAddress,
      outerValueWei: "0",
      functionSignature: EXEC_TRANSACTION_SIGNATURE,
      selector: EXEC_TRANSACTION_SELECTOR,
      abi: cloneFunctionAbi(execTransactionAbiShape),
      fixedArgumentsExcludingSignatures: fixedArguments,
      signatureArgument: {
        position: 9,
        name: "signatures",
        type: "bytes",
        value: null,
        provided: false,
        acceptedByBuilder: false,
      },
      calldata: null,
      calldataConstructed: false,
      executable: false,
      warning: "This is an ABI shape only. The builder neither accepts signatures nor constructs executable execTransaction calldata.",
    },
    thresholdDrillExpectations: {
      threshold: normalized.threshold,
      signaturesInArtifact: 0,
      thresholdSatisfiedByArtifact: false,
      oneValidEoaSignatureSimulation: "EXPECTED_REVERT_GS020",
      twoValidDistinctSortedEoaSignaturesSimulation: "EXPECTED_SUCCESS",
      simulationsPerformed: false,
      simulationResultsAttested: false,
      ethCallOnly: true,
      warning: "A successful eth_call is ephemeral. Broadcasting execTransaction would consume Safe nonce 0 even though the inner getThreshold call is read-only.",
    },
    authorization: {
      transactionAuthorized: false,
      digestSigningAuthorized: false,
      signatureRequestAuthorized: false,
      signatureCollectionAuthorized: false,
      simulationAuthorized: false,
      rpcCallAuthorized: false,
      submissionAuthorized: false,
      broadcastAuthorized: false,
      deploymentAuthorized: false,
      chainWriteAuthorized: false,
      siteTestingAuthorized: false,
    },
    builderActivity: {
      rpcPerformed: false,
      networkRequestPerformed: false,
      signingPerformed: false,
      signatureCollectionPerformed: false,
      simulationPerformed: false,
      submissionPerformed: false,
      broadcastPerformed: false,
      deploymentPerformed: false,
      chainWritePerformed: false,
      fileWritePerformed: false,
    },
    builderCapabilities: {
      deterministic: true,
      offline: true,
      readOnly: true,
      hashing: true,
      abiDescription: true,
      rpcAccess: false,
      networkAccess: false,
      walletAccess: false,
      privateKeyAccess: false,
      secretGeneration: false,
      signatureInput: false,
      signatureProduction: false,
      signatureCollection: false,
      execTransactionCalldataConstruction: false,
      simulation: false,
      submission: false,
      broadcast: false,
      deployment: false,
      chainWrites: false,
      fileWrites: false,
      cliOutput: "STDOUT_ONLY",
    },
    requiredBeforeAnySeparateSimulationAuthorization: [
      "Independently verify chain ID 4663 and the Safe proxy runtime code and v1.4.1 implementation.",
      "Independently read and match the exact three owners, threshold 2, and current Safe nonce 0.",
      "Compare Safe.getTransactionHash for the exact fixed fields with this artifact's Safe transaction hash.",
      "Keep any one-signature and two-signature checks to eth_call simulation only and separately authorize RPC use.",
      "Obtain separate explicit authorization before collecting signatures or broadcasting any transaction.",
    ],
  };
}

function buildArtifact(options) {
  plainObject(options, "builder inputs");
  const normalized = normalizeInputs(strictJsonSnapshot(options, "builder inputs", 4_096));
  const payload = buildPayload(normalized);
  return {
    schema: GUARDIAN_SAFE_SIGNING_DRILL_ARTIFACT_SCHEMA,
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

export function validateGuardianSafeSigningDrillArtifact(artifact, expectedInputs) {
  const snapshot = strictJsonSnapshot(artifact, "artifact", 65_536);
  exactKeys(snapshot, ["schema", "hashAlgorithms", "payloadHashes", "payload"], "artifact");
  exactKeys(
    snapshot.hashAlgorithms,
    ["canonicalJson", "keccak256", "sha256"],
    "artifact.hashAlgorithms",
  );
  exactKeys(snapshot.payloadHashes, ["keccak256", "sha256"], "artifact.payloadHashes");
  const expected = buildArtifact(expectedInputs);
  if (canonicalJson(snapshot) !== canonicalJson(expected)) {
    fail(
      "ARTIFACT_MISMATCH",
      "artifact differs from the exact deterministic schema, fixed transaction, ABI shape, or hashes",
    );
  }
  return true;
}

export function buildGuardianSafeSigningDrill(options) {
  const artifact = buildArtifact(options);
  validateGuardianSafeSigningDrillArtifact(artifact, options);
  return artifact;
}
