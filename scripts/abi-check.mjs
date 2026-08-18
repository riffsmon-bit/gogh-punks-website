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
