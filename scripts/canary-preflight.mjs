import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, keccak256 } from "viem";
import { FEATURE_DEFAULTS, ROBINHOOD } from "../broker/src/config.mjs";
import {
  requireVerifiedManifestAdoption,
  sourceVerificationCanonicalSha256,
} from "../broker/src/recommendation/source-verification-adoption.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentPath = resolve(projectRoot, "deployments/robinhood.json");
const zeroAddress = "0x0000000000000000000000000000000000000000";
const failures = [];
let readinessDetail = "";

const contractSpecifications = Object.freeze([
  ["ArtAdapterRegistry", "ART_ADAPTER_REGISTRY"],
  ["ArtAgentRegistry", "ART_AGENT_REGISTRY"],
  ["BrokerPolicyModule", "BROKER_POLICY_MODULE"],
  ["GoghPunkAccountV1", "GOGH_ACCOUNT_IMPLEMENTATION"],
  ["GoghPunkAccountRegistry", "GOGH_ACCOUNT_REGISTRY"],
]);
const sourceVerifiedContractNames = Object.freeze(
  contractSpecifications.map(([contractName]) => contractName),
);

const addressOutput = [{ name: "", type: "address" }];
const boolOutput = [{ name: "", type: "bool" }];
const uintOutput = [{ name: "", type: "uint256" }];
const bytes32Output = [{ name: "", type: "bytes32" }];
const viewFunction = (name, outputs, inputs = []) => ({
  type: "function",
  name,
  stateMutability: "view",
  inputs,
  outputs,
});
const ownableAbi = [
  viewFunction("owner", addressOutput),
  viewFunction("pendingOwner", addressOutput),
];
const policyAbi = [
  ...ownableAbi,
  viewFunction("GOGH_PUNKS", addressOutput),
  viewFunction("ROBINHOOD_CHAIN_ID", uintOutput),
  viewFunction("adapterRegistry", addressOutput),
  viewFunction("globallyPaused", boolOutput),
  viewFunction("featureFlags", [
    {
      name: "",
      type: "tuple",
      components: [
        { name: "scoutMode", type: "bool" },
        { name: "approvalPurchases", type: "bool" },
        { name: "autonomousPurchases", type: "bool" },
        { name: "autonomousMints", type: "bool" },
        { name: "unknownCollectionExecution", type: "bool" },
        { name: "selling", type: "bool" },
        { name: "autonomousSelling", type: "bool" },
      ],
    },
  ]),
];
const registryAbi = [
  viewFunction("GOGH_PUNKS", addressOutput),
  viewFunction("ROBINHOOD_CHAIN_ID", uintOutput),
  viewFunction("canonicalRegistry", addressOutput),
  viewFunction("implementation", addressOutput),
  viewFunction("accountSalt", bytes32Output),
  viewFunction("account", [{ name: "accountAddress", type: "address" }], [
    { name: "tokenId", type: "uint256" },
  ]),
  viewFunction("isAccountCreated", boolOutput, [{ name: "tokenId", type: "uint256" }]),
];
const implementationAbi = [
  viewFunction("GOGH_PUNKS", addressOutput),
  viewFunction("ROBINHOOD_CHAIN_ID", uintOutput),
  viewFunction("policyModule", addressOutput),
  viewFunction("agentRegistry", addressOutput),
  viewFunction("adapterRegistry", addressOutput),
];
const pauseRegistryAbi = [...ownableAbi, viewFunction("globallyPaused", boolOutput)];
const erc721Abi = [
  viewFunction("ownerOf", addressOutput, [{ name: "tokenId", type: "uint256" }]),
];
const erc6551RegistryAbi = [
  viewFunction("account", addressOutput, [
    { name: "implementation", type: "address" },
    { name: "salt", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "tokenContract", type: "address" },
    { name: "tokenId", type: "uint256" },
  ]),
];
const accountAbi = [
  viewFunction("owner", addressOutput),
  viewFunction("isCanonicalGoghPunkAccount", boolOutput),
  viewFunction("token", [
    { name: "chainId", type: "uint256" },
    { name: "tokenContract", type: "address" },
    { name: "tokenId", type: "uint256" },
  ]),
  ...implementationAbi,
];

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures.push(message);
}

