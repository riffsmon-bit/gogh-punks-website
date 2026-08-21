import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(process.cwd(), "contracts/out");

function artifact(source, contract) {
  return JSON.parse(readFileSync(resolve(out, source, `${contract}.json`), "utf8"));
}

function functions(contractArtifact) {
  return new Set(
    contractArtifact.abi
      .filter((item) => item.type === "function")
      .map((item) => item.name),
  );
}

function requireFunctions(name, contractArtifact, required) {
  const names = functions(contractArtifact);
  for (const requiredName of required) {
    if (!names.has(requiredName)) throw new Error(`${name} ABI is missing ${requiredName}`);
  }
  for (const forbidden of ["adminExecute", "adminWithdraw", "sweep", "withdrawAll", "delegatecall"]) {
    if (names.has(forbidden)) throw new Error(`${name} exposes forbidden function ${forbidden}`);
  }
}

function requireDeployableSize(name, contractArtifact) {
  const bytecode = contractArtifact.deployedBytecode?.object ?? "";
  const bytes = bytecode.replace(/^0x/, "").length / 2;
  if (bytes === 0 || bytes >= 24_576) {
    throw new Error(`${name} deployed bytecode is ${bytes} bytes`);
  }
  return bytes;
}

function requireEvent(name, contractArtifact, eventName, expectedInputs) {
  const matching = contractArtifact.abi.filter(
    (item) => item.type === "event" && item.name === eventName,
  );
  if (matching.length !== 1) {
    throw new Error(`${name} ABI must contain exactly one ${eventName} event`);
  }
  const actual = matching[0].inputs.map(({ name: inputName, type, indexed }) => ({
    name: inputName,
    type,
    indexed: indexed === true,
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expectedInputs)) {
    throw new Error(`${name}.${eventName} ABI does not match the indexer trust boundary`);
  }
}

const account = artifact("GoghPunkAccountV1.sol", "GoghPunkAccountV1");
const registry = artifact("GoghPunkAccountRegistry.sol", "GoghPunkAccountRegistry");
const policy = artifact("BrokerPolicyModule.sol", "BrokerPolicyModule");
const agents = artifact("ArtAgentRegistry.sol", "ArtAgentRegistry");
const adapters = artifact("ArtAdapterRegistry.sol", "ArtAdapterRegistry");

requireFunctions("GoghPunkAccountV1", account, [
  "owner",
  "token",
  "execute",
  "executeBatch",
  "executeApprovedAcquisition",
  "executeAutonomousAcquisition",
  "cancelPendingAcquisitions",
]);
requireEvent("GoghPunkAccountV1", account, "AcquisitionExecuted", [
  { name: "executor", type: "address", indexed: true },
  { name: "opportunityId", type: "bytes32", indexed: true },
  { name: "collection", type: "address", indexed: true },
  { name: "opportunityType", type: "uint8", indexed: false },
  { name: "assetStandard", type: "uint8", indexed: false },
  { name: "adapter", type: "address", indexed: false },
  { name: "venue", type: "address", indexed: false },
  { name: "tokenId", type: "uint256", indexed: false },
  { name: "assetAmount", type: "uint256", indexed: false },
  { name: "currency", type: "address", indexed: false },
  { name: "price", type: "uint256", indexed: false },
  { name: "ownerApproved", type: "bool", indexed: false },
  { name: "reasoningHash", type: "bytes32", indexed: false },
  { name: "policyVersion", type: "uint64", indexed: false },
  { name: "nonce", type: "uint256", indexed: false },
  { name: "state", type: "uint256", indexed: false },
]);
requireFunctions("GoghPunkAccountRegistry", registry, [
  "account",
  "createAccount",
  "implementationForVersion",
]);
requireFunctions("BrokerPolicyModule", policy, [
  "configurePolicy",
  "validateAndConsume",
  "setFeatureFlags",
  "setGloballyPaused",
]);
requireFunctions("ArtAgentRegistry", agents, [
  "authorizeAgent",
  "revokeAgent",
  "revokeAllAgents",
  "isAuthorized",
]);
requireFunctions("ArtAdapterRegistry", adapters, [
  "registerAdapter",
  "setAdapterActive",
  "validateAdapter",
]);

const sizes = {
  GoghPunkAccountV1: requireDeployableSize("GoghPunkAccountV1", account),
  GoghPunkAccountRegistry: requireDeployableSize("GoghPunkAccountRegistry", registry),
  BrokerPolicyModule: requireDeployableSize("BrokerPolicyModule", policy),
  ArtAgentRegistry: requireDeployableSize("ArtAgentRegistry", agents),
  ArtAdapterRegistry: requireDeployableSize("ArtAdapterRegistry", adapters),
};

console.log(`PASS ABI trust-boundary checks and EIP-170 sizes ${JSON.stringify(sizes)}`);