function assert(condition, okMessage, failMessage) {
  if (condition) {
    pass(okMessage);
    return true;
  }
  fail(failMessage);
  return false;
}

function environmentValue(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim();
}

function normalizeAddress(address, name = "address") {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`${name} is not a valid address`);
  }
  const normalized = address.toLowerCase();
  if (normalized === zeroAddress) throw new Error(`${name} must not be the zero address`);
  return normalized;
}

function readAddress(address, name) {
  try {
    return normalizeAddress(address, name);
  } catch (error) {
    fail(error.message);
    return undefined;
  }
}

function validHash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function evaluateCanonicalRegistryRuntimeEvidence({
  manifestRuntimeCodeHash,
  primaryBytecode,
  secondaryBytecode,
}, hashBytecode = keccak256) {
  const expected = ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash;
  const manifestHash = validHash(manifestRuntimeCodeHash)
    ? manifestRuntimeCodeHash.toLowerCase()
    : null;
  const validBytecode = (value) => (
    typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value)
  );
  const runtimeHash = (bytecode) => {
    if (!validBytecode(bytecode)) return null;
    try {
      const value = hashBytecode(bytecode);
      return validHash(value) ? value.toLowerCase() : null;
    } catch {
      return null;
    }
  };
  const primaryHash = runtimeHash(primaryBytecode);
  const secondaryHash = runtimeHash(secondaryBytecode);
  return Object.freeze({
    expected,
    manifestHash,
    primaryHash,
    secondaryHash,
    manifestMatches: manifestHash === expected,
    primaryMatches: primaryHash === expected,
    secondaryMatches: secondaryHash === expected,
    providersAgree: primaryHash !== null && primaryHash === secondaryHash,
    valid: manifestHash === expected
      && primaryHash === expected
      && secondaryHash === expected,
  });
}

export function evaluateDeploymentSourceVerificationAdoption(deployment) {
  const adoption = requireVerifiedManifestAdoption(
    deployment,
    sourceVerifiedContractNames,
  );
  return Object.freeze({
    adoption,
    sha256: sourceVerificationCanonicalSha256(adoption),
  });
}

function validGitCommit(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{40}$/.test(value);
}

function summarize() {
  if (failures.length === 0) {
    console.log("\nFOUNDATION CANARY PREFLIGHT: READY");
    if (readinessDetail) console.log(readinessDetail);
    console.log(
      "Approval purchases, autonomous purchases, autonomous mints, unknown execution, and selling remain disabled.",
    );
    return;
  }

  console.error("\nFOUNDATION CANARY PREFLIGHT: BLOCKED");
  for (const item of failures) console.error(`- ${item}`);
  console.error(
    "No live canary action is authorized. Correct every failure and rerun preflight without a skip flag.",
  );
  process.exitCode = 1;
}

function validateManifest(deployment) {
  const startFailureCount = failures.length;
  const addresses = {};
  let sourceVerification;

  assert(
    deployment?.chain?.chainId === ROBINHOOD.chainId,
    `manifest chain ID is ${ROBINHOOD.chainId}`,
    `manifest chain ID must be ${ROBINHOOD.chainId}`,
  );
  const canonicalCollection = readAddress(
    deployment?.canonicalCollection,
    "manifest canonicalCollection",
  );
  if (canonicalCollection) {
    assert(
      canonicalCollection === ROBINHOOD.canonicalCollection,
      "manifest canonical collection is correct",
      `manifest canonical collection must be ${ROBINHOOD.canonicalCollection}`,
    );
  }
  const canonicalRegistry = readAddress(
    deployment?.canonicalERC6551Registry,
    "manifest canonicalERC6551Registry",
  );
  if (canonicalRegistry) {
    assert(
      canonicalRegistry === ROBINHOOD.canonicalERC6551Registry,
      "manifest canonical ERC-6551 registry is correct",
      `manifest canonical ERC-6551 registry must be ${ROBINHOOD.canonicalERC6551Registry}`,
    );
  }
  const canonicalRegistryRuntimeHash = deployment?.canonicalERC6551RegistryRuntimeCodeHash;
  if (!validHash(canonicalRegistryRuntimeHash)) {
    fail("manifest canonicalERC6551RegistryRuntimeCodeHash must be a 32-byte hash");
  } else {
    assert(
      canonicalRegistryRuntimeHash.toLowerCase()
        === ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash,
      "manifest canonical ERC-6551 registry runtime hash is correct",
      `manifest canonical ERC-6551 registry runtime hash must be ${ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash}`,
    );
  }
  if (!validHash(deployment?.accountSalt)) {
    fail("manifest accountSalt must be a 32-byte hex value");
  }
  if (!validGitCommit(deployment?.gitCommit)) {
    fail("manifest gitCommit must be the deployed 40-character commit");
  }

  const guardian = readAddress(deployment?.protocolGuardian, "manifest protocolGuardian");
  const guardianMirror = environmentValue("PROTOCOL_GUARDIAN");
  if (guardianMirror && guardian) {
    const normalizedMirror = readAddress(guardianMirror, "PROTOCOL_GUARDIAN");
    if (normalizedMirror) {
      assert(
        normalizedMirror === guardian,
        "PROTOCOL_GUARDIAN matches the manifest",
        "PROTOCOL_GUARDIAN does not match the authoritative manifest",
      );
    }
  }

  const saltMirror = environmentValue("GOGH_ACCOUNT_SALT");
  if (saltMirror) {
    assert(
      validHash(saltMirror) && saltMirror.toLowerCase() === deployment.accountSalt?.toLowerCase(),
      "GOGH_ACCOUNT_SALT matches the manifest",
      "GOGH_ACCOUNT_SALT does not match the authoritative manifest",
    );
  }

  for (const [contractName, environmentName] of contractSpecifications) {
    const record = deployment?.contracts?.[contractName];
    if (!record || typeof record !== "object") {
      fail(`manifest is missing ${contractName}`);
      continue;
    }
    const address = readAddress(record.address, `manifest ${contractName}.address`);
    if (address) addresses[contractName] = address;
    const addressMirror = environmentValue(environmentName);
    if (addressMirror && address) {
      const normalizedMirror = readAddress(addressMirror, environmentName);
      if (normalizedMirror) {
        assert(
          normalizedMirror === address,
          `${environmentName} matches the manifest`,
          `${environmentName} does not match the authoritative manifest`,
        );
      }
    }
    if (!validHash(record.deploymentTransaction)) {
      fail(`manifest ${contractName}.deploymentTransaction must be a transaction hash`);
    }
    if (!Number.isSafeInteger(record.deploymentBlock) || record.deploymentBlock <= 0) {
      fail(`manifest ${contractName}.deploymentBlock must be a positive integer`);
    }
    const deployer = readAddress(record.deployer, `manifest ${contractName}.deployer`);
    if (deployer && guardian && deployer === guardian) {
      fail(`${contractName} deployer must not retain protocol guardian authority`);
    }
    if (record.constructorArguments === null || record.constructorArguments === undefined) {
      fail(`manifest ${contractName}.constructorArguments is incomplete`);
    }
    if (!validHash(record.creationBytecodeHash)) {
      fail(`manifest ${contractName}.creationBytecodeHash must be a 32-byte hash`);
    }
    if (!validHash(record.runtimeBytecodeHash)) {
      fail(`manifest ${contractName}.runtimeBytecodeHash must be a 32-byte hash`);
    }
    if (!validGitCommit(record.gitCommit) || record.gitCommit !== deployment.gitCommit) {
      fail(`manifest ${contractName}.gitCommit must match the deployment commit`);
    }
    if (record.verificationStatus !== "VERIFIED") {
      fail(`manifest ${contractName}.verificationStatus must be VERIFIED`);
    }
  }

  try {
    sourceVerification = evaluateDeploymentSourceVerificationAdoption(deployment);
    pass(
      `manifest source-verification adoption is bound (${sourceVerification.sha256})`,
    );
  } catch (error) {
    fail(
      `manifest source-verification adoption is invalid (${error?.code
        ?? "INVALID_SOURCE_VERIFICATION_ADOPTION"})`,
    );
  }

  const uniqueAddresses = new Set(Object.values(addresses));
  if (uniqueAddresses.size !== contractSpecifications.length) {
    fail("all five protocol contracts must have distinct manifest addresses");
  }

  const expectedFlags = {
    ENABLE_SCOUT_MODE: true,
    ENABLE_APPROVAL_PURCHASES: false,
    ENABLE_AUTONOMOUS_PURCHASES: false,
    ENABLE_AUTONOMOUS_MINTS: false,
    ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
    ENABLE_SELLING: false,
    ENABLE_AUTONOMOUS_SELLING: false,
  };
  for (const [name, expected] of Object.entries(expectedFlags)) {
    if (deployment?.featureFlags?.[name] !== expected) {
      fail(`manifest ${name} must be ${expected}`);
    }
  }

  if (failures.length === startFailureCount) pass("authoritative deployment manifest is complete");
  return { addresses, guardian, sourceVerification };
}

function requireCanaryTarget() {
  const tokenValue = environmentValue("BROKER_CANARY_TOKEN_ID");
  const ownerValue = environmentValue("BROKER_CANARY_EXPECTED_OWNER");
  const accountValue = environmentValue("BROKER_CANARY_EXPECTED_ACCOUNT");
  if (!tokenValue || !ownerValue || !accountValue) {
    fail(
      "BROKER_CANARY_TOKEN_ID, BROKER_CANARY_EXPECTED_OWNER, and BROKER_CANARY_EXPECTED_ACCOUNT are all required",
    );
    return undefined;
  }
  if (!/^\d+$/.test(tokenValue)) {
    fail("BROKER_CANARY_TOKEN_ID must be an unsigned decimal integer");
    return undefined;
  }
  const expectedOwner = readAddress(ownerValue, "BROKER_CANARY_EXPECTED_OWNER");
  const expectedAccount = readAddress(accountValue, "BROKER_CANARY_EXPECTED_ACCOUNT");
  if (!expectedOwner || !expectedAccount) return undefined;
  return { tokenId: BigInt(tokenValue), tokenValue, expectedOwner, expectedAccount };
}

function requireRpcUrl(name) {
  const value = environmentValue(name);
  if (!value) {
    fail(`${name} is required for a live canary`);
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("must use HTTPS");
    return value;
  } catch (error) {
    fail(`${name} ${error.message}`);
    return undefined;
  }
}

async function main() {
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
  const environmentStatus = environmentValue("BROKER_DEPLOYMENT_STATUS");

  if (deployment.status !== "DEPLOYED") {
    fail(
      `authoritative manifest status must be DEPLOYED (current ${deployment.status ?? "missing"})`,
    );
    if (environmentStatus === "DEPLOYED") {
      fail("BROKER_DEPLOYMENT_STATUS cannot override a NOT_DEPLOYED manifest");
    }
    summarize();
    return;
  }
  pass("authoritative manifest status is DEPLOYED");
  if (environmentStatus && environmentStatus !== deployment.status) {
    fail("BROKER_DEPLOYMENT_STATUS does not match the authoritative manifest");
  }

  const stage = environmentValue("BROKER_CANARY_STAGE") ?? "FOUNDATION";
  if (stage !== "FOUNDATION") {
    fail(
      `BROKER_CANARY_STAGE ${stage} is not supported; approval and autonomous live stages remain blocked`,
    );
  } else {
    pass("canary stage is FOUNDATION");
  }

  const { addresses, guardian } = validateManifest(deployment);
  const canary = requireCanaryTarget();
  const primaryRpcUrl = requireRpcUrl("ROBINHOOD_RPC_URL");
  const secondaryRpcUrl = requireRpcUrl("ROBINHOOD_SECONDARY_RPC_URL");
  if (primaryRpcUrl && secondaryRpcUrl && primaryRpcUrl === secondaryRpcUrl) {
    fail("primary and secondary RPC URLs must use independent provider endpoints");
  }

  const confirmations = Number(environmentValue("BROKER_CONFIRMATIONS") ?? "20");
  if (!Number.isSafeInteger(confirmations) || confirmations < 20 || confirmations > 256) {
    fail("BROKER_CONFIRMATIONS must be an integer between 20 and 256");
  }

  if (
    failures.length > 0 || !canary || !primaryRpcUrl || !secondaryRpcUrl
    || Object.keys(addresses).length !== contractSpecifications.length || !guardian
  ) {
    summarize();
    return;
  }

  if (canary.expectedOwner === guardian) {
    fail("canary owner must be separate from the protocol guardian");
  }
  const configuredAgent = environmentValue("ART_AGENT_SIGNER_ADDRESS");
  if (configuredAgent) {
    const agent = readAddress(configuredAgent, "ART_AGENT_SIGNER_ADDRESS");
    if (agent && (agent === guardian || agent === canary.expectedOwner)) {
      fail("Art Agent signer must be separate from guardian and canary owner");
    }
  }
  if (failures.length > 0) {
    summarize();
    return;
  }

  const primary = createPublicClient({ transport: http(primaryRpcUrl) });
  const secondary = createPublicClient({ transport: http(secondaryRpcUrl) });
  const [primaryChainId, secondaryChainId] = await Promise.all([
    primary.getChainId(),
    secondary.getChainId(),
  ]);
  if (
    !assert(
      primaryChainId === ROBINHOOD.chainId && secondaryChainId === ROBINHOOD.chainId,
      `both RPC providers report chain ${ROBINHOOD.chainId}`,
      `RPC chain mismatch: expected ${ROBINHOOD.chainId}, got ${primaryChainId} and ${secondaryChainId}`,
    )
  ) {
    summarize();
    return;
  }

  const [primaryHead, secondaryHead] = await Promise.all([
    primary.getBlockNumber(),
    secondary.getBlockNumber(),
  ]);
  const sharedHead = primaryHead < secondaryHead ? primaryHead : secondaryHead;
  const confirmationCount = BigInt(confirmations);
  if (sharedHead < confirmationCount) {
    fail("RPC providers do not have enough blocks for the configured confirmation depth");
    summarize();
    return;
  }
  const blockNumber = sharedHead - confirmationCount;
  const [primaryBlock, secondaryBlock] = await Promise.all([
    primary.getBlock({ blockNumber }),
    secondary.getBlock({ blockNumber }),
  ]);
  if (
    !assert(
      primaryBlock.hash === secondaryBlock.hash,
      `RPC providers agree on confirmed block ${blockNumber} (${primaryBlock.hash})`,
      `RPC providers disagree on block ${blockNumber}: ${primaryBlock.hash} vs ${secondaryBlock.hash}`,
    )
  ) {
    summarize();
    return;
  }

  for (const [contractName] of contractSpecifications) {
    const deploymentBlock = BigInt(deployment.contracts[contractName].deploymentBlock);
    if (deploymentBlock > blockNumber) {
      fail(`${contractName} deployment has fewer than ${confirmations} confirmations`);
    }
  }
  if (failures.length > 0) {
    summarize();
    return;
  }

  const codeEntries = await Promise.all([
    ...contractSpecifications.map(async ([contractName]) => [
      contractName,
      await primary.getCode({ address: addresses[contractName], blockNumber }),
    ]),
    [
      "CanonicalGoghPunks",
      await primary.getCode({ address: ROBINHOOD.canonicalCollection, blockNumber }),
    ],
    [
      "CanonicalERC6551Registry",
      await primary.getCode({ address: ROBINHOOD.canonicalERC6551Registry, blockNumber }),
    ],
    [
      "CanonicalERC6551RegistrySecondary",
      await secondary.getCode({ address: ROBINHOOD.canonicalERC6551Registry, blockNumber }),
    ],
  ]);
  const codeByName = Object.fromEntries(codeEntries);
  for (const [contractName] of contractSpecifications) {
    const bytecode = codeByName[contractName];
    if (!bytecode || bytecode === "0x") {
      fail(`${contractName} has no code at its manifest address`);
      continue;
    }
    assert(
      keccak256(bytecode).toLowerCase()
        === deployment.contracts[contractName].runtimeBytecodeHash.toLowerCase(),
      `${contractName} runtime code hash matches the manifest`,
      `${contractName} runtime code hash does not match the manifest`,
    );
  }
  assert(
    codeByName.CanonicalGoghPunks && codeByName.CanonicalGoghPunks !== "0x",
    "canonical Gogh Punks bytecode is present",
    "canonical Gogh Punks has no bytecode at the confirmed block",
  );
  const canonicalRegistryRuntimeEvidence = evaluateCanonicalRegistryRuntimeEvidence({
    manifestRuntimeCodeHash: deployment.canonicalERC6551RegistryRuntimeCodeHash,
    primaryBytecode: codeByName.CanonicalERC6551Registry,
    secondaryBytecode: codeByName.CanonicalERC6551RegistrySecondary,
  });
  assert(
    canonicalRegistryRuntimeEvidence.valid,
    "canonical ERC-6551 registry runtime hash matches the manifest on both RPC providers",
    "canonical ERC-6551 registry runtime hash does not match the pinned manifest hash on both RPC providers",
  );

  const receipts = await Promise.all(
    contractSpecifications.map(async ([contractName]) => [
      contractName,
      await primary.getTransactionReceipt({
        hash: deployment.contracts[contractName].deploymentTransaction,
      }),
    ]),
  );
  for (const [contractName, receipt] of receipts) {
    const record = deployment.contracts[contractName];
    assert(
      receipt.status === "success"
        && receipt.blockNumber === BigInt(record.deploymentBlock)
        && receipt.contractAddress?.toLowerCase() === addresses[contractName]
        && receipt.blockNumber <= blockNumber,
      `${contractName} deployment receipt matches the manifest`,
      `${contractName} deployment receipt does not match its address, block, or success status`,
    );
  }

  const read = (address, abi, functionName, args = []) => primary.readContract({
    address,
    abi,
    functionName,
    args,
    blockNumber,
  });
  const [
    registryCollection,
    registryChainId,
    registryCanonical,
    registryImplementation,
    registrySalt,
    policyCollection,
    policyChainId,
    policyAdapterRegistry,
    policyOwner,
    policyPendingOwner,
    policyPaused,
    featureFlags,
    agentOwner,
    agentPendingOwner,
    agentPaused,
    adapterOwner,
    adapterPendingOwner,
    adapterPaused,
    implementationCollection,
    implementationChainId,
    implementationPolicy,
    implementationAgents,
    implementationAdapters,
  ] = await Promise.all([
    read(addresses.GoghPunkAccountRegistry, registryAbi, "GOGH_PUNKS"),
    read(addresses.GoghPunkAccountRegistry, registryAbi, "ROBINHOOD_CHAIN_ID"),
    read(addresses.GoghPunkAccountRegistry, registryAbi, "canonicalRegistry"),
    read(addresses.GoghPunkAccountRegistry, registryAbi, "implementation"),
    read(addresses.GoghPunkAccountRegistry, registryAbi, "accountSalt"),
    read(addresses.BrokerPolicyModule, policyAbi, "GOGH_PUNKS"),
    read(addresses.BrokerPolicyModule, policyAbi, "ROBINHOOD_CHAIN_ID"),
    read(addresses.BrokerPolicyModule, policyAbi, "adapterRegistry"),
    read(addresses.BrokerPolicyModule, policyAbi, "owner"),
    read(addresses.BrokerPolicyModule, policyAbi, "pendingOwner"),
    read(addresses.BrokerPolicyModule, policyAbi, "globallyPaused"),
    read(addresses.BrokerPolicyModule, policyAbi, "featureFlags"),
    read(addresses.ArtAgentRegistry, pauseRegistryAbi, "owner"),
    read(addresses.ArtAgentRegistry, pauseRegistryAbi, "pendingOwner"),
    read(addresses.ArtAgentRegistry, pauseRegistryAbi, "globallyPaused"),
    read(addresses.ArtAdapterRegistry, pauseRegistryAbi, "owner"),
    read(addresses.ArtAdapterRegistry, pauseRegistryAbi, "pendingOwner"),
    read(addresses.ArtAdapterRegistry, pauseRegistryAbi, "globallyPaused"),
    read(addresses.GoghPunkAccountV1, implementationAbi, "GOGH_PUNKS"),
    read(addresses.GoghPunkAccountV1, implementationAbi, "ROBINHOOD_CHAIN_ID"),
    read(addresses.GoghPunkAccountV1, implementationAbi, "policyModule"),
    read(addresses.GoghPunkAccountV1, implementationAbi, "agentRegistry"),
    read(addresses.GoghPunkAccountV1, implementationAbi, "adapterRegistry"),
  ]);

  const addressMatches = (actual, expected) => actual.toLowerCase() === expected;
  assert(
    addressMatches(registryCollection, ROBINHOOD.canonicalCollection)
      && Number(registryChainId) === ROBINHOOD.chainId
      && addressMatches(registryCanonical, ROBINHOOD.canonicalERC6551Registry)
      && addressMatches(registryImplementation, addresses.GoghPunkAccountV1)
      && registrySalt.toLowerCase() === deployment.accountSalt.toLowerCase(),
    "account registry immutable bindings are correct",
    "account registry immutable binding mismatch",
  );
  assert(
    addressMatches(policyCollection, ROBINHOOD.canonicalCollection)
      && Number(policyChainId) === ROBINHOOD.chainId
      && addressMatches(policyAdapterRegistry, addresses.ArtAdapterRegistry),
    "policy immutable bindings are correct",
    "policy immutable binding mismatch",
  );
  assert(
    addressMatches(implementationCollection, ROBINHOOD.canonicalCollection)
      && Number(implementationChainId) === ROBINHOOD.chainId
      && addressMatches(implementationPolicy, addresses.BrokerPolicyModule)
      && addressMatches(implementationAgents, addresses.ArtAgentRegistry)
      && addressMatches(implementationAdapters, addresses.ArtAdapterRegistry),
    "account implementation immutable bindings are correct",
    "account implementation immutable binding mismatch",
  );
  assert(
    [policyOwner, agentOwner, adapterOwner].every((owner) => owner.toLowerCase() === guardian),
    "guardian owns every governed protocol contract",
    "one or more governed contracts has the wrong owner",
  );
  assert(
    [policyPendingOwner, agentPendingOwner, adapterPendingOwner]
      .every((owner) => owner.toLowerCase() === zeroAddress),
    "no protocol ownership transfer is pending",
    "a protocol ownership transfer is pending",
  );
  assert(
    policyPaused === false && agentPaused === false && adapterPaused === false,
    "policy, agent, and adapter registries are not globally paused",
    "a protocol registry is globally paused",
  );
  assert(
    featureFlags.scoutMode === FEATURE_DEFAULTS.ENABLE_SCOUT_MODE
      && featureFlags.approvalPurchases === FEATURE_DEFAULTS.ENABLE_APPROVAL_PURCHASES
      && featureFlags.autonomousPurchases === FEATURE_DEFAULTS.ENABLE_AUTONOMOUS_PURCHASES
      && featureFlags.autonomousMints === FEATURE_DEFAULTS.ENABLE_AUTONOMOUS_MINTS
      && featureFlags.unknownCollectionExecution
        === FEATURE_DEFAULTS.ENABLE_UNKNOWN_COLLECTION_EXECUTION
      && featureFlags.selling === FEATURE_DEFAULTS.ENABLE_SELLING
      && featureFlags.autonomousSelling === FEATURE_DEFAULTS.ENABLE_AUTONOMOUS_SELLING,
    "on-chain features match fail-closed foundation defaults",
    "on-chain feature flags do not match foundation defaults",
  );

  const [tokenOwner, secondaryTokenOwner, facadeAccount, canonicalAccount, isCreated] =
    await Promise.all([
      read(ROBINHOOD.canonicalCollection, erc721Abi, "ownerOf", [canary.tokenId]),
      secondary.readContract({
        address: ROBINHOOD.canonicalCollection,
        abi: erc721Abi,
        functionName: "ownerOf",
        args: [canary.tokenId],
        blockNumber,
      }),
      read(addresses.GoghPunkAccountRegistry, registryAbi, "account", [canary.tokenId]),
      read(ROBINHOOD.canonicalERC6551Registry, erc6551RegistryAbi, "account", [
        addresses.GoghPunkAccountV1,
        deployment.accountSalt,
        BigInt(ROBINHOOD.chainId),
        ROBINHOOD.canonicalCollection,
        canary.tokenId,
      ]),
      read(addresses.GoghPunkAccountRegistry, registryAbi, "isAccountCreated", [canary.tokenId]),
    ]);
  assert(
    tokenOwner.toLowerCase() === canary.expectedOwner
      && secondaryTokenOwner.toLowerCase() === canary.expectedOwner,
    `both RPC providers resolve Punk #${canary.tokenValue} to the expected owner`,
    `Punk #${canary.tokenValue} owner does not match BROKER_CANARY_EXPECTED_OWNER`,
  );
  assert(
    facadeAccount.toLowerCase() === canonicalAccount.toLowerCase()
      && facadeAccount.toLowerCase() === canary.expectedAccount,
    `counterfactual account matches facade, canonical registry, and expected address`,
    "counterfactual Punk Account address mismatch",
  );

  if (isCreated) {
    const accountCode = await primary.getCode({ address: facadeAccount, blockNumber });
    const [accountOwner, canonical, token, accountPolicy, accountAgents, accountAdapters] =
      await Promise.all([
        read(facadeAccount, accountAbi, "owner"),
        read(facadeAccount, accountAbi, "isCanonicalGoghPunkAccount"),
        read(facadeAccount, accountAbi, "token"),
        read(facadeAccount, accountAbi, "policyModule"),
        read(facadeAccount, accountAbi, "agentRegistry"),
        read(facadeAccount, accountAbi, "adapterRegistry"),
      ]);
    assert(
      accountCode && accountCode !== "0x"
        && canonical === true
        && accountOwner.toLowerCase() === canary.expectedOwner
        && Number(token[0]) === ROBINHOOD.chainId
        && token[1].toLowerCase() === ROBINHOOD.canonicalCollection
        && token[2] === canary.tokenId
        && accountPolicy.toLowerCase() === addresses.BrokerPolicyModule
        && accountAgents.toLowerCase() === addresses.ArtAgentRegistry
        && accountAdapters.toLowerCase() === addresses.ArtAdapterRegistry,
      "activated Punk Account identity, owner, footer, and module bindings are correct",
      "activated Punk Account identity or module binding mismatch",
    );
    readinessDetail = `Punk #${canary.tokenValue} account ${facadeAccount} is active at confirmed block ${blockNumber}.`;
  } else {
    readinessDetail = `Punk #${canary.tokenValue} account ${facadeAccount} is deterministic but not yet activated at confirmed block ${blockNumber}.`;
    pass("Punk Account is not yet activated; no account was created by this read-only preflight");
  }

  summarize();
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    fail(error?.shortMessage ?? error?.message ?? "unexpected preflight failure");
    summarize();
  });
}
